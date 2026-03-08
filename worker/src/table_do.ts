/**
 * FILE: /worker/src/table_do.ts (REPLACE)
 *
 * Changes (Points Mode):
 * - Implement endConditions.mode === "points":
 *   - When any player reaches/exceeds pointsTarget after a round resolves, the match ends.
 *   - Winner(s) are the lowest cumulative score at that time (Golf = low score wins).
 * - Also compute winners for holes mode when maxRounds reached (lowest cumulative score).
 *
 * Changes (UI support):
 * - GAME_STATE now includes rulesSummary (mode/pointsTarget/maxRounds/rankValues)
 * - GAME_STATE now includes matchOver/winners/endedReason
 *
 * NOTE:
 * - Still uses the existing Milestone 3 round-end + final-turn system.
 */

import {
  safeJsonParse,
  type ClientToServer,
  type ServerToClient,
  type Role,
  type ChatMessage,
  type TablePhase,
  type TableStatus,
  type Card,
  type Rank,
  type Suit,
  type GridPos,
  type VisibleSlot,
  type MatchEndedReason,
} from "./protocol";

import { reshuffleDiscardIntoShoeKeepingTop } from "./golf_deck";
import { DEFAULT_GC_POLICY, ttlForStatusMs, purgeTableRow } from "./table_gc";

export interface Env {
  TABLES: DurableObjectNamespace;
  cardgolf: D1Database;
}

type PlayerConn = { playerId: string; email: string; displayName?: string | null; role: "player"; ws: WebSocket; joinedAt: string };
type SpectatorConn = { spectatorId: string; email: string; displayName?: string | null; role: "spectator"; ws: WebSocket; joinedAt: string };

type TableConfig = {
  tableId: string;
  creatorPlayerId: string;
  rulesJson: any;
  spectatorChatAllowed: boolean;
  status: TableStatus;
};

type DealtCard = { card: Card; revealed: boolean };

type PlayerGame = {
  playerId: string;
  grid: Record<GridPos, DealtCard>;
  initialRevealsRemaining: number;
  pendingDraw: Card | null;
};

type RoundMeta = {
  finalTurnActive: boolean;
  finalTurnsRemaining: Set<string>;
  triggeredByPlayerId: string | null;
};

type ScoreMeta = {
  lastRoundScores: Record<string, number> | null;
  cumulativeScores: Record<string, number>;
  winners: string[] | null;
  endedReason: MatchEndedReason | null;
};

type GameState = {
  shoe: Card[];
  discard: Card[];
  players: Map<string, PlayerGame>;

  round: number;
  maxRounds: number; // holes mode uses 9; points mode uses a large sentinel but ignored unless you set a cap later

  turnOrder: string[];
  currentTurnPlayerId: string | null;

  roundMeta: RoundMeta;
  scoreMeta: ScoreMeta;
};

type TableState = {
  internalId: string;
  ownerPlayerId: string | null;
  players: PlayerConn[];
  spectators: SpectatorConn[];
  pendingPlayerJoins: number;
  mutedPlayers: Set<string>;
  mutedSpectators: Set<string>;
  phase: TablePhase;
  chat: ChatMessage[];
  config: TableConfig | null;
  game: GameState | null;
};

const MAX_PLAYERS = 6;
const CHAT_MAX = 200;
const CHAT_MAX_LEN = 280;
const CHAT_RATE_MS = 1000;

// Turn timeout (server-side) to prevent deadlocks
const TURN_TIMEOUT_MS = 120000; // 120s

const ALL_POS: GridPos[] = [1, 2, 3, 4, 5, 6];
const COLS: Array<[GridPos, GridPos]> = [
  [1, 2],
  [3, 4],
  [5, 6],
];

export class TableDO {
  private state: DurableObjectState;
  private env: Env;
  private table: TableState;
  private lastChatAtBySocket = new WeakMap<WebSocket, number>();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.table = {
      internalId: state.id.toString(),
      ownerPlayerId: null,
      players: [],
      spectators: [],
      pendingPlayerJoins: 0,
      mutedPlayers: new Set(),
      mutedSpectators: new Set(),
      phase: "lobby",
      chat: [],
      config: null,
      game: null,
    };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // ---------- POST /start (internal) ----------
    if (url.pathname === "/start" && request.method === "POST") {
      const tableId = this.getTableIdForThisRequest(url);
      if (!tableId) return json({ ok: false, error: "Missing table_id" }, 500);

      const callerEmail = readUserEmail(request);
      if (!callerEmail) return json({ ok: false, error: "Unauthorized (missing email)" }, 401);

      await this.ensureConfigLoaded(tableId);
      if (!this.table.config) return json({ ok: false, error: "Table not found" }, 404);

      await this.refreshStatusFromD1(this.table.config.tableId);

      const callerPlayerId = makeStableId(callerEmail);
      if (!this.table.ownerPlayerId) this.table.ownerPlayerId = this.table.config.creatorPlayerId;

      if (callerPlayerId !== this.table.ownerPlayerId) {
        return json({ ok: false, error: "Only the table owner can start the game" }, 403);
      }
      if (this.table.config.status !== "open") {
        return json({ ok: false, error: `Cannot start table in status '${this.table.config.status}'` }, 409);
      }
      if (this.table.players.length < 1) {
        return json({ ok: false, error: "Need at least 1 connected player to start." }, 409);
      }

      await this.env.cardgolf.prepare(`UPDATE tables SET status='started' WHERE table_id=?`).bind(this.table.config.tableId).run();

      this.table.config.status = "started";
      this.table.phase = "playing";

      if (!this.table.game) {
        this.table.game = this.buildNewGameFromRules(this.table.config.rulesJson, this.table.players);
      }

      // Start turn timer
      void this.markTurnStart();

      this.broadcast({ type: "GAME_STARTED", payload: { tableId: this.table.config.tableId } } as ServerToClient);
      this.broadcastGameState();
      this.broadcastState();

      return json({ ok: true }, 200);
    }

    // ---------- WebSocket /ws ----------
    if (url.pathname !== "/ws") return new Response("Not found", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });

    const tableId = this.getTableIdForThisRequest(url);
    if (!tableId) return json({ ok: false, error: "Missing table_id" }, 500);

    await this.ensureConfigLoaded(tableId);
    if (!this.table.config) return json({ ok: false, error: "Table not found" }, 404);

    await this.refreshStatusFromD1(this.table.config.tableId);

    if (!this.table.ownerPlayerId) this.table.ownerPlayerId = this.table.config.creatorPlayerId;
    this.table.phase = this.table.config.status === "started" ? "playing" : "lobby";

    const userEmail = readUserEmail(request);
    if (!userEmail) return json({ ok: false, error: "Missing email" }, 401);

    const roleParam = (url.searchParams.get("role") ?? "player") as Role;
    const role: Role = roleParam === "spectator" ? "spectator" : "player";

    if (role === "player") {
      if (this.table.config.status === "started") {
        return json({ ok: false, error: "Game already started; new players cannot join." }, 403);
      }
      if (this.table.players.length + this.table.pendingPlayerJoins >= MAX_PLAYERS) {
        return json({ ok: false, error: `Table is full (max ${MAX_PLAYERS} players).` }, 403);
      }
    }

    if (role === "player") this.table.pendingPlayerJoins++;

    try {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      server.accept();

      if (role === "player") {
        const playerId = makeStableId(userEmail);
        const joinedAt = new Date().toISOString();
        this.table.players.push({ playerId, email: userEmail, displayName: null, role: "player", ws: server, joinedAt });
        this.bindSocket(server, { id: playerId, role, email: userEmail });

        this.send(server, {
          type: "WELCOME",
          payload: {
            tableId: this.table.config.tableId,
            you: { playerId, email: userEmail, role, displayName: null },
            ownerPlayerId: this.table.ownerPlayerId,
            spectatorChatAllowed: this.table.config.spectatorChatAllowed,
          },
        });
      } else {
        const spectatorId = makeEphemeralId("spec");
        const joinedAt = new Date().toISOString();
        this.table.spectators.push({ spectatorId, email: userEmail, displayName: null, role: "spectator", ws: server, joinedAt });
        this.bindSocket(server, { id: spectatorId, role, email: userEmail });

        this.send(server, {
          type: "WELCOME",
          payload: {
            tableId: this.table.config.tableId,
            you: { playerId: spectatorId, email: userEmail, role, displayName: null },
            ownerPlayerId: this.table.ownerPlayerId,
            spectatorChatAllowed: this.table.config.spectatorChatAllowed,
          },
        });
      }

      this.send(server, { type: "CHAT_STATE", payload: { messages: this.table.chat } });

      if (this.table.config.status === "started") {
        const viewerId = role === "player" ? makeStableId(userEmail) : null;
        this.send(server, this.makeGameStateMessage(viewerId));
      }

      this.broadcastState();
      return new Response(null, { status: 101, webSocket: client });
    } finally {
      if (role === "player") this.table.pendingPlayerJoins = Math.max(0, this.table.pendingPlayerJoins - 1);
    }
  }

  // =========================
  // Socket bookkeeping
  // =========================

  private bindSocket(ws: WebSocket, who: { id: string; role: Role; email: string }) {
    ws.addEventListener("message", (ev) => this.onWsMessage(ws, who, ev));
    ws.addEventListener("close", () => this.onWsClose(ws, who));
  }

  
private onWsClose(ws: WebSocket, who: { id: string; role: Role; email: string }) {
  if (who.role === "player") {
    const leaving = this.table.players.find((p) => p.ws === ws) ?? null;
    const leavingId = leaving?.playerId ?? null;

    this.table.players = this.table.players.filter((p) => p.ws !== ws);
    this.table.mutedPlayers.delete(leavingId ?? "");

    // If the owner left, delegate to the oldest remaining connected player.
    if (leavingId && this.table.ownerPlayerId === leavingId) {
      const nextOwner = this.getOldestConnectedPlayerId(leavingId);
      this.table.ownerPlayerId = nextOwner;
      if (nextOwner) this.sendSystemChat(`Owner left. Ownership transferred.`);
    }

    // If a game is in progress, remove them from the live game structures.
    if (leavingId && this.table.game) {
      void this.removePlayerFromLiveGame(leavingId);
    }
  } else {
    const leaving = this.table.spectators.find((s) => s.ws === ws) ?? null;
    const leavingId = leaving?.spectatorId ?? null;

    this.table.spectators = this.table.spectators.filter((s) => s.ws !== ws);
    this.table.mutedSpectators.delete(leavingId ?? "");
  }

  this.broadcastState();
  if (this.table.game) this.broadcastGameState();
}

  private onWsMessage(ws: WebSocket, who: { id: string; role: Role; email: string }, ev: MessageEvent) {
    const raw = typeof ev.data === "string" ? ev.data : "";
    const parsed = safeJsonParse<ClientToServer>(raw);
    if (!parsed.ok) return this.err(ws, "BAD_JSON", "Invalid JSON");

    const msg = parsed.value;

    // Chat
    if (msg.type === "CHAT_SEND") return this.handleChatSend(ws, who, msg.payload?.text);
    if (msg.type === "SET_DISPLAY_NAME") return this.handleSetDisplayName(ws, who, msg.payload?.displayName);
    if (msg.type === "PING") return this.send(ws, { type: "PONG" } as ServerToClient);

    
// Owner / moderation
if (msg.type === "MUTE") return this.handleMute(ws, who, msg.payload?.targetId, msg.payload?.targetRole);
if (msg.type === "UNMUTE") return this.handleUnmute(ws, who, msg.payload?.targetId, msg.payload?.targetRole);
if (msg.type === "KICK") return this.handleKick(ws, who, msg.payload?.targetId, msg.payload?.targetRole);
if (msg.type === "OWNER_DELEGATE") return this.handleOwnerDelegate(ws, who, (msg as any).payload?.newOwnerPlayerId ?? (msg as any).payload?.toPlayerId);

// Turn loop
    if (msg.type === "REVEAL") return this.handleReveal(ws, who, msg.payload?.pos);
    if (msg.type === "DRAW_SHOE") return this.handleDrawShoe(ws, who);
    if (msg.type === "DRAW_DISCARD") return this.handleDrawDiscard(ws, who);
    if (msg.type === "SWAP") return this.handleSwap(ws, who, msg.payload?.pos);
    if (msg.type === "DISCARD_DRAWN") return this.handleDiscardDrawn(ws, who, msg.payload?.revealPos);
    if (msg.type === "PASS") return this.handlePass(ws, who);

    return this.err(ws, "UNKNOWN", "Unknown message type");
  }

  
// =========================
// Owner / moderation
// =========================

private requireOwner(ws: WebSocket, who: { id: string; role: Role; email: string }): boolean {
  if (!this.table.ownerPlayerId) return this.err(ws, "BAD_STATE", "No owner is set");
  if (who.role !== "player") return this.err(ws, "FORBIDDEN", "Owner actions require player role");
  if (this.table.ownerPlayerId !== who.id) return this.err(ws, "FORBIDDEN", "Only the table owner can do that");
  return true;
}

// Oldest connected player (by joinedAt) excluding optional playerId.
private getOldestConnectedPlayerId(excludePlayerId?: string | null): string | null {
  const ex = excludePlayerId ?? null;
  const candidates = (this.table.players ?? [])
    .filter((p) => p?.playerId && p?.ws)
    .filter((p) => (ex ? p.playerId !== ex : true))
    .slice()
    .sort((a, b) => {
      const aj = Date.parse(a.joinedAt ?? "") || 0;
      const bj = Date.parse(b.joinedAt ?? "") || 0;
      return aj - bj;
    });
  return candidates.length ? (candidates[0].playerId as string) : null;
}

private handleMute(ws: WebSocket, who: { id: string; role: Role; email: string }, targetId?: string, targetRole?: Role) {
  if (!this.requireOwner(ws, who)) return;
  if (!targetId || !targetRole) return this.err(ws, "BAD_REQUEST", "Missing target");

  if (targetRole === "player") this.table.mutedPlayers.add(targetId);
  else this.table.mutedSpectators.add(targetId);

  this.sendSystemChat(`${this.getDisplayNameForId(targetId, targetRole) ?? targetId} was muted.`);
  this.broadcastState();
}

private handleUnmute(ws: WebSocket, who: { id: string; role: Role; email: string }, targetId?: string, targetRole?: Role) {
  if (!this.requireOwner(ws, who)) return;
  if (!targetId || !targetRole) return this.err(ws, "BAD_REQUEST", "Missing target");

  if (targetRole === "player") this.table.mutedPlayers.delete(targetId);
  else this.table.mutedSpectators.delete(targetId);

  this.sendSystemChat(`${this.getDisplayNameForId(targetId, targetRole) ?? targetId} was unmuted.`);
  this.broadcastState();
}

private handleKick(ws: WebSocket, who: { id: string; role: Role; email: string }, targetId?: string, targetRole?: Role) {
  if (!this.requireOwner(ws, who)) return;
  if (!targetId || !targetRole) return this.err(ws, "BAD_REQUEST", "Missing target");

  // Owner cannot kick themselves.
  if (targetRole === "player" && targetId === who.id) return this.err(ws, "FORBIDDEN", "Owner cannot kick themselves");

  if (targetRole === "player") {
    const p = this.table.players.find((x) => x.playerId === targetId) ?? null;
    try { p?.ws?.close(4000, "kicked"); } catch {}
    this.table.players = this.table.players.filter((x) => x.playerId !== targetId);
    this.table.mutedPlayers.delete(targetId);

    if (this.table.game) void this.removePlayerFromLiveGame(targetId);
  } else {
    const s = this.table.spectators.find((x) => x.spectatorId === targetId) ?? null;
    try { s?.ws?.close(4000, "kicked"); } catch {}
    this.table.spectators = this.table.spectators.filter((x) => x.spectatorId !== targetId);
    this.table.mutedSpectators.delete(targetId);
  }

  this.sendSystemChat(`${this.getDisplayNameForId(targetId, targetRole) ?? targetId} was kicked.`);
  this.broadcastState();
  if (this.table.game) this.broadcastGameState();
}

private handleOwnerDelegate(ws: WebSocket, who: { id: string; role: Role; email: string }, newOwnerPlayerId?: string) {
  if (!this.requireOwner(ws, who)) return;
  if (!newOwnerPlayerId) return this.err(ws, "BAD_REQUEST", "Missing newOwnerPlayerId");

  const exists = this.table.players.some((p) => p.playerId === newOwnerPlayerId);
  if (!exists) return this.err(ws, "BAD_REQUEST", "New owner must be a connected player");

  this.table.ownerPlayerId = newOwnerPlayerId;
  this.sendSystemChat(`Ownership transferred.`);
  this.broadcastState();
}

// =========================
  // Messaging helpers
  // =========================

  private send(ws: WebSocket, msg: ServerToClient) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // ignore
    }
  }

  private broadcast(msg: ServerToClient) {
    for (const p of this.table.players) this.send(p.ws, msg);
    for (const s of this.table.spectators) this.send(s.ws, msg);
  }

  private broadcastState() {
    if (!this.table.config) return;

    this.broadcast({
      type: "TABLE_STATE",
      payload: {
        tableId: this.table.config.tableId,
        status: this.table.config.status,
        phase: this.table.phase,
        ownerPlayerId: this.table.ownerPlayerId,
        players: this.table.players.map((p) => ({ playerId: p.playerId, email: p.email, displayName: p.displayName ?? null, joinedAt: p.joinedAt })),
        spectators: this.table.spectators.map((s) => ({ spectatorId: s.spectatorId, email: s.email, displayName: s.displayName ?? null, joinedAt: s.joinedAt })),
        mutedPlayers: [...this.table.mutedPlayers],
        mutedSpectators: [...this.table.mutedSpectators],
        spectatorChatAllowed: this.table.config.spectatorChatAllowed,
      },
    } as ServerToClient);
  }

  private broadcastGameState() {
    // players get a player-specific view (pendingDraw only for active player)
    for (const p of this.table.players) {
      this.send(p.ws, this.makeGameStateMessage(p.playerId));
    }
    // spectators get a neutral view (no pendingDraw)
    for (const s of this.table.spectators) {
      this.send(s.ws, this.makeGameStateMessage(null));
    }
  }

  private err(ws: WebSocket, code: string, message: string) {
    this.send(ws, { type: "ERROR", payload: { code, message } } as ServerToClient);
  }

  // =========================
  // Config / D1 helpers
  // =========================

  private getTableIdForThisRequest(url: URL): string | null {
    return url.searchParams.get("table_id") ?? url.searchParams.get("tableId");
  }

  private async ensureConfigLoaded(tableId: string) {
    if (this.table.config) return;

    const row = await this.env.cardgolf
      .prepare(`SELECT table_id, creator_player_id, rules_json, spectator_chat_allowed, status FROM tables WHERE table_id=?`)
      .bind(tableId)
      .first<any>();

    if (!row) return;

    this.table.config = {
      tableId: row.table_id,
      creatorPlayerId: row.creator_player_id,
      rulesJson: typeof row.rules_json === "string" ? JSON.parse(row.rules_json) : row.rules_json,
      spectatorChatAllowed: !!row.spectator_chat_allowed,
      status: row.status as TableStatus,
    };

    if (!this.table.ownerPlayerId) this.table.ownerPlayerId = this.table.config.creatorPlayerId;
  }

  private async refreshStatusFromD1(tableId: string) {
    const row = await this.env.cardgolf.prepare(`SELECT status FROM tables WHERE table_id=?`).bind(tableId).first<any>();
    if (row && this.table.config) this.table.config.status = row.status as TableStatus;
  }

  /* =========================
     GC / cleanup helpers
  ========================= */

  private connCount(): number {
    return this.table.players.length + this.table.spectators.length;
  }

  private async noteActivityNow(): Promise<void> {
    // Durable Object storage persists even when in-memory state resets.
    await this.state.storage.put("lastActivityMs", Date.now());
  }

  private async scheduleGcAlarmSoon(): Promise<void> {
    // Always schedule an alarm when we become empty.
    // The alarm handler decides whether to delete based on status + lastActivity + TTL.
    // 2 minutes keeps it responsive without being spammy.
    await this.state.storage.setAlarm(Date.now() + 2 * 60 * 1000);
  }

  private async tryPurgeIfStale(): Promise<boolean> {
    // Only purge if there are no connections.
    if (this.connCount() > 0) return false;

    const cfg = this.table.config;
    if (!cfg?.tableId) return false;

    const lastActivityMs = (await this.state.storage.get<number>("lastActivityMs")) ?? Date.now();
    const ttlMs = ttlForStatusMs(cfg.status, DEFAULT_GC_POLICY);

    const ageMs = Date.now() - lastActivityMs;
    if (ageMs < ttlMs) {
      // Not stale yet; keep checking later.
      await this.scheduleGcAlarmSoon();
      return false;
    }

    // Purge the D1 row. After this, future joins should 404 (table doesn't exist).
    await purgeTableRow(this.env as any, cfg.tableId);

    // Clear DO storage & in-memory state so it doesn’t “resurrect” phantom state.
    await this.state.storage.deleteAll();
    this.table.config = null;
    this.table.game = null;
    this.table.chat = [];
    this.table.phase = "lobby";

    return true;
  }

  // =========================
  // Chat
  // =========================

  // =========================
  // Display names (table-scoped)
  // =========================

  private getDisplayNameForId(id: string, role: Role): string | null {
    if (role === "player") {
      const p = this.table.players.find((x) => x.playerId === id);
      return (p?.displayName ?? null) as any;
    }
    const s = this.table.spectators.find((x) => x.spectatorId === id);
    return (s?.displayName ?? null) as any;
  }

  private handleSetDisplayName(ws: WebSocket, who: { id: string; role: Role; email: string }, displayName?: string) {
    const raw = (displayName ?? "").trim();

    // Treat empty string as clearing the name.
    const cleaned = raw
      ? raw
          .replace(/[\u0000-\u001F\u007F]/g, "") // strip control chars
          .slice(0, 24) // keep it short for UI
      : "";

    if (who.role === "player") {
      const p = this.table.players.find((x) => x.playerId === who.id);
      if (!p) return;
      p.displayName = cleaned ? cleaned : null;
    } else {
      const s = this.table.spectators.find((x) => x.spectatorId === who.id);
      if (!s) return;
      s.displayName = cleaned ? cleaned : null;
    }

    // Update everyone immediately (names appear in multiple panels).
    this.broadcastState();
    if (this.table.config?.status === "started") this.broadcastGameState();

  }


  private handleChatSend(ws: WebSocket, who: { id: string; role: Role; email: string }, text?: string) {
    if (!this.table.config) return;

    if (who.role === "spectator" && !this.table.config.spectatorChatAllowed) {
      return this.err(ws, "CHAT_DISABLED", "Spectator chat is disabled.");
    }

    const now = Date.now();
    const lastAt = this.lastChatAtBySocket.get(ws) ?? 0;
    if (now - lastAt < CHAT_RATE_MS) return this.err(ws, "RATE_LIMIT", "Slow down.");
    this.lastChatAtBySocket.set(ws, now);

    const t = (text ?? "").trim();
    if (!t) return;
    if (t.length > CHAT_MAX_LEN) return this.err(ws, "TOO_LONG", `Chat max length is ${CHAT_MAX_LEN}.`);

    if (who.role === "player" && this.table.mutedPlayers.has(who.id)) return this.err(ws, "MUTED", "You are muted.");
    if (who.role === "spectator" && this.table.mutedSpectators.has(who.id)) return this.err(ws, "MUTED", "You are muted.");

    const msg: ChatMessage = {
      id: makeEphemeralId("m"),
      ts: new Date().toISOString(),
      from: { id: who.id, role: who.role, email: who.email, displayName: this.getDisplayNameForId(who.id, who.role) },
      text: t,
    };

    this.table.chat.push(msg);
    if (this.table.chat.length > CHAT_MAX) this.table.chat.splice(0, this.table.chat.length - CHAT_MAX);

    this.broadcast({ type: "CHAT_APPEND", payload: { message: msg } } as ServerToClient);
  }

  // =========================
  // Turn helpers
  // =========================

  private requireStartedPlayer(who: { id: string; role: Role }, ws: WebSocket): PlayerGame | null {
    if (who.role !== "player") {
      this.err(ws, "FORBIDDEN", "Spectators cannot perform game actions.");
      return null;
    }
    if (!this.table.config || this.table.config.status !== "started") {
      this.err(ws, "BAD_STATE", "Game not started.");
      return null;
    }
    if (!this.table.game) {
      this.err(ws, "BAD_STATE", "Game state missing.");
      return null;
    }
    const pg = this.table.game.players.get(who.id);
    if (!pg) {
      this.err(ws, "NOT_FOUND", "Player not found in game.");
      return null;
    }
    return pg;
  }

  private isPlayersTurn(playerId: string): boolean {
    return !!this.table.game && this.table.game.currentTurnPlayerId === playerId;
  }

  private faceDownCount(pg: PlayerGame): number {
    let c = 0;
    for (const pos of ALL_POS) if (!pg.grid[pos].revealed) c++;
    return c;
  }

  private enforceInitialReveals(pg: PlayerGame, ws: WebSocket): boolean {
    if (pg.initialRevealsRemaining > 0) {
      this.err(ws, "MUST_REVEAL", `You must reveal ${pg.initialRevealsRemaining} more card(s) before drawing.`);
      return false;
    }
    return true;
  }

  private advanceTurn() {
    const g = this.table.game;
    if (!g) return;
    const order = g.turnOrder;
    if (order.length === 0) {
      g.currentTurnPlayerId = null;
      return;
    }
    const cur = g.currentTurnPlayerId;
    if (!cur) {
      g.currentTurnPlayerId = order[0];
      return;
    }
    const idx = order.indexOf(cur);
    g.currentTurnPlayerId = idx >= 0 ? order[(idx + 1) % order.length] : order[0];
  }

/* =========================
   Turn timer (deadlock prevention)
========================= */

private async markTurnStart() {
  const g = this.table.game;
  const cfg = this.table.config;
  if (!g || !cfg) return;
  if (cfg.status !== "started") return;

  const pid = g.currentTurnPlayerId;
  if (!pid) return;

  const deadlineMs = Date.now() + TURN_TIMEOUT_MS;

  g.turnDeadlineMs = deadlineMs;
  g.turnTimeoutMs = TURN_TIMEOUT_MS;
  await this.state.storage.put("turnDeadlineMs", deadlineMs);
  await this.state.storage.put("turnPlayerId", pid);

  await this.state.storage.setAlarm(deadlineMs);
}

private sendSystemChat(text: string) {
  const t = (text ?? "").trim();
  if (!t) return;
  const clipped = t.length > CHAT_MAX_LEN ? t.slice(0, CHAT_MAX_LEN) : t;

  const msg: ChatMessage = {
    id: makeEphemeralId("sys"),
    ts: new Date().toISOString(),
    from: { id: "system", role: "player", email: "SYSTEM" },
    text: clipped,
  };

  this.table.chat.push(msg);
  if (this.table.chat.length > CHAT_MAX) this.table.chat.splice(0, this.table.chat.length - CHAT_MAX);

  this.broadcast({ type: "CHAT_APPEND", payload: { message: msg } } as ServerToClient);
}

private async handleTurnTimeoutIfDue() {
  const cfg = this.table.config;
  const g = this.table.game;
  if (!cfg || !g) return;
  if (cfg.status !== "started") return;

  const deadlineMs = await this.state.storage.get<number>("turnDeadlineMs");
  const pid = await this.state.storage.get<string>("turnPlayerId");

  if (!deadlineMs || !pid) return;

  if (Date.now() < deadlineMs) {
    await this.state.storage.setAlarm(deadlineMs);
    return;
  }

  if (g.currentTurnPlayerId !== pid) {
    void this.markTurnStart();
    return;
  }

  const pg = g.players.get(pid);
  if (!pg) {
    this.advanceTurn();
    void this.markTurnStart();
    void this.markTurnStart();
    this.broadcastGameState();
    this.broadcastState();
    return;
  }

  if (pg.pendingDraw) {
    g.discard.push(pg.pendingDraw);
    pg.pendingDraw = null;

    this.sendSystemChat(`SYSTEM: ${pid} timed out — discarded drawn card.`);

    this.endTurnForPlayer(pid);
    void this.markTurnStart();

    this.broadcastGameState();
    this.broadcastState();
    return;
  }

  const revealFirstFaceDown = (): boolean => {
    for (const pos of ALL_POS) {
      if (!pg.grid[pos].revealed) {
        pg.grid[pos].revealed = true;
        return true;
      }
    }
    return false;
  };

  if (pg.initialRevealsRemaining > 0) {
    while (pg.initialRevealsRemaining > 0) {
      const did = revealFirstFaceDown();
      if (!did) break;
      pg.initialRevealsRemaining -= 1;
    }


    this.sendSystemChat(`SYSTEM: ${pid} timed out — auto-revealed required cards.`);

    this.maybeTriggerFinalTurn(pid);
    this.endTurnForPlayer(pid);
    void this.markTurnStart();

    this.broadcastGameState();
    this.broadcastState();
    return;
  }

  const did = revealFirstFaceDown();
  if (did) this.maybeTriggerFinalTurn(pid);


  this.sendSystemChat(`SYSTEM: ${pid} timed out — auto-revealed a card.`);

  this.endTurnForPlayer(pid);
  void this.markTurnStart();

  this.broadcastGameState();
  this.broadcastState();
}

/* =========================
   Leave / Kick mid-game rules
========================= */

private async removePlayerFromLiveGame(playerId: string) {
  const cfg = this.table.config;
  const g = this.table.game;
  if (!cfg || !g) return;

  g.turnOrder = g.turnOrder.filter((pid) => pid !== playerId);
  g.roundMeta.finalTurnsRemaining.delete(playerId);
  g.players.delete(playerId);

  if (g.currentTurnPlayerId === playerId) {
    this.advanceTurn();
    void this.markTurnStart();
  }

  if (cfg.status === "started" && g.turnOrder.length <= 1) {
    this.endMatch("all_opponents_left" as any);
    return;
  }

  void this.markTurnStart();
}

  private maybeTriggerFinalTurn(playerId: string) {
    const g = this.table.game;
    if (!g) return;

    if (g.roundMeta.finalTurnActive) return;

    const pg = g.players.get(playerId);
    if (!pg) return;

    if (this.faceDownCount(pg) !== 0) return;

    g.roundMeta.finalTurnActive = true;
    g.roundMeta.triggeredByPlayerId = playerId;
    g.roundMeta.finalTurnsRemaining = new Set<string>(g.turnOrder);
  }

  private endTurnForPlayer(playerId: string) {
    const g = this.table.game;
    if (!g) return;

    if (g.roundMeta.finalTurnActive) {
      g.roundMeta.finalTurnsRemaining.delete(playerId);

      if (g.roundMeta.finalTurnsRemaining.size === 0) {
        this.resolveRoundAndMaybeStartNext();
        return;
      }
    }

    this.advanceTurn();
    void this.markTurnStart();
  }

  // =========================
  // NEW: scoring end helpers
  // =========================

  private computeLowestWinners(cumulative: Record<string, number>, playerIds: string[]): string[] {
    let best = Number.POSITIVE_INFINITY;
    for (const pid of playerIds) {
      const v = cumulative[pid];
      if (typeof v === "number" && Number.isFinite(v)) best = Math.min(best, v);
    }
    if (!Number.isFinite(best)) return [];
    return playerIds.filter((pid) => cumulative[pid] === best);
  }

  private shouldEndByPointsTarget(rulesJson: any, cumulative: Record<string, number>, playerIds: string[]): boolean {
    const mode = rulesJson?.endConditions?.mode;
    if (mode !== "points") return false;

    const pt = rulesJson?.endConditions?.pointsTarget;
    if (typeof pt !== "number" || !Number.isFinite(pt) || pt <= 0) return false;

    // End the match when ANYONE reaches/exceeds target (classic "play to 100" stop condition)
    for (const pid of playerIds) {
      const v = cumulative[pid];
      if (typeof v === "number" && Number.isFinite(v) && v >= pt) return true;
    }
    return false;
  }

  private endMatch(reason: MatchEndedReason) {
    const g = this.table.game;
    const cfg = this.table.config;
    if (!g || !cfg) return;

    cfg.status = "ended";
    this.table.phase = "playing";

    g.scoreMeta.endedReason = reason;

    // winners are always LOWEST cumulative score (Golf = low wins)
    g.scoreMeta.winners = this.computeLowestWinners(g.scoreMeta.cumulativeScores, g.turnOrder);

    // Best-effort persist ended status
    void this.env.cardgolf.prepare(`UPDATE tables SET status='ended' WHERE table_id=?`).bind(cfg.tableId).run();

    this.broadcast({ type: "GAME_ENDED", payload: { tableId: cfg.tableId } } as ServerToClient);
    this.broadcastGameState();
    this.broadcastState();
  }

  private resolveRoundAndMaybeStartNext() {
    const g = this.table.game;
    const cfg = this.table.config;
    if (!g || !cfg) return;

    const rulesJson = cfg.rulesJson ?? {};
    const mode: "holes" | "points" = rulesJson?.endConditions?.mode === "points" ? "points" : "holes";

    // Auto-reveal all remaining face-down cards
    for (const pid of g.turnOrder) {
      const pg = g.players.get(pid);
      if (!pg) continue;
      for (const pos of ALL_POS) pg.grid[pos].revealed = true;
    }

    // Score this round and update cumulative
    const last: Record<string, number> = {};
    for (const pid of g.turnOrder) {
      const pg = g.players.get(pid);
      if (!pg) continue;
      const s = this.totalGridScore(pg.grid, rulesJson);
      last[pid] = s;
      g.scoreMeta.cumulativeScores[pid] = (g.scoreMeta.cumulativeScores[pid] ?? 0) + s;
    }
    g.scoreMeta.lastRoundScores = last;

    // ---------- NEW: Points Mode end condition ----------
    if (this.shouldEndByPointsTarget(rulesJson, g.scoreMeta.cumulativeScores, g.turnOrder)) {
      this.endMatch("points_target_reached");
      return;
    }

    // ---------- Holes mode (or fallback cap) ----------
    // In holes mode, we end when round >= maxRounds.
    // In points mode, we *do not* auto-end by maxRounds unless you later choose to support an optional cap.
    if (mode === "holes" && g.round >= g.maxRounds) {
      this.endMatch("holes_max_rounds_reached");
      return;
    }

    // Start next round
    g.round += 1;

    const deckCount = Number(rulesJson?.gameVariant?.deckCount ?? 2);

    g.shoe = this.buildShoe(deckCount);
    this.shuffleInPlace(g.shoe);
    g.discard = [];

    for (const pid of g.turnOrder) {
      const pg = g.players.get(pid);
      if (!pg) continue;

      const grid = {} as Record<GridPos, DealtCard>;
      for (const pos of ALL_POS) {
        const card = g.shoe.pop();
        if (!card) throw new Error("Shoe exhausted while dealing next round.");
        grid[pos] = { card, revealed: false };
      }

      pg.grid = grid;
      pg.pendingDraw = null;
      pg.initialRevealsRemaining = 2;
    }

    // Seed discard with one face-up card for the new round
    const firstDiscard = g.shoe.pop();
    g.discard = firstDiscard ? [firstDiscard] : [];

    // Reset final turn meta
    g.roundMeta.finalTurnActive = false;
    g.roundMeta.triggeredByPlayerId = null;
    g.roundMeta.finalTurnsRemaining = new Set<string>();

    // Start at first player again (simple)
    g.currentTurnPlayerId = g.turnOrder.length > 0 ? g.turnOrder[0] : null;

    // Start timer for the new round
    void this.markTurnStart();

    this.broadcastGameState();
    this.broadcastState();
  }

  // =========================
  // Actions
  // =========================

  private handleReveal(ws: WebSocket, who: { id: string; role: Role }, pos?: GridPos) {
    const pg = this.requireStartedPlayer(who, ws);
    const g = this.table.game;
    if (!pg || !g) return;

    if (!this.isPlayersTurn(who.id)) return this.err(ws, "NOT_YOUR_TURN", "It is not your turn.");
    if (!pos || !ALL_POS.includes(pos)) return this.err(ws, "BAD_REQUEST", "pos must be 1..6.");
    if (pg.grid[pos].revealed) return this.err(ws, "BAD_STATE", "That card is already revealed.");

    pg.grid[pos].revealed = true;

    if (pg.initialRevealsRemaining > 0) pg.initialRevealsRemaining--;

    this.maybeTriggerFinalTurn(who.id);

    this.broadcastGameState();
    this.broadcastState();

    // If initial reveal gate is still active, do not end the turn yet.
    if (pg.initialRevealsRemaining > 0) return;

    // During initial gate, player may reveal multiple. After gate, a reveal ends turn.
    if (g.roundMeta.finalTurnActive) {
      // if they revealed their last card during final turn, they still "used" their final turn; endTurnForPlayer handles meta
    }
    this.endTurnForPlayer(who.id);
    this.broadcastGameState();
    this.broadcastState();
  }

  private handleDrawShoe(ws: WebSocket, who: { id: string; role: Role }) {
    const pg = this.requireStartedPlayer(who, ws);
    const g = this.table.game;
    if (!pg || !g) return;

    if (!this.isPlayersTurn(who.id)) return this.err(ws, "NOT_YOUR_TURN", "It is not your turn.");
    if (!this.enforceInitialReveals(pg, ws)) return;
    if (pg.pendingDraw) return this.err(ws, "BAD_STATE", "You already drew a card.");

    // If shoe is empty, attempt reshuffle from discard (keeping discardTop)
    if (g.shoe.length === 0) {
      const reshuffled = reshuffleDiscardIntoShoeKeepingTop(g.shoe, g.discard, (arr) => this.shuffleInPlace(arr));
      if (!reshuffled) return this.err(ws, "EMPTY", "Shoe is empty.");
    }

    const c = g.shoe.pop();
    if (!c) return this.err(ws, "EMPTY", "Shoe is empty.");
    pg.pendingDraw = c;

    this.broadcastGameState();
    this.broadcastState();
  }

  private handleDrawDiscard(ws: WebSocket, who: { id: string; role: Role }) {
    const pg = this.requireStartedPlayer(who, ws);
    const g = this.table.game;
    if (!pg || !g) return;

    if (!this.isPlayersTurn(who.id)) return this.err(ws, "NOT_YOUR_TURN", "It is not your turn.");
    if (!this.enforceInitialReveals(pg, ws)) return;
    if (pg.pendingDraw) return this.err(ws, "BAD_STATE", "You already drew a card.");
    if (g.discard.length === 0) return this.err(ws, "EMPTY", "Discard is empty.");

    const c = g.discard.pop()!;
    pg.pendingDraw = c;

    this.broadcastGameState();
    this.broadcastState();
  }

  private handleSwap(ws: WebSocket, who: { id: string; role: Role }, pos?: GridPos) {
    const pg = this.requireStartedPlayer(who, ws);
    const g = this.table.game;
    if (!pg || !g) return;

    if (!this.isPlayersTurn(who.id)) return this.err(ws, "NOT_YOUR_TURN", "It is not your turn.");
    if (!pos || !ALL_POS.includes(pos)) return this.err(ws, "BAD_REQUEST", "pos must be 1..6.");
    if (!pg.pendingDraw) return this.err(ws, "BAD_STATE", "No pending draw to swap.");

    const drawn = pg.pendingDraw;
    const replaced = pg.grid[pos].card;

    // Put replaced onto discard face-up
    g.discard.push(replaced);

    // Swap in drawn, face-up
    pg.grid[pos] = { card: drawn, revealed: true };

    // Clear pending
    pg.pendingDraw = null;

    this.endTurnForPlayer(who.id);

    this.broadcastGameState();
    this.broadcastState();
  }

  private handleDiscardDrawn(ws: WebSocket, who: { id: string; role: Role }, revealPos?: GridPos) {
    const pg = this.requireStartedPlayer(who, ws);
    const g = this.table.game;
    const cfg = this.table.config;
    if (!pg || !g || !cfg) return;

    if (!this.isPlayersTurn(who.id)) return this.err(ws, "NOT_YOUR_TURN", "It is not your turn.");
    if (!pg.pendingDraw) return this.err(ws, "BAD_STATE", "No pending draw to discard.");

    const fd = this.faceDownCount(pg);

    // If exactly 1 face-down remains, DISCARD_DRAWN must include revealPos (or use PASS as alternative)
    if (fd === 1) {
      if (!revealPos) return this.err(ws, "MUST_REVEAL", "You must reveal your last face-down card OR use PASS.");
    }

    if (revealPos) {
      if (!ALL_POS.includes(revealPos)) return this.err(ws, "BAD_REQUEST", "revealPos must be 1..6.");
      if (pg.grid[revealPos].revealed) return this.err(ws, "BAD_STATE", "That card is already revealed.");
    } else {
      // If fd > 1, revealPos is required by rule
      if (fd > 1) return this.err(ws, "MUST_REVEAL", "Discarding a drawn card requires revealing a face-down card.");
    }

    // Discard the drawn card
    g.discard.push(pg.pendingDraw);
    pg.pendingDraw = null;

    // Reveal required card
    if (revealPos) {
      pg.grid[revealPos].revealed = true;
      // This could trigger final turn if it was the last face-down
      this.maybeTriggerFinalTurn(who.id);
    }

    this.endTurnForPlayer(who.id);

    this.broadcastGameState();
    this.broadcastState();
  }

  private handlePass(ws: WebSocket, who: { id: string; role: Role }) {
    const pg = this.requireStartedPlayer(who, ws);
    const g = this.table.game;
    const cfg = this.table.config;
    if (!pg || !g || !cfg) return;

    if (!this.isPlayersTurn(who.id)) return this.err(ws, "NOT_YOUR_TURN", "It is not your turn.");

    // PASS disabled during final turn
    if (g.roundMeta.finalTurnActive) return this.err(ws, "PASS_DISABLED", "Pass is disabled during the final turn.");

    const passRule = cfg.rulesJson?.passRule ?? {};
    if (!passRule.enabled) return this.err(ws, "PASS_DISABLED", "Pass is disabled.");

    if (passRule.requiresDrawFirst && !pg.pendingDraw) return this.err(ws, "BAD_STATE", "Pass requires drawing a card first.");

    if (passRule.requiresExactlyOneFaceDown) {
      const fd = this.faceDownCount(pg);
      if (fd !== 1) return this.err(ws, "BAD_STATE", `Pass requires exactly 1 face-down card. You have ${fd}.`);
    }

    g.discard.push(pg.pendingDraw!);
    pg.pendingDraw = null;

    this.endTurnForPlayer(who.id);

    this.broadcastGameState();
    this.broadcastState();
  }

  // =========================
  // Game creation + scoring
  // =========================

  private buildNewGameFromRules(rulesJson: any, connectedPlayers: PlayerConn[]): GameState {
    const deckCount = Number(rulesJson?.gameVariant?.deckCount ?? 2);

    const mode: "holes" | "points" = rulesJson?.endConditions?.mode === "points" ? "points" : "holes";

    // For holes, maxRounds is locked to 9.
    // For points, we ignore maxRounds unless you later implement an optional cap; keep a large sentinel for UI legacy.
    const maxRounds = mode === "holes" ? 9 : 9999;

    const shoe = this.buildShoe(deckCount);
    this.shuffleInPlace(shoe);

    const ordered = [...connectedPlayers];
    const turnOrder = ordered.map((p) => p.playerId);

    const players = new Map<string, PlayerGame>();
    const cumulative: Record<string, number> = {};

    for (const p of ordered) {
      const grid = {} as Record<GridPos, DealtCard>;
      for (const pos of ALL_POS) {
        const card = shoe.pop();
        if (!card) throw new Error("Shoe exhausted while dealing.");
        grid[pos] = { card, revealed: false };
      }
      players.set(p.playerId, {
        playerId: p.playerId,
        grid,
        initialRevealsRemaining: 2,
        pendingDraw: null,
      });
      cumulative[p.playerId] = 0;
    }

    // Seed discard with one face-up card
    const firstDiscard = shoe.pop();
    const discard = firstDiscard ? [firstDiscard] : [];

    return {
      shoe,
      discard,
      players,
      round: 1,
      maxRounds,
      turnOrder,
      currentTurnPlayerId: turnOrder.length > 0 ? turnOrder[0] : null,
      turnDeadlineMs: null,
turnTimeoutMs: TURN_TIMEOUT_MS,

roundMeta: {
        finalTurnActive: false,
        finalTurnsRemaining: new Set<string>(),
        triggeredByPlayerId: null,
      },
      scoreMeta: {
        lastRoundScores: null,
        cumulativeScores: cumulative,
        winners: null,
        endedReason: null,
      },
    };
  }

  private buildShoe(deckCount: number): Card[] {
    const ranks: Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    const suits: Suit[] = ["C", "D", "H", "S"];

    const shoe: Card[] = [];
    for (let d = 1; d <= deckCount; d++) {
      for (const s of suits) for (const r of ranks) {
        shoe.push({ id: `d${d}-${r}${s}-${makeEphemeralId("c")}`, rank: r, suit: s });
      }
    }
    return shoe;
  }

  private shuffleInPlace<T>(arr: T[]) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
  }

  private cardValue(rank: Rank, rulesJson: any): number {
    const v = rulesJson?.scoring?.rankValues?.[rank];
    if (typeof v === "number") return v;
    if (rank === "K") return 0;
    if (rank === "A") return 1;
    if (rank === "J" || rank === "Q") return 10;
    return Number(rank);
  }

  private columnScore(a: Card, b: Card, rulesJson: any): number {
    if (rulesJson?.scoring?.columnMatchCancels && a.rank === b.rank) return 0;
    return this.cardValue(a.rank, rulesJson) + this.cardValue(b.rank, rulesJson);
  }

  private totalGridScore(grid: Record<GridPos, DealtCard>, rulesJson: any): number {
    let total = 0;
    for (const [t, b] of COLS) total += this.columnScore(grid[t].card, grid[b].card, rulesJson);
    return total;
  }

  // =========================
  // GAME_STATE
  // =========================

  private makeGameStateMessage(viewerPlayerId: string | null): ServerToClient {
    const tableId = this.table.config?.tableId ?? this.table.internalId;
    const status: TableStatus = this.table.config?.status ?? "open";
    const g = this.table.game;
    const cfg = this.table.config;

    const rulesJson = cfg?.rulesJson ?? {};
    const mode: "holes" | "points" = rulesJson?.endConditions?.mode === "points" ? "points" : "holes";

    const pointsTarget =
      mode === "points" && typeof rulesJson?.endConditions?.pointsTarget === "number"
        ? rulesJson.endConditions.pointsTarget
        : null;

    // rankValues (for UI)
    const rv = rulesJson?.scoring?.rankValues ?? {};
    const rankValues: Record<Rank, number> = {
      A: typeof rv.A === "number" ? rv.A : 1,
      "2": typeof rv["2"] === "number" ? rv["2"] : -2,
      "3": typeof rv["3"] === "number" ? rv["3"] : 3,
      "4": typeof rv["4"] === "number" ? rv["4"] : 4,
      "5": typeof rv["5"] === "number" ? rv["5"] : 5,
      "6": typeof rv["6"] === "number" ? rv["6"] : 6,
      "7": typeof rv["7"] === "number" ? rv["7"] : 7,
      "8": typeof rv["8"] === "number" ? rv["8"] : 8,
      "9": typeof rv["9"] === "number" ? rv["9"] : 9,
      "10": typeof rv["10"] === "number" ? rv["10"] : 10,
      J: typeof rv.J === "number" ? rv.J : 10,
      Q: typeof rv.Q === "number" ? rv.Q : 10,
      K: typeof rv.K === "number" ? rv.K : 0,
    };

    const playersPayload =
      this.table.players.map((p) => {
        const pg = g ? g.players.get(p.playerId) : null;
        const slots: VisibleSlot[] = ALL_POS.map((pos) => {
          if (!pg) return { pos, visible: false, card: null };
          const visible = pg.grid[pos].revealed;
          return { pos, visible, card: visible ? pg.grid[pos].card : null };
        });

        return {
          playerId: p.playerId,
          email: p.email,
          grid: slots,
          faceDownCount: pg ? this.faceDownCount(pg) : 0,
          initialRevealsRemaining: pg ? pg.initialRevealsRemaining : 0,
        };
      });

    const youPg = viewerPlayerId && g ? g.players.get(viewerPlayerId) : null;

    const you =
      viewerPlayerId && youPg
        ? {
            playerId: viewerPlayerId,
            grid: ALL_POS.map((pos) => {
              const visible = youPg.grid[pos].revealed;
              return { pos, visible, card: visible ? youPg.grid[pos].card : null };
            }),
            faceDownCount: this.faceDownCount(youPg),
            isYourTurn: !!g && g.currentTurnPlayerId === viewerPlayerId,
            initialRevealsRemaining: youPg.initialRevealsRemaining,
          }
        : null;

    let pendingDraw: Card | null = null;
    if (g && viewerPlayerId && g.currentTurnPlayerId === viewerPlayerId && youPg) pendingDraw = youPg.pendingDraw;

    const lastRoundScores = g?.scoreMeta.lastRoundScores ?? null;
    const cumulativeScores = g ? g.scoreMeta.cumulativeScores : null;

    const matchOver = status === "ended";
    const winners = g?.scoreMeta.winners ?? null;
    const endedReason = g?.scoreMeta.endedReason ?? null;

    return {
      type: "GAME_STATE",
      payload: {
        tableId,
        status,
        phase: g ? "playing" : (cfg?.phase ?? "lobby"),

        rulesSummary: {
          mode,
          pointsTarget,
          maxRounds: mode === "holes" ? 9 : null,
          rankValues,
        },

        // Turn timer (for countdown UX)
        turnDeadlineMs: g?.turnDeadlineMs ?? null,
        turnTimeoutMs: g?.turnTimeoutMs ?? 0,


        round: g?.round ?? 1,
        maxRounds: g?.maxRounds ?? (mode === "holes" ? 9 : 9999),
        currentTurnPlayerId: g?.currentTurnPlayerId ?? null,

        drawCount: g?.shoe?.length ?? 0,
        discardTop: g?.discard && g.discard.length > 0 ? g.discard[g.discard.length - 1] : null,

        pendingDraw,

        finalTurnActive: !!g?.roundMeta?.finalTurnActive,
        finalTurnsRemainingCount: g?.roundMeta?.finalTurnsRemaining ? g.roundMeta.finalTurnsRemaining.size : 0,
        finalTurnTriggeredByPlayerId: g?.roundMeta?.triggeredByPlayerId ?? null,

        lastRoundScores,
        cumulativeScores,

        matchOver,
        winners,
        endedReason,

        you,
        players: playersPayload,
      },
    };
  }

// =========================
// Durable Object alarm
// =========================
async alarm(): Promise<void> {
  // 1) Try GC purge if table is stale/empty (existing behavior)
  // 2) Then handle turn timeout if a game is running
  try {
    // @ts-ignore
    if (typeof (this as any).tryPurgeIfStale === "function") {
      // @ts-ignore
      const purged = await (this as any).tryPurgeIfStale();
      if (purged) return;
    }
  } catch {
    // ignore and continue to turn timeout
  }

  try {
    // @ts-ignore
    if (typeof (this as any).handleTurnTimeoutIfDue === "function") {
      // @ts-ignore
      await (this as any).handleTurnTimeoutIfDue();
    }
  } catch {
    await this.state.storage.setAlarm(Date.now() + 5000);
  }
}
}

// =========================
// Small util helpers (unchanged)
// =========================

function json(obj: any, status: number) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

function readUserEmail(request: Request): string | null {
  const url = new URL(request.url);

  // Local dev convenience: allow ?dev_email=
  const host = url.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (isLocal) {
    const dev = (url.searchParams.get("dev_email") ?? "").trim();
    if (dev) return dev;
  }

  // Cloudflare Access (production)
  const accessEmail =
    request.headers.get("cf-access-authenticated-user-email") ||
    request.headers.get("Cf-Access-Authenticated-User-Email");
  if (accessEmail) return accessEmail.trim();

  // Internal Worker -> DO calls use a synthetic hostname.
  // Allow x-forwarded-email ONLY for that internal hop.
  if (host === "do.internal") {
    const fwd =
      request.headers.get("x-forwarded-email") ||
      request.headers.get("X-Forwarded-Email");
    return fwd ? fwd.trim() : null;
  }

  return null;
}

function makeStableId(email: string): string {
  return "p_" + simpleHash(email);
}

function makeEphemeralId(prefix: string): string {
  return prefix + "_" + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
}

function simpleHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}


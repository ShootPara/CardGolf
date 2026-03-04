/**
 * FILE: /worker/src/table_do.ts (REPLACE)
 *
 * Milestone 3:
 * - Round end trigger: when a player reveals their LAST face-down card (global reveal).
 * - Final turn: everyone gets one more turn. PASS disabled during final turn.
 * - After final turns: auto-reveal remaining face-down cards, score round, start next round or end game.
 *
 * Keeps your Rule #1/#2/#3 from milestone 2:
 * - Must do 2 initial reveals on your first turn before drawing
 * - SWAP reveals swapped-in card face-up and puts replaced card on discard face-up
 * - DISCARD_DRAWN requires revealing a face-down card, unless you have exactly 1 face-down left (then use PASS)
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
} from "./protocol";

export interface Env {
  TABLES: DurableObjectNamespace;
  cardgolf: D1Database;
}

type PlayerConn = { playerId: string; email: string; role: "player"; ws: WebSocket; joinedAt: string };
type SpectatorConn = { spectatorId: string; email: string; role: "spectator"; ws: WebSocket; joinedAt: string };

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
  initialRevealsRemaining: number; // starts at 2 each round
  pendingDraw: Card | null;
};

type RoundMeta = {
  finalTurnActive: boolean;
  finalTurnsRemaining: Set<string>; // playerIds who still need their “one more turn”
  triggeredByPlayerId: string | null;
};

type ScoreMeta = {
  lastRoundScores: Record<string, number> | null;
  cumulativeScores: Record<string, number>; // running totals for completed rounds
};

type GameState = {
  shoe: Card[];
  discard: Card[];
  players: Map<string, PlayerGame>;

  round: number;
  maxRounds: number;

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

      await this.env.cardgolf
        .prepare(`UPDATE tables SET status='started' WHERE table_id=?`)
        .bind(this.table.config.tableId)
        .run();

      this.table.config.status = "started";
      this.table.phase = "playing";

      if (!this.table.game) {
        this.table.game = this.buildNewGameFromRules(this.table.config.rulesJson, this.table.players);
      }

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
        this.table.players.push({ playerId, email: userEmail, role: "player", ws: server, joinedAt });
        this.bindSocket(server, { id: playerId, role, email: userEmail });

        this.send(server, {
          type: "WELCOME",
          payload: {
            tableId: this.table.config.tableId,
            you: { playerId, email: userEmail, role },
            ownerPlayerId: this.table.ownerPlayerId,
            spectatorChatAllowed: this.table.config.spectatorChatAllowed,
          },
        });
      } else {
        const spectatorId = makeEphemeralId("spec");
        const joinedAt = new Date().toISOString();
        this.table.spectators.push({ spectatorId, email: userEmail, role: "spectator", ws: server, joinedAt });
        this.bindSocket(server, { id: spectatorId, role, email: userEmail });

        this.send(server, {
          type: "WELCOME",
          payload: {
            tableId: this.table.config.tableId,
            you: { playerId: spectatorId, email: userEmail, role },
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
  // Message handling
  // =========================

  private bindSocket(ws: WebSocket, who: { id: string; role: Role; email: string }) {
    ws.addEventListener("message", (evt) => {
      const raw = typeof evt.data === "string" ? evt.data : "";
      const parsed = safeJsonParse<ClientToServer>(raw);
      if (!parsed.ok) return this.send(ws, { type: "ERROR", payload: { code: "BAD_JSON", message: "Invalid JSON" } });
      void this.onMessage(ws, who, parsed.value);
    });

    ws.addEventListener("close", () => void this.onClose(who));
    ws.addEventListener("error", () => void this.onClose(who));
  }

  private async onMessage(ws: WebSocket, who: { id: string; role: Role; email: string }, msg: ClientToServer) {
    switch (msg.type) {
      case "PING": return this.send(ws, { type: "PONG" });
      case "CHAT_SEND": return this.handleChat(ws, who, msg.payload?.text);

// owner controls
case "OWNER_DELEGATE": return this.handleOwnerDelegate(ws, who, (msg as any).payload?.toPlayerId);
case "MUTE": return this.handleMute(ws, who, (msg as any).payload?.targetId, (msg as any).payload?.targetRole);
case "UNMUTE": return this.handleUnmute(ws, who, (msg as any).payload?.targetId, (msg as any).payload?.targetRole);
case "KICK": return this.handleKick(ws, who, (msg as any).payload?.targetId, (msg as any).payload?.targetRole);

      // gameplay
      case "DRAW_SHOE": return this.handleDraw(ws, who, "shoe");
      case "DRAW_DISCARD": return this.handleDraw(ws, who, "discard");
      case "SWAP": return this.handleSwap(ws, who, msg.payload?.pos);
      case "DISCARD_DRAWN": return this.handleDiscardDrawn(ws, who, msg.payload?.revealPos);
      case "PASS": return this.handlePass(ws, who);
      case "REVEAL": return this.handleReveal(ws, who, msg.payload?.pos);

      default:
        return this.err(ws, "UNKNOWN", "Unknown message type");
    }
  }

  private async onClose(who: { id: string; role: Role }) {
    if (who.role === "player") {
      const idx = this.table.players.findIndex((p) => p.playerId === who.id);
      if (idx >= 0) {
        const leaving = this.table.players[idx];
        this.table.players.splice(idx, 1);

        if (this.table.game) {
          this.table.game.turnOrder = this.table.game.turnOrder.filter((pid) => pid !== leaving.playerId);
          this.table.game.roundMeta.finalTurnsRemaining.delete(leaving.playerId);
          this.table.game.players.delete(leaving.playerId);

          if (this.table.game.currentTurnPlayerId === leaving.playerId) {
            this.advanceTurn();
          }
        }

        if (this.table.ownerPlayerId === leaving.playerId) {
          this.table.ownerPlayerId = this.table.players.length > 0 ? this.table.players[0].playerId : null;
        }
      }
    } else {
      const idx = this.table.spectators.findIndex((s) => s.spectatorId === who.id);
      if (idx >= 0) this.table.spectators.splice(idx, 1);
    }

    this.broadcastState();

    if (this.table.players.length === 0 && this.table.spectators.length === 0 && this.table.config) {
      const tableId = this.table.config.tableId;
      this.table.config = null;
      this.table.game = null;
      await this.env.cardgolf.prepare(`DELETE FROM tables WHERE table_id = ?`).bind(tableId).run();
    }
  }


/* =========================
 * Owner controls
 * ========================= */

private requireOwner(who: { id: string; role: Role }, ws: WebSocket): boolean {
  if (who.role !== "player") {
    this.err(ws, "FORBIDDEN", "Only a player can be the table owner.");
    return false;
  }
  const ownerId = this.table.ownerPlayerId ?? this.table.config?.creatorPlayerId ?? null;
  if (!ownerId || who.id !== ownerId) {
    this.err(ws, "FORBIDDEN", "Only the table owner can perform this action.");
    return false;
  }
  return true;
}

private handleOwnerDelegate(ws: WebSocket, who: { id: string; role: Role }, toPlayerId?: string) {
  if (!this.requireOwner(who, ws)) return;
  if (!toPlayerId) return this.err(ws, "BAD_REQUEST", "toPlayerId required.");

  const exists = this.table.players.some((p) => p.playerId === toPlayerId);
  if (!exists) return this.err(ws, "NOT_FOUND", "Target player not found/connected.");

  this.table.ownerPlayerId = toPlayerId;
  this.broadcastState();
}

private handleMute(ws: WebSocket, who: { id: string; role: Role }, targetId?: string, targetRole?: Role) {
  if (!this.requireOwner(who, ws)) return;
  if (!targetId || !targetRole) return this.err(ws, "BAD_REQUEST", "targetId + targetRole required.");

  if (targetRole === "player") this.table.mutedPlayers.add(targetId);
  else this.table.mutedSpectators.add(targetId);

  this.broadcastState();
}

private handleUnmute(ws: WebSocket, who: { id: string; role: Role }, targetId?: string, targetRole?: Role) {
  if (!this.requireOwner(who, ws)) return;
  if (!targetId || !targetRole) return this.err(ws, "BAD_REQUEST", "targetId + targetRole required.");

  if (targetRole === "player") this.table.mutedPlayers.delete(targetId);
  else this.table.mutedSpectators.delete(targetId);

  this.broadcastState();
}

private handleKick(ws: WebSocket, who: { id: string; role: Role }, targetId?: string, targetRole?: Role) {
  if (!this.requireOwner(who, ws)) return;
  if (!targetId || !targetRole) return this.err(ws, "BAD_REQUEST", "targetId + targetRole required.");

  if (targetRole === "player") {
    const target = this.table.players.find((p) => p.playerId === targetId);
    if (!target) return this.err(ws, "NOT_FOUND", "Player not found.");

    try { target.ws.close(4001, "Kicked by owner"); } catch {}
    this.table.players = this.table.players.filter((p) => p.playerId !== targetId);

    // If owner kicked themself (rare), reassign to first remaining player
    if (this.table.ownerPlayerId === targetId) {
      this.table.ownerPlayerId = this.table.players.length > 0 ? this.table.players[0].playerId : null;
    }
  } else {
    const target = this.table.spectators.find((s) => s.spectatorId === targetId);
    if (!target) return this.err(ws, "NOT_FOUND", "Spectator not found.");

    try { target.ws.close(4001, "Kicked by owner"); } catch {}
    this.table.spectators = this.table.spectators.filter((s) => s.spectatorId !== targetId);
  }

  this.broadcastState();
}

  // =========================
  // Gameplay rules
  // =========================

  private requireStartedPlayer(who: { id: string; role: Role }, ws: WebSocket): PlayerGame | null {
    if (who.role !== "player") { this.err(ws, "FORBIDDEN", "Only players can do gameplay actions."); return null; }
    if (!this.table.config || this.table.config.status !== "started") { this.err(ws, "BAD_STATE", "Game not started."); return null; }
    if (!this.table.game) { this.err(ws, "BAD_STATE", "Game state missing."); return null; }
    const pg = this.table.game.players.get(who.id);
    if (!pg) { this.err(ws, "NOT_FOUND", "Player not found in game."); return null; }
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
    if (order.length === 0) { g.currentTurnPlayerId = null; return; }
    const cur = g.currentTurnPlayerId;
    if (!cur) { g.currentTurnPlayerId = order[0]; return; }
    const idx = order.indexOf(cur);
    g.currentTurnPlayerId = idx >= 0 ? order[(idx + 1) % order.length] : order[0];
  }

  private maybeTriggerFinalTurn(playerId: string) {
    const g = this.table.game;
    if (!g) return;

    if (g.roundMeta.finalTurnActive) return;

    const pg = g.players.get(playerId);
    if (!pg) return;

    if (this.faceDownCount(pg) !== 0) return;

    // Trigger final turn for everyone
    g.roundMeta.finalTurnActive = true;
    g.roundMeta.triggeredByPlayerId = playerId;

    g.roundMeta.finalTurnsRemaining = new Set<string>(g.turnOrder);

    // PASS is disabled during final turn (we enforce in handlePass)
  }

  private endTurnForPlayer(playerId: string) {
    const g = this.table.game;
    if (!g) return;

    // If final turn active, mark this player's “one more turn” as used
    if (g.roundMeta.finalTurnActive) {
      g.roundMeta.finalTurnsRemaining.delete(playerId);

      // If everybody has taken their final turn, resolve the round now
      if (g.roundMeta.finalTurnsRemaining.size === 0) {
        this.resolveRoundAndMaybeStartNext();
        return;
      }
    }

    // Normal advance
    this.advanceTurn();
  }

  private resolveRoundAndMaybeStartNext() {
    const g = this.table.game;
    const cfg = this.table.config;
    if (!g || !cfg) return;

    // Auto-reveal all remaining face-down cards
    for (const pid of g.turnOrder) {
      const pg = g.players.get(pid);
      if (!pg) continue;
      for (const pos of ALL_POS) pg.grid[pos].revealed = true;
    }

    // Score
    const last: Record<string, number> = {};
    for (const pid of g.turnOrder) {
      const pg = g.players.get(pid);
      if (!pg) continue;
      const s = this.totalGridScore(pg.grid, cfg.rulesJson);
      last[pid] = s;
      g.scoreMeta.cumulativeScores[pid] = (g.scoreMeta.cumulativeScores[pid] ?? 0) + s;
    }
    g.scoreMeta.lastRoundScores = last;

    // Round increment / end game
    if (g.round >= g.maxRounds) {
      // End match
      if (this.table.config) this.table.config.status = "ended";
      this.table.phase = "playing"; // UI can still show board + scores

      // Best-effort persist ended status
      void this.env.cardgolf
        .prepare(`UPDATE tables SET status='ended' WHERE table_id=?`)
        .bind(cfg.tableId)
        .run();

      this.broadcast({ type: "GAME_ENDED", payload: { tableId: cfg.tableId } } as ServerToClient);
      this.broadcastGameState();
      this.broadcastState();
      return;
    }

    // Start next round (fresh shuffle + deal; reset per-player state)
    g.round += 1;

    const deckCount = Number(cfg.rulesJson?.gameVariant?.deckCount ?? 2);

    g.shoe = this.buildShoe(deckCount);
    this.shuffleInPlace(g.shoe);
    g.discard = [];

    for (const pid of g.turnOrder) {
      const pg = g.players.get(pid);
      if (!pg) continue;

      // deal new 6
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

    // Start at first player again (keeps it simple; can rotate later)
    g.currentTurnPlayerId = g.turnOrder.length > 0 ? g.turnOrder[0] : null;

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

    // Consume initial reveals quota
    if (pg.initialRevealsRemaining > 0) pg.initialRevealsRemaining--;

    // Trigger final turn if this was their last face-down
    this.maybeTriggerFinalTurn(who.id);

    this.broadcastGameState();
    this.broadcastState();
  }

  private handleDraw(ws: WebSocket, who: { id: string; role: Role }, from: "shoe" | "discard") {
    const pg = this.requireStartedPlayer(who, ws);
    const g = this.table.game;
    if (!pg || !g) return;

    if (!this.isPlayersTurn(who.id)) return this.err(ws, "NOT_YOUR_TURN", "It is not your turn.");
    if (!this.enforceInitialReveals(pg, ws)) return;

    if (pg.pendingDraw) return this.err(ws, "BAD_STATE", "You already drew a card this turn.");

    if (from === "shoe") {
      const c = g.shoe.pop();
      if (!c) return this.err(ws, "EMPTY_SHOE", "No cards left in shoe.");
      pg.pendingDraw = c;
    } else {
      const c = g.discard.pop();
      if (!c) return this.err(ws, "EMPTY_DISCARD", "Discard pile is empty.");
      pg.pendingDraw = c;
    }

    this.broadcastGameState();
  }

  private handleSwap(ws: WebSocket, who: { id: string; role: Role }, pos?: GridPos) {
    const pg = this.requireStartedPlayer(who, ws);
    const g = this.table.game;
    if (!pg || !g) return;

    if (!this.isPlayersTurn(who.id)) return this.err(ws, "NOT_YOUR_TURN", "It is not your turn.");
    if (!this.enforceInitialReveals(pg, ws)) return;

    if (!pg.pendingDraw) return this.err(ws, "BAD_STATE", "You must draw before swapping.");
    if (!pos || !ALL_POS.includes(pos)) return this.err(ws, "BAD_REQUEST", "pos must be 1..6.");

    const drawn = pg.pendingDraw;
    const old = pg.grid[pos].card;

    // old goes to discard face-up
    g.discard.push(old);

    // drawn becomes face-up in grid
    pg.grid[pos] = { card: drawn, revealed: true };
    pg.pendingDraw = null;

    // Trigger final-turn if this reveal completed their board
    this.maybeTriggerFinalTurn(who.id);

    // End turn
    this.endTurnForPlayer(who.id);

    this.broadcastGameState();
    this.broadcastState();
  }

  private handleDiscardDrawn(ws: WebSocket, who: { id: string; role: Role }, revealPos?: GridPos) {
    const pg = this.requireStartedPlayer(who, ws);
    const g = this.table.game;
    if (!pg || !g) return;

    if (!this.isPlayersTurn(who.id)) return this.err(ws, "NOT_YOUR_TURN", "It is not your turn.");
    if (!this.enforceInitialReveals(pg, ws)) return;

    if (!pg.pendingDraw) return this.err(ws, "BAD_STATE", "You must draw before discarding.");

    const fdBefore = this.faceDownCount(pg);

    // Always discard the drawn card
    g.discard.push(pg.pendingDraw);
    pg.pendingDraw = null;

    // Rule #3:
    // - If more than 1 face-down remains, you MUST reveal one face-down card (revealPos required)
    // - If exactly 1 face-down remains, you should use PASS to avoid ending; DISCARD_DRAWN without revealPos is not allowed.
    if (fdBefore > 1) {
      if (!revealPos || !ALL_POS.includes(revealPos)) {
        return this.err(ws, "MUST_REVEAL", "After discarding a drawn card, you must reveal one face-down card (revealPos).");
      }
      if (pg.grid[revealPos].revealed) {
        return this.err(ws, "BAD_REQUEST", "revealPos is already revealed.");
      }
      pg.grid[revealPos].revealed = true;

      // Reveal might trigger final turn if that was last face-down
      this.maybeTriggerFinalTurn(who.id);
    } else {
      // fdBefore === 1 (or 0, but 0 shouldn't happen mid-round)
      if (!revealPos) {
        return this.err(ws, "USE_PASS", "You have 1 face-down card left. Use PASS if you don’t want to reveal it.");
      }
      if (!ALL_POS.includes(revealPos) || pg.grid[revealPos].revealed) {
        return this.err(ws, "BAD_REQUEST", "Invalid revealPos for last card.");
      }
      pg.grid[revealPos].revealed = true;
      this.maybeTriggerFinalTurn(who.id);
    }

    // End turn
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
    if (!this.enforceInitialReveals(pg, ws)) return;

    // PASS disabled during final turn per endConditions and passRule.disabledDuringFinalTurn
    const passAllowedDuringFinalTurn = cfg.rulesJson?.endConditions?.roundEnd?.passAllowedDuringFinalTurn;
    const passRuleDisabledDuringFinal = cfg.rulesJson?.passRule?.disabledDuringFinalTurn;

    if (g.roundMeta.finalTurnActive && (passAllowedDuringFinalTurn === false || passRuleDisabledDuringFinal === true)) {
      return this.err(ws, "PASS_DISABLED", "Pass is disabled during the final turn.");
    }

    const passRule = cfg.rulesJson?.passRule ?? {};
    if (!passRule.enabled) return this.err(ws, "PASS_DISABLED", "Pass is disabled.");

    if (passRule.requiresDrawFirst && !pg.pendingDraw) {
      return this.err(ws, "BAD_STATE", "Pass requires drawing a card first.");
    }

    if (passRule.requiresExactlyOneFaceDown) {
      const fd = this.faceDownCount(pg);
      if (fd !== 1) return this.err(ws, "BAD_STATE", `Pass requires exactly 1 face-down card. You have ${fd}.`);
    }

    // PASS means: discard your drawn card without revealing last card
    g.discard.push(pg.pendingDraw!);
    pg.pendingDraw = null;

    // End turn
    this.endTurnForPlayer(who.id);

    this.broadcastGameState();
    this.broadcastState();
  }

  // =========================
  // Game creation + scoring
  // =========================

  private buildNewGameFromRules(rulesJson: any, connectedPlayers: PlayerConn[]): GameState {
    const deckCount = Number(rulesJson?.gameVariant?.deckCount ?? 2);
    const maxRounds = Number(rulesJson?.endConditions?.maxRounds ?? 9);

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

    // Seed discard with one face-up card (traditional: first player may draw discard immediately)
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
      roundMeta: {
        finalTurnActive: false,
        finalTurnsRemaining: new Set<string>(),
        triggeredByPlayerId: null,
      },
      scoreMeta: {
        lastRoundScores: null,
        cumulativeScores: cumulative,
      },
    };
  }

  private buildShoe(deckCount: number): Card[] {
    const ranks: Rank[] = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
    const suits: Suit[] = ["C","D","H","S"];

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
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
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
    // match = same rank (NOT same point value)
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

    const maxRounds = g?.maxRounds ?? Number(cfg?.rulesJson?.endConditions?.maxRounds ?? 9);

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

    return {
      type: "GAME_STATE",
      payload: {
        tableId,
        status,
        phase: this.table.phase,

        round: g?.round ?? 1,
        maxRounds,
        currentTurnPlayerId: g?.currentTurnPlayerId ?? null,

        drawCount: g?.shoe.length ?? 0,
        discardTop: g && g.discard.length > 0 ? g.discard[g.discard.length - 1] : null,

        pendingDraw,

        finalTurnActive: g?.roundMeta.finalTurnActive ?? false,
        finalTurnsRemainingCount: g?.roundMeta.finalTurnsRemaining.size ?? 0,
        finalTurnTriggeredByPlayerId: g?.roundMeta.triggeredByPlayerId ?? null,

        lastRoundScores,
        cumulativeScores,

        you,
        players: playersPayload,
      },
    };
  }

  private broadcastGameState() {
    for (const p of this.table.players) this.send(p.ws, this.makeGameStateMessage(p.playerId));
    for (const s of this.table.spectators) this.send(s.ws, this.makeGameStateMessage(null));
  }

  // =========================
  // TABLE_STATE + chat
  // =========================

  private broadcastState() {
    const spectatorChatAllowed = this.table.config ? this.table.config.spectatorChatAllowed : true;
    const tableId = this.table.config?.tableId ?? this.table.internalId;
    const status: TableStatus = this.table.config?.status ?? "open";

    const msg: ServerToClient = {
      type: "TABLE_STATE",
      payload: {
        tableId,
        status,
        phase: this.table.phase,
        ownerPlayerId: this.table.ownerPlayerId,
        players: this.table.players.map((p) => ({ playerId: p.playerId, email: p.email, joinedAt: p.joinedAt })),
        spectators: this.table.spectators.map((s) => ({ spectatorId: s.spectatorId, email: s.email, joinedAt: s.joinedAt })),
        mutedPlayers: Array.from(this.table.mutedPlayers),
        mutedSpectators: Array.from(this.table.mutedSpectators),
        spectatorChatAllowed,
      },
    };

    this.broadcast(msg);
  }

  private handleChat(ws: WebSocket, who: { id: string; role: Role; email: string }, text?: string) {
    if (!this.table.config) return this.err(ws, "NO_TABLE", "Table config not loaded.");
    if (!text) return this.err(ws, "BAD_REQUEST", "Missing chat text.");

    const trimmed = text.trim();
    if (!trimmed) return this.err(ws, "BAD_REQUEST", "Empty chat text.");
    if (trimmed.length > CHAT_MAX_LEN) return this.err(ws, "BAD_REQUEST", `Chat too long (max ${CHAT_MAX_LEN}).`);

    if (who.role === "spectator" && !this.table.config.spectatorChatAllowed) {
      return this.err(ws, "CHAT_DISABLED", "Spectator chat is disabled for this table.");
    }

    if (who.role === "player" && this.table.mutedPlayers.has(who.id)) return this.err(ws, "MUTED", "You are muted.");
    if (who.role === "spectator" && this.table.mutedSpectators.has(who.id)) return this.err(ws, "MUTED", "You are muted.");

    const now = Date.now();
    const last = this.lastChatAtBySocket.get(ws) ?? 0;
    if (now - last < CHAT_RATE_MS) return this.err(ws, "RATE_LIMIT", "Too fast.");
    this.lastChatAtBySocket.set(ws, now);

    const msg: ChatMessage = {
      id: makeEphemeralId("m"),
      ts: new Date().toISOString(),
      from: { id: who.id, role: who.role, email: who.email },
      text: trimmed,
    };

    this.table.chat.push(msg);
    if (this.table.chat.length > CHAT_MAX) this.table.chat.splice(0, this.table.chat.length - CHAT_MAX);

    this.broadcast({ type: "CHAT_APPEND", payload: { message: msg } });
  }

  private broadcast(msg: ServerToClient) {
    const s = JSON.stringify(msg);
    for (const p of this.table.players) safeSend(p.ws, s);
    for (const sp of this.table.spectators) safeSend(sp.ws, s);
  }

  private send(ws: WebSocket, msg: ServerToClient) {
    safeSend(ws, JSON.stringify(msg));
  }

  private err(ws: WebSocket, code: string, message: string) {
    this.send(ws, { type: "ERROR", payload: { code, message } });
  }

  // =========================
  // Config + routing helpers
  // =========================

  private getTableIdForThisRequest(url: URL): string | null {
    const param = (url.searchParams.get("table_id") ?? "").trim();
    if (param) return param;
    // @ts-ignore
    const name = (this.state.id as any)?.name;
    if (typeof name === "string" && name.trim()) return name.trim();
    return null;
  }

  private async ensureConfigLoaded(tableId: string) {
    if (this.table.config) return;

    const row = await this.env.cardgolf
      .prepare(`SELECT table_id, creator_player_id, rules_json, spectator_chat_allowed, status FROM tables WHERE table_id = ?`)
      .bind(tableId)
      .first<any>();

    if (!row) { this.table.config = null; return; }

    this.table.config = {
      tableId: row.table_id,
      creatorPlayerId: row.creator_player_id,
      rulesJson: JSON.parse(row.rules_json),
      spectatorChatAllowed: row.spectator_chat_allowed === 1,
      status: (row.status ?? "open") as TableStatus,
    };

    if (!this.table.ownerPlayerId) this.table.ownerPlayerId = this.table.config.creatorPlayerId;
    this.table.phase = this.table.config.status === "started" ? "playing" : "lobby";
  }

  private async refreshStatusFromD1(tableId: string) {
    if (!this.table.config) return;
    const row = await this.env.cardgolf.prepare(`SELECT status FROM tables WHERE table_id = ?`).bind(tableId).first<any>();
    this.table.config.status = (row?.status ?? "open") as TableStatus;
  }
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function safeSend(ws: WebSocket, data: string) {
  try { if (ws.readyState === 1) ws.send(data); } catch {}
}

function readUserEmail(req: Request): string | null {
  const url = new URL(req.url);
  const host = url.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (isLocal) {
    const devEmail = (url.searchParams.get("dev_email") ?? "").trim();
    if (devEmail) return devEmail;
  }
  const h =
    req.headers.get("cf-access-authenticated-user-email") ||
    req.headers.get("Cf-Access-Authenticated-User-Email") ||
    req.headers.get("x-forwarded-email") ||
    req.headers.get("X-Forwarded-Email");
  return h ? h.trim() : null;
}

function makeStableId(email: string): string {
  return "p_" + simpleHash(email.toLowerCase());
}

function makeEphemeralId(prefix: string): string {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function simpleHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}
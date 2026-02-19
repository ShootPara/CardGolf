/**
 * FILE: /worker/src/table_do.ts (REPLACE)
 *
 * Durable Object: one instance per table.
 * v0 backend skeleton:
 * - WebSocket join/leave
 * - owner: delegate, mute, kick
 * - spectators + spectator chat permission (default allow; later locked at create-table)
 * - ephemeral chat ring buffer (dies when table dies)
 *
 * Gameplay intentionally NOT implemented yet.
 */

import {
  safeJsonParse,
  type ClientToServer,
  type ServerToClient,
  type Role,
  type ChatMessage,
} from "./protocol";

/* =========================
   Env bindings
========================= */
export interface Env {
  TABLES: DurableObjectNamespace;
  cardgolf: D1Database; // D1 binding name from wrangler.jsonc
}

/* =========================
   Internal types
========================= */
type PlayerConn = {
  playerId: string;
  email: string;
  role: "player";
  ws: WebSocket;
  joinedAt: string;
};

type SpectatorConn = {
  spectatorId: string;
  email: string;
  role: "spectator";
  ws: WebSocket;
  joinedAt: string;
};

type TableState = {
  tableId: string;
  ownerPlayerId: string | null;

  // Join order matters for ownership transfer when owner leaves
  players: PlayerConn[];
  spectators: SpectatorConn[];

  mutedPlayers: Set<string>;
  mutedSpectators: Set<string>;

  spectatorChatAllowed: boolean; // set at table creation later; default allow for now
  phase: "lobby";

  // Ephemeral chat buffer (dies with DO)
  chat: ChatMessage[];
};

/* =========================
   Constants
========================= */
const CHAT_MAX = 200;
const CHAT_MAX_LEN = 280;
const CHAT_RATE_MS = 1000;

/* =========================
   Durable Object
========================= */
export class TableDO {
  private state: DurableObjectState;
  private env: Env;

  private table: TableState;

  private lastChatAtBySocket = new WeakMap<WebSocket, number>();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;

    const tableId = state.id.toString();

    this.table = {
      tableId,
      ownerPlayerId: null,
      players: [],
      spectators: [],
      mutedPlayers: new Set(),
      mutedSpectators: new Set(),
      spectatorChatAllowed: true,
      phase: "lobby",
      chat: [],
    };
  }

  /* =========================
     DO fetch
  ========================= */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== "/ws") {
      return new Response("Not found", { status: 404 });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const userEmail = readUserEmail(request);
    if (!userEmail) {
      return json(
        { ok: false, error: "Missing authenticated email (Access header) or dev_email on localhost" },
        401
      );
    }

    const roleParam = (url.searchParams.get("role") ?? "player") as Role;
    const role: Role = roleParam === "spectator" ? "spectator" : "player";

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    if (role === "player") {
      const playerId = makeStableId(userEmail);
      const joinedAt = new Date().toISOString();

      // Add connection
      this.table.players.push({
        playerId,
        email: userEmail,
        role: "player",
        ws: server,
        joinedAt,
      });

      // First player becomes owner
      if (!this.table.ownerPlayerId) {
        this.table.ownerPlayerId = playerId;
      }

      this.bindSocket(server, { id: playerId, role, email: userEmail });

      // Welcome + initial chat + state
      this.send(server, {
        type: "WELCOME",
        payload: {
          tableId: this.table.tableId,
          you: { playerId, email: userEmail, role },
          ownerPlayerId: this.table.ownerPlayerId,
          spectatorChatAllowed: this.table.spectatorChatAllowed,
        },
      });
    } else {
      const spectatorId = makeEphemeralId("spec");
      const joinedAt = new Date().toISOString();

      this.table.spectators.push({
        spectatorId,
        email: userEmail,
        role: "spectator",
        ws: server,
        joinedAt,
      });

      this.bindSocket(server, { id: spectatorId, role, email: userEmail });

      this.send(server, {
        type: "WELCOME",
        payload: {
          tableId: this.table.tableId,
          you: { playerId: spectatorId, email: userEmail, role },
          ownerPlayerId: this.table.ownerPlayerId,
          spectatorChatAllowed: this.table.spectatorChatAllowed,
        },
      });
    }

    // Send current chat buffer
    this.send(server, { type: "CHAT_STATE", payload: { messages: this.table.chat } });

    // Broadcast updated state to everyone
    this.broadcastState();

    return new Response(null, { status: 101, webSocket: client });
  }

  /* =========================
     Socket handlers
  ========================= */
  private bindSocket(ws: WebSocket, who: { id: string; role: Role; email: string }) {
    ws.addEventListener("message", (evt) => {
      const raw = typeof evt.data === "string" ? evt.data : "";
      const parsed = safeJsonParse<ClientToServer>(raw);
      if (!parsed.ok) {
        return this.send(ws, { type: "ERROR", payload: { code: "BAD_JSON", message: "Invalid JSON" } });
      }
      void this.onMessage(ws, who, parsed.value);
    });

    ws.addEventListener("close", () => this.onClose(who));
    ws.addEventListener("error", () => this.onClose(who));
  }

  private async onMessage(ws: WebSocket, who: { id: string; role: Role; email: string }, msg: ClientToServer) {
    switch (msg.type) {
      case "PING":
        return this.send(ws, { type: "PONG" });

      case "CHAT_SEND":
        return this.handleChat(ws, who, msg.payload?.text);

      case "OWNER_DELEGATE":
        return this.handleOwnerDelegate(ws, who, msg.payload?.toPlayerId);

      case "MUTE":
        return this.handleMute(ws, who, msg.payload?.targetId, msg.payload?.targetRole);

      case "UNMUTE":
        return this.handleUnmute(ws, who, msg.payload?.targetId, msg.payload?.targetRole);

      case "KICK":
        return this.handleKick(ws, who, msg.payload?.targetId, msg.payload?.targetRole);

      case "HELLO":
        return; // reserved for future versioning

      default:
        return this.err(ws, "UNKNOWN", "Unknown message type");
    }
  }

  private onClose(who: { id: string; role: Role; email: string }) {
    if (who.role === "player") {
      const idx = this.table.players.findIndex((p) => p.playerId === who.id);
      if (idx >= 0) {
        const leaving = this.table.players[idx];
        this.table.players.splice(idx, 1);

        // Ownership transfer if owner left
        if (this.table.ownerPlayerId === leaving.playerId) {
          this.table.ownerPlayerId = this.table.players.length > 0 ? this.table.players[0].playerId : null;
        }
      }
    } else {
      const idx = this.table.spectators.findIndex((s) => s.spectatorId === who.id);
      if (idx >= 0) this.table.spectators.splice(idx, 1);
    }

    this.broadcastState();
  }

  /* =========================
     Owner controls
  ========================= */
  private isOwner(who: { id: string; role: Role }) {
    return who.role === "player" && this.table.ownerPlayerId === who.id;
  }

  private handleOwnerDelegate(ws: WebSocket, who: { id: string; role: Role }, toPlayerId?: string) {
    if (!this.isOwner(who)) return this.err(ws, "NOT_OWNER", "Only the table owner can delegate ownership.");
    if (!toPlayerId) return this.err(ws, "BAD_REQUEST", "Missing toPlayerId.");

    const isActivePlayer = this.table.players.some((p) => p.playerId === toPlayerId);
    if (!isActivePlayer) return this.err(ws, "BAD_REQUEST", "Target must be an active player (not spectator).");

    this.table.ownerPlayerId = toPlayerId;
    this.broadcastState();
  }

  private handleMute(ws: WebSocket, who: { id: string; role: Role }, targetId?: string, targetRole?: Role) {
    if (!this.isOwner(who)) return this.err(ws, "NOT_OWNER", "Only the table owner can mute.");
    if (!targetId || !targetRole) return this.err(ws, "BAD_REQUEST", "Missing target.");

    if (targetRole === "player") this.table.mutedPlayers.add(targetId);
    else this.table.mutedSpectators.add(targetId);

    this.broadcastState();
  }

  private handleUnmute(ws: WebSocket, who: { id: string; role: Role }, targetId?: string, targetRole?: Role) {
    if (!this.isOwner(who)) return this.err(ws, "NOT_OWNER", "Only the table owner can unmute.");
    if (!targetId || !targetRole) return this.err(ws, "BAD_REQUEST", "Missing target.");

    if (targetRole === "player") this.table.mutedPlayers.delete(targetId);
    else this.table.mutedSpectators.delete(targetId);

    this.broadcastState();
  }

  private handleKick(ws: WebSocket, who: { id: string; role: Role }, targetId?: string, targetRole?: Role) {
    if (!this.isOwner(who)) return this.err(ws, "NOT_OWNER", "Only the table owner can kick.");
    if (!targetId || !targetRole) return this.err(ws, "BAD_REQUEST", "Missing target.");

    // Owner cannot kick themselves
    if (targetRole === "player" && targetId === this.table.ownerPlayerId) {
      return this.err(ws, "BAD_REQUEST", "Owner cannot kick themselves.");
    }

    if (targetRole === "player") {
      const idx = this.table.players.findIndex((p) => p.playerId === targetId);
      if (idx < 0) return this.err(ws, "NOT_FOUND", "Player not found.");
      const victim = this.table.players[idx];
      try {
        victim.ws.close(4000, "Kicked by owner");
      } catch {}
      this.table.players.splice(idx, 1);
    } else {
      const idx = this.table.spectators.findIndex((s) => s.spectatorId === targetId);
      if (idx < 0) return this.err(ws, "NOT_FOUND", "Spectator not found.");
      const victim = this.table.spectators[idx];
      try {
        victim.ws.close(4000, "Kicked by owner");
      } catch {}
      this.table.spectators.splice(idx, 1);
    }

    // If ownership became invalid for any reason, transfer to oldest remaining player
    if (this.table.ownerPlayerId && !this.table.players.some((p) => p.playerId === this.table.ownerPlayerId)) {
      this.table.ownerPlayerId = this.table.players.length > 0 ? this.table.players[0].playerId : null;
    }

    this.broadcastState();
  }

  /* =========================
     Chat
  ========================= */
  private handleChat(ws: WebSocket, who: { id: string; role: Role; email: string }, text?: string) {
    if (!text) return this.err(ws, "BAD_REQUEST", "Missing chat text.");

    const trimmed = text.trim();
    if (!trimmed) return this.err(ws, "BAD_REQUEST", "Empty chat text.");
    if (trimmed.length > CHAT_MAX_LEN) return this.err(ws, "BAD_REQUEST", `Chat too long (max ${CHAT_MAX_LEN}).`);

    if (who.role === "spectator" && !this.table.spectatorChatAllowed) {
      return this.err(ws, "CHAT_DISABLED", "Spectator chat is disabled for this table.");
    }

    if (who.role === "player" && this.table.mutedPlayers.has(who.id)) return this.err(ws, "MUTED", "You are muted.");
    if (who.role === "spectator" && this.table.mutedSpectators.has(who.id)) return this.err(ws, "MUTED", "You are muted.");

    // Rate limit per socket
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
    if (this.table.chat.length > CHAT_MAX) {
      this.table.chat.splice(0, this.table.chat.length - CHAT_MAX);
    }

    this.broadcast({ type: "CHAT_APPEND", payload: { message: msg } });
  }

  /* =========================
     Broadcast helpers
  ========================= */
  private broadcastState() {
    const msg: ServerToClient = {
      type: "TABLE_STATE",
      payload: {
        tableId: this.table.tableId,
        phase: this.table.phase,
        ownerPlayerId: this.table.ownerPlayerId,
        players: this.table.players.map((p) => ({ playerId: p.playerId, email: p.email, joinedAt: p.joinedAt })),
        spectators: this.table.spectators.map((s) => ({ spectatorId: s.spectatorId, email: s.email, joinedAt: s.joinedAt })),
        mutedPlayers: Array.from(this.table.mutedPlayers),
        mutedSpectators: Array.from(this.table.mutedSpectators),
        spectatorChatAllowed: this.table.spectatorChatAllowed,
      },
    };
    this.broadcast(msg);
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
}

/* =========================
   Utility helpers
========================= */
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function safeSend(ws: WebSocket, data: string) {
  try {
    if (ws.readyState === 1) ws.send(data);
  } catch {}
}

function readUserEmail(req: Request): string | null {
  const url = new URL(req.url);

  // Local dev bypass: browsers can't set WS headers.
  const host = url.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";

  if (isLocal) {
    const devEmail = (url.searchParams.get("dev_email") ?? "").trim();
    if (devEmail) return devEmail;
  }

  // Production: Cloudflare Access header
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
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

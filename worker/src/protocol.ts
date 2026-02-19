/**
 * FILE: /worker/src/protocol.ts (NEW)
 *
 * Shared WS message shapes for the table Durable Object.
 * Keep this small and strict; the server remains authoritative.
 */

/* =========================
   Types
========================= */

export type Role = "player" | "spectator";

export type ClientToServer =
  | { type: "HELLO"; payload: { role: Role } }
  | { type: "CHAT_SEND"; payload: { text: string } }
  | { type: "OWNER_DELEGATE"; payload: { toPlayerId: string } }
  | { type: "MUTE"; payload: { targetId: string; targetRole: Role } }
  | { type: "UNMUTE"; payload: { targetId: string; targetRole: Role } }
  | { type: "KICK"; payload: { targetId: string; targetRole: Role } }
  | { type: "PING" };

export type ServerToClient =
  | {
      type: "WELCOME";
      payload: {
        tableId: string;
        you: { playerId: string; email: string; role: Role };
        ownerPlayerId: string | null;
        spectatorChatAllowed: boolean;
      };
    }
  | {
      type: "TABLE_STATE";
      payload: {
        tableId: string;
        phase: "lobby";
        ownerPlayerId: string | null;
        players: Array<{ playerId: string; email: string; joinedAt: string }>;
        spectators: Array<{ spectatorId: string; email: string; joinedAt: string }>;
        mutedPlayers: string[];
        mutedSpectators: string[];
        spectatorChatAllowed: boolean;
      };
    }
  | {
      type: "CHAT_STATE";
      payload: { messages: ChatMessage[] };
    }
  | {
      type: "CHAT_APPEND";
      payload: { message: ChatMessage };
    }
  | { type: "ERROR"; payload: { code: string; message: string } }
  | { type: "PONG" };

export type ChatMessage = {
  id: string;
  ts: string; // ISO
  from: { id: string; role: Role; email: string };
  text: string;
};

/* =========================
   Helpers
========================= */

export function safeJsonParse<T = any>(s: string): { ok: true; value: T } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(s) as T };
  } catch {
    return { ok: false };
  }
}

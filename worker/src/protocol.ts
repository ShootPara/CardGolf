/**
 * FILE: /worker/src/protocol.ts (REPLACE)
 *
 * Milestone 3:
 * - GAME_STATE includes round-end / final-turn info + scores.
 * - PASS disabled during final turn (server-enforced).
 */

export type Role = "player" | "spectator";

export type TableStatus = "open" | "started" | "ended";
export type TablePhase = "lobby" | "playing";

export type Suit = "C" | "D" | "H" | "S";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";

export type Card = {
  id: string;
  rank: Rank;
  suit: Suit;
};

export type GridPos = 1 | 2 | 3 | 4 | 5 | 6;

export type VisibleSlot = {
  pos: GridPos;
  visible: boolean;
  card: Card | null;
};

/* =========================
   Client -> Server
========================= */

export type ClientToServer =
  | { type: "HELLO"; payload: { role: Role } }
  | { type: "CHAT_SEND"; payload: { text: string } }
  | { type: "OWNER_DELEGATE"; payload: { toPlayerId: string } }
  | { type: "MUTE"; payload: { targetId: string; targetRole: Role } }
  | { type: "UNMUTE"; payload: { targetId: string; targetRole: Role } }
  | { type: "KICK"; payload: { targetId: string; targetRole: Role } }
  | { type: "PING" }
  // Turn loop
  | { type: "DRAW_SHOE" }
  | { type: "DRAW_DISCARD" }
  | { type: "SWAP"; payload: { pos: GridPos } }
  // Discarding a drawn card requires revealing a face-down card unless you use PASS when you have exactly 1 face-down left
  | { type: "DISCARD_DRAWN"; payload?: { revealPos?: GridPos } }
  | { type: "PASS" }
  // Global reveal
  | { type: "REVEAL"; payload: { pos: GridPos } };

/* =========================
   Server -> Client
========================= */

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
        status: TableStatus;
        phase: TablePhase;
        ownerPlayerId: string | null;
        players: Array<{ playerId: string; email: string; joinedAt: string }>;
        spectators: Array<{ spectatorId: string; email: string; joinedAt: string }>;
        mutedPlayers: string[];
        mutedSpectators: string[];
        spectatorChatAllowed: boolean;
      };
    }
  | {
      type: "GAME_STATE";
      payload: {
        tableId: string;
        status: TableStatus;
        phase: TablePhase;

        round: number;
        maxRounds: number;
        currentTurnPlayerId: string | null;

        drawCount: number;
        discardTop: Card | null;

        // Only active player sees this
        pendingDraw: Card | null;

        // Final-turn / round end
        finalTurnActive: boolean;
        finalTurnsRemainingCount: number;
        finalTurnTriggeredByPlayerId: string | null;

        // Scores (present only right after round resolves; we keep them available for UI)
        lastRoundScores: Record<string, number> | null;      // playerId -> score
        cumulativeScores: Record<string, number> | null;     // playerId -> total across rounds completed

        you: {
          playerId: string;
          grid: VisibleSlot[];
          faceDownCount: number;
          isYourTurn: boolean;
          initialRevealsRemaining: number;
        } | null;

        players: Array<{
          playerId: string;
          email: string;
          grid: VisibleSlot[];
          faceDownCount: number;
          initialRevealsRemaining: number;
        }>;
      };
    }
  | { type: "CHAT_STATE"; payload: { messages: ChatMessage[] } }
  | { type: "CHAT_APPEND"; payload: { message: ChatMessage } }
  | { type: "GAME_STARTED"; payload: { tableId: string } }
  | { type: "GAME_ENDED"; payload: { tableId: string } }
  | { type: "ERROR"; payload: { code: string; message: string } }
  | { type: "PONG" };

export type ChatMessage = {
  id: string;
  ts: string;
  from: { id: string; role: Role; email: string };
  text: string;
};

export function safeJsonParse<T = any>(s: string): { ok: true; value: T } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(s) as T };
  } catch {
    return { ok: false };
  }
}
// FILE: /apps/web/src/lib/cgTypes.ts (NEW)
//
// CardGolf minimal shared types for UI.
// Keep this small + tolerant; the server is source-of-truth.
// We'll expand types as needed once we see real payload shapes.

export type PlayerId = string;
export type TableId = string;
export type GridPos = 1 | 2 | 3 | 4 | 5 | 6;

export type WsEnvelope =
  | { type: "WELCOME"; payload: any }
  | { type: "TABLE_STATE"; payload: any }
  | { type: "CHAT_STATE"; payload: any }
  | { type: "GAME_STATE"; payload: any }
  | { type: "ERROR"; payload?: any; error?: any }
  | { type: string; payload?: any; [k: string]: any };

export type UiPhase = "HOME" | "LOBBY" | "GAME";

export type DevSession = {
  devEmail: string;
  tableId?: string;
  role: "player" | "spectator";
};
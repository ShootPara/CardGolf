/**
 * FILE: /worker/src/golf_turn.ts (NEW)
 *
 * Helper utilities for:
 * - Removing a player from an in-progress game (disconnect/kick)
 * - Applying a safe turn-timeout action to keep the table moving
 *
 * Intentionally uses lightweight types to avoid circular imports.
 */

import type { GridPos, Card } from "./protocol";

export function removePlayerFromGame(g: any, playerId: string): { currentTurnWasRemoved: boolean } {
  if (!g) return { currentTurnWasRemoved: false };

  const currentTurnWasRemoved = g.currentTurnPlayerId === playerId;

  if (Array.isArray(g.turnOrder)) {
    g.turnOrder = g.turnOrder.filter((id: string) => id !== playerId);
  }

  if (g.players && typeof g.players.delete === "function") {
    g.players.delete(playerId);
  }

  if (g.roundMeta?.finalTurnsRemaining && typeof g.roundMeta.finalTurnsRemaining.delete === "function") {
    g.roundMeta.finalTurnsRemaining.delete(playerId);
  }

  if (currentTurnWasRemoved) {
    g.currentTurnPlayerId = null;
  }

  return { currentTurnWasRemoved };
}

export function pickFirstFaceDownPos(grid: any, allPos: GridPos[]): GridPos | null {
  for (const pos of allPos) {
    const slot = grid?.[pos];
    if (slot && slot.revealed === false) return pos;
  }
  return null;
}

export function applyTurnTimeoutAction(params: {
  g: any;
  playerId: string;
  allPos: GridPos[];
}): { didSomething: boolean; revealedCount: number; discardedDrawn: boolean } {
  const { g, playerId, allPos } = params;
  if (!g) return { didSomething: false, revealedCount: 0, discardedDrawn: false };

  const pg = g.players?.get ? g.players.get(playerId) : null;
  if (!pg) return { didSomething: false, revealedCount: 0, discardedDrawn: false };

  if (pg.pendingDraw) {
    g.discard?.push?.(pg.pendingDraw as Card);
    pg.pendingDraw = null;
    return { didSomething: true, revealedCount: 0, discardedDrawn: true };
  }

  let revealed = 0;

  if (typeof pg.initialRevealsRemaining === "number" && pg.initialRevealsRemaining > 0) {
    let remaining = pg.initialRevealsRemaining;
    while (remaining > 0) {
      const pos = pickFirstFaceDownPos(pg.grid, allPos);
      if (!pos) break;
      pg.grid[pos].revealed = true;
      remaining -= 1;
      revealed += 1;
    }
    pg.initialRevealsRemaining = Math.max(0, remaining);
    return { didSomething: revealed > 0, revealedCount: revealed, discardedDrawn: false };
  }

  const pos = pickFirstFaceDownPos(pg.grid, allPos);
  if (pos) {
    pg.grid[pos].revealed = true;
    revealed = 1;
    return { didSomething: true, revealedCount: 1, discardedDrawn: false };
  }

  return { didSomething: false, revealedCount: 0, discardedDrawn: false };
}

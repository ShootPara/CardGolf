/**
 * FILE: /worker/src/golf_deck.ts (NEW)
 *
 * Reshuffle rule:
 * - If shoe is empty and discard has >= 2 cards:
 *   - Keep discardTop as the last element
 *   - Move the rest into shoe
 *   - Shuffle shoe
 *   - Leave discard as [discardTop]
 *
 * Returns true if a reshuffle occurred.
 */

import type { Card } from "./protocol";

export function reshuffleDiscardIntoShoeKeepingTop(
  shoe: Card[],
  discard: Card[],
  shuffleInPlace: <T>(arr: T[]) => void
): boolean {
  if (shoe.length > 0) return false;

  // Need at least 2 discards: 1 to remain as top, >=1 to become the new shoe.
  if (discard.length < 2) return false;

  const top = discard[discard.length - 1];
  const rest = discard.slice(0, discard.length - 1);

  // Rebuild shoe from "rest" (top stays)
  shoe.push(...rest);
  discard.length = 0;
  discard.push(top);

  shuffleInPlace(shoe);
  return true;
}
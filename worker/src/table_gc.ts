/**
 * FILE: /worker/src/table_gc.ts (NEW)
 *
 * D1 hygiene:
 * - Purge a table row when it’s safe/desired (ended or abandoned).
 *
 * We keep this file tiny and defensive:
 * - Only touches the `tables` table.
 * - If schema changes later, failures are contained.
 */

import type { TableStatus } from "./protocol";

export type GcPolicy = {
  // If no connections and status==open, delete after this many ms
  ttlOpenMs: number;
  // If no connections and status==started, delete after this many ms
  ttlStartedMs: number;
  // If no connections and status==ended, delete after this many ms
  ttlEndedMs: number;
};

export const DEFAULT_GC_POLICY: GcPolicy = {
  ttlOpenMs: 30 * 60 * 1000,     // 30 minutes
  ttlStartedMs: 20 * 60 * 1000,  // 20 minutes (abandoned game)
  ttlEndedMs: 10 * 60 * 1000,    // 10 minutes after end
};

export function ttlForStatusMs(status: TableStatus, policy: GcPolicy): number {
  if (status === "ended") return policy.ttlEndedMs;
  if (status === "started") return policy.ttlStartedMs;
  return policy.ttlOpenMs;
}

export async function purgeTableRow(env: { cardgolf: D1Database }, tableId: string): Promise<void> {
  // Delete only the table config row. Players table keeps presets; do not touch it.
  await env.cardgolf.prepare(`DELETE FROM tables WHERE table_id=?`).bind(tableId).run();
}
// FILE: /apps/web/src/ui/PlayersPanel.tsx (NEW)
//
// Shows all players with a small grid + score.
// Uses GAME_STATE.players if available; otherwise falls back to TABLE_STATE.players.
// Safe for no-private-peeks: face-down cards should be represented without card faces.

import { PlayerGridSmall } from "./PlayerGridSmall";

type PlayersPanelProps = {
  tableState: any;
  gameState: any;
};

export function PlayersPanel({ tableState, gameState }: PlayersPanelProps) {
  const currentTurnPlayerId = gameState?.currentTurnPlayerId ?? null;

  const cumulativeScores = gameState?.cumulativeScores ?? gameState?.scoreMeta?.cumulativeScores ?? {};
  const lastRoundScores = gameState?.lastRoundScores ?? gameState?.scoreMeta?.lastRoundScores ?? null;

  const gsPlayers: any[] = Array.isArray(gameState?.players) ? gameState.players : [];
  const tsPlayers: any[] = Array.isArray(tableState?.players) ? tableState.players : [];

  // Merge by playerId, prefer GAME_STATE fields (like grid)
  const merged = (() => {
    const byId = new Map<string, any>();

    for (const p of tsPlayers) {
      if (!p?.playerId) continue;
      byId.set(p.playerId, { ...p });
    }
    for (const p of gsPlayers) {
      if (!p?.playerId) continue;
      const prev = byId.get(p.playerId) ?? {};
      byId.set(p.playerId, { ...prev, ...p });
    }
    // Also include "you" if server doesn't include players array
    const you = gameState?.you;
    if (you?.playerId && !byId.has(you.playerId)) {
      byId.set(you.playerId, { playerId: you.playerId, email: you.email, displayName: you.displayName ?? null, grid: you.grid });
    }
    return Array.from(byId.values());
  })();

  return (
    <div
      style={{
        borderRadius: 12,
        padding: 12,
        background: "#141414",
        border: "1px solid rgba(255,255,255,0.08)",
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ margin: 0 }}>Players</h3>
        <span style={{ opacity: 0.75, fontSize: 12 }}>
          {merged.length} players
        </span>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {merged.map((p) => {
          const pid = p?.playerId ?? "";
          const idx = tsPlayers.findIndex((pp) => pp?.playerId === pid);
          const fallback = idx >= 0 ? `Player ${idx + 1}` : "Player";
          const label = (p?.displayName ?? fallback) as string;
          const score = cumulativeScores?.[pid] ?? 0;
          const isTurn = pid && currentTurnPlayerId && pid === currentTurnPlayerId;

          return (
            <div
              key={pid || label}
              style={{
                borderRadius: 12,
                padding: 10,
                background: isTurn ? "#1b1b1b" : "#101010",
                border: "1px solid rgba(255,255,255,0.08)",
                display: "grid",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontWeight: 800 }}>
                  {label}
                  {isTurn ? <span style={{ marginLeft: 8, opacity: 0.8 }}>(turn)</span> : null}
                </div>
                <div style={{ opacity: 0.85 }}>Score: <strong>{score}</strong></div>
              </div>

              <PlayerGridSmall grid={p?.grid} />
            </div>
          );
        })}
      </div>

      {lastRoundScores ? (
        <div style={{ marginTop: 6, opacity: 0.9 }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Last round</div>
          <pre style={{ margin: 0, background: "#0f0f0f", padding: 10, borderRadius: 10, overflowX: "auto" }}>
{JSON.stringify(lastRoundScores, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

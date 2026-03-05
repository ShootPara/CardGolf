// FILE: /apps/web/src/ui/TableViewPanel.tsx (NEW)
//
// Bottom "table view" showing everyone's public grid.
// Collapsible but default expanded.

import { PlayerGridSmall } from "./PlayerGridSmall";

type TableViewPanelProps = {
  tableState: any;
  gameState: any;
};

export function TableViewPanel({ tableState, gameState }: TableViewPanelProps) {
  const players: any[] = Array.isArray(gameState?.players) ? gameState.players : [];
  const curPid = gameState?.currentTurnPlayerId ?? null;

  const tablePlayers: any[] = Array.isArray(tableState?.players) ? tableState.players : [];

  function labelFor(pid: string): string {
    const p = tablePlayers.find((pp) => pp?.playerId === pid);
    return (p?.displayName ?? p?.email ?? pid) as string;
  }

  function scoreFor(pid: string): string | null {
    const cumulative = gameState?.cumulativeScores ?? null;
    if (!cumulative) return null;
    const v = cumulative[pid];
    return typeof v === "number" ? String(v) : null;
  }

  return (
    <details
      open
      style={{
        borderRadius: 12,
        padding: 12,
        background: "#141414",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 900 }}>Table View</span>
        <span style={{ opacity: 0.7, fontSize: 12 }}>Everyone’s public cards</span>
      </summary>

      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          {players.map((p) => {
            const pid = p?.playerId;
            const isTurn = pid && pid === curPid;

            const faceDownCount = p?.faceDownCount ?? null;
            const score = pid ? scoreFor(pid) : null;

            return (
              <div
                key={pid}
                style={{
                  borderRadius: 12,
                  padding: 10,
                  background: isTurn ? "#1b1b1b" : "#101010",
                  border: isTurn ? "1px solid rgba(255,255,255,0.18)" : "1px solid rgba(255,255,255,0.08)",
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                  <div style={{ fontWeight: 900 }}>
                    {pid ? labelFor(pid) : "Player"}
                    {isTurn ? <span style={{ opacity: 0.8 }}> • turn</span> : null}
                  </div>
                  <div style={{ opacity: 0.75, fontSize: 12 }}>
                    {faceDownCount != null ? `down: ${faceDownCount}` : ""}
                    {score != null ? ` • score: ${score}` : ""}
                  </div>
                </div>

                <PlayerGridSmall grid={p?.grid} />
              </div>
            );
          })}
        </div>

        <div style={{ opacity: 0.6, fontSize: 12 }}>
          Face-down cards stay hidden until revealed. This view is what everyone at the table can see.
        </div>
      </div>
    </details>
  );
}
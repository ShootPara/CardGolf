// FILE: /apps/web/src/ui/GameStatusBar.tsx (NEW)
//
// Compact status bar: round, turn owner, final-turn banner.

type GameStatusBarProps = {
  tableState: any;
  gameState: any;
};

export function GameStatusBar({ tableState, gameState }: GameStatusBarProps) {
  const round = gameState?.round ?? "?";
  const maxRounds = gameState?.maxRounds ?? "?";
  const finalTurnActive = !!gameState?.finalTurnActive;
  const finalTurnsRemainingCount = gameState?.finalTurnsRemainingCount ?? 0;

  const curPid = gameState?.currentTurnPlayerId ?? null;

  const players: any[] = Array.isArray(tableState?.players) ? tableState.players : [];
  const cur = players.find((p) => p?.playerId === curPid) ?? null;
  const curLabel = cur?.email ?? curPid ?? "—";

  return (
    <div
      style={{
        borderRadius: 12,
        padding: 12,
        background: "#141414",
        border: "1px solid rgba(255,255,255,0.08)",
        display: "flex",
        gap: 16,
        alignItems: "center",
        flexWrap: "wrap",
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "baseline" }}>
        <div>
          <span style={{ opacity: 0.8 }}>Round</span>{" "}
          <strong>{round}</strong>
          <span style={{ opacity: 0.6 }}> / {maxRounds}</span>
        </div>

        <div>
          <span style={{ opacity: 0.8 }}>Turn</span>{" "}
          <strong>{curLabel}</strong>
        </div>
      </div>

      {finalTurnActive ? (
        <div
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            background: "#1b1b1b",
            border: "1px solid rgba(255,255,255,0.10)",
            fontWeight: 800,
          }}
        >
          Final turn • remaining: {finalTurnsRemainingCount}
        </div>
      ) : (
        <div style={{ opacity: 0.65, fontSize: 12 }}>Normal play</div>
      )}
    </div>
  );
}

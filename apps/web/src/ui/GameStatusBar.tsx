import { useEffect, useState } from "react";

// FILE: /apps/web/src/ui/GameStatusBar.tsx (REPLACE)
//
// Changes:
// - Show mode:
//   - holes: "Round X / 9"
//   - points: "Points game • target: N"
// - When matchOver: show winners (by email) + reason

type GameStatusBarProps = {
  tableState: any;
  gameState: any;
};

export function GameStatusBar({ tableState, gameState }: GameStatusBarProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);

  const rules = gameState?.rulesSummary ?? {};
  const mode = rules?.mode === "points" ? "points" : "holes";
  const pointsTarget = typeof rules?.pointsTarget === "number" ? rules.pointsTarget : null;

  const round = gameState?.round ?? "?";
  const maxRounds = gameState?.maxRounds ?? "?";

  const finalTurnActive = !!gameState?.finalTurnActive;
  const finalTurnsRemainingCount = gameState?.finalTurnsRemainingCount ?? 0;

  const curPid = gameState?.currentTurnPlayerId ?? null;

  const players: any[] = Array.isArray(tableState?.players) ? tableState.players : [];
  const cur = players.find((p) => p?.playerId === curPid) ?? null;
  const curLabel = cur?.email ?? curPid ?? "—";

  const matchOver = !!gameState?.matchOver || gameState?.status === "ended";
const turnDeadlineMs: number | null =
  typeof gameState?.turnDeadlineMs === "number" ? gameState.turnDeadlineMs : null;
const turnTimeoutMs: number =
  typeof gameState?.turnTimeoutMs === "number" ? gameState.turnTimeoutMs : 0;

const secsLeft =
  !matchOver && turnDeadlineMs ? Math.max(0, Math.ceil((turnDeadlineMs - nowMs) / 1000)) : null;

  const winners: string[] | null = Array.isArray(gameState?.winners) ? gameState.winners : null;
  const endedReason = gameState?.endedReason ?? null;

  const winnerEmails =
    winners && winners.length
      ? winners.map((pid) => (players.find((p) => p?.playerId === pid)?.email ?? pid)).join(", ")
      : null;

  function reasonLabel() {
    if (endedReason === "points_target_reached") return "Points target reached";
    if (endedReason === "holes_max_rounds_reached") return "Final round complete";
    return "Match complete";
  }

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
        {mode === "holes" ? (
          <div>
            <span style={{ opacity: 0.8 }}>Round</span>{" "}
            <strong>{round}</strong>
            <span style={{ opacity: 0.6 }}> / {maxRounds}</span>
          </div>
        ) : (
          <div>
            <span style={{ opacity: 0.8 }}>Points game</span>{" "}
            <span style={{ opacity: 0.6 }}>•</span>{" "}
            <span style={{ opacity: 0.8 }}>target</span>{" "}
            <strong>{pointsTarget ?? "?"}</strong>
          </div>
        )}

        {!matchOver ? (
          <div>
            <span style={{ opacity: 0.8 }}>Turn</span>{" "}
            <strong>{curLabel}</strong>
          </div>
        ) : null}
      </div>

      {matchOver ? (
        <div
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            background: "#1b1b1b",
            border: "1px solid rgba(255,255,255,0.10)",
            fontWeight: 900,
          }}
        >
          Game Over • {reasonLabel()}
          {winnerEmails ? <span style={{ fontWeight: 800 }}> • Winner: {winnerEmails}</span> : null}
        </div>
      ) : finalTurnActive ? (
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
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ opacity: 0.65, fontSize: 12 }}>Normal play</div>
          {secsLeft != null ? (
            <div
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                background: "#1b1b1b",
                border: "1px solid rgba(255,255,255,0.10)",
                fontWeight: 800,
                fontSize: 12,
              }}
              title={turnTimeoutMs ? `Turn timeout: ${Math.round(turnTimeoutMs / 1000)}s` : undefined}
            >
              Turn ends in {secsLeft}s
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
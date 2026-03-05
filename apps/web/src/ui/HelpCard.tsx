// FILE: /apps/web/src/ui/HelpCard.tsx (NEW)
//
// Collapsible, dynamic help panel that explains the current table rules.
// Uses live state (rulesSummary, mode, timeout values) when available.

import { useMemo } from "react";

type HelpCardProps = {
  tableState: any;
  gameState: any;
};

function fmtMs(ms?: number | null) {
  if (ms == null) return "";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${String(r).padStart(2, "0")}s`;
}

export function HelpCard({ tableState, gameState }: HelpCardProps) {
  const rulesSummary: string | null =
    (tableState && (tableState.rulesSummary as any)) ||
    (gameState && (gameState.rulesSummary as any)) ||
    null;

  const mode: string | null =
    (tableState && tableState.mode) ||
    (gameState && gameState.mode) ||
    (tableState && tableState.rules && tableState.rules.mode) ||
    (gameState && gameState.rules && gameState.rules.mode) ||
    null;

  const pointsTarget: number | null =
    (tableState && tableState.pointsTarget) ||
    (gameState && gameState.pointsTarget) ||
    (tableState && tableState.rules && tableState.rules.pointsTarget) ||
    (gameState && gameState.rules && gameState.rules.pointsTarget) ||
    null;

  const holesTarget: number | null =
    (tableState && tableState.holes) ||
    (gameState && gameState.holes) ||
    (tableState && tableState.rules && tableState.rules.holes) ||
    (gameState && gameState.rules && gameState.rules.holes) ||
    null;

  const initialRevealCount: number | null =
    (tableState && tableState.initialRevealCount) ||
    (gameState && gameState.initialRevealCount) ||
    (tableState && tableState.rules && tableState.rules.initialRevealCount) ||
    (gameState && gameState.rules && gameState.rules.initialRevealCount) ||
    null;

  const turnTimeoutMs: number | null = (gameState && gameState.turnTimeoutMs) || null;

  const summaryLines = useMemo(() => {
    if (!rulesSummary) return null;
    return String(rulesSummary)
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }, [rulesSummary]);

  const modeLine = useMemo(() => {
    if (!mode) return null;
    if (mode === "points" && typeof pointsTarget === "number") return `Mode: Points (end when any player reaches ≥ ${pointsTarget} points; low score wins)`;
    if (mode === "holes" && typeof holesTarget === "number") return `Mode: Holes (${holesTarget} rounds; low cumulative score wins)`;
    return `Mode: ${mode}`;
  }, [mode, pointsTarget, holesTarget]);

  const initialLine =
    typeof initialRevealCount === "number"
      ? `Start of each round: reveal ${initialRevealCount} cards before you can draw.`
      : "Start of each round: reveal the required number of cards before you can draw.";

  const timeoutLine =
    turnTimeoutMs != null
      ? `Turn timer: ${fmtMs(turnTimeoutMs)} per turn. If you time out, the server auto-plays a safe action and ends your turn.`
      : "Turn timer: If you time out, the server auto-plays a safe action and ends your turn.";

  return (
    <details style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.10)", padding: 10, background: "rgba(255,255,255,0.03)" }} open={false}>
      <summary style={{ cursor: "pointer", fontWeight: 900, opacity: 0.95 }}>Help (How this table works)</summary>

      <div style={{ marginTop: 10, display: "grid", gap: 10, lineHeight: 1.35 }}>
        {modeLine ? <div style={{ fontWeight: 800 }}>{modeLine}</div> : null}

        {summaryLines && summaryLines.length ? (
          <div>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Rules summary</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {summaryLines.map((l, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  {l}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Turn flow</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li style={{ marginBottom: 4 }}>{initialLine}</li>
            <li style={{ marginBottom: 4 }}>On your turn you can draw from the shoe or take the top of the discard.</li>
            <li style={{ marginBottom: 4 }}>
              After drawing: either <b>SWAP</b> the drawn card into a slot (the replaced card goes to discard), or <b>DISCARD</b> the drawn card and (usually) reveal one card.
            </li>
            <li style={{ marginBottom: 4 }}>
              Clicking a face-down card (post-gate) reveals it and ends your turn — you’ll get a confirmation first for accidental clicks.
            </li>
            <li style={{ marginBottom: 4 }}>
              <b>PASS</b> is only allowed in the special case where you already drew, you have exactly 1 face-down card left, and the table is not in final turn.
            </li>
          </ul>
        </div>

        <div>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Round end + final turn</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li style={{ marginBottom: 4 }}>When any player reveals their last face-down card, the round ends and final turn begins for everyone else.</li>
            <li style={{ marginBottom: 4 }}>During final turn, everyone gets one last turn. PASS is disabled.</li>
          </ul>
        </div>

        <div>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Scoring</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li style={{ marginBottom: 4 }}>Your 6 cards score in 3 columns: (1,2), (3,4), (5,6).</li>
            <li style={{ marginBottom: 4 }}>If both cards in a column have the same rank, that column scores <b>0</b>.</li>
            <li style={{ marginBottom: 4 }}>Golf scoring: <b>lower total is better</b>.</li>
          </ul>
        </div>

        <div style={{ opacity: 0.9 }}>{timeoutLine}</div>
      </div>
    </details>
  );
}

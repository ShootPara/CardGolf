// FILE: /apps/web/src/ui/YouGrid.tsx (REPLACE)

import type { GridPos } from "../lib/cgTypes";
import type { Intent } from "./TurnControls";

type YouGridProps = {
  gameState: any;
  intent: Intent;
  onPickPos: (pos: GridPos) => void;
};

const TOP_ROW: GridPos[] = [1, 3, 5];
const BOT_ROW: GridPos[] = [2, 4, 6];

function cardLabel(card: any): string {
  if (!card) return "";
  const r = card.rank ?? card.r ?? card.value ?? "";
  const s = card.suit ?? card.s ?? "";
  return `${r}${s}`;
}

export function YouGrid({ gameState, intent, onPickPos }: YouGridProps) {
  const you = gameState?.you;
  const gridArr: any[] = Array.isArray(you?.grid) ? you.grid : [];

  const isYourTurn =
    you?.playerId && gameState?.currentTurnPlayerId
      ? you.playerId === gameState.currentTurnPlayerId
      : false;

  const initialRemaining = you?.initialRevealsRemaining ?? 0;
  const pendingDraw = gameState?.pendingDraw ?? null;

  const inPlaying = gameState?.phase === "playing";

  // IMPORTANT: when you have a pending draw, grid is locked until you choose Swap or Discard.
  const needsChoiceFirst = initialRemaining === 0 && pendingDraw != null && intent == null;

  // Clicks are allowed when:
  // - initial reveal gate is active (click to reveal)
  // - OR no pending draw (click to reveal)
  // - OR an explicit intent is chosen (swap / discard revealPos)
  const clickModeAllowed =
    initialRemaining > 0 ||
    pendingDraw == null ||
    intent === "SWAP" ||
    intent === "DISCARD_REVEALPOS";

  const canClick = isYourTurn && inPlaying && clickModeAllowed;

  function getCell(pos: GridPos) {
    return gridArr.find((c) => c?.pos === pos) ?? null;
  }

  function tileText(pos: GridPos) {
    const cell = getCell(pos);
    const visible = !!(cell?.visible ?? cell?.revealed);
    if (!visible) return "🂠";
    const label = cardLabel(cell?.card);
    return label ? label : "🂡";
  }

  const banner =
    intent === "SWAP"
      ? "SWAP MODE"
      : intent === "DISCARD_REVEALPOS"
        ? "DISCARD → PICK REVEAL"
        : "REVEAL MODE";

  function helperText() {
    if (!isYourTurn) return "Waiting for your turn…";

    if (initialRemaining > 0) return `Click cards to REVEAL (${initialRemaining} remaining)`;

    if (pendingDraw != null) {
      if (needsChoiceFirst) return "Choose Swap or Discard first.";
      if (intent === "SWAP") return "Click a slot to SWAP into";
      if (intent === "DISCARD_REVEALPOS") return "Click a card to REVEAL after discarding";
      return "You drew a card — choose Swap or Discard";
    }

    return "Click a face-down card to REVEAL (ends your turn)";
  }

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
        <h3 style={{ margin: 0 }}>Your Grid</h3>
        <span style={{ opacity: 0.75, fontSize: 12 }}>{banner}</span>
      </div>

      <div
        style={{
          opacity: 0.9,
          padding: needsChoiceFirst ? "10px" : 0,
          borderRadius: 10,
          background: needsChoiceFirst ? "#1b1b1b" : "transparent",
          border: needsChoiceFirst ? "1px solid rgba(255,255,255,0.08)" : "none",
        }}
      >
        {helperText()}
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {[TOP_ROW, BOT_ROW].map((row, idx) => (
          <div key={idx} style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {row.map((pos) => {
              const cell = getCell(pos);
              const visible = !!(cell?.visible ?? cell?.revealed);
              const label = tileText(pos);

              return (
                <button
                  key={pos}
                  disabled={!canClick}
                  onClick={() => onPickPos(pos)}
                  style={{
                    height: 88,
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: visible ? "#1a1a1a" : "#111",
                    color: "white",
                    fontSize: 22,
                    cursor: canClick ? "pointer" : "not-allowed",
                    opacity: canClick ? 1 : 0.6,
                  }}
                  title={`pos ${pos}`}
                >
                  <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>pos {pos}</div>
                  <div style={{ fontWeight: 700 }}>{label}</div>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div style={{ opacity: 0.65, fontSize: 12 }}>Layout: |1|3|5| / |2|4|6|</div>
    </div>
  );
}
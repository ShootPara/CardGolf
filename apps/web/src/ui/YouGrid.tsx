// FILE: /apps/web/src/ui/YouGrid.tsx (REPLACE)
//
// Change:
// - Suit letters -> symbols
// - Red suits (♥ ♦) colored

import type { GridPos } from "../lib/cgTypes";
import type { Intent } from "./TurnControls";

type YouGridProps = {
  gameState: any;
  intent: Intent;
  onPickPos: (pos: GridPos) => void;
};

const TOP_ROW: GridPos[] = [1, 3, 5];
const BOT_ROW: GridPos[] = [2, 4, 6];

function suitSymbol(s: any): string {
  const v = String(s ?? "");
  if (v === "C") return "♣";
  if (v === "D") return "♦";
  if (v === "H") return "♥";
  if (v === "S") return "♠";
  return v;
}

function suitColor(symbol: string): string {
  // red for hearts/diamonds, neutral for others
  return symbol === "♥" || symbol === "♦" ? "#ff4d4d" : "white";
}

function renderCard(card: any) {
  if (!card) return null;
  const r = card.rank ?? card.r ?? card.value ?? "";
  const sym = suitSymbol(card.suit ?? card.s ?? "");
  return (
    <span style={{ fontWeight: 900 }}>
      <span>{String(r)}</span>
      <span style={{ color: suitColor(sym) }}>{sym}</span>
    </span>
  );
}

export function YouGrid({ gameState, intent, onPickPos }: YouGridProps) {
  const you = gameState?.you;
  const gridArr: any[] = Array.isArray(you?.grid) ? you.grid : [];

  const isYourTurn =
    you?.playerId && gameState?.currentTurnPlayerId ? you.playerId === gameState.currentTurnPlayerId : false;

  const initialRemaining = you?.initialRevealsRemaining ?? 0;
  const pendingDraw = gameState?.pendingDraw ?? null;

  const inPlaying = gameState?.phase === "playing";
  const needsChoiceFirst = initialRemaining === 0 && pendingDraw != null && intent == null;

  const clickModeAllowed =
    initialRemaining > 0 || pendingDraw == null || intent === "SWAP" || intent === "DISCARD_REVEALPOS";

  const canClickGrid = isYourTurn && inPlaying && clickModeAllowed;

  function getCell(pos: GridPos) {
    return gridArr.find((c) => c?.pos === pos) ?? null;
  }

  function isFaceDown(pos: GridPos) {
    const cell = getCell(pos);
    const visible = !!(cell?.visible ?? cell?.revealed);
    return !visible;
  }

  function tileBody(pos: GridPos) {
    const cell = getCell(pos);
    const visible = !!(cell?.visible ?? cell?.revealed);
    if (!visible) return <span>🂠</span>;
    const node = renderCard(cell?.card);
    return node ? node : <span>🂡</span>;
  }

  const banner =
    intent === "SWAP" ? "SWAP MODE" : intent === "DISCARD_REVEALPOS" ? "DISCARD → PICK REVEAL" : "REVEAL MODE";

  function helperText() {
    if (!isYourTurn) return "Waiting for your turn…";

    if (initialRemaining > 0) return `Click cards to REVEAL (${initialRemaining} remaining)`;

    if (pendingDraw != null) {
      if (needsChoiceFirst) return "Choose Swap or Discard first.";
      if (intent === "SWAP") return "Click any slot to SWAP into";
      if (intent === "DISCARD_REVEALPOS") return "Click a FACE-DOWN card to REVEAL after discarding";
      return "You drew a card — choose Swap or Discard";
    }

    return "Click a FACE-DOWN card to REVEAL (ends your turn)";
  }

  function canPickPos(pos: GridPos): boolean {
    if (!canClickGrid) return false;
    if (intent === "SWAP") return true;
    if (intent === "DISCARD_REVEALPOS") return isFaceDown(pos);
    return isFaceDown(pos);
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
              const canPick = canPickPos(pos);

              return (
                <button
                  key={pos}
                  disabled={!canPick}
                  onClick={() => onPickPos(pos)}
                  style={{
                    height: 88,
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: visible ? "#1a1a1a" : "#111",
                    color: "white",
                    fontSize: 22,
                    cursor: canPick ? "pointer" : "not-allowed",
                    opacity: canPick ? 1 : 0.55,
                    userSelect: "none",
                  }}
                  title={`pos ${pos}`}
                >
                  <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>pos {pos}</div>
                  <div style={{ fontWeight: 700 }}>{tileBody(pos)}</div>
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
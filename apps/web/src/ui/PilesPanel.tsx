// FILE: /apps/web/src/ui/PilesPanel.tsx (REPLACE)
//
// Change:
// - Suit letters -> symbols
// - Red suits (♥ ♦) colored

import type { Intent } from "./TurnControls";

type PilesPanelProps = {
  gameState: any;
  intent: Intent;
  onDrawShoe: () => void;
  onDrawDiscard: () => void;
};

function suitSymbol(s: any): string {
  const v = String(s ?? "");
  if (v === "C") return "♣";
  if (v === "D") return "♦";
  if (v === "H") return "♥";
  if (v === "S") return "♠";
  return v;
}

function suitColor(symbol: string): string {
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

export function PilesPanel({ gameState, intent, onDrawShoe, onDrawDiscard }: PilesPanelProps) {
  const you = gameState?.you ?? null;

  const isYourTurn =
    you?.playerId && gameState?.currentTurnPlayerId ? you.playerId === gameState.currentTurnPlayerId : false;

  const initialRemaining = you?.initialRevealsRemaining ?? 0;
  const pendingDraw = gameState?.pendingDraw ?? null;

  const shoeCount = gameState?.shoeCount ?? gameState?.shoe?.length ?? null;

  const discardTop =
    gameState?.discardTop ??
    (Array.isArray(gameState?.discard) && gameState.discard.length > 0
      ? gameState.discard[gameState.discard.length - 1]
      : null);

  const inPlaying = gameState?.phase === "playing";
  const canAct = isYourTurn && inPlaying;

  const canDraw = canAct && initialRemaining === 0 && pendingDraw == null;
  const canDrawDiscard = canDraw && !!discardTop;

  const banner =
    pendingDraw
      ? intent === "SWAP"
        ? "Click a slot to swap"
        : intent === "DISCARD_REVEALPOS"
          ? "Click a card to reveal"
          : "Choose Swap or Discard"
      : initialRemaining > 0
        ? `Reveal ${initialRemaining} to begin`
        : canDraw
          ? "Click a pile to draw"
          : "Waiting";

  function tileStyle(enabled: boolean) {
    return {
      borderRadius: 12,
      padding: 10,
      background: enabled ? "#171717" : "#0f0f0f",
      border: "1px solid rgba(255,255,255,0.06)",
      minHeight: 110,
      display: "grid",
      gap: 6,
      cursor: enabled ? "pointer" : "not-allowed",
      opacity: enabled ? 1 : 0.6,
      userSelect: "none" as const,
    };
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
        <h3 style={{ margin: 0 }}>Piles</h3>
        <span style={{ opacity: 0.75, fontSize: 12 }}>{banner}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        <div
          style={tileStyle(canDraw)}
          onClick={() => {
            if (!canDraw) return;
            onDrawShoe();
          }}
          title={canDraw ? "Click to draw from shoe" : "Can't draw right now"}
        >
          <div style={{ opacity: 0.7, fontSize: 12 }}>Shoe</div>
          <div style={{ fontSize: 34, lineHeight: "34px" }}>🂠</div>
          <div style={{ opacity: 0.85, fontSize: 12 }}>{shoeCount != null ? `${shoeCount} cards` : "(unknown)"}</div>
        </div>

        <div
          style={tileStyle(canDrawDiscard)}
          onClick={() => {
            if (!canDrawDiscard) return;
            onDrawDiscard();
          }}
          title={!discardTop ? "Discard is empty" : canDrawDiscard ? "Click to draw from discard" : "Can't draw right now"}
        >
          <div style={{ opacity: 0.7, fontSize: 12 }}>Discard (top)</div>
          <div style={{ fontSize: 28, fontWeight: 900 }}>{discardTop ? renderCard(discardTop) : "—"}</div>
          <div style={{ opacity: 0.75, fontSize: 12 }}>{discardTop ? "Face-up" : "Empty"}</div>
        </div>

        <div
          style={{
            borderRadius: 12,
            padding: 10,
            background: pendingDraw ? "#171717" : "#0f0f0f",
            border: "1px solid rgba(255,255,255,0.06)",
            minHeight: 110,
            display: "grid",
            gap: 6,
          }}
          title="This is the card you drew (pending action)"
        >
          <div style={{ opacity: 0.7, fontSize: 12 }}>You drew</div>
          <div style={{ fontSize: 28, fontWeight: 900 }}>{pendingDraw ? renderCard(pendingDraw) : "—"}</div>
          <div style={{ opacity: 0.75, fontSize: 12 }}>{pendingDraw ? "Pending action" : "Nothing drawn"}</div>
        </div>
      </div>
    </div>
  );
}
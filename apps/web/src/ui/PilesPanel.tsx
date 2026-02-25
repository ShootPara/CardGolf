// FILE: /apps/web/src/ui/PilesPanel.tsx (REPLACE)

import type { Intent } from "./TurnControls";

type PilesPanelProps = {
  gameState: any;
  intent: Intent;
  // actions
  onDrawShoe: () => void;
  onDrawDiscard: () => void;
};

function cardLabel(card: any): string {
  if (!card) return "";
  const r = card.rank ?? card.r ?? card.value ?? "";
  const s = card.suit ?? card.s ?? "";
  return `${r}${s}`;
}

function cardView(card: any): string {
  if (!card) return "";
  const label = cardLabel(card);
  return label || "🂡";
}

export function PilesPanel({ gameState, intent, onDrawShoe, onDrawDiscard }: PilesPanelProps) {
  const you = gameState?.you ?? null;

  const isYourTurn =
    you?.playerId && gameState?.currentTurnPlayerId
      ? you.playerId === gameState.currentTurnPlayerId
      : false;

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

  // You can draw only when:
  // - it's your turn
  // - you are not in initial reveal gate
  // - you do not already have a pendingDraw
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
        {/* Shoe */}
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
          <div style={{ opacity: 0.85, fontSize: 12 }}>
            {shoeCount != null ? `${shoeCount} cards` : "(unknown)"}
          </div>
        </div>

        {/* Discard */}
        <div
          style={tileStyle(canDrawDiscard)}
          onClick={() => {
            if (!canDrawDiscard) return;
            onDrawDiscard();
          }}
          title={
            !discardTop ? "Discard is empty" : canDrawDiscard ? "Click to draw from discard" : "Can't draw right now"
          }
        >
          <div style={{ opacity: 0.7, fontSize: 12 }}>Discard (top)</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>
            {discardTop ? cardView(discardTop) : "—"}
          </div>
          <div style={{ opacity: 0.75, fontSize: 12 }}>
            {discardTop ? "Face-up" : "Empty"}
          </div>
        </div>

        {/* Pending draw */}
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
          <div style={{ fontSize: 28, fontWeight: 900 }}>
            {pendingDraw ? cardView(pendingDraw) : "—"}
          </div>
          <div style={{ opacity: 0.75, fontSize: 12 }}>
            {pendingDraw ? "Pending action" : "Nothing drawn"}
          </div>
        </div>
      </div>
    </div>
  );
}
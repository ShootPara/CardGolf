// FILE: /apps/web/src/ui/TurnControls.tsx (REPLACE)
//
// Step 6.2c (PASS rule alignment):
// PASS is only meaningful as an alternative to DISCARD_DRAWN when:
// - you have a pending drawn card (you just drew this turn)
// - you have exactly 1 face-down card remaining
// - initial reveal gate is complete
// - PASS is disabled during final turn (server-enforced)
//
// This matches your intended UX: PASS should NOT appear before drawing,
// and it should appear in the "resolve pending draw" stage (Swap/Discard/Pass/Cancel).

import { useMemo } from "react";

// IMPORTANT: App.tsx imports this as a type-only import.
export type Intent = "SWAP" | "DISCARD_REVEALPOS" | null;

type TurnControlsProps = {
  gameState: any;
  intent: Intent;
  setIntent: (i: Intent) => void;
  onSend: (type: string, payload?: any) => void;
};

export function TurnControls({ gameState, intent, setIntent, onSend }: TurnControlsProps) {
  const you = gameState?.you ?? null;

  const isYourTurn = useMemo(() => {
    const me = you?.playerId;
    const cur = gameState?.currentTurnPlayerId;
    return !!me && !!cur && me === cur;
  }, [you?.playerId, gameState?.currentTurnPlayerId]);

  const inPlaying = gameState?.phase === "playing";
  const canAct = isYourTurn && inPlaying;

  const initialRemaining = you?.initialRevealsRemaining ?? 0;
  const pendingDraw = gameState?.pendingDraw ?? null;
  const faceDownCount = you?.faceDownCount ?? null;

  const finalTurnActive = !!gameState?.finalTurnActive;

  // PASS: only show when you actually have a pending drawn card.
  // This prevents the "Pass requires drawing a card first" server error.
  const passAllowed =
    canAct &&
    initialRemaining === 0 &&
    pendingDraw != null &&
    faceDownCount === 1 &&
    !finalTurnActive;

  // Draw allowed only when:
  // - your turn
  // - initial gate complete
  // - no pending draw already
  const canDraw = canAct && initialRemaining === 0 && pendingDraw == null;

  // You can choose swap/discard only when you actually have a pending drawn card
  const canResolvePending = canAct && initialRemaining === 0 && pendingDraw != null;

  function drawShoe() {
    if (!canDraw) return;
    onSend("DRAW_SHOE");
    setIntent(null);
  }

  function drawDiscard() {
    if (!canDraw) return;
    onSend("DRAW_DISCARD");
    setIntent(null);
  }

  function chooseSwap() {
    if (!canResolvePending) return;
    setIntent("SWAP");
  }

  function chooseDiscard() {
    if (!canResolvePending) return;
    setIntent("DISCARD_REVEALPOS");
  }

  function cancelIntent() {
    setIntent(null);
  }

  function pass() {
    if (!passAllowed) return;
    onSend("PASS");
    setIntent(null);
  }

  const intentHint =
    intent === "SWAP"
      ? "Now click a slot in your grid to swap into."
      : intent === "DISCARD_REVEALPOS"
        ? "Now click a FACE-DOWN card in your grid to reveal after discarding."
        : "";

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
        <h3 style={{ margin: 0 }}>Turn Controls</h3>
        <span style={{ opacity: 0.8, fontSize: 12 }}>{canAct ? "Your turn" : "Waiting"}</span>
      </div>

      {finalTurnActive ? (
        <div style={{ padding: 10, borderRadius: 10, background: "#1b1b1b", border: "1px solid rgba(255,255,255,0.08)" }}>
          <strong>Final turn</strong>
          <div style={{ opacity: 0.85, marginTop: 4 }}>
            Remaining turns: {gameState?.finalTurnsRemainingCount ?? "?"}
          </div>
        </div>
      ) : null}

      {initialRemaining > 0 ? (
        <div style={{ padding: 10, borderRadius: 10, background: "#1b1b1b", border: "1px solid rgba(255,255,255,0.08)" }}>
          Reveal <strong>{initialRemaining}</strong> more card(s) by clicking your grid.
        </div>
      ) : null}

      {/* Draw stage */}
      {initialRemaining === 0 && pendingDraw == null ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button disabled={!canDraw} onClick={drawShoe}>Draw Shoe</button>
          <button disabled={!canDraw} onClick={drawDiscard}>Draw Discard</button>
        </div>
      ) : null}

      {/* Resolve stage */}
      {initialRemaining === 0 && pendingDraw != null ? (
        <>
          <div style={{ padding: 10, borderRadius: 10, background: "#1b1b1b", border: "1px solid rgba(255,255,255,0.08)" }}>
            You drew a card. Choose <strong>Swap</strong> (then click a slot) or <strong>Discard</strong>.
          </div>

          {faceDownCount === 1 && !finalTurnActive ? (
            <div style={{ padding: 10, borderRadius: 10, background: "#1b1b1b", border: "1px solid rgba(255,255,255,0.08)" }}>
              You have exactly <strong>1</strong> face-down left. If you don’t want to reveal it right now,
              use <strong>PASS</strong> instead of discarding+revealing.
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button disabled={!canResolvePending} onClick={chooseSwap}>
              Swap (click slot)
            </button>
            <button disabled={!canResolvePending} onClick={chooseDiscard}>
              Discard (pick reveal)
            </button>

            {passAllowed ? (
              <button onClick={pass}>Pass</button>
            ) : null}

            <button disabled={!canResolvePending} onClick={cancelIntent}>
              Cancel
            </button>
          </div>

          {intentHint ? <div style={{ opacity: 0.85 }}>{intentHint}</div> : null}
        </>
      ) : null}
    </div>
  );
}

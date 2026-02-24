// FILE: /apps/web/src/ui/TurnControls.tsx (REPLACE)

import { useMemo } from "react";

// IMPORTANT: App.tsx imports this, so it must be exported.
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

  const initialRemaining = you?.initialRevealsRemaining ?? 0;
  const pendingDraw = gameState?.pendingDraw ?? null;

  const canAct = isYourTurn && gameState?.phase === "playing";

  function drawShoe() {
    onSend("DRAW_SHOE");
    setIntent(null);
  }

  function drawDiscard() {
    onSend("DRAW_DISCARD");
    setIntent(null);
  }

  function chooseSwap() {
    setIntent("SWAP");
  }

  function chooseDiscard() {
    setIntent("DISCARD_REVEALPOS");
  }

  function pass() {
    onSend("PASS");
    setIntent(null);
  }

  const intentHint =
    intent === "SWAP"
      ? "Now click a slot in your grid to swap into."
      : intent === "DISCARD_REVEALPOS"
        ? "Now click a card in your grid to reveal after discarding."
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

      {gameState?.finalTurnActive ? (
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

      {initialRemaining === 0 && pendingDraw == null ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button disabled={!canAct} onClick={drawShoe}>Draw Shoe</button>
          <button disabled={!canAct} onClick={drawDiscard}>Draw Discard</button>
          <button disabled={!canAct} onClick={pass}>Pass</button>
        </div>
      ) : null}

      {initialRemaining === 0 && pendingDraw != null ? (
        <>
          <div style={{ padding: 10, borderRadius: 10, background: "#1b1b1b", border: "1px solid rgba(255,255,255,0.08)" }}>
            You drew a card. Choose <strong>Swap</strong> (then click a slot) or <strong>Discard</strong>.
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button disabled={!canAct} onClick={chooseSwap}>
              Swap (click slot)
            </button>
            <button disabled={!canAct} onClick={chooseDiscard}>
              Discard (pick reveal)
            </button>
            <button disabled={!canAct} onClick={() => setIntent(null)}>
              Cancel
            </button>
          </div>

          {intentHint ? <div style={{ opacity: 0.85 }}>{intentHint}</div> : null}
        </>
      ) : null}
    </div>
  );
}
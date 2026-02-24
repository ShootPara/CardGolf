import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

import type { DevSession, UiPhase, WsEnvelope } from "./lib/cgTypes";
import { apiPost, CgWs } from "./lib/cgClient";

import { ChatPanel } from "./ui/ChatPanel";
import { TurnControls } from "./ui/TurnControls";
import type { Intent } from "./ui/TurnControls";
import { YouGrid } from "./ui/YouGrid";

/* ---------------------------------------------
 * Section: Small helpers
 * --------------------------------------------- */

function pretty(obj: any) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

/* ---------------------------------------------
 * Section: App
 * --------------------------------------------- */

export default function App() {
  // ---- UI phase / session ----
  const [phase, setPhase] = useState<UiPhase>("HOME");
  const [devEmail, setDevEmail] = useState<string>("you@example.com");
  const [tableIdInput, setTableIdInput] = useState<string>("");
  const [role, setRole] = useState<"player" | "spectator">("player");

  const session: DevSession | null = useMemo(() => {
    if (!devEmail) return null;
    return { devEmail, tableId: tableIdInput || undefined, role };
  }, [devEmail, tableIdInput, role]);

  // ---- UI intent (Step 4) ----
  // When you have a pending draw, the user MUST choose Swap or Discard first.
  // The grid click meaning depends on this intent.
  const [intent, setIntent] = useState<TurnIntent>(null);

  // ---- WS + latest server states ----
  const wsRef = useRef<CgWs | null>(null);
  const [wsStatus, setWsStatus] = useState<string>("disconnected");

  const [tableState, setTableState] = useState<any>(null);
  const [chatState, setChatState] = useState<any>(null);
  const [gameState, setGameState] = useState<any>(null);
  const [lastError, setLastError] = useState<any>(null);

  /* ---------------------------------------------
   * Section: WS lifecycle
   * --------------------------------------------- */

  function handleWsMessage(msg: WsEnvelope) {
    switch (msg.type) {
      case "TABLE_STATE":
        setTableState(msg.payload);
        break;

      case "CHAT_STATE":
        setChatState(msg.payload);
        break;

      case "CHAT_APPEND": {
        const msgToAdd = (msg as any)?.payload?.message;
        if (!msgToAdd) break;

        setChatState((prev: any) => {
          const prevMsgs = Array.isArray(prev?.messages) ? prev.messages : [];
          return { messages: [...prevMsgs, msgToAdd] };
        });
        break;
      }

      case "GAME_STATE":
        setGameState(msg.payload);
        setPhase("GAME");
        // When the server advances turn / resolves actions, clear intent so UI doesn't "stick"
        setIntent(null);
        break;

      case "WELCOME":
        break;

      case "ERROR":
        setLastError(msg.payload ?? (msg as any).error ?? msg);
        break;

      default:
        break;
    }
  }

  function connectWs() {
    if (!session?.tableId) {
      alert("Enter a tableId first.");
      return;
    }

    wsRef.current?.close();
    wsRef.current = null;

    const ws = new CgWs(session, {
      onOpen: () => setWsStatus("connected"),
      onClose: (ev) => setWsStatus(`closed (${ev.code})`),
      onError: () => setWsStatus("error"),
      onMessage: handleWsMessage,
    });

    wsRef.current = ws;
    setWsStatus("connecting...");
    setLastError(null);
    setTableState(null);
    setChatState(null);
    setGameState(null);
    setIntent(null);

    ws.connect();
    setPhase("LOBBY");
  }

  function disconnectWs() {
    wsRef.current?.close();
    wsRef.current = null;
    setWsStatus("disconnected");
    setPhase("HOME");
    setIntent(null);
  }

  useEffect(() => {
    return () => wsRef.current?.close();
  }, []);

  /* ---------------------------------------------
   * Section: API actions
   * --------------------------------------------- */

  async function createTable() {
    if (!devEmail) return alert("devEmail required");
    try {
      setLastError(null);

      // Minimal default rules used by our test harness.
      // NOTE: holes mode requires maxRounds=9 (validate_rules constraint).
      const rules_json = {
        schemaVersion: 1,
        rulesetName: "UI Default",
        gameVariant: { variantId: "golf-6card", grid: { rows: 2, cols: 3 }, initialPeekCount: 2, deckCount: 2 },
        endConditions: {
          mode: "holes",
          maxRounds: 9,
          pointsTarget: null,
          roundEnd: {
            trigger: "player_reveals_last_card",
            finalTurnPolicy: "everyone_gets_one_more_turn",
            autoRevealRemainingFaceDown: true,
            passAllowedDuringFinalTurn: false,
          },
        },
        scoring: {
          rankValues: { A: 1, 2: -2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 10, Q: 10, K: 0 },
          columnMatchCancels: true,
        },
        passRule: { enabled: true, requiresDrawFirst: true, requiresExactlyOneFaceDown: true, disabledDuringFinalTurn: true },
        uiOptions: { allowSpectators: true, allowSpectatorChat: true },
      };

      const res = await apiPost<any>("/api/table/create", devEmail, { rules_json });

      const newId = res?.table?.tableId ?? res?.tableId ?? res?.id;
      if (!newId) {
        alert("Create succeeded but couldn't find tableId in response.\n\n" + pretty(res));
        return;
      }
      setTableIdInput(String(newId));
      alert(`Created table ${newId}`);
    } catch (e: any) {
      setLastError(String(e?.message ?? e));
    }
  }

  async function startTable() {
    if (!devEmail || !tableIdInput) return;
    try {
      setLastError(null);
      await apiPost(`/api/table/${encodeURIComponent(tableIdInput)}/start`, devEmail);
      // GAME_STATE will arrive over WS; that flips us into GAME view
    } catch (e: any) {
      setLastError(String(e?.message ?? e));
    }
  }

  /* ---------------------------------------------
   * Section: WS actions
   * --------------------------------------------- */

  function wsSend(type: string, payload?: any) {
    try {
      wsRef.current?.send(type, payload);
    } catch (e: any) {
      setLastError(String(e?.message ?? e));
    }
  }

  function sendChat(text: string) {
    wsSend("CHAT_SEND", { text });
  }

  /* ---------------------------------------------
   * Section: Layout helpers
   * --------------------------------------------- */

  const showRightChat = phase === "LOBBY" || phase === "GAME";

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto" }}>
      <h2>CardGolf UI (Vite + React)</h2>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <label>
          dev_email:&nbsp;
          <input value={devEmail} onChange={(e) => setDevEmail(e.target.value)} style={{ width: 240 }} />
        </label>

        <label>
          role:&nbsp;
          <select value={role} onChange={(e) => setRole(e.target.value as any)}>
            <option value="player">player</option>
            <option value="spectator">spectator</option>
          </select>
        </label>

        <label>
          tableId:&nbsp;
          <input value={tableIdInput} onChange={(e) => setTableIdInput(e.target.value)} style={{ width: 220 }} />
        </label>

        <span style={{ opacity: 0.8 }}>ws: {wsStatus}</span>

        {phase !== "HOME" ? <button onClick={disconnectWs}>Disconnect</button> : null}
      </div>

      {lastError ? (
        <pre style={{ background: "#331111", padding: 12, borderRadius: 8, marginTop: 12, overflowX: "auto" }}>
          ERROR:
          {"\n"}
          {pretty(lastError)}
        </pre>
      ) : null}

      {/* HOME */}
      {phase === "HOME" ? (
        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={createTable}>Create Table</button>
            <button onClick={connectWs} disabled={!tableIdInput}>
              Connect to Table
            </button>
          </div>

          <p style={{ opacity: 0.8, margin: 0 }}>
            Create/connect, then Lobby → Start → Game. Chat will appear after you connect.
          </p>
        </div>
      ) : null}

      {/* LOBBY + GAME layout */}
      {phase !== "HOME" ? (
        <div
          style={{
            marginTop: 16,
            display: "grid",
            gridTemplateColumns: showRightChat ? "1.25fr 0.75fr" : "1fr",
            gap: 12,
            alignItems: "start",
          }}
        >
          {/* LEFT: main */}
          <div>
            {phase === "LOBBY" ? (
              <>
                <h3>Lobby</h3>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={startTable}>Start Game</button>
                  <button onClick={() => wsSend("PING")}>Ping</button>
                </div>

                <h4 style={{ marginTop: 12 }}>TABLE_STATE</h4>
                <pre style={{ background: "#111", padding: 12, borderRadius: 8, overflowX: "auto" }}>
                  {tableState ? pretty(tableState) : "(waiting for TABLE_STATE...)"}
                </pre>
              </>
            ) : null}

            {phase === "GAME" ? (
              <>
                <h3>Game</h3>

                {/* Step 4: Clickable grid + intent-driven actions */}
                {gameState ? (
                  <>
                    <YouGrid
                      gameState={gameState}
                      intent={intent}
                      onPickPos={(pos) => {
                        if (intent === "SWAP") {
                          wsSend("SWAP", { pos });
                          setIntent(null);
                          return;
                        }

                        if (intent === "DISCARD_REVEALPOS") {
                          wsSend("DISCARD_DRAWN", { revealPos: pos });
                          setIntent(null);
                          return;
                        }

                        // IMPORTANT: if the player has a pending drawn card, they must choose Swap or Discard first.
                        // No "free clicking" to reveal while holding a draw.
                        const you = gameState?.you;
                        const initialRemaining = you?.initialRevealsRemaining ?? 0;
                        const pendingDraw = gameState?.pendingDraw ?? null;
                        if (pendingDraw != null && initialRemaining === 0) return;

                        wsSend("REVEAL", { pos });
                      }}
                    />

                    <div style={{ marginTop: 12 }}>
                      <TurnControls
                        gameState={gameState}
                        intent={intent}
                        setIntent={setIntent}
                        onSend={(type, payload) => wsSend(type, payload)}
                      />
                    </div>
                  </>
                ) : null}

                {/* Keep this while we build; it's a great debug view */}
                <h4 style={{ marginTop: 12 }}>GAME_STATE</h4>
                <pre style={{ background: "#111", padding: 12, borderRadius: 8, overflowX: "auto" }}>
                  {gameState ? pretty(gameState) : "(waiting for GAME_STATE...)"}
                </pre>
              </>
            ) : null}
          </div>

          {/* RIGHT: chat */}
          {showRightChat ? (
            <ChatPanel chatState={chatState} disabled={wsStatus !== "connected"} onSend={sendChat} title="Chat" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

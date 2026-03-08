/**
 * FILE: /apps/web/src/App.tsx (REPLACE)
 *
 * Restores:
 * - Table Setup panel on HOME (rules_json builder)
 *
 * Adds:
 * - Graceful UI notice for common/expected errors (e.g., MUTED) near Chat
 * - OwnerControlsPanel available during GAME (owner-only)
 *
 * Keeps:
 * - CardValuesPanel under chat (compact)
 * - No Ping button (removed)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

import type { DevSession, UiPhase, WsEnvelope } from "./lib/cgTypes";
import { apiPost, CgWs } from "./lib/cgClient";

import { ChatPanel } from "./ui/ChatPanel";
import { TurnControls } from "./ui/TurnControls";
import type { Intent } from "./ui/TurnControls";
import { YouGrid } from "./ui/YouGrid";
import { PilesPanel } from "./ui/PilesPanel";
import { GameStatusBar } from "./ui/GameStatusBar";

import { TableSetupPanel, buildRulesJsonFromSetup, defaultTableSetupState, type TableSetupState } from "./ui/TableSetupPanel";
import { CardValuesPanel } from "./ui/CardValuesPanel";
import { OwnerControlsPanel } from "./ui/OwnerControlsPanel";

import { TableViewPanel } from "./ui/TableViewPanel";
import { ConfirmModal } from "./ui/ConfirmModal";
/* ---------------------------------------------
 * Section: Types
 * --------------------------------------------- */

type TurnIntent = Intent;

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

function buildJoinUrl(baseUrl: string, opts: { devEmail: string; tableId: string; role: string }) {
  const u = new URL(baseUrl);
  u.searchParams.set("dev_email", opts.devEmail);
  u.searchParams.set("tableId", opts.tableId);
  u.searchParams.set("role", opts.role);
  u.searchParams.set("autoconnect", "1");
  return u.toString();
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

  // ---- Table setup ----
  const [tableSetup, setTableSetup] = useState<TableSetupState>(() => defaultTableSetupState());

  // ---- UI intent ----
  const [intent, setIntent] = useState<TurnIntent>(null);

  const [autoConnectRequested, setAutoConnectRequested] = useState(false);

  // ---- WS + latest server states ----
  const wsRef = useRef<CgWs | null>(null);
  const [wsStatus, setWsStatus] = useState<string>("disconnected");

  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState<string>("");
  const [lastWsClose, setLastWsClose] = useState<{ code: number; reason: string } | null>(null);

  const [tableState, setTableState] = useState<any>(null);
  const [chatState, setChatState] = useState<any>(null);
  const [gameState, setGameState] = useState<any>(null);
  const [lastError, setLastError] = useState<any>(null);

  // --- UI notices (small, auto-dismissing) ---
  const [uiNotice, setUiNotice] = useState<{ kind: "info" | "warn"; text: string } | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  // --- Confirm modal (website-style, no native alert/confirm) ---
  const [confirmModal, setConfirmModal] = useState<null | {
    title: string;
    body: string;
    okText?: string;
    cancelText?: string;
    onOk: () => void;
  }>(null);

  function openConfirm(opts: { title: string; body: string; okText?: string; cancelText?: string; onOk: () => void }) {
    setConfirmModal(opts);
  }

  function closeConfirm() {
    setConfirmModal(null);
  }

  function showNotice(kind: "info" | "warn", text: string) {
    setUiNotice({ kind, text });
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setUiNotice(null), 3500);
  }

  function youFaceDownCount(gs: any): number {
    const gridArr: any[] = Array.isArray(gs?.you?.grid) ? gs.you.grid : [];
    let n = 0;
    for (const c of gridArr) {
      const visible = !!(c?.visible ?? c?.revealed);
      if (!visible) n++;
    }
    return n;
  }

  function isYouFaceDownPos(gs: any, pos: any): boolean {
    const gridArr: any[] = Array.isArray(gs?.you?.grid) ? gs.you.grid : [];
    const cell = gridArr.find((c) => c?.pos === pos) ?? null;
    const visible = !!(cell?.visible ?? cell?.revealed);
    return !visible;
  }

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

      case "WELCOME": {
        const you = (msg as any)?.payload?.you ?? null;
        // player joins provide playerId; spectator joins provide spectatorId
        setMyPlayerId(you?.playerId ?? you?.spectatorId ?? null);
        break;
      }

      case "ERROR": {
        const p: any = (msg as any).payload ?? (msg as any).error ?? msg;
        const code = p?.code ?? "";
        const message = p?.message ?? "Error";

        // Graceful UX for common/expected errors
        if (code === "MUTED") {
          showNotice("warn", "You’re muted by the table owner.");
          return;
        }

        setLastError(p ?? { code, message });
        return;
      }

      default:
        break;
    }
  }

  function connectWs() {
    if (!session?.tableId) {
      showNotice("warn", "Enter a tableId first.");
      return;
    }

    wsRef.current?.close();
    wsRef.current = null;

    const ws = new CgWs(session, {
      onOpen: () => setWsStatus("connected"),
      onClose: (ev) => {
        setWsStatus(`closed (${ev.code})`);
        setLastWsClose({ code: ev.code, reason: ev.reason ?? "" });
      },
      onError: () => setWsStatus("error"),
      onMessage: handleWsMessage,
    });

    wsRef.current = ws;
    setWsStatus("connecting...");
    setLastWsClose(null);
    setMyPlayerId(null);
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
    return () => {
      wsRef.current?.close();
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    };
  }, []);

  // Auto-fill from URL params: ?dev_email=...&tableId=...&role=player|spectator&autoconnect=1
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);

    const qEmail = qs.get("dev_email");
    const qTableId = qs.get("tableId");
    const qRole = qs.get("role");
    const qAuto = qs.get("autoconnect");

    if (qEmail) setDevEmail(qEmail);
    if (qTableId) setTableIdInput(qTableId);
    if (qRole === "player" || qRole === "spectator") setRole(qRole);

    if (qAuto === "1" || qAuto?.toLowerCase() === "true") {
      setAutoConnectRequested(true);
    }
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If URL requested autoconnect, connect once when devEmail + tableId are available.
  useEffect(() => {
    if (!autoConnectRequested) return;
    if (!devEmail || !tableIdInput) return;

    setAutoConnectRequested(false);
    connectWs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnectRequested, devEmail, tableIdInput]);

  /* ---------------------------------------------
   * Section: API actions
   * --------------------------------------------- */

  async function createTable() {
    if (!devEmail || !devEmail.trim()) {
      showNotice("warn", "devEmail required");
      return;
    }
    try {
      setLastError(null);

      const built = buildRulesJsonFromSetup(tableSetup);
      if (!built.ok) {
        showNotice("warn", "Fix Table Setup first (see Table Setup panel).");
        setLastError(built.error);
        return;
      }

      const res = await apiPost<any>("/api/table/create", devEmail, { rules_json: built.rules });

      const newId = res?.table?.tableId ?? res?.tableId ?? res?.id;
      if (!newId) {
      showNotice("warn", "Create succeeded but could not read tableId from response.");
      setLastError(pretty(res));
        return;
      }
      setTableIdInput(String(newId));
      showNotice("info", `Created table ${newId}`);
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

      {/* Website-style modal confirmations (no native JS dialogs) */}
      {confirmModal ? (
        <ConfirmModal
          title={confirmModal.title}
          body={confirmModal.body}
          okText={confirmModal.okText}
          cancelText={confirmModal.cancelText}
          onCancel={() => closeConfirm()}
          onOk={() => confirmModal.onOk()}
        />
      ) : null}

      {/* Small toast-style notice (replaces alert() UX) */}
      {uiNotice ? (
        <div
          style={{
            position: "fixed",
            right: 16,
            top: 16,
            zIndex: 50,
            padding: "10px 12px",
            borderRadius: 10,
            background: uiNotice.kind === "warn" ? "rgba(180,80,60,0.95)" : "rgba(40,40,40,0.95)",
            border: "1px solid rgba(255,255,255,0.15)",
            color: "white",
            boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
            maxWidth: 420,
          }}
          role="status"
          aria-live="polite"
          onClick={() => setUiNotice(null)}
          title="Click to dismiss"
        >
          {uiNotice.text}
        </div>
      ) : null}

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

        {tableIdInput ? (
          <>
            <button
              onClick={async () => {
                const url = buildJoinUrl(window.location.href, {
                  devEmail: "p2@example.com",
                  tableId: tableIdInput,
                  role: "player",
                });
                await navigator.clipboard.writeText(url);
                  showNotice("info", "Copied P2 join link");
              }}
            >
              Copy P2 Join Link
            </button>

            <button
              onClick={async () => {
                const url = buildJoinUrl(window.location.href, {
                  devEmail: "spectator@example.com",
                  tableId: tableIdInput,
                  role: "spectator",
                });
                await navigator.clipboard.writeText(url);
                  showNotice("info", "Copied spectator link");
              }}
            >
              Copy Spectator Link
            </button>
          </>
        ) : null}

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

      {lastWsClose && phase !== "HOME" ? (
        <div style={{ background: "#222", padding: 10, borderRadius: 8, marginTop: 12, opacity: 0.9 }}>
          WS closed: <strong>{lastWsClose.code}</strong>
          {lastWsClose.reason ? <span> — {lastWsClose.reason}</span> : null}
          {tableState?.status === "started" ? (
            <div style={{ marginTop: 6, opacity: 0.85 }}>
              If you opened this link after the host started the game, player joins are blocked (by design). Ask the host
              to create a new table.
            </div>
          ) : null}
        </div>
      ) : null}

      {/* HOME */}
      {phase === "HOME" ? (
        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
          <TableSetupPanel value={tableSetup} onChange={setTableSetup} />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={createTable}>Create Table</button>
            <button onClick={connectWs} disabled={!tableIdInput}>
              Connect to Table
            </button>
          </div>

          <p style={{ opacity: 0.8, margin: 0 }}>Create/connect, then Lobby → Start → Game. Chat will appear after you connect.</p>
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
                  <button
                    onClick={startTable}
                    disabled={
                      wsStatus !== "connected" ||
                      !tableState ||
                      tableState.status !== "open" ||
                      !myPlayerId ||
                      tableState.ownerPlayerId !== myPlayerId ||
                      !(Array.isArray(tableState.players) && tableState.players.length >= 2)
                    }
                    title={
                      !tableState
                        ? "Waiting for TABLE_STATE"
                        : !myPlayerId
                          ? "Waiting for WELCOME"
                          : tableState.ownerPlayerId !== myPlayerId
                            ? "Only the owner can start"
                            : !(Array.isArray(tableState.players) && tableState.players.length >= 2)
                              ? "Need at least 2 players"
                              : ""
                    }
                  >
                    Start Game
                  </button>
                </div>

                {/* Your display name (Lobby) */}
                <div style={{ marginTop: 12, background: "#111", border: "1px solid rgba(255,255,255,0.08)", padding: 12, borderRadius: 10 }}>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>Your display name</div>
                  <div style={{ opacity: 0.85, fontSize: 12, marginBottom: 8 }}>
                    Shown to other players in this table only (not saved).
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <input
                      style={{ minWidth: 240 }}
                      value={displayNameDraft}
                      placeholder={
                        (() => {
                          const me =
                            tableState?.players?.find((p: any) => p?.playerId === myPlayerId) ??
                            tableState?.spectators?.find((s: any) => s?.spectatorId === myPlayerId) ?? tableState?.spectators?.find((s: any) => s?.email === devEmail) ??
                            null;
                          return me?.displayName ?? me?.email ?? "Enter a name";
                        })()
                      }
                      onChange={(e) => setDisplayNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          wsSend("SET_DISPLAY_NAME", { displayName: displayNameDraft });
                        }
                      }}
                    />
                    <button
                      onClick={() => wsSend("SET_DISPLAY_NAME", { displayName: displayNameDraft })}
                      disabled={wsStatus !== "connected" || !myPlayerId}
                      title={wsStatus !== "connected" ? "Connect first" : !myPlayerId ? "Waiting for WELCOME" : ""}
                    >
                      Set Name
                    </button>
                    <button
                      onClick={() => {
                        setDisplayNameDraft("");
                        wsSend("SET_DISPLAY_NAME", { displayName: "" });
                      }}
                      disabled={wsStatus !== "connected" || !myPlayerId}
                      title="Clear display name"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {/* Owner controls (Lobby) */}
                <div style={{ marginTop: 12 }}>
                  <OwnerControlsPanel tableState={tableState} myPlayerId={myPlayerId} wsStatus={wsStatus} wsSend={wsSend} />
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

                {gameState ? (
                  <>
                    <GameStatusBar tableState={tableState} gameState={gameState} />

                    <div style={{ marginTop: 12 }}>
                      <PilesPanel
                        gameState={gameState}
                        intent={intent}
                        onDrawShoe={() => wsSend("DRAW_SHOE")}
                        onDrawDiscard={() => wsSend("DRAW_DISCARD")}
                      />
                    </div>

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

                        const you = gameState?.you;
                        const initialRemaining = you?.initialRevealsRemaining ?? 0;
                        const pendingDraw = gameState?.pendingDraw ?? null;
                        if (pendingDraw != null && initialRemaining === 0) return;

                        // Default click = REVEAL (post-gate reveals end your turn)
                        const isPostGateReveal = initialRemaining === 0 && pendingDraw == null && intent == null;
                        const isFaceDown = isYouFaceDownPos(gameState, pos);
                        if (isPostGateReveal && isFaceDown) {
                          const faceDownCount = youFaceDownCount(gameState);
                          if (faceDownCount <= 1) {
                            openConfirm({
                              title: "End round?",
                              body:
                                "Revealing your last face-down card will end the round for everyone and trigger the final turn. It will also end your turn. Continue?",
                              okText: "Reveal & End Round",
                              cancelText: "Cancel",
                              onOk: () => {
                                wsSend("REVEAL", { pos });
                                closeConfirm();
                              },
                            });
                            return;
                          }

                          openConfirm({
                            title: "End your turn?",
                            body: "This will reveal the selected card and end your turn. Continue?",
                            okText: "Reveal",
                            cancelText: "Cancel",
                            onOk: () => {
                              wsSend("REVEAL", { pos });
                              closeConfirm();
                            },
                          });
                          return;
                        }

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

<div style={{ marginTop: 12 }}>
  <TableViewPanel tableState={tableState} gameState={gameState} />
</div>
                  </>
                ) : null}

                {/* Debug */}
                <details style={{ marginTop: 12 }}>
                  <summary style={{ cursor: "pointer", opacity: 0.85 }}>GAME_STATE (debug)</summary>
                  <pre style={{ background: "#111", padding: 12, borderRadius: 8, overflowX: "auto", marginTop: 8 }}>
                    {gameState ? pretty(gameState) : "(waiting for GAME_STATE...)"}
                  </pre>
                </details>
              </>
            ) : null}
          </div>

          {/* RIGHT: chat + compact card values + owner controls during game */}
          {showRightChat ? (
            <div style={{ display: "grid", gap: 12 }}>
              <ChatPanel chatState={chatState} disabled={wsStatus !== "connected"} onSend={sendChat} title="Chat" />

              {uiNotice ? (
                <div
                  style={{
                    borderRadius: 10,
                    padding: "10px 12px",
                    background: uiNotice.kind === "warn" ? "#2a1a1a" : "#1a1f2a",
                    border: "1px solid rgba(255,255,255,0.10)",
                    opacity: 0.95,
                    fontWeight: 700,
                  }}
                >
                  {uiNotice.text}
                </div>
              ) : null}

              {/* Under chat: reference panels */}
              {phase === "GAME" ? <CardValuesPanel gameState={gameState} /> : null}

              {phase === "GAME" ? (
                <OwnerControlsPanel tableState={tableState} myPlayerId={myPlayerId} wsStatus={wsStatus} wsSend={wsSend} />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
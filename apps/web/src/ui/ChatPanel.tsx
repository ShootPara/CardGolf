// FILE: /apps/web/src/ui/ChatPanel.tsx (REPLACE)

import { useMemo, useState } from "react";

function safePretty(v: any) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

type ChatPanelProps = {
  chatState: any;
  disabled?: boolean;
  onSend: (text: string) => void;
  title?: string;
};

export function ChatPanel({ chatState, disabled, onSend, title = "Chat" }: ChatPanelProps) {
  const [text, setText] = useState("");

  const messages: any[] = useMemo(() => {
    const arr = chatState?.messages;
    return Array.isArray(arr) ? arr : [];
  }, [chatState]);

  function sendNow() {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  }

  return (
    <div
      style={{
        borderRadius: 12,
        padding: 12,
        background: "#141414",
        border: "1px solid rgba(255,255,255,0.08)",
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        gap: 10,
        minHeight: 420,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <span style={{ opacity: 0.7, fontSize: 12 }}>{messages.length} msgs</span>
      </div>

      <div
        style={{
          overflowY: "auto",
          padding: 8,
          borderRadius: 10,
          background: "#0f0f0f",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {messages.length === 0 ? (
          <div style={{ opacity: 0.7, fontStyle: "italic" }}>No messages yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {messages.map((m, idx) => {
              // protocol.ts: ChatMessage { ts, from:{email}, text }
              const who =
                m?.from?.displayName ?? m?.from?.email ??
                m?.from?.id ??
                m?.email ??
                m?.playerId ??
                "someone";

              const body = m?.text ?? m?.message ?? m?.body ?? null;
              const ts = m?.ts ?? m?.createdAt ?? m?.time ?? null;

              return (
                <div
                  key={m?.id ?? idx}
                  style={{
                    padding: 10,
                    borderRadius: 12,
                    background: "#171717",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
                    <strong style={{ fontSize: 13 }}>{who}</strong>
                    {ts ? <span style={{ opacity: 0.6, fontSize: 12 }}>{String(ts)}</span> : null}
                  </div>
                  <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
                    {body != null ? String(body) : <code style={{ opacity: 0.85 }}>{safePretty(m)}</code>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={text}
          disabled={!!disabled}
          onChange={(e) => setText(e.target.value)}
          placeholder={disabled ? "Chat disabled" : "Type chat..."}
          style={{ flex: 1 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") sendNow();
          }}
        />
        <button disabled={!!disabled} onClick={sendNow}>
          Send
        </button>
      </div>
    </div>
  );
}
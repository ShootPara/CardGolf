// FILE: /apps/web/src/ui/ConfirmModal.tsx (NEW)
//
// Website-style modal confirmation dialog (no native alert/confirm).
//
// Usage (example):
//   <ConfirmModal title="..." body="..." onOk={...} onCancel={...} />

import { useEffect } from "react";

type ConfirmModalProps = {
  title: string;
  body: string;
  okText?: string;
  cancelText?: string;
  onOk: () => void;
  onCancel: () => void;
};

export function ConfirmModal({ title, body, okText, cancelText, onOk, onCancel }: ConfirmModalProps) {
  const ok = okText ?? "OK";
  const cancel = cancelText ?? "Cancel";

  // ESC closes
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        // click-outside to cancel (but only if the backdrop itself was clicked)
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          background: "#141414",
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
          padding: 16,
          color: "white",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{title}</div>
          <button
            onClick={onCancel}
            style={{
              background: "transparent",
              color: "rgba(255,255,255,0.8)",
              border: "1px solid rgba(255,255,255,0.18)",
              borderRadius: 10,
              padding: "6px 10px",
              cursor: "pointer",
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div style={{ marginTop: 10, lineHeight: 1.35, color: "rgba(255,255,255,0.92)" }}>{body}</div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <button
            onClick={onCancel}
            style={{
              background: "rgba(255,255,255,0.06)",
              color: "white",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 12,
              padding: "10px 12px",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            {cancel}
          </button>

          <button
            onClick={onOk}
            style={{
              background: "rgba(100,160,255,0.25)",
              color: "white",
              border: "1px solid rgba(120,190,255,0.35)",
              borderRadius: 12,
              padding: "10px 12px",
              cursor: "pointer",
              fontWeight: 800,
            }}
            autoFocus
          >
            {ok}
          </button>
        </div>
      </div>
    </div>
  );
}

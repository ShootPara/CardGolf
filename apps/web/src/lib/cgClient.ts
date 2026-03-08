// FILE: /apps/web/src/lib/cgClient.ts (NEW)
//
// Web + WS client for CardGolf UI.
// Uses Vite proxy: /api/* and /ws/*

import type { DevSession, WsEnvelope } from "./cgTypes";

/* ---------------------------------------------
 * Section: HTTP helpers
 * --------------------------------------------- */

export async function apiPost<T = any>(
  path: string,
  devEmail: string,
  body?: any
): Promise<T> {
  const url = `${path}${path.includes("?") ? "&" : "?"}dev_email=${encodeURIComponent(devEmail)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* allow non-json */ }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return (json ?? (text as any)) as T;
}

/* ---------------------------------------------
 * Section: WS client
 * --------------------------------------------- */

export type CgWsHandlers = {
  onOpen?: () => void;
  onClose?: (ev: CloseEvent) => void;
  onError?: (ev: Event) => void;
  onMessage?: (msg: WsEnvelope) => void;
  onRawMessage?: (raw: MessageEvent) => void;
};

export class CgWs {
  private ws: WebSocket | null = null;
  private session: DevSession;
  private handlers: CgWsHandlers;

  constructor(session: DevSession, handlers: CgWsHandlers) {
    this.session = session;
    this.handlers = handlers;
  }
  connect() {
    if (!this.session.tableId) throw new Error("tableId required to connect");

    // Vite dev proxy will forward /ws to wrangler
    const url =
      `/ws/table/${encodeURIComponent(this.session.tableId)}` +
      `?role=${encodeURIComponent(this.session.role)}` +
      `&dev_email=${encodeURIComponent(this.session.devEmail)}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => this.handlers.onOpen?.();
    this.ws.onclose = (ev) => this.handlers.onClose?.(ev);
    this.ws.onerror = (ev) => this.handlers.onError?.(ev);
    this.ws.onmessage = (ev) => {
      this.handlers.onRawMessage?.(ev);
      try {
        const parsed = JSON.parse(String(ev.data)) as WsEnvelope;
        this.handlers.onMessage?.(parsed);
      } catch {
        // If server ever sends non-json (shouldn't), still surface it
        this.handlers.onMessage?.({ type: "ERROR", payload: { message: String(ev.data) } });
      }
    };
  }

  close() {
    this.ws?.close();
    this.ws = null;
  }

  send(type: string, payload?: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not open");
    }
    this.ws.send(JSON.stringify({ type, payload }));
  }
}
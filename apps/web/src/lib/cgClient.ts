// FILE: /apps/web/src/lib/cgClient.ts (REPLACE)
//
// Web + WS client for CardGolf UI.
//
// Dev (localhost):
// - Uses Vite proxy: /api/* and /ws/*
// - Appends ?dev_email=... for dev auth
//
// Prod (Cloudflare Access):
// - Uses same-origin /api/* and /ws/*
// - Does NOT append dev_email (identity comes from Access headers)

import type { DevSession, WsEnvelope } from "./cgTypes";

/* ---------------------------------------------
 * Section: Environment helpers
 * --------------------------------------------- */

function isLocalHost(): boolean {
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

/** Only attach dev_email when running locally. */
function withDevEmail(pathOrUrl: string, devEmail: string): string {
  if (!isLocalHost()) return pathOrUrl;
  const join = pathOrUrl.includes("?") ? "&" : "?";
  return `${pathOrUrl}${join}dev_email=${encodeURIComponent(devEmail)}`;
}

/* ---------------------------------------------
 * Section: HTTP helpers
 * --------------------------------------------- */

export async function apiPost<T = any>(path: string, devEmail: string, body?: any): Promise<T> {
  const url = withDevEmail(path, devEmail);

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* allow non-json */
  }

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

  constructor(private session: DevSession, private handlers: CgWsHandlers) {}

  connect() {
    if (!this.session.tableId) throw new Error("tableId required to connect");

    // Same-origin WS path.
    // Dev auth uses dev_email locally only.
    let url =
      `/ws/table/${encodeURIComponent(this.session.tableId)}` +
      `?role=${encodeURIComponent(this.session.role)}`;

    url = withDevEmail(url, this.session.devEmail);

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

/**
 * FILE: /worker/src/index.ts (REPLACE)
 *
 * Routes:
 * - GET  /health
 * - POST /api/table/create
 * - POST /api/table/:id/start
 * - GET  /ws/table/:tableId?role=player|spectator&dev_email=...
 *
 * Key ownership rule:
 * - Worker does NOT try to determine "current owner" (DO owns that).
 * - Worker forwards /start to the DO, passing caller email so the DO can authorize.
 */

import { TableDO, type Env } from "./table_do";
import { validateRulesJson } from "./validate_rules";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    /* =========================
       Health
    ========================= */

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    /* =========================
       Create table
    ========================= */

    if (url.pathname === "/api/table/create" && request.method === "POST") {
      const email = readUserEmail(request);
      if (!email) return json({ ok: false, error: "Unauthorized (missing email)" }, 401);

      const body = await safeReadJson(request);
      if (!body.ok) return json({ ok: false, error: "Invalid JSON body" }, 400);

      const rulesIn = body.value?.rules_json;
      const validated = validateRulesJson(rulesIn);
      if (!validated.ok) return json({ ok: false, error: validated.error }, 400);

      const rules = validated.value;
      const spectatorChatAllowed = rules.uiOptions.allowSpectatorChat;

      const creatorPlayerId = makeStableId(email);
      const tableId = makeTableId();

      // Persist table config (creator is the initial owner by spec)
      await env.cardgolf
        .prepare(
          `INSERT INTO tables (table_id, created_at, creator_player_id, rules_json, spectator_chat_allowed, status)
           VALUES (?, datetime('now'), ?, ?, ?, 'open')`
        )
        .bind(tableId, creatorPlayerId, JSON.stringify(rules), spectatorChatAllowed ? 1 : 0)
        .run();

      // Save last table settings for creator (single preset)
      await env.cardgolf
        .prepare(
          `INSERT INTO players (player_id, email, last_table_rules_json, created_at, updated_at)
           VALUES (?, ?, ?, datetime('now'), datetime('now'))
           ON CONFLICT(email) DO UPDATE SET
             last_table_rules_json=excluded.last_table_rules_json,
             updated_at=datetime('now')`
        )
        .bind(creatorPlayerId, email, JSON.stringify(rules))
        .run();

      const join = {
        tableId,
        wsPlayer: `/ws/table/${tableId}?role=player`,
        wsSpectator: `/ws/table/${tableId}?role=spectator`,
      };

      return json({ ok: true, table: join }, 200);
    }

    /* =========================
       Start table
    ========================= */

    // POST /api/table/:id/start
    if (url.pathname.startsWith("/api/table/") && url.pathname.endsWith("/start") && request.method === "POST") {
      const email = readUserEmail(request);
      if (!email) return json({ ok: false, error: "Unauthorized (missing email)" }, 401);

      const parts = url.pathname.split("/").filter(Boolean); // ["api","table",":id","start"]
      const tableId = parts.length === 4 ? parts[2] : "";
      if (!tableId) return json({ ok: false, error: "Missing tableId" }, 400);

      // Delegate authorization + D1 status update to the DO.
      // This prevents "creator vs first-joiner" drift and supports delegation cleanly.
      const id = env.TABLES.idFromName(tableId);
      const stub = env.TABLES.get(id);

      const doUrl = new URL("https://do.internal/start");
      doUrl.searchParams.set("table_id", tableId);

      const doResp = await stub.fetch(doUrl.toString(), {
        method: "POST",
        headers: {
          // Let DO authenticate consistently
          "x-forwarded-email": email,
        },
      });

      // Pass through (best-effort JSON)
      const text = await doResp.text();
      const contentType = doResp.headers.get("content-type") ?? "";

      if (contentType.includes("application/json")) {
        return new Response(text, { status: doResp.status, headers: { "content-type": contentType } });
      }

      // If DO returned text/plain etc, wrap in JSON for consistency
      if (doResp.ok) return json({ ok: true }, 200);
      return json({ ok: false, error: text || "Start failed" }, doResp.status || 500);
    }

    /* =========================
       WebSocket router
    ========================= */

    if (url.pathname.startsWith("/ws/table/")) {
      const tableId = url.pathname.replace("/ws/table/", "").trim();
      if (!tableId) return new Response("Missing tableId", { status: 400 });

      const id = env.TABLES.idFromName(tableId);
      const stub = env.TABLES.get(id);

      const doUrl = new URL(request.url);
      doUrl.pathname = "/ws";

      // Pass tableId explicitly so DO doesn't depend on state.id.name
      doUrl.searchParams.set("table_id", tableId);

      const doReq = new Request(doUrl.toString(), request);
      return stub.fetch(doReq);
    }

    return new Response("Not found", { status: 404 });
  },
};

export { TableDO };

/* =========================
   Helpers
========================= */

async function safeReadJson(req: Request): Promise<{ ok: true; value: any } | { ok: false }> {
  try {
    const txt = await req.text();
    if (!txt) return { ok: false };
    return { ok: true, value: JSON.parse(txt) };
  } catch {
    return { ok: false };
  }
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function readUserEmail(req: Request): string | null {
  const url = new URL(req.url);

  // Local dev convenience: allow ?dev_email=
  const host = url.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (isLocal) {
    const devEmail = (url.searchParams.get("dev_email") ?? "").trim();
    if (devEmail) return devEmail;
  }

  // Production: trust Cloudflare Access headers only.
  // (Do NOT accept x-forwarded-email from the public internet.)
  const h =
    req.headers.get("cf-access-authenticated-user-email") ||
    req.headers.get("Cf-Access-Authenticated-User-Email");

  return h ? h.trim() : null;
}

function makeStableId(email: string): string {
  return "p_" + simpleHash(email.toLowerCase());
}

function makeTableId(): string {
  // short, URL-friendly; good enough for v0
  return Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36).slice(2, 8);
}

function simpleHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
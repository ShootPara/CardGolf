/**
 * FILE: /worker/src/index.ts (REPLACE)
 *
 * Routes:
 * - GET  /health
 * - POST /api/table/create
 * - POST /api/table/:id/start
 * - GET  /ws/table/:tableId?role=player|spectator&dev_email=...
 *
 * Hotfix goals:
 * - Never let /api/table/create throw an uncaught exception
 * - Make the "save last table settings" players-table write best-effort only
 * - Return clean JSON errors instead of Cloudflare 1101 HTML
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
      try {
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

        // Essential write: the table row itself.
        await env.cardgolf
          .prepare(
            `INSERT INTO tables (table_id, created_at, creator_player_id, rules_json, spectator_chat_allowed, status)
             VALUES (?, datetime('now'), ?, ?, ?, 'open')`
          )
          .bind(tableId, creatorPlayerId, JSON.stringify(rules), spectatorChatAllowed ? 1 : 0)
          .run();

        // Non-essential write: save creator preset.
        // This must never be allowed to break table creation in prod.
        try {
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
        } catch (presetErr) {
          console.error("Create table: failed to save creator preset", errorToLogObject(presetErr));
        }

        const join = {
          tableId,
          wsPlayer: `/ws/table/${tableId}?role=player`,
          wsSpectator: `/ws/table/${tableId}?role=spectator`,
        };

        return json({ ok: true, table: join }, 200);
      } catch (err) {
        console.error("Create table failed", errorToLogObject(err));
        return json(
          {
            ok: false,
            error: "Create table failed",
            detail: errorMessage(err),
          },
          500
        );
      }
    }

    /* =========================
       Start table
    ========================= */

    if (url.pathname.startsWith("/api/table/") && url.pathname.endsWith("/start") && request.method === "POST") {
      try {
        const email = readUserEmail(request);
        if (!email) return json({ ok: false, error: "Unauthorized (missing email)" }, 401);

        const parts = url.pathname.split("/").filter(Boolean); // ["api","table",":id","start"]
        const tableId = parts.length === 4 ? parts[2] : "";
        if (!tableId) return json({ ok: false, error: "Missing tableId" }, 400);

        const id = env.TABLES.idFromName(tableId);
        const stub = env.TABLES.get(id);

        const doUrl = new URL("https://do.internal/start");
        doUrl.searchParams.set("table_id", tableId);

        const doResp = await stub.fetch(doUrl.toString(), {
          method: "POST",
          headers: {
            "x-forwarded-email": email,
          },
        });

        const text = await doResp.text();
        const contentType = doResp.headers.get("content-type") ?? "";

        if (contentType.includes("application/json")) {
          return new Response(text, {
            status: doResp.status,
            headers: { "content-type": contentType },
          });
        }

        if (doResp.ok) return json({ ok: true }, 200);
        return json({ ok: false, error: text || "Start failed" }, doResp.status || 500);
      } catch (err) {
        console.error("Start table failed", errorToLogObject(err));
        return json(
          {
            ok: false,
            error: "Start table failed",
            detail: errorMessage(err),
          },
          500
        );
      }
    }

    /* =========================
       WebSocket router
    ========================= */

    if (url.pathname.startsWith("/ws/table/")) {
      try {
        const tableId = url.pathname.replace("/ws/table/", "").trim();
        if (!tableId) return new Response("Missing tableId", { status: 400 });

        const id = env.TABLES.idFromName(tableId);
        const stub = env.TABLES.get(id);

        const doUrl = new URL(request.url);
        doUrl.pathname = "/ws";
        doUrl.searchParams.set("table_id", tableId);

        const doReq = new Request(doUrl.toString(), request);
        return stub.fetch(doReq);
      } catch (err) {
        console.error("WS route failed", errorToLogObject(err));
        return json(
          {
            ok: false,
            error: "WebSocket route failed",
            detail: errorMessage(err),
          },
          500
        );
      }
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

  // Production: trust Cloudflare Access only.
  const h =
    req.headers.get("cf-access-authenticated-user-email") ||
    req.headers.get("Cf-Access-Authenticated-User-Email");

  return h ? h.trim() : null;
}

function makeStableId(email: string): string {
  return "p_" + simpleHash(email.toLowerCase());
}

function makeTableId(): string {
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

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return String(err);
  } catch {
    return "Unknown error";
  }
}

function errorToLogObject(err: unknown) {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack ?? "",
    };
  }
  return { value: errorMessage(err) };
}
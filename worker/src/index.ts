/**
 * FILE: /worker/src/index.ts (REPLACE)
 *
 * Routes:
 * - GET /health                     simple check
 * - GET /ws/table/:tableId?role=...  upgrades to WebSocket handled by TableDO
 *
 * Notes:
 * - Table state is in Durable Object memory only.
 * - D1 is bound as env.cardgolf (we will use it later for stats).
 */

import { TableDO, type Env } from "./table_do";

/* =========================
   Worker Entrypoint
========================= */

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    // WebSocket table endpoint: /ws/table/:tableId
    // Example:
    //   wss://<worker>/ws/table/abc123?role=player
    //   wss://<worker>/ws/table/abc123?role=spectator
    if (url.pathname.startsWith("/ws/table/")) {
      const tableId = url.pathname.replace("/ws/table/", "").trim();
      if (!tableId) return new Response("Missing tableId", { status: 400 });

      const id = env.TABLES.idFromName(tableId);
      const stub = env.TABLES.get(id);

      // Forward request to the DO; DO expects /ws
      const doUrl = new URL(request.url);
      doUrl.pathname = "/ws";

      return stub.fetch(doUrl.toString(), request);
    }

    return new Response("Not found", { status: 404 });
  },
};

/* =========================
   Durable Objects Exports
========================= */

export { TableDO };

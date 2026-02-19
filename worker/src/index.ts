/**
 * FILE: /worker/src/index.ts (REPLACE)
 *
 * Routes:
 * - GET /health
 * - GET /ws/table/:tableId?role=...&dev_email=...  -> forwards to TableDO /ws
 */

import { TableDO, type Env } from "./table_do";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    if (url.pathname.startsWith("/ws/table/")) {
      const tableId = url.pathname.replace("/ws/table/", "").trim();
      if (!tableId) return new Response("Missing tableId", { status: 400 });

      const id = env.TABLES.idFromName(tableId);
      const stub = env.TABLES.get(id);

      // Rewrite the request URL to DO's /ws endpoint, preserving search params (role, dev_email, etc.)
      const doUrl = new URL(request.url);
      doUrl.pathname = "/ws";

      // ✅ IMPORTANT: create a real Request object for the DO
      const doReq = new Request(doUrl.toString(), request);

      return stub.fetch(doReq);
    }

    return new Response("Not found", { status: 404 });
  },
};

export { TableDO };

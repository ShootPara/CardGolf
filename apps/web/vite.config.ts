// FILE: /apps/web/vite.config.ts (REPLACE)
//
// Dev-only proxy to local wrangler.
// Production build uses same-origin /api/* and /ws/* (no proxy).

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const DEFAULT_WORKER_HTTP = "http://127.0.0.1:8787";
const DEFAULT_WORKER_WS = "ws://127.0.0.1:8787";

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "");

  const WORKER_HTTP = env.VITE_WORKER_HTTP || DEFAULT_WORKER_HTTP;
  const WORKER_WS = env.VITE_WORKER_WS || DEFAULT_WORKER_WS;

  return {
    plugins: [react()],
    server:
      command === "serve"
        ? {
            proxy: {
              "/api": { target: WORKER_HTTP, changeOrigin: true },
              "/ws": { target: WORKER_WS, ws: true, changeOrigin: true },
            },
          }
        : undefined,
  };
});

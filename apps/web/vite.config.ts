// FILE: /apps/web/vite.config.ts (REPLACE)
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Local worker dev endpoints (wrangler dev)
// HTTP: http://127.0.0.1:8787
// WS:   ws://127.0.0.1:8787
const WORKER_HTTP = "http://127.0.0.1:8787";
const WORKER_WS = "ws://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // REST API
      "/api": {
        target: WORKER_HTTP,
        changeOrigin: true,
      },

      // WebSocket
      "/ws": {
        target: WORKER_WS,
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
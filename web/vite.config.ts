import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies the API to the Go backend on :8080. Auth is OIDC: the
// session cookie passes through the proxy (the browser sees a single origin),
// so no request headers are injected.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
});

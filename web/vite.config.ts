import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies the API to the Go backend on :8080. In dev-auth mode it
// injects X-Dev-* headers on every proxied request so that EventSource (SSE),
// which cannot set headers, also authenticates.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const devHeaders: Record<string, string> = {};
  if (env.VITE_DEV_AUTH === "true") {
    if (env.VITE_DEV_TEAMS) devHeaders["X-Dev-Teams"] = env.VITE_DEV_TEAMS;
    if (env.VITE_DEV_ROLE) devHeaders["X-Dev-Role"] = env.VITE_DEV_ROLE;
  }
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: "http://localhost:8080",
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              for (const [k, v] of Object.entries(devHeaders)) {
                proxyReq.setHeader(k, v);
              }
            });
          },
        },
      },
    },
  };
});

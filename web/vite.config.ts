import { cpSync, createReadStream, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Absolute path to Monaco's prebuilt AMD bundle (min/vs).
const vsDir = fileURLToPath(new URL("./node_modules/monaco-editor/min/vs", import.meta.url));

const MIME: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".map": "application/json",
  ".html": "text/html",
};

// selfHostMonaco serves Monaco's AMD build from /monaco/vs on our own origin: a
// dev middleware reads it from node_modules, and the production build copies it
// into dist (embedded by the Go portal). This removes the runtime dependency on
// the jsdelivr CDN (the @monaco-editor/loader default), so the editor works in
// closed networks. Paired with loader.config() in src/lib/monaco.ts. Monaco is
// fetched lazily (only when an editor mounts), so the JS bundle is unaffected.
function selfHostMonaco(): Plugin {
  return {
    name: "self-host-monaco",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (!url.startsWith("/monaco/vs/")) return next();
        const file = resolve(vsDir, url.slice("/monaco/vs/".length));
        if (!file.startsWith(vsDir) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader("Content-Type", MIME[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream");
        createReadStream(file).pipe(res);
      });
    },
    writeBundle() {
      cpSync(vsDir, fileURLToPath(new URL("./dist/monaco/vs", import.meta.url)), { recursive: true });
    },
  };
}

// Dev server proxies the API to the Go backend on :8080. Auth is OIDC: the
// session cookie passes through the proxy (the browser sees a single origin),
// so no request headers are injected.
export default defineConfig({
  plugins: [react(), selfHostMonaco()],
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

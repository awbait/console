import { copyFileSync, cpSync, createReadStream, existsSync, renameSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ResolvedConfig } from "vite";

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
// into the output directory (dist, embedded by the Go portal; or the
// playground's). This removes the runtime dependency on the jsdelivr CDN (the
// @monaco-editor/loader default), so the editor works in closed networks.
// Paired with loader.config() in src/lib/monaco.ts. Monaco is fetched lazily
// (only when an editor mounts), so the JS bundle is unaffected.
function selfHostMonaco(): Plugin {
  let outDir = "dist";
  return {
    name: "self-host-monaco",
    configResolved(config) {
      outDir = config.build.outDir;
    },
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
      cpSync(vsDir, resolve(outDir, "monaco/vs"), { recursive: true });
    },
  };
}

// The view playground (playground.html, src/playground) is the version
// constructor with no portal behind it, published to GitHub Pages. It needs
// one thing from outside web/: the format of the view document, which the
// portal keeps in Go (internal/views/document.schema.json) and serves over the
// API. The source cannot import it - the portal's Docker build copies web/
// alone - so the dev server serves the file and the playground build lays a
// copy next to the bundle, and the page fetches it like any static asset.
const formatSchema = fileURLToPath(new URL("../internal/views/document.schema.json", import.meta.url));
const FORMAT_URL = "/view-document.schema.json";

function playgroundAssets(enabled: boolean): Plugin {
  let config: ResolvedConfig;
  return {
    name: "playground-assets",
    configResolved(c) {
      config = c;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== FORMAT_URL || !existsSync(formatSchema)) return next();
        res.setHeader("Content-Type", MIME[".json"]);
        createReadStream(formatSchema).pipe(res);
      });
    },
    writeBundle() {
      if (!enabled) return;
      const out = config.build.outDir;
      copyFileSync(formatSchema, resolve(out, FORMAT_URL.slice(1)));
      // Pages serves index.html; the entry keeps its own name in the source
      // tree so the portal's index.html stays the portal's.
      renameSync(resolve(out, "playground.html"), resolve(out, "index.html"));
    },
  };
}

// Dev server proxies the API to the Go backend on :8080. Auth is OIDC: the
// session cookie passes through the proxy (the browser sees a single origin),
// so no request headers are injected.
//
// `vite build --mode playground` builds the playground instead of the portal:
// its own entry, its own output directory, and the base path of the GitHub
// Pages site (PLAYGROUND_BASE to publish it elsewhere).
export default defineConfig(({ mode }) => {
  const playground = mode === "playground";
  return {
    base: playground ? (process.env.PLAYGROUND_BASE ?? "/console/") : "/",
    plugins: [react(), selfHostMonaco(), playgroundAssets(playground)],
    // "@/x" is src/x. Declared in tsconfig.json too (and read from there by tsc
    // and by bun test); all three have to agree, so change them together.
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    build: playground
      ? {
          outDir: "dist-playground",
          rollupOptions: { input: fileURLToPath(new URL("./playground.html", import.meta.url)) },
        }
      : undefined,
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: "http://localhost:8080",
          changeOrigin: true,
        },
      },
    },
  };
});

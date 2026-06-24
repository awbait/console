// Self-host the Monaco editor. By default @monaco-editor/loader fetches the
// editor core from the jsdelivr CDN at runtime, which breaks in closed networks
// with no internet egress. Point the loader at /monaco/vs instead - the AMD
// build copied into the bundle by vite-plugin-static-copy (see vite.config.ts)
// and served by the portal from its own origin.
//
// This is a side-effect module: import it once, before any editor mounts (main.tsx).
// BASE_URL is the app's base path (default "/"), so workers resolve correctly too.
import { loader } from "@monaco-editor/react";

loader.config({ paths: { vs: `${import.meta.env.BASE_URL}monaco/vs` } });

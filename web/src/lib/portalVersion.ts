// Telling an open page that the portal behind it has been replaced.
//
// The page is the bundle the browser fetched when it was opened, and it keeps
// running that bundle for as long as the tab lives - hours, often days. After a
// deploy it talks to a newer server with older code: screens it has not loaded
// yet are gone from the server, and what changed in the interface is not there
// until somebody reloads. Nothing tells them to.
//
// The page has no version of its own baked in, so it asks the server once on
// start (GET /api/v1/info) and treats that answer as the build it was served
// with. Both come from the same binary at the same moment, so the two agree
// except during a rollout, when the next check sets it right.

import type { AboutInfo } from "../api/types";

// buildId names one build of the portal. The version alone is not enough
// between releases: two builds from different commits may carry the same
// version, so the commit goes along. An unstamped build ("dev", or no version
// at all) is a developer's machine, where every restart is the same "build",
// and is never compared.
export function buildId(info: Pick<AboutInfo, "version" | "commit">): string | null {
  const version = info.version?.trim() ?? "";
  if (version === "" || version === "dev") return null;
  return `${version}@${info.commit?.trim() ?? ""}`;
}

// A screen opened for the first time after a deploy is fetched by the name the
// old bundle knows, and the new server no longer has that file (hashed assets
// are 404 once replaced). Vite reports the failed import as "vite:preloadError".
// The one cure is the page the server serves now, so the page reloads, landing
// on the screen that was being opened. Only once a minute: a file that is still
// missing after a fresh page is not a stale bundle, and reloading in a loop
// would hide the error behind a blinking page.
const RELOADED_AT = "console:stale-chunk-reload";
const RELOAD_GAP_MS = 60_000;

export function shouldReloadForStaleChunk(now: number, lastReload: number | null): boolean {
  return lastReload === null || now - lastReload > RELOAD_GAP_MS;
}

export function reloadOnStaleChunk() {
  window.addEventListener("vite:preloadError", () => {
    const now = Date.now();
    const last = Number(sessionStorage.getItem(RELOADED_AT)) || null;
    if (!shouldReloadForStaleChunk(now, last)) return; // the error goes on to the page
    sessionStorage.setItem(RELOADED_AT, String(now));
    window.location.reload();
  });
}

// VersionWatch remembers the build the page started on and reports a different
// one. It holds no timers and makes no requests: the caller decides when to ask
// and feeds the answers in, which keeps the decision itself testable.
export class VersionWatch {
  private started: string | null = null;

  // seen takes one answer from the server and returns the version to announce,
  // or null when there is nothing new. The first build that can be compared is
  // the one the page started on.
  seen(info: Pick<AboutInfo, "version" | "commit">): string | null {
    const id = buildId(info);
    if (id === null) return null;
    if (this.started === null) {
      this.started = id;
      return null;
    }
    return id === this.started ? null : info.version.trim();
  }
}

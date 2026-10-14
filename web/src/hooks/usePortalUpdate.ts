import { useEffect, useState } from "react";
import { api } from "../api/client";
import { VersionWatch } from "../lib/portalVersion";
import { onStreamReopened } from "../lib/sse";

// A tab nobody touches still gets told, just later.
const CHECK_EVERY_MS = 10 * 60_000;

// usePortalUpdate returns the version of the portal that replaced the one this
// page was loaded from, or null while they are the same (see portalVersion.ts).
//
// It asks when a deploy is most likely to have just happened - a live stream
// coming back after a break, the person returning to the tab - and every few
// minutes in between. Once a newer build has been seen it stays announced: in
// the middle of a rollout the next answer may come from an old replica, and
// the page is still older than the newest portal there is.
export function usePortalUpdate(): string | null {
  const [fresh, setFresh] = useState<string | null>(null);

  useEffect(() => {
    const watch = new VersionWatch();
    let alive = true;
    const check = () => {
      api
        .getAbout()
        .then((info) => {
          if (!alive) return;
          const v = watch.seen(info);
          if (v) setFresh(v);
        })
        .catch(() => {
          /* the next check asks again */
        });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };

    check();
    const off = onStreamReopened(check);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => {
      alive = false;
      off();
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, []);

  return fresh;
}

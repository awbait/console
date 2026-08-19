import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";
import { api, setUpstreamFailureHandler } from "../api/client";
import { qk } from "../api/queryKeys";
import type { CapabilityStatus } from "../api/types";
import { useAsync } from "../hooks/useAsync";
import { type CapabilityText, capabilityText } from "./capabilities";

// How often the portal re-asks what still works. The backend probes the
// upstreams on its own schedule and answers from memory, so this poll costs a
// cached read - it is set by how fast a person should learn that ordering came
// back, not by what the upstreams can take.
const REFRESH_MS = 15_000;

// After a request fails against an upstream the answer is re-asked at once, and
// again shortly after: the first ask usually beats the backend's own confirming
// probe, which needs a second failed check before it calls a component down.
const RECHECK_AFTER_FAILURE_MS = 4_000;

export interface CapabilityView extends CapabilityText {
  id: string;
  ok: boolean;
}

interface PlatformHealthState {
  // Every capability the backend reports, in its order.
  capabilities: CapabilityView[];
  // The broken ones, for the banner and the popover.
  degraded: CapabilityView[];
  // False while at least one capability is down.
  healthy: boolean;
  // True until the first answer arrives, and while it cannot be fetched at all.
  // Nothing is blocked in that state: an unknown platform is not a broken one.
  unknown: boolean;
  // False once the portal itself stops answering. That is a different thing from
  // a capability being down: the portal has no verdict at all, not even a bad
  // one. Actions inside the portal stay open on it (a request that fails shows
  // its own error), but a step that leaves the interface has nowhere to report
  // back to and asks about this first.
  reachable: boolean;
  // Whether one capability works. Unknown capabilities read as working.
  ok: (id: string) => boolean;
  // Why an action is blocked right now, or undefined when it is not. Meant to be
  // passed straight into a disabled control's tooltip.
  blockedReason: (id: string) => string | undefined;
}

const HEALTHY: PlatformHealthState = {
  capabilities: [],
  degraded: [],
  healthy: true,
  unknown: true,
  reachable: true,
  ok: () => true,
  blockedReason: () => undefined,
};

const Ctx = createContext<PlatformHealthState>(HEALTHY);

// PlatformHealthProvider polls what the portal can currently do and shares it
// with the whole app. It sits above the session on purpose: the sign-in screen
// has to know whether signing in works, and that is exactly when there is no
// session yet.
export function PlatformHealthProvider({ children }: { children: ReactNode }) {
  const { data, error, reload } = useAsync(
    (signal) => api.getPlatformHealth(signal),
    [],
    qk.platformHealth(),
    { refetchInterval: REFRESH_MS },
  );

  // A failed request is news: the user is already looking at an error, so the
  // portal asks what still works right now rather than on the next tick. The
  // backend gets the same nudge (it re-probes on a 502), and the delayed second
  // ask is there to catch the verdict once its confirming probe has run.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    setUpstreamFailureHandler(() => {
      reload();
      if (timer) clearTimeout(timer);
      timer = setTimeout(reload, RECHECK_AFTER_FAILURE_MS);
    });
    return () => {
      setUpstreamFailureHandler(null);
      if (timer) clearTimeout(timer);
    };
    // reload is stable for this query key; re-registering on every render would
    // only churn the handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<PlatformHealthState>(() => {
    // A failed or pending health request leaves the portal in the "unknown"
    // state rather than the "broken" one: the endpoint being unreachable is not
    // evidence that ordering is down, and blocking buttons on a guess is worse
    // than letting a request fail with its own error.
    // Reachability is reported even in that state, and it is the one thing a
    // failed request does say for certain: the poll keeps running, so the answer
    // comes back on its own once the portal does.
    if (!data) return error ? { ...HEALTHY, reachable: false } : HEALTHY;
    const capabilities = (data.capabilities ?? []).map((c: CapabilityStatus) => ({
      id: c.id,
      ok: c.ok,
      ...capabilityText(c.id),
    }));
    const degraded = capabilities.filter((c) => !c.ok);
    const broken = new Set(degraded.map((c) => c.id));
    return {
      capabilities,
      degraded,
      healthy: degraded.length === 0,
      unknown: false,
      // An answer that arrived earlier keeps describing the capabilities, but it
      // stops being evidence that the portal is still there: a page left open
      // outlives the backend it was loaded from.
      reachable: !error,
      ok: (id) => !broken.has(id),
      blockedReason: (id) => (broken.has(id) ? capabilityText(id).impact : undefined),
    };
  }, [data, error]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlatformHealth() {
  return useContext(Ctx);
}

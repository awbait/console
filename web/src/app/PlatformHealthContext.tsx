import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";
import { api } from "../api/client";
import { qk } from "../api/queryKeys";
import type { CapabilityStatus } from "../api/types";
import { useAsync } from "../hooks/useAsync";
import { type CapabilityText, capabilityText } from "./capabilities";

// How often the portal re-asks what still works. The backend probes the
// upstreams on its own schedule and answers from memory, so this poll costs a
// cached read - it is set by how fast a person should learn that ordering came
// back, not by what the upstreams can take.
const REFRESH_SECONDS = 30;

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
  ok: () => true,
  blockedReason: () => undefined,
};

const Ctx = createContext<PlatformHealthState>(HEALTHY);

// PlatformHealthProvider polls what the portal can currently do and shares it
// with the whole app. It sits above the session on purpose: the sign-in screen
// has to know whether signing in works, and that is exactly when there is no
// session yet.
export function PlatformHealthProvider({ children }: { children: ReactNode }) {
  const { data, reload } = useAsync((signal) => api.getPlatformHealth(signal), [], qk.platformHealth());

  useEffect(() => {
    const t = setInterval(reload, REFRESH_SECONDS * 1000);
    return () => clearInterval(t);
    // reload is stable per query key; re-subscribing on every render would reset
    // the interval and effectively stop the poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<PlatformHealthState>(() => {
    // A failed or pending health request leaves the portal in the "unknown"
    // state rather than the "broken" one: the endpoint being unreachable is not
    // evidence that ordering is down, and blocking buttons on a guess is worse
    // than letting a request fail with its own error.
    if (!data) return HEALTHY;
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
      ok: (id) => !broken.has(id),
      blockedReason: (id) => (broken.has(id) ? capabilityText(id).impact : undefined),
    };
  }, [data]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlatformHealth() {
  return useContext(Ctx);
}

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { subscribe } from "@/lib/sse";
import { type BoardView, toView } from "./view";

// How often the board reads itself again without a signal. The streams below
// say when an order or a notification changed; presence, checks and the
// component monitor have no stream of their own, and this is how fresh they
// stay. The same rhythm as the status page.
const REFRESH_MS = 30_000;

// Signals arrive in bursts (one status change per order of a stand job), and
// each would otherwise be a full read. Reads within this window fold into one.
const SIGNAL_DEBOUNCE_MS = 1_000;

export interface AdminBoardState {
  data: BoardView | null;
  // Set only while there is nothing to show: once the board has data, a
  // failed read is reported through offline, over the last good data.
  error: Error | null;
  // When the last read succeeded, ms since the epoch; 0 before the first.
  updatedAt: number;
  // The last read failed: what is on screen is as of updatedAt.
  offline: boolean;
}

// useAdminBoard keeps the board fresh: a read on mount, on every signal from
// the order and notification streams, and on a timer. The page shows how old
// its data is from updatedAt/offline, so a stream that quietly died or a
// portal that went away is visible instead of a page that just stops moving.
export function useAdminBoard(): AdminBoardState {
  const [state, setState] = useState<AdminBoardState>({ data: null, error: null, updatedAt: 0, offline: false });
  const inflight = useRef<AbortController | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    // A newer read replaces one still in flight, so a slow old answer cannot
    // land on top of a fresh one.
    inflight.current?.abort();
    const ctl = new AbortController();
    inflight.current = ctl;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    try {
      const b = await api.getAdminBoard(tz, ctl.signal);
      if (ctl.signal.aborted) return;
      setState({ data: toView(b), error: null, updatedAt: Date.now(), offline: false });
    } catch (err) {
      if (ctl.signal.aborted) return;
      const e = err instanceof Error ? err : new Error(String(err));
      setState((s) => ({ ...s, error: s.data ? null : e, offline: true }));
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    const soon = () => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(load, SIGNAL_DEBOUNCE_MS);
    };
    const offOrders = subscribe("/api/v1/requests/events", { status_changed: soon }, "board-orders");
    const offNotes = subscribe("/api/v1/notifications/events", { notifications_changed: soon }, "board-notifications");
    return () => {
      clearInterval(timer);
      if (debounce.current) clearTimeout(debounce.current);
      inflight.current?.abort();
      offOrders();
      offNotes();
    };
  }, [load]);

  return state;
}

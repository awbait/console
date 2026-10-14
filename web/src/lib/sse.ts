// Live updates use Server-Sent Events.
//
// The browser reconnects on its own after a transient drop, but only then: when
// the response itself is wrong - the portal restarting mid-handshake, a proxy
// answering 502, an endpoint this build of the server does not have - the stream
// goes to CLOSED and stays there. The page then looks alive and quietly stops
// updating until somebody reloads it, which is the worst of both.
//
// So reconnection is ours to do: subscribe reopens a closed stream with a
// growing pause between attempts, and gives up nothing. The pause matters -
// a portal that is down would otherwise be asked once a second by every open
// tab.

const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

// A stream that comes back after a break is the moment the portal is most
// likely to have been redeployed under the page: the connection dropped because
// the server went away, and what answers now may be a newer build. Whoever cares
// about that (the new-version notice) listens here rather than polling blind.
const reopenListeners = new Set<() => void>();

// onStreamReopened calls fn every time any stream opens again after a break.
// The returned function unsubscribes.
export function onStreamReopened(fn: () => void): () => void {
  reopenListeners.add(fn);
  return () => {
    reopenListeners.delete(fn);
  };
}

// subscribe opens an event stream and keeps it open. `handlers` maps event names
// to what to do; the returned function closes the stream and stops retrying, and
// is what an effect returns for cleanup.
export function subscribe(url: string, handlers: Record<string, () => void>, label: string): () => void {
  let es: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retry = FIRST_RETRY_MS;
  let stopped = false;
  let opened = false;

  const open = () => {
    if (stopped) return;
    es = new EventSource(url);
    for (const [event, handler] of Object.entries(handlers)) {
      es.addEventListener(event, handler);
    }
    // A stream that opened is a stream that works: the next break starts its
    // waiting over rather than inheriting an hour-long pause from an outage
    // that has since ended.
    // The first open is the page starting up, every later one (ours or the
    // browser's own reconnect) is a stream coming back.
    es.onopen = () => {
      retry = FIRST_RETRY_MS;
      if (opened) for (const fn of reopenListeners) fn();
      opened = true;
    };
    es.onerror = () => {
      const closed = es?.readyState === EventSource.CLOSED;
      console.warn(`sse ${label} ${closed ? "closed" : "reconnecting"}`, { readyState: es?.readyState });
      if (!closed || stopped) return; // the browser is handling it
      es?.close();
      timer = setTimeout(open, retry);
      retry = Math.min(retry * 2, MAX_RETRY_MS);
    };
  };

  open();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    es?.close();
  };
}

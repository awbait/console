// Live updates use Server-Sent Events. The browser reconnects on its own after a
// transient drop, so the app never needs to act on an error - but a prolonged or
// permanent break was previously invisible. attachSseLogger surfaces it in the
// console (readyState CLOSED = the browser gave up; otherwise it is reconnecting)
// so disconnects are at least observable. label identifies the stream.
export function attachSseLogger(es: EventSource, label: string): void {
  es.onerror = () => {
    const closed = es.readyState === EventSource.CLOSED;
    console.warn(`sse ${label} ${closed ? "closed" : "reconnecting"}`, {
      readyState: es.readyState,
    });
  };
}

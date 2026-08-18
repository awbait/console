import { afterEach, describe, expect, test } from "bun:test";
import { subscribe } from "./sse";

// A stand-in for the browser's EventSource: it records what was subscribed to
// and lets a test play the two things that matter - the stream opening, and the
// stream failing in the way the browser does not recover from.
class FakeEventSource {
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readyState = 0;
  listeners: Record<string, () => void> = {};
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(event: string, fn: () => void) {
    this.listeners[event] = fn;
  }
  close() {
    this.closed = true;
  }
  // The browser gave up on this stream (a bad response rather than a drop).
  fail() {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }
  // A drop the browser is already retrying on its own.
  drop() {
    this.readyState = 0;
    this.onerror?.();
  }
}

const realEventSource = globalThis.EventSource;
const realSetTimeout = globalThis.setTimeout;
const delays: number[] = [];

function install() {
  FakeEventSource.instances = [];
  delays.length = 0;
  // @ts-expect-error - the fake is only as much of EventSource as sse.ts uses
  globalThis.EventSource = FakeEventSource;
  // Run every scheduled reopen at once, recording how long it would have waited.
  // @ts-expect-error - same shape, minus the timing
  globalThis.setTimeout = (fn: () => void, ms: number) => {
    delays.push(ms);
    fn();
    return 0;
  };
}

afterEach(() => {
  globalThis.EventSource = realEventSource;
  globalThis.setTimeout = realSetTimeout;
});

describe("subscribe", () => {
  test("delivers the events it was asked for", () => {
    install();
    let seen = 0;
    const stop = subscribe("/api/v1/x/events", { thing_happened: () => seen++ }, "x");
    FakeEventSource.instances[0].listeners.thing_happened();
    expect(seen).toBe(1);
    stop();
  });

  test("reopens a stream the browser gave up on", () => {
    install();
    const stop = subscribe("/api/v1/x/events", {}, "x");
    FakeEventSource.instances[0].fail();
    // The page would otherwise look alive and quietly stop updating.
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[0].closed).toBe(true);
    stop();
  });

  test("waits longer each time, so a portal that is down is not hammered", () => {
    install();
    const stop = subscribe("/api/v1/x/events", {}, "x");
    for (let i = 0; i < 3; i++) FakeEventSource.instances[i].fail();
    expect(delays).toEqual([1000, 2000, 4000]);
    stop();
  });

  test("a stream that opened starts its waiting over", () => {
    install();
    const stop = subscribe("/api/v1/x/events", {}, "x");
    FakeEventSource.instances[0].fail();
    FakeEventSource.instances[1].onopen?.();
    FakeEventSource.instances[1].fail();
    expect(delays).toEqual([1000, 1000]);
    stop();
  });

  test("leaves a drop to the browser, which is already retrying it", () => {
    install();
    const stop = subscribe("/api/v1/x/events", {}, "x");
    FakeEventSource.instances[0].drop();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].closed).toBe(false);
    stop();
  });

  test("stopping closes the stream and cancels the reopening", () => {
    install();
    const stop = subscribe("/api/v1/x/events", {}, "x");
    stop();
    expect(FakeEventSource.instances[0].closed).toBe(true);
    FakeEventSource.instances[0].fail();
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});

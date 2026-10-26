import { describe, expect, test } from "bun:test";
import { type LeaseState, nextLease, readsAlong } from "./editLease";

const alice = { subject: "u-alice", name: "Alice", since: "2026-10-26T10:00:00Z", until: "2026-10-26T10:01:00Z" };
const bob = { subject: "u-bob", name: "Bob", since: "2026-10-26T10:00:30Z", until: "2026-10-26T10:01:30Z" };

describe("nextLease", () => {
  test("a page that wants the lease asks, and holds what it is given", () => {
    const pending = nextLease({ kind: "off" }, { type: "start" });
    expect(pending).toEqual({ kind: "pending" });
    expect(nextLease(pending, { type: "acquired", editor: alice })).toEqual({ kind: "mine", editor: alice });
  });

  test("meeting somebody else's lease is reading, losing one's own is losing", () => {
    expect(nextLease({ kind: "pending" }, { type: "refused", holder: alice })).toEqual({
      kind: "locked",
      holder: alice,
    });
    expect(nextLease({ kind: "mine", editor: bob }, { type: "refused", holder: alice })).toEqual({
      kind: "lost",
      holder: alice,
    });
  });

  test("a reader follows the holder and notices the document freeing up", () => {
    const locked: LeaseState = { kind: "locked", holder: alice };
    expect(nextLease(locked, { type: "observed", holder: null })).toEqual({ kind: "free" });
    expect(nextLease({ kind: "free" }, { type: "observed", holder: bob })).toEqual({
      kind: "locked",
      holder: bob,
    });
    // Taking a free document is the same acquisition as on open.
    expect(nextLease({ kind: "free" }, { type: "acquired", editor: bob })).toEqual({ kind: "mine", editor: bob });
  });

  test("the holder is not demoted by a stale look", () => {
    const mine: LeaseState = { kind: "mine", editor: alice };
    expect(nextLease(mine, { type: "observed", holder: bob })).toBe(mine);
    expect(nextLease(mine, { type: "observed", holder: null })).toBe(mine);
  });

  test("a take that could not be asked edits on, so a cache outage costs nothing extra", () => {
    expect(nextLease({ kind: "pending" }, { type: "failed" })).toEqual({ kind: "mine", editor: null });
    const locked: LeaseState = { kind: "locked", holder: alice };
    expect(nextLease(locked, { type: "failed" })).toBe(locked);
  });

  test("after a loss the page keeps saying lost until the person lets go", () => {
    const lost: LeaseState = { kind: "lost", holder: alice };
    expect(nextLease(lost, { type: "observed", holder: null })).toEqual({ kind: "lost", holder: null });
    expect(nextLease(lost, { type: "resign" })).toEqual({ kind: "locked", holder: alice });
    expect(nextLease({ kind: "lost", holder: null }, { type: "resign" })).toEqual({ kind: "free" });
  });

  test("off ignores everything but start", () => {
    expect(nextLease({ kind: "off" }, { type: "acquired", editor: alice })).toEqual({ kind: "off" });
    expect(nextLease({ kind: "off" }, { type: "refused", holder: alice })).toEqual({ kind: "off" });
    expect(nextLease({ kind: "mine", editor: alice }, { type: "stop" })).toEqual({ kind: "off" });
  });
});

describe("readsAlong", () => {
  test("a reader follows the document, a holder writes it", () => {
    expect(readsAlong({ kind: "locked", holder: alice }, false)).toBe(true);
    expect(readsAlong({ kind: "free" }, true)).toBe(true);
    expect(readsAlong({ kind: "mine", editor: alice }, false)).toBe(false);
    expect(readsAlong({ kind: "pending" }, false)).toBe(false);
  });

  test("unsaved text after a loss is kept on the screen, not followed over", () => {
    expect(readsAlong({ kind: "lost", holder: alice }, true)).toBe(false);
    expect(readsAlong({ kind: "lost", holder: alice }, false)).toBe(true);
  });
});

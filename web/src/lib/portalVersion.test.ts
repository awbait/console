import { describe, expect, test } from "bun:test";
import { buildId, shouldReloadForStaleChunk, VersionWatch } from "./portalVersion";

describe("buildId", () => {
  test("names a stamped build by version and commit", () => {
    expect(buildId({ version: "v0.21.0", commit: "abc1234" })).toBe("v0.21.0@abc1234");
    expect(buildId({ version: "v0.21.0" })).toBe("v0.21.0@");
  });

  test("does not compare an unstamped build", () => {
    expect(buildId({ version: "dev", commit: "abc1234" })).toBeNull();
    expect(buildId({ version: "" })).toBeNull();
  });
});

describe("shouldReloadForStaleChunk", () => {
  test("reloads the first time", () => {
    expect(shouldReloadForStaleChunk(1_000_000, null)).toBe(true);
  });

  test("does not reload again right after a reload", () => {
    expect(shouldReloadForStaleChunk(1_000_000, 1_000_000 - 5_000)).toBe(false);
  });

  test("reloads again once the gap has passed", () => {
    expect(shouldReloadForStaleChunk(1_000_000, 1_000_000 - 120_000)).toBe(true);
  });
});

describe("VersionWatch", () => {
  test("the first answer is the build the page started on", () => {
    const w = new VersionWatch();
    expect(w.seen({ version: "v0.21.0", commit: "a" })).toBeNull();
    expect(w.seen({ version: "v0.21.0", commit: "a" })).toBeNull();
  });

  test("announces a different version", () => {
    const w = new VersionWatch();
    w.seen({ version: "v0.21.0", commit: "a" });
    expect(w.seen({ version: "v0.22.0", commit: "b" })).toBe("v0.22.0");
  });

  test("announces a different commit under the same version", () => {
    const w = new VersionWatch();
    w.seen({ version: "v0.21.0-3-gaaaa", commit: "a" });
    expect(w.seen({ version: "v0.21.0-3-gaaaa", commit: "b" })).toBe("v0.21.0-3-gaaaa");
  });

  test("an unstamped answer neither starts the watch nor announces anything", () => {
    const w = new VersionWatch();
    expect(w.seen({ version: "dev" })).toBeNull();
    expect(w.seen({ version: "v0.21.0", commit: "a" })).toBeNull();
    expect(w.seen({ version: "dev" })).toBeNull();
    expect(w.seen({ version: "v0.22.0", commit: "b" })).toBe("v0.22.0");
  });

  test("an old replica answering mid-rollout is not news", () => {
    const w = new VersionWatch();
    w.seen({ version: "v0.21.0", commit: "a" });
    expect(w.seen({ version: "v0.22.0", commit: "b" })).toBe("v0.22.0");
    expect(w.seen({ version: "v0.21.0", commit: "a" })).toBeNull();
  });
});

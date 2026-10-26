import { describe, expect, test } from "bun:test";
import {
  chartName,
  decodeShare,
  encodeShare,
  loadState,
  parseObject,
  saveState,
  STORAGE_KEY,
} from "./state";

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  };
}

describe("share link", () => {
  test("round-trips both documents", async () => {
    const state = { schema: '{"type":"object","title":"Demo"}', view: '{"views":{"order":{}}}' };
    const hash = await encodeShare(state);
    expect(hash.startsWith("s=")).toBe(true);
    expect(hash.slice(2)).not.toMatch(/[+/=]/);
    expect(await decodeShare(`#${hash}`)).toEqual(state);
    expect(await decodeShare(hash)).toEqual(state);
  });

  test("rejects a foreign or broken fragment", async () => {
    expect(await decodeShare("")).toBeNull();
    expect(await decodeShare("#tab=view")).toBeNull();
    expect(await decodeShare("#s=not-base64-at-all!!")).toBeNull();
  });
});

describe("storage", () => {
  test("keeps what was saved and ignores garbage", () => {
    const s = memory();
    expect(loadState(s)).toBeNull();
    saveState(s, { schema: "a", view: "b" });
    expect(loadState(s)).toEqual({ schema: "a", view: "b" });
    s.setItem(STORAGE_KEY, '{"schema":1}');
    expect(loadState(s)).toBeNull();
    s.setItem(STORAGE_KEY, "{");
    expect(loadState(s)).toBeNull();
  });
});

describe("parseObject", () => {
  test("empty is nothing, not an error", () => {
    expect(parseObject("  \n")).toEqual({ value: null, error: null });
  });
  test("an object parses, anything else reports", () => {
    expect(parseObject('{"a":1}').value).toEqual({ a: 1 });
    expect(parseObject("[1]").error).toBe("not an object");
    expect(parseObject("{").error).toBeTruthy();
  });
});

describe("chartName", () => {
  test("slugs the title and falls back", () => {
    expect(chartName({ title: "My Web App" })).toBe("my-web-app");
    expect(chartName({ title: "???" })).toBe("chart");
    expect(chartName(null)).toBe("chart");
  });
});

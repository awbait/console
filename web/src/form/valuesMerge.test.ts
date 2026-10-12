import { describe, expect, test } from "bun:test";
import { mergeUnder, reseed } from "./valuesMerge";

describe("reseed", () => {
  test("a value the previous seed put there follows the new seed", () => {
    const cur = { ingress: { domain: "dev.example.com" }, contacts: { team: "core" } };
    const prev = { ingress: { domain: "dev.example.com" }, contacts: { team: "core" } };
    const next = { ingress: { domain: "example.com" }, contacts: { team: "core" } };
    expect(reseed(cur, prev, next)).toEqual(next);
  });

  test("what the person changed after the first seed stays", () => {
    const cur = { ingress: { domain: "mine.example.com" } };
    const prev = { ingress: { domain: "dev.example.com" } };
    const next = { ingress: { domain: "example.com" } };
    expect(reseed(cur, prev, next)).toEqual(cur);
  });

  test("without a previous seed it is mergeUnder", () => {
    const cur = { a: "typed" };
    expect(reseed(cur, {}, { a: "seed", b: "seed" })).toEqual(mergeUnder(cur, { a: "seed", b: "seed" }));
  });

  test("a key the new seed no longer has keeps its value", () => {
    const cur = { a: "from-dev", b: "typed" };
    expect(reseed(cur, { a: "from-dev" }, { b: "seed" })).toEqual(cur);
  });
});

describe("mergeUnder", () => {
  test("fills in what is missing", () => {
    expect(mergeUnder({}, { contacts: { responsible: "Иванов Иван" } })).toEqual({
      contacts: { responsible: "Иванов Иван" },
    });
  });

  test("what the person typed wins", () => {
    const typed = { contacts: { responsible: "Петров" } };
    expect(mergeUnder(typed, { contacts: { responsible: "Иванов Иван" } })).toEqual(typed);
  });

  test("an empty field is not an answer, so the seed lands in it", () => {
    expect(mergeUnder({ contacts: { responsible: "" } }, { contacts: { responsible: "Иванов" } })).toEqual({
      contacts: { responsible: "Иванов" },
    });
  });

  test("merges objects side by side and keeps untouched branches", () => {
    const cur = { a: { x: 1 }, keep: "mine" };
    const seed = { a: { y: 2 }, b: "seeded" };
    expect(mergeUnder(cur, seed)).toEqual({ a: { x: 1, y: 2 }, keep: "mine", b: "seeded" });
  });

  test("an array is taken whole or not at all", () => {
    expect(mergeUnder({ list: [1] }, { list: [2, 3] })).toEqual({ list: [1] });
    expect(mergeUnder({}, { list: [2, 3] })).toEqual({ list: [2, 3] });
  });

  test("does not mutate its inputs", () => {
    const cur = { a: { x: 1 } };
    mergeUnder(cur, { a: { y: 2 }, b: 3 });
    expect(cur).toEqual({ a: { x: 1 } });
  });
});

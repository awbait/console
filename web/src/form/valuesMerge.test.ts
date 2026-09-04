import { describe, expect, test } from "bun:test";
import { mergeUnder } from "./valuesMerge";

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

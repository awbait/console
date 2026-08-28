import { describe, expect, test } from "bun:test";
import { diffValues, formatValue, setAtField } from "./valuesDiff";

describe("diffValues", () => {
  test("names the field that moved, and nothing else", () => {
    const rows = diffValues(
      { auth: { database: "app", username: "app" } },
      { auth: { database: "edited", username: "app" } },
    );
    expect(rows).toEqual([
      { path: "auth.database", field: ["auth", "database"], before: "app", after: "edited" },
    ]);
  });

  test("a field that appears and one that goes away are both changes", () => {
    const rows = diffValues({ a: 1, gone: "x" }, { a: 1, added: "y" });
    expect(rows.map((r) => r.path)).toEqual(["added", "gone"]);
    expect(rows[0].before).toBeUndefined();
    expect(rows[1].after).toBeUndefined();
  });

  test("an emptied field is not the same as a removed one", () => {
    const [row] = diffValues({ host: "example.test" }, { host: "" });
    expect(row.after).toBe("");
    expect(row.after).not.toBeUndefined();
  });

  test("a list is one value: its entries carry meaning by position", () => {
    const rows = diffValues({ hosts: ["a.test", "b.test"] }, { hosts: ["a.test", "c.test"] });
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe("hosts");
  });

  test("a subtree is walked into, so the row names the field and not the branch", () => {
    const rows = diffValues(
      { gateway: { tls: { mode: "simple" } } },
      { gateway: { tls: { mode: "passthrough" } } },
    );
    expect(rows[0].path).toBe("gateway.tls.mode");
  });

  test("a subtree replaced by a value is the one change it is", () => {
    const rows = diffValues({ tls: { mode: "simple" } }, { tls: false });
    expect(rows.map((r) => r.path)).toEqual(["tls"]);
  });

  test("the same values written differently are not a change", () => {
    expect(diffValues({ a: { b: [1, 2] } }, { a: { b: [1, 2] } })).toEqual([]);
  });

  test("rows come out in a stable order, whatever order the keys were written in", () => {
    const rows = diffValues({ z: 1, a: 1 }, { z: 2, a: 2 });
    expect(rows.map((r) => r.path)).toEqual(["a", "z"]);
  });
});

describe("setAtField", () => {
  test("writes the chosen value without touching the rest", () => {
    const before = { auth: { database: "theirs", username: "theirs" }, other: 1 };
    const after = setAtField(before, ["auth", "database"], "mine");
    expect(after).toEqual({ auth: { database: "mine", username: "theirs" }, other: 1 });
    expect(before.auth.database).toBe("theirs"); // the original is left alone
  });

  test("choosing a side that has no such field removes it, rather than emptying it", () => {
    const after = setAtField({ auth: { database: "theirs" } }, ["auth", "database"], undefined);
    expect(after).toEqual({ auth: {} });
  });

  test("a field that is not there yet gets the objects it needs", () => {
    expect(setAtField({}, ["a", "b"], 1)).toEqual({ a: { b: 1 } });
  });
});

describe("formatValue", () => {
  test("says yes and no rather than true and false", () => {
    expect(formatValue(true)).toBe("да");
    expect(formatValue(false)).toBe("нет");
  });

  test("a list of plain values reads as a list", () => {
    expect(formatValue(["a.test", "b.test"])).toBe("a.test, b.test");
  });

  test("an empty list says so instead of showing nothing", () => {
    expect(formatValue([])).toBe("пусто");
  });

  test("a list of entries is one line per entry, so two sides can be compared", () => {
    expect(formatValue([{ name: "a" }, { name: "b" }])).toBe('{"name":"a"}\n{"name":"b"}');
  });
});

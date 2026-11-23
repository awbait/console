import { describe, expect, test } from "bun:test";
import { emptyOf, fitsType, variantsOf } from "./variants";

describe("variantsOf", () => {
  test("a oneOf is a variant", () => {
    expect(variantsOf({ oneOf: [{ type: "string" }, { type: "integer" }] }, {})).toHaveLength(2);
  });

  test("an anyOf with a branch of fields is a variant", () => {
    const s = { anyOf: [{ type: "string" }, { type: "object", properties: { name: { type: "string" } } }] };
    expect(variantsOf(s, {})).toHaveLength(2);
  });

  test("a branch of fields behind a $ref counts", () => {
    const root = { definitions: { spec: { type: "object", properties: { name: { type: "string" } } } } };
    const s = { anyOf: [{ type: "string" }, { $ref: "#/definitions/spec" }] };
    expect(variantsOf(s, root)?.[1].properties).toBeDefined();
  });

  test("an anyOf of bare types stays one input", () => {
    const scalar = { anyOf: [{ type: "string" }, { type: "integer" }, { type: "boolean" }, { type: "null" }] };
    expect(variantsOf(scalar, {})).toBeUndefined();
    const json = { anyOf: [{ type: "string" }, { type: "object" }, { type: "array" }] };
    expect(variantsOf(json, {})).toBeUndefined();
  });

  test("anything else is not a variant", () => {
    expect(variantsOf({ type: "string" }, {})).toBeUndefined();
    expect(variantsOf({ oneOf: [] }, {})).toBeUndefined();
  });
});

describe("fitsType", () => {
  test("tells the JSON types apart", () => {
    expect(fitsType({ type: "string" }, "a")).toBe(true);
    expect(fitsType({ type: "string" }, {})).toBe(false);
    expect(fitsType({ type: "object" }, {})).toBe(true);
    expect(fitsType({ type: "object" }, [])).toBe(false);
    expect(fitsType({ type: "object" }, null)).toBe(false);
    expect(fitsType({ type: "integer" }, 1.5)).toBe(false);
    expect(fitsType({ type: "number" }, 1.5)).toBe(true);
  });

  test("an unset value and an untyped branch fit anything", () => {
    expect(fitsType({ type: "string" }, undefined)).toBe(true);
    expect(fitsType({ properties: {} }, "a")).toBe(true);
  });
});

test("emptyOf starts a branch with a value of its own type", () => {
  expect(emptyOf({ type: "string" })).toBe("");
  expect(emptyOf({ type: "object" })).toEqual({});
  expect(emptyOf({ type: "integer" })).toBeUndefined();
});

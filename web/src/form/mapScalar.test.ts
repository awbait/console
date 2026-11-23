import { describe, expect, test } from "bun:test";
import { parseScalar, scalarText, scalarTypesOf } from "./mapScalar";

// The RabbitMQ queue argument: a string, a number, a boolean or null, the way
// the chart writes it.
const anyScalar = {
  anyOf: [{ type: "string" }, { type: "integer" }, { type: "number" }, { type: "boolean" }, { type: "null" }],
};
const types = scalarTypesOf(anyScalar, anyScalar) ?? new Set();

describe("scalarTypesOf", () => {
  test("names the scalar types of a choice between them", () => {
    expect([...types].sort()).toEqual(["boolean", "integer", "null", "number", "string"]);
    expect([...(scalarTypesOf({ type: ["string", "integer"] }, {}) ?? [])].sort()).toEqual(["integer", "string"]);
  });

  test("a oneOf of bare types is the same choice", () => {
    const got = scalarTypesOf({ oneOf: [{ type: "string" }, { type: "boolean" }] }, {});
    expect([...(got ?? [])].sort()).toEqual(["boolean", "string"]);
    expect(scalarTypesOf({ oneOf: [{ type: "string" }, { type: "object", properties: {} }] }, {})).toBeUndefined();
  });

  test("follows a reference inside the choice", () => {
    const root = { definitions: { n: { type: "number" } } };
    const got = scalarTypesOf({ anyOf: [{ type: "string" }, { $ref: "#/definitions/n" }] }, root);
    expect([...(got ?? [])].sort()).toEqual(["number", "string"]);
  });

  test("is nothing for a single type, an untyped branch or a structure", () => {
    expect(scalarTypesOf({ type: "string" }, {})).toBeUndefined();
    expect(scalarTypesOf({ anyOf: [{ type: "string" }, { minLength: 1 }] }, {})).toBeUndefined();
    expect(scalarTypesOf({ anyOf: [{ type: "string" }, { type: "object" }] }, {})).toBeUndefined();
    expect(scalarTypesOf({ anyOf: [{ type: "string" }, { type: "array" }] }, {})).toBeUndefined();
    expect(scalarTypesOf({ anyOf: [] }, {})).toBeUndefined();
  });
});

describe("parseScalar", () => {
  test("reads a number, a boolean and null the way YAML would", () => {
    expect(parseScalar("5", types)).toBe(5);
    expect(parseScalar("-12", types)).toBe(-12);
    expect(parseScalar("1.5", types)).toBe(1.5);
    expect(parseScalar("1e3", types)).toBe(1000);
    expect(parseScalar("true", types)).toBe(true);
    expect(parseScalar("false", types)).toBe(false);
    expect(parseScalar("null", types)).toBe(null);
    expect(parseScalar(" 5 ", types)).toBe(5);
  });

  test("leaves everything else the string it was typed as", () => {
    expect(parseScalar("", types)).toBe("");
    expect(parseScalar("5 ms", types)).toBe("5 ms");
    expect(parseScalar("True", types)).toBe("True");
    expect(parseScalar("1.", types)).toBe(1);
    expect(parseScalar("1.2.3", types)).toBe("1.2.3");
    expect(parseScalar("0x10", types)).toBe("0x10");
    expect(parseScalar("99999999999999999999", types)).toBe("99999999999999999999");
  });

  test("a quoted text is the string inside the quotes", () => {
    expect(parseScalar('"5"', types)).toBe("5");
    expect(parseScalar("'true'", types)).toBe("true");
    expect(parseScalar('"', types)).toBe('"');
    expect(parseScalar("'a\"", types)).toBe("'a\"");
  });

  test("only reads into the types the entry admits", () => {
    const text = scalarTypesOf({ type: ["string", "boolean"] }, {}) ?? new Set();
    expect(parseScalar("5", text)).toBe("5");
    expect(parseScalar("null", text)).toBe("null");
    expect(parseScalar("true", text)).toBe(true);
    const whole = scalarTypesOf({ type: ["string", "integer"] }, {}) ?? new Set();
    expect(parseScalar("5", whole)).toBe(5);
    expect(parseScalar("1.5", whole)).toBe("1.5");
  });
});

describe("scalarText", () => {
  test("shows a value as text that reads back to the same value", () => {
    for (const v of [5, -1.5, true, false, null, "plain", "5", "true", "null", " 5", "'q'", 'say "hi"', ""]) {
      expect(parseScalar(scalarText(v, types), types)).toBe(v);
    }
  });

  test("quotes only what would read as another type", () => {
    expect(scalarText("plain", types)).toBe("plain");
    expect(scalarText("5", types)).toBe('"5"');
    // Quotes inside a string are no reason to quote it: it reads back as itself.
    expect(scalarText('say "5"', types)).toBe('say "5"');
    // A string that is itself in quotes would lose them, so it is quoted the other way.
    expect(scalarText('"x"', types)).toBe("'\"x\"'");
    expect(scalarText(5, types)).toBe("5");
    expect(scalarText(undefined, types)).toBe("");
  });
});

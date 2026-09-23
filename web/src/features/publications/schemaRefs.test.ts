import { describe, expect, test } from "bun:test";
import { refAt, refName } from "./schemaRefs";

// A schema in the spirit of the real ones: a $ref from a property down to a
// definition, one definition referring to another, a list of variants.
const schema = `{
  "type": "object",
  "properties": {
    "tls": { "title": "Сертификаты", "$ref": "#/definitions/tls" },
    "mode": { "$ref": "#/definitions/a~1b" },
    "outside": { "$ref": "other.json#/definitions/x" },
    "missing": { "$ref": "#/definitions/nope" }
  },
  "definitions": {
    "tls": {
      "type": "object",
      "properties": { "issuer": { "$ref": "#/definitions/issuer" } }
    },
    "issuer": { "type": "string" },
    "a/b": { "type": "string" },
    "variants": { "oneOf": [{ "type": "string" }, { "$ref": "#/definitions/variants/oneOf/0" }] }
  }
}`;

// at puts the cursor inside the value of the $ref that follows the given key.
function at(key: string) {
  const start = schema.indexOf(`"${key}": {`);
  const ref = schema.indexOf('"$ref"', start);
  const quote = schema.indexOf('"', schema.indexOf(":", ref) + 1);
  return refAt(schema, quote + 3);
}

// keyAt is where a definition's name starts, quotes included.
function keyAt(name: string, from = 0): number {
  return schema.indexOf(`"${name}"`, from);
}

describe("a $ref under the cursor", () => {
  test("points at the definition's name", () => {
    const got = at("tls");
    expect(got?.pointer).toBe("#/definitions/tls");
    expect(schema.slice(got?.from, got?.to)).toBe("#/definitions/tls");
    const definitions = schema.indexOf('"definitions"');
    expect(got?.target).toEqual({ offset: keyAt("tls", definitions), length: '"tls"'.length });
  });

  test("a pointer to nowhere is still a ref, with nothing to jump to", () => {
    const got = at("missing");
    expect(got?.pointer).toBe("#/definitions/nope");
    expect(got?.target).toBeNull();
  });

  test("a ref into another file is not this editor's business", () => {
    expect(at("outside")).toBeNull();
  });

  test("escaped segments are read the way RFC 6901 writes them", () => {
    const got = at("mode");
    expect(got?.target).toEqual({ offset: keyAt("a/b"), length: '"a/b"'.length });
    expect(refName("#/definitions/a~1b")).toBe("a/b");
  });

  test("a pointer through a list lands on the element", () => {
    const start = schema.indexOf('"variants"');
    const ref = schema.indexOf('"$ref"', start);
    const got = refAt(schema, schema.indexOf("#", ref) + 1);
    const element = schema.indexOf('{ "type": "string" }', start);
    expect(got?.target?.offset).toBe(element);
  });

  test("the cursor on a key, or on a string that is not a $ref, is nothing", () => {
    expect(refAt(schema, schema.indexOf('"$ref"') + 2)).toBeNull();
    expect(refAt(schema, schema.indexOf("Сертификаты"))).toBeNull();
  });

  test("half-typed JSON is read as far as it goes, with nothing to jump to", () => {
    expect(refAt('{"a": {"$ref": "#/definitions/', 20)?.target).toBeNull();
    expect(refAt("", 0)).toBeNull();
  });
});

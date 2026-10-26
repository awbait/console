import { describe, expect, test } from "bun:test";
import { escapeToken, fieldBreadcrumb, mapKeyPattern, mapValueSchema, nodeAt, unescapeToken } from "./fieldPath";

// A map entry is addressed by its key, and the key may itself carry what a
// pointer is made of: a RabbitMQ vhost is "/billing". The server escapes such
// a key (RFC 6901), and so must everything here that reads a pointer back.
const schema = {
  type: "object",
  properties: {
    users: {
      title: "Пользователи",
      type: "object",
      additionalProperties: {
        type: "object",
        properties: { tags: { title: "Теги", type: "string" } },
      },
    },
    vhosts: {
      type: "object",
      patternProperties: { "^/": { type: "object", properties: { tracing: { type: "boolean" } } } },
    },
    named: { type: "object", propertyNames: { pattern: "^[a-z]+$" }, additionalProperties: { type: "string" } },
  },
};

describe("pointer tokens", () => {
  test("escape and unescape are inverse, slashes and tildes included", () => {
    for (const key of ["/billing", "a~b", "a/~1/b", "plain", "0"]) {
      expect(unescapeToken(escapeToken(key))).toBe(key);
    }
    expect(escapeToken("/billing")).toBe("~1billing");
  });
});

describe("mapValueSchema", () => {
  test("names the value schema of a map and nothing else", () => {
    expect(mapValueSchema(schema.properties.users)).toEqual(schema.properties.users.additionalProperties);
    expect(mapValueSchema(schema.properties.vhosts)).toEqual(schema.properties.vhosts.patternProperties["^/"]);
    expect(mapValueSchema({ type: "object", properties: { a: {} }, additionalProperties: { type: "string" } })).toBeUndefined();
    expect(mapValueSchema({ type: "object", additionalProperties: true })).toBeUndefined();
    expect(mapValueSchema({ type: "object", patternProperties: { a: {}, b: {} } })).toBeUndefined();
  });

  test("the key pattern comes from propertyNames or the one template", () => {
    expect(mapKeyPattern(schema.properties.named)).toBe("^[a-z]+$");
    expect(mapKeyPattern(schema.properties.vhosts)).toBe("^/");
    expect(mapKeyPattern(schema.properties.users)).toBeUndefined();
  });
});

describe("nodeAt through a map", () => {
  test("steps into an entry by its key", () => {
    expect(nodeAt("/users/alice/tags", schema)?.title).toBe("Теги");
  });

  test("reads an escaped key back", () => {
    expect(nodeAt("/vhosts/~1billing/tracing", schema)?.type).toBe("boolean");
  });

  test("a map entry may be numbered", () => {
    expect(nodeAt("/users/0/tags", schema)?.title).toBe("Теги");
  });
});

describe("fieldBreadcrumb through a map", () => {
  test("calls an entry by its key", () => {
    expect(fieldBreadcrumb("/users/alice/tags", schema)).toBe("Пользователи › alice › Теги");
  });

  test("shows the key unescaped", () => {
    expect(fieldBreadcrumb("/vhosts/~1billing/tracing", schema)).toBe("vhosts › /billing › tracing");
  });

  test("a view on the map node names the fields inside an entry", () => {
    const view = { overrides: { users: { "ui:view": { overrides: { tags: { title: "Роли" } } } } } };
    expect(fieldBreadcrumb("/users/alice/tags", schema, view)).toBe("Пользователи › alice › Роли");
  });
});

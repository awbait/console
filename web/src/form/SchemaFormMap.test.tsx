import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { collectErrors, newArrayItem, SchemaForm } from "./SchemaForm";

// A map is an object the chart describes by its values, not by its keys. Charts
// of other teams use one as a directory "name -> settings": RabbitMQ users are
// a map whose key is the user name and whose value holds tags and permissions.
// The form draws such an entry as a card; a number or a choice as its own
// control; a plain string as the key/value line it always had.
const userSpec = {
  type: "object",
  required: ["tags"],
  properties: {
    tags: { title: "Теги", type: "string" },
    permissions: {
      type: "object",
      properties: { read: { type: "string" }, write: { type: "string" } },
    },
  },
};

const schema = {
  type: "object",
  definitions: { userSpec },
  properties: {
    users: { title: "Пользователи", type: "object", additionalProperties: { $ref: "#/definitions/userSpec" } },
    labels: { title: "Лейблы", type: "object", additionalProperties: { type: "string" } },
    limits: { title: "Лимиты", type: "object", additionalProperties: { type: "integer", minimum: 1 } },
    modes: { title: "Режимы", type: "object", additionalProperties: { type: "string", enum: ["fast", "safe"] } },
    vhosts: {
      type: "object",
      patternProperties: { "^/": { type: "object", properties: { tracing: { type: "boolean" } } } },
    },
    named: {
      title: "Имена",
      type: "object",
      propertyNames: { pattern: "^[a-z]+$" },
      minProperties: 1,
      additionalProperties: { type: "string" },
    },
    // RabbitMQ queue arguments: any scalar, under one pattern that takes every key.
    args: {
      title: "Аргументы",
      type: "object",
      patternProperties: {
        "^(.*)$": {
          anyOf: [{ type: "string" }, { type: "integer" }, { type: "number" }, { type: "boolean" }, { type: "null" }],
        },
      },
      additionalProperties: false,
    },
    // The same written as oneOf, as another chart does for exchange arguments.
    xargs: {
      title: "Аргументы обменника",
      type: "object",
      patternProperties: {
        "^(.*)$": { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] },
      },
      additionalProperties: false,
    },
  },
};

const markup = (value: Record<string, unknown>) =>
  renderToStaticMarkup(<SchemaForm schema={schema} value={value} onChange={() => {}} />);

describe("a map drawn by the schema of its values", () => {
  test("an object value is a card named by its key, anchored by its path", () => {
    const html = markup({ users: { alice: { tags: "administrator" } } });
    expect(html).toContain('value="alice"');
    expect(html).toContain('id="ff/users/alice"');
    // The card's one-line summary comes from the entry's fields.
    expect(html).toContain("administrator");
    // No second text input for the value: the value is the card.
    expect(html).not.toContain('placeholder="значение"');
  });

  test("a plain string value keeps the key/value line", () => {
    const html = markup({ labels: { app: "api" } });
    expect(html).toContain('placeholder="ключ"');
    expect(html).toContain('placeholder="значение"');
    expect(html).toContain('value="api"');
    expect(html).not.toContain("aria-expanded");
  });

  test("a number value is a numeric control, the number kept", () => {
    const html = markup({ limits: { cpu: 2 } });
    expect(html).toMatch(/inputmode="numeric"/i);
    expect(html).toContain('value="2"');
    expect(html).not.toContain('placeholder="значение"');
  });

  test("a choice value is a select", () => {
    const html = markup({ modes: { api: "fast" } });
    expect(html).toContain("listbox");
    expect(html).not.toContain('placeholder="значение"');
  });

  test("a key with a slash is escaped in the entry's anchor", () => {
    const html = markup({ vhosts: { "/billing": { tracing: true } } });
    expect(html).toContain('id="ff/vhosts/~1billing"');
    expect(html).toContain('value="/billing"');
  });

  test("an any-scalar value is a text line that shows each value as it reads back", () => {
    const html = markup({ args: { "x-delivery-limit": 5, "x-queue-mode": "lazy", "x-note": "5", on: true, none: null } });
    expect(html).toContain('placeholder="значение"');
    expect(html).toContain('value="5"');
    expect(html).toContain('value="lazy"');
    // A string that looks like a number is shown quoted, so it stays a string.
    expect(html).toContain('value="&quot;5&quot;"');
    expect(html).toContain('value="true"');
    expect(html).toContain('value="null"');
    expect(html).toContain("сохраняются как значения своего типа");
  });

  test("a oneOf of bare scalars is the same text line, not a variant card", () => {
    const html = markup({ xargs: { "alternate-exchange": "dlx", "x-max": 5 } });
    expect(html).toContain('placeholder="значение"');
    expect(html).toContain('value="dlx"');
    expect(html).toContain('value="5"');
    expect(html).not.toContain("Вариант");
    expect(html).not.toContain("[object Object]");
  });
});

describe("collectErrors over a map", () => {
  test("a required field inside an entry is reported under the key", () => {
    const errors = collectErrors(schema, { users: { alice: {} } });
    expect(errors.get("/users/alice/tags")).toBeString();
  });

  test("a key with a slash is pointer-escaped the way the server writes it", () => {
    const errors = collectErrors(schema, { users: { "a/b": {} } });
    expect(errors.get("/users/a~1b/tags")).toBeString();
  });

  test("a scalar value is checked against the value schema", () => {
    expect(collectErrors(schema, { limits: { cpu: 0 } }).get("/limits/cpu")).toBeString();
    expect(collectErrors(schema, { limits: { cpu: 1 } }).size).toBe(0);
  });

  test("a single patternProperties template is a map", () => {
    expect(collectErrors(schema, { vhosts: { "/billing": { tracing: true } } }).size).toBe(0);
  });

  test("a key the pattern rejects is reported on the entry", () => {
    const errors = collectErrors(schema, { named: { Bad: "x" } });
    expect(errors.get("/named/Bad")).toBeString();
    expect(collectErrors(schema, { named: { ok: "x" } }).size).toBe(0);
  });

  test("too few entries is reported on the map", () => {
    expect(collectErrors(schema, { named: {} }).get("/named")).toBeString();
  });

  test("an any-scalar map accepts every scalar type", () => {
    expect(collectErrors(schema, { args: { a: 5, b: "x", c: true, d: null } }).size).toBe(0);
  });

  test("a plain string map is not checked beyond its own rules", () => {
    expect(collectErrors(schema, { labels: { app: "api", "app.kubernetes.io/name": "x" } }).size).toBe(0);
  });
});

describe("newArrayItem", () => {
  test("a row that is a map starts as an empty block", () => {
    const list = { type: "array", items: { type: "object", additionalProperties: { type: "string" } } };
    expect(newArrayItem(list, list)).toEqual({});
  });

  test("a row that is a single-template map starts as an empty block too", () => {
    const list = { type: "array", items: { type: "object", patternProperties: { "^/": { type: "string" } } } };
    expect(newArrayItem(list, list)).toEqual({});
  });
});

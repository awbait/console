import { describe, expect, test } from "bun:test";
import { hintsAt } from "./viewHints";

// A chart in the spirit of the real ingress-gateway: definitions, $ref, a list
// of gateways with a nested list of listeners.
const chart = {
  type: "object",
  properties: {
    naming: {
      type: "object",
      title: "Именование",
      properties: { env: { type: "string", title: "Среда", description: "prod или stage" } },
    },
    gateways: { type: "array", items: { $ref: "#/definitions/gateway" } },
  },
  definitions: {
    gateway: {
      type: "object",
      properties: {
        name: { type: "string", title: "Имя" },
        listeners: {
          type: "array",
          items: {
            type: "object",
            properties: {
              port: { type: "integer" },
              hostnames: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    },
  },
};

// at renders a document with "|" marking the cursor and asks what belongs there.
function at(withCursor: string) {
  const offset = withCursor.indexOf("|");
  return hintsAt(withCursor.replace("|", ""), offset, chart);
}

const values = (doc: ReturnType<typeof at>) => (doc?.items ?? []).map((i) => i.value);

describe("pointers into the chart", () => {
  test("items wants a list, so only lists are offered", () => {
    const got = values(at(`{"tabs":[{"items":"|"}]}`));
    expect(got).toContain("/gateways");
    expect(got).toContain("/gateways/0/listeners");
    expect(got).not.toContain("/gateways/0/name");
  });

  test("identity wants a single value, so lists and objects are left out", () => {
    const got = values(at(`{"views":{"order":{"identity":"|"}}}`));
    expect(got).toContain("/gateways/0/name");
    expect(got).toContain("/naming/env");
    expect(got).not.toContain("/gateways");
  });

  test("a default is stamped into one value", () => {
    const got = values(at(`{"defaults":{"|":"prod"}}`));
    expect(got).toContain("/naming/env");
    expect(got).not.toContain("/naming");
  });

  test("the graph names its list of entries", () => {
    expect(values(at(`{"graph":{"profile":"policies","entries":"|"}}`))).toContain("/gateways");
  });
});

// The convention nobody remembers: an index inside a pointer, a star inside a
// column path. Both are offered ready-made, in the form the key expects.
describe("a column is written against one row", () => {
  const tab = (column: string) =>
    `{"views":{"order":{}},"tabs":[{"id":"g","items":"/gateways","form":"f","ui:table":[${column}]}]}`;

  test("a column path is relative to the row and steps arrays with a star", () => {
    const got = values(at(tab(`{"path":"|"}`)));
    expect(got).toContain("name");
    expect(got).toContain("listeners/*/port");
    expect(got).not.toContain("/gateways/0/name");
  });

  test("a lookup key is a pointer inside the row", () => {
    expect(values(at(tab(`{"lookup":{"keys":"|"}}`)))).toContain("/listeners/*/port");
  });

  test("a lookup reads a field of the list it joins", () => {
    const got = values(at(tab(`{"lookup":{"in":"/gateways","get":"|"}}`)));
    expect(got).toEqual(["name", "listeners"]);
  });

  test("an enum points inside the row by index and reads its source by name", () => {
    const doc = `{"views":{"order":{}},"tabs":[{"id":"g","items":"/gateways","form":"f","enums":[{"at":"@","from":"/gateways","value":"#"}]}]}`;
    expect(values(at(doc.replace("@", "|")))).toContain("/listeners/0/port");
    expect(values(at(doc.replace("#", "|")))).toEqual(["name", "listeners"]);
  });
});

describe("field lists name fields, not paths", () => {
  test("include at the top level names fields of the chart", () => {
    expect(values(at(`{"views":{"order":{"include":["|"]}}}`))).toEqual(["naming", "gateways"]);
  });

  test("a nested ui:view names fields of the row it projects", () => {
    const doc = `{"views":{"order":{"overrides":{"gateways":{"ui:view":{"exclude":["|"]}}}}}}`;
    expect(values(at(doc))).toEqual(["name", "listeners"]);
  });

  test("an override key names a field too", () => {
    expect(values(at(`{"views":{"order":{"overrides":{"|":{}}}}}`))).toEqual(["naming", "gateways"]);
  });

  test("a view used as a tab's form projects the row of that tab's list", () => {
    const doc = `{"views":{"order":{},"listener":{"include":["|"]}},"tabs":[{"id":"l","items":"/gateways/0/listeners","form":"listener"}]}`;
    expect(values(at(doc))).toEqual(["port", "hostnames"]);
  });
});

describe("what only the document knows", () => {
  test("a tab's form is one of the views, never the order form", () => {
    const doc = `{"views":{"order":{},"listener":{}},"tabs":[{"id":"l","form":"|"}]}`;
    expect(values(at(doc))).toEqual(["listener"]);
  });

  test("an action sits on the info screen or on a tab that exists", () => {
    const doc = `{"views":{"order":{},"x":{}},"tabs":[{"id":"listeners"}],"actions":[{"view":"x","in":"|"}]}`;
    expect(values(at(doc))).toEqual(["info", "tab:listeners"]);
  });
});

describe("where the text is replaced", () => {
  test("inside a string only what stands between the quotes is replaced", () => {
    const doc = `{"tabs":[{"items":"/gate"}]}`;
    const got = hintsAt(doc, doc.indexOf("/gate") + 5, chart);
    expect(got?.quote).toBe(false);
    expect(doc.slice(got?.from, got?.to)).toBe("/gate");
  });

  test("outside a string the value brings its own quotes", () => {
    const doc = `{"tabs":[{"items": }]}`;
    const got = hintsAt(doc, doc.indexOf("}") - 1, chart);
    expect(got?.quote).toBe(true);
    expect(got?.from).toBe(got?.to);
  });

  test("half-typed JSON still gets help, which is the point", () => {
    const doc = `{"views":{"order":{"identity":"`;
    expect(values(hintsAt(doc, doc.length, chart))).toContain("/naming/env");
  });

  test("a place the chart has nothing to say about stays quiet", () => {
    expect(at(`{"views":{"order":{"|"}}}`)).toBeNull();
  });
});

// What the portal can put into a default or a starting value. The list is the
// portal's own (GET /view-refs), so the editor cannot offer a reference the
// order would then refuse.
describe("references in defaults and initial", () => {
  const refs = [
    { ref: ".Team", desc: "Команда заказа", at_order_form: true },
    { ref: ".Namespace", desc: "Неймспейс заказа", at_order_form: false },
    { ref: ".Vars.OPS_DOMAIN", desc: "Домен стенда", at_order_form: true },
  ];
  const atRef = (withCursor: string) => {
    const offset = withCursor.indexOf("|");
    return hintsAt(withCursor.replace("|", ""), offset, chart, refs);
  };

  test("a default takes every reference", () => {
    const hints = atRef('{"defaults":{"/naming/env":"|"}}');
    expect(hints?.items.map((i) => i.value)).toEqual([
      "{{.Team}}",
      "{{.Namespace}}",
      "{{.Vars.OPS_DOMAIN}}",
    ]);
    expect(hints?.items[0].detail).toBe("Команда заказа");
  });

  test("a starting value only takes what the order form already knows", () => {
    const hints = atRef('{"initial":{"/naming/env":"|"}}');
    expect(hints?.items.map((i) => i.value)).toEqual(["{{.Team}}", "{{.Vars.OPS_DOMAIN}}"]);
  });

  test("the key of a starting value is still a chart field", () => {
    const hints = atRef('{"initial":{"|"}}');
    expect(hints?.items.map((i) => i.value)).toContain("/naming/env");
  });

  test("without the list the editor stays as it was", () => {
    const offset = '{"defaults":{"/naming/env":"'.length;
    expect(hintsAt('{"defaults":{"/naming/env":""}}', offset, chart)).toBeNull();
  });
});

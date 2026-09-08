import { describe, expect, it } from "bun:test";
import { collectErrors, enumLabel, enumOptions, newArrayItem, setAt } from "./SchemaForm";

// A chart may hide a field for part of the values: the ingress-gateway schema
// hides a listener's domain once the protocol is TCP or UDP. What the form does
// not render, it must not validate either.
const listener = {
  type: "object",
  properties: {
    protocol: { type: "string", enum: ["HTTP", "TCP"] },
    hostname: { type: "string", minLength: 5 },
  },
  allOf: [
    {
      if: { properties: { protocol: { enum: ["TCP"] } }, required: ["protocol"] },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema keyword, not a thenable
      then: { properties: { hostname: { "ui:widget": "hidden" } } },
    },
    {
      if: { properties: { protocol: { const: "HTTP" } }, required: ["protocol"] },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema keyword, not a thenable
      then: { required: ["hostname"] },
    },
  ],
};

describe("collectErrors with conditional fields", () => {
  it("flags a bad domain while the protocol keeps the field visible", () => {
    const errors = collectErrors(listener, { protocol: "HTTP", hostname: "ab" });
    expect(errors.get("/hostname")).toBeString();
  });

  it("requires the domain the schema requires", () => {
    const errors = collectErrors(listener, { protocol: "HTTP" });
    expect(errors.get("/hostname")).toBeString();
  });

  it("ignores the domain once the protocol hides it", () => {
    const errors = collectErrors(listener, { protocol: "TCP", hostname: "ab" });
    expect(errors.size).toBe(0);
  });
});

// A chart names the choices of a list field with "enumNames": same order as
// "enum", one name per value. The person ordering picks a name, the values keep
// the code.
const cluster = {
  type: "string",
  enum: ["inf", "dev", "tco"],
  enumNames: ["Infra-dev-ecpk (inf)", "dev-ecpk и dev-common (dev)", "techsec-dev (tco)"],
};

describe("enum option labels", () => {
  it("names every choice the chart named", () => {
    expect(enumOptions(cluster)).toEqual([
      { id: "inf", label: "Infra-dev-ecpk (inf)" },
      { id: "dev", label: "dev-ecpk и dev-common (dev)" },
      { id: "tco", label: "techsec-dev (tco)" },
    ]);
  });

  it("shows the code of a choice the chart left unnamed", () => {
    const partial = { type: "string", enum: ["TCP", "UDP", "SCTP"], enumNames: ["TCP", 42] };
    expect(enumOptions(partial).map((o) => o.label)).toEqual(["TCP", "UDP", "SCTP"]);
  });

  it("shows codes when the chart has no names at all", () => {
    expect(enumOptions({ type: "string", enum: ["ALLOW", "DENY"] }).map((o) => o.label)).toEqual([
      "ALLOW",
      "DENY",
    ]);
  });

  it("names a chosen value, and leaves a value outside the list alone", () => {
    expect(enumLabel(cluster, "tco")).toBe("techsec-dev (tco)");
    expect(enumLabel(cluster, "gone")).toBe("gone");
  });

  it("names a number the same way", () => {
    const code = { type: "integer", enum: [301, 302], enumNames: ["Постоянное", "Временное"] };
    expect(enumLabel(code, 302)).toBe("Временное");
  });
});

// A list of plain values (egress-gateway's externalIPs) is not a list of cards:
// its new row goes straight into a text input, so it must start blank. An empty
// object there was rendered as "[object Object]" and the person had to erase it.
describe("a new array row", () => {
  const root = { definitions: { ip: { type: "string" } } };

  it("starts blank in a list of strings", () => {
    expect(newArrayItem({ type: "array", items: { type: "string" } }, root)).toBeUndefined();
  });

  it("starts blank behind a $ref to a plain value", () => {
    expect(newArrayItem({ type: "array", items: { $ref: "#/definitions/ip" } }, root)).toBeUndefined();
  });

  it("is a container in a list of objects", () => {
    const arr = { type: "array", items: { type: "object", properties: { name: { type: "string" } } } };
    expect(newArrayItem(arr, root)).toEqual({});
  });

  it("carries the item defaults", () => {
    const arr = {
      type: "array",
      items: { type: "object", properties: { protocol: { type: "string", default: "TLS" } } },
    };
    expect(newArrayItem(arr, root)).toEqual({ protocol: "TLS" });
  });

  it("prefers the chart's snippet", () => {
    const arr = {
      type: "array",
      items: { type: "object", properties: { name: { type: "string" } } },
      defaultSnippets: [{ label: "one", body: [{ name: "core" }] }],
    };
    expect(newArrayItem(arr, root)).toEqual({ name: "core" });
  });
});

// A chart dependency reaches the form through the effective schema: the portal
// mounts the subchart's schema under the key its values sit at (its alias, or
// its chart name), and marks it so the form can tell it from a field the chart
// declared itself.
const withDependency = {
  type: "object",
  required: ["naming"],
  properties: {
    naming: { type: "string" },
    pooler: {
      type: "object",
      "x-dependency": "pgbouncer",
      required: ["poolMode"],
      properties: {
        poolMode: { type: "string", enum: ["session", "transaction"] },
        maxClientConn: { type: "integer", minimum: 1 },
      },
    },
  },
};

describe("a chart dependency in the order form", () => {
  it("is left out until the view asks for it", () => {
    // No include: only the chart's own fields are drawn, so the required field
    // of an untouched subchart is not held against the person ordering.
    const errors = collectErrors(withDependency, {});
    expect([...errors.keys()]).toEqual(["/naming"]);
  });

  it("checks the field a view names by path", () => {
    const view = { include: ["pooler/poolMode"] };
    expect(collectErrors(withDependency, {}, view).get("/pooler/poolMode")).toBeString();
    expect(collectErrors(withDependency, { pooler: { poolMode: "session" } }, view).size).toBe(0);
  });

  it("checks the dependency's own rules on the value under it", () => {
    const view = { include: ["pooler/maxClientConn"] };
    const errors = collectErrors(withDependency, { pooler: { maxClientConn: 0 } }, view);
    expect(errors.get("/pooler/maxClientConn")).toBeString();
  });

  it("honors a view that forces a dependency's field to be filled in", () => {
    const view = { include: ["pooler/maxClientConn"], required: ["pooler/maxClientConn"] };
    expect(collectErrors(withDependency, {}, view).get("/pooler/maxClientConn")).toBeString();
  });

  it("drops a name that finds nothing rather than drawing an empty field", () => {
    expect(collectErrors(withDependency, {}, { include: ["pooler/typo"] }).size).toBe(0);
  });
});

describe("writing a field named by a path", () => {
  it("builds the objects on the way down", () => {
    expect(setAt({ naming: "app" }, ["pooler", "poolMode"], "session")).toEqual({
      naming: "app",
      pooler: { poolMode: "session" },
    });
  });

  it("takes the container with the last value in it, so an untouched dependency stays out of the order", () => {
    expect(setAt({ naming: "app", pooler: { poolMode: "session" } }, ["pooler", "poolMode"], undefined)).toEqual({
      naming: "app",
    });
  });

  it("keeps a container that still holds something", () => {
    const before = { pooler: { poolMode: "session", maxClientConn: 10 } };
    expect(setAt(before, ["pooler", "poolMode"], undefined)).toEqual({ pooler: { maxClientConn: 10 } });
  });
});

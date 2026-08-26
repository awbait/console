import { describe, expect, it } from "bun:test";
import { collectErrors, enumLabel, enumOptions } from "./SchemaForm";

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

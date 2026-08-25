import { describe, expect, it } from "bun:test";
import { collectErrors } from "./SchemaForm";

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

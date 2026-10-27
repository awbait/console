import { describe, expect, it } from "bun:test";
import { activeBranches, branchesBelow, itemBranches, matchedThens } from "./fieldPath";
import { collectErrors, fieldBranches } from "./SchemaForm";

// The shape the egress-gateway chart declares at its root: one rule, written
// where both modes are visible, says what each mode has no use for. The mesh
// fields sit in "then", the direct fields in "else", and the fields themselves
// live two or three levels down, some of them behind a $ref.
const egress = {
  type: "object",
  definitions: {
    senders: {
      type: "object",
      required: ["namespace", "subnet"],
      properties: {
        namespace: { type: "string" },
        subnet: { type: "string", minLength: 3 },
      },
    },
  },
  properties: {
    mode: { type: "string", enum: ["mesh", "direct"] },
    senders: { $ref: "#/definitions/senders" },
    serviceEntries: { type: "array", minItems: 1, items: { type: "string" } },
    waypointNamespace: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        waypoint: {
          type: "object",
          required: ["waypoints"],
          properties: { waypoints: { type: "array", minItems: 1, items: { type: "string" } } },
        },
      },
    },
  },
  allOf: [
    {
      if: { properties: { mode: { const: "direct" } }, required: ["mode"] },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema keyword, not a thenable
      then: {
        properties: {
          serviceEntries: { "ui:widget": "hidden" },
          waypointNamespace: {
            properties: {
              enabled: { const: false },
              waypoint: { properties: { waypoints: { "ui:widget": "hidden" } } },
            },
          },
        },
      },
      else: {
        properties: {
          senders: { properties: { subnet: { "ui:widget": "hidden" } } },
        },
      },
    },
  ],
};

describe("a branch the chart writes as else", () => {
  it("is read when the condition does not hold", () => {
    const taken = matchedThens(egress, { mode: "mesh" }, egress);
    expect(taken.length).toBe(1);
    expect(taken[0].properties.senders).toBeDefined();
  });

  it("gives way to then when the condition holds", () => {
    const taken = matchedThens(egress, { mode: "direct" }, egress);
    expect(taken.length).toBe(1);
    expect(taken[0].properties.serviceEntries).toBeDefined();
  });

  it("is not taken while the deciding field is still empty", () => {
    // The if has mode in its required list: without a mode nothing is decided
    // yet, and the person sees every field until they choose.
    expect(matchedThens(egress, {}, egress)[0].properties.senders).toBeDefined();
  });
});

describe("a hint the chart puts on a nested field", () => {
  it("hides the field in the mode that has no use for it", () => {
    // direct: the waypoint list is hidden, so it is not missing either.
    const direct = collectErrors(egress, { mode: "direct", senders: { namespace: "ns", subnet: "10.0.0.0/24" } });
    expect(direct.has("/waypointNamespace/waypoint/waypoints")).toBe(false);
    expect(direct.has("/serviceEntries")).toBe(false);
    // mesh: the subnet is hidden, so a missing one is not an error.
    const mesh = collectErrors(egress, { mode: "mesh", senders: { namespace: "ns" }, waypointNamespace: { waypoint: {} } });
    expect(mesh.has("/senders/subnet")).toBe(false);
  });

  it("keeps the field in the mode that needs it", () => {
    const direct = collectErrors(egress, { mode: "direct", senders: { namespace: "ns" } });
    expect(direct.get("/senders/subnet")).toBeString();
    const mesh = collectErrors(egress, {
      mode: "mesh",
      senders: { namespace: "ns", subnet: "10.0.0.0/24" },
      waypointNamespace: { waypoint: {} },
    });
    expect(mesh.get("/waypointNamespace/waypoint/waypoints")).toBeString();
  });

  it("reaches a field behind a $ref", () => {
    const branches = fieldBranches("senders/subnet", egress, { mode: "mesh" }, egress);
    expect(branches.some((b) => b.properties?.subnet?.["ui:widget"] === "hidden")).toBe(true);
  });
});

describe("handing a branch down the tree", () => {
  const root = { type: "object", properties: {} };

  it("narrows a fragment to one child and drops the rest", () => {
    const fragments = [{ properties: { a: { properties: { x: { const: 1 } } } } }, { properties: { b: {} } }];
    const below = branchesBelow(fragments, "a", root);
    expect(below.length).toBe(1);
    expect(below[0].properties.x.const).toBe(1);
  });

  it("adds the object's own satisfied branches to what it inherited", () => {
    const node = {
      type: "object",
      properties: { kind: { type: "string" } },
      if: { properties: { kind: { const: "tcp" } } },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema keyword, not a thenable
      then: { required: ["port"] },
    };
    const own = activeBranches(node, { kind: "tcp" }, root, [{ required: ["name"] }]);
    expect(own.map((b) => b.required)).toEqual([["name"], ["port"]]);
  });

  it("follows items into the rows of a list", () => {
    const schema = {
      type: "object",
      properties: {
        flag: { type: "boolean" },
        rows: {
          type: "array",
          items: { type: "object", required: ["extra"], properties: { extra: { type: "string" } } },
        },
      },
      if: { properties: { flag: { const: true } } },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema keyword, not a thenable
      then: { properties: { rows: { items: { properties: { extra: { "ui:widget": "hidden" } } } } } },
    };
    expect(itemBranches(matchedThens(schema, { flag: true }, schema).map((b) => b.properties.rows), schema).length).toBe(1);
    expect(collectErrors(schema, { flag: true, rows: [{}] }).has("/rows/0/extra")).toBe(false);
    expect(collectErrors(schema, { flag: false, rows: [{}] }).get("/rows/0/extra")).toBeString();
  });
});

// A chart that switches on a nested flag: the condition names the flag three
// levels down, and the levels above it carry no const of their own.
const valkey = {
  type: "object",
  properties: {
    valkey: {
      type: "object",
      properties: {
        storage: {
          type: "object",
          properties: {
            enabled: { type: "boolean" },
            size: { type: "string" },
            class: { type: "string" },
          },
        },
      },
    },
  },
  allOf: [
    {
      if: { properties: { valkey: { properties: { storage: { properties: { enabled: { const: true } } } } } } },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema keyword, not a thenable
      then: {
        properties: {
          valkey: {
            properties: {
              storage: {
                required: ["size", "class"],
                properties: { size: { minLength: 1 }, class: { minLength: 1 } },
              },
            },
          },
        },
      },
    },
  ],
};

describe("a condition on a nested field", () => {
  it("holds only when the nested field matches", () => {
    expect(matchedThens(valkey, { valkey: { storage: { enabled: true } } }, valkey)).toHaveLength(1);
    expect(matchedThens(valkey, { valkey: { storage: { enabled: false } } }, valkey)).toHaveLength(0);
    expect(matchedThens(valkey, { valkey: {} }, valkey)).toHaveLength(0);
    expect(matchedThens(valkey, {}, valkey)).toHaveLength(0);
  });

  it("requires the fields only while the flag is on", () => {
    const on = collectErrors(valkey, { valkey: { storage: { enabled: true } } });
    expect(on.get("/valkey/storage/size")).toBeString();
    expect(on.get("/valkey/storage/class")).toBeString();
    const off = collectErrors(valkey, { valkey: { storage: { enabled: false } } });
    expect(off.has("/valkey/storage/size")).toBe(false);
    expect(off.has("/valkey/storage/class")).toBe(false);
  });

  it("reads a required list inside the nested condition", () => {
    const schema = {
      ...valkey,
      allOf: [{ ...valkey.allOf[0], if: { properties: { valkey: { properties: { storage: { required: ["enabled"] } } } } } }],
    };
    expect(matchedThens(schema, { valkey: { storage: { enabled: false } } }, schema)).toHaveLength(1);
    expect(matchedThens(schema, { valkey: { storage: {} } }, schema)).toHaveLength(0);
  });
});

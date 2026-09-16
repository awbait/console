import { describe, expect, test } from "bun:test";
import { adaptToSchema } from "./valuesAdapt";

// The shape the egress gateway actually changed into between two versions: the
// list of gateways became the one gateway, the environment tags moved under
// "global", and the old gateway block went away entirely.
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["vpcEgressGateway"],
  properties: {
    global: {
      type: "object",
      properties: { namespacePurpose: { type: "string" } },
    },
    vpcEgressGateway: {
      title: "Выход с известного адреса",
      type: "object",
      additionalProperties: false,
      properties: {
        name: { title: "Имя выхода", type: "string" },
        externalIPs: { title: "Внешние адреса", type: "array", items: { type: "string" } },
      },
    },
    serviceEntries: {
      title: "Внешние сервисы",
      type: "array",
      items: { type: "object", properties: { name: { type: "string" } } },
    },
  },
};

describe("adaptToSchema", () => {
  test("values the schema already accepts come back untouched", () => {
    const values = {
      global: { namespacePurpose: "egw-eg" },
      vpcEgressGateway: { name: "vip", externalIPs: ["10.0.0.1"] },
    };
    const { values: out, notes } = adaptToSchema(schema, values);
    expect(out).toEqual(values);
    expect(notes).toEqual([]);
  });

  test("a list that became one block keeps the first element", () => {
    const { values: out, notes } = adaptToSchema(schema, {
      vpcEgressGateway: [{ name: "nvpc", externalIPs: ["10.193.97.2"] }],
    });
    expect(out.vpcEgressGateway).toEqual({ name: "nvpc", externalIPs: ["10.193.97.2"] });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toStartWith("Выход с известного адреса:");
    expect(notes[0]).not.toContain("Остальные");
  });

  test("elements past the first are named, not dropped in silence", () => {
    const { notes } = adaptToSchema(schema, {
      vpcEgressGateway: [{ name: "a" }, { name: "b" }],
    });
    expect(notes[0]).toContain("Остальные элементы удалены.");
  });

  test("a list already spread into the block is read back out of it", () => {
    // What an upgrade form wrote before this existed: the old list under "0",
    // the new field beside it. The name is out of reach until it is merged back.
    const { values: out, notes } = adaptToSchema(schema, {
      vpcEgressGateway: {
        "0": { name: "nvpc", externalIPs: ["10.193.97.2"] },
        externalIPs: ["10.193.97.9"],
      },
    });
    expect(out.vpcEgressGateway).toEqual({ name: "nvpc", externalIPs: ["10.193.97.9"] });
    expect(notes).toHaveLength(1);
  });

  test("a field the new version does not have is removed and said so", () => {
    const { values: out, notes } = adaptToSchema(schema, {
      identity: { cluster: "dev" },
      egressGateway: { name: "negr" },
      vpcEgressGateway: { name: "vip" },
    });
    expect(out).toEqual({ vpcEgressGateway: { name: "vip" } });
    expect(notes).toHaveLength(2);
    expect(notes[0]).toBe("identity: в новой версии такого поля нет. Значение удалено.");
  });

  test("an unknown key stays where the chart accepts unknown keys", () => {
    const loose = { type: "object", properties: { a: { type: "string" } } };
    const { values: out, notes } = adaptToSchema(loose, { a: "x", extra: 1 });
    expect(out).toEqual({ a: "x", extra: 1 });
    expect(notes).toEqual([]);
  });

  test("one block that became a list becomes its first element", () => {
    const { values: out, notes } = adaptToSchema(schema, { serviceEntries: { name: "api" } });
    expect(out.serviceEntries).toEqual([{ name: "api" }]);
    expect(notes[0]).toContain("Внешние сервисы:");
  });

  test("a list spread into numbered keys is read back as a list", () => {
    const { values: out, notes } = adaptToSchema(schema, {
      serviceEntries: { "0": { name: "api" }, "1": { name: "db" } },
    });
    expect(out.serviceEntries).toEqual([{ name: "api" }, { name: "db" }]);
    expect(notes).toEqual([]);
  });

  test("a structure where the new version wants a value clears the field", () => {
    const { values: out, notes } = adaptToSchema(schema, {
      vpcEgressGateway: { name: { first: "vip" } },
    });
    expect(out.vpcEgressGateway).toEqual({});
    expect(notes[0]).toContain("Имя выхода:");
  });

  test("a view's own title is what a note calls the field", () => {
    const view = { overrides: { vpcEgressGateway: { title: "Выход" } } };
    const { notes } = adaptToSchema(schema, { vpcEgressGateway: [{ name: "a" }] }, view);
    expect(notes[0]).toStartWith("Выход:");
  });

  test("a variant is left to the form to sort out", () => {
    const variant = {
      type: "object",
      properties: {
        source: { oneOf: [{ type: "object", properties: { file: { type: "string" } } }] },
      },
    };
    const { values: out, notes } = adaptToSchema(variant, { source: { vault: "kv" } });
    expect(out).toEqual({ source: { vault: "kv" } });
    expect(notes).toEqual([]);
  });
});

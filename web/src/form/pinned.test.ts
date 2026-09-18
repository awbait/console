import { describe, expect, test } from "bun:test";
import { fieldMsg, schemaViolationText } from "./fieldErrors";
import { fieldBreadcrumb, pinnedAt } from "./fieldPath";
import { collectErrors } from "./SchemaForm";

// The rule the egress gateway chart declares at its root: the mode decides
// whether the gateway namespace is created at all. Both fields are visible from
// there, which is why the rule lives there and not on either of them.
const schema = {
  type: "object",
  properties: {
    mode: { title: "Режим", type: "string", enum: ["mesh", "direct"] },
    waypointNamespace: {
      title: "Namespace гейтвея",
      type: "object",
      properties: { enabled: { type: "boolean" } },
    },
  },
  allOf: [
    {
      if: { properties: { mode: { const: "direct" } }, required: ["mode"] },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema keyword, not a thenable
      then: { properties: { waypointNamespace: { properties: { enabled: { const: false } } } } },
    },
    {
      if: { properties: { mode: { const: "mesh" } }, required: ["mode"] },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema keyword, not a thenable
      then: { properties: { waypointNamespace: { properties: { enabled: { const: true } } } } },
    },
  ],
};

// The view draws that field by its path and gives it the name the person reads.
const view = {
  include: ["mode", "waypointNamespace/enabled"],
  overrides: {
    "waypointNamespace/enabled": { title: "Создавать namespace гейтвея" },
  },
};

describe("a field another field pins", () => {
  test("says which way to put it, not that the value 'does not fit'", () => {
    const errors = collectErrors(schema, { mode: "direct", waypointNamespace: { enabled: true } }, view);
    expect(errors.get("/waypointNamespace/enabled")).toBe("Выключите это поле.");
  });

  test("the other mode pins it the other way", () => {
    const errors = collectErrors(schema, { mode: "mesh", waypointNamespace: { enabled: false } }, view);
    expect(errors.get("/waypointNamespace/enabled")).toBe("Включите это поле.");
  });

  test("a value the rule allows passes", () => {
    const errors = collectErrors(schema, { mode: "direct", waypointNamespace: { enabled: false } }, view);
    expect(errors.size).toBe(0);
  });

  test("nothing is pinned while the deciding field is unanswered", () => {
    const errors = collectErrors(schema, { waypointNamespace: { enabled: true } }, view);
    expect(errors.size).toBe(0);
  });

  test("pinnedAt reads the rule off the branch that holds", () => {
    expect(pinnedAt("/waypointNamespace/enabled", schema, { mode: "direct" })).toBe(false);
    expect(pinnedAt("/waypointNamespace/enabled", schema, { mode: "mesh" })).toBe(true);
    expect(pinnedAt("/waypointNamespace/enabled", schema, {})).toBeUndefined();
    expect(pinnedAt("/mode", schema, { mode: "direct" })).toBeUndefined();
  });

  test("the message for a single pinned value is not a list of one", () => {
    expect(schemaViolationText("const", { const: false })).toBe("Выключите это поле.");
    expect(schemaViolationText("const", { const: "vip" })).toBe("Допустимое значение: vip.");
    // A real choice still reads as a choice.
    expect(schemaViolationText("enum", { enum: ["mesh", "direct"] })).toBe(
      fieldMsg.oneOf(["mesh", "direct"]),
    );
  });
});

describe("naming a field the view reaches into", () => {
  test("the row calls it what the form calls it", () => {
    expect(fieldBreadcrumb("/waypointNamespace/enabled", schema, view)).toBe(
      "Создавать namespace гейтвея",
    );
  });

  test("a field the view does not name keeps the walk through the schema", () => {
    expect(fieldBreadcrumb("/waypointNamespace", schema, view)).toBe("Namespace гейтвея");
  });

  test("without a view it is the schema's own titles", () => {
    expect(fieldBreadcrumb("/waypointNamespace/enabled", schema)).toBe("Namespace гейтвея › enabled");
  });
});

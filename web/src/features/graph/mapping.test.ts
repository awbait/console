import { describe, expect, test } from "bun:test";
import { countGraphRules, defaultMapping, readGraphMapping } from "./mapping";

const policies = defaultMapping("policies");

// The form refuses to send an order that draws nothing, so what counts as
// "nothing" has to match what the backend counts (internal/views/graph.go).
describe("countGraphRules", () => {
  test("no section at all", () => {
    expect(countGraphRules({ auth: {} }, policies)).toBe(0);
  });

  test("empty list", () => {
    expect(countGraphRules({ policies: [] }, policies)).toBe(0);
  });

  test("an entry without rules", () => {
    expect(countGraphRules({ policies: [{ name: "app", ingress: [], egress: [] }] }, policies))
      .toBe(0);
  });

  test("rules in both directions across entries", () => {
    const values = {
      policies: [
        { name: "a", egress: [{}, {}] },
        { name: "b", ingress: [{}] },
      ],
    };
    expect(countGraphRules(values, policies)).toBe(3);
  });

  test("a section that is not a list", () => {
    expect(countGraphRules({ policies: "nope" }, policies)).toBe(0);
  });

  test("fields the version renamed are counted by their new names", () => {
    const mapping = readGraphMapping({
      graph: { profile: "policies", entries: "/network/rules", entry: { ingress: "incoming" } },
    } as never);
    if (!mapping) throw new Error("no mapping");
    const values = { network: { rules: [{ incoming: [{}], ingress: [{}] }] } };
    expect(countGraphRules(values, mapping)).toBe(1);
  });
});

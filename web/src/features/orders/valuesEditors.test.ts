import { describe, expect, test } from "bun:test";
import { valuesEditorPlugins } from "./valuesEditors";

// The graph rewrites values through a mapping written for one values shape, so
// the version it is offered on decides whether editing is safe at all.
describe("valuesEditorPlugins", () => {
  const ids = (chart: string, version: string) =>
    valuesEditorPlugins(chart, version).map((p) => p.id);

  test("the graph is offered on the versions its mapping was written for", () => {
    expect(ids("policies", "0.3.0")).toEqual(["graph"]);
    expect(ids("policies", "0.3.7")).toEqual(["graph"]);
  });

  test("a version below the range gets no graph", () => {
    expect(ids("policies", "0.2.9")).toEqual([]);
  });

  test("the next minor gets no graph: below 1.0 it may reshape the values", () => {
    expect(ids("policies", "0.4.0")).toEqual([]);
    expect(ids("policies", "1.0.0")).toEqual([]);
  });

  test("a pre-release counts as the release it belongs to", () => {
    // 0.4.0-rc1 already carries the 0.4 values, so it is out of the range even
    // though semver orders it below 0.4.0.
    expect(ids("policies", "0.4.0-rc1")).toEqual([]);
    expect(ids("policies", "0.3.0-rc1")).toEqual(["graph"]);
  });

  test("an unknown version gets no graph rather than a guess", () => {
    expect(ids("policies", "")).toEqual([]);
  });

  test("a chart with no plugin stays on the form and the YAML", () => {
    expect(ids("ingress-gateway", "3.2.4")).toEqual([]);
  });
});

import { describe, expect, it } from "bun:test";
import { parseNamespaceDirective, resolveDestNamespace } from "./namespace";
import { parseRef, renderNamespaceTemplate, usesVariables, variableValuesOn } from "./tmpl";

// The same cases as internal/views/namespace_test.go: the form shows what the
// server will build, so the two have to agree.
describe("renderNamespaceTemplate", () => {
  const values = {
    global: { identity: { cluster: "dev" }, namespacePurpose: "app" },
    "my-key": { x: "keyed" },
    replica: 3,
    on: true,
    empty: "",
    obj: { a: "b" },
  };
  const ctx = { team: "nbox", serviceName: "s", cluster: "c", chart: "ch", vars: { OPS: "ops" } };

  it("builds the name the namespace chart builds", () => {
    const tmpl = "{{.Team}}-{{.Values.global.identity.cluster}}-ns-{{ .Values.global.namespacePurpose }}";
    expect(renderNamespaceTemplate(tmpl, values, ctx)).toBe("nbox-dev-ns-app");
  });

  it("reads the index form, numbers, booleans, the context and variables", () => {
    expect(renderNamespaceTemplate('{{index .Values "my-key" "x"}}', values, ctx)).toBe("keyed");
    expect(renderNamespaceTemplate("r{{.Values.replica}}-{{.Values.on}}", values, ctx)).toBe("r3-true");
    expect(renderNamespaceTemplate("{{.ServiceName}}.{{.Cluster}}.{{.Chart}}.{{.Vars.OPS}}", values, ctx)).toBe(
      "s.c.ch.ops",
    );
  });

  it("shows nothing rather than half a name", () => {
    for (const tmpl of [
      "a-{{.Values.empty}}",
      "a-{{.Values.absent}}",
      "a-{{.Values.obj}}",
      "a-{{.Values}}",
      "a-{{.Namespace}}",
      "a-{{.User.Name}}",
      "a-{{.Vars.MISSING}}",
      "a-{{if .Team}}x{{end}}",
      "a-{{ $labels.x }}",
      "a-{{.Team",
    ]) {
      expect(renderNamespaceTemplate(tmpl, values, ctx)).toBe("");
    }
  });

  it("waits for the variables before it shows a name that needs one", () => {
    expect(renderNamespaceTemplate("{{.Vars.OPS}}-x", values, { ...ctx, vars: undefined })).toBe("");
  });
});

describe("parseRef", () => {
  it("reads both forms of the dialect", () => {
    expect(parseRef(".Values.a.b")).toEqual(["Values", "a", "b"]);
    expect(parseRef('index .Values "a-b" "c"')).toEqual(["Values", "a-b", "c"]);
    expect(parseRef('index .Values a')).toBeNull();
    expect(parseRef(".Team | upper")).toBeNull();
  });
});

describe("variables", () => {
  it("knows when a template names one", () => {
    expect(usesVariables("{{.Vars.OPS}}-x")).toBe(true);
    expect(usesVariables("{{.Team}}-x")).toBe(false);
  });

  it("takes the stand's own value over the shared one", () => {
    const list = [
      { name: "A", value: "shared", overrides: [{ stand_id: "s1", value: "own" }] },
      { name: "B", value: "b", overrides: [] },
    ];
    expect(variableValuesOn(list, "s1")).toEqual({ A: "own", B: "b" });
    expect(variableValuesOn(list, "s2")).toEqual({ A: "shared", B: "b" });
  });
});

describe("the template source", () => {
  it("parses and hides the field like the other sources", () => {
    const ns = parseNamespaceDirective({ source: "template", template: "x-{{.Team}}", hideOrderField: true });
    expect(ns.source).toBe("template");
    expect(ns.hideField).toBe(true);
    expect(resolveDestNamespace(ns, "typed", {}, { team: "t" })).toBe("x-t");
  });
});

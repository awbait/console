import { describe, expect, test } from "bun:test";
import type { ViewDocument } from "@/api/types";
import { valuesEditorFor } from "./valuesEditors";

// Which editor a chart version offers is declared by that version's own view
// document, so adding the graph to a chart is editing a document, not shipping a
// portal release, and two versions can differ.
const doc = (graph: unknown): ViewDocument =>
  ({ views: { order: { include: [] } }, graph }) as ViewDocument;

describe("valuesEditorFor", () => {
  test("a version that declares the profile gets the graph", () => {
    const editor = valuesEditorFor(doc({ profile: "policies" }));
    expect(editor?.plugin.id).toBe("graph");
    // A chart that follows the convention names nothing else.
    expect(editor?.mapping.entries).toBe("/policies");
    expect(editor?.mapping.entry.selector).toBe("selector");
  });

  test("a version with no graph block keeps the form and the YAML", () => {
    expect(valuesEditorFor(doc(undefined))).toBeNull();
    expect(valuesEditorFor({ views: { order: {} } } as ViewDocument)).toBeNull();
    expect(valuesEditorFor(null)).toBeNull();
  });

  test("the block can be switched off without deleting the mapping", () => {
    expect(valuesEditorFor(doc({ profile: "policies", enabled: false }))).toBeNull();
    expect(valuesEditorFor(doc({ profile: "policies", enabled: true }))).not.toBeNull();
  });

  test("a profile this portal does not implement gets no editor", () => {
    expect(valuesEditorFor(doc({ profile: "service-mesh" }))).toBeNull();
    expect(valuesEditorFor(doc({ enabled: true }))).toBeNull();
    expect(valuesEditorFor(doc("policies"))).toBeNull();
  });

  test("the document renames the fields the chart moved", () => {
    const editor = valuesEditorFor(
      doc({
        profile: "policies",
        entries: "/network/rules",
        entry: { selector: "podSelector", ingress: "inbound" },
        peer: { namespace: "ns" },
      }),
    );
    expect(editor?.mapping.entries).toBe("/network/rules");
    expect(editor?.mapping.entry.selector).toBe("podSelector");
    expect(editor?.mapping.entry.ingress).toBe("inbound");
    expect(editor?.mapping.peer.namespace).toBe("ns");
    // Untouched fields keep the convention.
    expect(editor?.mapping.entry.egress).toBe("egress");
    expect(editor?.mapping.rule.ports).toBe("ports");
  });

  test("nonsense in the document falls back to the convention", () => {
    // The backend reports these as issues on the version; the reader must not
    // hand a broken mapping to an editor that rewrites values.
    const editor = valuesEditorFor(
      doc({
        profile: "policies",
        entries: "policies",
        entry: { selector: "a/b", colour: "red", name: 1 },
      }),
    );
    expect(editor?.mapping.entries).toBe("/policies");
    expect(editor?.mapping.entry.selector).toBe("selector");
    expect(editor?.mapping.entry.name).toBe("name");
    expect(editor?.mapping.entry.colour).toBeUndefined();
  });
});

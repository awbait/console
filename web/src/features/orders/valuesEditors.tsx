// The extra values editor a chart version can turn on, on top of the schema form
// and the raw YAML.
//
// The portal stays chart-agnostic: it knows domains, not charts. Which editor a
// version uses, and where that editor's fields live in the values, is declared by
// the version's own view document (the "graph" block, see
// features/graph/mapping.ts and internal/views/graph.go). So adding the graph to
// a chart is editing that chart's view document, not shipping a portal release,
// and two versions of one chart can carry two different mappings.

import { type ComponentType, lazy } from "react";
import type { ViewDocument } from "@/api/types";
import { type GraphMapping, readGraphMapping } from "../graph/mapping";

type Values = Record<string, unknown>;

export interface ValuesEditorProps {
  values: Values;
  onValues: (v: Values) => void;
  // The order (destination) namespace; empty string until the user fills it.
  namespace: string;
  // Chart version being ordered. Editors stamp it into whatever they persist so
  // a later read can tell which values shape the state was produced against.
  chartVersion: string;
  // Where this chart version keeps the fields the editor reads and writes.
  mapping: GraphMapping;
  readOnly?: boolean;
  // Take the height of the container instead of the editor's own. The order form
  // gives an editor a fixed slice of a scrolling page; a dialog opened for the
  // canvas alone gives it the whole window, and a graph is only as useful as the
  // room it has to be read in.
  fill?: boolean;
  // Set when the raw YAML could not be parsed on switching into the editor:
  // it must show the error and leave the values untouched.
  inputError?: string | null;
  // Opaque editor state that survives mode switches (the editor unmounts when
  // another mode is active): it reads this on mount and reports updates.
  editorState?: unknown;
  onEditorState?: (s: unknown) => void;
}

export interface ValuesEditorPlugin {
  id: string;
  label: string;
  // Small highlight next to the label (e.g. "new").
  badge?: string;
  // Lazy so heavy editors (React Flow) stay out of the main bundle.
  Component: ComponentType<ValuesEditorProps>;
}

const policiesGraph: ValuesEditorPlugin = {
  id: "graph",
  label: "Граф",
  badge: "новое",
  Component: lazy(() =>
    import("../graph/profiles/policies/PoliciesValuesEditor").then((m) => ({
      default: m.PoliciesValuesEditor,
    })),
  ),
};

// Domains the portal implements, keyed by profile id. This is the closed list:
// the semantics of a domain are behaviour and live in code, while the field names
// they read come from the chart.
const PROFILES: Record<string, ValuesEditorPlugin> = {
  policies: policiesGraph,
};

export interface ActiveValuesEditor {
  plugin: ValuesEditorPlugin;
  mapping: GraphMapping;
}

// valuesEditorFor returns the editor a version's view document turns on, or null
// when it turns on none: no "graph" block, the block switched off, or a profile
// this portal does not implement. Null means the order form keeps the form and
// the raw YAML, which work for every chart regardless.
export function valuesEditorFor(doc: ViewDocument | null | undefined): ActiveValuesEditor | null {
  const mapping = readGraphMapping(doc);
  if (!mapping) return null;
  const plugin = PROFILES[mapping.profile];
  return plugin ? { plugin, mapping } : null;
}

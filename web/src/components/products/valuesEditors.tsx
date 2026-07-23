// Registry of chart-specific extra values editors for the order form. The
// portal stays chart-agnostic: a plugin is an optional UI upgrade keyed by
// chart name - the schema form and the raw YAML editor keep working for every
// chart regardless.

import { type ComponentType, lazy } from "react";

type Values = Record<string, unknown>;

export interface ValuesEditorProps {
  values: Values;
  onValues: (v: Values) => void;
  // The order (destination) namespace; empty string until the user fills it.
  namespace: string;
  readOnly?: boolean;
  // Set when the raw YAML could not be parsed on switching into the plugin:
  // the plugin must show the error and leave the values untouched.
  inputError?: string | null;
  // Opaque editor state that survives mode switches (the plugin unmounts when
  // another mode is active): the plugin reads it on mount and reports updates.
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
    import("../../pages/policiesMap/PoliciesValuesEditor").then((m) => ({
      default: m.PoliciesValuesEditor,
    })),
  ),
};

const REGISTRY: Record<string, ValuesEditorPlugin[]> = {
  policies: [policiesGraph],
};

export function valuesEditorPlugins(chartName: string): ValuesEditorPlugin[] {
  return REGISTRY[chartName] ?? [];
}

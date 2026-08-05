// Registry of chart-specific extra values editors for the order form. The
// portal stays chart-agnostic: a plugin is an optional UI upgrade keyed by
// chart name - the schema form and the raw YAML editor keep working for every
// chart regardless.

import { type ComponentType, lazy } from "react";
import { compareSemver } from "../../lib/semver";

type Values = Record<string, unknown>;

export interface ValuesEditorProps {
  values: Values;
  onValues: (v: Values) => void;
  // The order (destination) namespace; empty string until the user fills it.
  namespace: string;
  // Chart version being ordered. Always one this plugin declares support for
  // (see chartVersions below); plugins stamp it into whatever they persist so a
  // later read can tell which values shape the state was produced against.
  chartVersion: string;
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
  // Chart versions whose values this plugin knows how to read and write, as the
  // half-open range [since, before). A plugin does not just display values, it
  // rewrites them through a mapping written against one concrete shape, so a
  // chart that has moved past that shape must fall back to the form and the raw
  // YAML instead of being edited through a stale mapping.
  //
  // This is where the mapping is bound to a chart version until the binding
  // moves into the version's own view document (`views.graph`), which is what
  // finally lets two versions of one chart carry two different mappings.
  chartVersions: { since: string; before: string };
  // Lazy so heavy editors (React Flow) stay out of the main bundle.
  Component: ComponentType<ValuesEditorProps>;
}

const policiesGraph: ValuesEditorPlugin = {
  id: "graph",
  label: "Граф",
  badge: "новое",
  // Written against the policies values of 0.3.x. Below 1.0 a minor bump is
  // allowed to break the shape, so the range ends at the next minor.
  chartVersions: { since: "0.3.0", before: "0.4.0" },
  Component: lazy(() =>
    import("../graph/profiles/policies/PoliciesValuesEditor").then((m) => ({
      default: m.PoliciesValuesEditor,
    })),
  ),
};

const REGISTRY: Record<string, ValuesEditorPlugin[]> = {
  policies: [policiesGraph],
};

// Bounds are compared against the release the version belongs to, so a
// pre-release counts as its own release: 0.4.0-rc1 already carries the 0.4
// values and is out of a range ending at 0.4.0.
const release = (version: string) => version.split("-")[0];

export function supportsChartVersion(plugin: ValuesEditorPlugin, chartVersion: string): boolean {
  // No version, no plugin: the mapping is only safe on a version it was written
  // for, and guessing costs the user their values.
  if (!chartVersion) return false;
  const v = release(chartVersion);
  return (
    compareSemver(v, plugin.chartVersions.since) >= 0 &&
    compareSemver(v, plugin.chartVersions.before) < 0
  );
}

export function valuesEditorPlugins(
  chartName: string,
  chartVersion: string,
): ValuesEditorPlugin[] {
  return (REGISTRY[chartName] ?? []).filter((p) => supportsChartVersion(p, chartVersion));
}

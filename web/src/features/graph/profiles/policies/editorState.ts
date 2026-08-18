// The policies canvas holds facts the chart values cannot express: workloads
// with no links yet (and their service accounts and exposed ports), empty
// namespaces, node positions. The chart schema forbids extra keys, so this
// travels beside the values as the order's editor state.
//
// The envelope is what every graph profile writes: the profile that owns the
// document and a version, so a later format change can be detected instead of
// crashing on a stale canvas.

import type { XY } from "@/features/graph/core/model";
import type { TopoNamespace } from "./topology";

export const POLICIES_PROFILE = "policies";
const CURRENT_VERSION = 1;

// SavedGraphState is the payload: the canvas as it was, keyed to the order
// namespace it was drawn around (a different namespace means a different graph).
export interface SavedGraphState {
  orderNs: string;
  topology: TopoNamespace[];
  positions: Record<string, XY>;
}

interface Envelope {
  profile: string;
  // Format of the envelope itself, not of the chart.
  version: number;
  // Chart version the canvas was drawn against. The saved workloads are matched
  // back onto the values by selector, and what a selector means comes from the
  // chart, so a canvas is only safe to reuse on a chart that reads the same way.
  // Optional: canvases saved before the field existed have no other mapping they
  // could have come from.
  chartVersion?: string;
  data: SavedGraphState;
}

export function packEditorState(s: SavedGraphState, chartVersion: string): Envelope {
  return {
    profile: POLICIES_PROFILE,
    version: CURRENT_VERSION,
    chartVersion,
    data: s,
  };
}

// sameShape compares two chart versions the way the values mapping cares about:
// by release line, ignoring patches and pre-release suffixes. It mirrors the
// range the plugin declares (see features/orders/valuesEditors.tsx) - a patch
// does not reshape the values, a minor is allowed to.
function sameShape(a: string, b: string): boolean {
  const line = (v: string) => v.trim().replace(/^v/i, "").split("-")[0].split(".").slice(0, 2).join(".");
  return line(a) === line(b);
}

// readEditorState unwraps what the backend returned. Anything else - another
// profile, a newer format, a canvas drawn against a different chart release, a
// hand-edited document - reads as "no saved canvas", and the graph is rebuilt
// from the values alone. Losing the box positions once after a chart upgrade is
// cheaper than pinning a saved service account onto the wrong workload.
export function readEditorState(raw: unknown, chartVersion: string): SavedGraphState | null {
  if (!raw || typeof raw !== "object") return null;
  const env = raw as Partial<Envelope>;
  if (env.profile !== POLICIES_PROFILE || env.version !== CURRENT_VERSION) return null;
  if (env.chartVersion && chartVersion && !sameShape(env.chartVersion, chartVersion)) return null;
  const data = env.data;
  if (!data || typeof data !== "object") return null;
  if (typeof data.orderNs !== "string" || !Array.isArray(data.topology)) return null;
  return { orderNs: data.orderNs, topology: data.topology, positions: data.positions ?? {} };
}

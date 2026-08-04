// The policies canvas holds facts the chart values cannot express: workloads
// with no links yet (and their service accounts and exposed ports), empty
// namespaces, node positions. The chart schema forbids extra keys, so this
// travels beside the values as the order's editor state.
//
// The envelope is what every graph profile writes: the profile that owns the
// document and a version, so a later format change can be detected instead of
// crashing on a stale canvas.

import type { XY } from "../../core/model";
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
  version: number;
  data: SavedGraphState;
}

export function packEditorState(s: SavedGraphState): Envelope {
  return { profile: POLICIES_PROFILE, version: CURRENT_VERSION, data: s };
}

// readEditorState unwraps what the backend returned. Anything else - another
// profile, a newer format, a hand-edited document - reads as "no saved canvas",
// and the graph is rebuilt from the values alone.
export function readEditorState(raw: unknown): SavedGraphState | null {
  if (!raw || typeof raw !== "object") return null;
  const env = raw as Partial<Envelope>;
  if (env.profile !== POLICIES_PROFILE || env.version !== CURRENT_VERSION) return null;
  const data = env.data;
  if (!data || typeof data !== "object") return null;
  if (typeof data.orderNs !== "string" || !Array.isArray(data.topology)) return null;
  return { orderNs: data.orderNs, topology: data.topology, positions: data.positions ?? {} };
}

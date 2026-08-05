// Where a chart keeps the fields a graph profile reads and writes.
//
// The domain lives here in the portal as a profile: for policies, an arrow out of
// the order namespace is an egress rule on its source, a sender needs a service
// account, rules of one owner merge into one entry. That is behaviour and it
// belongs in code. The field NAMES are what a chart update moves, so they come
// from the chart version's own view document (the "graph" block, validated in
// internal/views/graph.go) and two versions can carry two mappings that both work.
//
// Every field defaults to a values key of its own name, so a chart that follows
// the convention needs nothing but {"graph": {"profile": "policies"}}.

import type { ViewDocument } from "../../api/types";

export interface GraphMapping {
  profile: string;
  // JSON pointer to the list of entries in the values.
  entries: string;
  entry: Record<string, string>;
  rule: Record<string, string>;
  peer: Record<string, string>;
}

// Keep in step with graphProfiles in internal/views/graph.go.
const PROFILE_DEFAULTS: Record<string, GraphMapping> = {
  policies: {
    profile: "policies",
    entries: "/policies",
    entry: {
      name: "name",
      enabled: "enabled",
      selector: "selector",
      serviceAccount: "serviceAccount",
      ingress: "ingress",
      egress: "egress",
    },
    rule: { ports: "ports", from: "from", to: "to" },
    peer: { namespace: "namespace", selector: "selector", serviceAccount: "serviceAccount" },
  },
};

// defaultMapping is the mapping of a chart that follows the profile's naming
// convention: what a "graph" block with nothing but a profile resolves to.
export function defaultMapping(profile: string): GraphMapping {
  const base = PROFILE_DEFAULTS[profile];
  if (!base) throw new Error(`unknown graph profile: ${profile}`);
  return base;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// renamed overlays the document's names on the defaults, taking only fields the
// profile actually has: an unknown key is the author's typo, and the backend
// already reported it as an issue on the version.
function renamed(base: Record<string, string>, raw: unknown): Record<string, string> {
  if (!isObject(raw)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(raw)) {
    if (k in base && typeof v === "string" && v && !v.includes("/")) out[k] = v;
  }
  return out;
}

// readGraphMapping returns the mapping a version's view document declares, or
// null when this version has no graph: no block, the block switched off, or a
// profile this portal does not implement. Null is how the graph tab stays away
// from a chart whose values it cannot be trusted with.
export function readGraphMapping(doc: ViewDocument | null | undefined): GraphMapping | null {
  const raw = (doc as { graph?: unknown } | null | undefined)?.graph;
  if (!isObject(raw)) return null;
  if (raw.enabled === false) return null;
  const base = typeof raw.profile === "string" ? PROFILE_DEFAULTS[raw.profile] : undefined;
  if (!base) return null;
  const entries = raw.entries;
  return {
    profile: base.profile,
    entries: typeof entries === "string" && entries.startsWith("/") ? entries : base.entries,
    entry: renamed(base.entry, raw.entry),
    rule: renamed(base.rule, raw.rule),
    peer: renamed(base.peer, raw.peer),
  };
}

const segments = (pointer: string) => pointer.replace(/^\//, "").split("/");

// entriesLabel names the section in a message the way the user sees it in the
// values ("policies", "network/rules").
export const entriesLabel = (pointer: string) => pointer.replace(/^\//, "");

// readEntries pulls the entry list out of the values. A missing or non-list
// section reads as empty - the caller reports the shape, this only reads.
export function readEntries(values: Record<string, unknown>, pointer: string): unknown {
  let cur: unknown = values;
  for (const seg of segments(pointer)) {
    if (!isObject(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

// writeEntries returns a copy of the values with the entry list replaced,
// creating the objects on the way when the section is not there yet. Everything
// it does not touch is carried over by reference: the graph owns its own section
// and nothing else in the values.
export function writeEntries(
  values: Record<string, unknown>,
  pointer: string,
  list: unknown[],
): Record<string, unknown> {
  const path = segments(pointer);
  const root = { ...values };
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < path.length - 1; i++) {
    const next = cur[path[i]];
    const copy = isObject(next) ? { ...next } : {};
    cur[path[i]] = copy;
    cur = copy;
  }
  cur[path[path.length - 1]] = list;
  return root;
}

// Domain-agnostic graph model shared by every profile.
//
// A profile (policies, event mesh, resource topology) describes one domain in
// these terms and the core renders it: boxes that group cards, cards with rows,
// arrows between cards or rows. Nothing here knows about Kubernetes, values or
// policies - that lives in profiles/<name>.

export type XY = { x: number; y: number };

// A row inside a card: a port, a subscription, an attribute. Rows are the fine
// grained arrow anchors; an arrow may also attach to the card itself.
export interface GraphRow {
  id: string;
  label: string;
  // Short trailing marker, e.g. a protocol or a resource state.
  tag?: string;
}

// Card tone drives the accent colour of the kind badge. Profiles map their own
// kinds onto this small palette so different domains stay visually consistent.
export type NodeTone = "neutral" | "accent" | "warn" | "muted";

export interface GraphNode {
  id: string;
  groupId: string;
  title: string;
  // Profile-defined kind, looked up in GraphProfile.kinds for its label/tone.
  kind: string;
  // Secondary line under the title (service account, owner, image, ...).
  subtitle?: string;
  subtitleLabel?: string;
  rows: GraphRow[];
  // Shown instead of the row list when there are no rows.
  emptyRows?: string;
  // Non-null marks the card as broken and is used as its tooltip.
  invalid?: string | null;
}

export interface GraphGroup {
  id: string;
  title: string;
  // "primary" is the box the graph is centred on (the order namespace for
  // policies); "secondary" is a related box worth a lighter accent.
  accent?: "primary" | "secondary";
  // Small label rendered next to the title (a role, a count, a cluster).
  note?: string;
}

export interface GraphLink {
  id: string;
  from: string; // node id
  to: string; // node id
  // Row ids when the arrow attaches to a row rather than the card.
  fromRow?: string;
  toRow?: string;
  label?: string;
}

export interface GraphData {
  groups: GraphGroup[];
  nodes: GraphNode[];
  links: GraphLink[];
  // Remembered box positions; missing entries are laid out automatically.
  positions?: Record<string, XY>;
}

export interface LegendEntry {
  // Rendered as the sample swatch: a tone chip or a short literal.
  tone?: NodeTone;
  text: string;
}

// GraphLayout says how the canvas arranges what a profile describes.
export interface GraphLayout {
  // Where the next box goes: to the right (good when the story crosses
  // namespaces) or below (good when each box holds a whole flow of its own).
  groups: "row" | "column";
  // Cards inside a box: a plain vertical list, or columns that follow the
  // arrows - entry points on the left, what they reach to the right.
  nodes: "stack" | "flow";
}

export const DEFAULT_LAYOUT: GraphLayout = { groups: "row", nodes: "stack" };

// GraphProfile teaches the core how to speak one domain: what a box and a card
// are called, how each kind is labelled, and what the legend says.
export interface GraphProfile {
  id: string;
  title: string;
  // What the boxes are ("namespace", "broker"), used in empty states.
  groupNoun: string;
  kinds: Record<string, { label: string; tone?: NodeTone }>;
  legend: LegendEntry[];
  // Shown on an empty canvas.
  emptyHint: string;
  // Omitted means DEFAULT_LAYOUT.
  layout?: GraphLayout;
}

export function kindLabel(profile: GraphProfile, kind: string): string {
  return profile.kinds[kind]?.label ?? kind;
}

export function kindTone(profile: GraphProfile, kind: string): NodeTone {
  return profile.kinds[kind]?.tone ?? "neutral";
}

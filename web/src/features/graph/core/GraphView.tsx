import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  MarkerType,
  type Node,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import { useMemo } from "react";
import "@xyflow/react/dist/style.css";
import "./graph.css";
import { bodyHandle, CardNode, rowHandleId } from "./CardNode";
import { FlowEdge } from "./FlowEdge";
import type { GraphData, GraphLink, GraphNode, GraphProfile, XY } from "./model";
import { DEFAULT_LAYOUT } from "./model";

const nodeTypes = { card: CardNode, group: GroupNode };
const edgeTypes = { flow: FlowEdge };

// Layout constants; the card width must match .rf-card in graph.css. The gaps
// are what the arrows travel through: a column gap has to fit an arrow with its
// label, so it is far wider than the padding to the box edge.
const GROUP_GAP = 140;
const HEAD = 40;
const PAD = 14; // box padding around its cards
const COL_GAP = 90; // between card columns inside a box
const CARD_GAP = 18; // between stacked cards
const CARD_W = 230;
const ROW_H = 26;

const ARROW = {
  type: MarkerType.ArrowClosed,
  width: 20,
  height: 20,
  markerUnits: "userSpaceOnUse",
};

function GroupNode({ data }: { data: { label: string; note?: string } }) {
  return (
    <div className="rf-ns__title">
      <span className="rf-ns__name">{data.label}</span>
      {data.note && <span className="rf-ns__order">{data.note}</span>}
    </div>
  );
}

// Card height: header (taller with a subtitle) plus the rows, or the empty note.
function cardHeight(n: GraphNode): number {
  const head = n.subtitle ? 50 : 34;
  return head + (n.rows.length > 0 ? n.rows.length * ROW_H : 33);
}

function stackHeight(nodes: GraphNode[]): number {
  if (nodes.length === 0) return 0;
  return nodes.reduce((sum, n) => sum + cardHeight(n), 0) + (nodes.length - 1) * CARD_GAP;
}

// columns splits a box's cards into left-to-right ranks by following the arrows
// inside that box: a card with no incoming arrow starts a column, every other
// card sits one column right of the furthest card pointing at it. Cycles cannot
// run away - each pass can only push a card one column further and there are at
// most as many passes as cards.
function columns(nodes: GraphNode[], links: GraphLink[]): GraphNode[][] {
  const own = new Set(nodes.map((n) => n.id));
  const inner = links.filter((l) => own.has(l.from) && own.has(l.to) && l.from !== l.to);
  const rank = new Map(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) {
    let moved = false;
    for (const l of inner) {
      const next = (rank.get(l.from) ?? 0) + 1;
      if (next > (rank.get(l.to) ?? 0) && next < nodes.length) {
        rank.set(l.to, next);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const out: GraphNode[][] = [];
  for (const n of nodes) {
    const r = rank.get(n.id) ?? 0;
    if (!out[r]) out[r] = [];
    out[r].push(n);
  }
  return out.filter(Boolean);
}

// build places the boxes the way the profile asked (a row or a column, unless
// saved positions say otherwise) and fills each one either as a plain stack or
// as columns following the arrows.
function build(data: GraphData, profile: GraphProfile): { nodes: Node[]; edges: Edge[] } {
  const anchored = new Map<string, Set<string>>();
  const mark = (nodeId: string, row: string) => {
    const s = anchored.get(nodeId) ?? new Set<string>();
    s.add(row);
    anchored.set(nodeId, s);
  };
  for (const l of data.links) {
    mark(l.from, l.fromRow ?? bodyHandle);
    mark(l.to, l.toRow ?? bodyHandle);
  }

  const layout = profile.layout ?? DEFAULT_LAYOUT;
  const nodes: Node[] = [];
  let cursor = 0;
  for (const g of data.groups) {
    const own = data.nodes.filter((n) => n.groupId === g.id);
    // A stacked box is one column wide; a flow box is as wide as its longest
    // chain of arrows.
    const cols = layout.nodes === "flow" ? columns(own, data.links) : [own];
    const width = 2 * PAD + cols.length * CARD_W + (cols.length - 1) * COL_GAP;
    const height = HEAD + Math.max(...cols.map(stackHeight), 40) + PAD;
    const auto: XY =
      layout.groups === "column" ? { x: 0, y: cursor } : { x: cursor, y: 0 };
    cursor += (layout.groups === "column" ? height : width) + GROUP_GAP;

    nodes.push({
      id: g.id,
      type: "group",
      position: data.positions?.[g.id] ?? auto,
      draggable: true,
      selectable: false,
      data: { label: g.title, note: g.note },
      style: { width, height },
      className: `rf-ns${g.accent === "primary" ? " rf-ns--order" : ""}${
        g.accent === "secondary" ? " rf-ns--draft" : ""
      }`,
    });

    cols.forEach((col, i) => {
      let y = HEAD;
      for (const n of col) {
        nodes.push({
          id: n.id,
          type: "card",
          parentId: g.id,
          extent: "parent",
          position: { x: PAD + i * (CARD_W + COL_GAP), y },
          draggable: false,
          data: { node: n, profile, anchored: [...(anchored.get(n.id) ?? [])] },
          style: { width: CARD_W },
        });
        y += cardHeight(n) + CARD_GAP;
      }
    });
  }

  const edges: Edge[] = data.links.map((l) => ({
    id: l.id,
    source: l.from,
    target: l.to,
    sourceHandle: l.fromRow ? rowHandleId(l.fromRow) : bodyHandle,
    targetHandle: l.toRow ? rowHandleId(l.toRow) : `${bodyHandle}-in`,
    type: "flow",
    label: l.label,
    markerEnd: ARROW,
  }));

  return { nodes, edges };
}

export interface GraphViewProps {
  data: GraphData;
  profile: GraphProfile;
}

// GraphView renders any profile's graph read-only: pan, zoom and drag the boxes
// around, nothing else. Editing lives in the profile that owns it (today the
// policies editor); everything that only needs to SHOW a graph uses this.
export function GraphView({ data, profile }: GraphViewProps) {
  const { nodes, edges } = useMemo(() => build(data, profile), [data, profile]);
  const empty = data.nodes.length === 0;

  return (
    <div className="rf-wrap relative h-full w-full">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesConnectable={false}
          elementsSelectable={false}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>

      {empty && (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-500">
          {profile.emptyHint}
        </p>
      )}

      {profile.legend.length > 0 && (
        <div className="absolute bottom-3 right-3 flex flex-col gap-1 rounded-md border border-gray-200 bg-surface/95 px-3 py-2 text-xs text-slate-600 shadow-sm">
          {profile.legend.map((e) => (
            <div key={e.text} className="flex items-center gap-2">
              <span
                className={`rf-card__badge${
                  e.tone === "accent"
                    ? " rf-card__badge--accent"
                    : e.tone === "warn"
                      ? " rf-card__badge--warn"
                      : e.tone === "muted"
                        ? " rf-card__badge--muted"
                        : ""
                }`}
              >
                {e.tone ? "  " : "→"}
              </span>
              <span>{e.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

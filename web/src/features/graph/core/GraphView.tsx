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
import type { GraphData, GraphNode, GraphProfile, XY } from "./model";

const nodeTypes = { card: CardNode, group: GroupNode };
const edgeTypes = { flow: FlowEdge };

// Layout constants; the card width must match .rf-card in graph.css.
const GROUP_W = 250;
const GROUP_GAP = 80;
const HEAD = 40;
const CARD_X = 10;
const CARD_GAP = 10;
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

function groupHeight(nodes: GraphNode[]): number {
  const cards = nodes.reduce((sum, n) => sum + cardHeight(n) + CARD_GAP, 0);
  return HEAD + Math.max(cards, 40) + 10;
}

// build lays the groups out left to right (unless positions say otherwise) and
// stacks their cards inside, mirroring the policies editor so both canvases
// read the same.
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

  const nodes: Node[] = [];
  let x = 0;
  for (const g of data.groups) {
    const own = data.nodes.filter((n) => n.groupId === g.id);
    const pos: XY = data.positions?.[g.id] ?? { x, y: 0 };
    x += GROUP_W + GROUP_GAP;
    nodes.push({
      id: g.id,
      type: "group",
      position: pos,
      draggable: true,
      selectable: false,
      data: { label: g.title, note: g.note },
      style: { width: GROUP_W, height: groupHeight(own) },
      className: `rf-ns${g.accent === "primary" ? " rf-ns--order" : ""}${
        g.accent === "secondary" ? " rf-ns--draft" : ""
      }`,
    });
    let y = HEAD;
    for (const n of own) {
      nodes.push({
        id: n.id,
        type: "card",
        parentId: g.id,
        extent: "parent",
        position: { x: CARD_X, y },
        draggable: false,
        data: { node: n, profile, anchored: [...(anchored.get(n.id) ?? [])] },
        style: { width: CARD_W },
      });
      y += cardHeight(n) + CARD_GAP;
    }
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

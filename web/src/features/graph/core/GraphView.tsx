import {
	Background,
	applyNodeChanges,
	BackgroundVariant,
	Controls,
	type Edge,
	MarkerType,
	type Node,
	ReactFlow,
	ReactFlowProvider,
	useNodesState,
	useNodesInitialized,
	useReactFlow,
	useStore,
	type Connection,
} from "@xyflow/react";
import { useEffect, useMemo, useRef } from "react";
import "@xyflow/react/dist/style.css";
import "./graph.css";
import {
	bodyHandle,
	CardNode,
	rowHandleId,
	sourceRowHandleId,
} from "./CardNode";
import { FlowEdge } from "./FlowEdge";
import type {
	GraphData,
	GraphLink,
	GraphNode,
	GraphProfile,
	XY,
} from "./model";
import { DEFAULT_LAYOUT } from "./model";

const nodeTypes = { card: CardNode, group: GroupNode };
const edgeTypes = { flow: FlowEdge };

// Layout constants; the card width must match .rf-card in graph.css. The gaps
// are what the arrows travel through: a column gap has to fit an arrow with its
// label, so it is far wider than the padding to the box edge.
const GROUP_GAP = 140;
const HEAD = 40;
const PAD = 14; // box padding around its cards
const COL_GAP = 150; // room for readable connection labels
const CARD_GAP = 18; // between stacked cards
const CARD_W = 230;
const ROW_H = 26;

// Tighten every occupied area without changing any child's world position.
// Saved dimensions are a cache, never a lower bound for the next layout.
export function fitGroups(nodes: Node[]): Node[] {
	const result = nodes.map((node) => ({
		...node,
		position: { ...node.position },
	}));
	for (const group of result.filter((node) => node.type === "group")) {
		const children = result.filter((node) => node.parentId === group.id);
		if (!children.length) {
			group.width = 300;
			group.height = HEAD + 40 + PAD;
			group.style = {
				...group.style,
				width: group.width,
				height: group.height,
			};
			continue;
		}
		const left = Math.min(...children.map((node) => node.position.x)) - PAD;
		const top = Math.min(...children.map((node) => node.position.y)) - HEAD;
		const right =
			Math.max(
				...children.map(
					(node) => node.position.x + (node.measured?.width ?? CARD_W),
				),
			) + PAD;
		const bottom =
			Math.max(
				...children.map(
					(node) =>
						node.position.y +
						(node.measured?.height ?? cardHeight(node.data.node as GraphNode)),
				),
			) + PAD;
		group.position = { x: group.position.x + left, y: group.position.y + top };
		group.width = Math.max(300, right - left);
		group.height = bottom - top;
		group.style = { ...group.style, width: group.width, height: group.height };
		for (const child of children)
			child.position = {
				x: child.position.x - left,
				y: child.position.y - top,
			};
	}
	return result;
}

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
	return (
		nodes.reduce((sum, n) => sum + cardHeight(n), 0) +
		(nodes.length - 1) * CARD_GAP
	);
}

// columns splits a box's cards into left-to-right ranks by following the arrows
// inside that box: a card with no incoming arrow starts a column, every other
// card sits one column right of the furthest card pointing at it. Cycles cannot
// run away - each pass can only push a card one column further and there are at
// most as many passes as cards.
function columns(nodes: GraphNode[], links: GraphLink[]): GraphNode[][] {
	const own = new Set(nodes.map((n) => n.id));
	const inner = links.filter(
		(l) => own.has(l.from) && own.has(l.to) && l.from !== l.to,
	);
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
export function buildGraph(
	data: GraphData,
	profile: GraphProfile,
	editable = false,
): { nodes: Node[]; edges: Edge[] } {
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
		const width = Math.max(
			300,
			data.groupSizes?.[g.id]?.width ?? 0,
			2 * PAD + cols.length * CARD_W + (cols.length - 1) * COL_GAP,
			...own.map((n) => (data.positions?.[n.id]?.x ?? 0) + CARD_W + PAD),
		);
		const height = Math.max(
			data.groupSizes?.[g.id]?.height ?? 0,
			HEAD + Math.max(...cols.map(stackHeight), 40) + PAD,
			...own.map((n) => (data.positions?.[n.id]?.y ?? 0) + cardHeight(n) + PAD),
		);
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
					extent: editable ? undefined : "parent",
					expandParent: false,
					position: data.positions?.[n.id] ?? {
						x: PAD + i * (CARD_W + COL_GAP),
						y,
					},
					draggable: editable,
					data: {
						node: n,
						profile,
						editable,
						anchored: [...(anchored.get(n.id) ?? [])],
					},
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
		sourceHandle: l.fromRow ? sourceRowHandleId(l.fromRow) : bodyHandle,
		targetHandle: l.toRow ? rowHandleId(l.toRow) : `${bodyHandle}-in`,
		type: "flow",
		label: l.label,
		data: {
			labelOffset: (() => {
				const siblings = data.links.filter(
					(other) => other.from === l.from && other.to === l.to,
				);
				return (
					(siblings.findIndex((other) => other.id === l.id) -
						(siblings.length - 1) / 2) *
					32
				);
			})(),
		},
		markerEnd: ARROW,
	}));

	return { nodes: editable ? fitGroups(nodes) : nodes, edges };
}

export interface GraphViewProps {
	data: GraphData;
	profile: GraphProfile;
	editable?: boolean;
	selectedId?: string;
	onNodeClick?: (id: string) => void;
	onGroupClick?: (id: string) => void;
	onNodeContextMenu?: (id: string, position: XY) => void;
	onLinkClick?: (id: string) => void;
	onConnect?: (connection: Connection) => void;
	onPositions?: (
		positions: Record<string, XY>,
		sizes: NonNullable<GraphData["groupSizes"]>,
	) => void;
}

function FitCanvas({ count }: { count: number }) {
	const fitted = useRef(false);
	const { fitView } = useReactFlow();
	const ready = useNodesInitialized();
	const width = useStore((s) => s.width);
	const height = useStore((s) => s.height);
	useEffect(() => {
		if (!fitted.current && ready && width && height && count) {
			fitted.current = true;
			void fitView({ padding: 0.15 });
		}
	}, [ready, width, height, count, fitView]);
	return null;
}

// The host owns semantic edits. The shared canvas only renders and reports intent.
export function GraphView({
	data,
	profile,
	editable = false,
	selectedId,
	onNodeClick,
	onGroupClick,
	onNodeContextMenu,
	onLinkClick,
	onConnect,
	onPositions,
}: GraphViewProps) {
	const built = useMemo(
		() => buildGraph(data, profile, editable),
		[data, profile, editable],
	);
	const [nodes, setNodes] = useNodesState(built.nodes);
	const currentNodes = useRef(built.nodes);
	useEffect(() => {
		currentNodes.current = built.nodes;
		setNodes(built.nodes);
	}, [built.nodes, setNodes]);
	const empty = data.nodes.length === 0;

	return (
		<div className="rf-wrap relative h-full w-full">
			<ReactFlowProvider>
				<ReactFlow
					nodes={nodes.map((n) => ({ ...n, selected: n.id === selectedId }))}
					edges={built.edges.map((e) => ({
						...e,
						selected: e.id === selectedId,
						data: { ...e.data, onSelect: () => onLinkClick?.(e.id) },
					}))}
					nodeTypes={nodeTypes}
					edgeTypes={edgeTypes}
					nodesConnectable={editable}
					elementsSelectable={!!onNodeClick || !!onLinkClick}
					deleteKeyCode={null}
					onNodesChange={(changes) => {
						// React Flow repeats the last relative position on mouseup.
						// Our parent origin may have changed since that pointer event.
						const normalized = changes.map((change) => {
							if (
								editable &&
								change.type === "position" &&
								change.dragging === false
							) {
								const current = currentNodes.current.find(
									(node) => node.id === change.id,
								);
								if (current?.dragging)
									return { ...change, position: current.position };
							}
							return change;
						});
						const changed = applyNodeChanges(normalized, currentNodes.current);
						const next =
							editable && changes.some((change) => change.type === "position")
								? fitGroups(changed)
								: changed;
						currentNodes.current = next;
						setNodes(next);
					}}
					onNodeClick={(_, node) => {
						if (node.type === "card") onNodeClick?.(node.id);
						else onGroupClick?.(node.id);
					}}
					onNodeContextMenu={(event, node) => {
						if (node.type === "card" && onNodeContextMenu) {
							event.preventDefault();
							onNodeContextMenu(node.id, {
								x: event.clientX,
								y: event.clientY,
							});
						}
					}}
					onEdgeClick={(_, edge) => onLinkClick?.(edge.id)}
					onConnect={onConnect}
					onNodeDragStop={() => {
						// onNodesChange has already normalized the final drag position.
						// The event node may still use the parent's previous origin.
						const next = currentNodes.current;
						onPositions?.(
							Object.fromEntries(next.map((n) => [n.id, n.position])),
							Object.fromEntries(
								next
									.filter((n) => n.type === "group")
									.map((n) => [
										n.id,
										{
											width: Number(n.style?.width),
											height: Number(n.style?.height),
										},
									]),
							),
						);
					}}
					proOptions={{ hideAttribution: true }}
				>
					<FitCanvas count={data.nodes.length + data.groups.length} />
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

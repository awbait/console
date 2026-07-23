import {
  addEdge,
  Background,
  type Connection,
  ConnectionMode,
  Controls,
  type Edge,
  type FinalConnectionState,
  MarkerType,
  type Node,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import "@xyflow/react/dist/style.css";
import {
  IconInfoCircle,
  IconPencil,
  IconPlus,
  IconTarget,
  IconTrash,
  IconWand,
} from "@tabler/icons-react";
import { useToast } from "../../app/ToastContext";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Button } from "../../components/ui";
import { ContextMenu, type MenuEntry } from "./ContextMenu";
import { FlowEdge } from "./FlowEdge";
import "./policiesMap.css";
import { NamespaceDialog, WorkloadDialog } from "./TopologyDialogs";
import {
  EXAMPLE_TOPOLOGY,
  findWorkload,
  nsOfWorkload,
  type TopoNamespace,
  type TopoWorkload,
  workloadId,
  workloadInvalidReason,
} from "./topology";
import {
  bodyHandleId,
  isBodyHandle,
  portFromHandle,
  portHandleId,
  WorkloadNode,
  type WorkloadNodeData,
} from "./WorkloadNode";

const nodeTypes = { workload: WorkloadNode, nsGroup: NsGroupNode };
const edgeTypes = { flow: FlowEdge };

// Layout constants.
const GROUP_W = 250;
const GROUP_GAP = 80;
const HEAD = 40;
const WL_X = 10;
const WL_GAP = 10;
const WL_W = 230; // workload card width, must match .rf-wl in policiesMap.css

// Edge arrowhead. markerUnits defaults to strokeWidth, which doubles the
// marker on our 2px edges - pin it to absolute pixels instead.
const ARROW = {
  type: MarkerType.ArrowClosed,
  width: 20,
  height: 20,
  markerUnits: "userSpaceOnUse",
};

export type XY = { x: number; y: number };

// The graph model shared with the host page: the editable topology, the drawn
// edges and the chosen order namespace.
export interface GraphModel {
  topology: TopoNamespace[];
  edges: Edge[];
  orderNs: string | null;
}

export interface PoliciesGraphHandle {
  openAddNamespace: () => void;
  loadExample: () => void;
  // Replace the whole canvas with a new model (e.g. parsed from pasted values).
  load: (m: GraphModel & { positions?: Record<string, XY> }) => void;
}

interface PoliciesGraphProps {
  // Initial model; the graph owns the state afterwards and reports every
  // change through onModelChange. Remount (key) to reset from new values.
  initial?: GraphModel & { positions?: Record<string, XY> };
  // Order-mode: the order namespace is fixed by the order form and cannot be
  // reassigned or deleted from the canvas.
  lockedOrderNs?: string;
  // Namespaces that will produce additional draft orders (edges not touching
  // the order namespace, grouped by source): highlighted on the canvas.
  draftNs?: string[];
  readOnly?: boolean;
  // Known namespace names from the topology provider (for the add dialog).
  suggestions?: string[];
  onModelChange?: (m: GraphModel) => void;
}

// Estimated workload card height: header (shorter when the SA row is hidden,
// i.e. an egress gateway without SA) + port rows (or the empty-ports note).
function workloadHeight(w: TopoWorkload): number {
  const head = w.serviceAccount !== null || w.kind !== "EgressGateway" ? 50 : 34;
  return head + (w.ports.length > 0 ? w.ports.length * 26 : 33);
}

function groupHeight(ns: TopoNamespace): number {
  const cards = ns.workloads.reduce((sum, w) => sum + workloadHeight(w) + WL_GAP, 0);
  return HEAD + Math.max(cards, 40) + 10;
}

// groupClass builds the namespace box class list: base + order/draft accents +
// drop-target highlight.
function groupClass(isOrder: boolean, isDraft: boolean, isDrop = false): string {
  return `rf-ns${isOrder ? " rf-ns--order" : ""}${isDraft ? " rf-ns--draft" : ""}${
    isDrop ? " rf-ns--drop" : ""
  }`;
}

// buildNodes lays the namespaces out as draggable group boxes with their
// workloads stacked inside. Positions are remembered per namespace so edits do
// not reshuffle what the user arranged.
function buildNodes(
  topology: TopoNamespace[],
  positions: Record<string, XY>,
  orderNs: string | null,
  draftSet: Set<string>,
  readOnly: boolean,
): Node[] {
  const nodes: Node[] = [];
  for (const ns of topology) {
    const pos = positions[ns.name] ?? { x: 0, y: 0 };
    nodes.push({
      id: `group:${ns.name}`,
      type: "nsGroup",
      position: pos,
      data: { label: ns.name, isOrder: ns.name === orderNs, isDraft: draftSet.has(ns.name) },
      draggable: !readOnly,
      selectable: false,
      // Keyboard-deleting RF nodes would desync them from the topology model:
      // deletion goes through the context menus instead.
      deletable: false,
      style: { width: GROUP_W, height: groupHeight(ns) },
      className: groupClass(ns.name === orderNs, draftSet.has(ns.name)),
    });
    let y = HEAD;
    for (const w of ns.workloads) {
      const data: WorkloadNodeData = { workload: w, invalidReason: workloadInvalidReason(w) };
      nodes.push({
        id: w.id,
        type: "workload",
        parentId: `group:${ns.name}`,
        // No extent: "parent" - a card may be dragged OUT of its box to move
        // the workload into another namespace (it snaps back otherwise).
        position: { x: WL_X, y },
        data,
        draggable: !readOnly,
        // selectable keeps pointer events on the card: React Flow disables
        // them entirely on nodes that are neither draggable nor selectable,
        // which would swallow right-clicks (the ns menu opened instead).
        selectable: true,
        deletable: false,
        connectable: !readOnly,
      });
      y += workloadHeight(w) + WL_GAP;
    }
  }
  return nodes;
}

function NsGroupNode({ data }: { data: { label: string; isOrder?: boolean; isDraft?: boolean } }) {
  return (
    <div className="rf-ns__title">
      <span className="rf-ns__name">{data.label}</span>
      {data.isOrder && <span className="rf-ns__order">заказ</span>}
      {data.isDraft && <span className="rf-ns__order rf-ns__order--draft">черновик</span>}
    </div>
  );
}

interface MenuState {
  x: number;
  y: number;
  kind: "pane" | "ns" | "workload" | "edge";
  id: string;
}

const Canvas = forwardRef<PoliciesGraphHandle, PoliciesGraphProps>(function Canvas(
  { initial, lockedOrderNs, draftNs, readOnly = false, suggestions = [], onModelChange },
  ref,
) {
  // Stable key so effects depending on the draft set do not retrigger on every
  // parent render with an equal array.
  const draftKey = (draftNs ?? []).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by content, not array identity
  const draftSet = useMemo(() => new Set(draftKey ? draftKey.split(",") : []), [draftKey]);
  const toast = useToast();
  const { screenToFlowPosition } = useReactFlow();

  const [topology, setTopology] = useState<TopoNamespace[]>(initial?.topology ?? []);
  const [positions, setPositions] = useState<Record<string, XY>>(initial?.positions ?? {});
  const [orderNsState, setOrderNsState] = useState<string | null>(initial?.orderNs ?? null);
  const orderNs = lockedOrderNs ?? orderNsState;

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial?.edges ?? []);

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [nsDialog, setNsDialog] = useState<{ pos?: XY } | null>(null);
  const [wlDialog, setWlDialog] = useState<{ ns: string; workload: TopoWorkload | null } | null>(
    null,
  );
  const [nsToDelete, setNsToDelete] = useState<string | null>(null);

  // Report every model change to the host page. The callback lives in a ref so
  // its identity does not retrigger the effect.
  const modelCb = useRef(onModelChange);
  modelCb.current = onModelChange;
  useEffect(() => {
    modelCb.current?.({ topology, edges, orderNs });
  }, [topology, edges, orderNs]);

  // Rebuild nodes from the topology model; prune edges whose endpoint workload
  // or port no longer exists.
  useEffect(() => {
    setNodes(buildNodes(topology, positions, orderNs, draftSet, readOnly));
    setEdges((eds) =>
      eds.filter((e) => {
        const s = findWorkload(topology, e.source);
        const t = findWorkload(topology, e.target);
        const sp = portFromHandle(e.sourceHandle);
        const tp = portFromHandle(e.targetHandle);
        // The source may anchor at the body handle (parsed edges whose source
        // port is unknown); the target is always a concrete port.
        const sourceOk =
          sp !== null ? s?.ports.some((p) => p.port === sp) : isBodyHandle(e.sourceHandle);
        return (
          !!s &&
          !!t &&
          !!sourceOk &&
          tp !== null &&
          t.ports.some((p) => p.port === tp) &&
          // A workload moved into the peer namespace turns the edge same-ns.
          nsOfWorkload(e.source) !== nsOfWorkload(e.target)
        );
      }),
    );
  }, [topology, positions, orderNs, draftSet, readOnly, setNodes, setEdges]);

  // --- topology mutations -------------------------------------------------

  const nextFreePosition = useCallback((): XY => {
    const xs = Object.values(positions);
    if (xs.length === 0) return { x: 0, y: 0 };
    return { x: Math.max(...xs.map((p) => p.x)) + GROUP_W + GROUP_GAP, y: 0 };
  }, [positions]);

  const addNamespace = useCallback(
    (name: string, pos?: XY) => {
      setTopology((t) => [...t, { name, workloads: [] }]);
      setPositions((p) => ({ ...p, [name]: pos ?? nextFreePosition() }));
      if (!lockedOrderNs) setOrderNsState((prev) => prev ?? name);
    },
    [nextFreePosition, lockedOrderNs],
  );

  const removeNamespace = useCallback(
    (name: string) => {
      setTopology((t) => t.filter((ns) => ns.name !== name));
      setPositions(({ [name]: _, ...rest }) => rest);
      if (!lockedOrderNs) setOrderNsState((prev) => (prev === name ? null : prev));
    },
    [lockedOrderNs],
  );

  const saveWorkload = useCallback(
    (ns: string, prevId: string | null, w: TopoWorkload) => {
      setTopology((t) =>
        t.map((n) => {
          if (n.name !== ns) return n;
          const workloads = prevId
            ? n.workloads.map((x) => (x.id === prevId ? w : x))
            : [...n.workloads, w];
          return { ...n, workloads };
        }),
      );
      // A rename changes the node id: re-point existing edges at the new id
      // (ports that disappeared are pruned by the topology effect).
      if (prevId && prevId !== w.id) {
        setEdges((eds) =>
          eds.map((e) => ({
            ...e,
            source: e.source === prevId ? w.id : e.source,
            target: e.target === prevId ? w.id : e.target,
          })),
        );
      }
    },
    [setEdges],
  );

  const removeWorkload = useCallback((id: string) => {
    setTopology((t) => t.map((n) => ({ ...n, workloads: n.workloads.filter((w) => w.id !== id) })));
  }, []);

  // moveWorkload relocates a workload into another namespace (drag-and-drop),
  // re-pointing its edges at the new id. Returns false when the move is not
  // possible (name already taken there).
  const moveWorkload = useCallback(
    (id: string, targetNs: string): boolean => {
      const w = findWorkload(topology, id);
      const target = topology.find((n) => n.name === targetNs);
      if (!w || !target) return false;
      if (target.workloads.some((x) => x.name === w.name)) {
        toast.error(`В namespace ${targetNs} уже есть workload «${w.name}».`);
        return false;
      }
      const moved = { ...w, id: workloadId(targetNs, w.name) };
      const fromNs = nsOfWorkload(id);
      setTopology((t) =>
        t.map((n) => {
          if (n.name === fromNs) return { ...n, workloads: n.workloads.filter((x) => x.id !== id) };
          if (n.name === targetNs) return { ...n, workloads: [...n.workloads, moved] };
          return n;
        }),
      );
      setEdges((eds) =>
        eds.map((e) => ({
          ...e,
          source: e.source === id ? moved.id : e.source,
          target: e.target === id ? moved.id : e.target,
        })),
      );
      return true;
    },
    [topology, toast, setEdges],
  );

  const loadExample = useCallback(() => {
    setTopology(EXAMPLE_TOPOLOGY);
    setPositions({
      "netbox-ingress": { x: 0, y: 0 },
      "netbox-core": { x: GROUP_W + GROUP_GAP, y: 0 },
      "netbox-postgresql": { x: (GROUP_W + GROUP_GAP) * 2, y: 0 },
      "netbox-valkey": { x: (GROUP_W + GROUP_GAP) * 2, y: 180 },
    });
    setEdges([]);
    if (!lockedOrderNs) setOrderNsState("netbox-core");
  }, [setEdges, lockedOrderNs]);

  const load = useCallback(
    (m: GraphModel & { positions?: Record<string, XY> }) => {
      setTopology(m.topology);
      setPositions(m.positions ?? {});
      setEdges(m.edges);
      if (!lockedOrderNs) setOrderNsState(m.orderNs);
    },
    [setEdges, lockedOrderNs],
  );

  useImperativeHandle(
    ref,
    () => ({ openAddNamespace: () => setNsDialog({}), loadExample, load }),
    [loadExample, load],
  );

  // --- connection rules ---------------------------------------------------

  // connectionReason returns why a (source -> target) link is rejected, or null
  // if it is allowed. Shared by isValidConnection (live feedback) and the
  // dropped-on-invalid-target error toast.
  const connectionReason = useCallback(
    (source: string, target: string): string | null => {
      if (source === target) return "Нельзя соединить workload сам с собой.";
      if (nsOfWorkload(source) === nsOfWorkload(target))
        return "Стрелки проводятся только между разными namespace.";
      const from = findWorkload(topology, source);
      const to = findWorkload(topology, target);
      if (!from || !to) return "Неизвестный workload.";
      const fromBad = workloadInvalidReason(from);
      if (fromBad) return `Источник ${from.name}: ${fromBad}.`;
      const toBad = workloadInvalidReason(to);
      if (toBad) return `Получатель ${to.name}: ${toBad}.`;
      return null;
    },
    [topology],
  );

  const isValidConnection = useCallback(
    (c: Connection | Edge) => connectionReason(c.source, c.target) === null,
    [connectionReason],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (readOnly) return;
      const sp = portFromHandle(c.sourceHandle);
      const tp = portFromHandle(c.targetHandle);
      // The reverse arrow between the same port pair already exists: instead of
      // a second overlapping line, the existing edge becomes bidirectional.
      const reverse = edges.find(
        (e) =>
          e.source === c.target &&
          e.target === c.source &&
          portFromHandle(e.sourceHandle) === tp &&
          portFromHandle(e.targetHandle) === sp,
      );
      if (reverse) {
        if (reverse.data?.bidirectional !== true) {
          setEdges((eds) =>
            eds.map((e) =>
              e.id === reverse.id ? { ...e, data: { ...e.data, bidirectional: true } } : e,
            ),
          );
          toast.success("Связь стала двусторонней.");
        }
        return;
      }
      // Exact duplicate of an existing arrow: nothing to add.
      const dup = edges.some(
        (e) =>
          e.source === c.source &&
          e.target === c.target &&
          portFromHandle(e.sourceHandle) === sp &&
          portFromHandle(e.targetHandle) === tp,
      );
      if (dup) return;
      setEdges((eds) => addEdge({ ...c, animated: true, reconnectable: true }, eds));
    },
    [readOnly, edges, setEdges, toast],
  );

  // Dropped a new connection onto an invalid target: explain why. Dropped on
  // empty canvas (toNode null): the arrow just disappears.
  const onConnectEnd = useCallback(
    (_e: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid) return;
      const fromId = state.fromNode?.id;
      const toId = state.toNode?.id;
      if (!fromId || !toId) return;
      const reason = connectionReason(fromId, toId);
      if (reason) toast.error(reason);
    },
    [connectionReason, toast],
  );

  // Reconnect: dragging an arrow end onto another port moves it (direction is
  // preserved by reconnectEdge); dropping it off a port deletes the arrow.
  const reconnectOk = useRef(false);
  const onReconnectStart = useCallback(() => {
    reconnectOk.current = false;
  }, []);
  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      if (readOnly) return;
      if (connectionReason(newConnection.source, newConnection.target) !== null) return;
      reconnectOk.current = true;
      setEdges((els) => reconnectEdge(oldEdge, newConnection, els));
    },
    [readOnly, connectionReason, setEdges],
  );
  const onReconnectEnd = useCallback(
    (_e: MouseEvent | TouchEvent, edge: Edge) => {
      if (readOnly) return;
      if (!reconnectOk.current) setEdges((els) => els.filter((e) => e.id !== edge.id));
    },
    [readOnly, setEdges],
  );

  // --- drag and context menus ---------------------------------------------

  // While a workload card is dragged, highlight the namespace box it would
  // land in (droppable feedback).
  const dragHover = useRef<string | null>(null);
  const onNodeDrag = useCallback(
    (_e: MouseEvent | TouchEvent | React.MouseEvent, node: Node) => {
      if (node.type !== "workload") return;
      const fromNs = nsOfWorkload(node.id);
      const groupPos = positions[fromNs] ?? { x: 0, y: 0 };
      const cx = groupPos.x + node.position.x + WL_W / 2;
      const cy = groupPos.y + node.position.y + 20;
      const target = topology.find((ns) => {
        const p = positions[ns.name] ?? { x: 0, y: 0 };
        return cx >= p.x && cx <= p.x + GROUP_W && cy >= p.y && cy <= p.y + groupHeight(ns);
      });
      const hover = target && target.name !== fromNs ? target.name : null;
      if (hover === dragHover.current) return;
      dragHover.current = hover;
      setNodes((nds) =>
        nds.map((n) =>
          n.type === "nsGroup"
            ? {
                ...n,
                className: groupClass(
                  n.id === `group:${orderNs}`,
                  draftSet.has(n.id.slice("group:".length)),
                  n.id === `group:${hover}`,
                ),
              }
            : n,
        ),
      );
    },
    [topology, positions, orderNs, draftSet, setNodes],
  );

  const onNodeDragStop = useCallback(
    (_e: MouseEvent | TouchEvent | React.MouseEvent, node: Node) => {
      dragHover.current = null;
      if (node.type === "nsGroup") {
        setPositions((p) => ({ ...p, [node.id.slice("group:".length)]: node.position }));
        return;
      }
      if (node.type !== "workload") return;
      // A dragged card either lands inside another namespace box (the workload
      // moves there) or snaps back into its stacked slot.
      const fromNs = nsOfWorkload(node.id);
      const groupPos = positions[fromNs] ?? { x: 0, y: 0 };
      const cx = groupPos.x + node.position.x + WL_W / 2;
      const cy = groupPos.y + node.position.y + 20;
      const target = topology.find((ns) => {
        const p = positions[ns.name] ?? { x: 0, y: 0 };
        return cx >= p.x && cx <= p.x + GROUP_W && cy >= p.y && cy <= p.y + groupHeight(ns);
      });
      if (!target || target.name === fromNs || !moveWorkload(node.id, target.name)) {
        setNodes(buildNodes(topology, positions, orderNs, draftSet, readOnly));
      }
    },
    [topology, positions, orderNs, draftSet, readOnly, moveWorkload, setNodes],
  );

  const onPaneContextMenu = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      e.preventDefault();
      if (readOnly) return;
      setMenu({ x: e.clientX, y: e.clientY, kind: "pane", id: "" });
    },
    [readOnly],
  );

  const onNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: Node) => {
      e.preventDefault();
      if (readOnly) return;
      if (node.type === "nsGroup") {
        setMenu({ x: e.clientX, y: e.clientY, kind: "ns", id: node.id.slice("group:".length) });
      } else {
        setMenu({ x: e.clientX, y: e.clientY, kind: "workload", id: node.id });
      }
    },
    [readOnly],
  );

  const onEdgeContextMenu = useCallback(
    (e: React.MouseEvent, edge: Edge) => {
      e.preventDefault();
      if (readOnly) return;
      setMenu({ x: e.clientX, y: e.clientY, kind: "edge", id: edge.id });
    },
    [readOnly],
  );

  // Double-click on a workload card is a shortcut for "edit".
  const onNodeDoubleClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      if (readOnly) return;
      if (node.type !== "workload") return;
      const w = findWorkload(topology, node.id);
      if (w) setWlDialog({ ns: nsOfWorkload(node.id), workload: w });
    },
    [readOnly, topology],
  );

  const menuEntries = useMemo((): MenuEntry[] => {
    if (!menu) return [];
    switch (menu.kind) {
      case "pane":
        return [
          {
            label: "Добавить namespace",
            icon: <IconPlus size={16} />,
            onAction: () => setNsDialog({ pos: screenToFlowPosition({ x: menu.x, y: menu.y }) }),
          },
        ];
      case "ns":
        return [
          {
            label: "Добавить workload",
            icon: <IconPlus size={16} />,
            onAction: () => setWlDialog({ ns: menu.id, workload: null }),
          },
          ...(menu.id !== orderNs && !lockedOrderNs
            ? [
                {
                  label: "Namespace заказа",
                  icon: <IconTarget size={16} />,
                  onAction: () => setOrderNsState(menu.id),
                },
              ]
            : []),
          // The locked order namespace comes from the order itself and cannot
          // be removed from the canvas.
          ...(menu.id !== lockedOrderNs
            ? [
                {
                  label: "Удалить namespace",
                  icon: <IconTrash size={16} />,
                  danger: true,
                  onAction: () => {
                    const ns = topology.find((n) => n.name === menu.id);
                    if (ns && ns.workloads.length > 0) setNsToDelete(menu.id);
                    else removeNamespace(menu.id);
                  },
                },
              ]
            : []),
        ];
      case "workload": {
        const w = findWorkload(topology, menu.id);
        return [
          {
            label: "Изменить",
            icon: <IconPencil size={16} />,
            onAction: () => setWlDialog({ ns: nsOfWorkload(menu.id), workload: w ?? null }),
          },
          {
            label: "Удалить workload",
            icon: <IconTrash size={16} />,
            danger: true,
            onAction: () => removeWorkload(menu.id),
          },
        ];
      }
      case "edge":
        return [
          {
            label: "Удалить стрелку",
            icon: <IconTrash size={16} />,
            danger: true,
            onAction: () => setEdges((eds) => eds.filter((e) => e.id !== menu.id)),
          },
        ];
    }
  }, [
    menu,
    topology,
    orderNs,
    lockedOrderNs,
    removeNamespace,
    removeWorkload,
    screenToFlowPosition,
    setEdges,
  ]);

  const menuTitle = useMemo(() => {
    if (!menu) return undefined;
    if (menu.kind === "ns") return `namespace: ${menu.id}`;
    if (menu.kind === "workload") return findWorkload(topology, menu.id)?.name;
    return undefined;
  }, [menu, topology]);

  // --- edge presentation ---------------------------------------------------

  // Absolute x-centers of workload cards (group position + relative offset),
  // used to pick which side a bidirectional edge attaches to.
  const centerX = useMemo(() => {
    const groups = new Map<string, number>();
    for (const n of nodes) if (n.type === "nsGroup") groups.set(n.id, n.position.x);
    const m = new Map<string, number>();
    for (const n of nodes) {
      if (n.type !== "workload" || !n.parentId) continue;
      m.set(n.id, (groups.get(n.parentId) ?? 0) + n.position.x + WL_W / 2);
    }
    return m;
  }, [nodes]);

  // Display edges follow the convention "in on the left, out on the right":
  // the source anchors at its right port circle, the target at its left one. A
  // bidirectional link is drawn as a single double-headed edge whose ends face
  // each other based on the current card positions.
  const displayEdges = useMemo(
    () =>
      edges.map((e) => {
        const sp = portFromHandle(e.sourceHandle);
        const tp = portFromHandle(e.targetHandle);
        const sourceIsBody = sp === null && isBodyHandle(e.sourceHandle);
        if ((sp === null && !sourceIsBody) || tp === null) return e;
        const bidi = e.data?.bidirectional === true;
        let sSide: "l" | "r" = "r";
        let tSide: "l" | "r" = "l";
        if (bidi) {
          const facing = (centerX.get(e.source) ?? 0) <= (centerX.get(e.target) ?? 0);
          sSide = facing ? "r" : "l";
          tSide = facing ? "l" : "r";
        }
        return {
          ...e,
          // FlowEdge animates traffic with travelling dots: one forward dot,
          // plus a counter-moving one in another color for two-way links.
          type: "flow",
          sourceHandle: sourceIsBody ? bodyHandleId(sSide) : portHandleId(sp as number, sSide),
          targetHandle: portHandleId(tp, tSide),
          animated: false,
          style: { strokeWidth: 2 },
          markerEnd: ARROW,
          markerStart: bidi ? { ...ARROW, orient: "auto-start-reverse" } : undefined,
        };
      }),
    [edges, centerX],
  );

  // Port circles are hidden until used: mark the handles that carry an edge so
  // WorkloadNode renders their circles (the rest appear on row hover only).
  useEffect(() => {
    const used = new Map<string, Set<string>>();
    const mark = (node: string, handle: string | null | undefined) => {
      if (!handle) return;
      const set = used.get(node) ?? new Set<string>();
      set.add(handle);
      used.set(node, set);
    };
    for (const e of displayEdges) {
      mark(e.source, e.sourceHandle);
      mark(e.target, e.targetHandle);
    }
    setNodes((nds) => {
      let changed = false;
      const next = nds.map((n) => {
        if (n.type !== "workload") return n;
        const want = [...(used.get(n.id) ?? [])].sort();
        const have = (n.data as WorkloadNodeData).connectedHandles ?? [];
        if (want.join(",") === have.join(",")) return n;
        changed = true;
        return { ...n, data: { ...n.data, connectedHandles: want } };
      });
      // Same reference when nothing changed, so this effect cannot loop
      // through the nodes -> displayEdges -> nodes dependency chain.
      return changed ? next : nds;
    });
  }, [displayEdges, setNodes]);

  const wlDialogNs = wlDialog ? (topology.find((n) => n.name === wlDialog.ns) ?? null) : null;

  return (
    <div className="rf-wrap relative min-w-0 flex-1">
      <ReactFlow
        nodes={nodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        // Ports are all source handles; loose mode lets any port connect to
        // any other (strict mode only links source -> target).
        connectionMode={ConnectionMode.Loose}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onReconnectStart={onReconnectStart}
        onReconnect={onReconnect}
        onReconnectEnd={onReconnectEnd}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onNodeDragStart={() => setMenu(null)}
        onMoveStart={() => setMenu(null)}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onNodeDoubleClick={onNodeDoubleClick}
        onEdgeContextMenu={onEdgeContextMenu}
        deleteKeyCode={readOnly ? null : ["Delete", "Backspace"]}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
        {/* Shifted right so the chip clears the zoom controls. */}
        <Panel position="bottom-left" style={{ marginLeft: 56 }}>
          <Legend readOnly={readOnly} />
        </Panel>
      </ReactFlow>

      {topology.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="pointer-events-auto flex flex-col items-center gap-3 rounded-lg border border-gray-200 bg-surface/95 px-6 py-5 text-center shadow-sm">
            {readOnly ? (
              <p className="text-sm text-slate-600">Топология пуста.</p>
            ) : (
              <>
                <p className="text-sm text-slate-600">
                  Холст пуст. Добавьте namespace кнопкой сверху
                  <br />
                  или правым кликом по холсту.
                </p>
                <div className="flex gap-2">
                  <Button variant="primary" onPress={() => setNsDialog({})}>
                    <IconPlus size={16} /> Namespace
                  </Button>
                  <Button onPress={loadExample}>
                    <IconWand size={16} /> Загрузить пример
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title={menuTitle}
          entries={menuEntries}
          onClose={() => setMenu(null)}
        />
      )}

      <NamespaceDialog
        isOpen={nsDialog !== null}
        onOpenChange={(open) => !open && setNsDialog(null)}
        existing={topology.map((n) => n.name)}
        suggestions={suggestions}
        onAdd={(name) => addNamespace(name, nsDialog?.pos)}
      />

      <WorkloadDialog
        isOpen={wlDialog !== null}
        onOpenChange={(open) => !open && setWlDialog(null)}
        namespace={wlDialogNs}
        workload={wlDialog?.workload ?? null}
        onSave={saveWorkload}
      />

      <ConfirmDialog
        isOpen={nsToDelete !== null}
        onOpenChange={(open) => !open && setNsToDelete(null)}
        title="Удалить namespace?"
        message={`Namespace «${nsToDelete}» будет удалён вместе с workloads и их стрелками.`}
        confirmLabel="Удалить"
        danger
        onConfirm={() => {
          if (nsToDelete) removeNamespace(nsToDelete);
        }}
      />
    </div>
  );
});

// Legend explains the canvas notation; extend it together with new highlights.
// Collapsed to a small chip, the full card slides in on hover or focus.
function Legend({ readOnly }: { readOnly: boolean }) {
  return (
    <div className="group relative">
      <button
        type="button"
        aria-label="Показать легенду"
        className="flex cursor-help items-center gap-1.5 rounded-md border border-gray-200 bg-surface/95 px-2.5 py-1.5 text-[11px] font-medium text-slate-500 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <IconInfoCircle size={14} /> Легенда
      </button>
      <div className="pointer-events-none absolute bottom-full left-0 mb-2 w-max max-w-96 rounded-md border border-gray-200 bg-surface/95 px-3 py-2 text-[11px] leading-5 text-slate-600 opacity-0 shadow-md transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
        <LegendRow sample={<span className="h-3.5 w-5 rounded border border-dashed border-slate-400" />}>
          namespace{readOnly ? "" : " (перетаскивается)"}
        </LegendRow>
        <LegendRow sample={<span className="h-3.5 w-5 rounded border border-blue-500 bg-blue-50" />}>
          namespace заказа: основной заказ policies ставится сюда
        </LegendRow>
        <LegendRow sample={<span className="h-3.5 w-5 rounded border border-amber-500 bg-amber-50" />}>
          namespace с дополнительным заказом (уйдёт в черновик)
        </LegendRow>
        <LegendRow sample={<span className="h-3.5 w-5 rounded border border-slate-300 bg-surface shadow-sm" />}>
          workload: тип указан на карточке
          {readOnly ? "" : "; перетащите в другой namespace, чтобы перенести"}
        </LegendRow>
        <LegendRow sample={<span className="h-3 w-3 rounded-full border-2 border-sky-500 bg-surface" />}>
          exposed-порт{readOnly ? "" : ": появляется при наведении на строку порта"}
        </LegendRow>
        <LegendRow sample={<span className="h-3.5 w-5 rounded border border-red-500 bg-surface" />}>
          невалидный workload (нет SA или портов)
        </LegendRow>
        <LegendRow
          sample={
            <svg
              viewBox="0 0 20 6"
              className="h-2 w-5 text-slate-500"
              role="img"
              aria-label="Стрелка с бегущей точкой"
            >
              <line x1="0" y1="3" x2="20" y2="3" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="10" cy="3" r="2.2" className="fill-sky-500" />
            </svg>
          }
        >
          разрешённый трафик source -&gt; target
        </LegendRow>
        <LegendRow
          sample={
            <svg
              viewBox="0 0 24 8"
              className="h-2.5 w-6 text-slate-500"
              role="img"
              aria-label="Двойная стрелка"
            >
              <path d="M5 4 L19 4" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 1 L4 4 L8 7" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <path d="M16 1 L20 4 L16 7" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="10" cy="4" r="2" className="fill-sky-500" />
              <circle cx="14" cy="4" r="2" className="fill-emerald-500" />
            </svg>
          }
        >
          трафик в обе стороны: синяя точка - туда, зелёная - обратно
        </LegendRow>
        {!readOnly && (
          <div className="mt-1 pl-8 text-slate-400">ПКМ - добавить или изменить элементы.</div>
        )}
      </div>
    </div>
  );
}

// LegendRow keeps every sample in a fixed-width column so the texts align.
function LegendRow({ sample, children }: { sample: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex w-6 shrink-0 items-center justify-center">{sample}</span>
      <span>{children}</span>
    </div>
  );
}

// PoliciesGraph is the reusable network-map editor: the sandbox page hosts it
// full-screen, the order form embeds it as the "graph" values editor.
export const PoliciesGraph = forwardRef<PoliciesGraphHandle, PoliciesGraphProps>(
  function PoliciesGraph(props, ref) {
    return (
      <ReactFlowProvider>
        <Canvas {...props} ref={ref} />
      </ReactFlowProvider>
    );
  },
);

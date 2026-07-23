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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@xyflow/react/dist/style.css";
import {
  IconArrowLeft,
  IconCopy,
  IconInfoCircle,
  IconPencil,
  IconPlus,
  IconTrash,
  IconWand,
} from "@tabler/icons-react";
import yaml from "js-yaml";
import { Link } from "react-router-dom";
import { useToast } from "../app/ToastContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Button, TextField } from "../components/ui";
import { ContextMenu, type MenuEntry } from "./policiesMap/ContextMenu";
import { FlowEdge } from "./policiesMap/FlowEdge";
import "./policiesMap/policiesMap.css";
import { NamespaceDialog, WorkloadDialog } from "./policiesMap/TopologyDialogs";
import {
  EXAMPLE_TOPOLOGY,
  findWorkload,
  manualProvider,
  nsOfWorkload,
  type TopoNamespace,
  type TopoWorkload,
  workloadInvalidReason,
} from "./policiesMap/topology";
import {
  buildValues,
  DEFAULT_NAMING,
  type NamingTags,
  validateSubmit,
} from "./policiesMap/valuesBuilder";
import {
  portFromHandle,
  portHandleId,
  WorkloadNode,
  type WorkloadNodeData,
} from "./policiesMap/WorkloadNode";

const nodeTypes = { workload: WorkloadNode, nsGroup: NsGroupNode };
const edgeTypes = { flow: FlowEdge };

// The pluggable topology source. Manual mode suggests nothing; later tiers
// (orders data, collector snapshot) return deployed namespaces here.
const provider = manualProvider;

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

type XY = { x: number; y: number };

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

// buildNodes lays the namespaces out as draggable group boxes with their
// workloads stacked inside. Positions are remembered per namespace so edits do
// not reshuffle what the user arranged.
function buildNodes(topology: TopoNamespace[], positions: Record<string, XY>): Node[] {
  const nodes: Node[] = [];
  for (const ns of topology) {
    const pos = positions[ns.name] ?? { x: 0, y: 0 };
    nodes.push({
      id: `group:${ns.name}`,
      type: "nsGroup",
      position: pos,
      data: { label: ns.name },
      draggable: true,
      selectable: false,
      // Keyboard-deleting RF nodes would desync them from the topology model:
      // deletion goes through the context menus instead.
      deletable: false,
      style: { width: GROUP_W, height: groupHeight(ns) },
      className: "rf-ns",
    });
    let y = HEAD;
    for (const w of ns.workloads) {
      const data: WorkloadNodeData = { workload: w, invalidReason: workloadInvalidReason(w) };
      nodes.push({
        id: w.id,
        type: "workload",
        parentId: `group:${ns.name}`,
        extent: "parent",
        position: { x: WL_X, y },
        data,
        draggable: false,
        // selectable keeps pointer events on the card: React Flow disables
        // them entirely on nodes that are neither draggable nor selectable,
        // which would swallow right-clicks (the ns menu opened instead).
        selectable: true,
        deletable: false,
        connectable: true,
      });
      y += workloadHeight(w) + WL_GAP;
    }
  }
  return nodes;
}

function NsGroupNode({ data }: { data: { label: string } }) {
  return <div className="rf-ns__title">{data.label}</div>;
}

interface MenuState {
  x: number;
  y: number;
  kind: "pane" | "ns" | "workload" | "edge";
  id: string;
}

function Canvas() {
  const toast = useToast();
  const { screenToFlowPosition } = useReactFlow();

  const [topology, setTopology] = useState<TopoNamespace[]>([]);
  const [positions, setPositions] = useState<Record<string, XY>>({});
  const [naming, setNaming] = useState<NamingTags>(DEFAULT_NAMING);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [nsDialog, setNsDialog] = useState<{ pos?: XY } | null>(null);
  const [wlDialog, setWlDialog] = useState<{ ns: string; workload: TopoWorkload | null } | null>(null);
  const [nsToDelete, setNsToDelete] = useState<string | null>(null);

  useEffect(() => {
    provider.suggestNamespaces().then(setSuggestions).catch(() => setSuggestions([]));
  }, []);

  // Rebuild nodes from the topology model; prune edges whose endpoint workload
  // or port no longer exists.
  useEffect(() => {
    setNodes(buildNodes(topology, positions));
    setEdges((eds) =>
      eds.filter((e) => {
        const s = findWorkload(topology, e.source);
        const t = findWorkload(topology, e.target);
        const sp = portFromHandle(e.sourceHandle);
        const tp = portFromHandle(e.targetHandle);
        return (
          !!s &&
          !!t &&
          sp !== null &&
          tp !== null &&
          s.ports.some((p) => p.port === sp) &&
          t.ports.some((p) => p.port === tp)
        );
      }),
    );
  }, [topology, positions, setNodes, setEdges]);

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
    },
    [nextFreePosition],
  );

  const removeNamespace = useCallback((name: string) => {
    setTopology((t) => t.filter((ns) => ns.name !== name));
    setPositions(({ [name]: _, ...rest }) => rest);
  }, []);

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
    setTopology((t) =>
      t.map((n) => ({ ...n, workloads: n.workloads.filter((w) => w.id !== id) })),
    );
  }, []);

  const loadExample = useCallback(() => {
    setTopology(EXAMPLE_TOPOLOGY);
    setPositions({
      "netbox-ingress": { x: 0, y: 0 },
      "netbox-core": { x: GROUP_W + GROUP_GAP, y: 0 },
      "netbox-postgresql": { x: (GROUP_W + GROUP_GAP) * 2, y: 0 },
      "netbox-valkey": { x: (GROUP_W + GROUP_GAP) * 2, y: 180 },
    });
    setEdges([]);
  }, [setEdges]);

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
    [edges, setEdges, toast],
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
      if (connectionReason(newConnection.source, newConnection.target) !== null) return;
      reconnectOk.current = true;
      setEdges((els) => reconnectEdge(oldEdge, newConnection, els));
    },
    [connectionReason, setEdges],
  );
  const onReconnectEnd = useCallback(
    (_e: MouseEvent | TouchEvent, edge: Edge) => {
      if (!reconnectOk.current) setEdges((els) => els.filter((e) => e.id !== edge.id));
    },
    [setEdges],
  );

  // --- drag and context menus ---------------------------------------------

  const onNodeDragStop = useCallback((_e: MouseEvent | TouchEvent | React.MouseEvent, node: Node) => {
    if (node.type === "nsGroup") {
      setPositions((p) => ({ ...p, [node.id.slice("group:".length)]: node.position }));
    }
  }, []);

  const onPaneContextMenu = useCallback((e: MouseEvent | React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, kind: "pane", id: "" });
  }, []);

  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    if (node.type === "nsGroup") {
      setMenu({ x: e.clientX, y: e.clientY, kind: "ns", id: node.id.slice("group:".length) });
    } else {
      setMenu({ x: e.clientX, y: e.clientY, kind: "workload", id: node.id });
    }
  }, []);

  const onEdgeContextMenu = useCallback((e: React.MouseEvent, edge: Edge) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, kind: "edge", id: edge.id });
  }, []);

  // Double-click on a workload card is a shortcut for "edit".
  const onNodeDoubleClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      if (node.type !== "workload") return;
      const w = findWorkload(topology, node.id);
      if (w) setWlDialog({ ns: nsOfWorkload(node.id), workload: w });
    },
    [topology],
  );

  const menuEntries = useMemo((): MenuEntry[] => {
    if (!menu) return [];
    switch (menu.kind) {
      case "pane":
        return [
          {
            label: "Добавить namespace",
            icon: <IconPlus size={16} />,
            onAction: () =>
              setNsDialog({ pos: screenToFlowPosition({ x: menu.x, y: menu.y }) }),
          },
        ];
      case "ns":
        return [
          {
            label: "Добавить workload",
            icon: <IconPlus size={16} />,
            onAction: () => setWlDialog({ ns: menu.id, workload: null }),
          },
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
        ];
      case "workload": {
        const w = findWorkload(topology, menu.id);
        return [
          {
            label: "Изменить",
            icon: <IconPencil size={16} />,
            onAction: () =>
              setWlDialog({ ns: nsOfWorkload(menu.id), workload: w ?? null }),
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
  }, [menu, topology, removeNamespace, removeWorkload, screenToFlowPosition, setEdges]);

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
        if (sp === null || tp === null) return e;
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
          sourceHandle: portHandleId(sp, sSide),
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

  // --- values preview and submit ------------------------------------------

  // values.yaml is rebuilt straight from the edges on every change: the edges
  // are the model, there is no intermediate arrow JSON.
  const valuesYaml = useMemo(() => {
    if (edges.length === 0) return "# нарисуйте стрелки между портами";
    // noRefs: with bidirectional links the same selector object lands in the
    // values twice and js-yaml would emit &ref_0/*ref_0 anchors - dump plain
    // copies instead.
    return yaml.dump(buildValues(topology, edges, naming), {
      lineWidth: 100,
      sortKeys: false,
      noRefs: true,
    });
  }, [topology, edges, naming]);

  // Copy the generated values.yaml. navigator.clipboard needs a secure
  // context, which the dev stand over plain http lacks - fall back to the
  // hidden-textarea trick there.
  const copyValues = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(valuesYaml);
      } else {
        const ta = document.createElement("textarea");
        ta.value = valuesYaml;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      toast.success("values.yaml скопирован.");
    } catch {
      toast.error("Не удалось скопировать в буфер обмена.");
    }
  }, [valuesYaml, toast]);

  const submit = useCallback(() => {
    const errors = validateSubmit(topology, edges, naming);
    if (errors.length) {
      toast.error(`Валидация не пройдена: ${errors.join(" ")}`);
      return;
    }
    // No backend in the prototype: simulate the would-be order handoff.
    toast.success("values валиден. Здесь values передадутся в форму заказа policies.");
  }, [topology, edges, naming, toast]);

  const wlDialogNs = wlDialog ? (topology.find((n) => n.name === wlDialog.ns) ?? null) : null;

  return (
    <div className="flex h-[calc(100vh-1px)] flex-col">
      <div className="flex items-center gap-4 border-b border-gray-200 bg-surface px-4 py-3">
        <Link
          to="/catalog"
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600"
        >
          <IconArrowLeft size={16} /> Портал
        </Link>
        <h1 className="text-sm font-semibold text-slate-900">
          Карта сетевого взаимодействия (сандбокс)
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <Button onPress={loadExample}>
            <IconWand size={16} /> Пример
          </Button>
          <Button variant="primary" onPress={() => setNsDialog({})}>
            <IconPlus size={16} /> Namespace
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
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
            onNodeDragStop={onNodeDragStop}
            onNodeDragStart={() => setMenu(null)}
            onMoveStart={() => setMenu(null)}
            onPaneContextMenu={onPaneContextMenu}
            onNodeContextMenu={onNodeContextMenu}
            onNodeDoubleClick={onNodeDoubleClick}
            onEdgeContextMenu={onEdgeContextMenu}
            deleteKeyCode={["Delete", "Backspace"]}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls showInteractive={false} />
            {/* Shifted right so the chip clears the zoom controls. */}
            <Panel position="bottom-left" style={{ marginLeft: 56 }}>
              <Legend />
            </Panel>
          </ReactFlow>

          {topology.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="pointer-events-auto flex flex-col items-center gap-3 rounded-lg border border-gray-200 bg-surface/95 px-6 py-5 text-center shadow-sm">
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
              </div>
            </div>
          )}
        </div>

        <aside className="flex w-[380px] shrink-0 flex-col border-l border-gray-200 bg-surface">
          <div className="grid grid-cols-3 gap-2 border-b border-gray-200 px-3 py-2">
            <TextField
              label="instanceTag"
              value={naming.instanceTag}
              onChange={(v) => setNaming((n) => ({ ...n, instanceTag: v }))}
            />
            <TextField
              label="clusterTag"
              value={naming.clusterTag}
              onChange={(v) => setNaming((n) => ({ ...n, clusterTag: v }))}
            />
            <TextField
              label="projectTag"
              value={naming.projectTag}
              onChange={(v) => setNaming((n) => ({ ...n, projectTag: v }))}
            />
          </div>
          <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2">
            <span className="text-xs font-semibold text-slate-700">values.yaml</span>
            <span className="text-xs text-slate-400">стрелок: {edges.length}</span>
            <button
              type="button"
              onClick={copyValues}
              disabled={edges.length === 0}
              aria-label="Скопировать values.yaml"
              className="ml-auto flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-xs text-slate-500 outline-none hover:bg-gray-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-default disabled:opacity-40"
            >
              <IconCopy size={14} /> Скопировать
            </button>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto bg-app p-3 font-mono text-xs leading-relaxed text-slate-700">
            {valuesYaml}
          </pre>
          <div className="border-t border-gray-200 p-3">
            <Button variant="primary" onPress={submit} className="w-full justify-center">
              Заказать
            </Button>
            <p className="mt-2 text-center text-[11px] text-slate-400">
              Сандбокс: топология вводится вручную, values собирается из стрелок.
            </p>
          </div>
        </aside>
      </div>

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
}

// Legend explains the canvas notation; extend it together with new highlights.
// Collapsed to a small chip, the full card slides in on hover or focus.
function Legend() {
  return (
    <div className="group relative">
      <div
        tabIndex={0}
        className="flex cursor-help items-center gap-1.5 rounded-md border border-gray-200 bg-surface/95 px-2.5 py-1.5 text-[11px] font-medium text-slate-500 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <IconInfoCircle size={14} /> Легенда
      </div>
      <div className="pointer-events-none absolute bottom-full left-0 mb-2 w-max max-w-96 rounded-md border border-gray-200 bg-surface/95 px-3 py-2 text-[11px] leading-5 text-slate-600 opacity-0 shadow-md transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
      <div className="flex items-center gap-2">
        <span className="h-3.5 w-5 shrink-0 rounded border border-dashed border-slate-400" />
        namespace (перетаскивается)
      </div>
      <div className="flex items-center gap-2">
        <span className="h-3.5 w-5 shrink-0 rounded border border-slate-300 bg-surface shadow-sm" />
        workload (Deployment / StatefulSet / DaemonSet / Ingress- и Egress-GW)
      </div>
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 shrink-0 rounded-full border-2 border-sky-500 bg-surface" />
        exposed-порт: кружки с двух сторон, тяните стрелку с удобной
      </div>
      <div className="flex items-center gap-2">
        <span className="h-3.5 w-5 shrink-0 rounded border border-red-500 bg-surface" />
        невалидный workload (нет SA или портов)
      </div>
      <div className="flex items-center gap-2">
        <svg
          viewBox="0 0 20 6"
          className="h-2 w-5 shrink-0 text-slate-500"
          role="img"
          aria-label="Стрелка с бегущей точкой"
        >
          <line x1="0" y1="3" x2="20" y2="3" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="10" cy="3" r="2.2" className="fill-sky-500" />
        </svg>
        разрешённый трафик source -&gt; target (точка бежит по стрелке)
      </div>
      <div className="flex items-center gap-2">
        <svg
          viewBox="0 0 24 8"
          className="h-2.5 w-6 shrink-0 text-slate-500"
          role="img"
          aria-label="Двойная стрелка"
        >
          <path d="M5 4 L19 4" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 1 L4 4 L8 7" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M16 1 L20 4 L16 7" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="10" cy="4" r="2" className="fill-sky-500" />
          <circle cx="14" cy="4" r="2" className="fill-emerald-500" />
        </svg>
        трафик в обе стороны: синяя точка - туда, зелёная - обратно
      </div>
        <div className="mt-1 text-slate-400">ПКМ - добавить или изменить элементы.</div>
      </div>
    </div>
  );
}

export function PoliciesMapPrototype() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}

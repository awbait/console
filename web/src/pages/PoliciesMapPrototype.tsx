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
  ReactFlow,
  ReactFlowProvider,
  reconnectEdge,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@xyflow/react/dist/style.css";
import { IconArrowLeft } from "@tabler/icons-react";
import yaml from "js-yaml";
import { Link } from "react-router-dom";
import { useToast } from "../app/ToastContext";
import { Button } from "../components/ui";
import {
  findNamespace,
  findWorkload,
  MOCK_NAMESPACES,
  type MockNamespace,
  workloadInvalidReason,
} from "./policiesMap/mockData";
import "./policiesMap/policiesMap.css";
import { buildValues, validateEdges } from "./policiesMap/valuesBuilder";
import { WorkloadNode, type WorkloadNodeData } from "./policiesMap/WorkloadNode";

const nodeTypes = { workload: WorkloadNode, nsGroup: NsGroupNode };

// Layout constants for the two-column namespace layout.
const GROUP_W = 250;
const GROUP_X2 = 430;
const HEAD = 40;
const ROW = 150;

const nsOf = (nodeId: string) => nodeId.split("/")[0];

// buildNodes lays out the two selected namespaces as group boxes with their
// workloads stacked inside. ns1 sits on the left (ports on the right border),
// ns2 on the right (ports on the left).
function buildNodes(ns1: MockNamespace, ns2: MockNamespace): Node[] {
  const nodes: Node[] = [];
  const groups: { ns: MockNamespace; x: number; side: "left" | "right" }[] = [
    { ns: ns1, x: 0, side: "left" },
    { ns: ns2, x: GROUP_X2, side: "right" },
  ];
  for (const { ns, x, side } of groups) {
    const height = HEAD + ns.workloads.length * ROW + 20;
    nodes.push({
      id: `group:${ns.name}`,
      type: "nsGroup",
      position: { x, y: 0 },
      data: { label: ns.name },
      draggable: false,
      selectable: false,
      style: { width: GROUP_W, height },
      className: "rf-ns",
    });
    ns.workloads.forEach((w, i) => {
      const data: WorkloadNodeData = { workload: w, side, invalidReason: workloadInvalidReason(w) };
      nodes.push({
        id: w.id,
        type: "workload",
        parentId: `group:${ns.name}`,
        extent: "parent",
        position: { x: 10, y: HEAD + i * ROW },
        data,
        draggable: false,
        selectable: false,
        connectable: true,
      });
    });
  }
  return nodes;
}

function NsGroupNode({ data }: { data: { label: string } }) {
  return <div className="rf-ns__title">namespace: {data.label}</div>;
}

function Canvas() {
  const toast = useToast();
  const [ns1, setNs1] = useState<string>(MOCK_NAMESPACES[0].name);
  const [ns2, setNs2] = useState<string>(MOCK_NAMESPACES[1].name);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Rebuild the canvas whenever a namespace changes. Changing a namespace wipes
  // all arrows, so the generated values reset too.
  useEffect(() => {
    const a = findNamespace(ns1);
    const b = findNamespace(ns2);
    if (!a || !b) return;
    setNodes(buildNodes(a, b));
    setEdges([]);
  }, [ns1, ns2, setNodes, setEdges]);

  // connectionReason returns why a (source -> target) link is rejected, or null
  // if it is allowed. Shared by isValidConnection (live feedback) and the
  // dropped-on-invalid-target error toast.
  const connectionReason = useCallback((source: string, target: string): string | null => {
    if (source === target) return "Нельзя соединить порт сам с собой.";
    if (nsOf(source) === nsOf(target)) return "Стрелки проводятся только между выбранными namespace.";
    const from = findWorkload(source);
    const to = findWorkload(target);
    if (!from || !to) return "Неизвестный workload.";
    const fromBad = workloadInvalidReason(from);
    if (fromBad) return `Источник ${from.name}: ${fromBad}.`;
    const toBad = workloadInvalidReason(to);
    if (toBad) return `Получатель ${to.name}: ${toBad}.`;
    return null;
  }, []);

  const isValidConnection = useCallback(
    (c: Connection | Edge) => connectionReason(c.source, c.target) === null,
    [connectionReason],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      setEdges((eds) =>
        addEdge(
          { ...c, markerEnd: { type: MarkerType.ArrowClosed }, reconnectable: true },
          eds,
        ),
      );
    },
    [setEdges],
  );

  // Dropped a new connection onto an invalid target: explain why (requirement
  // 1.1). Dropped on empty canvas (toNode null): arrow just disappears (2.3).
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
  // preserved by reconnectEdge); dropping it off a port deletes the arrow
  // (requirements 3 and 4).
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

  // values.yaml is rebuilt straight from the edges on every change: the edges
  // are the model, there is no intermediate arrow JSON.
  const valuesYaml = useMemo(() => {
    if (edges.length === 0) return "# нарисуйте стрелки между портами";
    return yaml.dump(buildValues(edges), { lineWidth: 100, sortKeys: false });
  }, [edges]);

  const submit = useCallback(() => {
    const errors = validateEdges(edges);
    if (errors.length) {
      toast.error(`Валидация не пройдена: ${errors.join(" ")}`);
      return;
    }
    // No backend in the prototype: simulate the would-be GitLab branch + MR.
    toast.success(`values валиден. Создан бы MR в ветке ${ns1}-${ns2} (managed-services/<team>/policies).`);
  }, [edges, ns1, ns2, toast]);

  const ns2Options = MOCK_NAMESPACES.filter((n) => n.name !== ns1);
  const ns1Options = MOCK_NAMESPACES.filter((n) => n.name !== ns2);

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
          Карта сетевого взаимодействия (прототип)
        </h1>
        <div className="ml-auto flex items-center gap-3">
          <NsPicker label="namespace 1" value={ns1} options={ns1Options} onChange={setNs1} />
          <span className="text-slate-300">-&gt;</span>
          <NsPicker label="namespace 2" value={ns2} options={ns2Options} onChange={setNs2} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="rf-wrap min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
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
            nodesDraggable={false}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <aside className="flex w-[380px] shrink-0 flex-col border-l border-gray-200 bg-surface">
          <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2">
            <span className="text-xs font-semibold text-slate-700">values.yaml</span>
            <span className="text-xs text-slate-400">стрелок: {edges.length}</span>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto bg-app p-3 font-mono text-xs leading-relaxed text-slate-700">
            {valuesYaml}
          </pre>
          <div className="border-t border-gray-200 p-3">
            <Button variant="primary" onPress={submit} className="w-full justify-center">
              Отправить на согласование
            </Button>
            <p className="mt-2 text-center text-[11px] text-slate-400">
              Прототип на моках: бэка и реальных данных нет.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function NsPicker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: MockNamespace[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-gray-300 bg-surface px-2 py-1 text-sm outline-none focus:border-brand-500"
      >
        {options.map((n) => (
          <option key={n.name} value={n.name}>
            {n.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PoliciesMapPrototype() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}

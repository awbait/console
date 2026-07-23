import { Handle, type NodeProps, Position } from "@xyflow/react";
import { KIND_LABELS, type TopoWorkload } from "./topology";

// Data carried by a workload node.
export interface WorkloadNodeData {
  workload: TopoWorkload;
  invalidReason: string | null;
  // Handle ids that currently carry an edge: their circles stay visible, the
  // rest only appear on port-row hover.
  connectedHandles?: string[];
  [key: string]: unknown;
}

// Handle id encodes the port NUMBER (stable across workload edits, unlike an
// index) plus the side. Every port renders a circle on BOTH card borders, so
// the user draws the arrow from whichever side faces the peer namespace and
// the edge geometry stays clean.
export const portHandleId = (port: number, side: "l" | "r") => `p-${port}-${side}`;
export const portFromHandle = (handle: string | null | undefined): number | null => {
  const m = handle?.match(/^p-(\d+)-[lr]$/);
  return m ? Number(m[1]) : null;
};

// Body handles sit at the card header and anchor edges whose source port is
// unknown (values parsed back into a graph never record the source port).
// They are not user-connectable - drawing stays port-to-port.
export const bodyHandleId = (side: "l" | "r") => `w-${side}`;
export const isBodyHandle = (handle: string | null | undefined): boolean =>
  handle === "w-l" || handle === "w-r";

export function WorkloadNode({ data }: NodeProps) {
  const { workload, invalidReason, connectedHandles } = data as WorkloadNodeData;
  // Invalid workloads keep their ports connectable on purpose: per spec the
  // arrow attempt must surface an explanatory error, not be silently blocked.
  const invalid = invalidReason !== null;
  const connected = new Set(connectedHandles ?? []);
  const portClass = (id: string) => `rf-port${connected.has(id) ? " rf-port--on" : ""}`;

  const badgeMod =
    workload.kind === "IngressGateway"
      ? " rf-wl__badge--ingw"
      : workload.kind === "EgressGateway"
        ? " rf-wl__badge--egw"
        : "";
  // Egress gateways work without an SA: no row at all instead of a noisy
  // "not required" note. Other kinds always show the row (red when missing).
  const showSa = workload.serviceAccount !== null || workload.kind !== "EgressGateway";

  return (
    <div className={`rf-wl${invalid ? " rf-wl--invalid" : ""}`} title={invalidReason ?? undefined}>
      <div className="rf-wl__head">
        <Handle
          id={bodyHandleId("l")}
          type="source"
          position={Position.Left}
          isConnectableStart={false}
          isConnectableEnd={false}
          className={portClass(bodyHandleId("l"))}
        />
        <Handle
          id={bodyHandleId("r")}
          type="source"
          position={Position.Right}
          isConnectableStart={false}
          isConnectableEnd={false}
          className={portClass(bodyHandleId("r"))}
        />
        <div className="rf-wl__title">
          <span className="rf-wl__name" title={workload.name}>
            {workload.name}
          </span>
          <span className={`rf-wl__badge${badgeMod}`}>{KIND_LABELS[workload.kind]}</span>
        </div>
        {showSa && (
          <div className="rf-wl__sa" title={workload.serviceAccount ?? undefined}>
            <span className="rf-wl__sa-label">sa</span>
            {workload.serviceAccount ? (
              <span className="rf-wl__sa-value">{workload.serviceAccount}</span>
            ) : (
              <span className="rf-wl__sa-value rf-wl__sa-value--missing">не задан</span>
            )}
          </div>
        )}
      </div>

      <div className="rf-wl__ports">
        {workload.ports.length === 0 ? (
          <div className="rf-wl__empty">нет exposed-портов</div>
        ) : (
          workload.ports.map((p) => (
            <div key={`${p.port}-${p.protocol}`} className="rf-wl__port-row">
              <span className="rf-wl__port-label">
                <span className="rf-wl__port-num">{p.port}</span>
                <span className="rf-wl__port-proto">{p.protocol}</span>
              </span>
              <Handle
                id={portHandleId(p.port, "l")}
                type="source"
                position={Position.Left}
                isConnectableStart
                isConnectableEnd
                className={portClass(portHandleId(p.port, "l"))}
              />
              <Handle
                id={portHandleId(p.port, "r")}
                type="source"
                position={Position.Right}
                isConnectableStart
                isConnectableEnd
                className={portClass(portHandleId(p.port, "r"))}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

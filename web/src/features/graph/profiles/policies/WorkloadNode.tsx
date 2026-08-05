import { Handle, type NodeProps, Position } from "@xyflow/react";
import { createContext, useContext } from "react";
import { canSend, KIND_LABELS, nsOfWorkload, type TopoWorkload } from "./topology";

// Data carried by a workload node.
export interface WorkloadNodeData {
  workload: TopoWorkload;
  invalidReason: string | null;
  // Handle ids that currently carry an edge: their circles stay visible, the
  // rest only appear on port-row hover.
  connectedHandles?: string[];
  [key: string]: unknown;
}

// Set while the user drags a new connection: what kind of handle it started
// from and in which namespace. Cards in OTHER namespaces light up the valid
// opposite ends (drag from the outgoing dot -> their ports, drag from a
// port -> their outgoing dots), so the drop target is obvious.
export type ConnectingFrom = { kind: "body" | "port"; ns: string } | null;
export const ConnectingCtx = createContext<ConnectingFrom>(null);

// Handle id encodes the port NUMBER (stable across workload edits, unlike an
// index) plus the side. Ports render their circle on the LEFT border only:
// the canvas flows left to right - incoming on the left, outgoing on the
// right.
export const portHandleId = (port: number, side: "l" | "r") => `p-${port}-${side}`;
export const portFromHandle = (handle: string | null | undefined): number | null => {
  const m = handle?.match(/^p-(\d+)-[lr]$/);
  return m ? Number(m[1]) : null;
};

// The body handle sits at the card header (right side) and is THE source
// anchor: an outgoing rule never records a source port (only the destination
// port exists in the values), so arrows start from the workload itself and
// end on a peer's port. The port circles are destination-only.
export const bodyHandleId = (side: "l" | "r") => `w-${side}`;
export const isBodyHandle = (handle: string | null | undefined): boolean =>
  handle === "w-l" || handle === "w-r";

export function WorkloadNode({ data }: NodeProps) {
  const { workload, invalidReason, connectedHandles } = data as WorkloadNodeData;
  const connecting = useContext(ConnectingCtx);
  const invalid = invalidReason !== null;
  const connected = new Set(connectedHandles ?? []);
  // A workload without an SA cannot send: no outgoing dot to draw from.
  const sendable = canSend(workload);
  // Arrows only run between namespaces, so only foreign cards highlight.
  const foreign = connecting !== null && connecting.ns !== nsOfWorkload(workload.id);
  const availPort = foreign && connecting.kind === "body";
  const availBody = foreign && connecting.kind === "port" && sendable;
  const portClass = (id: string) =>
    `rf-port${connected.has(id) ? " rf-port--on" : ""}${availPort ? " rf-port--avail" : ""}`;

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
        {/* Outgoing anchor: one filled dot on the RIGHT at header level.
            Connectable in both gestures: drag from here to a peer's port, or
            from a port back to here - onConnect normalizes the direction.
            Without an SA the dot is hidden and inert (it stays in the DOM so
            edges parsed from broken values keep their anchor). */}
        <Handle
          id={bodyHandleId("r")}
          type="source"
          position={Position.Right}
          isConnectableStart={sendable}
          isConnectableEnd={sendable}
          className={`rf-port rf-port--src${sendable ? "" : " rf-port--off"}${
            connected.has(bodyHandleId("r")) ? " rf-port--on" : ""
          }${availBody ? " rf-port--avail" : ""}`}
          title={sendable ? "Тяните стрелку отсюда к порту получателя" : undefined}
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
            </div>
          ))
        )}
      </div>
    </div>
  );
}

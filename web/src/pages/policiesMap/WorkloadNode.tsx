import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { MockWorkload } from "./mockData";

// Data carried by a workload node. `side` decides which border the port circles
// sit on: ns1 (left group) exposes ports on the right, ns2 on the left, so
// arrows naturally span the gap between the two namespaces.
export interface WorkloadNodeData {
  workload: MockWorkload;
  side: "left" | "right";
  invalidReason: string | null;
  [key: string]: unknown;
}

// Handle id encodes the port index; the editor looks the port/protocol up from
// node data when an edge is drawn.
export const portHandleId = (index: number) => `p-${index}`;
export const portIndexFromHandle = (handle: string | null | undefined): number | null => {
  if (!handle?.startsWith("p-")) return null;
  const n = Number(handle.slice(2));
  return Number.isInteger(n) ? n : null;
};

export function WorkloadNode({ data }: NodeProps) {
  const { workload, side, invalidReason } = data as WorkloadNodeData;
  const handleSide = side === "left" ? Position.Right : Position.Left;
  // Invalid workloads keep their ports connectable on purpose: per spec the
  // arrow attempt must surface an explanatory error, not be silently blocked.
  const invalid = invalidReason !== null;

  return (
    <div className={`rf-wl${invalid ? " rf-wl--invalid" : ""}`} title={invalidReason ?? undefined}>
      <div className="rf-wl__head">
        <div>
          <span className="rf-wl__name">{workload.name}</span>
          <span className="rf-wl__kind">{workload.kind}</span>
        </div>
        {workload.serviceAccount ? (
          <div className="rf-wl__sa">sa: {workload.serviceAccount}</div>
        ) : (
          <div className="rf-wl__sa rf-wl__sa--missing">нет service account</div>
        )}
      </div>

      <div className="rf-wl__ports">
        {workload.ports.length === 0 ? (
          <div className="rf-wl__empty">нет exposed-портов</div>
        ) : (
          workload.ports.map((p, i) => (
            <div
              key={`${p.port}-${p.protocol}`}
              className={`rf-wl__port-row${side === "left" ? " rf-wl__port-row--right" : ""}`}
            >
              <span className="rf-wl__port-label">
                <span className="rf-wl__port-num">{p.port}</span>
                <span className="rf-wl__port-proto">{p.protocol}</span>
              </span>
              <Handle
                id={portHandleId(i)}
                type="source"
                position={handleSide}
                isConnectableStart
                isConnectableEnd
                className="rf-port"
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

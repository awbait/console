import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { TopoWorkload } from "./topology";

// Data carried by a workload node.
export interface WorkloadNodeData {
  workload: TopoWorkload;
  invalidReason: string | null;
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

export function WorkloadNode({ data }: NodeProps) {
  const { workload, invalidReason } = data as WorkloadNodeData;
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
                className="rf-port"
              />
              <Handle
                id={portHandleId(p.port, "r")}
                type="source"
                position={Position.Right}
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

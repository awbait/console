import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { GraphNode, GraphProfile } from "./model";
import { kindLabel, kindTone } from "./model";

// Data a core card carries. Rows that anchor an arrow keep their handle
// visible; the rest have no handle at all (the read-only canvas never
// starts a connection).
export interface CardNodeData {
  node: GraphNode;
  profile: GraphProfile;
  // Row ids that an arrow attaches to, plus "" for the card body.
  anchored?: string[];
  [key: string]: unknown;
}

export const rowHandleId = (rowId: string) => `r-${rowId}`;
export const bodyHandle = "card";

const TONE_CLASS: Record<string, string> = {
  neutral: "",
  accent: " rf-card__badge--accent",
  warn: " rf-card__badge--warn",
  muted: " rf-card__badge--muted",
};

// CardNode is the read-only card of the core canvas: a header with the title,
// the kind badge and an optional secondary line, then the rows. It mirrors the
// policies workload card so both profiles read as one product.
export function CardNode({ data }: NodeProps) {
  const { node, profile, anchored } = data as CardNodeData;
  const invalid = node.invalid != null;
  const anchors = new Set(anchored ?? []);

  return (
    <div className={`rf-card${invalid ? " rf-card--invalid" : ""}`} title={node.invalid ?? undefined}>
      <div className="rf-card__head">
        <Handle
          id={bodyHandle}
          type="source"
          position={Position.Right}
          isConnectable={false}
          className={`rf-port rf-port--src${anchors.has(bodyHandle) ? " rf-port--on" : " rf-port--off"}`}
        />
        <Handle
          id={`${bodyHandle}-in`}
          type="target"
          position={Position.Left}
          isConnectable={false}
          className="rf-port rf-port--off"
        />
        <div className="rf-card__title">
          <span className="rf-card__name" title={node.title}>
            {node.title}
          </span>
          <span className={`rf-card__badge${TONE_CLASS[kindTone(profile, node.kind)] ?? ""}`}>
            {kindLabel(profile, node.kind)}
          </span>
        </div>
        {node.subtitle && (
          <div className="rf-card__sub" title={node.subtitle}>
            {node.subtitleLabel && <span className="rf-card__sub-label">{node.subtitleLabel}</span>}
            <span className="rf-card__sub-value">{node.subtitle}</span>
          </div>
        )}
      </div>

      <div className="rf-card__rows">
        {node.rows.length === 0 ? (
          <div className="rf-card__empty">{node.emptyRows ?? "нет данных"}</div>
        ) : (
          node.rows.map((r) => (
            <div key={r.id} className="rf-card__row">
              <span className="rf-card__row-label">
                <span className="rf-card__row-name">{r.label}</span>
                {r.tag && <span className="rf-card__row-tag">{r.tag}</span>}
              </span>
              <Handle
                id={rowHandleId(r.id)}
                type="target"
                position={Position.Left}
                isConnectable={false}
                className={`rf-port${anchors.has(r.id) ? " rf-port--on" : " rf-port--off"}`}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

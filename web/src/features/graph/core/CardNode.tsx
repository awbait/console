import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { GraphNode, GraphProfile } from "./model";
import { kindLabel, kindTone } from "./model";

// Read-only cards expose only anchors used by links. Editable cards expose
// all body and row anchors so the host can validate a new connection.
export interface CardNodeData {
  node: GraphNode;
  profile: GraphProfile;
  // Row ids that an arrow attaches to, plus "" for the card body.
  anchored?: string[];
  editable?: boolean;
  [key: string]: unknown;
}

export const rowHandleId = (rowId: string) => `r-${rowId}`;
export const sourceRowHandleId = (rowId: string) => `${rowHandleId(rowId)}-out`;
export const bodyHandle = "card";

const TONE_CLASS: Record<string, string> = {
  neutral: "",
  accent: " rf-card__badge--accent",
  warn: " rf-card__badge--warn",
  muted: " rf-card__badge--muted",
};

// Shared card: title, kind badge, optional secondary line and field rows.
export function CardNode({ data, selected }: NodeProps) {
  const { node, profile, anchored, editable = false } = data as CardNodeData;
  const invalid = node.invalid != null;
  const anchors = new Set(anchored ?? []);

  return (
    <div className={`rf-card${invalid ? " rf-card--invalid" : ""}${selected ? " ring-2 ring-brand-500" : ""}`} title={node.invalid ?? undefined}>
      <div className="rf-card__head">
        <Handle
          id={bodyHandle}
          type="source"
          position={Position.Right}
          isConnectable={editable}
          className={`rf-port rf-port--src${editable || anchors.has(bodyHandle) ? " rf-port--on" : " rf-port--off"}`}
        />
        <Handle
          id={`${bodyHandle}-in`}
          type="target"
          position={Position.Left}
          isConnectable={editable}
          className={`rf-port${editable ? " rf-port--on" : " rf-port--off"}`}
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
                isConnectable={editable}
                className={`rf-port${editable || anchors.has(r.id) ? " rf-port--on" : " rf-port--off"}`}
              />
              <Handle id={sourceRowHandleId(r.id)} type="source" position={Position.Right}
                isConnectable={editable}
                className={`rf-port rf-port--src${editable || anchors.has(r.id) ? " rf-port--on" : " rf-port--off"}`} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

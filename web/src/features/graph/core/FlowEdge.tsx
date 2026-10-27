import { BaseEdge, type EdgeProps, getBezierPath } from "@xyflow/react";

// FlowEdge renders a policy link with a travelling-dot traffic animation
// running source -> target. The stock dash animation is not used - the dot
// reads better at the canvas zoom levels.
export function FlowEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  style,
  markerStart,
  markerEnd,
  label,
  selected,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  return (
    <>
      <BaseEdge id={id} path={path} style={{ ...style, ...(selected ? { stroke: "rgb(var(--c-brand-500))", strokeWidth: 2 } : {}) }} markerStart={markerStart} markerEnd={markerEnd}
        label={label} labelX={labelX} labelY={labelY}
        labelStyle={{ fill: "rgb(var(--c-neutral-800))", fontSize: 11 }}
        labelBgStyle={{ fill: "rgb(var(--c-surface))" }} />
      <circle r="3" className="rf-flow-dot rf-flow-dot--fwd">
        <animateMotion dur="2.4s" repeatCount="indefinite" path={path} />
      </circle>
    </>
  );
}

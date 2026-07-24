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
}: EdgeProps) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerStart={markerStart} markerEnd={markerEnd} />
      <circle r="3" className="rf-flow-dot rf-flow-dot--fwd">
        <animateMotion dur="2.4s" repeatCount="indefinite" path={path} />
      </circle>
    </>
  );
}

import { BaseEdge, type EdgeProps, getBezierPath } from "@xyflow/react";

// BidiEdge renders a bidirectional link: a steady double-headed line plus two
// dots travelling the path in opposite directions. The stock dash animation
// cannot do this - it only flows source -> target.
export function BidiEdge({
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
      <circle r="3" className="rf-flow-dot">
        <animateMotion dur="2.4s" repeatCount="indefinite" path={path} />
      </circle>
      <circle r="3" className="rf-flow-dot">
        <animateMotion
          dur="2.4s"
          repeatCount="indefinite"
          path={path}
          keyPoints="1;0"
          keyTimes="0;1"
          calcMode="linear"
        />
      </circle>
    </>
  );
}

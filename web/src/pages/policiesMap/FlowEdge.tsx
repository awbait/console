import { BaseEdge, type EdgeProps, getBezierPath } from "@xyflow/react";

// FlowEdge renders a policy link with travelling-dot traffic animation: a
// forward dot on every edge, plus a counter-moving dot in another color when
// the link is bidirectional (data.bidirectional). The stock dash animation is
// not used - it can only flow source -> target.
export function FlowEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  data,
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
  const bidi = data?.bidirectional === true;
  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerStart={markerStart} markerEnd={markerEnd} />
      <circle r="3" className="rf-flow-dot rf-flow-dot--fwd">
        <animateMotion dur="2.4s" repeatCount="indefinite" path={path} />
      </circle>
      {bidi && (
        <circle r="3" className="rf-flow-dot rf-flow-dot--rev">
          <animateMotion
            dur="2.4s"
            repeatCount="indefinite"
            path={path}
            keyPoints="1;0"
            keyTimes="0;1"
            calcMode="linear"
          />
        </circle>
      )}
    </>
  );
}

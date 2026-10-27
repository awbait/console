import {
	BaseEdge,
	EdgeLabelRenderer,
	type EdgeProps,
	getBezierPath,
	useViewport,
} from "@xyflow/react";

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
	data,
}: EdgeProps) {
	const { zoom } = useViewport();
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
			<BaseEdge
				id={id}
				path={path}
				style={{
					...style,
					...(selected
						? { stroke: "rgb(var(--c-brand-500))", strokeWidth: 2 }
						: {}),
				}}
				markerStart={markerStart}
				markerEnd={markerEnd}
			/>
			{label && (
				<EdgeLabelRenderer>
					<button
						type="button"
						title={typeof label === "string" ? label : undefined}
						className="nodrag nopan absolute max-w-48 truncate rounded border border-slate-300 bg-surface px-2 py-1 text-xs font-medium text-slate-800 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
						style={{
							pointerEvents: "all",
							transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px) scale(${1 / Math.min(zoom, 1)}) translateY(${Number(data?.labelOffset ?? 0)}px)`,
						}}
						onClick={() => {
							if (typeof data?.onSelect === "function") data.onSelect();
						}}
					>
						{label}
					</button>
				</EdgeLabelRenderer>
			)}
			<circle r="3" className="rf-flow-dot rf-flow-dot--fwd">
				<animateMotion dur="2.4s" repeatCount="indefinite" path={path} />
			</circle>
		</>
	);
}

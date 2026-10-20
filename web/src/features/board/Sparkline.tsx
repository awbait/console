import { useState } from "react";
import type { SeriesPoint } from "./stub";

// Sparkline is the trend under a board tile: a short series with no axes, where
// the shape matters more than any one value. Hovering a point names its date and
// value, so the shape can be read back as numbers when someone asks "was that
// Tuesday?". The last point is the current period and wears the accent; the rest
// stay in the recessive step of the same hue.
//
// Bars are plain HTML: every bar is its own hit target the full height of the
// plot, and rounded tops stay round at any width (an SVG stretched with
// preserveAspectRatio=none would squash them). The line is SVG, stretched the
// same way, with a non-scaling stroke so it keeps its weight.

const HEIGHT = "h-12";

export function Sparkline({
  points,
  kind = "bars",
  label,
  format,
}: {
  points: SeriesPoint[];
  kind?: "bars" | "line";
  // What the series counts, for the accessible summary.
  label: string;
  // Point label in the tooltip: a day for bars, an hour for the line.
  format: (at: string) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...points.map((p) => p.value));
  const last = points.length - 1;
  const shown = hover ?? null;

  return (
    <div className="relative" onPointerLeave={() => setHover(null)}>
      <span className="sr-only">
        {label}: {points.map((p) => `${format(p.at)} ${p.value}`).join(", ")}
      </span>
      {kind === "bars" ? (
        <div className={`flex ${HEIGHT} items-end gap-0.5`} aria-hidden>
          {points.map((p, i) => (
            <div
              key={p.at}
              className="flex h-full min-w-0 flex-1 items-end"
              onPointerEnter={() => setHover(i)}
            >
              <div
                className={`w-full rounded-t-[2px] transition-colors duration-150 ${
                  i === last ? "bg-brand-500" : hover === i ? "bg-brand-400" : "bg-brand-200"
                }`}
                style={{ height: `${Math.max((p.value / max) * 100, 4)}%` }}
              />
            </div>
          ))}
        </div>
      ) : (
        <LinePlot points={points} max={max} hover={hover} onHover={setHover} />
      )}
      {shown !== null && (
        <div
          className="pointer-events-none absolute bottom-full z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow-md"
          style={{ left: `${((shown + 0.5) / points.length) * 100}%` }}
          aria-hidden
        >
          <span className="text-slate-300">{format(points[shown].at)}</span>{" "}
          <span className="font-semibold">{points[shown].value}</span>
        </div>
      )}
    </div>
  );
}

function LinePlot({
  points,
  max,
  hover,
  onHover,
}: {
  points: SeriesPoint[];
  max: number;
  hover: number | null;
  onHover: (i: number) => void;
}) {
  const n = points.length;
  // x at the middle of each point's slot, so the tooltip and the hit columns line
  // up with the line the same way they do with the bars.
  const x = (i: number) => ((i + 0.5) / n) * 100;
  const y = (v: number) => 100 - (v / max) * 92 - 4;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i)} ${y(p.value)}`).join(" ");
  const area = `M${x(0)} 100 ${points.map((p, i) => `L${x(i)} ${y(p.value)}`).join(" ")} L${x(n - 1)} 100 Z`;
  const at = hover ?? n - 1;

  return (
    <div className={`relative ${HEIGHT}`} aria-hidden>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <path d={area} className="fill-brand-500/10" />
        <path
          d={line}
          className="fill-none stroke-brand-500"
          strokeWidth={2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={0}
            y2={100}
            className="stroke-slate-300"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <span
        className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500 ring-2 ring-surface"
        style={{ left: `${x(at)}%`, top: `${y(points[at].value)}%` }}
      />
      <div className="absolute inset-0 flex">
        {points.map((p, i) => (
          <div key={p.at} className="h-full flex-1" onPointerEnter={() => onHover(i)} />
        ))}
      </div>
    </div>
  );
}

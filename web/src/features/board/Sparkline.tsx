import { type PointerEvent, useId, useState } from "react";
import type { SeriesPoint } from "./stub";

// Sparkline is the trend in a board tile: a short series with no axes, where
// the shape matters more than any one value. Two forms:
//
// - bars, for counts per day: every day is its own mark, so a quiet weekend
//   reads as two short bars instead of a dip in a wave. The last bar is today
//   and wears the accent; the rest stay in a recessive neutral.
// - line, for a level sampled through the day (people online): one calm line
//   over a faint fill.
//
// Hovering anywhere over it snaps to the nearest point and names its date and
// value, so the shape can be read back as numbers.

export function Sparkline({
  points,
  label,
  format,
  kind = "bars",
  className = "h-10",
}: {
  points: SeriesPoint[];
  // What the series counts, for the accessible summary.
  label: string;
  // Point label in the tooltip: a day or an hour.
  format: (at: string) => string;
  kind?: "bars" | "line";
  // Size of the plot; the parent decides how much room the trend gets.
  className?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = points.length;
  const max = Math.max(1, ...points.map((p) => p.value));
  // Slot centres: the same for bars and line, so the tooltip sits over the mark.
  const cx = (i: number) => ((i + 0.5) / n) * 100;

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - box.left) / box.width) * n);
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  const align =
    hover === null ? "" : cx(hover) < 20 ? "translate-x-0" : cx(hover) > 80 ? "-translate-x-full" : "-translate-x-1/2";

  return (
    <div className={`relative touch-none ${className}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <span className="sr-only">
        {label}: {points.map((p) => `${format(p.at)} ${p.value}`).join(", ")}
      </span>
      {kind === "bars" ? (
        <Bars points={points} max={max} hover={hover} />
      ) : (
        <Line points={points} max={max} hover={hover} cx={cx} />
      )}
      {hover !== null && (
        <div
          className={`pointer-events-none absolute bottom-full z-10 mb-1.5 flex items-baseline gap-1.5 whitespace-nowrap rounded-md border border-slate-200 bg-surface px-2 py-1 text-xs shadow-lg ${align}`}
          style={{ left: `${cx(hover)}%` }}
          aria-hidden
        >
          {/* Theme tokens only: a fixed white on a flipping dark fill vanished
              in the dark theme and left the date without its number. */}
          <span className="text-slate-500">{format(points[hover].at)}</span>
          <span className="font-semibold tabular-nums text-slate-900">{points[hover].value}</span>
        </div>
      )}
    </div>
  );
}

function Bars({ points, max, hover }: { points: SeriesPoint[]; max: number; hover: number | null }) {
  const last = points.length - 1;
  return (
    <div className="flex h-full items-end gap-[3px]" aria-hidden>
      {points.map((p, i) => {
        const tone = i === last ? "bg-brand-500" : hover === i ? "bg-brand-300" : "bg-slate-200";
        return (
          <div key={p.at} className="flex h-full min-w-0 flex-1 items-end">
            {/* A zero day keeps a 2px stub, so the row of days stays unbroken. */}
            <div
              className={`w-full rounded-[2px] transition-colors duration-150 ${tone}`}
              style={{ height: p.value > 0 ? `${Math.max((p.value / max) * 100, 8)}%` : "2px" }}
            />
          </div>
        );
      })}
    </div>
  );
}

function Line({
  points,
  max,
  hover,
  cx,
}: {
  points: SeriesPoint[];
  max: number;
  hover: number | null;
  cx: (i: number) => number;
}) {
  const gradient = useId();
  const y = (v: number) => 10 + (1 - v / max) * 80;
  const line = points.map((p, i) => `${i ? "L" : "M"}${cx(i)} ${y(p.value)}`).join(" ");
  const area = `${line} L${cx(points.length - 1)} 100 L${cx(0)} 100 Z`;
  const at = hover ?? points.length - 1;
  return (
    <>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full text-brand-500"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.14} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradient})`} />
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500 ring-2 ring-surface"
        style={{ left: `${cx(at)}%`, top: `${y(points[at].value)}%` }}
        aria-hidden
      />
    </>
  );
}

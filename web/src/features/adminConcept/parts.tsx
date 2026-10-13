import { IconFlask, IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import type { IncidentState, Severity } from "./data";
import { T } from "./text";

// Pieces shared by the concept pages. The pages are demos: every one carries
// ConceptNote so nobody mistakes the numbers for the platform's own.

export function ConceptNote() {
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
      <IconFlask size={14} stroke={1.8} className="shrink-0 text-slate-400" />
      {T.conceptNote}
    </div>
  );
}

// minutesAgoIso turns the demo's "minutes ago" into the timestamp a real
// record would carry, so the portal's own time helpers word it.
export function minutesAgoIso(min: number, now = Date.now()): string {
  return new Date(now - min * 60_000).toISOString();
}

// useLive drives the demo's "live" updates: a tick every `ms` while running.
// The real pages subscribe to an SSE topic instead; the pause control stays,
// because a list that moves under the cursor is hard to read during an
// incident.
export function useLive(ms: number) {
  const [running, setRunning] = useState(true);
  const [tick, setTick] = useState(0);
  const [lastAt, setLastAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setTick((t) => t + 1);
      setLastAt(Date.now());
    }, ms);
    return () => window.clearInterval(id);
  }, [running, ms]);
  // A second clock only for the "updated N s ago" caption.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const ago = Math.max(0, Math.round((now - lastAt) / 1000));
  return { running, setRunning, tick, ago };
}

export function LiveBadge({
  running,
  ago,
  onToggle,
}: {
  running: boolean;
  ago: number;
  onToggle: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-surface py-1 pl-2.5 pr-1 text-xs text-slate-600">
      <span className="relative flex h-2 w-2" aria-hidden="true">
        {running && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 motion-safe:animate-ping" />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${running ? "bg-emerald-500" : "bg-slate-300"}`} />
      </span>
      <span className="whitespace-nowrap font-medium">{running ? T.live.on : T.live.paused}</span>
      <span className="hidden whitespace-nowrap text-slate-400 tabular-nums sm:inline">{T.live.updated(ago)}</span>
      <AriaButton
        onPress={onToggle}
        aria-label={running ? T.live.pause : T.live.resume}
        className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {running ? <IconPlayerPause size={13} stroke={2} /> : <IconPlayerPlay size={13} stroke={2} />}
      </AriaButton>
    </span>
  );
}

export const SEVERITY_TONE: Record<Severity, { dot: string; chip: string; rail: string }> = {
  critical: { dot: "bg-red-500", chip: "bg-red-50 text-red-700", rail: "bg-red-500" },
  major: { dot: "bg-amber-500", chip: "bg-amber-50 text-amber-700", rail: "bg-amber-500" },
  minor: { dot: "bg-slate-400", chip: "bg-slate-100 text-slate-600", rail: "bg-slate-300" },
};

export function SeverityChip({ severity }: { severity: Severity }) {
  const tone = SEVERITY_TONE[severity];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ${tone.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden="true" />
      {T.severity[severity]}
    </span>
  );
}

const STATE_TONE: Record<IncidentState, string> = {
  open: "bg-red-50 text-red-700",
  taken: "bg-brand-50 text-brand-700",
  resolved: "bg-emerald-50 text-emerald-700",
};

export function StateChip({ state }: { state: IncidentState }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${STATE_TONE[state]}`}>
      {T.state[state]}
    </span>
  );
}

// PageFrame is the admin section's page shape: the heading row keeps its place
// and only the body scrolls.
export function PageFrame({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex min-h-9 shrink-0 flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {aside && <div className="flex flex-wrap items-center gap-2">{aside}</div>}
      </div>
      <ConceptNote />
      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-1 pb-1">{children}</div>
    </div>
  );
}

const STAT_TONE = {
  red: "bg-red-50 text-red-700",
  amber: "bg-amber-50 text-amber-700",
  brand: "bg-brand-50 text-brand-700",
  slate: "bg-slate-100 text-slate-600",
} as const;

// Stat is the admin StatCard with a label that wraps instead of truncating:
// the board's labels carry a detail ("2 of them critical") worth reading.
export function Stat({
  label,
  value,
  tone,
  Icon,
}: {
  label: string;
  value: ReactNode;
  tone: keyof typeof STAT_TONE;
  Icon: typeof IconFlask;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${STAT_TONE[tone]}`}>
        <Icon size={20} stroke={1.8} />
      </span>
      <div className="min-w-0">
        <div className="text-2xl font-semibold leading-tight text-slate-900">{value}</div>
        <div className="text-xs text-slate-500">{label}</div>
      </div>
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex min-h-7 items-center justify-between gap-3">
      <h2 className="text-sm font-semibold text-slate-800">{children}</h2>
      {aside}
    </div>
  );
}

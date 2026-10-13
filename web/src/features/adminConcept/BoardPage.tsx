import {
  IconAlertTriangle,
  IconArrowRight,
  IconBox,
  IconChecklist,
  IconRefreshAlert,
  IconRobot,
  IconUserCheck,
} from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { capabilityText } from "@/app/capabilities";
import { Card } from "@/components/ui";
import { Avatar } from "@/features/users/parts";
import { fmtRelative } from "@/lib/time";

import { APPROVALS, CAPABILITY_STATE, COMPONENTS, INCIDENTS, type Incident, LOOPS, PEOPLE } from "./data";
import { actorName, auditAction, useAuditFeed } from "./feed";
import { LiveBadge, minutesAgoIso, PageFrame, SEVERITY_TONE, SectionTitle, Stat, useLive } from "./parts";
import { T } from "./text";

// The on-call board: the first screen of the admin section in the redesign.
// It answers, top to bottom, "is the platform up", "what needs me now", "is it
// getting better or worse" and "what just happened", and every block links to
// the page that owns the details.

const SEVERITY_RANK = { critical: 0, major: 1, minor: 2 } as const;

export function byUrgency(a: Incident, b: Incident) {
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.min - a.min;
}

const CELL_TONE = ["bg-emerald-400", "bg-amber-400", "bg-red-500"] as const;
const CAP_TONE = [
  "border-emerald-200 bg-emerald-50 text-emerald-700",
  "border-amber-200 bg-amber-50 text-amber-800",
  "border-red-200 bg-red-50 text-red-700",
] as const;
const CAP_DOT = ["bg-emerald-500", "bg-amber-500", "bg-red-500"] as const;

export function BoardPage() {
  const live = useLive(9000);
  const { rows: events, fresh } = useAuditFeed(live.tick);

  const active = INCIDENTS.filter((i) => i.state !== "resolved").sort(byUrgency);
  const critical = active.filter((i) => i.severity === "critical").length;
  const ordersDown = active.filter((i) => i.kind === "order").length;
  const loopsFailing = LOOPS.filter((l) => l.error).length;

  return (
    <PageFrame
      title={T.board.title}
      aside={
        <>
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-surface py-0.5 pl-0.5 pr-3 text-xs text-slate-600">
            <Avatar name={PEOPLE.oncall} />
            {T.board.onCall(PEOPLE.oncall)}
          </span>
          <LiveBadge running={live.running} ago={live.ago} onToggle={() => live.setRunning(!live.running)} />
        </>
      }
    >
      {/* Verdict: one sentence for the whole platform, then the capabilities it
          is made of. Worded by what users can do, not by component names. */}
      <Card className="flex flex-col gap-4 border-amber-200 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
            <IconAlertTriangle size={20} stroke={1.8} />
          </span>
          <div>
            <div className="text-base font-semibold text-slate-900">{T.board.verdictTitle}</div>
            <p className="mt-0.5 text-sm text-slate-600">{T.board.verdictText}</p>
          </div>
        </div>
        <ul className="flex flex-wrap gap-1.5 lg:max-w-[50%] lg:justify-end" aria-label={T.board.capabilities}>
          {CAPABILITY_STATE.map((c) => (
            <li
              key={c.id}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${CAP_TONE[c.state]}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${CAP_DOT[c.state]}`} aria-hidden="true" />
              {capabilityText(c.id).label}
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={T.board.statProblems(critical)} value={active.length} tone="red" Icon={IconAlertTriangle} />
        <Stat label={T.board.statOrders} value={ordersDown} tone="amber" Icon={IconBox} />
        <Stat label={T.board.statApprovals} value={APPROVALS.length} tone="brand" Icon={IconChecklist} />
        <Stat label={T.board.statLoops} value={loopsFailing} tone="slate" Icon={IconRefreshAlert} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <section className="flex flex-col xl:col-span-2">
          <SectionTitle
            aside={
              <Link
                to="/admin/incidents"
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 outline-none hover:text-brand-700 focus-visible:text-brand-700"
              >
                {T.board.allProblems(active.length)}
                <IconArrowRight size={14} stroke={1.8} />
              </Link>
            }
          >
            {T.board.needsYou}
          </SectionTitle>
          <ul className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-surface shadow-sm">
            {active.slice(0, 5).map((i) => (
              <li key={i.id} className="relative border-b border-slate-100 last:border-b-0">
                <span className={`absolute inset-y-0 left-0 w-1 ${SEVERITY_TONE[i.severity].rail}`} aria-hidden="true" />
                <Link
                  to={`/admin/incidents?id=${i.id}`}
                  className="flex items-center gap-4 py-3 pl-5 pr-4 outline-none hover:bg-slate-50 focus-visible:bg-brand-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800">{T.incident[i.id].title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                      <span>{T.kind[i.kind]}</span>
                      {i.team && <span>· {i.team}</span>}
                      {i.stand && <span>· {i.stand}</span>}
                      <span>· {T.incidents.openFor(i.min)}</span>
                    </div>
                  </div>
                  <span className="hidden shrink-0 items-center gap-1.5 text-xs text-slate-500 sm:flex">
                    {i.owner ? (
                      <>
                        <IconUserCheck size={14} stroke={1.8} className="text-brand-500" />
                        {i.owner}
                      </>
                    ) : (
                      <span className="text-red-600">{T.incidents.unowned}</span>
                    )}
                  </span>
                  <IconArrowRight size={16} className="shrink-0 text-slate-300" />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col">
          <SectionTitle
            aside={
              <Link
                to="/admin/status"
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 outline-none hover:text-brand-700 focus-visible:text-brand-700"
              >
                {T.board.statusLink}
                <IconArrowRight size={14} stroke={1.8} />
              </Link>
            }
          >
            {T.board.integrations}
          </SectionTitle>
          <Card className="flex flex-col gap-3">
            {COMPONENTS.map((c) => {
              const now = c.hours[c.hours.length - 1];
              return (
                <div key={c.id} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 truncate text-sm text-slate-700">{c.name}</span>
                  {/* One cell per hour, oldest left. Colour plus the row's own
                      caption below, so the state does not rest on colour alone. */}
                  <span className="flex flex-1 gap-px" role="img" aria-label={T.board.historyLabel(c.name, c.hours)}>
                    {c.hours.map((h, idx) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: an hour slot is its position
                      <span key={idx} className={`h-5 flex-1 rounded-[2px] ${CELL_TONE[h]}`} />
                    ))}
                  </span>
                  <span
                    className={`w-14 shrink-0 text-right text-xs tabular-nums ${now === 0 ? "text-slate-500" : "font-medium text-amber-700"}`}
                  >
                    {T.board.latency(c.latencyMs)}
                  </span>
                </div>
              );
            })}
            <div className="flex justify-between pl-[108px] pr-[68px] text-[11px] text-slate-400">
              <span>{T.board.hoursAgo}</span>
              <span>{T.board.now}</span>
            </div>
          </Card>

          <div className="mt-6">
            <SectionTitle>{T.board.loops}</SectionTitle>
          </div>
          <div className="flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200 bg-surface shadow-sm">
            {LOOPS.map((l) => (
              <div key={l.id} className="flex items-center gap-3 px-4 py-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${l.error ? "bg-red-500" : "bg-emerald-500"}`} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{T.loopName[l.id] ?? l.id}</span>
                <span className={`shrink-0 text-xs ${l.error ? "font-medium text-red-600" : "text-slate-500"}`}>
                  {l.error ? T.board.loopFailing : fmtRelative(minutesAgoIso(l.lastMin))}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <section className="flex flex-col xl:col-span-2">
          <SectionTitle
            aside={
              <Link
                to="/admin/audit"
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 outline-none hover:text-brand-700 focus-visible:text-brand-700"
              >
                {T.board.auditLink}
                <IconArrowRight size={14} stroke={1.8} />
              </Link>
            }
          >
            {T.board.recent}
          </SectionTitle>
          <ul className="flex flex-col rounded-lg border border-slate-200 bg-surface shadow-sm" aria-live="polite">
            {events.slice(0, 7).map((e) => (
              <li
                key={e.id}
                className={`flex items-center gap-3 border-b border-slate-100 px-4 py-2.5 last:border-b-0 ${
                  fresh.has(e.id) ? "bg-brand-50/60 motion-safe:animate-in motion-safe:fade-in" : ""
                }`}
              >
                {e.actor ? (
                  <Avatar name={e.actor} />
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                    <IconRobot size={16} stroke={1.8} />
                  </span>
                )}
                <div className="min-w-0 flex-1 text-sm">
                  <span className="font-medium text-slate-800">{actorName(e)}</span>{" "}
                  <span className="text-slate-600">{auditAction(e)}</span>{" "}
                  {e.source !== "access" && <span className="font-medium text-slate-800">{e.subject}</span>}
                </div>
                <span className={`shrink-0 text-xs ${e.ok ? "text-slate-400" : "font-medium text-red-600"}`}>
                  {fmtRelative(minutesAgoIso(e.min))}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col">
          <SectionTitle
            aside={
              <Link
                to="/admin/approvals"
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 outline-none hover:text-brand-700 focus-visible:text-brand-700"
              >
                {T.board.approvalsLink}
                <IconArrowRight size={14} stroke={1.8} />
              </Link>
            }
          >
            {T.board.approvals}
          </SectionTitle>
          <ul className="flex flex-col rounded-lg border border-slate-200 bg-surface shadow-sm">
            {APPROVALS.map((a) => (
              <li key={a.chart} className="flex items-center gap-3 border-b border-slate-100 px-4 py-2.5 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-800">
                    {a.chart} <span className="font-mono text-xs text-slate-500">{a.version}</span>
                  </div>
                  <div className="truncate text-xs text-slate-500">{a.author}</div>
                </div>
                <span className={`shrink-0 text-xs ${a.min >= 1440 ? "font-medium text-amber-700" : "text-slate-400"}`}>
                  {fmtRelative(minutesAgoIso(a.min))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PageFrame>
  );
}

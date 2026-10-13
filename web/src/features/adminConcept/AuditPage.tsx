import { IconChevronRight, IconDownload, IconRobot, IconSearch } from "@tabler/icons-react";
import { Fragment, useMemo, useState } from "react";
import { Input, SearchField } from "react-aria-components";
import { useToast } from "@/app/ToastContext";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui";
import { Avatar } from "@/features/users/parts";
import { fmtDateTime, fmtRelative } from "@/lib/time";
import type { AuditEvent, AuditSource } from "./data";
import { actorName, auditAction, useAuditFeed } from "./feed";
import { LiveBadge, minutesAgoIso, PageFrame, useLive } from "./parts";
import { T } from "./text";

// The audit trail: who did what, to what, when, and whether it worked - people
// and the portal itself in one list. Today the portal keeps two journals
// (orders, publications) and shows only people's rows on the users page; the
// rows marked "not recorded" are the kinds a full trail has to start writing.

const SOURCES: AuditSource[] = ["order", "publication", "stand", "variable", "category", "access", "settings"];
type Who = "all" | "people" | "system";
type Period = "day" | "week" | "month";
const PERIOD_MIN: Record<Period, number> = { day: 1440, week: 10080, month: 43200 };

const pill = (on: boolean) =>
  `inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
    on ? "border-brand-300 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
  }`;

export function AuditPage() {
  const live = useLive(7000);
  const toast = useToast();
  const { rows, fresh } = useAuditFeed(live.tick);
  const [query, setQuery] = useState("");
  const [who, setWho] = useState<Who>("all");
  const [sources, setSources] = useState<Set<AuditSource>>(new Set());
  const [period, setPeriod] = useState<Period>("week");
  const [failedOnly, setFailedOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (e) =>
        e.min <= PERIOD_MIN[period] &&
        (who === "all" || (who === "people") === !!e.actor) &&
        (sources.size === 0 || sources.has(e.source)) &&
        (!failedOnly || !e.ok) &&
        (!q || [actorName(e), e.subject, e.team, auditAction(e)].some((s) => s?.toLowerCase().includes(q))),
    );
  }, [rows, query, who, sources, period, failedOnly]);

  // Rows grouped by calendar day: during an incident review the question is
  // usually "what changed since yesterday evening".
  const groups = useMemo(() => {
    const out: { day: string; rows: AuditEvent[] }[] = [];
    for (const e of shown) {
      const day = new Date(minutesAgoIso(e.min)).toDateString();
      const last = out[out.length - 1];
      if (last?.day === day) last.rows.push(e);
      else out.push({ day, rows: [e] });
    }
    return out;
  }, [shown]);

  const toggleSource = (s: AuditSource) =>
    setSources((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  return (
    <PageFrame
      title={T.audit.title}
      aside={
        <>
          <LiveBadge running={live.running} ago={live.ago} onToggle={() => live.setRunning(!live.running)} />
          <Button onPress={() => toast.success(T.audit.exported(shown.length))}>
            <IconDownload size={15} stroke={1.8} />
            {T.audit.export}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchField value={query} onChange={setQuery} aria-label={T.audit.search} className="relative w-full sm:w-80">
            <IconSearch size={15} stroke={1.8} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder={T.audit.search}
              className="w-full rounded-md border border-slate-300 bg-surface py-1.5 pl-8 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
            />
          </SearchField>
          <Segmented<Who>
            label={T.audit.whoLabel}
            value={who}
            onChange={setWho}
            options={[
              ["all", T.audit.whoAll],
              ["people", T.audit.whoPeople],
              ["system", T.audit.whoSystem],
            ]}
          />
          <Segmented<Period>
            label={T.audit.periodLabel}
            value={period}
            onChange={setPeriod}
            options={[
              ["day", T.audit.periodDay],
              ["week", T.audit.periodWeek],
              ["month", T.audit.periodMonth],
            ]}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {SOURCES.map((s) => (
            <button key={s} type="button" aria-pressed={sources.has(s)} onClick={() => toggleSource(s)} className={pill(sources.has(s))}>
              {T.source[s]}
            </button>
          ))}
          <span className="mx-1 w-px self-stretch bg-slate-200" aria-hidden="true" />
          <button type="button" aria-pressed={failedOnly} onClick={() => setFailedOnly(!failedOnly)} className={pill(failedOnly)}>
            {T.audit.failedOnly}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-surface shadow-sm">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-medium text-slate-500">
              <th className="w-8 px-2 py-2.5" />
              <th className="px-3 py-2.5 font-medium">{T.audit.colWhen}</th>
              <th className="px-3 py-2.5 font-medium">{T.audit.colWho}</th>
              <th className="px-3 py-2.5 font-medium">{T.audit.colWhat}</th>
              <th className="px-3 py-2.5 font-medium">{T.audit.colTeam}</th>
              <th className="px-3 py-2.5 text-right font-medium">{T.audit.colResult}</th>
            </tr>
          </thead>
          <tbody aria-live="polite">
            {groups.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  {T.audit.empty}
                </td>
              </tr>
            )}
            {groups.map((g) => (
              <Fragment key={g.day}>
                <tr>
                  <td colSpan={6} className="bg-slate-50 px-4 py-1.5 text-xs font-semibold text-slate-600">
                    {T.audit.dayLabel(g.rows[0].min)}
                  </td>
                </tr>
                {g.rows.map((e) => {
                  const expandable = !!(e.change || e.facts);
                  const isOpen = open === e.id;
                  return (
                    <Fragment key={e.id}>
                      <tr
                        className={`border-b border-slate-100 ${fresh.has(e.id) ? "bg-brand-50/60" : ""} ${
                          expandable ? "cursor-pointer hover:bg-slate-50" : ""
                        }`}
                        onClick={expandable ? () => setOpen(isOpen ? null : e.id) : undefined}
                      >
                        <td className="px-2 py-2.5 text-center">
                          {expandable && (
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              aria-label={T.audit.details}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                setOpen(isOpen ? null : e.id);
                              }}
                              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-slate-400 outline-none hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500"
                            >
                              <IconChevronRight
                                size={15}
                                stroke={1.8}
                                className={`transition-transform motion-reduce:transition-none ${isOpen ? "rotate-90" : ""}`}
                              />
                            </button>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-slate-500" title={fmtDateTime(minutesAgoIso(e.min))}>
                          {fmtRelative(minutesAgoIso(e.min))}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="flex items-center gap-2">
                            {e.actor ? (
                              <Avatar name={e.actor} />
                            ) : (
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                                <IconRobot size={16} stroke={1.8} />
                              </span>
                            )}
                            <span className="whitespace-nowrap font-medium text-slate-800">{actorName(e)}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-slate-600">{auditAction(e)}</span>{" "}
                          {e.source !== "access" && <span className="font-medium text-slate-800">{e.subject}</span>}
                          <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{T.source[e.source]}</span>
                            {!e.recorded && (
                              <span
                                className="rounded border border-dashed border-amber-300 px-1.5 py-0.5 text-[11px] text-amber-800"
                                title={T.audit.notRecordedHint}
                              >
                                {T.audit.notRecorded}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">{e.team ?? ""}</td>
                        <td className="px-3 py-2.5 text-right">
                          <span
                            className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${
                              e.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                            }`}
                          >
                            {e.ok ? T.audit.ok : T.audit.failed}
                          </span>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-slate-100 bg-slate-50/60">
                          <td />
                          <td colSpan={5} className="px-3 py-3">
                            <Details e={e} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </PageFrame>
  );
}

function Details({ e }: { e: AuditEvent }) {
  return (
    <div className="flex flex-col gap-3">
      {e.change && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-slate-500">{T.auditFact[e.change.field] ?? e.change.field}</span>
          {e.change.field === "status" ? (
            <>
              <StatusBadge status={e.change.before} noSpin />
              <span className="text-slate-400">→</span>
              <StatusBadge status={e.change.after} noSpin />
            </>
          ) : (
            <>
              <code className="rounded bg-red-50 px-2 py-0.5 text-xs text-red-800 line-through decoration-red-300">{e.change.before}</code>
              <span className="text-slate-400">→</span>
              <code className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">{e.change.after}</code>
            </>
          )}
        </div>
      )}
      {e.facts && (
        <dl className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-3">
          {Object.entries(e.facts).map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-slate-500">{T.auditFact[k] ?? k}</dt>
              <dd className="text-sm text-slate-800">{T.factValue[v] ?? v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function Segmented<V extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: V;
  onChange: (v: V) => void;
  options: [V, string][];
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-slate-200 bg-surface p-0.5">
      {options.map(([v, text]) => (
        // biome-ignore lint/a11y/useSemanticElements: a segmented control, styled as one row of buttons
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`cursor-pointer rounded-md px-3 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
            value === v ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:text-slate-800"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

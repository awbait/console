import {
  IconArrowRight,
  IconCheck,
  IconRobot,
  IconSearch,
  IconTool,
  IconUserCheck,
  IconUserPlus,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Input, SearchField, TextArea, TextField } from "react-aria-components";
import { Link, useSearchParams } from "react-router-dom";
import { useToast } from "@/app/ToastContext";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, Card } from "@/components/ui";
import { Avatar } from "@/features/users/parts";
import { fmtRelative } from "@/lib/time";
import { byUrgency } from "./BoardPage";
import {
  ACTION_NEEDS_BACKEND,
  type ActionId,
  INCIDENTS,
  type Incident,
  type IncidentKind,
  type IncidentState,
  PEOPLE,
  type TimelineEntry,
} from "./data";
import { LiveBadge, minutesAgoIso, PageFrame, SEVERITY_TONE, SeverityChip, StateChip, useLive } from "./parts";
import { T } from "./text";

// Problems: everything that is broken right now, in one list, whatever the
// cause - an order, an upstream, a stand or a background loop. Today these
// live on four pages (support overview, status, stand page, order page) and
// only the order ones reach a person by notification.

const KINDS: (IncidentKind | "all")[] = ["all", "order", "integration", "stand", "loop"];
const STATES: IncidentState[] = ["open", "taken", "resolved"];

const pill = (on: boolean) =>
  `inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
    on ? "border-brand-300 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
  }`;

export function IncidentsPage() {
  const live = useLive(15000);
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  // Taking and closing a problem is page state in the demo; the real page
  // writes it to the incident record and to the audit trail.
  const [items, setItems] = useState<Incident[]>(INCIDENTS);
  const [kind, setKind] = useState<IncidentKind | "all">("all");
  const [state, setState] = useState<IncidentState>("open");
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<Record<string, string[]>>({});

  const counts = useMemo(
    () => Object.fromEntries(STATES.map((s) => [s, items.filter((i) => i.state === s).length])) as Record<IncidentState, number>,
    [items],
  );
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => i.state === state)
      .filter((i) => kind === "all" || i.kind === kind)
      .filter((i) => !q || [T.incident[i.id].title, i.team, i.service, i.stand].some((s) => s?.toLowerCase().includes(q)))
      .sort(byUrgency);
  }, [items, state, kind, query]);

  const selectedId = params.get("id") ?? shown[0]?.id;
  const selected = items.find((i) => i.id === selectedId);
  const select = (id: string) => setParams({ id }, { replace: true });

  const update = (id: string, patch: Partial<Incident>, entry: string) =>
    setItems((prev) =>
      prev.map((i) =>
        i.id === id ? { ...i, ...patch, timeline: [{ min: 0, actor: PEOPLE.oncall, code: entry }, ...i.timeline] } : i,
      ),
    );

  const runAction = (a: ActionId) =>
    ACTION_NEEDS_BACKEND.has(a) ? toast.error(T.incidents.actionMissing(T.action[a])) : toast.success(T.incidents.actionDone(T.action[a]));

  return (
    <PageFrame
      title={T.incidents.title}
      aside={<LiveBadge running={live.running} ago={live.ago} onToggle={() => live.setRunning(!live.running)} />}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label={T.incidents.statesLabel} className="inline-flex max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-surface p-0.5">
          {STATES.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={state === s}
              onClick={() => setState(s)}
              className={`cursor-pointer whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                state === s ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:text-slate-800"
              }`}
            >
              {T.state[s]} <span className="tabular-nums text-slate-400">{counts[s]}</span>
            </button>
          ))}
        </div>
        <SearchField value={query} onChange={setQuery} aria-label={T.incidents.search} className="relative w-full sm:w-80">
          <IconSearch size={15} stroke={1.8} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder={T.incidents.search}
            className="w-full rounded-md border border-slate-300 bg-surface py-1.5 pl-8 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          />
        </SearchField>
      </div>

      {/* biome-ignore lint/a11y/useSemanticElements: a row of filter pills, not a form section */}
      <div role="group" className="flex flex-wrap gap-2" aria-label={T.incidents.kindsLabel}>
        {KINDS.map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={pill(kind === k)}>
            {k === "all" ? T.incidents.allKinds : T.kind[k]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <ul className="flex flex-col self-start overflow-hidden rounded-lg border border-slate-200 bg-surface shadow-sm xl:col-span-2">
          {shown.length === 0 && <li className="px-4 py-10 text-center text-sm text-slate-500">{T.incidents.empty}</li>}
          {shown.map((i) => {
            const on = i.id === selected?.id;
            return (
              <li key={i.id} className="relative border-b border-slate-100 last:border-b-0">
                <span className={`absolute inset-y-0 left-0 w-1 ${SEVERITY_TONE[i.severity].rail}`} aria-hidden="true" />
                <button
                  type="button"
                  aria-current={on ? "true" : undefined}
                  onClick={() => select(i.id)}
                  className={`flex w-full cursor-pointer flex-col gap-1 py-3 pl-5 pr-4 text-left outline-none focus-visible:bg-brand-50 ${
                    on ? "bg-brand-50/70" : "hover:bg-slate-50"
                  }`}
                >
                  <span className="text-sm font-medium text-slate-800">{T.incident[i.id].title}</span>
                  <span className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                    <span>{T.kind[i.kind]}</span>
                    {i.team && <span>· {i.team}</span>}
                    {i.stand && <span>· {i.stand}</span>}
                    <span>· {T.incidents.openFor(i.min)}</span>
                  </span>
                  <span className="text-xs">
                    {i.owner ? (
                      <span className="inline-flex items-center gap-1 text-slate-600">
                        <IconUserCheck size={13} stroke={1.8} className="text-brand-500" />
                        {i.owner}
                      </span>
                    ) : (
                      i.state === "open" && <span className="text-red-600">{T.incidents.unowned}</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {selected ? (
          <Card className="flex flex-col gap-5 self-start xl:sticky xl:top-0 xl:col-span-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <SeverityChip severity={selected.severity} />
                  <StateChip state={selected.state} />
                  <span className="text-xs text-slate-500">{T.incidents.openFor(selected.min)}</span>
                </div>
                <h2 className="text-lg font-semibold text-slate-900">{T.incident[selected.id].title}</h2>
              </div>
              <div className="flex shrink-0 gap-2">
                {selected.state === "open" && (
                  <Button onPress={() => update(selected.id, { state: "taken", owner: PEOPLE.oncall }, "taken")}>
                    <IconUserPlus size={15} stroke={1.8} />
                    {T.incidents.take}
                  </Button>
                )}
                {selected.state !== "resolved" ? (
                  <Button variant="primary" onPress={() => update(selected.id, { state: "resolved", owner: selected.owner ?? PEOPLE.oncall }, "resolved")}>
                    <IconCheck size={15} stroke={2} />
                    {T.incidents.resolve}
                  </Button>
                ) : (
                  <Button onPress={() => update(selected.id, { state: "open" }, "reopened")}>{T.incidents.reopen}</Button>
                )}
              </div>
            </div>

            <p className="text-sm text-slate-700">{T.incident[selected.id].summary}</p>

            {(selected.team || selected.stand || selected.orderStatus) && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-md bg-slate-50 px-4 py-3 sm:grid-cols-4">
                {selected.service && <Fact label={T.incidents.factService} value={selected.service} />}
                {selected.team && <Fact label={T.incidents.factTeam} value={selected.team} />}
                {selected.stand && <Fact label={T.incidents.factStand} value={selected.stand} />}
                {selected.orderStatus && (
                  <div className="min-w-0">
                    <dt className="text-xs text-slate-500">{T.incidents.factStatus}</dt>
                    <dd className="mt-1">
                      <StatusBadge status={selected.orderStatus} noSpin />
                    </dd>
                  </div>
                )}
              </dl>
            )}

            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-800">{T.incidents.whatToDo}</h3>
              <div className="flex flex-wrap gap-2">
                {selected.actions.map((a, idx) =>
                  a === "open_order" && selected.orderId ? (
                    <Link
                      key={a}
                      to={`/requests/${selected.orderId}`}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm font-medium text-gray-800 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-brand-500"
                    >
                      {T.action[a]}
                      <IconArrowRight size={14} stroke={1.8} />
                    </Link>
                  ) : (
                    <Button key={a} variant={idx === 0 ? "primary" : "secondary"} onPress={() => runAction(a)}>
                      {T.action[a]}
                      {ACTION_NEEDS_BACKEND.has(a) && (
                        <IconTool size={14} stroke={1.8} className="opacity-70" aria-label={T.incidents.needsBackend} />
                      )}
                    </Button>
                  ),
                )}
              </div>
              {selected.actions.some((a) => ACTION_NEEDS_BACKEND.has(a)) && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                  <IconTool size={13} stroke={1.8} />
                  {T.incidents.needsBackend}
                </p>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-800">{T.incidents.timeline}</h3>
              <ol className="flex flex-col">
                {[
                  ...(notes[selected.id] ?? []).map((n): TimelineEntry & { note?: string } => ({
                    min: 0,
                    actor: PEOPLE.oncall,
                    code: "note",
                    note: n,
                  })),
                  ...(selected.timeline as (TimelineEntry & { note?: string })[]),
                ].map(
                  (e, idx) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: entries are append-only and carry no id
                    <li key={idx} className="flex gap-3 border-l border-slate-200 pb-3 pl-4 last:pb-0">
                      <span className="-ml-[25px] mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-surface">
                        {e.actor ? (
                          <span className="h-2 w-2 rounded-full bg-brand-500" />
                        ) : (
                          <IconRobot size={14} stroke={1.8} className="text-slate-400" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1 text-sm">
                        <span className="font-medium text-slate-800">{e.actor ?? T.audit.system}</span>{" "}
                        <span className="text-slate-600">{T.timeline[e.code] ?? e.code}</span>
                        {e.note && <p className="mt-1 rounded-md bg-slate-50 px-3 py-2 text-slate-700">{e.note}</p>}
                        <div className="text-xs text-slate-400">{fmtRelative(minutesAgoIso(e.min))}</div>
                      </div>
                    </li>
                  ),
                )}
              </ol>
            </section>

            <NoteBox key={selected.id} onSave={(n) => setNotes((prev) => ({ ...prev, [selected.id]: [n, ...(prev[selected.id] ?? [])] }))} />
          </Card>
        ) : (
          <div className="xl:col-span-3" />
        )}
      </div>
    </PageFrame>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 truncate font-mono text-sm text-slate-800">{value}</dd>
    </div>
  );
}

// NoteBox: a line for the next shift. Notes are what turns a list of alerts
// into a handover - the real page keeps them with the incident.
function NoteBox({ onSave }: { onSave: (note: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="flex items-start gap-3 border-t border-slate-100 pt-4">
      <Avatar name={PEOPLE.oncall} />
      <div className="flex flex-1 flex-col gap-2">
        <TextField value={text} onChange={setText} aria-label={T.incidents.notePlaceholder}>
          <TextArea
            rows={2}
            placeholder={T.incidents.notePlaceholder}
            className="w-full resize-none rounded-md border border-slate-300 bg-surface px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          />
        </TextField>
        <div>
          <Button
            isDisabled={!text.trim()}
            onPress={() => {
              onSave(text.trim());
              setText("");
            }}
          >
            {T.incidents.noteSave}
          </Button>
        </div>
      </div>
    </div>
  );
}

import {
  IconActivity,
  IconAlertTriangle,
  IconArrowRight,
  IconBox,
  IconChecklist,
  IconChevronRight,
  IconCircleCheck,
  IconCircleX,
  IconClick,
  IconLoader2,
  IconPackageOff,
  IconPlugConnectedX,
  IconServer,
  IconSettings,
  IconTool,
  IconUsers,
} from "@tabler/icons-react";
import { type ReactNode, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Page, PageBody } from "@/components/Page";
import { PageHeader } from "@/components/PageHeader";
import { Card, StatusPill } from "@/components/ui";
import { BoardTiles } from "@/features/board/BoardTiles";
import { Sparkline } from "@/features/board/Sparkline";
import {
  type AttentionItem,
  type AttentionKind,
  type ComponentState,
  type InProgressItem,
  stubSummary,
} from "@/features/board/stub";
import { boardText as t } from "@/features/board/text";
import { fmtRelative } from "@/lib/time";

// AdminBoardPage is the duty board (issue #469): the page that answers "do I
// have to do something right now, and what". Built on stub data while the
// summary endpoint is designed; it lives next to the overview until it replaces
// it.

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const dayMonth = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
const hourLabel = (iso: string) => `${new Date(iso).getHours()}:00`;

const KIND_ICON: Record<AttentionKind, typeof IconBox> = {
  order: IconBox,
  stand: IconServer,
  integration: IconPlugConnectedX,
  config: IconSettings,
  publication: IconPackageOff,
  maintenance: IconTool,
};

const STATE_PILL: Record<ComponentState, { tone: string; Icon: typeof IconCircleCheck }> = {
  ok: { tone: "bg-green-100 text-green-800", Icon: IconCircleCheck },
  degraded: { tone: "bg-amber-100 text-amber-800", Icon: IconAlertTriangle },
  down: { tone: "bg-red-100 text-red-800", Icon: IconCircleX },
};

export function AdminBoardPage() {
  const [empty, setEmpty] = useState(false);
  const [tiles, setTiles] = useState<"codex" | "mine">("codex");
  const data = useMemo(() => stubSummary(), []);
  const attention = empty ? [] : data.attention;

  return (
    <Page>
      <PageHeader title={t.title} description={t.draftNote} />

      <PageBody>
        {/* Draft-only switch between tile designs; goes away once one is chosen. */}
        <div className="-mb-5 flex gap-1 self-start rounded-lg bg-slate-100 p-0.5 text-xs">
          {(["codex", "mine"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setTiles(v)}
              className={`rounded-md px-2.5 py-1 font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                tiles === v ? "bg-surface text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {v === "codex" ? "Вариант codex" : "Вариант Claude"}
            </button>
          ))}
        </div>
        {tiles === "codex" ? (
          <BoardTiles tiles={data.tiles} />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile Icon={IconBox} label={t.tileOrders} value={data.tiles.orders.today} total={data.tiles.orders.total}>
              <Sparkline points={data.tiles.orders.series} label={t.tileOrdersSeries} format={dayMonth} />
            </Tile>
            <Tile Icon={IconClick} label={t.tileActions} value={data.tiles.actions.today}>
              <Sparkline points={data.tiles.actions.series} label={t.tileActionsSeries} format={dayMonth} />
            </Tile>
            <Tile Icon={IconUsers} label={t.tileUsers} value={data.tiles.users.today} total={data.tiles.users.total}>
              <Sparkline points={data.tiles.users.series} label={t.tileUsersSeries} format={dayMonth} />
            </Tile>
            <Tile Icon={IconActivity} label={t.tileOnline} value={data.tiles.online.now} live>
              <Sparkline points={data.tiles.online.series} kind="line" label={t.tileOnlineSeries} format={hourLabel} />
            </Tile>
          </div>
        )}

        <Section
          title={t.attentionTitle}
          aside={
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500">{t.checkedAt(hhmm(data.checkedAt))}</span>
              {/* Draft-only switch to look at the empty state; goes away with the stub. */}
              <button
                type="button"
                onClick={() => setEmpty(!empty)}
                className="rounded text-xs font-medium text-brand-600 outline-none hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {empty ? t.showProblems : t.showEmpty}
              </button>
            </div>
          }
          count={attention.length || undefined}
        >
          {attention.length ? <AttentionList items={attention} /> : <AllGood checkedAt={data.checkedAt} />}
        </Section>

        <div className="grid grid-cols-1 gap-8 xl:grid-cols-2 xl:gap-6">
          <Section title={t.statusTitle} aside={<MoreLink to="/admin/status">{t.statusMore}</MoreLink>}>
            <Card padded={false}>
              <ul className="divide-y divide-slate-100">
                {data.components.map((c) => {
                  const pill = STATE_PILL[c.state];
                  return (
                    <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-800">{c.name}</div>
                        <div className="truncate text-xs text-slate-500">{c.role}</div>
                      </div>
                      <StatusPill tone={pill.tone} Icon={pill.Icon} className="shrink-0">
                        {c.note}
                      </StatusPill>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </Section>

          <Section title={t.eventsTitle}>
            <Card padded={false}>
              <ol className="divide-y divide-slate-100">
                {data.events.map((e) => (
                  <li key={e.id} className="flex gap-3 px-4 py-2.5">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500">
                      {e.kind === "order" ? <IconBox size={15} stroke={1.8} /> : <IconChecklist size={15} stroke={1.8} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-slate-800">{e.text}</div>
                      <div className="truncate text-xs text-slate-500">{e.who}</div>
                    </div>
                    <time dateTime={e.at} className="shrink-0 pt-0.5 text-xs tabular-nums text-slate-500">
                      {hhmm(e.at)}
                    </time>
                  </li>
                ))}
              </ol>
            </Card>
          </Section>
        </div>

        <Section title={t.progressTitle} count={data.inProgress.length || undefined}>
          {data.inProgress.length ? (
            <Card padded={false}>
              <ul className="divide-y divide-slate-100">
                {data.inProgress.map((p) => (
                  <ProgressRow key={p.id} item={p} />
                ))}
              </ul>
            </Card>
          ) : (
            <Card>
              <p className="text-sm text-slate-500">{t.progressEmpty}</p>
            </Card>
          )}
        </Section>

        {data.queue.length > 0 && (
          <Section
            title={t.queueTitle}
            count={data.queue.length}
            aside={<MoreLink to="/admin/approvals">{t.queueAll}</MoreLink>}
          >
            <Card padded={false}>
              <ul className="divide-y divide-slate-100">
                {data.queue.map((q) => (
                  <li key={q.id} className="flex items-center gap-4 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-800">{q.service}</div>
                      <div className="text-xs text-slate-500">
                        {q.change} · {q.team}
                      </div>
                    </div>
                    <MoreLink to={q.to}>{t.queueReview}</MoreLink>
                  </li>
                ))}
              </ul>
            </Card>
          </Section>
        )}
      </PageBody>
    </Page>
  );
}

function Section({
  title,
  aside,
  count,
  children,
}: {
  title: string;
  aside?: ReactNode;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col">
      <div className="mb-3 flex min-h-7 items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          {title}
          {count !== undefined && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">
              {count}
            </span>
          )}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function MoreLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex shrink-0 items-center gap-1 rounded text-xs font-medium text-brand-600 outline-none hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      {children}
      <IconArrowRight size={14} stroke={1.8} />
    </Link>
  );
}

function Tile({
  Icon,
  label,
  value,
  total,
  live,
  children,
}: {
  Icon: typeof IconBox;
  label: string;
  value: number;
  total?: number;
  live?: boolean;
  children: ReactNode;
}) {
  // The chart runs along the bottom edge of the card, so the card clips it to
  // its rounded corners and only the top part is padded.
  return (
    <Card padded={false} className="flex flex-col overflow-hidden">
      <div className="flex flex-col gap-3 px-4 pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-slate-600">{label}</span>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Icon size={17} stroke={1.8} />
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <span className="text-3xl font-semibold leading-none text-slate-900">{value}</span>
            {live && (
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
              </span>
            )}
          </span>
          {total !== undefined && <span className="text-xs text-slate-500">{t.total(total)}</span>}
        </div>
      </div>
      <div className="mt-auto pt-3">{children}</div>
    </Card>
  );
}

function AttentionList({ items }: { items: AttentionItem[] }) {
  return (
    <Card padded={false} className="overflow-hidden">
      <ul className="divide-y divide-slate-100">
        {items.map((a) => {
          const KindIcon = KIND_ICON[a.kind];
          const critical = a.severity === "critical";
          return (
            <li key={a.id}>
              <Link
                to={a.to}
                className="group flex items-center gap-3 px-4 py-3 outline-none transition-colors duration-150 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    critical ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"
                  }`}
                >
                  <KindIcon size={18} stroke={1.8} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">{a.title}</span>
                    <StatusPill
                      tone={critical ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}
                      Icon={critical ? IconCircleX : IconAlertTriangle}
                    >
                      {critical ? t.severityCritical : t.severityWarning}
                    </StatusPill>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">{a.where}</div>
                </div>
                <time dateTime={a.since} className="shrink-0 text-xs text-slate-500" title={hhmm(a.since)}>
                  {fmtRelative(a.since)}
                </time>
                <IconChevronRight
                  size={16}
                  className="shrink-0 text-slate-300 transition-colors group-hover:text-slate-500"
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function AllGood({ checkedAt }: { checkedAt: string }) {
  return (
    <Card>
      <div className="flex items-center gap-3 py-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green-50 text-green-600">
          <IconCircleCheck size={20} stroke={1.8} />
        </span>
        <div>
          <div className="text-sm font-medium text-slate-800">{t.allGood}</div>
          <div className="text-xs text-slate-500">{t.allGoodHint(hhmm(checkedAt))}</div>
        </div>
      </div>
    </Card>
  );
}

function ProgressRow({ item }: { item: InProgressItem }) {
  const pct = item.progress ? Math.round((item.progress.done / item.progress.total) * 100) : null;
  return (
    <li className="grid grid-cols-1 items-center gap-x-6 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,16rem)_5rem]">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-600">
          {item.kind === "order" ? <IconBox size={15} stroke={1.8} /> : <IconServer size={15} stroke={1.8} />}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-800">{item.title}</div>
          <div className="truncate text-xs text-slate-500">{item.where}</div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-xs text-slate-600">
          {pct === null && <IconLoader2 size={13} className="animate-spin text-brand-500 motion-reduce:animate-none" />}
          {item.stage}
        </span>
        {pct !== null && item.progress && (
          <div className="flex items-center gap-2">
            <div
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-brand-100"
              role="progressbar"
              aria-valuenow={item.progress.done}
              aria-valuemin={0}
              aria-valuemax={item.progress.total}
              aria-label={item.title}
            >
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs tabular-nums text-slate-500">
              {item.progress.done} / {item.progress.total}
            </span>
          </div>
        )}
      </div>
      <time dateTime={item.startedAt} className="text-xs text-slate-500 sm:text-right">
        {fmtRelative(item.startedAt)}
      </time>
    </li>
  );
}

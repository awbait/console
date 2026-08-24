import {
  IconActivity,
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconChecklist,
  IconChevronDown,
  IconCircleCheck,
  IconClock,
  IconDots,
  IconFileText,
  IconGripVertical,
  IconLock,
  IconPackage,
  IconPencil,
  IconPlus,
  IconSettings,
  IconStack,
  IconTags,
  IconTrash,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button as AriaButton,
  Cell,
  Column,
  Dialog,
  DialogTrigger,
  Heading,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  ModalOverlay,
  Popover,
  Row,
  Table,
  TableBody,
  TableHeader,
} from "react-aria-components";
import { Link, Outlet, useNavigate, useParams } from "react-router-dom";
import { api, errorMessage, HttpError } from "../api/client";
import type {
  Category,
  ChartPublication,
  PendingVersion,
  PublicationStatus,
} from "../api/types";
import { chartLabel, findCatalogChart, useCatalog } from "../app/CatalogContext";
import { useToast } from "../app/ToastContext";
import { useTeamLabel, useUser } from "../auth/UserContext";
import { CATEGORY_ICON_CHOICES, categoryIcon, ProductIcon } from "../components/icons";
import { PublicationReview } from "../components/PublicationReview";
import { Button, Card, Chip, ErrorBox, Loading, SkeletonRows } from "../components/ui";
import { fieldMsg, ruPlural } from "../form/fieldErrors";
import { useAsync } from "../hooks/useAsync";

// ---------------------------------------------------------------------------
// shared visual bits (same language as the security section)
// ---------------------------------------------------------------------------

const TONE = {
  emerald: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-700",
  slate: "bg-slate-100 text-slate-600",
  brand: "bg-brand-50 text-brand-700",
} as const;
export type Tone = keyof typeof TONE;

const STATUS_META: Record<PublicationStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Черновик", tone: "slate" },
  PENDING: { label: "На согласовании", tone: "amber" },
  APPROVED: { label: "Согласовано", tone: "emerald" },
  REJECTED: { label: "Отклонено", tone: "red" },
};

// Aggregate status for display/filtering: the raw status stays DRAFT while
// approvals happen per version, so read the version-derived effective_status when
// the backend provides it.
const effStatus = (p: ChartPublication): PublicationStatus => p.effective_status ?? p.status;

function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

// StatCard is the section's one shape for a number worth looking at. Exported
// because the activity page counts different things in the same row of cards,
// and a second shape for the same job is how two admin pages stop looking like
// one product.
export function StatCard({
  label,
  value,
  tone,
  Icon,
}: {
  label: string;
  value: ReactNode;
  tone: Tone;
  Icon: typeof IconClock;
}) {
  return (
    <Card className="flex items-center gap-3">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${TONE[tone]}`}>
        <Icon size={20} stroke={1.8} />
      </span>
      <div className="min-w-0">
        <div className="text-2xl font-semibold leading-tight text-slate-900">{value}</div>
        <div className="truncate text-xs text-slate-500">{label}</div>
      </div>
    </Card>
  );
}

const managePath = (p: Pick<ChartPublication, "chart_project" | "chart_name">) =>
  `/catalog/${p.chart_project}/${p.chart_name}/manage`;
const reviewPath = (p: Pick<ChartPublication, "chart_project" | "chart_name">) =>
  `/admin/approvals/${p.chart_project}/${p.chart_name}`;
const versionReviewPath = (
  p: Pick<ChartPublication, "chart_project" | "chart_name">,
  version: string,
) => `${reviewPath(p)}/${version}`;

// Publications waiting on a metadata decision (category/owner). Counted off the
// stored status, NOT the effective one: the effective status also turns PENDING
// when any of the versions is pending, and those are counted separately - taking
// it here would report one submitted version as two things to review.
const metaPending = (p: ChartPublication) => p.status === "PENDING";

// ---------------------------------------------------------------------------
// section guard
// ---------------------------------------------------------------------------

// AdminSection guards the platform-admin area and renders the active sub-page.
// Mirrors SecuritySection: a thin role gate around <Outlet/>; the sidebar drives
// navigation between the section's pages.
export function AdminSection() {
  const { user } = useUser();
  if (user?.role !== "admin") {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Раздел доступен только администраторам платформы.
      </div>
    );
  }
  return <Outlet />;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

// How many queue rows the overview shows before sending the reader to the full
// queue. Enough to see what is waiting, short enough that the page stays a
// summary.
const OVERVIEW_QUEUE_ROWS = 5;

export function AdminOverviewPage() {
  const { data: pubs, error, loading } = useAsync(() => api.listPublications(), []);
  const { data: pendingVers } = useAsync(() => api.pendingVersions(), []);
  if (loading) return <SkeletonRows rows={5} />;
  if (error) return <ErrorBox error={error} />;

  const all = pubs ?? [];
  const queue = buildQueue(all, pendingVers ?? []);
  const published = all.filter((p) => effStatus(p) === "APPROVED").length;
  const drafts = all.filter((p) => effStatus(p) === "DRAFT" || effStatus(p) === "REJECTED").length;

  return (
    // Same shape as the rest of the admin section: the heading keeps its place
    // and only the sections below it scroll.
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="flex min-h-9 shrink-0 flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Администрирование платформы</h1>
        <Chip className="bg-brand-50 text-brand-700">
          <IconSettings size={13} stroke={1.8} className="text-brand-400" />
          Admin
        </Chip>
      </div>

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-1 pb-1">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Ждут решения" value={queue.length} tone="amber" Icon={IconClock} />
          <StatCard label="Опубликовано" value={published} tone="emerald" Icon={IconCircleCheck} />
          <StatCard label="Черновики" value={drafts} tone="slate" Icon={IconFileText} />
          <StatCard label="Всего публикаций" value={all.length} tone="brand" Icon={IconStack} />
        </div>

      <section className="flex flex-col">
        <div className="mb-3 flex min-h-9 items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-800">Очередь на согласование</h2>
          {queue.length > OVERVIEW_QUEUE_ROWS && (
            <Link
              to="/admin/approvals"
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 outline-none hover:text-brand-700 focus-visible:text-brand-700"
            >
              Все {queue.length}
              <IconArrowRight size={14} stroke={1.8} />
            </Link>
          )}
        </div>
        <QueueTable items={queue.slice(0, OVERVIEW_QUEUE_ROWS)} />
      </section>

      <section className="flex flex-col">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Разделы</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <QuickLink
            to="/admin/approvals"
            tone="amber"
            Icon={IconChecklist}
            title="Согласование публикаций"
            desc={
              queue.length > 0
                ? `${queue.length} ${ruPlural(queue.length, "решение", "решения", "решений")} ждёт`
                : "очередь пуста"
            }
          />
          <QuickLink
            to="/admin/users"
            tone="emerald"
            Icon={IconUsers}
            title="Пользователи"
            desc="кто пользуется порталом и что делает"
          />
          <QuickLink
            to="/admin/status"
            tone="brand"
            Icon={IconActivity}
            title="Состояние платформы"
            desc="интеграции, хранилища, циклы"
          />
          <QuickLink
            to="/admin/categories"
            tone="slate"
            Icon={IconTags}
            title="Категории каталога"
            desc="структура разделов каталога"
          />
        </div>
      </section>
      </div>
    </div>
  );
}

function QuickLink({
  to,
  tone,
  Icon,
  title,
  desc,
}: {
  to: string;
  tone: Tone;
  Icon: typeof IconClock;
  title: string;
  desc: string;
}) {
  return (
    <Link
      to={to}
      className="group flex items-center justify-between rounded-lg border border-slate-200 bg-surface p-4 shadow-sm outline-none hover:border-brand-300 hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <span className="flex items-center gap-3">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${TONE[tone]}`}>
          <Icon size={18} stroke={1.8} />
        </span>
        <span>
          <span className="block text-sm font-medium text-slate-800">{title}</span>
          <span className="block text-xs text-slate-500">{desc}</span>
        </span>
      </span>
      <IconArrowRight size={18} className="text-slate-300 group-hover:text-brand-500" />
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Approvals queue
// ---------------------------------------------------------------------------

const PUBLICATION_STATUSES: PublicationStatus[] = ["DRAFT", "PENDING", "APPROVED", "REJECTED"];

// StatusFilter: the portal's list filter, the same control the orders lists use
// - a pill that opens a checkbox menu, with the selected count on its face.
// Everything shown is the default; an empty selection shows nothing, which is
// what "I unticked them all" should mean.
function StatusFilter({
  shown,
  onChange,
}: {
  shown: Set<PublicationStatus>;
  onChange: (s: Set<PublicationStatus>) => void;
}) {
  return (
    <MenuTrigger>
      <AriaButton className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500">
        Статусы
        <span className="text-slate-400">
          {shown.size}/{PUBLICATION_STATUSES.length}
        </span>
        <IconChevronDown size={13} stroke={1.8} className="text-slate-400" />
      </AriaButton>
      <Popover className="rounded-md border border-slate-200 bg-surface py-1 shadow-lg outline-none entering:animate-in entering:fade-in">
        <Menu
          selectionMode="multiple"
          selectedKeys={shown}
          onSelectionChange={(keys) =>
            onChange(
              keys === "all"
                ? new Set(PUBLICATION_STATUSES)
                : new Set([...keys].map(String) as PublicationStatus[]),
            )
          }
          className="max-h-80 overflow-auto outline-none"
        >
          {PUBLICATION_STATUSES.map((s) => (
            <MenuItem
              key={s}
              id={s}
              textValue={STATUS_META[s].label}
              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm outline-none focus:bg-slate-50"
            >
              {({ isSelected }) => (
                <>
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      isSelected ? "border-brand-600 bg-brand-600 text-on-accent" : "border-slate-300"
                    }`}
                  >
                    {isSelected && <IconCheck size={12} stroke={3} />}
                  </span>
                  <Badge tone={STATUS_META[s].tone}>{STATUS_META[s].label}</Badge>
                </>
              )}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

// QueueItem is one decision waiting for the admin. Metadata changes and version
// submissions are different objects in the backend but the same job here - work
// to look at and resolve - so the queue is one list, not two blocks side by side
// that leave the reader adding up the total by hand.
type QueueItem = {
  key: string;
  kind: "meta" | "version";
  pub: ChartPublication;
  version?: string;
  to: string;
  since: string;
};

function buildQueue(pubs: ChartPublication[], pending: PendingVersion[]): QueueItem[] {
  const items: QueueItem[] = [
    ...pubs.filter(metaPending).map<QueueItem>((p) => ({
      key: `meta-${p.id}`,
      kind: "meta",
      pub: p,
      to: reviewPath(p),
      since: p.updated_at ?? "",
    })),
    ...pending.map<QueueItem>((pv) => ({
      key: `ver-${pv.version.id}`,
      kind: "version",
      pub: pv.publication,
      version: pv.version.chart_version,
      to: versionReviewPath(pv.publication, pv.version.chart_version),
      since: pv.version.updated_at,
    })),
  ];
  // Oldest first: the queue is worked from the top, and what has waited longest
  // is what someone is waiting on.
  return items.sort((a, b) => a.since.localeCompare(b.since));
}

// waitedFor renders how long an item has been sitting in the queue. Days matter
// here, minutes do not.
function waitedFor(iso: string): string {
  if (!iso) return "-";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (Number.isNaN(days)) return "-";
  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  return `${days} ${ruPlural(days, "день", "дня", "дней")} назад`;
}

export function AdminApprovalsPage() {
  const { data: pubs, error, loading, reload } = useAsync(() => api.listPublications(), []);
  const { data: pendingVers } = useAsync(() => api.pendingVersions(), []);
  const [shown, setShown] = useState<Set<PublicationStatus>>(new Set(PUBLICATION_STATUSES));

  if (loading) return <SkeletonRows rows={5} />;
  if (error) return <ErrorBox error={error} />;

  const all = pubs ?? [];
  const queue = buildQueue(all, pendingVers ?? []);
  const rows = all.filter((p) => shown.has(effStatus(p)));
  const filtersDefault = shown.size === PUBLICATION_STATUSES.length;

  return (
    // The page stays within the viewport and only the lists below scroll, so
    // the title and the pending count are still there after scrolling to the
    // bottom of a long table. Same shape as the platform status page.
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="flex min-h-9 shrink-0 flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Согласование публикаций</h1>
        {queue.length > 0 && (
          <Chip className="bg-amber-50 text-amber-700">
            <IconClock size={13} stroke={1.8} className="text-amber-500" />
            {queue.length} {ruPlural(queue.length, "решение", "решения", "решений")} ждёт
          </Chip>
        )}
      </div>

      {/* The scroll box: -mx-1/px-1 gives the cards' shadows and focus rings the
          room the clipping edge would otherwise cut off. */}
      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-1 pb-1">
        <section className="flex flex-col">
          <QueueTable items={queue} />
        </section>

        <section className="flex flex-col">
          <div className="mb-3 flex min-h-9 items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-800">Все публикации</h2>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <StatusFilter shown={shown} onChange={setShown} />
            {!filtersDefault && (
              <button
                type="button"
                onClick={() => setShown(new Set(PUBLICATION_STATUSES))}
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <IconX size={13} stroke={2} />
                Сбросить
              </button>
            )}
          </div>

          {/* No overflow-hidden here: it would make this box the scroll container
              and the sticky header below would have nothing to stick to. The
              header rounds its own top corners instead. */}
          <div className="rounded-lg border border-slate-200 bg-surface shadow-sm">
            <Table aria-label="Публикации" className="w-full text-sm">
              {/* Pinned to the top of the scroll box: the list runs past a
                  screenful, and a table whose columns have scrolled out of sight
                  is read by guesswork. -top-1 covers that box's own 4px padding,
                  which would otherwise show a sliver of the rows passing beneath.
                  The middle columns drop out on narrow screens rather than the
                  table growing a horizontal scrollbar. */}
              <TableHeader className="sticky -top-1 z-10 border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500 [&_th:first-child]:rounded-tl-lg [&_th:last-child]:rounded-tr-lg">
                <Column isRowHeader className="px-4 py-2.5 text-left">
                  Сервис
                </Column>
                <Column className="hidden px-4 py-2.5 text-left lg:table-cell">Категория</Column>
                <Column className="hidden px-4 py-2.5 text-left md:table-cell">Владелец</Column>
                <Column className="px-4 py-2.5 text-left">В каталоге</Column>
                <Column className="hidden px-4 py-2.5 text-left lg:table-cell">Изменена</Column>
                <Column className="px-4 py-2.5 text-center">Статус</Column>
                <Column className="px-4 py-2.5 text-right">
                  <span className="sr-only">Действия</span>
                </Column>
              </TableHeader>
              <TableBody
                renderEmptyState={() => (
                  <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                      <IconChecklist size={24} stroke={1.6} />
                    </span>
                    <p className="text-sm text-slate-500">Публикаций в этой категории нет.</p>
                  </div>
                )}
              >
                {rows.map((p) => (
                  <PublicationRow key={p.id} pub={p} onChanged={reload} />
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>
    </div>
  );
}

// QueueTable renders the decision queue. Shared by the overview (top rows) and
// the approvals page (all of them) so the two never drift into two designs for
// the same list.
function QueueTable({ items }: { items: QueueItem[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-surface shadow-sm">
      <Table aria-label="Очередь на согласование" className="w-full text-sm">
        {/* Not pinned: the queue is a handful of rows and its empty state is a
            card - a sticky header there just eats the block as it scrolls. */}
        <TableHeader className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
          <Column className="px-4 py-2.5 text-left">Что решаем</Column>
          <Column isRowHeader className="px-4 py-2.5 text-left">
            Сервис
          </Column>
          <Column className="px-4 py-2.5 text-left">Владелец</Column>
          <Column className="px-4 py-2.5 text-right">В очереди</Column>
        </TableHeader>
        <TableBody
          renderEmptyState={() => (
            <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <IconCircleCheck size={24} stroke={1.6} />
              </span>
              <p className="text-sm text-slate-500">Всё решено, очередь пуста.</p>
            </div>
          )}
        >
          {items.map((item) => (
            <QueueRow key={item.key} item={item} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// QueueRow: one decision. The whole row navigates, like the orders table.
function QueueRow({ item }: { item: QueueItem }) {
  const navigate = useNavigate();
  const teamLabel = useTeamLabel();
  const p = item.pub;
  return (
    <Row
      onAction={() => navigate(item.to)}
      className="cursor-pointer border-b border-slate-100 outline-none last:border-0 hover:bg-slate-50 focus-visible:bg-slate-50"
    >
      <Cell className="px-4 py-3 text-left">
        {item.kind === "version" ? (
          <Chip className="bg-amber-50 text-amber-700">
            <IconPackage size={13} stroke={1.8} className="text-amber-500" />
            Версия {item.version}
          </Chip>
        ) : (
          <Chip className="bg-slate-100 text-slate-600">
            <IconPencil size={13} stroke={1.8} className="text-slate-400" />
            Категория и владелец
          </Chip>
        )}
      </Cell>
      <Cell className="px-4 py-3 text-left">
        <span className="flex items-center gap-2 font-medium text-slate-800">
          <ProductIcon project={p.chart_project} name={p.chart_name} />
          {chartLabel(p.chart_name)}
        </span>
        <span className="mt-0.5 block truncate text-xs text-slate-400">
          {p.chart_project}/{p.chart_name}
        </span>
      </Cell>
      <Cell className="px-4 py-3 text-left text-slate-600">{teamLabel(p.owner_team)}</Cell>
      <Cell className="px-4 py-3 text-right text-slate-500">{waitedFor(item.since)}</Cell>
    </Row>
  );
}

// PublicationRow: the reference list below the queue - where a service stands,
// with a way into it. Nothing here is waiting on the reader.
function PublicationRow({ pub, onChanged }: { pub: ChartPublication; onChanged: () => void }) {
  const navigate = useNavigate();
  const { user } = useUser();
  const teamLabel = useTeamLabel();
  const { charts, reload: reloadCatalog } = useCatalog();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const status = effStatus(pub);
  const st = STATUS_META[status];
  const to = status === "PENDING" ? reviewPath(pub) : managePath(pub);
  const catalogPub = findCatalogChart(charts, pub.chart_project, pub.chart_name)?.publication;
  // Approved, and still not in the catalog, because the registry has lost the
  // versions it was approved for. Without this the row says "Согласовано" next
  // to an empty catalog column and looks like an oversight.
  const gone = catalogPub?.gone_versions ?? [];
  const orderable = catalogPub?.orderable_versions ?? [];
  // Only the metadata decision is made from here. A version submission is
  // decided on its own page, where the document sits next to the form it
  // produces - deciding that from a row is what the queue used to ask for.
  const canApproveMeta = user?.role === "admin" && pub.status === "PENDING";

  async function approve() {
    setBusy(true);
    try {
      await api.approvePublication(pub.id);
      toast.success(`${chartLabel(pub.chart_name)}: категория и владелец согласованы`);
      onChanged();
      reloadCatalog();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Row
      onAction={() => navigate(to)}
      className="cursor-pointer border-b border-slate-100 outline-none last:border-0 hover:bg-slate-50 focus-visible:bg-slate-50"
    >
      <Cell className="px-4 py-3 text-left">
        <span className="flex items-center gap-2 font-medium text-slate-800">
          <ProductIcon project={pub.chart_project} name={pub.chart_name} />
          {chartLabel(pub.chart_name)}
        </span>
        <span className="mt-0.5 block truncate text-xs text-slate-400">
          {pub.chart_project}/{pub.chart_name}
        </span>
      </Cell>
      <Cell className="hidden px-4 py-3 text-left lg:table-cell">
        <CategoryChip id={pub.category_id} />
      </Cell>
      <Cell className="hidden px-4 py-3 text-left text-slate-600 md:table-cell">
        {teamLabel(pub.owner_team)}
      </Cell>
      {/* What a user can order right now. Empty means nothing is orderable yet,
          which "Согласовано" alone does not tell you: the metadata can be
          approved while every version is still a draft - or while the registry
          has lost the ones that were approved. */}
      <Cell className="px-4 py-3 text-left">
        {gone.length > 0 ? (
          <span
            className="inline-flex items-center gap-1.5"
            title={`Заказ закрыт, пока версия не вернётся в реестр. Пропали: ${gone.join(", ")}`}
          >
            <Chip className="bg-red-50 font-mono text-red-700">v{gone[0]}</Chip>
            <span className="text-xs text-red-600">
              нет в реестре{gone.length > 1 ? ` +${gone.length - 1}` : ""}
            </span>
          </span>
        ) : orderable.length > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <Chip className="bg-slate-100 font-mono text-slate-600">v{orderable[0]}</Chip>
            {orderable.length > 1 && (
              <span
                className="text-xs text-slate-400"
                title={`Все версии в каталоге: ${orderable.join(", ")}`}
              >
                +{orderable.length - 1}
              </span>
            )}
          </span>
        ) : (
          <span className="text-slate-300">-</span>
        )}
      </Cell>
      <Cell className="hidden px-4 py-3 text-left text-slate-500 lg:table-cell">
        {waitedFor(pub.updated_at ?? "")}
      </Cell>
      <Cell className="px-4 py-3 text-center">
        <Badge tone={st.tone}>{st.label}</Badge>
      </Cell>
      <Cell className="px-4 py-3 text-right">
        <PublicationRowActions
          busy={busy}
          canApproveMeta={canApproveMeta}
          onOpen={() => navigate(managePath(pub))}
          onReview={status === "PENDING" ? () => navigate(reviewPath(pub)) : undefined}
          onApprove={canApproveMeta ? approve : undefined}
        />
      </Cell>
    </Row>
  );
}

// CategoryChip names the catalog section a service sits in, or says it has
// none - "uncategorized" is a real state here, not missing data.
function CategoryChip({ id }: { id?: string }) {
  const { data: cats } = useAsync(() => api.listCategories(), []);
  const label = (cats ?? []).find((c) => c.id === id)?.label;
  if (!label) return <span className="text-xs text-slate-400">без категории</span>;
  return <Chip className="bg-slate-100 text-slate-600">{label}</Chip>;
}

// PublicationRowActions: the decisions that can be made without leaving the
// list. Everything that needs a document in front of the reader (a version, a
// rejection with a reason) opens its page instead.
function PublicationRowActions({
  busy,
  canApproveMeta,
  onOpen,
  onReview,
  onApprove,
}: {
  busy: boolean;
  canApproveMeta: boolean;
  onOpen: () => void;
  onReview?: () => void;
  onApprove?: () => void;
}) {
  return (
    <MenuTrigger>
      <AriaButton
        aria-label="Действия"
        isDisabled={busy}
        className="inline-flex rounded-md p-1 text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
      >
        <IconDots size={18} stroke={1.7} />
      </AriaButton>
      <Popover className="min-w-48 rounded-md border border-slate-200 bg-surface py-1 shadow-lg outline-none entering:animate-in entering:fade-in">
        <Menu
          className="outline-none"
          onAction={(key) => {
            if (key === "open") onOpen();
            else if (key === "review") onReview?.();
            else if (key === "approve") onApprove?.();
          }}
        >
          <MenuItem
            id="open"
            className="cursor-pointer px-3 py-1.5 text-sm text-slate-700 outline-none focus:bg-slate-50"
          >
            Управление сервисом
          </MenuItem>
          {onReview && (
            <MenuItem
              id="review"
              className="cursor-pointer px-3 py-1.5 text-sm text-slate-700 outline-none focus:bg-slate-50"
            >
              Открыть согласование
            </MenuItem>
          )}
          {canApproveMeta && onApprove && (
            <MenuItem
              id="approve"
              className="cursor-pointer px-3 py-1.5 text-sm text-emerald-700 outline-none focus:bg-emerald-50"
            >
              Согласовать категорию и владельца
            </MenuItem>
          )}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

// ---------------------------------------------------------------------------
// Approval detail (one publication)
// ---------------------------------------------------------------------------

// AdminApprovalDetailPage is the dedicated review screen for a single pending
// publication: header + the PublicationReview decision surface. Non-pending
// publications have nothing to decide, so it points to the manage page instead.
export function AdminApprovalDetailPage() {
  const { project = "", name = "" } = useParams();
  const teamLabel = useTeamLabel();
  const {
    data: pub,
    loading,
    error,
    reload,
  } = useAsync(
    () => api.listPublications({ chart: name }).then((l) => l.find((p) => p.chart_project === project) ?? null),
    [project, name],
  );
  // Pending versions of this chart (each is decided on its own page).
  const { data: versions } = useAsync(
    () => (pub ? api.listVersions(pub.id) : Promise.resolve([])),
    [pub?.id],
  );
  const pendingVersions = (versions ?? []).filter((v) => v.status === "PENDING");

  const back = (
    <Link
      to="/admin/approvals"
      className="inline-flex w-fit items-center gap-1 text-sm text-slate-500 outline-none hover:text-slate-700 focus-visible:text-brand-600"
    >
      <IconArrowLeft size={16} stroke={1.8} /> Согласование публикаций
    </Link>
  );

  if (loading && !pub) return <Loading label="Загружаем публикацию" />;
  if (error && !pub) return <ErrorBox error={error} />;
  if (!pub) {
    return (
      <div className="flex flex-col gap-5">
        {back}
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Публикация {project}/{name} не найдена.
        </div>
      </div>
    );
  }

  const st = STATUS_META[effStatus(pub)];
  return (
    <div className="flex flex-col gap-5">
      {back}
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          <IconPackage size={20} stroke={1.8} />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-slate-900">{chartLabel(pub.chart_name)}</h1>
          <p className="truncate text-xs text-slate-400">
            {pub.chart_project}/{pub.chart_name}
          </p>
        </div>
        <Badge tone={st.tone}>{st.label}</Badge>
        <Badge tone="brand">{teamLabel(pub.owner_team)}</Badge>
      </div>

      {/* Metadata (category/owner) approval, if any. */}
      {pub.status === "PENDING" && <PublicationReview pub={pub} onReviewed={reload} />}
      {/* Version submissions are decided on their own page, where the document
          sits next to a preview of the form it produces. Deciding from a list,
          without seeing that form, is what this used to ask of the reviewer. */}
      {pendingVersions.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-amber-200 bg-surface shadow-sm">
          <div className="border-b border-amber-100 bg-amber-50/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-amber-800">
            Версии на согласовании
          </div>
          <ul className="flex flex-col">
            {pendingVersions.map((v) => (
              <li key={v.id} className="border-b border-slate-100 last:border-0">
                <Link
                  to={versionReviewPath(pub, v.chart_version)}
                  className="group flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                      <IconPackage size={16} stroke={1.8} />
                    </span>
                    <span className="font-medium text-slate-800">v{v.chart_version}</span>
                  </span>
                  <IconArrowRight size={14} className="text-slate-300 group-hover:text-brand-500" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {pub.status !== "PENDING" && pendingVersions.length === 0 && (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
          <p className="text-sm text-slate-600">
            Эта публикация не находится на согласовании, решать нечего. Открыть редактор публикации:
          </p>
          <Link
            to={managePath(pub)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-surface px-2.5 py-1 text-xs font-medium text-slate-600 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <IconPencil size={14} stroke={1.8} /> Открыть управление
          </Link>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

// Russian plural for "чарт".
function chartsWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "чарт";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "чарта";
  return "чартов";
}

export function AdminCategoriesPage() {
  const { categories, charts, reload } = useCatalog();
  const [order, setOrder] = useState<Category[]>(categories);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dragId = useRef<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // Re-sync local order when the catalog's category set changes (add/remove),
  // keyed by the id list so an in-flight reorder/edit is not clobbered on every
  // render.
  const sig = categories.map((c) => c.id).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: resync on set change only
  useEffect(() => setOrder(categories), [sig]);

  // Charts per category: drives the "can't delete a non-empty category" guard.
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of charts) {
      const id = c.publication?.category_id;
      if (id) m[id] = (m[id] ?? 0) + 1;
    }
    return m;
  }, [charts]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setErr(e instanceof HttpError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Drop the dragged row before the target: renumber sort (10,20,...) and
  // persist only the rows whose position actually changed.
  function onDropOn(targetId: string) {
    const fromId = dragId.current;
    dragId.current = null;
    setOverId(null);
    if (!fromId || fromId === targetId) return;
    const cur = [...order];
    const from = cur.findIndex((c) => c.id === fromId);
    const to = cur.findIndex((c) => c.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = cur.splice(from, 1);
    cur.splice(to, 0, moved);
    const renum = cur.map((c, i) => ({ ...c, sort: (i + 1) * 10 }));
    const prev = order;
    setOrder(renum); // optimistic
    run(async () => {
      for (const c of renum) {
        if (prev.find((o) => o.id === c.id)?.sort !== c.sort) await api.updateCategory(c);
      }
    });
  }

  return (
    // Same shape as the rest of the admin section: the heading keeps its place
    // and only the list below it scrolls.
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold">Категории каталога</h1>
        <p className="mt-1 text-sm text-slate-500">
          Перетаскивайте за ручку для порядка, кликните иконку чтобы сменить. Название и порядок
          сохраняются автоматически.
        </p>
      </div>

      {err && <ErrorBox error={new Error(err)} />}

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1 pb-1">
      <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-surface shadow-sm">
        {order.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">Категорий нет. Добавьте первую ниже.</p>
        ) : (
          order.map((c) => (
            <CategoryRow
              key={c.id}
              category={c}
              count={counts[c.id] ?? 0}
              busy={busy}
              over={overId === c.id}
              onDragStart={() => {
                dragId.current = c.id;
              }}
              onDragOver={() => setOverId(c.id)}
              onDrop={() => onDropOn(c.id)}
              onRename={(label) => run(() => api.updateCategory({ ...c, label }))}
              onIcon={(icon) =>
                run(async () => {
                  // Optimistic: the resync effect only fires when the id set
                  // changes, so push the new icon into local order ourselves -
                  // otherwise the row keeps rendering the stale icon until reload.
                  setOrder((prev) => prev.map((o) => (o.id === c.id ? { ...o, icon } : o)));
                  await api.updateCategory({ ...c, icon });
                })
              }
              onDelete={() => run(() => api.deleteCategory(c.id))}
            />
          ))
        )}
      </div>

      <AddCategory busy={busy} run={run} />
      </div>
    </div>
  );
}

function CategoryRow({
  category,
  count,
  busy,
  over,
  onDragStart,
  onDragOver,
  onDrop,
  onRename,
  onIcon,
  onDelete,
}: {
  category: Category;
  count: number;
  busy: boolean;
  over: boolean;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onRename: (label: string) => void;
  onIcon: (icon: string) => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState(category.label);
  useEffect(() => setLabel(category.label), [category.label]);

  function saveLabel() {
    const v = label.trim();
    if (v && v !== category.label) onRename(v);
    else if (!v) setLabel(category.label); // revert empty edit
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: native HTML5 drag-and-drop reorder (admin-only)
    <div
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      className={`flex items-center gap-3 px-3 py-2.5 ${over ? "bg-brand-50/60" : "hover:bg-slate-50"}`}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: native drag handle */}
      <span
        draggable
        onDragStart={onDragStart}
        title="Перетащить для изменения порядка"
        className="flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded text-slate-300 hover:text-slate-500 active:cursor-grabbing"
      >
        <IconGripVertical size={18} stroke={1.7} />
      </span>

      <IconPicker value={category.icon} disabled={busy} onPick={onIcon} />

      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <input
          value={label}
          disabled={busy}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={saveLabel}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          aria-label="Название категории"
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-slate-800 outline-none hover:border-slate-200 focus:border-brand-500 focus:bg-surface focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
        />
        <span className="shrink-0 font-mono text-[11px] text-slate-400">{category.id}</span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {category.system && (
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-400">
            <IconLock size={11} stroke={2} />
            системная
          </span>
        )}
        {count > 0 && (
          <span
            title={`${count} ${chartsWord(count)} в категории`}
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500"
          >
            <IconPackage size={11} stroke={2} />
            {count}
          </span>
        )}
      </div>

      <DeleteCategoryButton
        deletable={!category.system && count === 0}
        system={!!category.system}
        count={count}
        label={category.label}
        onConfirm={onDelete}
      />
    </div>
  );
}

// IconPicker: a tile showing the current icon; clicking opens a palette popover.
function IconPicker({
  value,
  disabled,
  onPick,
}: {
  value?: string;
  disabled?: boolean;
  onPick: (icon: string) => void;
}) {
  const Current = categoryIcon(value ?? "");
  return (
    <DialogTrigger>
      <AriaButton
        isDisabled={disabled}
        aria-label="Сменить иконку"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 outline-none hover:border-brand-300 hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
      >
        <Current size={18} stroke={1.8} />
      </AriaButton>
      <Popover className="rounded-md border border-slate-200 bg-surface p-2 shadow-lg outline-none entering:animate-in entering:fade-in">
        <Dialog className="outline-none" aria-label="Выбор иконки">
          {({ close }) => (
            <div className="grid grid-cols-5 gap-1">
              {CATEGORY_ICON_CHOICES.map(({ id, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    onPick(id);
                    close();
                  }}
                  aria-label={id}
                  className={`flex h-9 w-9 items-center justify-center rounded-md outline-none hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500 ${
                    value === id ? "bg-brand-50 text-brand-700 ring-1 ring-brand-200" : "text-slate-600"
                  }`}
                >
                  <Icon size={18} stroke={1.8} />
                </button>
              ))}
            </div>
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

// DeleteCategoryButton: a trash control that asks for confirmation in a modal.
// Disabled (with a reason) for the system category or one that still has charts.
function DeleteCategoryButton({
  deletable,
  system,
  count,
  label,
  onConfirm,
}: {
  deletable: boolean;
  system: boolean;
  count: number;
  label: string;
  onConfirm: () => void;
}) {
  if (!deletable) {
    const title = system
      ? "Системную категорию нельзя удалить"
      : `Нельзя удалить: в категории ${count} ${chartsWord(count)}`;
    return (
      <span
        title={title}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-200"
      >
        <IconTrash size={16} stroke={1.8} />
      </span>
    );
  }
  return (
    <DialogTrigger>
      <AriaButton
        aria-label="Удалить категорию"
        // impeccable-disable-next-line gray-on-color: the red background only appears on hover, and it comes with red-600 text
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 outline-none hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-red-500"
      >
        <IconTrash size={16} stroke={1.8} />
      </AriaButton>
      <ModalOverlay
        isDismissable
        className="fixed inset-0 z-10 flex items-start justify-center scrim p-4 pt-24 entering:animate-in entering:fade-in"
      >
        <Modal className="w-full max-w-md rounded-lg border border-slate-200 bg-surface shadow-xl">
          <Dialog className="outline-none">
            {({ close }) => (
              <div className="flex flex-col gap-4 p-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-500">
                    <IconTrash size={20} stroke={1.8} />
                  </span>
                  <div>
                    <Heading slot="title" className="text-base font-semibold text-slate-800">
                      Удалить категорию?
                    </Heading>
                    <p className="mt-1 text-sm text-slate-600">
                      Категория «{label}» будет удалена без возможности восстановления.
                    </p>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button onPress={close}>Отмена</Button>
                  <Button
                    variant="danger"
                    onPress={() => {
                      onConfirm();
                      close();
                    }}
                  >
                    Удалить
                  </Button>
                </div>
              </div>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

// slugify derives a url-safe id from a label (latin letters/digits only). For a
// non-latin label it yields "", so the admin types the slug explicitly.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// A slug must be a url-safe id: lowercase latin/digits in single-dash groups,
// and carry at least SLUG_MIN_LETTERS letters so it stays readable (digits alone
// are not a meaningful id).
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MIN_LETTERS = 2;

// slugError returns a human message for an invalid slug, or null when it is valid
// (or empty - emptiness is handled by disabling the button, not by an error).
function slugError(id: string): string | null {
  if (!id) return null;
  if (!SLUG_RE.test(id)) return fieldMsg.charset;
  if ((id.match(/[a-z]/g)?.length ?? 0) < SLUG_MIN_LETTERS)
    return `Добавьте хотя бы ${SLUG_MIN_LETTERS} латинские буквы.`;
  return null;
}

// AddCategory: a single inline row matching the list style. The slug is
// auto-suggested from the name until the admin edits it; new categories land at
// the end with the chosen icon, then are editable inline above.
function AddCategory({ busy, run }: { busy: boolean; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [label, setLabel] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [icon, setIcon] = useState("box");
  const id = (slugTouched ? slug : slugify(label)).trim();
  const slugErr = slugError(id);
  // Only surface the message once the admin has typed into the slug field; while
  // it is still auto-derived from the name we just disable the button.
  const showSlugErr = slugTouched && !!slug.trim() && !!slugErr;
  const canAdd = !busy && !!label.trim() && !slugErr && !!id;

  function reset() {
    setLabel("");
    setSlug("");
    setSlugTouched(false);
    setIcon("box");
  }
  function add() {
    if (!canAdd) return;
    run(() => api.createCategory({ id, label: label.trim(), sort: 999, icon })).then(reset);
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-surface px-3 py-2.5">
      <span className="h-7 w-7 shrink-0" aria-hidden />
      <IconPicker value={icon} disabled={busy} onPick={setIcon} />
      <input
        value={label}
        disabled={busy}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
        }}
        placeholder="Название новой категории"
        aria-label="Название новой категории"
        className="h-[30px] min-w-0 flex-1 rounded-md border border-slate-200 bg-transparent px-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
      />
      <div className="relative shrink-0">
        <input
          value={slugTouched ? slug : id}
          disabled={busy}
          onChange={(e) => {
            setSlug(e.target.value);
            setSlugTouched(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="slug"
          aria-label="Идентификатор (slug)"
          aria-invalid={showSlugErr}
          className={`h-[30px] w-32 rounded-md border bg-transparent px-2.5 font-mono text-[11px] text-slate-600 outline-none placeholder:text-slate-400 focus:ring-1 disabled:opacity-50 ${
            showSlugErr
              ? "border-red-400 focus:border-red-500 focus:ring-red-500"
              : "border-slate-200 focus:border-brand-500 focus:ring-brand-500"
          }`}
        />
        {showSlugErr && (
          <div
            role="alert"
            className="absolute bottom-full right-0 z-20 mb-2 w-56 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs leading-snug text-red-700 shadow-md"
          >
            <div className="flex items-start gap-1.5">
              <IconAlertTriangle size={14} stroke={2} className="mt-px shrink-0" />
              <span>{slugErr}</span>
            </div>
            <span className="absolute right-6 top-full h-2 w-2 -translate-y-1/2 rotate-45 border-b border-r border-red-200 bg-red-50" />
          </div>
        )}
      </div>
      <AriaButton
        isDisabled={!canAdd}
        onPress={add}
        aria-label="Добавить категорию"
        className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md bg-brand-600 text-on-accent outline-none hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-40"
      >
        <IconPlus size={16} stroke={2} />
      </AriaButton>
    </div>
  );
}

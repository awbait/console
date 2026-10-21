import {
  IconAlertTriangle,
  IconArrowRight,
  IconCheck,
  IconCircleCheck,
  IconClock,
  IconDots,
  IconPackage,
  IconPencil,
  IconSearch,
  IconUser,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import {
  Button as AriaButton,
  Cell,
  Column,
  Input,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Row,
  SearchField,
  Table,
  TableBody,
  TableHeader,
} from "react-aria-components";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, errorMessage } from "@/api/client";
import { qk } from "@/api/queryKeys";
import type { ChartPublication, PendingVersion, PublicationStatus, RegistryRow } from "@/api/types";
import { chartLabel, useCatalog } from "@/app/CatalogContext";
import { useToast } from "@/app/ToastContext";
import { useTeamLabel } from "@/auth/UserContext";
import { FormDialogShell } from "@/components/FormDialogShell";
import { FormErrors } from "@/components/FormErrors";
import { ProductIcon } from "@/components/icons";
import { Page, PageBody } from "@/components/Page";
import { PageHeader } from "@/components/PageHeader";
import { SearchFilter } from "@/components/SearchFilter";
import { Button, Card, Chip, ErrorBox, Hint, Loading, SkeletonRows, StatusPill } from "@/components/ui";
import { registryText as t } from "@/features/publications/registryText";
import { useAsync } from "@/hooks/useAsync";

// AdminPublicationsPage is the admin's view of every publication (issue #470):
// the decisions waiting on them at the top, the registry of all publications
// below. The rows come assembled from the server (GET /admin/publications),
// the queue from the pending versions and the rows under metadata review.
//
// A decision on a version is a page of its own (VersionApprovalPage): the
// reviewer has to see the order form the document produces. A decision on a
// publication's category and owner is two values and a comment, so it is a
// panel here, opened from the queue or by ?meta=project/name, which is what
// the old decision page's address forwards to (ApprovalRedirectPage).

const managePath = (p: Pick<ChartPublication, "chart_project" | "chart_name">) =>
  `/catalog/${p.chart_project}/${p.chart_name}/manage`;
const catalogPath = (p: Pick<ChartPublication, "chart_project" | "chart_name">) =>
  `/catalog/${p.chart_project}/${p.chart_name}`;
const versionPath = (p: Pick<ChartPublication, "chart_project" | "chart_name">, version: string) =>
  `/admin/approvals/${p.chart_project}/${p.chart_name}/${version}`;
const ordersPath = (p: Pick<ChartPublication, "chart_name">) =>
  `/admin/requests?product=${encodeURIComponent(p.chart_name)}`;
const metaKey = (p: Pick<ChartPublication, "chart_project" | "chart_name">) =>
  `${p.chart_project}/${p.chart_name}`;

const STATUSES: PublicationStatus[] = ["DRAFT", "PENDING", "APPROVED", "REJECTED"];
const STATUS_TONE: Record<PublicationStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  PENDING: "bg-amber-50 text-amber-700",
  APPROVED: "bg-emerald-50 text-emerald-700",
  REJECTED: "bg-red-50 text-red-700",
};
// Problems are red when nothing can be ordered because of them, amber when
// somebody has to act or something is on its way out, neutral when the
// publication is simply not there yet.
const ISSUE_TONE: Record<string, string> = {
  chart_missing: "bg-red-50 text-red-700",
  gone: "bg-red-50 text-red-700",
  no_owner: "bg-amber-50 text-amber-700",
  not_orderable: "bg-amber-50 text-amber-700",
  deprecated: "bg-amber-50 text-amber-700",
  no_order_form: "bg-slate-100 text-slate-600",
};

const effStatus = (p: ChartPublication): PublicationStatus => p.effective_status ?? p.status;

// What the queue is made of: a version somebody submitted, or a publication
// whose category and owner somebody proposed.
type QueueItem =
  | { key: string; kind: "version"; pub: ChartPublication; version: string; by?: string; since: string }
  | { key: string; kind: "meta"; row: RegistryRow; by?: string; since: string };

function buildQueue(rows: RegistryRow[], pending: PendingVersion[]): QueueItem[] {
  const items: QueueItem[] = [
    ...pending.map<QueueItem>((pv) => ({
      key: `ver-${pv.version.id}`,
      kind: "version",
      pub: pv.publication,
      version: pv.version.chart_version,
      by: pv.submitted?.by_name,
      since: pv.submitted?.at ?? pv.version.updated_at,
    })),
    ...rows
      .filter((r) => r.publication.status === "PENDING")
      .map<QueueItem>((r) => ({
        key: `meta-${r.publication.id}`,
        kind: "meta",
        row: r,
        by: r.submitted?.by_name,
        since: r.submitted?.at ?? r.publication.updated_at,
      })),
  ];
  // Oldest first: the queue is worked from the top, and what has waited
  // longest is what somebody is waiting on.
  return items.sort((a, b) => a.since.localeCompare(b.since));
}

// waitedFor says how long something has sat in the queue, and how loudly:
// quiet for a couple of days, amber from the third, red after a week.
function waitedFor(iso: string): { text: string; tone: string } {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (Number.isNaN(days)) return { text: "-", tone: "text-slate-400" };
  const text = days <= 0 ? t.waitedToday : days === 1 ? t.waitedYesterday : t.waitedDays(days);
  const tone = days >= 7 ? "text-red-600" : days >= 3 ? "text-amber-600" : "text-slate-500";
  return { text, tone };
}

const dayMonth = (iso: string) =>
  new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
const fullDate = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function AdminPublicationsPage() {
  const { data: rows, error, loading, reload } = useAsync((s) => api.adminPublications(s), [], qk.registry());
  const { data: pending, reload: reloadPending } = useAsync((s) => api.pendingVersions(s), [], qk.pendingVersions());
  const { categories, reload: reloadCatalog } = useCatalog();
  const teamLabel = useTeamLabel();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<Set<string>>(new Set());
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [owners, setOwners] = useState<Set<string>>(new Set());
  const [onlyIssues, setOnlyIssues] = useState(false);

  const all = rows ?? [];
  const catLabel = (id: string) => categories.find((c) => c.id === id)?.label ?? id;
  const ownerName = (team: string) => (team ? teamLabel(team) : "");
  // The facets' values: a few dozen rows, so computed on every render.
  const categoryOptions = [...new Set(all.map((r) => catLabel(r.publication.category_id)))].sort();
  const ownerOptions = [...new Set(all.map((r) => ownerName(r.publication.owner_team)).filter(Boolean))].sort();

  // The panel is addressed: ?meta=project/name opens the decision on that
  // publication, so a link from the board or a notification lands on it open.
  const metaParam = params.get("meta");
  const deciding = metaParam ? (all.find((r) => metaKey(r.publication) === metaParam) ?? null) : null;
  const openMeta = (row: RegistryRow) => setParams({ meta: metaKey(row.publication) });
  const closeMeta = () => setParams({});

  if (loading && !rows) return <SkeletonRows rows={5} />;
  if (error && !rows) return <ErrorBox error={error} hint={t.loadError} onRetry={reload} />;

  const queue = buildQueue(all, pending ?? []);
  const withIssues = all.filter((r) => r.issues.length > 0).length;
  const q = query.trim().toLowerCase();
  const shown = all
    .filter((r) => {
      const p = r.publication;
      if (q && !`${chartLabel(p.chart_name)} ${p.chart_project}/${p.chart_name}`.toLowerCase().includes(q)) return false;
      if (statuses.size && !statuses.has(t.status[effStatus(p)])) return false;
      if (cats.size && !cats.has(catLabel(p.category_id))) return false;
      if (owners.size && !owners.has(ownerName(p.owner_team))) return false;
      if (onlyIssues && r.issues.length === 0) return false;
      return true;
    })
    // Newest change first: the registry is read to see what moved.
    .sort((a, b) => b.publication.updated_at.localeCompare(a.publication.updated_at));
  const filtered = q !== "" || statuses.size > 0 || cats.size > 0 || owners.size > 0 || onlyIssues;
  const reset = () => {
    setQuery("");
    setStatuses(new Set());
    setCats(new Set());
    setOwners(new Set());
    setOnlyIssues(false);
  };

  // Where a row leads: to the decision it waits on, else to its management.
  const open = (row: RegistryRow) => {
    const p = row.publication;
    if (p.status === "PENDING") {
      openMeta(row);
      return;
    }
    const pv = (pending ?? []).find((v) => v.publication.id === p.id);
    navigate(pv ? versionPath(p, pv.version.chart_version) : managePath(p));
  };

  const onDecided = () => {
    closeMeta();
    reload();
    reloadPending();
    reloadCatalog();
  };

  return (
    <Page>
      <PageHeader
        title={t.title}
        status={
          queue.length > 0 ? (
            <Chip className="bg-amber-50 text-amber-700">
              <IconClock size={13} stroke={1.8} className="text-amber-500" />
              {t.queueWaiting(queue.length)}
            </Chip>
          ) : (
            <Chip className="bg-emerald-50 text-emerald-700">
              <IconCircleCheck size={13} stroke={1.8} className="text-emerald-500" />
              {t.queueEmpty}
            </Chip>
          )
        }
      />

      <PageBody>
        {queue.length > 0 && (
          <Section title={t.queueTitle} count={queue.length}>
            <Card padded={false} className="overflow-hidden">
              <ul className="divide-y divide-slate-100">
                {queue.map((item) => (
                  <QueueRow key={item.key} item={item} onDecide={() => item.kind === "meta" && openMeta(item.row)} />
                ))}
              </ul>
            </Card>
          </Section>
        )}

        <Section
          title={t.registryTitle}
          count={all.length}
          summary={
            withIssues > 0 && (
              <button
                type="button"
                onClick={() => setOnlyIssues((v) => !v)}
                aria-pressed={onlyIssues}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-brand-500 ${
                  onlyIssues ? "bg-red-600 text-white" : "bg-red-50 text-red-700 hover:bg-red-100"
                }`}
              >
                <IconAlertTriangle size={12} stroke={2} />
                {t.withIssues(withIssues)}
              </button>
            )
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <SearchField
              value={query}
              onChange={setQuery}
              aria-label={t.searchLabel}
              className="relative mr-1 flex w-64 items-center"
            >
              <IconSearch size={14} stroke={1.8} className="pointer-events-none absolute left-2.5 text-slate-400" />
              <Input
                placeholder={t.searchPlaceholder}
                className="h-7 w-full rounded-full border border-slate-200 bg-surface pl-8 pr-7 text-xs outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-100 [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <AriaButton
                  onPress={() => setQuery("")}
                  aria-label={t.searchClear}
                  className="absolute right-2 text-slate-400 outline-none hover:text-slate-600"
                >
                  <IconX size={13} />
                </AriaButton>
              )}
            </SearchField>
            <SearchFilter
              label={t.filterStatus}
              searchPlaceholder={t.filterSearch}
              options={STATUSES.map((s) => t.status[s])}
              selected={statuses}
              onChange={setStatuses}
              emptyText={t.filterEmpty}
              resetText={t.filterReset}
            />
            <SearchFilter
              label={t.filterCategory}
              searchPlaceholder={t.filterSearch}
              options={categoryOptions}
              selected={cats}
              onChange={setCats}
              emptyText={t.filterEmpty}
              resetText={t.filterReset}
            />
            <SearchFilter
              label={t.filterOwner}
              searchPlaceholder={t.filterSearch}
              options={ownerOptions}
              selected={owners}
              onChange={setOwners}
              emptyText={t.filterEmpty}
              resetText={t.filterReset}
            />
            <button
              type="button"
              onClick={() => setOnlyIssues((v) => !v)}
              aria-pressed={onlyIssues}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                onlyIssues ? "border-brand-200 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {onlyIssues && <IconCheck size={12} stroke={3} />}
              {t.onlyIssues}
            </button>
            {filtered && (
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <IconX size={13} stroke={2} />
                {t.reset}
              </button>
            )}
          </div>

          {/* No overflow-hidden here: it would make this box the scroll container
              and the sticky header below would have nothing to stick to. The
              header rounds its own top corners instead. */}
          <div className="rounded-lg border border-slate-200 bg-surface shadow-sm">
            <Table aria-label={t.tableLabel} className="w-full text-sm">
              {/* Pinned to the top of the scroll box: the list runs past a
                  screenful. -top-1 covers that box's own 4px padding. The middle
                  columns drop out on narrow screens rather than the table
                  growing a horizontal scrollbar. */}
              <TableHeader className="sticky -top-1 z-10 border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500 [&_th:first-child]:rounded-tl-lg [&_th:last-child]:rounded-tr-lg">
                <Column isRowHeader className="px-4 py-2.5 text-left">
                  {t.colService}
                </Column>
                <Column className="hidden px-4 py-2.5 text-left xl:table-cell">{t.colCategory}</Column>
                <Column className="hidden px-4 py-2.5 text-left lg:table-cell">{t.colOwner}</Column>
                <Column className="px-4 py-2.5 text-left">{t.colVersions}</Column>
                <Column className="px-4 py-2.5 text-right">{t.colOrders}</Column>
                <Column className="px-4 py-2.5 text-left">{t.colState}</Column>
                <Column className="hidden whitespace-nowrap px-4 py-2.5 text-right lg:table-cell">{t.colUpdated}</Column>
                <Column className="px-2 py-2.5 text-right">
                  <span className="sr-only">{t.colActions}</span>
                </Column>
              </TableHeader>
              <TableBody
                renderEmptyState={() => (
                  <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                      <IconSearch size={24} stroke={1.6} />
                    </span>
                    <p className="text-sm text-slate-500">{filtered ? t.emptyFiltered : t.emptyRegistry}</p>
                  </div>
                )}
              >
                {shown.map((row) => (
                  <RegistryRowView
                    key={row.publication.id}
                    row={row}
                    categoryLabel={catLabel(row.publication.category_id)}
                    ownerLabel={ownerName(row.publication.owner_team)}
                    onOpen={() => open(row)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>
      </PageBody>

      <MetaDecisionPanel row={deciding} onClose={closeMeta} onDecided={onDecided} />
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

function QueueRow({ item, onDecide }: { item: QueueItem; onDecide: () => void }) {
  const teamLabel = useTeamLabel();
  const { categories } = useCatalog();
  const catLabel = (id: string) => categories.find((c) => c.id === id)?.label ?? id;
  const pub = item.kind === "version" ? item.pub : item.row.publication;
  const waited = waitedFor(item.since);
  const body = (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
        {item.kind === "version" ? <IconPackage size={17} stroke={1.8} /> : <IconPencil size={17} stroke={1.8} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate text-sm font-medium text-slate-800">
            {item.kind === "version" ? t.queueVersion(`v${item.version}`) : t.queueMeta}
          </span>
          <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
            <ProductIcon project={pub.chart_project} name={pub.chart_name} size={14} />
            {chartLabel(pub.chart_name)}
          </span>
          {item.kind === "meta" && (
            <span className="inline-flex flex-wrap items-center gap-1 text-xs text-slate-500">
              {pub.draft_category_id && (
                <Change from={catLabel(pub.category_id)} to={catLabel(pub.draft_category_id)} />
              )}
              {pub.draft_category_id && pub.draft_owner_team && <span className="text-slate-300">·</span>}
              {pub.draft_owner_team && <Change from={teamLabel(pub.owner_team)} to={teamLabel(pub.draft_owner_team)} />}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1" title={t.ownerLabel}>
            <IconUsers size={13} stroke={1.8} className="text-slate-400" aria-hidden />
            <span className="sr-only">{t.ownerLabel}:</span>
            {pub.owner_team ? teamLabel(pub.owner_team) : t.ownerMissing}
          </span>
          {item.by && (
            <span className="inline-flex items-center gap-1" title={t.submitterLabel}>
              <IconUser size={13} stroke={1.8} className="text-slate-400" aria-hidden />
              <span className="sr-only">{t.submitterLabel}:</span>
              {item.by}
            </span>
          )}
        </div>
      </div>
      <span className={`shrink-0 text-xs tabular-nums ${waited.tone}`} title={t.queueSince(fullDate(item.since))}>
        {waited.text}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand-600">
        {item.kind === "version" ? t.queueOpenVersion : t.queueDecide}
        <IconArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
      </span>
    </>
  );
  const cls =
    "group flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors duration-150 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500";
  return (
    <li>
      {item.kind === "version" ? (
        <Link to={versionPath(pub, item.version)} className={cls}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={onDecide} className={cls}>
          {body}
        </button>
      )}
    </li>
  );
}

// Change is "was > will be" for one proposed value.
function Change({ from, to }: { from: string; to: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="line-through decoration-slate-300">{from}</span>
      <IconArrowRight size={12} className="text-slate-300" aria-hidden />
      <span>{to}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Registry rows
// ---------------------------------------------------------------------------

function RegistryRowView({
  row,
  categoryLabel,
  ownerLabel,
  onOpen,
}: {
  row: RegistryRow;
  categoryLabel: string;
  ownerLabel: string;
  onOpen: () => void;
}) {
  const navigate = useNavigate();
  const p = row.publication;
  const v = row.versions;
  const status = effStatus(p);
  return (
    <Row
      onAction={onOpen}
      className="cursor-pointer border-b border-slate-100 outline-none last:border-0 hover:bg-slate-50 focus-visible:bg-slate-50"
    >
      <Cell className="px-4 py-3 text-left">
        <span className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <ProductIcon project={p.chart_project} name={p.chart_name} size={17} />
          </span>
          <span className="min-w-0">
            <span className="block font-medium text-slate-800">{chartLabel(p.chart_name)}</span>
            <span className="block truncate text-xs text-slate-400">
              {p.chart_project}/{p.chart_name}
            </span>
          </span>
        </span>
      </Cell>
      <Cell className="hidden px-4 py-3 text-left xl:table-cell">
        <Chip className="bg-slate-100 text-slate-600">{categoryLabel}</Chip>
      </Cell>
      <Cell className="hidden px-4 py-3 text-left text-slate-600 lg:table-cell">
        {ownerLabel || <span className="text-amber-600">{t.ownerMissing}</span>}
      </Cell>
      <Cell className="px-4 py-3 text-left">
        <span className="flex flex-wrap items-center gap-1.5">
          {v.recommended ? (
            <span title={t.recommendedHint}>
              <Chip className="bg-slate-100 font-mono text-slate-700">v{v.recommended}</Chip>
            </span>
          ) : (
            <span className="text-slate-300">-</span>
          )}
          <span className="text-xs text-slate-500">{t.versionsCount(v.total)}</span>
          {v.pending > 0 && <Mark tone="bg-amber-500" text={t.markPending(v.pending)} />}
          {v.draft > 0 && <Mark tone="bg-slate-400" text={t.markDraft(v.draft)} />}
          {v.deprecated > 0 && <Mark tone="bg-amber-400" text={t.markDeprecated(v.deprecated)} />}
          {v.gone > 0 && <Mark tone="bg-red-500" text={t.markGone(v.gone)} />}
        </span>
      </Cell>
      <Cell className="px-4 py-3 text-right tabular-nums">
        {row.orders.live > 0 ? (
          <AriaButton
            onPress={() => navigate(ordersPath(p))}
            className="font-medium text-slate-800 outline-none hover:text-brand-600 hover:underline focus-visible:ring-2 focus-visible:ring-brand-500"
            aria-label={t.ordersHint(row.orders.live, row.orders.total)}
          >
            {row.orders.live}
          </AriaButton>
        ) : (
          <span className="text-slate-300" title={t.ordersHint(row.orders.live, row.orders.total)}>
            0
          </span>
        )}
      </Cell>
      <Cell className="px-4 py-3 text-left">
        <span className="flex flex-wrap items-center gap-1">
          <Chip className={STATUS_TONE[status]}>{t.status[status]}</Chip>
          {row.issues.map((code) => (
            <IssuePill key={code} code={code} />
          ))}
        </span>
      </Cell>
      <Cell className="hidden px-4 py-3 text-right text-xs text-slate-500 lg:table-cell">
        <span title={fullDate(p.updated_at)}>{dayMonth(p.updated_at)}</span>
      </Cell>
      <Cell className="px-2 py-3 text-right">
        <MenuTrigger>
          <AriaButton
            aria-label={t.rowMenu}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <IconDots size={16} />
          </AriaButton>
          <Popover
            placement="bottom end"
            className="min-w-56 rounded-md border border-slate-200 bg-surface py-1 shadow-lg outline-none entering:animate-in entering:fade-in"
          >
            <Menu className="outline-none" onAction={(key) => navigate(String(key))}>
              <MenuItem id={managePath(p)} className="cursor-pointer px-3 py-1.5 text-sm text-slate-700 outline-none hover:bg-slate-50 focus:bg-slate-50">
                {t.openManage}
              </MenuItem>
              <MenuItem id={catalogPath(p)} className="cursor-pointer px-3 py-1.5 text-sm text-slate-700 outline-none hover:bg-slate-50 focus:bg-slate-50">
                {t.openCatalog}
              </MenuItem>
              <MenuItem id={ordersPath(p)} className="cursor-pointer px-3 py-1.5 text-sm text-slate-700 outline-none hover:bg-slate-50 focus:bg-slate-50">
                {t.openOrders}
              </MenuItem>
            </Menu>
          </Popover>
        </MenuTrigger>
      </Cell>
    </Row>
  );
}

function Mark({ tone, text }: { tone: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
      <span className={`h-1.5 w-1.5 rounded-full ${tone}`} aria-hidden />
      {text}
    </span>
  );
}

// IssuePill names one problem and explains it on hover or focus. A code this
// build does not know (a newer server) is shown as the code: better than a
// problem the page silently drops.
function IssuePill({ code }: { code: string }) {
  const known = (t.issue as Record<string, { label: string; hint: string }>)[code];
  const tone = ISSUE_TONE[code] ?? "bg-slate-100 text-slate-600";
  const pill = (
    <StatusPill tone={tone} Icon={IconAlertTriangle}>
      {known?.label ?? code}
    </StatusPill>
  );
  if (!known) return pill;
  return (
    <Hint text={known.hint}>
      <AriaButton className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand-500">{pill}</AriaButton>
    </Hint>
  );
}

// ---------------------------------------------------------------------------
// The decision on a publication's category and owner
// ---------------------------------------------------------------------------

function MetaDecisionPanel({
  row,
  onClose,
  onDecided,
}: {
  row: RegistryRow | null;
  onClose: () => void;
  onDecided: () => void;
}) {
  const { categories } = useCatalog();
  const teamLabel = useTeamLabel();
  const toast = useToast();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<null | "approve" | "reject">(null);
  const [err, setErr] = useState<string | null>(null);
  const p = row?.publication ?? null;
  const catLabel = (id: string) => categories.find((c) => c.id === id)?.label ?? id;
  const pendingMeta = p?.status === "PENDING";

  async function decide(action: "approve" | "reject") {
    if (!p) return;
    if (action === "reject" && comment.trim() === "") {
      setErr(t.commentRequired);
      return;
    }
    setBusy(action);
    setErr(null);
    try {
      if (action === "approve") {
        await api.approvePublication(p.id);
        toast.success(t.approved);
      } else {
        await api.rejectPublication(p.id, comment.trim());
        toast.success(t.rejected);
      }
      setComment("");
      onDecided();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <FormDialogShell
      isOpen={p !== null}
      onClose={onClose}
      icon={<IconPencil size={20} stroke={1.8} />}
      title={p ? t.panelTitle(chartLabel(p.chart_name)) : ""}
      subtitle={p ? `${p.chart_project}/${p.chart_name}` : undefined}
      footer={(close) =>
        pendingMeta ? (
          <>
            <Button variant="danger" isDisabled={busy !== null} onPress={() => decide("reject")}>
              {t.reject}
            </Button>
            <Button variant="primary" isDisabled={busy !== null} onPress={() => decide("approve")}>
              {t.approve}
            </Button>
          </>
        ) : (
          <Button onPress={close}>{t.panelOpenManage}</Button>
        )
      }
    >
      {p && (
        <div className="flex flex-col gap-4">
          <div className="overflow-hidden rounded-lg border border-slate-200">
            {pendingMeta && (p.draft_category_id || p.draft_owner_team) ? (
              <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
                {p.draft_category_id && (
                  <>
                    <dt className="text-xs uppercase tracking-wide text-slate-400">{t.panelCategory}</dt>
                    <dd>
                      <Change from={catLabel(p.category_id)} to={catLabel(p.draft_category_id)} />
                    </dd>
                  </>
                )}
                {p.draft_owner_team && (
                  <>
                    <dt className="text-xs uppercase tracking-wide text-slate-400">{t.panelOwner}</dt>
                    <dd>
                      <Change from={teamLabel(p.owner_team)} to={teamLabel(p.draft_owner_team)} />
                    </dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="px-4 py-3 text-sm text-slate-500">{t.panelNoChanges}</p>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500">
              {row?.submitted && (
                <>
                  <span className="inline-flex items-center gap-1">
                    <IconUser size={13} stroke={1.8} className="text-slate-400" aria-hidden />
                    {row.submitted.by_name}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <IconClock size={13} stroke={1.8} className="text-slate-400" aria-hidden />
                    {fullDate(row.submitted.at)}
                  </span>
                </>
              )}
              <Link to={managePath(p)} className="ml-auto font-medium text-brand-600 hover:underline">
                {t.panelOpenManage}
              </Link>
            </div>
          </div>
          {pendingMeta && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-slate-600">{t.commentLabel}</span>
              <textarea
                value={comment}
                onChange={(e) => {
                  setComment(e.target.value);
                  if (err) setErr(null);
                }}
                rows={3}
                placeholder={t.commentPlaceholder}
                className="rounded-md border border-slate-200 bg-surface px-3 py-2 text-sm outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
              />
            </label>
          )}
          {err && <FormErrors message={err} />}
        </div>
      )}
    </FormDialogShell>
  );
}

// ---------------------------------------------------------------------------
// Shared bits (the board's section shape)
// ---------------------------------------------------------------------------

function Section({
  title,
  count,
  summary,
  children,
}: {
  title: string;
  count?: number;
  summary?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col">
      <div className="mb-3 flex min-h-7 items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        {count !== undefined && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">
            {count}
          </span>
        )}
        {summary}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The old decision page's address
// ---------------------------------------------------------------------------

// ApprovalRedirectPage forwards /admin/approvals/:project/:name, the address of
// the decision page that used to be here, to where the decision is made now:
// the metadata panel when the category and owner are under review, the
// version's own page when one version is, the publication's management
// otherwise.
export function ApprovalRedirectPage() {
  const { project = "", name = "" } = useParams();
  const { data, error } = useAsync(
    async (signal) => {
      const pub = await api.findPublication(project, name, signal);
      // null is what the hook shows while it loads, so "not found" has to be
      // a value of its own.
      if (!pub) return { pub: null, pending: [] };
      const versions = await api.listVersions(pub.id, signal);
      return { pub, pending: versions.filter((v) => v.status === "PENDING") };
    },
    [project, name],
  );
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading label={t.redirectLoading} />;
  const { pub, pending } = data;
  if (!pub) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        {t.notFound(`${project}/${name}`)}
      </div>
    );
  }
  const to =
    pub.status === "PENDING"
      ? `/admin/approvals?meta=${encodeURIComponent(metaKey(pub))}`
      : pending.length === 1
        ? versionPath(pub, pending[0].chart_version)
        : managePath(pub);
  return <Navigate to={to} replace />;
}

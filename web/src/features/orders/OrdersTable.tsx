import { IconAlertTriangle, IconArrowRight, IconArrowsSort, IconArrowUpCircle, IconCheck, IconChevronDown, IconDots, IconGitFork, IconPackages, IconPlus, IconSearch, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Cell,
  Column,
  Dialog,
  DialogTrigger,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Row,
  Table,
  TableBody,
  TableHeader,
} from "react-aria-components";
import { Link, useNavigate } from "react-router-dom";
import { api, errorMessage, HttpError } from "@/api/client";
import { changeInFlightText } from "@/api/errorText";
import { qk } from "@/api/queryKeys";
import { isLive } from "@/api/orderStatus";
import type { OrderRequest } from "@/api/types";
import { useCatalog } from "@/app/CatalogContext";
import { useTeam } from "@/app/TeamContext";
import { useToast } from "@/app/ToastContext";
import { canModify, useUser } from "@/auth/UserContext";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ProductIcon } from "@/components/icons";
import {
  STATUS_GROUPS,
  StatusBadge,
  type StatusGroupKey,
  statusGroup,
  statusNextStep,
} from "@/components/StatusBadge";
import { ErrorBox, LinkButton, SkeletonRows } from "@/components/ui";
import { orderNamespace } from "@/form/namespace";
import { useAsync } from "@/hooks/useAsync";
import { isNewer } from "@/lib/semver";
import { fmtDateTime } from "@/lib/time";
import { subscribe } from "@/lib/sse";

interface Props {
  title: string;
  // Extra filter applied on top of the active-team filter (e.g. by product).
  filter?: (r: OrderRequest) => boolean;
  // When set, render an "Заказать" button linking to this route.
  orderTo?: string;
  // When set (and orderTo is not), render a disabled "Заказать" button with this
  // reason as its tooltip. The empty table says the same thing in full, so the
  // button carries no label of its own.
  orderDisabledReason?: string;
  // Hint shown when the table is empty.
  emptyHint?: React.ReactNode;
  // Cross-team view (support/admin): ignore the active-team filter and add a
  // "Команда" column so it's clear which team owns each order.
  allTeams?: boolean;
}

// The filter offers what the table shows: status groups, in lifecycle order.
// Deleted orders are hidden by default.
const DEFAULT_HIDDEN: StatusGroupKey[] = ["deleted"];
const ALL_GROUPS = STATUS_GROUPS.map((g) => g.key);

// The status and the actions stay put while the rest of the row slides under
// them: the status is read on every row and the actions are used from it.
//
// A sticky cell paints nothing by itself, so each one carries the background of
// what it stands in - the header strip, or the row with its hover and focus (the
// row is a `group` for that). "Действия" sits at the edge, "Статус" stands on
// its width, which is why that column is pinned to a fixed 4rem (w-16): its
// content is a single icon button, well inside those bounds, so the column
// cannot grow and leave a gap between the two.
const PINNED_HEAD = "sticky z-10 bg-slate-50";
const PINNED_CELL = "sticky z-10 bg-surface group-hover:bg-slate-50 group-focus-visible:bg-slate-50";
const ACTIONS_W = "w-16";
const AT_ACTIONS = "right-0";
const AT_STATUS = "right-16";
// The edge of the pinned pair, shown only while something is still hidden to
// the right of it. It has to read as one layer lying over another - a hairline
// alone looks like an ordinary column rule - so the border carries a shadow
// falling onto the columns that pass underneath. With nothing left to scroll
// the edge goes away: there is no layer above anything then.
const PINNED_EDGE = "border-l border-slate-200 shadow-[-10px_0_12px_-4px_rgba(15,23,42,0.22)]";

export function OrdersTable({ title, filter, orderTo, orderDisabledReason, emptyHint, allTeams }: Props) {
  // Fetch including deleted so the status filter can reveal them on demand.
  // Shared cache key: every product page and the orders list render the same
  // request list, so switching between them shows the cached rows immediately
  // and refreshes in the background instead of blanking out.
  const { data, error, loading, reload } = useAsync(
    (signal) => api.listRequests({ include_deleted: "true" }, signal),
    [],
    qk.requests(),
  );

  // Live updates: a global SSE stream pushes a "status_changed" signal on any
  // request status change; we re-fetch the (team-scoped) list. Browser handles
  // reconnect. One-way server->client - SSE, not WebSockets.
  useEffect(() => {
    return subscribe("/api/v1/requests/events", { status_changed: () => reload() }, "orders");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { team } = useTeam();
  const { user } = useUser();
  const navigate = useNavigate();
  const toast = useToast();

  // Order's category label from its chart's publication (for the "Category" column).
  const { categories, charts } = useCatalog();
  const categoryOf = (project: string, name: string) => {
    const pub = charts.find((c) => c.project === project && c.name === name)?.publication;
    return categories.find((c) => c.id === pub?.category_id)?.label;
  };
  // Approved version newer than the order's version -> an upgrade is available
  // (only for live, non-drifted orders).
  const upgradeFor = (r: OrderRequest): string | null => {
    if (!isLive(r.status) || r.drifted) return null;
    const v = charts.find((c) => c.project === r.chart_project && c.name === r.chart_name)
      ?.publication?.approved_view_version;
    return v && isNewer(v, r.chart_version) ? v : null;
  };

  const [shown, setShown] = useState<Set<StatusGroupKey>>(
    () => new Set(ALL_GROUPS.filter((g) => !DEFAULT_HIDDEN.includes(g))),
  );
  const [newestFirst, setNewestFirst] = useState(true);
  // Cross-team facet filters (only used when allTeams). Empty set = no filter.
  const [teamFilter, setTeamFilter] = useState<Set<string>>(new Set());
  const [productFilter, setProductFilter] = useState<Set<string>>(new Set());
  const [namespaceFilter, setNamespaceFilter] = useState<Set<string>>(new Set());
  // The order pending delete confirmation (null = dialog closed).
  const [deleting, setDeleting] = useState<OrderRequest | null>(null);

  // Everything this table is about, before any of the filters a person sets:
  // the team scoping and the caller's own filter (one product, on the product
  // page). The facet options are built from it, so ticking one facet never
  // empties the choices of another and never hides a chip mid-use.
  const scoped = useMemo(
    () => (data ?? []).filter((r) => allTeams || !team || r.team === team).filter((r) => (filter ? filter(r) : true)),
    [data, allTeams, team, filter],
  );

  // Distinct teams/products/namespaces present, for the facet filter options.
  const teamOptions = useMemo(() => [...new Set(scoped.map((r) => r.team))].filter(Boolean).sort(), [scoped]);
  const productOptions = useMemo(
    () => [...new Set(scoped.map((r) => r.chart_name))].filter(Boolean).sort(),
    [scoped],
  );
  // By the effective namespace, the one the column shows: an order without an
  // explicit one would otherwise become an option with no name.
  const namespaceOptions = useMemo(
    () => [...new Set(scoped.map(orderNamespace))].filter(Boolean).sort(),
    [scoped],
  );

  const rows = useMemo(() => {
    const base = scoped
      .filter((r) => teamFilter.size === 0 || teamFilter.has(r.team))
      .filter((r) => productFilter.size === 0 || productFilter.has(r.chart_name))
      .filter((r) => namespaceFilter.size === 0 || namespaceFilter.has(orderNamespace(r)))
      // A state this build does not know has no group to filter by, and hiding
      // an order nobody can name is worse than showing it.
      .filter((r) => {
        const g = statusGroup(r.status);
        return g === null || shown.has(g);
      });
    const dir = newestFirst ? -1 : 1;
    return [...base].sort((a, b) => {
      // Drafts always on top, regardless of the date direction.
      const ad = a.status === "DRAFT" ? 0 : 1;
      const bd = b.status === "DRAFT" ? 0 : 1;
      if (ad !== bd) return ad - bd;
      return dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    });
  }, [scoped, shown, newestFirst, teamFilter, productFilter, namespaceFilter]);

  // Is anything still hidden to the right of the pinned pair? That is the only
  // moment their edge means something, so it is drawn only then.
  const scroller = useRef<HTMLDivElement>(null);
  const [pinnedEdge, setPinnedEdge] = useState(false);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setPinnedEdge(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    update();
    el.addEventListener("scroll", update, { passive: true });
    // The window can be resized without the rows changing, and the columns can
    // change without the window moving (the cross-team view has one more).
    const ro = new ResizeObserver(update);
    ro.observe(el);

    // A wheel over the table moves the table. A browser sends a plain wheel
    // down the page and leaves a sideways scroller to shift+wheel, which is not
    // what a person expects with the cursor on a row half of which is hidden.
    // At either end of the table the wheel goes back to the page, so the table
    // never traps the reader on the way down.
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0 || e.deltaX !== 0 || e.shiftKey) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const at = el.scrollLeft;
      // Already against the end it is turning towards: the page takes the wheel.
      if (e.deltaY > 0 ? at >= max - 1 : at <= 0) return;
      e.preventDefault();
      el.scrollLeft = Math.min(max, Math.max(0, at + e.deltaY));
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      el.removeEventListener("scroll", update);
      el.removeEventListener("wheel", onWheel);
      ro.disconnect();
    };
  }, [rows.length, loading, allTeams]);

  if (loading) return <SkeletonRows rows={6} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  async function onSync(r: OrderRequest) {
    try {
      await api.syncRequest(r.id);
      toast.success("Выкатка из Git запущена");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  async function onConfirmDelete() {
    if (!deleting) return;
    try {
      await api.deleteRequest(deleting.id);
      reload();
    } catch (e) {
      // A change still on its way blocks deletion: say so in the words the rest
      // of the portal uses (ConfirmDialog renders a thrown message inline).
      if (e instanceof HttpError && e.code === "open_mr") {
        throw new Error(changeInFlightText("delete"));
      }
      throw e;
    }
  }

  const filtersDefault =
    newestFirst &&
    teamFilter.size === 0 &&
    productFilter.size === 0 &&
    namespaceFilter.size === 0 &&
    ALL_GROUPS.every((g) => shown.has(g) === !DEFAULT_HIDDEN.includes(g));
  const resetFilters = () => {
    setShown(new Set(ALL_GROUPS.filter((g) => !DEFAULT_HIDDEN.includes(g))));
    setNewestFirst(true);
    setTeamFilter(new Set());
    setProductFilter(new Set());
    setNamespaceFilter(new Set());
  };

  return (
    <div>
      <div className="mb-4 flex min-h-9 items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {orderTo ? (
          <LinkButton to={orderTo} variant="primary" className="gap-1.5">
            <IconPlus size={16} stroke={2} />
            Заказать
          </LinkButton>
        ) : orderDisabledReason ? (
          <div className="flex items-center gap-2">
            <span
              title={orderDisabledReason}
              aria-disabled="true"
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-300"
            >
              <IconPlus size={16} stroke={2} />
              Заказать
            </span>
          </div>
        ) : null}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {allTeams && (
          <>
            <SearchFilter
              label="Команды"
              searchPlaceholder="Найти команду..."
              options={teamOptions}
              selected={teamFilter}
              onChange={setTeamFilter}
            />
            <SearchFilter
              label="Продукты"
              searchPlaceholder="Найти продукт..."
              options={productOptions}
              selected={productFilter}
              onChange={setProductFilter}
            />
          </>
        )}
        <StatusFilter shown={shown} onChange={setShown} />
        {/* One namespace in the table means the filter can only ever say what
            is already on every row, so it is not offered at all. */}
        {namespaceOptions.length > 1 && (
          <SearchFilter
            label="Неймспейсы"
            searchPlaceholder="Найти неймспейс..."
            options={namespaceOptions}
            selected={namespaceFilter}
            onChange={setNamespaceFilter}
          />
        )}
        <button
          onClick={() => setNewestFirst((v) => !v)}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <IconArrowsSort size={13} stroke={1.8} className="text-slate-400" />
          {newestFirst ? "Сначала новые" : "Сначала старые"}
        </button>
        {!filtersDefault && (
          <button
            onClick={resetFilters}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <IconX size={13} stroke={2} />
            Сбросить
          </button>
        )}
      </div>

      {/* Every column is here at every width, and nothing wraps: a row is read
          across, and a value broken over two lines or a column missing without
          a word about it both cost more than the sideways scroll do. What does
          not fit slides under the pinned status and actions. */}
      <div
        ref={scroller}
        className="overflow-x-auto rounded-lg border border-slate-200 bg-surface shadow-sm"
      >
        {/* Separated borders, not collapsed ones: with collapsed borders a
            browser paints neither the border nor the shadow of a cell, and the
            pinned pair needs both to read as a layer over the rest. The rules
            between rows move onto the cells for the same reason. */}
        <Table
          aria-label={title}
          className="w-full min-w-max border-separate border-spacing-0 whitespace-nowrap text-sm"
        >
          <TableHeader className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500 [&_th]:border-b [&_th]:border-slate-200">
            <Column className="px-4 py-2.5 text-left">Категория</Column>
            {allTeams && <Column className="px-4 py-2.5 text-left">Команда</Column>}
            <Column className="px-4 py-2.5 text-left">Продукт</Column>
            <Column isRowHeader className="px-4 py-2.5 text-left">Имя</Column>
            {/* Where the order landed, next to what it is called: the two
                together are what a person matches against the cluster. */}
            <Column className="px-4 py-2.5 text-left">Неймспейс</Column>
            <Column className="px-4 py-2.5 text-left">Метка</Column>
            <Column className="px-4 py-2.5 text-left">Создатель</Column>
            <Column className="px-4 py-2.5 text-right">Дата создания</Column>
            <Column
              className={`px-4 py-2.5 text-left ${PINNED_HEAD} ${AT_STATUS} ${pinnedEdge ? PINNED_EDGE : ""}`}
            >
              Статус
            </Column>
            <Column className={`${ACTIONS_W} px-4 py-2.5 ${PINNED_HEAD} ${AT_ACTIONS}`}>
              <span className="sr-only">Действия</span>
            </Column>
          </TableHeader>
          <TableBody
            renderEmptyState={() => (
              // The rows do not wrap; a sentence in an empty table does.
              <div className="whitespace-normal px-4 py-12 text-center text-sm text-slate-500">
                {emptyHint ?? (
                  <div className="flex flex-col items-center gap-3">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                      <IconPackages size={24} stroke={1.6} />
                    </span>
                    <p>Заказов пока нет</p>
                    <LinkButton to="/catalog" className="gap-1.5">
                      Открыть каталог
                      <IconArrowRight size={16} stroke={1.7} className="text-slate-400" />
                    </LinkButton>
                  </div>
                )}
              </div>
            )}
          >
            {rows.map((r) => {
              const isDraft = r.status === "DRAFT";
              const modifiable = canModify(user, r.team) && r.status !== "DELETED";
              return (
                <Row
                  key={r.id}
                  onAction={() => navigate(isDraft ? `/requests/${r.id}/edit` : `/requests/${r.id}`)}
                  className="group cursor-pointer outline-none hover:bg-slate-50 focus-visible:bg-slate-50 [&>*]:border-b [&>*]:border-slate-100 last:[&>*]:border-b-0"
                >
                  <Cell className="px-4 py-3 text-left text-slate-500">
                    {categoryOf(r.chart_project, r.chart_name) ?? r.chart_project}
                  </Cell>
                  {allTeams && <Cell className="px-4 py-3 text-left text-slate-600">{r.team}</Cell>}
                  <Cell className="px-4 py-3 text-left">
                    <span className="flex items-center gap-2 font-medium text-slate-800">
                      <ProductIcon project={r.chart_project} name={r.chart_name} />
                      {r.chart_name}
                    </span>
                  </Cell>
                  <Cell className="px-4 py-3 text-left">
                    {/* A draft can't be opened (no detail) - its name leads to the edit form. */}
                    <span className="flex items-center gap-1.5">
                      <Link
                        to={isDraft ? `/requests/${r.id}/edit` : `/requests/${r.id}`}
                        className="font-medium text-slate-800 transition-colors hover:text-slate-950"
                      >
                        {r.service_name}
                      </Link>
                      {r.imported && (
                        <span
                          title="Импортировано из Git (создано вне портала)"
                          className="inline-flex items-center gap-0.5 rounded bg-sky-50 px-1.5 py-0.5 text-xs font-medium text-sky-700"
                        >
                          <IconGitFork size={12} stroke={2} />
                          Импорт
                        </span>
                      )}
                      {r.drifted && (
                        <span
                          title={r.drift_detail || "Изменено в Git вне портала"}
                          className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700"
                        >
                          <IconAlertTriangle size={12} stroke={2} />
                          Git
                        </span>
                      )}
                      {(() => {
                        const up = upgradeFor(r);
                        return up ? (
                          <Link
                            to={`/requests/${r.id}/upgrade?to=${encodeURIComponent(up)}`}
                            onClick={(e) => e.stopPropagation()}
                            title={`Доступно обновление до ${up}`}
                            className="inline-flex items-center gap-0.5 rounded bg-brand-50 px-1.5 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-100"
                          >
                            <IconArrowUpCircle size={12} stroke={2} />
                            {up}
                          </Link>
                        ) : null;
                      })()}
                    </span>
                  </Cell>
                  {/* An order without an explicit namespace still lands in one,
                      named after the service; the cell says where it is, not
                      what the field holds. */}
                  <Cell className="px-4 py-3 text-left font-mono text-[13px] text-slate-600">
                    {orderNamespace(r)}
                  </Cell>
                  <Cell className="px-4 py-3 text-left text-slate-600">
                    {r.display_name || "-"}
                  </Cell>
                  <Cell className="px-4 py-3 text-left text-slate-500">{r.created_by_name}</Cell>
                  <Cell className="px-4 py-3 text-right text-slate-600">
                    {fmtDateTime(r.created_at)}
                  </Cell>
                  {/* The status is read as a word: a coloured dot alone needed a
                      hover to say anything, and on a touch screen there is no
                      hover at all. The tooltip is left for the dead ends, where
                      what to do next does not fit on a badge. */}
                  <Cell
                    className={`px-4 py-3 text-left ${PINNED_CELL} ${AT_STATUS} ${pinnedEdge ? PINNED_EDGE : ""}`}
                  >
                    <span title={statusNextStep(r.status)?.hint}>
                      <StatusBadge status={r.status} />
                    </span>
                  </Cell>
                  <Cell className={`px-4 py-3 text-right ${PINNED_CELL} ${AT_ACTIONS}`}>
                    <RowActions
                      isDraft={isDraft}
                      onOpen={() => navigate(`/requests/${r.id}`)}
                      onContinue={() => navigate(`/requests/${r.id}/edit`)}
                      onSync={!isDraft && user?.role === "admin" ? () => onSync(r) : undefined}
                      onDelete={modifiable ? () => setDeleting(r) : undefined}
                    />
                  </Cell>
                </Row>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        isOpen={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        danger
        title={deleting?.status === "DRAFT" ? "Удалить черновик?" : "Удалить сервис?"}
        confirmLabel="Удалить"
        busyLabel="Удаляем…"
        message={
          deleting?.status === "DRAFT" ? (
            <>
              Черновик <strong>{deleting?.display_name || deleting?.service_name}</strong> будет
              удалён без возможности восстановления.
            </>
          ) : (
            <>
              Сервис <strong>{deleting?.service_name}</strong> будет удалён.
            </>
          )
        }
        onConfirm={onConfirmDelete}
      />
    </div>
  );
}

// StatusFilter is one chip opening a multi-select of which statuses to show
// (deleted orders off by default). It lists the same groups the badges show, so what
// a person picks here is worded exactly like what they read in the table.
//
// Nothing explains the states here. It was tried and it was noise: the badges
// carry words now, and a line of prose under each one turns a filter a person
// opens to tick a box into a page to read. What each state means lives in the
// help ("Статусы и развёртывание").
function StatusFilter({
  shown,
  onChange,
}: {
  shown: Set<StatusGroupKey>;
  onChange: (s: Set<StatusGroupKey>) => void;
}) {
  return (
    <MenuTrigger>
      <Button className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500">
        Статусы
        <span className="text-slate-400">
          {shown.size}/{ALL_GROUPS.length}
        </span>
        <IconChevronDown size={13} stroke={1.8} className="text-slate-400" />
      </Button>
      <Popover className="rounded-md border border-slate-200 bg-surface py-1 shadow-lg outline-none entering:animate-in entering:fade-in">
        <Menu
          selectionMode="multiple"
          selectedKeys={shown}
          onSelectionChange={(keys) =>
            onChange(keys === "all" ? new Set(ALL_GROUPS) : new Set([...keys].map(String) as StatusGroupKey[]))
          }
          className="max-h-80 overflow-auto outline-none"
        >
          {STATUS_GROUPS.map(({ key, statuses }) => (
            <MenuItem
              key={key}
              id={key}
              textValue={key}
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
                  {/* Any state of the group renders the group's own badge:
                      the badge is what a person is picking here, and it must
                      not spin in a menu. */}
                  <StatusBadge status={statuses[0]} noSpin />
                </>
              )}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

// SearchFilter is a chip that opens a popover with a search box and a checkbox
// list - for facets with many values (teams, products) where typing to narrow
// down is faster than scanning. Empty selection means "no filter" (show all).
function SearchFilter({
  label,
  searchPlaceholder,
  options,
  selected,
  onChange,
}: {
  label: string;
  searchPlaceholder: string;
  options: string[];
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = q
    ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase()))
    : options;
  const toggle = (v: string) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next);
  };
  const active = selected.size > 0;
  return (
    <DialogTrigger>
      <Button
        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
          active
            ? "border-brand-200 bg-brand-50 text-brand-700"
            : "border-slate-200 text-slate-600 hover:bg-slate-50"
        }`}
      >
        {label}
        {active && <span className="text-brand-500">{selected.size}</span>}
        <IconChevronDown size={13} stroke={1.8} className={active ? "text-brand-400" : "text-slate-400"} />
      </Button>
      <Popover className="w-60 rounded-md border border-slate-200 bg-surface shadow-lg outline-none entering:animate-in entering:fade-in">
        <Dialog className="outline-none">
          <div className="border-b border-slate-100 p-2">
            <div className="relative">
              <IconSearch size={14} stroke={1.8} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded-md border border-slate-200 bg-surface py-1 pl-7 pr-2 text-sm outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
              />
            </div>
          </div>
          <ul className="max-h-64 overflow-auto p-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-slate-400">Ничего не найдено</li>
            ) : (
              filtered.map((o) => {
                const isSelected = selected.has(o);
                return (
                  <li key={o}>
                    <button
                      type="button"
                      onClick={() => toggle(o)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-slate-50 focus-visible:bg-slate-50"
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          isSelected ? "border-brand-600 bg-brand-600 text-on-accent" : "border-slate-300"
                        }`}
                      >
                        {isSelected && <IconCheck size={12} stroke={3} />}
                      </span>
                      <span className="truncate text-slate-700">{o}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          {active && (
            <div className="border-t border-slate-100 p-1">
              <button
                type="button"
                onClick={() => onChange(new Set())}
                className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-xs font-medium text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <IconX size={13} stroke={2} />
                Сбросить ({selected.size})
              </button>
            </div>
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

function RowActions({
  isDraft,
  onOpen,
  onContinue,
  onSync,
  onDelete,
}: {
  isDraft: boolean;
  onOpen: () => void;
  onContinue: () => void;
  onSync?: () => void;
  onDelete?: () => void;
}) {
  return (
    <MenuTrigger>
      <Button
        aria-label="Действия"
        className="inline-flex rounded-md p-1 text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <IconDots size={18} stroke={1.7} />
      </Button>
      <Popover className="min-w-44 rounded-md border border-slate-200 bg-surface py-1 shadow-lg outline-none entering:animate-in entering:fade-in">
        <Menu
          className="outline-none"
          onAction={(key) => {
            if (key === "open") onOpen();
            else if (key === "continue") onContinue();
            else if (key === "sync") onSync?.();
            else if (key === "delete") onDelete?.();
          }}
        >
          {isDraft ? (
            <MenuItem id="continue" className="cursor-pointer px-3 py-1.5 text-sm text-slate-700 outline-none focus:bg-slate-50">
              Продолжить
            </MenuItem>
          ) : (
            <MenuItem id="open" className="cursor-pointer px-3 py-1.5 text-sm text-slate-700 outline-none focus:bg-slate-50">
              Открыть
            </MenuItem>
          )}
          {onSync && (
            <MenuItem id="sync" className="cursor-pointer px-3 py-1.5 text-sm text-slate-700 outline-none focus:bg-slate-50">
              Выкатить из Git
            </MenuItem>
          )}
          {onDelete && (
            <MenuItem id="delete" className="cursor-pointer px-3 py-1.5 text-sm text-red-600 outline-none focus:bg-red-50">
              Удалить
            </MenuItem>
          )}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

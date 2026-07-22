import {
  IconArrowUpCircle,
  IconCategory,
  IconChevronDown,
  IconPackageOff,
  IconSearch,
  IconUsersGroup,
  IconX,
} from "@tabler/icons-react";
import {
  Button as AriaButton,
  Select as AriaSelect,
  Input,
  ListBox,
  ListBoxItem,
  Popover,
  SearchField,
} from "react-aria-components";
import { Link, useSearchParams } from "react-router-dom";
import type { CatalogChart, Category } from "../api/types";
import { publisherLabel } from "../api/types";
import { useCatalog } from "../app/CatalogContext";
import { useTeam } from "../app/TeamContext";
import { canModify, useUser } from "../auth/UserContext";
import { AddChartDialog } from "../components/AddChartDialog";
import { categoryIcon, ProductIcon } from "../components/icons";
import { Button, Card, ErrorBox, Spinner } from "../components/ui";
import { isNewer } from "../lib/semver";

type CategoryOf = (id?: string) => Category | undefined;

// isApprovedChart: the chart is published with an order form available - at
// least one orderable version.
function isApprovedChart(c: CatalogChart): boolean {
  const p = c.publication;
  return !!p?.published && (!!p.has_order_view || (p.orderable_versions?.length ?? 0) > 0);
}

// matchesQuery: case-insensitive match over the card's visible texts (name,
// project path, both live and approved descriptions).
function matchesQuery(c: CatalogChart, q: string): boolean {
  return [c.name, `${c.project}/${c.name}`, c.description, c.publication?.approved_description]
    .filter(Boolean)
    .some((s) => (s as string).toLowerCase().includes(q));
}

export function CatalogPage() {
  const { categories, charts, error, loading } = useCatalog();
  const { team } = useTeam();
  const { user } = useUser();
  // Search/filter state lives in the URL (?q=&cat=), so a filtered view can be
  // shared and survives navigation back to the catalog.
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const activeCat = params.get("cat") ?? "";

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  function setParam(key: "q" | "cat", value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const categoryOf: CategoryOf = (id) => categories.find((c) => c.id === id);

  // Charts available to the active team: no allowlist, or allowlist includes it.
  const visible = charts.filter(
    (c) => !team || !c.allowed_teams?.length || c.allowed_teams.includes(team),
  );

  // Category filter chips: only categories that actually hold visible charts.
  const catCounts = new Map<string, number>();
  for (const c of visible) {
    const id = c.publication?.category_id;
    if (id) catCounts.set(id, (catCounts.get(id) ?? 0) + 1);
  }
  const filterCats = categories.filter((c) => (catCounts.get(c.id) ?? 0) > 0);

  const q = query.trim().toLowerCase();
  const filtered = visible.filter((c) => {
    if (activeCat && c.publication?.category_id !== activeCat) return false;
    return !q || matchesQuery(c, q);
  });

  // Approved: published with an order view (passed moderation). The rest:
  // found by the Harbor scan / drafts still in progress or review.
  const approved = filtered.filter(isApprovedChart);
  const others = filtered.filter((c) => !isApprovedChart(c));

  // Notify owners: a version newer than the approved one is out in Harbor for their charts.
  const outdated = visible.filter((c) => {
    const p = c.publication;
    return (
      !!p &&
      canModify(user, p.owner_team) &&
      !!p.approved_view_version &&
      !c.missing &&
      isNewer(c.latest_version, p.approved_view_version)
    );
  });

  const hasFilter = !!q || !!activeCat;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Каталог</h1>
        <AddChartDialog />
      </div>

      {outdated.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <IconArrowUpCircle size={18} stroke={1.8} className="mt-0.5 shrink-0 text-amber-500" />
          <div className="min-w-0">
            <p className="font-medium">В Harbor вышли новые версии ваших чартов</p>
            <p className="mt-0.5 text-amber-700">
              Обновите view под новую схему и согласуйте, чтобы актуализировать данные в каталоге и
              открыть обновление заказов:
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {outdated.map((c) => (
                <Link
                  key={`${c.project}/${c.name}`}
                  to={`/catalog/${c.project}/${c.name}/manage`}
                  className="inline-flex items-center gap-1 rounded-md bg-surface px-2 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100"
                >
                  {c.name}
                  <span className="text-amber-500">
                    {c.publication!.approved_view_version} → {c.latest_version}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Search + category filter. Hidden while the catalog is empty: the
          empty state below explains how services get here. */}
      {visible.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <SearchField
            value={query}
            onChange={(v) => setParam("q", v)}
            aria-label="Поиск по каталогу"
            className="group relative w-full sm:w-72"
          >
            <IconSearch
              size={16}
              stroke={1.8}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <Input
              placeholder="Название или описание..."
              className="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-8 text-sm outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <AriaButton
                onPress={() => setParam("q", "")}
                aria-label="Очистить поиск"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <IconX size={14} stroke={2} />
              </AriaButton>
            )}
          </SearchField>
          {filterCats.length > 1 && (
            <CategoryFilter
              categories={filterCats}
              counts={catCounts}
              total={visible.length}
              value={activeCat}
              onChange={(id) => setParam("cat", id)}
            />
          )}
        </div>
      )}

      {/* One continuous catalog: published cards first (no section header),
          unpublished ones after a thin labelled divider, rendered muted. */}
      {approved.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {approved.map((c) => (
            <ChartCard key={`${c.project}/${c.name}`} chart={c} categoryOf={categoryOf} />
          ))}
        </div>
      )}
      {others.length > 0 && (
        <>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-slate-200" />
            <span className="text-xs text-slate-400">не опубликованы</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {others.map((c) => (
              <ChartCard key={`${c.project}/${c.name}`} chart={c} categoryOf={categoryOf} muted />
            ))}
          </div>
        </>
      )}

      {visible.length === 0 ? (
        <EmptyState
          title="Каталог пуст"
          text={
            team
              ? `Для группы ${team} пока нет доступных сервисов. Добавьте сервис из Harbor - или дождитесь, пока его опубликует владелец.`
              : "Добавьте сервис из Harbor через «Добавить сервис» - или включите автодискавери, и найденные чарты появятся здесь."
          }
        />
      ) : (
        filtered.length === 0 &&
        hasFilter && (
          <EmptyState
            title="Ничего не найдено"
            text={`По запросу${q ? ` «${query.trim()}»` : ""}${activeCat ? ` в категории «${categoryOf(activeCat)?.label ?? activeCat}»` : ""} сервисов нет. Попробуйте изменить запрос или сбросить фильтры.`}
          >
            <Button
              onPress={() => {
                setParams(new URLSearchParams(), { replace: true });
              }}
            >
              Сбросить фильтры
            </Button>
          </EmptyState>
        )
      )}
    </div>
  );
}

// CategoryFilter: a compact dropdown next to the search box. Scales to any
// number of categories (unlike a chip row); an active filter tints the trigger.
function CategoryFilter({
  categories,
  counts,
  total,
  value,
  onChange,
}: {
  categories: Category[];
  counts: Map<string, number>;
  total: number;
  value: string;
  onChange: (id: string) => void;
}) {
  const current = categories.find((c) => c.id === value);
  return (
    <AriaSelect
      selectedKey={value || "all"}
      onSelectionChange={(k) => onChange(k === "all" ? "" : String(k))}
      aria-label="Категория"
      className="inline-flex"
    >
      <AriaButton
        className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 ${
          value
            ? "border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100"
            : "border-gray-300 bg-surface text-slate-600 hover:bg-slate-50"
        }`}
      >
        <IconCategory
          size={15}
          stroke={1.8}
          className={value ? "text-brand-500" : "text-slate-400"}
          aria-hidden
        />
        {current?.label ?? "Все категории"}
        <IconChevronDown
          size={14}
          stroke={2}
          className={value ? "text-brand-400" : "text-slate-400"}
          aria-hidden
        />
      </AriaButton>
      <Popover className="min-w-[var(--trigger-width)] rounded-md border border-slate-200 bg-surface shadow-lg entering:animate-in entering:fade-in">
        <ListBox className="max-h-80 overflow-auto p-1 outline-none">
          <ListBoxItem
            id="all"
            textValue="Все категории"
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none focus:bg-brand-50 selected:bg-brand-100"
          >
            <IconCategory size={15} stroke={1.8} className="text-slate-400" aria-hidden />
            Все категории
            <span className="ml-auto pl-3 text-xs text-slate-400">{total}</span>
          </ListBoxItem>
          {categories.map((cat) => {
            const Icon = categoryIcon(cat.icon ?? "");
            return (
              <ListBoxItem
                key={cat.id}
                id={cat.id}
                textValue={cat.label}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none focus:bg-brand-50 selected:bg-brand-100"
              >
                <Icon size={15} stroke={1.8} className="text-slate-400" aria-hidden />
                {cat.label}
                <span className="ml-auto pl-3 text-xs text-slate-400">{counts.get(cat.id) ?? 0}</span>
              </ListBoxItem>
            );
          })}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}

// EmptyState: a friendly centered block instead of a blank screen (fresh
// installation, or a search/filter with no hits).
function EmptyState({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-slate-200 bg-surface px-6 py-14 text-center shadow-sm">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <IconPackageOff size={24} stroke={1.6} />
      </span>
      <div>
        <p className="text-sm font-semibold text-slate-700">{title}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{text}</p>
      </div>
      {children}
    </div>
  );
}

// ChartCard: one catalog entry. muted renders the unpublished variant: dashed
// border and toned-down icon/text, so drafts read as secondary at a glance.
function ChartCard({
  chart: c,
  categoryOf,
  muted = false,
}: {
  chart: CatalogChart;
  categoryOf: CategoryOf;
  muted?: boolean;
}) {
  const pub = c.publication;
  const approved = isApprovedChart(c);
  const orderable = pub?.orderable_versions ?? [];
  // Approved charts show a snapshot (version + description + icon at approve time),
  // not the live Harbor data; the rest show live data. For approved charts take the
  // icon strictly from the snapshot (even if empty), else a new version's icon leaks.
  // Main chip: recommended (or highest orderable) version, else the live latest.
  const version =
    (approved && (pub?.recommended_version || orderable[0] || pub?.approved_view_version)) ||
    c.latest_version;
  // Other orderable versions beyond the main one, shown as "+N" with a tooltip.
  const extraVersions = orderable.filter((v) => v !== version);
  const description = (approved && pub?.approved_description) || c.description;
  const category = categoryOf(pub?.category_id);
  const CatIcon = categoryIcon(category?.icon ?? "");
  return (
    <Link to={`/catalog/${c.project}/${c.name}`} className="group block h-full">
      <Card
        className={`flex h-full flex-col transition group-hover:border-brand-400 group-hover:shadow-md ${muted ? "border-dashed" : ""}`}
      >
        <div className="flex items-start gap-3">
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition group-hover:bg-brand-50 group-hover:text-brand-600 ${
              muted ? "bg-slate-50 text-slate-400" : "bg-slate-100 text-slate-600"
            }`}
          >
            <ProductIcon project={c.project} name={c.name} size={24} />
          </span>
          <div className="min-w-0 flex-1">
            {/* Published state needs no badge here: the grid split (divider +
                muted variant) already communicates it. */}
            <h2
              className={`truncate font-semibold transition-colors group-hover:text-brand-700 ${
                muted ? "text-slate-700" : "text-gray-900"
              }`}
            >
              {c.name}
            </h2>
            <p
              className={`mt-1 line-clamp-2 min-h-[2.5rem] text-sm ${muted ? "text-slate-500" : "text-gray-600"}`}
            >
              {description}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 text-xs text-gray-500">
          {c.missing ? (
            <span
              title="Публикация ссылается на чарт, которого больше нет в Harbor"
              className="rounded bg-red-50 px-2 py-0.5 text-red-700"
            >
              нет в Harbor
            </span>
          ) : (
            <span
              title={approved ? "Рекомендуемая версия" : "Последняя версия в Harbor"}
              className="rounded bg-gray-100 px-2 py-0.5 font-mono"
            >
              v{version}
            </span>
          )}
          {!c.missing && extraVersions.length > 0 && (
            <span
              title={`Доступные версии: ${orderable.join(", ")}`}
              className="rounded bg-gray-100 px-2 py-0.5 text-gray-500"
            >
              +{extraVersions.length}
            </span>
          )}
          {category && (
            <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5">
              <CatIcon size={12} stroke={1.8} className="text-gray-400" aria-hidden />
              {category.label}
            </span>
          )}
          {pub && (
            <span
              title={`Владелец: ${pub.owner_team}${pub.created_by_name ? ` · ${publisherLabel(pub.created_by)}: ${pub.created_by_name}` : ""}`}
              className="inline-flex items-center gap-1 rounded bg-brand-50 px-2 py-0.5 text-brand-700"
            >
              <IconUsersGroup size={12} stroke={1.8} className="text-brand-400" aria-hidden />
              {pub.owner_team}
            </span>
          )}
          {c.allowed_teams && c.allowed_teams.length > 0 && (
            <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700">
              teams: {c.allowed_teams.join(", ")}
            </span>
          )}
        </div>
      </Card>
    </Link>
  );
}

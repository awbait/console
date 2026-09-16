import {
  IconCategory,
  IconChevronDown,
  IconLayoutGrid,
  IconList,
  IconPackageOff,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useRef } from "react";
import {
  Button as AriaButton,
  Select as AriaSelect,
  Input,
  ListBox,
  ListBoxItem,
  Popover,
  SearchField,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from "react-aria-components";
import { useSearchParams } from "react-router-dom";
import type { CatalogChart, Category } from "../api/types";
import { useCatalog } from "../app/CatalogContext";
import { CAPABILITIES } from "../app/capabilities";
import { usePlatformHealth } from "../app/PlatformHealthContext";
import { useTeam } from "../app/TeamContext";
import { noTeamNotice } from "../auth/access";
import { useTeamLabel, useUser } from "../auth/UserContext";
import { AddChartDialog } from "../components/AddChartDialog";
import { categoryIcon } from "../components/icons";
import { Button, OutageState, SkeletonCards } from "../components/ui";
import { CatalogCards, CatalogList } from "../features/catalog/CatalogItems";
import { canManageChart, isOrderableChart } from "../features/catalog/catalogModel";
import { useStored } from "../hooks/useStored";
import "../features/catalog/catalog.css";

function matchesQuery(chart: CatalogChart, query: string): boolean {
  return [
    chart.name,
    `${chart.project}/${chart.name}`,
    chart.description,
    chart.publication?.approved_description,
  ].some((value) => value?.toLowerCase().includes(query));
}

export function CatalogPage() {
  const { categories, charts, error, loading, reload } = useCatalog();
  const { user } = useUser();
  const { team } = useTeam();
  const teamLabel = useTeamLabel();
  const { blockedReason } = usePlatformHealth();
  const [params, setParams] = useSearchParams();
  const [storedView, setView] = useStored<"cards" | "list">("catalog.view", "cards");
  const view = storedView === "list" ? "list" : "cards";
  const resultsRef = useRef<HTMLDivElement>(null);
  const query = params.get("q") ?? "";
  const activeCat = params.get("cat") ?? "";
  const canPublish = user?.role === "admin" || !!user?.teams?.length;
  const tab = canPublish && params.get("tab") === "unpublished" ? "unpublished" : "available";
  const unpublished = tab === "unpublished";
  const q = query.trim().toLowerCase();
  const hasFilter = !!q || !!activeCat;
  const orderDisabled = noTeamNotice(user)?.short ?? blockedReason("ordering");

  // Search, category and tab can be shared. View density is a local preference.
  function setParam(key: "q" | "cat" | "tab", value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const visible = charts.filter((c) => !team || !c.allowed_teams?.length || c.allowed_teams.includes(team));
  const available = visible.filter(isOrderableChart);
  const drafts = visible.filter((c) => !isOrderableChart(c) && canManageChart(c, user));
  const current = unpublished ? drafts : available;
  const filtered = current.filter(
    (c) => (!activeCat || c.publication?.category_id === activeCat) && (!q || matchesQuery(c, q)),
  );
  const counts = new Map<string, number>();
  for (const chart of current) {
    const id = chart.publication?.category_id;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  // Keep the active category when another tab/team has no services in it.
  const filterCategories = categories.filter((c) => counts.has(c.id) || c.id === activeCat);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the result scope or view changes, not during background refreshes.
  useEffect(() => {
    resultsRef.current?.scrollTo({ top: 0, left: 0 });
  }, [query, activeCat, tab, team, view]);

  if (loading) return <SkeletonCards count={6} className="mt-2" />;
  if (error)
    return (
      <OutageState title="Каталог сейчас недоступен" message={CAPABILITIES.catalog.impact} onRetry={reload} />
    );

  const itemsProps = {
    charts: filtered,
    categories,
    showCategory: !activeCat,
    unpublished,
    disabledReason: orderDisabled,
  };
  return (
    <Tabs
      selectedKey={tab}
      onSelectionChange={(key) => setParam("tab", key === "unpublished" ? "unpublished" : "")}
      className="catalog-page"
    >
      <div className="catalog-heading">
        <div>
          <h1 className="text-xl font-semibold">Каталог</h1>
          <p className="mt-1 text-sm text-slate-500">Сервисы для вашего проекта</p>
        </div>
        <AddChartDialog />
      </div>
      <TabList aria-label="Раздел каталога" className="catalog-tabs">
        <Tab id="available" className="catalog-tab">
          Доступные сервисы<span className="catalog-count">{available.length}</span>
        </Tab>
        {canPublish && (
          <Tab id="unpublished" className="catalog-tab">
            Неопубликованные<span className="catalog-count">{drafts.length}</span>
          </Tab>
        )}
      </TabList>
      <div className="catalog-toolbar">
        <SearchField
          value={query}
          onChange={(value) => setParam("q", value)}
          aria-label="Поиск по каталогу"
          className="catalog-search"
        >
          <IconSearch size={16} stroke={1.8} className="catalog-search-icon" aria-hidden />
          <Input placeholder="Название или описание..." className="catalog-search-input" />
          {query && (
            <AriaButton
              onPress={() => setParam("q", "")}
              aria-label="Очистить поиск"
              className="catalog-search-clear"
            >
              <IconX size={14} aria-hidden />
            </AriaButton>
          )}
        </SearchField>
        <CategoryFilter
          categories={filterCategories}
          counts={counts}
          total={current.length}
          value={activeCat}
          onChange={(value) => setParam("cat", value)}
        />
        <fieldset aria-label="Вид каталога" className="catalog-view-switch">
          <AriaButton
            aria-label="Карточки"
            aria-pressed={view === "cards"}
            onPress={() => setView("cards")}
            className="catalog-view-button"
          >
            <IconLayoutGrid size={18} aria-hidden />
          </AriaButton>
          <AriaButton
            aria-label="Список"
            aria-pressed={view === "list"}
            onPress={() => setView("list")}
            className="catalog-view-button"
          >
            <IconList size={18} aria-hidden />
          </AriaButton>
        </fieldset>
      </div>
      {hasFilter && (
        <div className="catalog-filter-summary" role="status">
          <span>Найдено: {filtered.length}</span>
          <AriaButton
            className="catalog-reset"
            onPress={() => {
              const next = new URLSearchParams(params);
              next.delete("q");
              next.delete("cat");
              setParams(next, { replace: true });
            }}
          >
            Сбросить фильтры
            <IconX size={13} aria-hidden />
          </AriaButton>
        </div>
      )}
      <TabPanel
        id={tab}
        ref={resultsRef}
        className={`catalog-results ${view === "list" ? "catalog-results-list" : ""}`}
      >
        {filtered.length > 0 ? (
          view === "list" ? (
            <CatalogList {...itemsProps} />
          ) : (
            <CatalogCards {...itemsProps} />
          )
        ) : hasFilter ? (
          <EmptyState title="Ничего не найдено" text="Попробуйте изменить запрос или сбросить фильтры." />
        ) : unpublished ? (
          <EmptyState
            title="Нет неопубликованных сервисов"
            text="Здесь появятся сервисы, которые вы готовите к публикации."
          />
        ) : (
          <EmptyState
            title="Пока нет доступных сервисов"
            text={
              team
                ? `Для проекта ${teamLabel(team)} пока нет сервисов, готовых к заказу.`
                : "Доступные сервисы появятся здесь после публикации."
            }
          >
            {canPublish && drafts.length > 0 && (
              <Button onPress={() => setParam("tab", "unpublished")}>Посмотреть неопубликованные</Button>
            )}
          </EmptyState>
        )}
      </TabPanel>
    </Tabs>
  );
}

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
  // Shared links can refer to a category removed after the link was created.
  const options =
    value && !current ? [...categories, { id: value, label: "Недоступная категория", sort: 0 }] : categories;
  return (
    <AriaSelect
      selectedKey={value || "all"}
      onSelectionChange={(key) => onChange(key === "all" ? "" : String(key))}
      aria-label="Категория"
      className="catalog-category-filter"
    >
      {({ isOpen }) => (
        <>
          <AriaButton className={`catalog-category-trigger ${value ? "catalog-category-active" : ""}`}>
            <IconCategory size={16} aria-hidden />
            <span>{current?.label ?? (value ? "Недоступная категория" : "Все категории")}</span>
            <IconChevronDown
              size={14}
              className={`shrink-0 transition-transform motion-reduce:transition-none ${isOpen ? "rotate-180" : ""}`}
              aria-hidden
            />
          </AriaButton>
          <Popover className="min-w-[var(--trigger-width)] max-w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-surface p-1 shadow-lg outline-none entering:animate-in entering:fade-in entering:duration-150 motion-reduce:animate-none">
            <ListBox className="catalog-category-options">
              <ListBoxItem id="all" textValue="Все категории" className="catalog-category-option">
                <IconCategory size={15} aria-hidden />
                <span>Все категории</span>
                <span className="catalog-option-count">{total}</span>
              </ListBoxItem>
              {options.map((category) => {
                const Icon = categoryIcon(category.icon ?? "", category.id);
                return (
                  <ListBoxItem
                    key={category.id}
                    id={category.id}
                    textValue={category.label}
                    className="catalog-category-option"
                  >
                    <Icon size={15} aria-hidden />
                    <span>{category.label}</span>
                    <span className="catalog-option-count">{counts.get(category.id) ?? 0}</span>
                  </ListBoxItem>
                );
              })}
            </ListBox>
          </Popover>
        </>
      )}
    </AriaSelect>
  );
}

function EmptyState({ title, text, children }: { title: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="catalog-empty">
      <IconPackageOff size={28} stroke={1.6} aria-hidden />
      <h2>{title}</h2>
      <p>{text}</p>
      {children}
    </div>
  );
}

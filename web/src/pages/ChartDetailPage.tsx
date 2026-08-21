import { IconCategory, IconTag, IconUser, IconUsersGroup } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { qk } from "../api/queryKeys";
import type { ChartPublication } from "../api/types";
import { AUTO_DISCOVERY_ACTOR, isUnclaimed, publisherLabel } from "../api/types";
import { findCatalogChart, useCatalog } from "../app/CatalogContext";
import { CAPABILITIES } from "../app/capabilities";
import { usePlatformHealth } from "../app/PlatformHealthContext";
import { canModify, useUser } from "../auth/UserContext";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Changelog, withContent } from "../components/Changelog";
import { ProductIcon } from "../components/icons";
import { Markdown } from "../components/Markdown";
import { Button, Card, Chip, LinkButton, OutageState, Skeleton, SkeletonText } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { isNewer } from "../lib/semver";

export function ChartDetailPage() {
  const { project = "", name = "" } = useParams();
  const {
    data: chart,
    error,
    loading,
    reload,
  } = useAsync(() => api.getChart(project, name), [project, name], qk.chart(project, name));
  const { categories, charts: catalogCharts } = useCatalog();
  const { blockedReason } = usePlatformHealth();
  const { user } = useUser();
  const pub = findCatalogChart(catalogCharts, project, name)?.publication;
  // "Manage" for owners/admins; "Publish" (no publication yet) for any team
  // member (they pick the owner team at registration). An unclaimed
  // auto-discovered publication is also open to team members - the manage page
  // offers adopting it (take over ownership).
  const hasTeam = user?.role === "admin" || (user?.teams?.length ?? 0) > 0;
  const manageable = pub
    ? canModify(user, pub.owner_team) || (pub.created_by === AUTO_DISCOVERY_ACTOR && hasTeam)
    : hasTeam;

  // Warm the manage page's data while this page is being read. That page needs
  // the full publication and its stored versions, neither of which this one
  // loads (the header reads the catalog overlay), so without a warm cache
  // pressing "Управление" opens on a full-screen spinner.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!manageable) return;
    const key = qk.publication(project, name);
    void queryClient
      .prefetchQuery({
        queryKey: key,
        queryFn: ({ signal }) => api.findPublication(project, name, signal),
      })
      .then(() => {
        const p = queryClient.getQueryData<ChartPublication | null>(key);
        if (!p) return;
        return queryClient.prefetchQuery({
          queryKey: qk.versions(p.id),
          queryFn: ({ signal }) => api.listVersions(p.id, signal),
        });
      });
  }, [queryClient, manageable, project, name]);

  // Which document is open lives in the address (?tab=changelog), and a version
  // in the hash (#release-2.3.0), so a link can point at a release and not just
  // at the chart. A link that names a version is about the changelog, whatever
  // the query says. Switching by hand replaces the entry rather than stacking
  // it: back should leave the chart, not walk the tabs.
  const location = useLocation();
  const navigate = useNavigate();
  const release = location.hash.startsWith("#release-") ? location.hash.slice(1) : undefined;
  const tab = release || location.search.includes("tab=changelog") ? "changelog" : "readme";
  // Where the travelling mark stands: the open tab's place in the strip,
  // measured after every switch and again if the strip itself changes size (a
  // window resize, a font that lands late).
  const strip = useRef<HTMLDivElement>(null);
  const [mark, setMark] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const box = strip.current;
    if (!box) return;
    const measure = () => {
      const active = box.querySelector<HTMLElement>('[role="tab"][data-selected]');
      if (active) setMark({ left: active.offsetLeft, width: active.offsetWidth });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
    // `chart` because the strip does not exist while the page is still loading.
  }, [tab, chart]);

  const openTab = (key: string) => {
    if (key === tab && !release) return;
    // The mark leaves with the press, not after the address has changed and the
    // page has re-rendered: a slide that starts a tenth of a second late is a
    // slide that looks like it is catching up.
    const target = strip.current?.querySelector<HTMLElement>(`[role="tab"][data-key="${key}"]`);
    if (target) setMark({ left: target.offsetLeft, width: target.offsetWidth });
    navigate(
      { pathname: location.pathname, search: key === "changelog" ? "?tab=changelog" : "", hash: "" },
      { replace: true },
    );
  };

  if (loading) return <ChartSkeleton />;
  if (error)
    return (
      <OutageState
        title="Сервис сейчас не открывается"
        message={CAPABILITIES.catalog.impact}
        onRetry={reload}
      />
    );
  if (!chart) return null;

  // The profile shows the APPROVED version (like the catalog), not the live one
  // from Harbor: version, description, icon are the snapshot at approve time. The
  // live latest is only used to tell if an update is out in Harbor (nudge to "Manage").
  const liveVersion = chart.latest_version;
  const published = !!pub?.published;
  const version = (published && pub?.approved_view_version) || liveVersion;
  const description = (published && pub?.approved_description) || chart.description;
  // Ordering is open only for publications with an approved order-view; it leads
  // to the product page (its order list).
  // Ordering also needs the platform behind it: an approved form is useless
  // while the order cannot be filed at all.
  const orderOutage = blockedReason("ordering");
  const orderable = !!pub?.published && !!pub?.has_order_view && !orderOutage;
  const categoryLabel = categories.find((c) => c.id === pub?.category_id)?.label;
  // A version newer than the approved one is in Harbor: time for the owner to
  // refresh the data (mark the "Manage" button with a dot).
  const viewOutdated =
    !!pub?.approved_view_version && isNewer(liveVersion, pub.approved_view_version);

  return (
    // Who the chart is stays on screen: the name, what it is for and the
    // version are the frame the document is read in, and a page that scrolls
    // them away makes the reader scroll back to check. So the page keeps the
    // height of the window, the head keeps its size, and the open document
    // takes every pixel left - which is what the gaps here are kept short for.
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="flex shrink-0 items-start justify-between gap-6">
        <div className="min-w-0">
          <Breadcrumbs
            items={[
              { label: "Каталог", to: "/catalog" },
              { label: `${chart.project}/${chart.name}` },
            ]}
          />
          <h1 className="mt-2 flex items-center gap-2 text-xl font-semibold">
            <ProductIcon project={chart.project} name={chart.name} size={24} />
            {chart.project}/{chart.name}
          </h1>
          {/* Keep the summary at a readable measure instead of letting it run
              the full width of a wide screen. */}
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-600">{description}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Chip className="bg-slate-100 text-slate-600">
              <IconTag size={13} stroke={1.8} className="text-slate-400" />
              <span className="text-slate-400">Версия:</span>v{version}
            </Chip>
            {categoryLabel && (
              <Chip className="bg-slate-100 text-slate-600">
                <IconCategory size={13} stroke={1.8} className="text-slate-400" />
                <span className="text-slate-400">Категория:</span>
                {categoryLabel}
              </Chip>
            )}
            {pub && !isUnclaimed(pub) && (
              <Chip className="bg-brand-50 text-brand-700">
                <IconUsersGroup size={13} stroke={1.8} className="text-brand-400" />
                <span className="text-brand-400">Владелец:</span>
                {pub.owner_team}
              </Chip>
            )}
            {pub?.created_by_name && (
              <Chip className="bg-slate-100 text-slate-600">
                <IconUser size={13} stroke={1.8} className="text-slate-400" />
                <span className="text-slate-400">{publisherLabel(pub.created_by)}:</span>
                {pub.created_by_name}
              </Chip>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {manageable && (
            <LinkButton to={`/catalog/${project}/${name}/manage`} className="relative">
              {pub ? "Управление" : "Опубликовать"}
              {pub && viewOutdated && (
                <span
                  title="В Harbor есть новая версия чарта - актуализируйте данные"
                  className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-surface"
                />
              )}
            </LinkButton>
          )}
          {orderable ? (
            <LinkButton variant="primary" to={`/products/${project}/${name}`}>
              Заказать
            </LinkButton>
          ) : (
            <span title={orderOutage ?? "Форма заказа не согласована для этого чарта"}>
              <Button variant="primary" isDisabled>
                Заказать
              </Button>
            </span>
          )}
        </div>
      </div>

      {/* The tabs are the head of the document, not a strip floating above a
          box of its own: one panel with its name on top, the way the document
          would be filed. It takes the height it needs and no more - a page of
          empty card under two lines of text is a frame around nothing. */}
      <Tabs
        selectedKey={tab}
        onSelectionChange={(key) => openTab(String(key))}
        className="flex min-h-0 flex-1 flex-col"
      >
        <Card padded={false} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* The mark under the open tab is one line that travels, not two that
              take turns being painted: the eye follows it across and knows
              where it went. It is drawn outside the tabs so it can slide past
              them; the tabs keep a transparent border of the same weight for
              the grey the pointer draws. */}
          <div ref={strip} className="relative shrink-0">
            <TabList
              aria-label="Документация чарта"
              className="flex gap-1 border-b border-gray-200 px-3 pt-1"
            >
              <DocTab id="readme">Описание</DocTab>
              <DocTab id="changelog">Изменения</DocTab>
            </TabList>
            {mark && (
              <span
                aria-hidden
                style={{ left: mark.left, width: mark.width }}
                className="pointer-events-none absolute -bottom-px h-0.5 rounded-full bg-brand-600 transition-[left,width] duration-300 ease-out motion-reduce:transition-none"
              />
            )}
          </div>
          {/* The document arrives rather than replaces: switching tabs swaps
              one wall of text for another, and without the fade the eye has to
              find out from the text itself that anything happened. */}
          <TabPanel
            id="readme"
            className="flex min-h-0 flex-1 flex-col outline-none animate-in fade-in duration-200 motion-reduce:animate-none"
          >
            <Readme project={project} name={name} version={version} />
          </TabPanel>
          <TabPanel
            id="changelog"
            className="flex min-h-0 flex-1 flex-col outline-none animate-in fade-in duration-200 motion-reduce:animate-none"
          >
            <ChartChangelog project={project} name={name} highlight={release} />
          </TabPanel>
        </Card>
      </Tabs>
    </div>
  );
}

// The page's own shape while it loads: title, description, chips, tabs. Sized
// like the real header so the content does not jump when it lands.
function ChartSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="shrink-0">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="mt-3 h-7 w-72" />
        <Skeleton className="mt-3 h-4 w-full max-w-2xl" />
        <Skeleton className="mt-2 h-4 w-2/3 max-w-md" />
        <div className="mt-4 flex gap-2">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-28 rounded-full" />
        </div>
      </div>
      <div className="flex gap-2 border-b border-gray-200 pb-2">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-24" />
      </div>
      <SkeletonText lines={7} />
    </div>
  );
}

function DocTab({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <Tab
      id={id}
      // The hover draws the same underline in grey, so the pointer shows where
      // the mark would move. Not on the open tab: there the mark is already
      // where it belongs, and a grey line over the blue one would read as
      // losing the place rather than as pointing at it.
      className="-mb-px cursor-pointer border-b-2 border-transparent px-4 py-3 text-sm font-medium text-gray-500 outline-none transition-colors hover:bg-gray-50 hover:text-gray-700 selected:text-brand-700 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 [&:not([data-selected])]:hover:border-gray-300"
    >
      {children}
    </Tab>
  );
}

function Readme({ project, name, version }: { project: string; name: string; version: string }) {
  const { data, error, loading } = useAsync(
    () => api.getReadme(project, name, version),
    [project, name, version],
    qk.readme(project, name, version),
  );
  return (
    // A readable measure rather than the full width of a wide screen: a README
    // is prose, and prose across 1500 pixels is read by nobody.
    <div className="min-h-0 flex-1 overflow-y-auto py-5 pl-5 pr-3 [scrollbar-gutter:stable]">
      <div className="max-w-3xl">
        {loading ? (
          <SkeletonText lines={8} />
        ) : error || !data?.trim() ? (
          <p className="text-sm text-gray-500">Чарт не приложил описание.</p>
        ) : (
          <Markdown>{data}</Markdown>
        )}
      </div>
    </div>
  );
}

function ChartChangelog({
  project,
  name,
  highlight,
}: {
  project: string;
  name: string;
  highlight?: string;
}) {
  const { data, error, loading } = useAsync(
    () => api.getAggregatedChangelog(project, name),
    [project, name],
    qk.changelog(project, name),
  );
  if (loading) return <SkeletonText lines={6} className="p-5" />;
  const notes = data ? withContent(data) : [];
  if (error || notes.length === 0)
    return <p className="p-5 text-sm text-gray-500">Чарт не ведёт историю изменений.</p>;
  // Every version of the chart, folded to a line each and read the same way as
  // the portal's own history on the About page.
  return (
    // The rows carry their own inset, so the sides are short by it and the
    // version numbers stand on the same left edge as the tab above them. The
    // list scrolls in a box of a height of its own, so the releases at the end
    // of it get the run-up they need to reach the top edge.
    <div className="min-h-0 flex-1 overflow-y-auto py-4 pl-3 pr-2 [scrollbar-gutter:stable]">
      <Changelog entries={notes} highlight={highlight} roomBelow />
    </div>
  );
}

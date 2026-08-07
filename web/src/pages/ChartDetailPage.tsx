import { IconCategory, IconTag, IconUser, IconUsersGroup } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { CATALOG_DOWN_HINT } from "../api/errorText";
import { qk } from "../api/queryKeys";
import type { ChartPublication } from "../api/types";
import { AUTO_DISCOVERY_ACTOR, publisherLabel } from "../api/types";
import { findCatalogChart, useCatalog } from "../app/CatalogContext";
import { canModify, useUser } from "../auth/UserContext";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Changelog } from "../components/Changelog";
import { ProductIcon } from "../components/icons";
import { Markdown } from "../components/Markdown";
import { Button, Card, Chip, ErrorBox, LinkButton, Skeleton, SkeletonText } from "../components/ui";
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

  if (loading) return <ChartSkeleton />;
  if (error) return <ErrorBox error={error} hint={CATALOG_DOWN_HINT} onRetry={reload} />;
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
  const orderable = !!pub?.published && !!pub?.has_order_view;
  const categoryLabel = categories.find((c) => c.id === pub?.category_id)?.label;
  // A version newer than the approved one is in Harbor: time for the owner to
  // refresh the data (mark the "Manage" button with a dot).
  const viewOutdated =
    !!pub?.approved_view_version && isNewer(liveVersion, pub.approved_view_version);

  return (
    // The page itself stays within the viewport: the header keeps its size and
    // only the open doc tab scrolls, so the shell never grows a scrollbar of its
    // own.
    <div className="flex min-h-0 flex-1 flex-col gap-6">
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
          <div className="mt-4 flex flex-wrap items-center gap-2">
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
            {pub && (
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
            <span title="Форма заказа не согласована для этого чарта">
              <Button variant="primary" isDisabled>
                Заказать
              </Button>
            </span>
          )}
        </div>
      </div>

      <Tabs className="flex min-h-0 flex-1 flex-col">
        <TabList
          aria-label="Документация чарта"
          className="flex shrink-0 gap-2 border-b border-gray-200"
        >
          <DocTab id="readme">Описание</DocTab>
          <DocTab id="changelog">Изменения</DocTab>
        </TabList>
        {/* The panel only sizes the card; the scrolling happens inside it. */}
        <TabPanel id="readme" className="flex min-h-0 flex-1 flex-col pt-5 outline-none">
          <Readme project={project} name={name} version={version} />
        </TabPanel>
        <TabPanel id="changelog" className="flex min-h-0 flex-1 flex-col pt-5 outline-none">
          <ChartChangelog project={project} name={name} />
        </TabPanel>
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
      className="-mb-px cursor-pointer border-b-2 border-transparent px-3 py-2 text-sm font-medium text-gray-500 outline-none transition-colors hover:text-gray-700 selected:border-brand-600 selected:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500"
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
    <Card padded={false} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto p-4">
        {loading ? (
          <SkeletonText lines={8} />
        ) : error || !data?.trim() ? (
          <p className="text-sm text-gray-500">Описание недоступно.</p>
        ) : (
          <Markdown>{data}</Markdown>
        )}
      </div>
    </Card>
  );
}

function ChartChangelog({ project, name }: { project: string; name: string }) {
  const { data, error, loading } = useAsync(
    () => api.getAggregatedChangelog(project, name),
    [project, name],
    qk.changelog(project, name),
  );
  if (loading) return <SkeletonText lines={6} />;
  if (error || !data?.length)
    return <p className="text-sm text-gray-500">История изменений недоступна.</p>;
  return (
    <Card padded={false} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto p-4">
        <Changelog entries={data} />
      </div>
    </Card>
  );
}

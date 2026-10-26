import { IconChevronDown } from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { useParams } from "react-router-dom";
import { api } from "@/api/client";
import { qk } from "@/api/queryKeys";
import type { ChartPublication, PublicationEvent } from "@/api/types";
import { chartLabel, useCatalog } from "@/app/CatalogContext";
import { useTeamLabel } from "@/auth/UserContext";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ErrorBox, LinkButton, Loading } from "@/components/ui";
import { adminPublicationText as t } from "@/features/publications/adminPublicationText";
import { IssuePill } from "@/features/publications/IssuePill";
import { actorLabel, describeEvent } from "@/features/publications/journal";
import { registryText } from "@/features/publications/registryText";
import { useAsync } from "@/hooks/useAsync";
import { fmtDateTime, fmtRecent } from "@/lib/time";
import { PublicationOverview } from "./ChartManagePage";

// AdminPublicationPage is a publication as the admin works with it, inside the
// admin section: the registry row leads here, and the crumbs lead back. It is
// the same overview the owners get on the catalog's management page (category,
// owner, versions), with what the admin asks about on top of it: what is wrong
// with the publication, how many orders run on it (the list itself is the
// orders page, filtered to the service), and its journal.
//
// The admin's category and owner changes apply at once - the server decides
// so by role - which is why the overview shows no proposal state here.

const PAGE = 10;

export function AdminPublicationPage() {
  const { project = "", name = "" } = useParams();
  const {
    data: pub,
    loading,
    error,
    reload: reloadPub,
  } = useAsync((signal) => api.findPublication(project, name, signal), [project, name], qk.publication(project, name));
  // The registry row carries the server's verdict on the publication (issue
  // codes, order counts); the list is shared with the registry page's cache.
  const { data: rows, reload: reloadRows } = useAsync((s) => api.adminPublications(s), [], qk.registry());
  const row = rows?.find((r) => r.publication.id === pub?.id) ?? null;

  const parent = { label: registryText.title, to: "/admin/approvals" };

  if (loading && !pub) return <Loading label={registryText.redirectLoading} />;
  if (error && !pub) return <ErrorBox error={error} />;
  if (!pub) {
    return (
      <div className="flex flex-col gap-5">
        <Breadcrumbs items={[parent, { label: `${project}/${name}` }]} />
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {t.notFound(`${project}/${name}`)}
        </div>
      </div>
    );
  }

  const reload = () => {
    reloadPub();
    reloadRows();
  };
  const ordersTo = `/admin/requests?product=${encodeURIComponent(name)}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PublicationOverview
        key={pub.id}
        pub={pub}
        reload={reload}
        breadcrumbs={[parent, { label: chartLabel(name) }]}
        title={chartLabel(name)}
        subtitle={`${project}/${name}`}
        status={
          row && row.issues.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1">
              {row.issues.map((code) => (
                <IssuePill key={code} code={code} />
              ))}
            </span>
          ) : undefined
        }
        actions={
          <>
            <LinkButton to={ordersTo}>{row ? t.ordersLive(row.orders.live) : t.ordersAll}</LinkButton>
            <LinkButton to={`/catalog/${project}/${name}`}>{t.openCatalog}</LinkButton>
            <LinkButton to={`/catalog/${project}/${name}/manage`}>{t.openManage}</LinkButton>
          </>
        }
        after={<JournalSection pub={pub} />}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The publication's journal
// ---------------------------------------------------------------------------

function JournalSection({ pub }: { pub: ChartPublication }) {
  const { categories } = useCatalog();
  const teamLabel = useTeamLabel();
  const [all, setAll] = useState(false);
  // Re-read when the publication changes under it: every action on the page
  // moves updated_at and writes a row here.
  const { data, loading, error, reload } = useAsync(() => api.getPublication(pub.id), [pub.id, pub.updated_at]);
  const labels = {
    category: (id: string) => categories.find((c) => c.id === id)?.label ?? id,
    team: (id: string) => (id ? teamLabel(id) : ""),
  };
  // Newest first: the journal is read to see what happened last.
  const events = [...(data?.events ?? [])].sort((a, b) => b.id - a.id);
  const shown = all ? events : events.slice(0, PAGE);

  return (
    <Section title={t.journalTitle} count={data ? events.length : undefined}>
      {error && !data ? (
        <ErrorBox error={error} hint={t.journalLoadError} onRetry={reload} />
      ) : loading && !data ? (
        <Loading label={t.journalTitle} />
      ) : events.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-surface py-8 text-center text-sm text-slate-500 shadow-sm">
          {t.journalEmpty}
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-surface shadow-sm">
          <ol className="divide-y divide-slate-100">
            {shown.map((e) => (
              <JournalRow key={e.id} event={e} text={describeEvent(e, labels)} />
            ))}
          </ol>
          {!all && events.length > shown.length && (
            <div className="border-t border-slate-100 px-4 py-2">
              <AriaButton
                onPress={() => setAll(true)}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-slate-500 outline-none transition-colors hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <IconChevronDown size={14} stroke={1.8} aria-hidden />
                {t.journalShowAll}
              </AriaButton>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function JournalRow({ event: e, text }: { event: PublicationEvent; text: string }) {
  return (
    <li className="flex items-start gap-3 px-4 py-2.5 text-sm">
      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-slate-800">{text}</p>
        <p className="text-xs text-slate-500">
          {actorLabel(e)}
          <span className="mx-1.5 text-slate-300" aria-hidden>
            ·
          </span>
          <time dateTime={e.created_at} title={fmtDateTime(e.created_at)}>
            {fmtRecent(e.created_at)}
          </time>
        </p>
      </div>
    </li>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col">
      <div className="mb-3 flex min-h-7 items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        {count !== undefined && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">
            {count}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

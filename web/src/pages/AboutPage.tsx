import { IconExternalLink } from "@tabler/icons-react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { ErrorBox, Spinner } from "../components/ui";

// Friendly labels for the build-metadata rows, in display order.
const META_LABELS: { key: "version" | "commit" | "build_date" | "go_version"; label: string }[] = [
  { key: "version", label: "Версия" },
  { key: "commit", label: "Коммит" },
  { key: "build_date", label: "Дата сборки" },
  { key: "go_version", label: "Go" },
];

export function AboutPage() {
  const { data, error, loading } = useAsync(() => api.getAbout(), []);

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <h1 className="text-xl font-semibold text-slate-900">О портале</h1>

      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} />
      ) : data ? (
        <>
          <Section title="Сборка">
            <dl className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-surface shadow-sm">
              {META_LABELS.map(({ key, label }) => {
                const value = data[key];
                if (!value) return null;
                return (
                  <div key={key} className="flex items-center justify-between gap-4 px-4 py-2.5">
                    <dt className="text-sm text-slate-500">{label}</dt>
                    <dd className="font-mono text-sm text-slate-800">{value}</dd>
                  </div>
                );
              })}
            </dl>
          </Section>

          <Section title="Полезные ссылки">
            <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-surface shadow-sm">
              <InternalLink to="/docs" label="Документация" />
              {data.links.map((l) => (
                <ExternalRow key={l.url} label={l.label} url={l.url} />
              ))}
            </div>
          </Section>

          <Section title="Изменения по версиям">
            <div className="rounded-lg border border-dashed border-slate-200 bg-surface px-4 py-3 text-sm text-slate-400">
              Журнал изменений по версиям появится здесь.
            </div>
          </Section>
        </>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </div>
  );
}

function ExternalRow({ label, url }: { label: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-slate-50"
    >
      <span className="font-medium text-slate-800">{label}</span>
      <span className="inline-flex items-center gap-1 text-brand-600">
        <span className="max-w-[16rem] truncate text-xs">{url}</span>
        <IconExternalLink size={14} stroke={1.8} className="shrink-0" />
      </span>
    </a>
  );
}

function InternalLink({ to, label }: { to: string; label: string }) {
  return (
    <a href={to} className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-slate-50">
      <span className="font-medium text-slate-800">{label}</span>
    </a>
  );
}

import {
  IconArrowUpRight,
  IconBook,
  IconBox,
  IconInfoCircle,
  IconPackages,
} from "@tabler/icons-react";
import { type ReactNode, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api/client";
import { useUser } from "../auth/UserContext";
import { Changelog, withContent } from "../components/Changelog";
import { Card, ErrorBox, SkeletonText } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { isRelease, releaseAnchor } from "../lib/release";

export function AboutPage() {
  const { user } = useUser();
  const about = useAsync(() => api.getAbout(), []);
  const changelog = useAsync(() => api.getChangelog(), []);

  // A link can name a version: /about#release-0.4.0, or #release-unreleased for
  // a build between releases. The notification about a new portal is such a
  // link, and so is anything else that wants to point at what changed.
  //
  // The scroll waits for the changelog: the section does not exist until it has
  // loaded, and scrolling into a skeleton lands nowhere. It also waits a frame
  // after that, because the version it is aimed at opens as it renders and the
  // notes unfold under the header - a scroll measured before that lands on a
  // section that is still growing.
  const { hash } = useLocation();
  const target = hash.replace(/^#/, "");
  const loaded = !!changelog.data;
  useEffect(() => {
    if (!target || !loaded) return;
    const id = requestAnimationFrame(() => {
      document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, [target, loaded]);

  // User-facing portal links (not infra consoles - those live on the status page).
  // The security role has no catalog/orders, so it only gets documentation.
  const platform = user?.role !== "security";
  const links = [
    { to: "/docs", label: "Документация", hint: "Гайды и справка", Icon: IconBook },
    ...(platform
      ? [
          { to: "/catalog", label: "Каталог чартов", hint: "Сервисы для заказа", Icon: IconPackages },
          { to: "/requests", label: "Мои заказы", hint: "Инстансы и статусы", Icon: IconBox },
        ]
      : []),
  ];

  const info = about.data;
  const hasBuild = info && (info.commit || info.build_date);

  // A release leaves an empty [Unreleased] behind, and until something lands
  // under it there is nothing to read there. Asked here rather than inside the
  // list, because the answer decides between a card and "пока нет записей".
  const notes = changelog.data ? withContent(changelog.data) : [];

  // Side by side (lg), the page takes the height of its column and the changelog
  // scrolls inside its card, so the build info and the links stay in sight.
  // Stacked, the height lock would crush the card, so the page scrolls instead.
  return (
    <div className="flex max-w-5xl flex-col gap-6 lg:min-h-0 lg:flex-1">
      <h1 className="shrink-0 text-xl font-semibold text-slate-900">О портале</h1>

      {about.loading && !info ? (
        <SkeletonText lines={4} />
      ) : about.error ? (
        <ErrorBox error={about.error} />
      ) : info ? (
        <>
          {/* Hero */}
          <Card className="flex shrink-0 items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                <IconInfoCircle size={24} stroke={1.7} />
              </span>
              <div>
                <div className="text-base font-semibold text-slate-900">Console</div>
                <div className="text-sm text-slate-500">Заказ и управление сервисами платформы</div>
              </div>
            </div>
            {/* The running version leads to what it changed. A build between
                releases has no section of its own, so it points at the one
                being prepared, which is precisely what such a build carries.
                What kind of build it is belongs in the hint, not in a second
                line under the number. */}
            <a
              href={`#${releaseAnchor(info.version)}`}
              title={
                isRelease(info.version)
                  ? "Что изменилось в этой версии"
                  : "Сборка после последнего релиза, смотрите «Готовится к выпуску»"
              }
              className="shrink-0 rounded-full bg-brand-50 px-3 py-1 font-mono text-sm font-medium text-brand-700 outline-none hover:bg-brand-100 focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {info.version}
            </a>
          </Card>

          <div className="grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-3">
            {/* Main column: changelog */}
            <div className="flex flex-col lg:col-span-2 lg:min-h-0">
              <Section title="Журнал изменений" fill>
                {changelog.loading && !changelog.data ? (
                  <SkeletonText lines={6} />
                ) : changelog.error ? (
                  <ErrorBox error={changelog.error} />
                ) : notes.length > 0 ? (
                  <Card padded={false} className="flex flex-col lg:min-h-0 lg:flex-1">
                    <div className="scroll-slim p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                      <Changelog entries={notes} highlight={target} current={info.version} />
                    </div>
                  </Card>
                ) : (
                  <Card className="text-sm text-slate-400">Пока нет записей.</Card>
                )}
              </Section>
            </div>

            {/* Sidebar: build info + links */}
            <div className="flex flex-col gap-6 lg:min-h-0 lg:overflow-y-auto">
              {hasBuild && (
                <Section title="Сборка">
                  <Card className="flex flex-col gap-2">
                    {info.commit && <Row label="Коммит" value={info.commit} mono />}
                    {info.build_date && <Row label="Дата сборки" value={fmtDate(info.build_date)} />}
                  </Card>
                </Section>
              )}

              <Section title="Полезные ссылки">
                <div className="flex flex-col gap-3">
                  {links.map((l) => (
                    <LinkCard key={l.to} {...l} />
                  ))}
                </div>
              </Section>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

// fill: the section takes the height it is given and hands it to its child, so
// the child can scroll inside instead of growing the page.
function Section({
  title,
  fill = false,
  children,
}: {
  title: string;
  fill?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={fill ? "flex flex-col lg:min-h-0 lg:flex-1" : ""}>
      <h2 className="mb-2 shrink-0 text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h2>
      {children}
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-500">{label}</span>
      <span className={`break-all text-sm text-slate-800 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

// fmtDate renders an RFC3339 build timestamp in the local, human-readable form;
// falls back to the raw value if it does not parse.
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function LinkCard({
  to,
  label,
  hint,
  Icon,
}: {
  to: string;
  label: string;
  hint: string;
  Icon: typeof IconBook;
}) {
  return (
    <Link
      to={to}
      className="group flex items-start gap-3 rounded-lg border border-gray-200 bg-surface p-4 shadow-sm outline-none transition hover:border-brand-300 hover:shadow focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500 group-hover:bg-brand-50 group-hover:text-brand-600">
        <Icon size={20} stroke={1.7} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 font-medium text-slate-800">
          {label}
          <IconArrowUpRight
            size={14}
            stroke={1.8}
            className="text-slate-300 group-hover:text-brand-500"
          />
        </div>
        <div className="mt-0.5 text-xs text-slate-500">{hint}</div>
      </div>
    </Link>
  );
}

import {
  IconAlertTriangle,
  IconCheck,
  IconCircleX,
  IconCopy,
  IconHelpCircle,
  IconMinus,
  IconRefresh,
  IconStar,
} from "@tabler/icons-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { qk } from "../api/queryKeys";
import type { StandCheck } from "../api/types";
import { useToast } from "../app/ToastContext";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { NotFound } from "../components/NotFound";
import { Button, ErrorBox, SkeletonRows } from "../components/ui";
import { standCheckReasons, standText as t } from "../features/stands/text";
import { useAsync } from "../hooks/useAsync";

// Страница стенда: параметры, проверки и манифесты для подключения Argo CD.
// Сюда приходит администратор, который подключает стенд: проверки показывают,
// что уже на месте, манифесты - что осталось применить.

const CHECK_LABEL: Record<string, string> = {
  stand_git: t.checkGit,
  stand_cluster: t.checkCluster,
  stand_argo_app: t.checkArgo,
};

// One row per verdict: the colour says it, the icon repeats it for anybody
// who cannot see the colour.
const VERDICT: Record<string, { tone: string; Icon: typeof IconCheck }> = {
  ok: { tone: "bg-emerald-50 text-emerald-700", Icon: IconCheck },
  warn: { tone: "bg-amber-50 text-amber-700", Icon: IconAlertTriangle },
  fail: { tone: "bg-rose-50 text-rose-700", Icon: IconCircleX },
  skip: { tone: "bg-slate-100 text-slate-500", Icon: IconMinus },
  unknown: { tone: "bg-slate-100 text-slate-500", Icon: IconHelpCircle },
};

export function AdminStandPage() {
  const { id = "" } = useParams();
  const { data: stand, error, loading } = useAsync((signal) => api.getStand(id, signal), [id], qk.stand(id));
  const checks = useAsync((signal) => api.standChecks(id, signal), [id]);
  const manifests = useAsync((signal) => api.standManifests(id, signal), [id]);
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    const text = manifests.data ?? "";
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setCopied(true);
      toast.success(t.manifestsCopied);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the text stays on the page, selectable by hand */
    }
  }

  if (error) {
    return error.message.includes("404") ? (
      <NotFound backTo="/admin/stands" backLabel={t.navLabel} />
    ) : (
      <ErrorBox error={error} />
    );
  }
  if (loading || !stand) return <SkeletonRows rows={4} />;

  const layoutLabel = stand.layout === "repository" ? t.layoutRepository : t.layoutGroup;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="shrink-0">
        <Breadcrumbs items={[{ label: t.navLabel, to: "/admin/stands" }, { label: stand.name }]} />
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{t.pageTitle(stand.name)}</h1>
          {stand.default && (
            <span
              title={t.defaultHint}
              className="inline-flex shrink-0 items-center gap-1 rounded bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700"
            >
              <IconStar size={12} stroke={2} />
              {t.defaultBadge}
            </span>
          )}
        </div>
      </div>

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1 pb-1">
        <section className="rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <Field label={t.clusterAria} value={stand.default_cluster} mono />
            <Field label={t.layoutLabel} value={layoutLabel} />
            <Field label={t.pathLabel} value={stand.git_path} mono />
            {stand.locked && <Field label="" value={t.lockedHint} muted />}
          </dl>
        </section>

        <section className="rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-800">{t.checksTitle}</h2>
              <p className="mt-0.5 max-w-2xl text-sm text-slate-500">{t.checksIntro}</p>
            </div>
            <Button
              variant="secondary"
              onPress={() => checks.reload()}
              isDisabled={checks.loading}
              className="h-[30px] shrink-0 text-xs"
            >
              <IconRefresh size={14} stroke={2} className={checks.loading ? "animate-spin" : ""} />
              {t.checksRerun}
            </Button>
          </div>
          {checks.error && <ErrorBox error={checks.error} />}
          {checks.loading && !checks.data ? (
            <SkeletonRows rows={3} className="mt-3" />
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {(checks.data?.results ?? []).map((c) => (
                <CheckRow key={c.id} check={c} />
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-800">{t.manifestsTitle}</h2>
              <p className="mt-0.5 max-w-2xl text-sm text-slate-500">{t.manifestsIntro}</p>
            </div>
            <Button
              variant="secondary"
              onPress={copy}
              isDisabled={!manifests.data}
              className="h-[30px] shrink-0 text-xs"
            >
              {copied ? <IconCheck size={14} stroke={2} /> : <IconCopy size={14} stroke={2} />}
              {t.manifestsCopy}
            </Button>
          </div>
          {manifests.error && <ErrorBox error={manifests.error} />}
          {manifests.loading ? (
            <SkeletonRows rows={6} className="mt-3" />
          ) : (
            <pre className="mt-3 max-h-[32rem] overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-[12px] leading-5 text-slate-800">
              {manifests.data}
            </pre>
          )}
        </section>

        <p className="text-sm">
          <Link to="/admin/stands" className="text-brand-600 hover:underline">
            {t.navLabel}
          </Link>
        </p>
      </div>
    </div>
  );
}

function Field({ label, value, mono, muted }: { label: string; value: string; mono?: boolean; muted?: boolean }) {
  return (
    <div className={label ? "" : "sm:col-span-2"}>
      {label && <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>}
      <dd className={`${label ? "mt-0.5" : ""} ${mono ? "font-mono text-[13px]" : ""} ${muted ? "text-slate-500" : "text-slate-800"}`}>
        {value}
      </dd>
    </div>
  );
}

function CheckRow({ check }: { check: StandCheck }) {
  const v = VERDICT[check.verdict] ?? VERDICT.unknown;
  const facts = Object.entries(check.facts ?? {}).filter(([k]) => k === "clusters" || k === "missing" || k === "path");
  return (
    <li className="flex items-start gap-3 rounded-md border border-slate-100 px-3 py-2">
      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${v.tone}`}>
        <v.Icon size={14} stroke={2} />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800">{CHECK_LABEL[check.id] ?? check.id}</p>
        <p className="text-sm text-slate-500">{standCheckReasons[check.reason ?? ""] ?? check.reason}</p>
        {facts.length > 0 && (
          <p className="mt-0.5 font-mono text-[12px] text-slate-500">
            {facts.map(([k, val]) => `${k}: ${val}`).join(" · ")}
          </p>
        )}
      </div>
    </li>
  );
}

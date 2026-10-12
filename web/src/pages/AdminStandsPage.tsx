import { IconExternalLink, IconPlus, IconStar } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../api/client";
import { qk } from "../api/queryKeys";
import type { Stand, StandLayout } from "../api/types";
import { useToast } from "../app/ToastContext";
import { Button, ErrorBox, SkeletonRows } from "../components/ui";
import { standText as t } from "../features/stands/text";
import { dnsLabelError, fieldMsg } from "../form/fieldErrors";
import { useAsync } from "../hooks/useAsync";

// Стенды: места, куда уезжают заказы. Страница живёт по тем же правилам, что и
// «Переменные»: правка по месту с сохранением на blur, добавление снизу. Один
// стенд помечен как стенд по умолчанию, и кнопка на остальных переносит эту
// метку. Раскладка и путь в Git задаются при создании и замораживаются, как
// только на стенде появляются заказы. Удаления стендов пока нет: оно тянет за
// собой заказы стенда.

// The cluster rule mirrors the one the portal checks (a DNS label), worded
// from the shared table so the complaint here and the one from the server
// read the same.
function clusterError(cluster: string): string | null {
  if (!cluster) return null;
  return dnsLabelError(cluster);
}

// The path rule mirrors the portal's: GitLab path segments, slash-separated.
const GIT_PATH_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;

function pathError(path: string): string | null {
  if (!path) return null;
  return GIT_PATH_RE.test(path) && path.length <= 255 ? null : t.errPath;
}

const LAYOUTS: { id: StandLayout; label: string; hint: string }[] = [
  { id: "group", label: t.layoutGroup, hint: t.layoutGroupHint },
  { id: "repository", label: t.layoutRepository, hint: t.layoutRepositoryHint },
];

export function AdminStandsPage() {
  // Under the shared cache key: the order form and the orders list read the
  // same rows, so an edit here is what they show next.
  const { data, error, loading, reload } = useAsync((signal) => api.listStands(signal), [], qk.stands());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      reload();
      if (done) toast.success(done);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const stands = data ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold">{t.navLabel}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">{t.pageIntro}</p>
      </div>

      {error && <ErrorBox error={error} />}
      {err && <ErrorBox error={new Error(err)} />}

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1 pb-1">
        {loading ? (
          <SkeletonRows rows={3} />
        ) : (
          <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-surface shadow-sm">
            {stands.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">{t.emptyList}</p>
            ) : (
              stands.map((s) => (
                <StandRow
                  key={s.id}
                  stand={s}
                  busy={busy}
                  onSave={(patch) => run(() => api.updateStand({ ...s, ...patch }), t.toastSaved(patch.name ?? s.name))}
                  onMakeDefault={() => run(() => api.setDefaultStand(s.id), t.toastDefault(s.name))}
                />
              ))
            )}
          </div>
        )}

        <AddStand busy={busy} run={run} />
      </div>
    </div>
  );
}

const cellInput =
  "min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-slate-800 outline-none hover:border-slate-200 focus:border-brand-500 focus:bg-surface focus:ring-1 focus:ring-brand-500 disabled:opacity-50";
const cellSelect =
  "h-[30px] rounded-md border border-transparent bg-transparent px-1 text-sm text-slate-800 outline-none hover:border-slate-200 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-50";

function StandRow({
  stand,
  busy,
  onSave,
  onMakeDefault,
}: {
  stand: Stand;
  busy: boolean;
  onSave: (patch: Partial<Pick<Stand, "name" | "default_cluster" | "layout" | "git_path">>) => void;
  onMakeDefault: () => void;
}) {
  const [name, setName] = useState(stand.name);
  const [cluster, setCluster] = useState(stand.default_cluster);
  const [path, setPath] = useState(stand.git_path);
  useEffect(() => setName(stand.name), [stand.name]);
  useEffect(() => setCluster(stand.default_cluster), [stand.default_cluster]);
  useEffect(() => setPath(stand.git_path), [stand.git_path]);
  const clusterErr = clusterError(cluster.trim());
  const pathErr = pathError(path.trim());
  const pathMissing = stand.git_path === "" && path.trim() === "";
  const layoutHint = LAYOUTS.find((l) => l.id === stand.layout)?.hint ?? "";

  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
      <input
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const v = name.trim();
          if (v && v !== stand.name) onSave({ name: v });
          else setName(stand.name);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        aria-label={t.nameAria}
        className={`${cellInput} w-40 font-medium`}
      />

      <div className="flex min-w-0 flex-col">
        <input
          value={cluster}
          disabled={busy}
          onChange={(e) => setCluster(e.target.value)}
          onBlur={() => {
            const v = cluster.trim();
            if (v && !clusterError(v) && v !== stand.default_cluster) onSave({ default_cluster: v });
            else if (!v || clusterError(v)) setCluster(stand.default_cluster);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder={t.clusterPlaceholder}
          aria-label={t.clusterAria}
          aria-invalid={!!clusterErr}
          title={t.clusterHint}
          className={`${cellInput} w-40 font-mono text-[13px] ${clusterErr ? "border-red-400" : ""}`}
        />
        {clusterErr && (
          <p role="alert" className="px-2 text-[11px] text-red-600">
            {clusterErr}
          </p>
        )}
      </div>

      {/* The layout and the path: editable until the stand has orders in Git,
          then shown as they are, with the reason on hover. */}
      {stand.locked ? (
        <span className="w-28 shrink-0 px-2 text-sm text-slate-500" title={t.lockedHint}>
          {LAYOUTS.find((l) => l.id === stand.layout)?.label ?? stand.layout}
        </span>
      ) : (
        <select
          value={stand.layout}
          disabled={busy}
          onChange={(e) => onSave({ layout: e.target.value as StandLayout })}
          aria-label={t.layoutLabel}
          title={layoutHint}
          className={`${cellSelect} w-28 shrink-0`}
        >
          {LAYOUTS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {stand.locked ? (
          <span className="truncate px-2 font-mono text-[13px] text-slate-500" title={t.lockedHint}>
            {stand.git_path}
          </span>
        ) : (
          <>
            <input
              value={path}
              disabled={busy}
              onChange={(e) => setPath(e.target.value)}
              onBlur={() => {
                const v = path.trim().replace(/^\/+|\/+$/g, "");
                if (v && !pathError(v) && v !== stand.git_path) onSave({ git_path: v });
                else if (!v || pathError(v)) setPath(stand.git_path);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              placeholder={t.pathPlaceholder}
              aria-label={t.pathLabel}
              aria-invalid={!!pathErr}
              title={t.pathHint}
              className={`${cellInput} w-full font-mono text-[13px] ${pathErr ? "border-red-400" : pathMissing ? "border-amber-400" : ""}`}
            />
            {pathErr && (
              <p role="alert" className="px-2 text-[11px] text-red-600">
                {pathErr}
              </p>
            )}
            {/* A stand made before paths existed: orders on it go nowhere
                until the path is filled in, so say so under the field. */}
            {!pathErr && pathMissing && <p className="px-2 text-[11px] text-amber-700">{t.pathMissing}</p>}
          </>
        )}
      </div>

      {stand.default ? (
        <span
          title={t.defaultHint}
          className="inline-flex shrink-0 items-center gap-1 rounded bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700"
        >
          <IconStar size={12} stroke={2} />
          {t.defaultBadge}
        </span>
      ) : (
        <Button variant="secondary" onPress={onMakeDefault} isDisabled={busy} className="h-[30px] shrink-0 text-xs">
          {t.makeDefault}
        </Button>
      )}

      <Link
        to={`/admin/stands/${stand.id}`}
        aria-label={t.openPage}
        title={t.openPage}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <IconExternalLink size={16} stroke={1.8} />
      </Link>
    </div>
  );
}

function AddStand({
  busy,
  run,
}: {
  busy: boolean;
  run: (fn: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [cluster, setCluster] = useState("");
  const [layout, setLayout] = useState<StandLayout>("group");
  const [path, setPath] = useState("");
  const [touched, setTouched] = useState(false);
  const clusterErr = clusterError(cluster.trim());
  const pathErr = pathError(path.trim());
  const canAdd = !busy && !!name.trim() && !!cluster.trim() && !clusterErr && !!path.trim() && !pathErr;
  const layoutHint = LAYOUTS.find((l) => l.id === layout)?.hint ?? "";

  function add() {
    if (!canAdd) return;
    const n = name.trim();
    run(
      () =>
        api.createStand({
          name: n,
          default_cluster: cluster.trim(),
          layout,
          git_path: path.trim().replace(/^\/+|\/+$/g, ""),
        }),
      t.toastCreated(n),
    ).then(() => {
      setName("");
      setCluster("");
      setLayout("group");
      setPath("");
      setTouched(false);
    });
  }

  const box =
    "h-[30px] rounded-md border bg-transparent px-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:ring-1 disabled:opacity-50";
  const calm = "border-slate-200 focus:border-brand-500 focus:ring-brand-500";
  const bad = "border-red-400 focus:border-red-500 focus:ring-red-500";

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-slate-300 bg-surface px-3 py-2.5">
      <div className="flex flex-wrap items-start gap-3">
        <input
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder={t.namePlaceholder}
          aria-label={t.nameAria}
          className={`${box} ${calm} w-40`}
        />

        <div className="flex min-w-0 flex-col">
          <input
            value={cluster}
            disabled={busy}
            onChange={(e) => setCluster(e.target.value)}
            onBlur={() => setTouched(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
            placeholder={t.clusterPlaceholder}
            aria-label={t.clusterAria}
            aria-invalid={touched && !!clusterErr}
            title={t.clusterHint}
            className={`${box} w-40 font-mono text-[13px] ${touched && clusterErr ? bad : calm}`}
          />
          {touched && (clusterErr || !cluster.trim()) && (
            <p role="alert" className="mt-1 text-[11px] text-red-600">
              {clusterErr ?? fieldMsg.required}
            </p>
          )}
        </div>

        <select
          value={layout}
          disabled={busy}
          onChange={(e) => setLayout(e.target.value as StandLayout)}
          aria-label={t.layoutLabel}
          title={layoutHint}
          className={`${box} ${calm} w-28 shrink-0 px-1`}
        >
          {LAYOUTS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>

        <div className="flex min-w-0 flex-1 flex-col">
          <input
            value={path}
            disabled={busy}
            onChange={(e) => setPath(e.target.value)}
            onBlur={() => setTouched(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
            placeholder={t.pathPlaceholder}
            aria-label={t.pathLabel}
            aria-invalid={touched && !!pathErr}
            title={t.pathHint}
            className={`${box} w-full font-mono text-[13px] ${touched && pathErr ? bad : calm}`}
          />
          {touched && (pathErr || !path.trim()) && (
            <p role="alert" className="mt-1 text-[11px] text-red-600">
              {pathErr ?? t.errPathEmpty}
            </p>
          )}
        </div>

        <Button variant="secondary" onPress={add} isDisabled={!canAdd} className="h-[30px] shrink-0">
          <IconPlus size={15} stroke={2} />
          Добавить
        </Button>
      </div>
      <p className="text-[12px] text-slate-500">
        {layoutHint} {t.pathHint}
      </p>
    </div>
  );
}

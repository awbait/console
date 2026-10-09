import { IconPlus, IconStar } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../api/client";
import { qk } from "../api/queryKeys";
import type { Stand } from "../api/types";
import { useToast } from "../app/ToastContext";
import { Button, ErrorBox, SkeletonRows } from "../components/ui";
import { standText as t } from "../features/stands/text";
import { dnsLabelError, fieldMsg } from "../form/fieldErrors";
import { useAsync } from "../hooks/useAsync";

// Стенды: места, куда уезжают заказы. Страница живёт по тем же правилам, что и
// «Переменные»: правка по месту с сохранением на blur, добавление снизу. Один
// стенд помечен как стенд по умолчанию, и кнопка на остальных переносит эту
// метку. Удаления стендов пока нет: оно тянет за собой заказы стенда.

// The cluster rule mirrors the one the portal checks (a DNS label), worded
// from the shared table so the complaint here and the one from the server
// read the same.
function clusterError(cluster: string): string | null {
  if (!cluster) return null;
  return dnsLabelError(cluster);
}

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

function StandRow({
  stand,
  busy,
  onSave,
  onMakeDefault,
}: {
  stand: Stand;
  busy: boolean;
  onSave: (patch: Partial<Pick<Stand, "name" | "default_cluster">>) => void;
  onMakeDefault: () => void;
}) {
  const [name, setName] = useState(stand.name);
  const [cluster, setCluster] = useState(stand.default_cluster);
  useEffect(() => setName(stand.name), [stand.name]);
  useEffect(() => setCluster(stand.default_cluster), [stand.default_cluster]);
  const clusterErr = clusterError(cluster.trim());

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
        className={`${cellInput} w-48 font-medium`}
      />

      <div className="flex min-w-0 flex-1 flex-col">
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
          className={`${cellInput} w-56 font-mono text-[13px] ${clusterErr ? "border-red-400" : ""}`}
        />
        {clusterErr && (
          <p role="alert" className="px-2 text-[11px] text-red-600">
            {clusterErr}
          </p>
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
  const [touched, setTouched] = useState(false);
  const clusterErr = clusterError(cluster.trim());
  const canAdd = !busy && !!name.trim() && !!cluster.trim() && !clusterErr;

  function add() {
    if (!canAdd) return;
    const n = name.trim();
    run(() => api.createStand({ name: n, default_cluster: cluster.trim() }), t.toastCreated(n)).then(() => {
      setName("");
      setCluster("");
      setTouched(false);
    });
  }

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-lg border border-dashed border-slate-300 bg-surface px-3 py-2.5">
      <input
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
        }}
        placeholder={t.namePlaceholder}
        aria-label={t.nameAria}
        className="h-[30px] w-48 rounded-md border border-slate-200 bg-transparent px-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
      />

      <div className="flex min-w-0 flex-1 flex-col">
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
          className={`h-[30px] w-56 rounded-md border bg-transparent px-2.5 font-mono text-[13px] text-slate-800 outline-none placeholder:text-slate-400 focus:ring-1 disabled:opacity-50 ${
            touched && clusterErr
              ? "border-red-400 focus:border-red-500 focus:ring-red-500"
              : "border-slate-200 focus:border-brand-500 focus:ring-brand-500"
          }`}
        />
        {touched && (clusterErr || !cluster.trim()) && (
          <p role="alert" className="mt-1 text-[11px] text-red-600">
            {clusterErr ?? fieldMsg.required}
          </p>
        )}
      </div>

      <Button variant="secondary" onPress={add} isDisabled={!canAdd} className="h-[30px] shrink-0">
        <IconPlus size={15} stroke={2} />
        Добавить
      </Button>
    </div>
  );
}

import { IconFileText, IconPlayerStop } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import type { Stand, StandJob, StandMode } from "@/api/types";
import { useToast } from "@/app/ToastContext";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button, ErrorBox, SkeletonRows } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { standJobFailures, standText as t } from "./text";

// The jobs of one stand, newest first: what moved the stand's orders when its
// mode changed, what deleted them, what wrote their manifests again, how far
// each got, and what it gave up on. A running job is polled, so the count
// moves without a reload, and can be stopped. The one job an admin starts
// from here is the regeneration: the other two start from the stand's
// settings and its deletion.

const POLL_MS = 5000;

const MODE_LABEL: Record<StandMode, string> = {
  deploy: t.modeDeploy,
  git: t.modeGit,
  console: t.modeConsole,
};

const STATUS: Record<StandJob["status"], { label: string; tone: string }> = {
  running: { label: t.jobStatusRunning, tone: "bg-blue-50 text-blue-700" },
  done: { label: t.jobStatusDone, tone: "bg-emerald-50 text-emerald-700" },
  stopped: { label: t.jobStatusStopped, tone: "bg-slate-100 text-slate-600" },
};

export function StandJobs({ stand, onChanged }: { stand: Stand; onChanged?: () => void }) {
  const standId = stand.id;
  const jobs = useAsync((signal) => api.standJobs(standId, signal), [standId]);
  const running = jobs.data?.jobs.some((j) => j.status === "running") ?? false;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => jobs.reload(), POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const changed = () => {
    jobs.reload();
    onChanged?.();
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-800">{t.jobsTitle}</h2>
          <p className="mt-0.5 max-w-2xl text-sm text-slate-500">{t.jobsIntro}</p>
        </div>
        <RegenerateAction stand={stand} busy={running || !!stand.job} onStarted={changed} />
      </div>
      {jobs.error && <ErrorBox error={jobs.error} />}
      {jobs.loading && !jobs.data ? (
        <SkeletonRows rows={2} className="mt-3" />
      ) : (jobs.data?.jobs.length ?? 0) === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{t.jobNone}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {jobs.data?.jobs.map((j) => (
            <JobRow key={j.id} job={j} onStopped={changed} />
          ))}
        </ul>
      )}
    </section>
  );
}

// RegenerateAction starts the job writing every order's application.yaml
// again, after asking with the number of orders it will look at. Greyed out
// while another job runs, and on a stand whose orders are not in Git, where
// the button says why.
function RegenerateAction({ stand, busy, onStarted }: { stand: Stand; busy: boolean; onStarted: () => void }) {
  const toast = useToast();
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const consoleOnly = stand.mode === "console";
  const disabled = busy || consoleOnly || loading;
  const reason = consoleOnly ? t.regenerateDisabledMode : busy ? t.deleteDisabledJob : undefined;

  async function ask() {
    setLoading(true);
    setError(null);
    try {
      const { total } = await api.previewRegenerate(stand.id);
      setCount(total);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {/* The reason sits on the button as a title: a disabled button does not
          open a tooltip, and there is no room for a sentence beside it. */}
      <span title={reason}>
        <Button variant="secondary" onPress={ask} isDisabled={disabled} className="h-[30px] text-xs">
          <IconFileText size={14} stroke={2} />
          {t.regenerateButton}
        </Button>
      </span>
      {reason && <span className="text-xs text-slate-500">{reason}</span>}
      {error && <ErrorBox error={error} />}
      <ConfirmDialog
        isOpen={count !== null}
        onOpenChange={(open) => {
          if (!open) setCount(null);
        }}
        title={t.regenerateTitle}
        message={t.regenerateConfirm(count ?? 0)}
        confirmLabel={t.regenerateButton}
        onConfirm={async () => {
          await api.regenerateStand(stand.id);
          toast.success(t.regenerateStartedToast);
          onStarted();
        }}
      />
    </div>
  );
}

function JobRow({ job, onStopped }: { job: StandJob; onStopped: () => void }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const status = STATUS[job.status] ?? STATUS.stopped;
  const isDelete = job.kind === "delete";
  const isRegenerate = job.kind === "regenerate";
  // A regeneration is as far along as what it has decided about, written or
  // left alone; the other jobs count what they moved.
  const settled = isRegenerate ? job.done + job.skipped : job.done;
  const pct = job.total > 0 ? Math.round((settled / job.total) * 100) : 0;
  const title = isDelete
    ? t.jobDelete
    : isRegenerate
      ? t.jobRegenerate
      : t.jobModeChange(MODE_LABEL[job.from_mode] ?? job.from_mode, MODE_LABEL[job.to_mode] ?? job.to_mode);
  const progress = isDelete
    ? t.jobDeleteProgress(job.done, job.total)
    : isRegenerate
      ? t.jobRegenerateProgress(job.done, job.skipped, job.total)
      : t.jobProgress(job.done, job.total);
  const failureText = (reason: string, detail?: string) => {
    if (reason === "rejected") return detail;
    if (reason === "upstream" && isRegenerate) return t.regenerateFailureUpstream;
    return standJobFailures[reason] ?? reason;
  };
  return (
    <li className="rounded-md border border-slate-200 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${status.tone}`}>{status.label}</span>
          <p className="truncate text-sm font-medium text-slate-800">{title}</p>
        </div>
        {job.status === "running" && (
          <Button variant="secondary" onPress={() => setConfirm(true)} className="h-[30px] shrink-0 text-xs">
            <IconPlayerStop size={14} stroke={2} />
            {t.jobStop}
          </Button>
        )}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div
          className="h-1.5 w-40 overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={job.total}
          aria-valuenow={settled}
        >
          <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-slate-600">{progress}</p>
      </div>
      {job.status === "running" && job.waiting > 0 && (
        <p className="mt-1 text-xs text-slate-500">{t.jobWaitingMerge}</p>
      )}
      {/* A finished deletion that kept the stand says why; one that did not
          cannot be seen here, since the stand page is gone with the stand. */}
      {isDelete && job.status === "done" && job.failures.length > 0 && (
        <p className="mt-1 text-xs text-amber-700">{t.jobDeleteKept}</p>
      )}
      {job.failures.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-medium text-rose-700">
            {isRegenerate ? t.jobRegenerateFailuresTitle : t.jobFailuresTitle}
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {job.failures.map((f) => (
              <li key={f.order_id} className="text-xs text-slate-600">
                <Link to={`/requests/${f.order_id}`} className="font-mono text-brand-600 hover:underline">
                  {f.service_name}
                </Link>
                {": "}
                {failureText(f.reason, f.detail)}
                {f.reason === "upstream" && f.detail && (
                  <span className="mt-0.5 block font-mono text-[11px] text-slate-400">{f.detail}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={t.jobStop}
        message={t.jobStopConfirm}
        confirmLabel={t.jobStop}
        onConfirm={async () => {
          await api.stopStandJob(job.stand_id, job.id);
          toast.success(t.jobStoppedToast);
          onStopped();
        }}
      />
    </li>
  );
}

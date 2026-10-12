import { IconPlayerStop } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import type { StandJob, StandMode } from "@/api/types";
import { useToast } from "@/app/ToastContext";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button, ErrorBox, SkeletonRows } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { standJobFailures, standText as t } from "./text";

// The jobs of one stand, newest first: what moved the stand's orders when its
// mode changed, how far it got, and what it gave up on. A running job is
// polled, so the count moves without a reload, and can be stopped.

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

export function StandJobs({ standId, onChanged }: { standId: string; onChanged?: () => void }) {
  const jobs = useAsync((signal) => api.standJobs(standId, signal), [standId]);
  const running = jobs.data?.jobs.some((j) => j.status === "running") ?? false;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => jobs.reload(), POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  return (
    <section className="rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
      <h2 className="text-base font-semibold text-slate-800">{t.jobsTitle}</h2>
      <p className="mt-0.5 max-w-2xl text-sm text-slate-500">{t.jobsIntro}</p>
      {jobs.error && <ErrorBox error={jobs.error} />}
      {jobs.loading && !jobs.data ? (
        <SkeletonRows rows={2} className="mt-3" />
      ) : (jobs.data?.jobs.length ?? 0) === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{t.jobNone}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {jobs.data?.jobs.map((j) => (
            <JobRow
              key={j.id}
              job={j}
              onStopped={() => {
                jobs.reload();
                onChanged?.();
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function JobRow({ job, onStopped }: { job: StandJob; onStopped: () => void }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const status = STATUS[job.status] ?? STATUS.stopped;
  const pct = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;
  const isDelete = job.kind === "delete";
  const title = isDelete
    ? t.jobDelete
    : t.jobModeChange(MODE_LABEL[job.from_mode] ?? job.from_mode, MODE_LABEL[job.to_mode] ?? job.to_mode);
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
          aria-valuenow={job.done}
        >
          <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-slate-600">
          {isDelete ? t.jobDeleteProgress(job.done, job.total) : t.jobProgress(job.done, job.total)}
        </p>
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
          <p className="text-xs font-medium text-rose-700">{t.jobFailuresTitle}</p>
          <ul className="mt-1 flex flex-col gap-1">
            {job.failures.map((f) => (
              <li key={f.order_id} className="text-xs text-slate-600">
                <Link to={`/requests/${f.order_id}`} className="font-mono text-brand-600 hover:underline">
                  {f.service_name}
                </Link>
                {": "}
                {f.reason === "rejected" ? f.detail : (standJobFailures[f.reason] ?? f.reason)}
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

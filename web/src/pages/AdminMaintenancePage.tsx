import { IconHistory } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useId, useState } from "react";
import { Label, Radio, RadioGroup } from "react-aria-components";
import { api, HttpError } from "../api/client";
import { qk } from "../api/queryKeys";
import type { MaintenanceEvent, MaintenanceStatus, MaintenanceWindow } from "../api/types";
import { useToast } from "../app/ToastContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PageHeader } from "../components/PageHeader";
import { Button, Card, Checkbox, Chip, ErrorBox, SkeletonRows, TextField } from "../components/ui";
import { maintenanceText as t } from "../features/maintenance/text";
import { fromLocalInput, toLocalInput, when } from "../features/maintenance/when";
import { useAsync } from "../hooks/useAsync";
import { fmtDateTime } from "../lib/time";

// Maintenance: one window per portal. The admin announces it ahead or switches
// it on at once, extends it and ends it. While it is on, everybody else gets the
// lock screen instead of the portal (features/maintenance/MaintenanceLock).

const MAX_MESSAGE = 2000;

type FieldErrors = Partial<Record<"message" | "ends_at" | "auto_end", string>>;

// The rule a field broke, from the server's code; the wording lives with the
// rest of the feature's text.
function errorsOf(e: unknown): FieldErrors | null {
  if (!(e instanceof HttpError) || e.code !== "validation_failed") return null;
  const out: FieldErrors = {};
  for (const d of e.details) {
    const text = t.errors[d.message as keyof typeof t.errors];
    if (text && (d.path === "message" || d.path === "ends_at" || d.path === "auto_end")) out[d.path] = text;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function AdminMaintenancePage() {
  const { data, error, loading, reload } = useAsync((signal) => api.getMaintenance(signal), []);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  // A change here is news for the banner above this very page: ask now rather
  // than on the next poll.
  const refresh = () => {
    reload();
    void queryClient.invalidateQueries({ queryKey: qk.platformHealth() });
  };

  const status = data?.status;
  const win = status?.window;
  const scheduled = status?.state === "scheduled";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <PageHeader
        title={t.navLabel}
        status={status && <Chip className={STATE_TONE[status.state]}>{stateLabel(status)}</Chip>}
        description={t.pageIntro}
      />

      {error && <ErrorBox error={error} onRetry={reload} />}

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1 pb-1">
        {loading || !status ? (
          !error && <SkeletonRows rows={4} />
        ) : (
          <>
            <StatusCard status={status} onEnd={win ? () => setConfirming(true) : undefined} />
            <WindowForm
              key={win ? `${win.id}:${win.updated_at}` : "new"}
              window={win}
              active={status.state === "active" && !!win}
              onSaved={(started, wasNew) => {
                toast.success(!wasNew ? t.toastSaved : started ? t.toastStarted : t.toastScheduled);
                refresh();
              }}
            />
            <History events={data.history} />
          </>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title={scheduled ? t.confirmCancelTitle : t.confirmEndTitle}
        message={scheduled ? t.confirmCancelText : t.confirmEndText}
        confirmLabel={scheduled ? t.confirmCancelAction : t.confirmEndAction}
        danger={scheduled}
        onConfirm={async () => {
          await api.endMaintenance();
          toast.success(scheduled ? t.toastCancelled : t.toastEnded);
          refresh();
        }}
      />
    </div>
  );
}

const STATE_TONE = {
  off: "bg-slate-100 text-slate-600",
  scheduled: "bg-brand-50 text-brand-700",
  active: "bg-amber-50 text-amber-700",
} as const;

function stateLabel(status: MaintenanceStatus): string {
  if (status.forced) return t.stateForced;
  if (status.state === "active") return status.overdue ? t.stateOverdue : t.stateActive;
  return status.state === "scheduled" ? t.stateScheduled : t.stateOff;
}

// StatusCard details the current window. The state itself is a chip in the page
// header, so with no window and nothing forced there is nothing left to show.
function StatusCard({ status, onEnd }: { status: MaintenanceStatus; onEnd?: () => void }) {
  const w = status.window;
  if (!w && !status.forced) return null;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {status.forced && <p className="max-w-3xl text-sm text-amber-700">{t.forcedNote}</p>}
        </div>
        {onEnd && (
          <Button variant="secondary" onPress={onEnd}>
            {status.state === "scheduled" ? t.cancelButton : t.endButton}
          </Button>
        )}
      </div>
      {w && (
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
          <Row term={t.statusStart}>{when(w.starts_at)}</Row>
          <Row term={t.statusEnd}>{w.ends_at ? when(w.ends_at) : t.noEnd}</Row>
          <Row term={t.statusMessage}>
            <span className="whitespace-pre-line">{w.message || t.noMessage}</span>
          </Row>
          <Row term={t.statusChangedBy}>
            {w.updated_by_name ? `${w.updated_by_name}, ` : ""}
            {fmtDateTime(w.updated_at)}
          </Row>
        </dl>
      )}
    </Card>
  );
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-slate-500">{term}</dt>
      <dd className="min-w-0 text-slate-800">{children}</dd>
    </>
  );
}

// WindowForm plans a new window or changes the one there is. Remounted (by key)
// whenever the stored window changes, so it always opens on what is stored.
function WindowForm({
  window: w,
  active,
  onSaved,
}: {
  window?: MaintenanceWindow;
  active: boolean;
  onSaved: (started: boolean, wasNew: boolean) => void;
}) {
  const messageId = useId();
  const [startMode, setStartMode] = useState<"now" | "at">(w && !active ? "at" : "now");
  const [startAt, setStartAt] = useState(w ? toLocalInput(w.starts_at) : "");
  const [endAt, setEndAt] = useState(w?.ends_at ? toLocalInput(w.ends_at) : "");
  const [message, setMessage] = useState(w?.message ?? "");
  const [pause, setPause] = useState(w?.pause_background ?? true);
  const [autoEnd, setAutoEnd] = useState(w?.auto_end ?? false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // An edit clears the complaint about the field it touches.
  const clear = (...fields: (keyof FieldErrors)[]) =>
    setErrors((e) => {
      const next = { ...e };
      for (const f of fields) delete next[f];
      return next;
    });

  const tooLong = message.length > MAX_MESSAGE;
  const startNow = !w ? startMode === "now" : active;

  async function submit() {
    setFailure(null);
    // The two rules the form can tell on its own; the server checks them all.
    const local: FieldErrors = {};
    if (tooLong) local.message = t.errors.too_long;
    if (autoEnd && !endAt) local.auto_end = t.errors.needs_end;
    if (Object.keys(local).length > 0) {
      setErrors(local);
      return;
    }
    setBusy(true);
    try {
      await api.setMaintenance({
        starts_at: startNow ? undefined : fromLocalInput(startAt),
        ends_at: fromLocalInput(endAt),
        message,
        pause_background: pause,
        auto_end: autoEnd,
      });
      onSaved(startNow || !fromLocalInput(startAt), !w);
    } catch (e) {
      const fields = errorsOf(e);
      if (fields) setErrors(fields);
      else setFailure(e);
    } finally {
      setBusy(false);
    }
  }

  const submitLabel = w ? t.submitSave : startMode === "now" ? t.submitStart : t.submitSchedule;

  return (
    <Card>
      <h2 className="text-base font-semibold text-slate-900">{w ? t.formTitleEdit : t.formTitleNew}</h2>
      <div className="mt-4 flex max-w-2xl flex-col gap-4">
        {active ? (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-700">{t.startLabel}</span>
            <span className="text-sm text-slate-800">{w ? when(w.starts_at) : ""}</span>
            <span className="text-xs text-gray-500">{t.startLocked}</span>
          </div>
        ) : (
          <RadioGroup
            value={startMode}
            onChange={(v) => setStartMode(v as "now" | "at")}
            className="flex flex-col gap-2"
          >
            <Label className="text-sm font-medium text-gray-700">{t.startLabel}</Label>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Choice value="now" label={t.startNow} />
              <Choice value="at" label={t.startAt} />
            </div>
            {startMode === "at" && (
              <TextField
                label={t.startAt}
                hideLabel
                type="datetime-local"
                value={startAt}
                onChange={setStartAt}
              />
            )}
          </RadioGroup>
        )}

        <TextField
          label={t.endLabel}
          description={t.endDescription}
          type="datetime-local"
          value={endAt}
          onChange={(v) => {
            setEndAt(v);
            clear("ends_at", "auto_end");
          }}
          errorText={errors.ends_at}
        />

        <div className="flex flex-col gap-1">
          <label htmlFor={messageId} className="text-sm font-medium text-gray-700">
            {t.messageLabel}
          </label>
          <textarea
            id={messageId}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              clear("message");
            }}
            rows={4}
            placeholder={t.messagePlaceholder}
            aria-invalid={!!errors.message || tooLong}
            className={`rounded-md border bg-surface p-2 text-sm leading-relaxed outline-none placeholder:text-slate-400 focus:ring-1 ${
              errors.message || tooLong
                ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                : "border-gray-300 focus:border-brand-500 focus:ring-brand-500"
            }`}
          />
          {errors.message || tooLong ? (
            <span className="text-xs text-red-600">{errors.message ?? t.errors.too_long}</span>
          ) : (
            <span className="text-xs text-gray-500">{t.messageDescription}</span>
          )}
        </div>

        <Option label={t.pauseLabel} description={t.pauseDescription} isSelected={pause} onChange={setPause} />
        <Option
          label={t.autoEndLabel}
          description={t.autoEndDescription}
          isSelected={autoEnd}
          onChange={(v) => {
            setAutoEnd(v);
            clear("auto_end");
          }}
          error={errors.auto_end}
        />

        {failure != null && <ErrorBox error={failure as Error} />}

        <div>
          <Button variant="primary" onPress={submit} isDisabled={busy}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Choice({ value, label }: { value: string; label: string }) {
  return (
    <Radio value={value} className="group flex cursor-pointer items-center gap-2 text-sm text-gray-700 outline-none">
      <span className="flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 group-data-[selected]:border-brand-600 group-data-[focus-visible]:ring-2 group-data-[focus-visible]:ring-brand-500">
        <span className="h-2 w-2 rounded-full bg-brand-600 opacity-0 group-data-[selected]:opacity-100" />
      </span>
      {label}
    </Radio>
  );
}

function Option({
  label,
  description,
  isSelected,
  onChange,
  error,
}: {
  label: string;
  description: string;
  isSelected: boolean;
  onChange: (v: boolean) => void;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Checkbox label={label} isSelected={isSelected} onChange={onChange} />
      <span className={`pl-6 text-xs ${error ? "text-red-600" : "text-gray-500"}`}>{error ?? description}</span>
    </div>
  );
}

function History({ events }: { events: MaintenanceEvent[] }) {
  return (
    <section>
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        <IconHistory size={16} stroke={1.8} />
        {t.historyTitle}
      </h2>
      {events.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">{t.historyEmpty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-surface shadow-sm">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
              <span className="text-slate-800">{t.historyAction[e.action] ?? e.action}</span>
              <span className="text-xs text-slate-500">
                {e.actor_name || t.systemActor}, {fmtDateTime(e.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

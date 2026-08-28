import { IconGitCompare } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { api } from "@/api/client";
import type { OrderRequest, ValuesConflictSet } from "@/api/types";
import { FormDialogShell } from "@/components/FormDialogShell";
import { FormErrors, type SubmitError, toSubmitError } from "@/components/FormErrors";
import { Button, Loading } from "@/components/ui";
import { type DiffSide, FieldDiff } from "@/form/FieldDiff";
import { setAtField, type ValuesDiffRow } from "@/form/valuesDiff";
import { useAsync } from "@/hooks/useAsync";

// Settling a change the portal had to take back.
//
// Two people moved the same settings and only they can say which value is
// right. Everything else about the change was merged long before this screen
// opens - the other person's edits to other fields are already in what it will
// send - so it asks about the fields in disagreement and nothing else.
//
// Neither side is offered as the default. The portal has no opinion here: one
// value is the service as the repository has it, the other is what this order
// asked for, and picking one of them for the reader would be picking for them.

const VERSION_PATH = "chartVersion";

// resolvedValues applies the choices over what the portal already merged.
function resolvedValues(set: ValuesConflictSet, chosen: Record<string, DiffSide>) {
  let values: Record<string, unknown> = { ...(set.merged ?? {}) };
  let version = set.merged_version || undefined;
  for (const c of set.conflicts) {
    const value = chosen[c.path] === "after" ? c.mine : c.theirs;
    if (c.path === VERSION_PATH) {
      version = typeof value === "string" && value ? value : undefined;
      continue;
    }
    values = setAtField(values, c.field ?? c.path.split("."), value);
  }
  return { values, version };
}

export function ConflictDialog({
  request,
  conflict,
  isOpen,
  onClose,
  onResolved,
}: {
  request: OrderRequest;
  conflict: ValuesConflictSet;
  isOpen: boolean;
  onClose: () => void;
  onResolved: () => void;
}) {
  // The schema is what gives every field the name it had on the order form.
  // Without it the rows fall back to their dotted paths, which is worse but
  // still usable, so a schema that will not load does not close the screen.
  const { data: schema, loading } = useAsync(
    (signal) =>
      isOpen
        ? api.getSchema(request.chart_project, request.chart_name, request.chart_version, signal)
        : Promise.resolve(null),
    [isOpen, request.chart_project, request.chart_name, request.chart_version],
  );
  const [chosen, setChosen] = useState<Record<string, DiffSide>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<SubmitError | null>(null);

  const rows: ValuesDiffRow[] = useMemo(
    () =>
      conflict.conflicts.map((c) =>
        c.path === VERSION_PATH
          ? { path: c.path, field: [], label: "Версия продукта", before: c.theirs, after: c.mine }
          : {
              path: c.path,
              field: c.field ?? c.path.split("."),
              before: c.theirs,
              after: c.mine,
            },
      ),
    [conflict],
  );
  const answered = rows.filter((r) => chosen[r.path]).length;
  const allAnswered = answered === rows.length;

  async function apply() {
    setSaving(true);
    setErr(null);
    try {
      const { values, version } = resolvedValues(conflict, chosen);
      await api.updateRequest(request.id, { values, version });
      onClose();
      onResolved();
    } catch (e) {
      setErr(toSubmitError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialogShell
      isOpen={isOpen}
      onClose={onClose}
      icon={<IconGitCompare size={18} stroke={1.8} />}
      title="Что оставить"
      subtitle={request.display_name || request.service_name}
      maxWidth="max-w-2xl"
      footer={(close) => (
        <>
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm font-medium text-gray-700 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
          >
            Отмена
          </button>
          <Button variant="primary" isDisabled={saving || !allAnswered} onPress={apply}>
            {saving ? "Отправляем…" : "Отправить изменение"}
          </Button>
        </>
      )}
    >
      <p className="text-sm text-slate-600">
        Ваше изменение и чужое коснулись одних и тех же настроек, поэтому портал не стал применять
        ваше. Остальное он уже свёл сам. Выберите, что оставить в этих настройках.
      </p>
      {loading ? (
        <div className="mt-4">
          <Loading label="Готовим настройки" />
        </div>
      ) : (
        <div className="mt-4">
          <FieldDiff
            rows={rows}
            beforeLabel="Сейчас в сервисе"
            afterLabel="Вы хотели"
            schema={schema ?? undefined}
            chosen={chosen}
            onChoose={(path: string, side: DiffSide) =>
              setChosen((c) => ({ ...c, [path]: side }))
            }
          />
        </div>
      )}
      {!allAnswered && rows.length > 0 && !loading && (
        <p className="mt-4 text-xs text-slate-500">
          Выбрано {answered} из {rows.length}.
        </p>
      )}
      {err && (
        <div className="mt-4">
          <FormErrors message={err.message} details={err.details} schema={schema ?? undefined} />
        </div>
      )}
    </FormDialogShell>
  );
}

import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../api/client";
import { qk } from "../api/queryKeys";
import type { Variable } from "../api/types";
import { useToast } from "../app/ToastContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Button, ErrorBox, SkeletonRows } from "../components/ui";
import { fieldMsg } from "../form/fieldErrors";
import { useAsync } from "../hooks/useAsync";

// Переменные платформы: именованные значения, на которые ссылается документ
// версии сервиса ("{{.Vars.OPS_DOMAIN}}"). Страница живёт по тем же правилам,
// что и «Категории каталога»: правка по месту с сохранением на blur, добавление
// снизу, удаление через подтверждение.

// The name rule mirrors the one the portal checks (models.ValidVariableName),
// worded from the shared table so the complaint here and the one from the server
// read the same.
const VARIABLE_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

function nameError(name: string): string | null {
  if (!name) return null;
  return VARIABLE_NAME_RE.test(name) ? null : fieldMsg.charsetUpperFromLetter;
}

export function AdminVariablesPage() {
  const { data, error, loading, reload } = useAsync(() => api.listVariables(), [], qk.variables());
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

  const variables = data ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold">Переменные</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Значения, на которые ссылается документ версии сервиса:{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px] text-slate-700">
            {"{{.Vars.ИМЯ}}"}
          </code>
          . Портал подставляет их, когда сохраняет заказ. Меняйте значение здесь, и новые заказы
          получат его сразу, а существующие - при следующем изменении.
        </p>
        <p className="mt-1 max-w-3xl text-sm text-amber-700">
          Это не хранилище секретов: значение уезжает в values.yaml в Git и видно всем, у кого есть
          доступ к репозиторию заказов.
        </p>
      </div>

      {error && <ErrorBox error={error} />}
      {err && <ErrorBox error={new Error(err)} />}

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1 pb-1">
        {loading ? (
          <SkeletonRows rows={4} />
        ) : (
          <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-surface shadow-sm">
            {variables.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">
                Переменных нет. Добавьте первую ниже.
              </p>
            ) : (
              variables.map((v) => (
                <VariableRow
                  key={v.name}
                  variable={v}
                  busy={busy}
                  onSave={(patch) =>
                    run(() => api.setVariable({ ...v, ...patch }), `Переменная ${v.name} сохранена`)
                  }
                  onDelete={() => run(() => api.deleteVariable(v.name), `Переменная ${v.name} удалена`)}
                />
              ))
            )}
          </div>
        )}

        <AddVariable busy={busy} run={run} />
      </div>
    </div>
  );
}

const cellInput =
  "min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-slate-800 outline-none hover:border-slate-200 focus:border-brand-500 focus:bg-surface focus:ring-1 focus:ring-brand-500 disabled:opacity-50";

function VariableRow({
  variable,
  busy,
  onSave,
  onDelete,
}: {
  variable: Variable;
  busy: boolean;
  onSave: (patch: Partial<Variable>) => void;
  onDelete: () => void;
}) {
  const [value, setValue] = useState(variable.value);
  const [desc, setDesc] = useState(variable.description ?? "");
  useEffect(() => setValue(variable.value), [variable.value]);
  useEffect(() => setDesc(variable.description ?? ""), [variable.description]);

  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
      <code
        title="Так на переменную ссылается документ версии"
        className="shrink-0 rounded bg-slate-100 px-2 py-1 font-mono text-[12px] font-medium text-slate-700"
      >
        {variable.name}
      </code>

      <input
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value !== variable.value) onSave({ value });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder="значение"
        aria-label={`Значение переменной ${variable.name}`}
        className={`${cellInput} w-56 flex-1 font-mono text-[13px]`}
      />

      <input
        value={desc}
        disabled={busy}
        onChange={(e) => setDesc(e.target.value)}
        onBlur={() => {
          if (desc !== (variable.description ?? "")) onSave({ description: desc });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder="зачем она нужна"
        aria-label={`Описание переменной ${variable.name}`}
        className={`${cellInput} w-56 flex-1`}
      />

      <DeleteVariableButton name={variable.name} onConfirm={onDelete} />
    </div>
  );
}

// Удаление спрашивает подтверждение и до него показывает, какие версии сервисов
// на переменную ссылаются: заказы этих сервисов перестанут сохраняться, а
// столкнётся с этим не тот, кто удалял.
function DeleteVariableButton({ name, onConfirm }: { name: string; onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  const [usedBy, setUsedBy] = useState<string[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setUsedBy(null);
    api
      .variableUsage(name)
      .then((r) => {
        if (alive) setUsedBy(r.used_by);
      })
      .catch(() => {
        if (alive) setUsedBy([]);
      });
    return () => {
      alive = false;
    };
  }, [open, name]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Удалить переменную ${name}`}
        // impeccable-disable-next-line gray-on-color: the red background only appears on hover, and it comes with red-600 text
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 outline-none hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-red-500"
      >
        <IconTrash size={16} stroke={1.8} />
      </button>
      <ConfirmDialog
        isOpen={open}
        onOpenChange={setOpen}
        title={`Удалить переменную ${name}?`}
        danger
        confirmLabel="Удалить"
        busyLabel="Удаляем…"
        message={
          usedBy && usedBy.length > 0 ? (
            <>
              На переменную ссылаются версии: {usedBy.slice(0, 5).join(", ")}
              {usedBy.length > 5 ? ` и ещё ${usedBy.length - 5}` : ""}. Пока ссылка на месте, портал
              не даст её удалить: сначала уберите её из документа версии.
            </>
          ) : (
            <>Значение перестанет подставляться в новые заказы. Вернуть его можно только заново.</>
          )
        }
        onConfirm={onConfirm}
      />
    </>
  );
}

function AddVariable({
  busy,
  run,
}: {
  busy: boolean;
  run: (fn: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [desc, setDesc] = useState("");
  const [touched, setTouched] = useState(false);
  const nameErr = nameError(name.trim());
  const canAdd = !busy && !!name.trim() && !nameErr;

  function add() {
    if (!canAdd) return;
    run(
      () => api.setVariable({ name: name.trim(), value: value.trim(), description: desc.trim() }),
      `Переменная ${name.trim()} создана`,
    ).then(() => {
      setName("");
      setValue("");
      setDesc("");
      setTouched(false);
    });
  }

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-lg border border-dashed border-slate-300 bg-surface px-3 py-2.5">
      <div className="shrink-0">
        <input
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value.toUpperCase())}
          onBlur={() => setTouched(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="ИМЯ"
          aria-label="Имя новой переменной"
          aria-invalid={touched && !!nameErr}
          className={`h-[30px] w-40 rounded-md border bg-transparent px-2.5 font-mono text-[12px] text-slate-700 outline-none placeholder:text-slate-400 focus:ring-1 disabled:opacity-50 ${
            touched && nameErr
              ? "border-red-400 focus:border-red-500 focus:ring-red-500"
              : "border-slate-200 focus:border-brand-500 focus:ring-brand-500"
          }`}
        />
        {touched && nameErr && (
          <p role="alert" className="mt-1 w-40 text-[11px] text-red-600">
            {nameErr}
          </p>
        )}
      </div>

      <input
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
        }}
        placeholder="значение"
        aria-label="Значение новой переменной"
        className="h-[30px] w-56 flex-1 rounded-md border border-slate-200 bg-transparent px-2.5 font-mono text-[13px] text-slate-800 outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
      />

      <input
        value={desc}
        disabled={busy}
        onChange={(e) => setDesc(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
        }}
        placeholder="зачем она нужна"
        aria-label="Описание новой переменной"
        className="h-[30px] w-56 flex-1 rounded-md border border-slate-200 bg-transparent px-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
      />

      <Button variant="secondary" onPress={add} isDisabled={!canAdd} className="h-[30px] shrink-0">
        <IconPlus size={15} stroke={2} />
        Добавить
      </Button>
    </div>
  );
}

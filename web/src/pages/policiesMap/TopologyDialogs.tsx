import { IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { FormErrors } from "../../components/FormErrors";
import { Button, Select, TextField } from "../../components/ui";
import {
  DNS_NAME_RE,
  PORT_PROTOCOLS,
  type PortProtocol,
  type TopoNamespace,
  type TopoWorkload,
  WORKLOAD_KINDS,
  type WorkloadKind,
  workloadId,
} from "./topology";

// Shared modal chrome for the small topology dialogs, matching the app's
// centered modal style (ConfirmDialog).
function MapDialog({
  isOpen,
  onOpenChange,
  title,
  children,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 entering:animate-in entering:fade-in"
    >
      <Modal className="w-full max-w-md rounded-lg bg-surface shadow-xl outline-none entering:animate-in entering:zoom-in-95">
        <Dialog className="outline-none">
          {({ close }) => (
            <div className="flex max-h-[85vh] flex-col">
              <header className="flex items-center justify-between px-4 pb-2 pt-4">
                <h2 className="text-base font-semibold text-gray-900">{title}</h2>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Закрыть"
                  className="rounded-md p-1 text-gray-400 outline-none hover:bg-gray-100 hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <IconX size={18} stroke={2} />
                </button>
              </header>
              <div className="overflow-y-auto px-4 pb-4">{children}</div>
            </div>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

export function NamespaceDialog({
  isOpen,
  onOpenChange,
  existing,
  suggestions,
  onAdd,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  existing: string[];
  // Known deployed namespaces from the topology provider (empty in manual mode).
  suggestions: string[];
  onAdd: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName("");
      setErr(null);
    }
  }, [isOpen]);

  function submit() {
    const n = name.trim();
    if (!DNS_NAME_RE.test(n)) {
      setErr("Имя namespace должно быть в DNS-формате: строчные буквы, цифры, дефисы.");
      return;
    }
    if (existing.includes(n)) {
      setErr(`Namespace «${n}» уже есть на холсте.`);
      return;
    }
    onAdd(n);
    onOpenChange(false);
  }

  return (
    <MapDialog isOpen={isOpen} onOpenChange={onOpenChange} title="Добавить namespace">
      <div className="flex flex-col gap-3">
        <TextField
          label="Имя namespace"
          value={name}
          onChange={setName}
          isRequired
          placeholder="team-app"
          description="DNS-формат: строчные буквы, цифры, дефисы."
        />
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {suggestions
              .filter((s) => !existing.includes(s))
              .map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setName(s)}
                  className="cursor-pointer rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600 outline-none hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  {s}
                </button>
              ))}
          </div>
        )}
        {err && <FormErrors message={err} />}
        <div className="flex justify-end gap-2 border-t border-gray-200 pt-3">
          <Button onPress={() => onOpenChange(false)}>Отмена</Button>
          <Button variant="primary" onPress={submit}>
            Добавить
          </Button>
        </div>
      </div>
    </MapDialog>
  );
}

interface KVRow {
  key: string;
  value: string;
}

interface PortRow {
  port: string;
  protocol: PortProtocol;
}

// WorkloadDialog adds or edits a workload of a namespace: name, kind, service
// account, selector labels and exposed ports. A workload may be saved without
// SA/ports - it renders red on the canvas and cannot anchor arrows.
export function WorkloadDialog({
  isOpen,
  onOpenChange,
  namespace,
  workload,
  onSave,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  namespace: TopoNamespace | null;
  // Present when editing, absent when adding.
  workload: TopoWorkload | null;
  onSave: (ns: string, prevId: string | null, w: TopoWorkload) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<WorkloadKind>("Deployment");
  const [sa, setSa] = useState("");
  const [selector, setSelector] = useState<KVRow[]>([]);
  const [ports, setPorts] = useState<PortRow[]>([]);
  const [errs, setErrs] = useState<string[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setErrs([]);
    if (workload) {
      setName(workload.name);
      setKind(workload.kind);
      setSa(workload.serviceAccount ?? "");
      setSelector(Object.entries(workload.selector).map(([key, value]) => ({ key, value })));
      setPorts(workload.ports.map((p) => ({ port: String(p.port), protocol: p.protocol })));
    } else {
      setName("");
      setKind("Deployment");
      setSa("");
      setSelector([{ key: "app.kubernetes.io/name", value: "" }]);
      setPorts([{ port: "", protocol: "TCP" }]);
    }
  }, [isOpen, workload]);

  if (!namespace) return null;

  function submit() {
    if (!namespace) return;
    const errors: string[] = [];
    const n = name.trim();
    if (!DNS_NAME_RE.test(n)) {
      errors.push("Имя workload должно быть в DNS-формате.");
    } else if (
      namespace.workloads.some((w) => w.name === n && w.id !== workload?.id)
    ) {
      errors.push(`Workload «${n}» уже есть в namespace ${namespace.name}.`);
    }
    const saTrim = sa.trim();
    if (saTrim && !DNS_NAME_RE.test(saTrim)) {
      errors.push("ServiceAccount должен быть в DNS-формате (или пустым).");
    }
    const sel: Record<string, string> = {};
    for (const row of selector) {
      const k = row.key.trim();
      const v = row.value.trim();
      if (!k && !v) continue;
      if (!k || !v) {
        errors.push("Selector: и ключ, и значение лейбла должны быть заполнены.");
        continue;
      }
      sel[k] = v;
    }
    if (Object.keys(sel).length === 0) {
      errors.push("Selector: нужен хотя бы один лейбл (по нему политика находит поды).");
    }
    const parsedPorts: { port: number; protocol: PortProtocol }[] = [];
    const seen = new Set<number>();
    for (const row of ports) {
      const t = row.port.trim();
      if (!t) continue;
      const num = Number(t);
      if (!Number.isInteger(num) || num < 1 || num > 65535) {
        errors.push(`Порт «${t}» должен быть целым числом от 1 до 65535.`);
        continue;
      }
      if (seen.has(num)) {
        errors.push(`Порт ${num} указан дважды.`);
        continue;
      }
      seen.add(num);
      parsedPorts.push({ port: num, protocol: row.protocol });
    }
    if (errors.length) {
      setErrs(errors);
      return;
    }
    onSave(namespace.name, workload?.id ?? null, {
      id: workloadId(namespace.name, n),
      name: n,
      kind,
      serviceAccount: saTrim || null,
      selector: sel,
      ports: parsedPorts,
    });
    onOpenChange(false);
  }

  return (
    <MapDialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={workload ? `Изменить workload (${namespace.name})` : `Добавить workload в ${namespace.name}`}
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Имя" value={name} onChange={setName} isRequired placeholder="backend" />
          <Select
            label="Тип"
            selectedKey={kind}
            onSelectionChange={setKind}
            options={WORKLOAD_KINDS.map((k) => ({ id: k, label: k }))}
          />
        </div>
        <TextField
          label="ServiceAccount"
          value={sa}
          onChange={setSa}
          placeholder="backend-sa"
          description="Пусто - workload будет помечен как невалидный конец стрелки."
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-gray-700">Selector (лейблы подов)</legend>
          {selector.map((row, i) => (
            // Rows have no identity beyond position; the list is small and
            // append/remove-only, so index keys are acceptable here.
            // biome-ignore lint/suspicious/noArrayIndexKey: positional editor rows
            <div key={i} className="flex items-center gap-2">
              <div className="flex-1">
                <TextField
                  label={`Ключ лейбла ${i + 1}`}
                  hideLabel
                  value={row.key}
                  onChange={(v) => setSelector((rows) => rows.map((r, j) => (j === i ? { ...r, key: v } : r)))}
                  placeholder="app.kubernetes.io/name"
                />
              </div>
              <div className="flex-1">
                <TextField
                  label={`Значение лейбла ${i + 1}`}
                  hideLabel
                  value={row.value}
                  onChange={(v) => setSelector((rows) => rows.map((r, j) => (j === i ? { ...r, value: v } : r)))}
                  placeholder="backend"
                />
              </div>
              <button
                type="button"
                aria-label="Удалить лейбл"
                onClick={() => setSelector((rows) => rows.filter((_, j) => j !== i))}
                className="rounded-md p-1.5 text-gray-400 outline-none hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <IconTrash size={16} />
              </button>
            </div>
          ))}
          <Button
            className="self-start"
            onPress={() => setSelector((rows) => [...rows, { key: "", value: "" }])}
          >
            <IconPlus size={14} /> Лейбл
          </Button>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-gray-700">Exposed-порты</legend>
          {ports.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: positional editor rows
            <div key={i} className="flex items-center gap-2">
              <div className="w-28">
                <TextField
                  label={`Порт ${i + 1}`}
                  hideLabel
                  value={row.port}
                  onChange={(v) => setPorts((rows) => rows.map((r, j) => (j === i ? { ...r, port: v } : r)))}
                  placeholder="8080"
                />
              </div>
              <div className="w-32">
                <Select
                  label={`Протокол порта ${i + 1}`}
                  hideLabel
                  selectedKey={row.protocol}
                  onSelectionChange={(p) =>
                    setPorts((rows) => rows.map((r, j) => (j === i ? { ...r, protocol: p } : r)))
                  }
                  options={PORT_PROTOCOLS.map((p) => ({ id: p, label: p }))}
                />
              </div>
              <button
                type="button"
                aria-label="Удалить порт"
                onClick={() => setPorts((rows) => rows.filter((_, j) => j !== i))}
                className="rounded-md p-1.5 text-gray-400 outline-none hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <IconTrash size={16} />
              </button>
            </div>
          ))}
          <Button className="self-start" onPress={() => setPorts((rows) => [...rows, { port: "", protocol: "TCP" }])}>
            <IconPlus size={14} /> Порт
          </Button>
        </fieldset>

        {errs.length > 0 && <FormErrors message={errs.join(" ")} />}
        <div className="flex justify-end gap-2 border-t border-gray-200 pt-3">
          <Button onPress={() => onOpenChange(false)}>Отмена</Button>
          <Button variant="primary" onPress={submit}>
            {workload ? "Сохранить" : "Добавить"}
          </Button>
        </div>
      </div>
    </MapDialog>
  );
}

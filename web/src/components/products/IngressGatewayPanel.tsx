import { useEffect, useMemo, useState } from "react";
import yaml from "js-yaml";
import {
  Button as AriaButton,
  Dialog,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  ModalOverlay,
  Popover,
} from "react-aria-components";
import { IconDotsVertical, IconPencil, IconTrash, IconX } from "@tabler/icons-react";
import { api, HttpError } from "../../api/client";
import { useAsync } from "../../hooks/useAsync";
import { SchemaForm, pruneEmpty, collectErrors, type View } from "../../form/SchemaForm";
import { Button, ErrorBox, Spinner } from "../ui";
import { ConfirmDialog } from "../ConfirmDialog";
import type { ProductTabProps } from "./registry";

type Values = Record<string, any>;

function parseValues(valuesYaml: string): Values {
  try {
    return (yaml.load(valuesYaml) as Values) ?? {};
  } catch {
    return {};
  }
}

// resolveRef walks a local "#/definitions/..." JSON pointer in the schema.
function resolveRef(schema: Values, ref: string): Values {
  if (!ref.startsWith("#/")) return {};
  let cur: any = schema;
  for (const p of ref.slice(2).split("/")) {
    cur = cur?.[decodeURIComponent(p)];
    if (cur == null) return {};
  }
  return cur as Values;
}

interface Column {
  header: string;
  // `full` is the order's whole values, so a cell can derive cross-field display
  // (e.g. a route's effective hostname, taken from the listener it references).
  cell: (item: Values, full: Values) => React.ReactNode;
}
interface ItemConfig {
  itemRef: string; // schema $ref of one array item (e.g. #/definitions/gatewayListener)
  label: string; // singular, e.g. "Listener" / "Маршрут"
  minItems: number; // can't delete below this (e.g. 1 listener)
  columns: Column[];
  read: (values: Values) => Values[]; // current items from full values
  write: (full: Values, items: Values[]) => void; // write items back into full values
  empty: string; // text when there are none
  // Optional: enrich the item's form schema using the order's full values, e.g.
  // inject dynamic enums (listener names/hostnames) into the route form.
  enrichSchema?: (itemSchema: Values, full: Values) => Values;
  // Optional: post-process an item before it's saved (e.g. force enabled=true,
  // fill parentRefs[].gateway with our Gateway's name).
  prepare?: (item: Values, full: Values) => Values;
  // Optional: pick the item-form presentation view from the chart's approved
  // view document (e.g. hide enabled/gateway). Keeps presentation in the view
  // document, not in the chart schema.
  itemView?: (ui: any) => View | undefined;
}

const SAVE_HINT = "Изменение откроет merge request с обновлёнными values (для активного сервиса).";

// ItemsTab renders existing array items as a table and lets the user add (via the
// "Действия" menu + a modal), edit (per-row) and delete them. Each change merges
// back into the order's values and PATCHes the request (opens an MR for a live one).
function ItemsTab({ request, modifiable, reload, config }: ProductTabProps & { config: ItemConfig }) {
  const full = useMemo(() => parseValues(request.values_yaml), [request.values_yaml]);
  const items = config.read(full);
  // Item-form presentation comes from the chart's approved view document (so
  // hiding fields stays in the view document, not the chart schema).
  const { data: itemView } = useAsync(
    () =>
      config.itemView
        ? api
            .getChartView(request.chart_project, request.chart_name)
            .then((j) => (j ? config.itemView!(j) ?? null : null))
            .catch(() => null)
        : Promise.resolve(null),
    [request.chart_project, request.chart_name],
  );
  const [editIndex, setEditIndex] = useState<number | null>(null); // row index being edited
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null); // row index pending delete

  const modalOpen = adding || editIndex !== null;
  const initial = editIndex !== null ? items[editIndex] : null;

  async function commit(next: Values[]) {
    const full = parseValues(request.values_yaml);
    config.write(full, next);
    await api.updateRequest(request.id, { values: pruneEmpty(full) });
    reload();
  }

  async function saveItem(item: Values) {
    const prepared = config.prepare ? config.prepare(item, full) : item;
    const next = editIndex !== null ? items.map((x, i) => (i === editIndex ? prepared : x)) : [...items, prepared];
    await commit(next); // throws on error -> modal keeps open + shows it
    setAdding(false);
    setEditIndex(null);
  }

  async function onConfirmDelete() {
    if (deleting === null || items.length <= config.minItems) return;
    await commit(items.filter((_, idx) => idx !== deleting)); // throws -> shown in the dialog
  }

  const atMin = items.length <= config.minItems;
  const delName = deleting !== null ? items[deleting]?.name : undefined;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-400">{items.length} шт.</span>
        {modifiable && (
          <MenuTrigger>
            <AriaButton className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-brand-200 bg-white px-3 py-1.5 text-sm font-medium text-brand-600 outline-none hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500">
              <IconDotsVertical size={16} stroke={1.8} className="text-brand-600" />
              Действия
            </AriaButton>
            <Popover className="min-w-44 rounded-md border border-slate-200 bg-white py-1 shadow-lg outline-none entering:animate-in entering:fade-in">
              <Menu className="outline-none" onAction={(k) => k === "add" && setAdding(true)}>
                <MenuItem
                  id="add"
                  className="cursor-pointer px-3 py-1.5 text-sm text-slate-700 outline-none focus:bg-slate-50"
                >
                  Добавить {config.label}
                </MenuItem>
              </Menu>
            </Popover>
          </MenuTrigger>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-gray-500">{config.empty}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-gray-400">
            <tr>
              {config.columns.map((c) => (
                <th key={c.header} className="py-1 pr-4 font-medium">
                  {c.header}
                </th>
              ))}
              {modifiable && <th className="w-16 py-1" />}
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="border-t border-gray-100">
                {config.columns.map((c, ci) => (
                  <td key={c.header} className={`py-1.5 pr-4 ${ci === 0 ? "font-medium text-gray-800" : "text-gray-600"}`}>
                    {c.cell(it, full) ?? "—"}
                  </td>
                ))}
                {modifiable && (
                  <td className="py-1.5">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setEditIndex(i)}
                        aria-label="Редактировать"
                        className="rounded-md p-1 text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
                      >
                        <IconPencil size={15} stroke={1.8} />
                      </button>
                      <button
                        onClick={() => setDeleting(i)}
                        aria-label="Удалить"
                        disabled={atMin}
                        title={atMin ? `Минимум ${config.minItems} — последний удалить нельзя` : undefined}
                        className="rounded-md p-1 text-red-500 outline-none hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-40"
                      >
                        <IconTrash size={15} stroke={1.8} />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {atMin && config.minItems > 0 && (
        <p className="text-xs text-gray-400">Минимум {config.minItems} — последний удалить нельзя.</p>
      )}

      <ConfirmDialog
        isOpen={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        danger
        title={`Удалить ${config.label}?`}
        confirmLabel="Удалить"
        busyLabel="Удаляем…"
        message={
          <>
            {cap(config.label)} {delName ? `«${delName}»` : deleting !== null ? `#${deleting + 1}` : ""} будет удалён.{" "}
            {SAVE_HINT}
          </>
        }
        onConfirm={onConfirmDelete}
      />

      <ItemModal
        request={request}
        config={config}
        full={full}
        view={itemView ?? undefined}
        isOpen={modalOpen}
        initial={initial}
        onClose={() => {
          setAdding(false);
          setEditIndex(null);
        }}
        onSave={saveItem}
      />
    </div>
  );
}

// ItemModal renders a single array item as a schema-driven form (the item's
// definition from the chart schema) with client-side validation.
function ItemModal({
  request,
  config,
  full,
  view,
  isOpen,
  initial,
  onClose,
  onSave,
}: {
  request: ProductTabProps["request"];
  config: ItemConfig;
  full: Values;
  view?: View;
  isOpen: boolean;
  initial: Values | null;
  onClose: () => void;
  onSave: (item: Values) => Promise<void>;
}) {
  const { data: schema, loading, error } = useAsync(
    () => (isOpen ? api.getSchema(request.chart_project, request.chart_name, request.chart_version) : Promise.resolve(null)),
    [isOpen, request.chart_project, request.chart_name, request.chart_version],
  );
  // The form schema is the item's definition with the chart's definitions kept as
  // root so its inner $refs resolve. An optional enrichSchema injects dynamic
  // enums (e.g. listener names/hostnames) derived from the order's values.
  const itemSchema = useMemo(() => {
    if (!schema) return null;
    const base = { ...resolveRef(schema, config.itemRef), definitions: (schema as Values).definitions };
    return config.enrichSchema ? config.enrichSchema(base, full) : base;
  }, [schema, config, full]);

  const [item, setItem] = useState<Values>({});
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setItem(initial ? structuredClone(initial) : {});
    setShowErrors(false);
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const errors = useMemo(
    () => (itemSchema ? collectErrors(itemSchema, item, view) : new Map<string, string>()),
    [itemSchema, item, view],
  );

  async function save() {
    if (errors.size > 0) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await onSave(pruneEmpty(item));
    } catch (e) {
      setErr(e instanceof HttpError ? e.message : (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(o) => !o && onClose()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 entering:animate-in entering:fade-in"
    >
      <Modal className="max-h-[85vh] w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-xl outline-none entering:animate-in entering:zoom-in-95">
        <Dialog className="flex max-h-[85vh] flex-col outline-none">
          {({ close }) => (
            <>
              <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-gray-700">
                  {initial ? `Изменить ${config.label}` : `Новый ${config.label}`}
                </h2>
                <button
                  onClick={close}
                  aria-label="Закрыть"
                  className="rounded-md p-1 text-gray-400 outline-none hover:bg-gray-100 hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <IconX size={18} stroke={2} />
                </button>
              </header>
              <div className="flex-1 overflow-auto px-4 py-4">
                {loading ? (
                  <Spinner label="Загрузка схемы…" />
                ) : error ? (
                  <ErrorBox error={error} />
                ) : itemSchema ? (
                  <SchemaForm schema={itemSchema} value={item} onChange={setItem} view={view} errors={errors} showErrors={showErrors} />
                ) : (
                  <p className="text-sm text-gray-500">Нет схемы.</p>
                )}
                {err && <p className="mt-3 text-xs text-red-600">{err}</p>}
                <p className="mt-3 text-xs text-gray-500">{SAVE_HINT}</p>
              </div>
              <footer className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3">
                <button
                  onClick={close}
                  disabled={saving}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 outline-none hover:bg-gray-50 disabled:opacity-50"
                >
                  Отмена
                </button>
                <Button variant="primary" isDisabled={saving || !itemSchema} onPress={save}>
                  {saving ? "Сохраняем…" : "Сохранить"}
                </Button>
              </footer>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

// --- per-tab configs ---

const LISTENERS: ItemConfig = {
  itemRef: "#/definitions/gatewayListener",
  label: "listener",
  minItems: 1,
  empty: "Listener'ов пока нет.",
  columns: [
    { header: "Имя", cell: (l) => l.name },
    { header: "Порт", cell: (l) => l.port },
    { header: "Протокол", cell: (l) => l.protocol },
    { header: "Hostname", cell: (l) => l.hostname },
    { header: "TLS", cell: (l) => l.tlsMode },
  ],
  read: (v) => (Array.isArray(v.gateways?.[0]?.listeners) ? v.gateways[0].listeners : []),
  write: (full, items) => {
    if (!Array.isArray(full.gateways) || !full.gateways[0]) throw new Error("В values нет Gateway.");
    full.gateways[0].listeners = items;
  },
};

// listenersOf returns the listeners of this instance's single Gateway.
function listenersOf(full: Values): Values[] {
  const ls = full.gateways?.[0]?.listeners;
  return Array.isArray(ls) ? ls : [];
}

// routeHostnames derives a route's effective hostnames the same way the chart
// does: the listeners it references via parentRefs[].sectionName contribute their
// hostname (listeners without one contribute nothing). hostnames is never stored
// in values — it's hidden in the form and computed by the chart at render time.
function routeHostnames(route: Values, full: Values): string[] {
  const byName = new Map(listenersOf(full).map((l) => [l.name, l.hostname]));
  const sections = Array.isArray(route.parentRefs)
    ? (route.parentRefs.map((p: Values) => p.sectionName).filter(Boolean) as string[])
    : [];
  const hosts = sections.map((s) => byName.get(s)).filter(Boolean) as string[];
  return [...new Set(hosts)];
}

const ROUTES: ItemConfig = {
  itemRef: "#/definitions/xroute",
  label: "маршрут",
  minItems: 0,
  empty: "Маршрутов пока нет.",
  columns: [
    { header: "Имя", cell: (x) => x.name },
    { header: "Тип", cell: (x) => x.kind ?? "HTTPRoute" },
    // Derived from the referenced listener(s); empty = matches any host.
    { header: "Hostnames", cell: (x, full) => routeHostnames(x, full).join(", ") || "—" },
  ],
  read: (v) => (Array.isArray(v.xroutes) ? v.xroutes : []),
  write: (full, items) => {
    if (items.length) full.xroutes = items;
    else delete full.xroutes;
  },
  // Turn parentRefs[].sectionName into a picker sourced from the Gateway's own
  // listeners (their names). hostnames is NOT offered — it's hidden and derived
  // by the chart from the chosen listener's hostname.
  enrichSchema: (itemSchema, full) => {
    const names = [...new Set(listenersOf(full).map((l) => l.name).filter(Boolean))] as string[];
    const s = structuredClone(itemSchema);
    const sectionName = s.definitions?.routeParentRef?.properties?.sectionName;
    if (sectionName && names.length) sectionName.enum = names;
    return s;
  },
  // enabled is always true; parentRefs always point at our (single) Gateway, so
  // fill its name automatically (the field is hidden in the form). hostnames is
  // never submitted — dropping it lets the chart derive it from the listener the
  // route references (parentRefs[].sectionName), per the requirement.
  prepare: (item, full) => {
    const gateway = full.gateways?.[0]?.name;
    const out: Values = { ...item, enabled: true };
    delete out.hostnames;
    if (Array.isArray(out.parentRefs) && gateway) {
      out.parentRefs = out.parentRefs.map((p: Values) => ({ ...p, gateway }));
    }
    return out;
  },
  // Presentation (hide enabled, hide parentRefs[].gateway) lives in the routes
  // view of the chart's view document, applied to one xroute item.
  itemView: (ui) => ui?.views?.routes?.overrides?.xroutes?.["ui:view"],
};

export function IngressListenersTab(props: ProductTabProps) {
  return <ItemsTab {...props} config={LISTENERS} />;
}
export function IngressRoutesTab(props: ProductTabProps) {
  return <ItemsTab {...props} config={ROUTES} />;
}

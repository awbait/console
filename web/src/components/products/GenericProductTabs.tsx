import {
  IconAdjustmentsHorizontal,
  IconDotsVertical,
  IconInfoCircle,
  IconPencil,
  IconPlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import yaml from "js-yaml";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { api, HttpError } from "../../api/client";
import type { OrderRequest, ViewDocument, ViewTab } from "../../api/types";
import { chartLabel } from "../../app/CatalogContext";
import { collectErrors, pruneEmpty, SchemaForm, seedDefaults, type View } from "../../form/SchemaForm";
import { useAsync } from "../../hooks/useAsync";
import { ConfirmDialog } from "../ConfirmDialog";
import { FormErrors, type SubmitError, toSubmitError } from "../FormErrors";
import { Button, Hint, Spinner } from "../ui";
import {
  type ActionPlacement,
  actionViews,
  applyEnums,
  computeCell,
  type EnumRule,
  getAt,
  type ResolvedTab,
  resolveTab,
  setAt,
} from "./genericView";

type Values = Record<string, any>;

// PersistValues overrides how value edits are saved. The real product page omits
// it and writes through the API (api.updateRequest + reload); the chart-manage
// preview passes one that writes to local state, so the same components render
// identically without touching the backend.
export type PersistValues = (values: Values) => Promise<void> | void;


// actionLabel is the text of an action's menu item: its explicit label, else a
// generic fallback built from the view id.
function actionLabel(a: ActionPlacement): string {
  return a.label ?? `Редактировать ${a.view}`;
}

// FormDialogShell is the shared chrome of the product form dialogs, styled as a
// full-height slide-over panel on the right (console pattern for editing list
// entries): blurred backdrop, icon-tile header with a title/subtitle pair, a
// scrollable body and a tinted footer pinned to the bottom.
function FormDialogShell({
  isOpen,
  onClose,
  icon,
  title,
  subtitle,
  maxWidth = "max-w-xl",
  footer,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  maxWidth?: string;
  footer: (close: () => void) => React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(o) => !o && onClose()}
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[2px] entering:animate-in entering:fade-in entering:duration-200 exiting:animate-out exiting:fade-out exiting:duration-200 exiting:fill-mode-forwards"
    >
      <Modal
        className={`fixed inset-y-0 right-0 w-full ${maxWidth} border-l border-slate-200 bg-surface shadow-2xl outline-none entering:animate-in entering:slide-in-from-right entering:duration-300 entering:ease-out exiting:animate-out exiting:slide-out-to-right exiting:duration-200 exiting:fill-mode-forwards`}
      >
        <Dialog className="flex h-full flex-col outline-none">
          {({ close }) => (
            <>
              <header className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  {icon}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-base font-semibold text-slate-800">{title}</h2>
                  {subtitle && <p className="truncate text-xs text-slate-400">{subtitle}</p>}
                </div>
                <button
                  onClick={close}
                  aria-label="Закрыть"
                  className="rounded-md p-1.5 text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <IconX size={18} stroke={2} />
                </button>
              </header>
              <div className="flex-1 overflow-auto px-5 py-5">{children}</div>
              <footer className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3.5">
                {footer(close)}
              </footer>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

// rebaseFieldErrors re-roots server validation paths (absolute JSON pointers
// into the full values document) onto the edited element, so a dialog's error
// summary can resolve them against the element schema/view it renders. Errors
// outside the edited element keep their absolute path.
function rebaseFieldErrors(e: unknown, basePath: string): unknown {
  if (e instanceof HttpError && e.details.length > 0) {
    e.details = e.details.map((d) =>
      d.path === basePath || d.path.startsWith(`${basePath}/`)
        ? { ...d, path: d.path.slice(basePath.length) }
        : d,
    );
  }
  return e;
}

// revealSummary scrolls a dialog's error summary into view after the next
// paint (the summary may be mounted in the same tick that reveals it).
function revealSummary(ref: React.RefObject<HTMLDivElement | null>) {
  requestAnimationFrame(() =>
    ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
  );
}

function parseValues(valuesYaml: string): Values {
  try {
    return (yaml.load(valuesYaml) as Values) ?? {};
  } catch {
    return {};
  }
}

// fmtScalar renders a resolved cell value as plain text: a string map (e.g. a
// PodSelector) as "key: value" pairs, an array as its formatted elements joined,
// scalars as-is. Empty parts are dropped; an empty result yields "" (fmtCell
// turns that into the "-" placeholder).
function fmtScalar(v: unknown): string {
  if (v == null || v === "") return "";
  if (Array.isArray(v)) return v.map(fmtScalar).filter((s) => s !== "").join(", ");
  if (typeof v === "object")
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${k}: ${fmtScalar(val)}`)
      .join(", ");
  return String(v);
}

function fmtCell(v: unknown): React.ReactNode {
  const s = fmtScalar(v);
  return s === "" ? "-" : s;
}

// Stub explains an unconfigured tab (items/form missing, or no ui:table) instead
// of rendering a broken table.
function Stub({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-sm text-amber-600">
      <IconInfoCircle size={16} stroke={1.8} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

// SchemaLoadError explains a failed chart-schema fetch in a tab or an action form.
// A 404 means the order's chart version is absent from the registry the portal is
// currently talking to (e.g. an order created against real Harbor opened while the
// portal runs HARBOR_MODE=fake), so the user gets a plain-language hint instead of
// a bare "not_found" code; other failures fall back to a short technical detail.
function SchemaLoadError({ request, error }: { request: OrderRequest; error: Error }) {
  const missing = error instanceof HttpError && error.status === 404;
  const product = chartLabel(request.chart_name);
  const detail =
    error instanceof HttpError ? `${error.code} (HTTP ${error.status})` : error.message;
  return (
    <p className="flex items-start gap-1.5 text-sm text-amber-600">
      <IconInfoCircle size={16} stroke={1.8} className="mt-0.5 shrink-0" />
      <span>
        {missing ? (
          <>
            Не удалось загрузить настройки версии{" "}
            <span className="font-medium">{request.chart_version}</span> продукта «{product}». За
            подробностями обратитесь к администрации портала.
          </>
        ) : (
          <>
            Не удалось загрузить раздел, попробуйте позже. За подробностями обратитесь к администрации
            портала. ({detail})
          </>
        )}
      </span>
    </p>
  );
}

// GenericListTab renders one product tab: a list table with add/edit/delete. The
// edited array (items pointer), the element form (a view) and the columns come
// from the tab declaration resolved against the schema. Without ui:table (or a
// valid items/form) it shows a "not configured" stub.
export function GenericListTab({
  request,
  modifiable,
  reload,
  doc,
  tab,
  schema: schemaProp,
  persist,
}: {
  request: OrderRequest;
  modifiable: boolean;
  reload: () => void;
  doc: ViewDocument;
  tab: ViewTab;
  // Preloaded schema (preview): when set, the component skips its own fetch.
  schema?: Values;
  // Local save adapter (preview): when set, edits are not written via the API.
  persist?: PersistValues;
}) {
  // Schema is loaded for the order's version, so the form matches what the order
  // was created on (not the latest chart). In preview a schema is passed in, so
  // we skip the fetch entirely.
  const fetched = useAsync(
    () =>
      schemaProp
        ? Promise.resolve(null)
        : api.getSchema(request.chart_project, request.chart_name, request.chart_version),
    [schemaProp, request.chart_project, request.chart_name, request.chart_version],
  );
  const schema = schemaProp ?? fetched.data;
  const loading = !schemaProp && fetched.loading;
  const error = schemaProp ? null : fetched.error;
  const resolved = useMemo(() => resolveTab(schema, tab, doc), [schema, tab, doc]);
  const label = tab.title ?? tab.id;

  if (loading) return <Spinner label="Загрузка схемы…" />;
  if (error) return <SchemaLoadError request={request} error={error} />;
  if (!schema) return <p className="text-sm text-gray-500">Нет схемы.</p>;
  if (!resolved) {
    return (
      <Stub>
        Вкладка «{label}» не сконфигурирована: проверьте «items» (путь к массиву) и «form» (форма элемента из
        views).
      </Stub>
    );
  }
  // Even without ui:table columns we still render the editor: the form is
  // assigned, so the actions menu (Add + assigned views) stays usable;
  // the list itself just shows a neutral placeholder instead of a table.
  return (
    <ListEditor
      request={request}
      modifiable={modifiable}
      reload={reload}
      target={resolved}
      label={label}
      addLabel={tab.addLabel ?? `Добавить ${label}`}
      extraActions={actionViews(doc, `tab:${tab.id}`)}
      doc={doc}
      schema={schemaProp}
      persist={persist}
    />
  );
}

function ListEditor({
  request,
  modifiable,
  reload,
  target,
  label,
  addLabel,
  extraActions,
  doc,
  schema,
  persist,
}: {
  request: OrderRequest;
  modifiable: boolean;
  reload: () => void;
  target: ResolvedTab;
  label: string;
  addLabel: string;
  extraActions: ActionPlacement[];
  doc: ViewDocument;
  schema?: Values;
  persist?: PersistValues;
}) {
  const full = useMemo(() => parseValues(request.values_yaml), [request.values_yaml]);
  const items: Values[] = Array.isArray(getAt(full, target.itemsPath)) ? getAt(full, target.itemsPath) : [];
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [action, setAction] = useState<string | null>(null); // open action-view modal

  const modalOpen = adding || editIndex !== null;
  const initial = editIndex !== null ? items[editIndex] : null;
  const atMin = items.length <= target.minItems;
  const cols = target.columns;

  async function commit(next: Values[]) {
    const copy = parseValues(request.values_yaml);
    setAt(copy, target.itemsPath, next);
    const pruned = pruneEmpty(copy);
    if (persist) {
      await persist(pruned);
    } else {
      await api.updateRequest(request.id, { values: pruned });
      reload();
    }
  }
  async function saveItem(item: Values) {
    const idx = editIndex !== null ? editIndex : items.length;
    const next = editIndex !== null ? items.map((x, i) => (i === editIndex ? item : x)) : [...items, item];
    try {
      await commit(next);
    } catch (e) {
      // Server validation paths point into the FULL values document, while the
      // dialog renders the element's schema: re-root them onto the edited item
      // so its error summary shows proper field breadcrumbs.
      throw rebaseFieldErrors(e, `${target.itemsPath}/${idx}`);
    }
    setAdding(false);
    setEditIndex(null);
  }
  async function onConfirmDelete() {
    if (deleting === null || atMin) return;
    await commit(items.filter((_, i) => i !== deleting));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-700">{label}</h2>
        {modifiable && (
          <MenuTrigger>
            <AriaButton className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-brand-200 bg-surface px-3 py-1.5 text-sm font-medium text-brand-600 outline-none hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500">
              <IconDotsVertical size={16} stroke={1.8} className="text-brand-600" />
              Действия
            </AriaButton>
            <Popover className="min-w-56 rounded-md border border-slate-200 bg-surface py-1 shadow-lg outline-none entering:animate-in entering:fade-in">
              <Menu
                className="outline-none"
                onAction={(k) => {
                  if (k === "add") setAdding(true);
                  else setAction(String(k));
                }}
              >
                <MenuItem
                  id="add"
                  className="cursor-pointer px-3 py-1.5 text-sm text-slate-700 outline-none focus:bg-slate-50"
                >
                  {addLabel}
                </MenuItem>
                {extraActions.map((a) => (
                  <MenuItem
                    key={a.view}
                    id={a.view}
                    className="cursor-pointer px-3 py-1.5 text-sm text-slate-700 outline-none focus:bg-slate-50"
                  >
                    {actionLabel(a)}
                  </MenuItem>
                ))}
              </Menu>
            </Popover>
          </MenuTrigger>
        )}
      </div>

      {cols.length === 0 ? (
        <p className="text-sm text-gray-500">Здесь пока нечего показать.</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500">Пока пусто.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-gray-400">
            <tr>
              {cols.map((c) => (
                <th key={c.label} className="py-1 pr-4 font-medium">
                  {c.label}
                </th>
              ))}
              {modifiable && <th className="w-16 py-1" />}
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="border-t border-gray-100">
                {cols.map((c, ci) => (
                  <td
                    key={c.label}
                    className={`py-1.5 pr-4 ${ci === 0 ? "font-medium text-gray-800" : "text-gray-600"}`}
                  >
                    {fmtCell(computeCell(it, full, c))}
                  </td>
                ))}
                {modifiable && (
                  <td className="py-1.5">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setEditIndex(i)}
                        aria-label="Редактировать"
                        className="rounded-md p-1 text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500"
                      >
                        <IconPencil size={15} stroke={1.8} />
                      </button>
                      <Hint text={atMin ? "Нельзя удалить последний элемент" : "Удалить"}>
                        <AriaButton
                          onPress={() => !atMin && setDeleting(i)}
                          aria-label="Удалить"
                          className={`rounded-md p-1 text-red-500 outline-none hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-brand-500 ${atMin ? "opacity-40" : ""}`}
                        >
                          <IconTrash size={15} stroke={1.8} />
                        </AriaButton>
                      </Hint>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ConfirmDialog
        isOpen={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        danger
        title={`Удалить ${label}?`}
        confirmLabel="Удалить"
        busyLabel="Удаляем…"
        message={<>Элемент {deleting !== null ? `#${deleting + 1}` : ""} будет удалён.</>}
        onConfirm={onConfirmDelete}
      />

      <ItemModal
        itemSchema={target.itemSchema}
        enums={target.enums}
        full={full}
        view={target.form}
        label={label}
        isOpen={modalOpen}
        initial={initial}
        onClose={() => {
          setAdding(false);
          setEditIndex(null);
        }}
        onSave={saveItem}
      />

      {action && (
        <ViewFormModal
          request={request}
          project={request.chart_project}
          name={request.chart_name}
          version={request.chart_version}
          view={doc.views?.[action] as View}
          title={doc.views?.[action] ? actionLabel({ view: action, label: actionTitle(doc, action) }) : action}
          isOpen
          onClose={() => setAction(null)}
          onSaved={reload}
          schema={schema}
          persist={persist}
        />
      )}
    </div>
  );
}

// actionTitle returns the menu label declared for an action view (so the modal
// header matches the menu item the user clicked).
function actionTitle(doc: ViewDocument, view: string): string | undefined {
  return doc.actions?.find((a) => a.view === view)?.label;
}

// ItemModal renders one array item as a schema-driven form: the item's deref'd
// schema (definitions kept at root) projected through the tab's element form view.
function ItemModal({
  itemSchema,
  enums,
  full,
  view,
  label,
  isOpen,
  initial,
  onClose,
  onSave,
}: {
  itemSchema: Values;
  enums: EnumRule[];
  full: Values;
  view: View | undefined;
  label: string;
  isOpen: boolean;
  initial: Values | null;
  onClose: () => void;
  onSave: (item: Values) => Promise<void>;
}) {
  const [item, setItem] = useState<Values>({});
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<SubmitError | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    // A new item is seeded with the schema's const/default values (e.g. route
    // kind=HTTPRoute), so the value matches what the form shows and the table
    // reads, instead of staying undefined until the user touches each field.
    setItem(initial ? structuredClone(initial) : ((seedDefaults(itemSchema, itemSchema) as Values) ?? {}));
    setShowErrors(false);
    setErr(null);
  }, [isOpen, initial, itemSchema]);

  // Dynamic enums (e.g. listener names for parentRefs[].sectionName) are injected
  // from the order's full values before the form renders and validates.
  const schema = useMemo(() => applyEnums(itemSchema, enums, full), [itemSchema, enums, full]);
  const errors = useMemo(() => collectErrors(schema, item, view), [schema, item, view]);

  async function save() {
    if (errors.size > 0) {
      setShowErrors(true);
      // The save button lives in the fixed footer while the summary is at the
      // bottom of the scrollable body: bring it into view, or a blocked save
      // looks like a no-op when the user is scrolled up.
      revealSummary(summaryRef);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await onSave(pruneEmpty(item));
    } catch (e) {
      setErr(toSubmitError(e));
      revealSummary(summaryRef);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialogShell
      isOpen={isOpen}
      onClose={onClose}
      icon={initial ? <IconPencil size={18} stroke={1.8} /> : <IconPlus size={18} stroke={1.8} />}
      title={label}
      subtitle={initial ? "Изменение элемента" : "Новый элемент"}
      footer={(close) => (
        <>
          <button
            onClick={close}
            disabled={saving}
            className="rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm font-medium text-gray-700 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
          >
            Отмена
          </button>
          <Button variant="primary" isDisabled={saving} onPress={save}>
            {saving ? "Сохраняем…" : "Сохранить"}
          </Button>
        </>
      )}
    >
      <SchemaForm
        schema={schema}
        value={item}
        onChange={setItem}
        view={view}
        errors={errors}
        showErrors={showErrors}
        lockReadOnly={initial !== null}
      />
      {/* One error surface for both kinds: the client-side field summary and
          the server (domain/422) error with its details. */}
      {(err || (showErrors && errors.size > 0)) && (
        <div ref={summaryRef} className="mt-3 scroll-mb-3">
          <FormErrors
            message={err?.message ?? "Заполните обязательные поля, отмеченные красным."}
            details={err?.details}
            fieldErrors={showErrors && errors.size > 0 ? errors : undefined}
            schema={schema}
            view={view}
          />
        </div>
      )}
    </FormDialogShell>
  );
}

// GenericInfoActions is the actions dropdown on the general-info tab. It
// lists every form-view placed at in:"info" and opens it as a schema+view driven
// form over the order's values.
export function GenericInfoActions({
  request,
  doc,
  onChanged,
  schema,
  persist,
}: {
  request: OrderRequest;
  doc: ViewDocument;
  onChanged: () => void;
  schema?: Values;
  persist?: PersistValues;
}) {
  const actions = actionViews(doc, "info").filter((a) => doc.views?.[a.view]);
  const [open, setOpen] = useState<string | null>(null);
  if (actions.length === 0) return null;
  const item = "cursor-pointer px-3 py-1.5 text-sm text-slate-700 outline-none focus:bg-slate-50";
  const current = actions.find((a) => a.view === open);
  return (
    <>
      <MenuTrigger>
        <AriaButton className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-brand-200 bg-surface px-3 py-1.5 text-sm font-medium text-brand-600 outline-none hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500">
          <IconDotsVertical size={16} stroke={1.8} className="text-brand-600" />
          Действия
        </AriaButton>
        <Popover className="min-w-56 rounded-md border border-slate-200 bg-surface py-1 shadow-lg outline-none entering:animate-in entering:fade-in">
          <Menu className="outline-none" onAction={(k) => setOpen(String(k))}>
            {actions.map((a) => (
              <MenuItem key={a.view} id={a.view} className={item}>
                {actionLabel(a)}
              </MenuItem>
            ))}
          </Menu>
        </Popover>
      </MenuTrigger>
      {open && current && (
        <ViewFormModal
          request={request}
          project={request.chart_project}
          name={request.chart_name}
          version={request.chart_version}
          view={doc.views?.[open] as View}
          title={actionLabel(current)}
          isOpen
          onClose={() => setOpen(null)}
          onSaved={onChanged}
          schema={schema}
          persist={persist}
        />
      )}
    </>
  );
}

// ViewFormModal edits the order's values through a single form-view projection.
// The form is seeded with the whole current values; only the view's visible fields
// are shown; on save the merged values are PATCHed. Schema is fetched lazily for
// the order's version.
function ViewFormModal({
  request,
  project,
  name,
  version,
  view,
  title,
  isOpen,
  onClose,
  onSaved,
  schema: schemaProp,
  persist,
}: {
  request: OrderRequest;
  project: string;
  name: string;
  version: string;
  view: View;
  title: string;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  schema?: Values;
  persist?: PersistValues;
}) {
  const fetched = useAsync(
    () => (isOpen && !schemaProp ? api.getSchema(project, name, version) : Promise.resolve(null)),
    [isOpen, schemaProp, project, name, version],
  );
  const schema = schemaProp ?? fetched.data;
  const loading = !schemaProp && fetched.loading;
  const error = schemaProp ? null : fetched.error;
  const [value, setValue] = useState<Values>({});
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<SubmitError | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  // Client-side validation against the schema (honoring the view), like the order
  // form and the list-item modal, so invalid/required fields are caught before the
  // PATCH and surfaced inline plus in the summary below.
  const errors = useMemo(
    () => (schema ? collectErrors(schema, value, view) : new Map<string, string>()),
    [schema, value, view],
  );

  useEffect(() => {
    if (!isOpen) return;
    setValue(parseValues(request.values_yaml));
    setShowErrors(false);
    setErr(null);
  }, [isOpen, request.values_yaml]);

  async function save() {
    if (errors.size > 0) {
      setShowErrors(true);
      revealSummary(summaryRef);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const pruned = pruneEmpty(value);
      if (persist) await persist(pruned);
      else await api.updateRequest(request.id, { values: pruned });
      onClose();
      onSaved();
    } catch (e) {
      setErr(toSubmitError(e));
      revealSummary(summaryRef);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialogShell
      isOpen={isOpen}
      onClose={onClose}
      icon={<IconAdjustmentsHorizontal size={18} stroke={1.8} />}
      title={title}
      subtitle="Параметры заказа"
      maxWidth="max-w-lg"
      footer={(close) => (
        <>
          <button
            onClick={close}
            disabled={saving}
            className="rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm font-medium text-gray-700 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
          >
            Отмена
          </button>
          <Button variant="primary" isDisabled={saving || !schema} onPress={save}>
            {saving ? "Сохраняем…" : "Сохранить"}
          </Button>
        </>
      )}
    >
      {loading ? (
        <Spinner label="Загрузка схемы…" />
      ) : error ? (
        <SchemaLoadError request={request} error={error} />
      ) : schema ? (
        <SchemaForm
          schema={schema}
          value={value}
          onChange={setValue}
          view={view}
          errors={errors}
          showErrors={showErrors}
          lockReadOnly
        />
      ) : (
        <p className="text-sm text-gray-500">Нет схемы.</p>
      )}
      {(err || (showErrors && errors.size > 0)) && (
        <div ref={summaryRef} className="mt-3 scroll-mb-3">
          <FormErrors
            message={err?.message ?? "Заполните обязательные поля, отмеченные красным."}
            details={err?.details}
            fieldErrors={showErrors && errors.size > 0 ? errors : undefined}
            schema={schema ?? undefined}
            view={view}
          />
        </div>
      )}
    </FormDialogShell>
  );
}

// OrderYamlDialog: view and bulk-edit the order's values.yaml directly from
// the order card. Follows the OrderGraphDialog pattern: a nearly full-screen
// modal whose unsaved draft survives closing the window, with a button dot
// signalling pending edits, live YAML syntax markers, a Diff preview tab, and
// a dry-run server check before creating an update merge request.

import Editor, { DiffEditor, type OnMount } from "@monaco-editor/react";
import {
  IconAlertTriangle,
  IconCheck,
  IconFileCode,
  IconInfoCircle,
  IconX,
} from "@tabler/icons-react";
import type * as Monaco from "monaco-editor";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button as AriaButton,
  Dialog,
  DialogTrigger,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";
import { api, HttpError } from "@/api/client";
import { changeInFlightText } from "@/api/errorText";
import type { OrderRequest, RequestMR, Stand, ViewDocument } from "@/api/types";
import { usePlatformHealth } from "@/app/PlatformHealthContext";
import { useTheme } from "@/app/ThemeContext";
import { useToast } from "@/app/ToastContext";
import { FormErrors, type SubmitError, toSubmitError } from "@/components/FormErrors";
import type { PersistValues } from "@/components/products/GenericProductTabs";
import { Button, buttonClass } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import {
  hasYamlChanges,
  normalizeSavedYaml,
  parseSavedValues,
  parseYamlDocument,
  touchedStampedFields,
  yamlLock,
  yamlText,
} from "./orderYaml";

const SYNTAX_MARKER_OWNER = "order-yaml-syntax";
const MARKER_DEBOUNCE_MS = 250;

type CheckResult = {
  changed: boolean;
  valuesYaml: string;
};

export function OrderYamlDialog({
  request: r,
  doc,
  stand,
  modifiable,
  openMR,
  reload,
  schema: schemaProp,
  persist,
}: {
  request: OrderRequest;
  doc: ViewDocument;
  stand?: Stand;
  modifiable: boolean;
  openMR?: RequestMR | null;
  reload: () => void;
  // Preview only (chart editor): preloaded schema + local save adapter (no API).
  schema?: Record<string, any>;
  persist?: PersistValues;
}) {
  const { theme } = useTheme();
  const toast = useToast();
  const monacoTheme = theme === "light" ? "light" : "vs-dark";

  const [isOpen, setIsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"editor" | "diff">("editor");
  // baseYaml tracks the server snapshot the current draft was forked from, so
  // an SSE reload never silently overwrites in-progress edits.
  const [baseYaml, setBaseYaml] = useState(r.values_yaml);
  const [draft, setDraft] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<SubmitError | null>(null);

  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);

  // Keep baseYaml in sync with the live order while the user has no unsaved draft.
  useEffect(() => {
    if (draft === null) {
      setBaseYaml(r.values_yaml);
    }
  }, [r.values_yaml, draft]);

  // Reset the active draft if the component moves to another order id.
  useEffect(() => {
    setDraft(null);
    setBaseYaml(r.values_yaml);
    setCheckResult(null);
    setErr(null);
    setViewMode("editor");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.id]);

  const lock = yamlLock(r, modifiable, openMR);
  const orderingOutage = usePlatformHealth().blockedReason("ordering");
  // Portal-only stands (mode === "console") and chart previews do not write to Git.
  const saveBlocked = !persist && stand?.mode !== "console" ? orderingOutage : undefined;

  // Load the effective schema lazily when the editable dialog opens, so server
  // 422 FieldErrors render human-readable field names in FormErrors.
  const fetchedSchema = useAsync(
    (signal) =>
      isOpen && !schemaProp && !lock
        ? api
            .getFormSchema(r.chart_project, r.chart_name, r.chart_version, signal)
            .catch(() => null)
        : Promise.resolve(null),
    [isOpen, schemaProp, lock, r.chart_project, r.chart_name, r.chart_version],
  );
  const schema = schemaProp ?? fetchedSchema.data;

  const text = draft ?? r.values_yaml;
  const stale = draft !== null && baseYaml !== r.values_yaml;
  const parsed = useMemo(() => parseYamlDocument(text), [text]);
  const dirty = draft !== null && hasYamlChanges(baseYaml, draft);
  const savedValues = useMemo(() => parseSavedValues(baseYaml), [baseYaml]);
  const stampedTouched = useMemo(
    () => (parsed.ok && dirty ? touchedStampedFields(doc, savedValues, parsed.values) : []),
    [doc, savedValues, parsed, dirty],
  );

  // Update Monaco syntax squiggles (debounced) so line/column errors show in-editor.
  useEffect(() => {
    if (!isOpen || viewMode !== "editor" || lock) return;
    const timer = setTimeout(() => {
      const ed = editorRef.current;
      const monaco = monacoRef.current;
      const model = ed?.getModel();
      if (!monaco || !model) return;
      if (!parsed.ok && parsed.kind === "syntax") {
        const line = Math.min(Math.max(parsed.line ?? 1, 1), model.getLineCount());
        const maxCol = model.getLineMaxColumn(line);
        const col = Math.min(Math.max(parsed.column ?? 1, 1), maxCol);
        monaco.editor.setModelMarkers(model, SYNTAX_MARKER_OWNER, [
          {
            severity: monaco.MarkerSeverity.Error,
            message: parsed.message,
            startLineNumber: line,
            startColumn: col,
            endLineNumber: line,
            endColumn: Math.min(col + 1, maxCol),
          },
        ]);
      } else {
        monaco.editor.setModelMarkers(model, SYNTAX_MARKER_OWNER, []);
      }
    }, MARKER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isOpen, viewMode, lock, parsed]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
  };

  function handleChange(value: string | undefined) {
    const next = value ?? "";
    setDraft(next);
    setErr(null);
    setCheckResult(null);
  }

  function discard() {
    setDraft(null);
    setBaseYaml(r.values_yaml);
    setErr(null);
    setCheckResult(null);
    setViewMode("editor");
  }

  function acceptLatest() {
    setDraft(null);
    setBaseYaml(r.values_yaml);
    setErr(null);
    setCheckResult(null);
  }

  async function runCheck() {
    if (!parsed.ok || lock || persist) return;
    setChecking(true);
    setErr(null);
    setCheckResult(null);
    try {
      const res = await api.validateRequest(r.id, { values: parsed.values });
      setCheckResult({ changed: res.changed, valuesYaml: res.values_yaml });
    } catch (e) {
      setErr(toSubmitError(e));
    } finally {
      setChecking(false);
    }
  }

  async function save(close: () => void) {
    if (!parsed.ok || lock || !dirty || saveBlocked) return;
    setSaving(true);
    setErr(null);
    try {
      if (persist) {
        await persist(parsed.values);
        setDraft(null);
        setCheckResult(null);
        setViewMode("editor");
        close();
        return;
      }
      const updated = await api.updateRequest(r.id, { values: parsed.values });
      setDraft(null);
      setBaseYaml(updated.values_yaml);
      setCheckResult(null);
      setViewMode("editor");
      reload();
      toast.success("Изменения сохранены");
      close();
    } catch (e) {
      if (e instanceof HttpError && e.code === "open_mr") {
        setErr({ message: changeInFlightText() });
      } else {
        setErr(toSubmitError(e));
      }
    } finally {
      setSaving(false);
    }
  }

  // Normalized diff keeps the comparison focused on semantic changes rather than
  // key reordering. If the user ran the server check, show its stamped YAML so
  // the diff matches exactly what will land in Git.
  const diffOriginal = useMemo(() => normalizeSavedYaml(baseYaml), [baseYaml]);
  const diffModified = checkResult
    ? normalizeSavedYaml(checkResult.valuesYaml)
    : parsed.ok
      ? parsed.normalized
      : text;

  const canCheck = !lock && !persist && !checking && !saving && parsed.ok && dirty;
  const canSave = !lock && !saving && !checking && !saveBlocked && parsed.ok && dirty;

  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
      <AriaButton className={buttonClass("secondary", "relative shrink-0 cursor-pointer")}>
        <IconFileCode size={16} stroke={1.8} aria-hidden className="text-slate-500" />
        Конфигурация
        {dirty && !lock && (
          <span
            title="Есть несохранённые изменения"
            className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-brand-500 ring-2 ring-surface"
          />
        )}
      </AriaButton>
      <ModalOverlay
        isDismissable
        className="fixed inset-0 z-50 flex items-center justify-center scrim p-3 sm:p-6 entering:animate-in entering:fade-in"
      >
        <Modal className="flex h-[92vh] w-full max-w-[1400px] flex-col rounded-lg bg-surface shadow-xl outline-none entering:animate-in entering:zoom-in-95">
          <Dialog className="flex min-h-0 flex-1 flex-col outline-none">
            {({ close }) => (
              <>
                <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <Heading slot="title" level={2} className="text-sm font-semibold text-gray-800">
                      Конфигурация сервиса
                    </Heading>
                    <span className="truncate font-mono text-xs text-slate-500">values.yaml</span>
                    <span className="hidden truncate text-xs text-slate-500 sm:inline">
                      · {r.display_name || r.service_name}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {!lock && (
                      <div
                        role="group"
                        aria-label="Режим просмотра конфигурации"
                        className="flex gap-0.5 rounded-md bg-slate-100 p-0.5 text-xs"
                      >
                        <button
                          type="button"
                          onClick={() => setViewMode("editor")}
                          aria-pressed={viewMode === "editor"}
                          className={`cursor-pointer rounded px-2.5 py-1 font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 ${
                            viewMode === "editor"
                              ? "bg-surface text-slate-800 shadow-sm"
                              : "text-slate-600 hover:text-slate-800"
                          }`}
                        >
                          {yamlText.tabEditor}
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewMode("diff")}
                          aria-pressed={viewMode === "diff"}
                          className={`cursor-pointer rounded px-2.5 py-1 font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 ${
                            viewMode === "diff"
                              ? "bg-surface text-slate-800 shadow-sm"
                              : "text-slate-600 hover:text-slate-800"
                          }`}
                        >
                          {yamlText.tabDiff}
                        </button>
                      </div>
                    )}
                    {!lock && dirty && (
                      <Button onPress={discard} isDisabled={saving || checking}>
                        Отменить
                      </Button>
                    )}
                    {!lock && !persist && (
                      <Button onPress={runCheck} isDisabled={!canCheck}>
                        {checking ? yamlText.checking : yamlText.check}
                      </Button>
                    )}
                    {!lock && (
                      <Button variant="primary" onPress={() => save(close)} isDisabled={!canSave}>
                        {saving ? "Сохраняем…" : "Сохранить"}
                      </Button>
                    )}
                    <button
                      type="button"
                      onClick={close}
                      aria-label="Закрыть"
                      className="cursor-pointer rounded-md p-1 text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500"
                    >
                      <IconX size={18} stroke={2} aria-hidden />
                    </button>
                  </div>
                </header>

                <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
                  {lock && <YamlNote text={lock.text} />}
                  {stale && !lock && (
                    <div
                      role="status"
                      className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
                    >
                      <div className="flex items-start gap-2">
                        <IconAlertTriangle size={16} stroke={1.8} aria-hidden className="mt-0.5 shrink-0" />
                        <div>
                          <p className="font-medium">{yamlText.staleTitle}</p>
                          <p className="mt-0.5 text-xs text-amber-800">{yamlText.staleHint}</p>
                        </div>
                      </div>
                      <Button onPress={acceptLatest} isDisabled={saving || checking}>
                        {yamlText.staleAction}
                      </Button>
                    </div>
                  )}
                  {saveBlocked && !lock && <YamlNote warning text={saveBlocked} />}
                  {stampedTouched.length > 0 && !lock && (
                    <YamlNote warning text={`${yamlText.stampedNote} ${stampedTouched.join(", ")}.`} />
                  )}
                  {!lock && draft !== null && !parsed.ok && (
                    <div
                      role="alert"
                      className="flex shrink-0 items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                    >
                      <IconAlertTriangle size={16} stroke={1.8} aria-hidden className="mt-0.5 shrink-0" />
                      <span className="min-w-0 break-words">{parsed.message}</span>
                    </div>
                  )}
                  {checkResult && !err && (
                    <div
                      role="status"
                      aria-live="polite"
                      className={`flex shrink-0 items-start gap-2 rounded-md border p-3 text-sm ${
                        checkResult.changed
                          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                          : "border-slate-200 bg-slate-50 text-slate-700"
                      }`}
                    >
                      {checkResult.changed ? (
                        <IconCheck size={16} stroke={2} aria-hidden className="mt-0.5 shrink-0" />
                      ) : (
                        <IconInfoCircle size={16} stroke={1.8} aria-hidden className="mt-0.5 shrink-0" />
                      )}
                      <span>{checkResult.changed ? yamlText.checkOk : yamlText.checkNoChanges}</span>
                    </div>
                  )}
                  {err && (
                    <div role="alert" className="max-h-40 shrink-0 overflow-y-auto">
                      <FormErrors
                        message={err.message}
                        details={err.details}
                        schema={schema ?? undefined}
                        values={parsed.ok ? parsed.values : undefined}
                      />
                    </div>
                  )}

                  <div className="editor-frame flex min-h-0 flex-1 flex-col rounded-md border border-slate-200">
                    {viewMode === "diff" && !lock ? (
                      dirty ? (
                        <DiffEditor
                          height="100%"
                          language="yaml"
                          theme={monacoTheme}
                          original={diffOriginal}
                          modified={diffModified}
                          options={{
                            readOnly: true,
                            renderSideBySide: true,
                            minimap: { enabled: false },
                            fontSize: 13,
                            automaticLayout: true,
                          }}
                        />
                      ) : (
                        <div className="flex flex-1 items-center justify-center p-8 text-sm text-slate-500">
                          {yamlText.diffEmpty}
                        </div>
                      )
                    ) : (
                      <Editor
                        height="100%"
                        defaultLanguage="yaml"
                        path={`inmemory://order/${r.id}/values.yaml`}
                        theme={monacoTheme}
                        value={text}
                        onChange={lock ? undefined : handleChange}
                        onMount={handleMount}
                        options={{
                          readOnly: lock !== null,
                          domReadOnly: lock !== null,
                          minimap: { enabled: false },
                          fontSize: 13,
                          tabSize: 2,
                          insertSpaces: true,
                          automaticLayout: true,
                        }}
                      />
                    )}
                  </div>

                  {!lock && (
                    <p className="shrink-0 text-xs text-slate-500">{yamlText.normalizedNote}</p>
                  )}
                </div>
              </>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

function YamlNote({ text, warning = false }: { text: string; warning?: boolean }) {
  const Icon = warning ? IconAlertTriangle : IconInfoCircle;
  return (
    <p
      className={`flex shrink-0 items-start gap-2 rounded-md border p-3 text-sm ${
        warning
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-slate-200 bg-app text-slate-700"
      }`}
    >
      <Icon size={16} stroke={1.8} aria-hidden className="mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">{text}</span>
    </p>
  );
}

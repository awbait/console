// The playground: the version constructor's editor and preview, with no portal
// behind them. A schema is pasted or dropped in, the document is written next
// to it, and the two panels on the right draw the order form and the product
// page the way the portal would. Everything stays in the browser: what is
// typed goes to localStorage, and a share link packs both documents into the
// fragment.
import Editor from "@monaco-editor/react";
import {
  IconAlertCircle,
  IconBrandGithub,
  IconFileCode,
  IconFileUpload,
  IconLink,
  IconSparkles,
} from "@tabler/icons-react";
import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { TabList, TabPanel, Tabs } from "react-aria-components";
import { useTheme } from "@/app/ThemeContext";
import { useToast } from "@/app/ToastContext";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ThemeMenu } from "@/components/ThemeMenu";
import { Button, buttonClass, Card } from "@/components/ui";
import { useSchemaRefNavigation, useViewDocumentHints } from "@/features/publications/monacoHints";
import {
  EditorTab,
  PanelNotice,
  PreviewBoundary,
  PreviewPane,
  SplitHandle,
  useHorizontalSplit,
} from "@/features/publications/viewPreview";
import { TEMPLATE_REFS } from "./refs";
import { SAMPLE_SCHEMA, SAMPLE_VIEW } from "./sample";
import {
  chartName,
  DEFAULT_VIEW,
  decodeShare,
  encodeShare,
  loadState,
  parseObject,
  type PlaygroundState,
  saveState,
} from "./state";
import { playgroundText as t } from "./text";

export const REPO_URL = "https://github.com/awbait/console";

// Model paths end the way monacoHints expects: the document's suffix binds the
// format schema and the completions, the chart's suffix the $ref navigation.
const VIEW_MODEL = "inmemory://playground/view-document.json";
const SCHEMA_MODEL = "inmemory://playground/values.schema.json";

// Where the format of the document comes from: a copy of
// internal/views/document.schema.json laid next to the bundle (vite.config.ts).
const FORMAT_URL = `${import.meta.env.BASE_URL}view-document.schema.json`;

const EDITOR_OPTIONS = {
  minimap: { enabled: false },
  fontSize: 13,
  automaticLayout: true,
  wordWrap: "on" as const,
  fixedOverflowWidgets: true,
};

function initialState(): PlaygroundState {
  return loadState(localStorage) ?? { schema: "", view: DEFAULT_VIEW };
}

export function Playground() {
  const { theme } = useTheme();
  const monacoTheme = theme === "light" ? "light" : "vs-dark";
  const toast = useToast();

  const [state, setState] = useState<PlaygroundState>(initialState);
  const setSchema = (schema: string) => setState((s) => ({ ...s, schema }));
  const setView = (view: string) => setState((s) => ({ ...s, view }));
  const [tab, setTab] = useState(() => (state.schema.trim() ? "view" : "schema"));

  // A share link wins over what the browser remembers: the person followed it
  // to see exactly this. The fragment is dropped once read, so an edited page
  // does not sit under a link that no longer describes it.
  useEffect(() => {
    if (!location.hash) return;
    void decodeShare(location.hash).then((shared) => {
      if (!shared) return;
      setState(shared);
      setTab(shared.schema.trim() ? "view" : "schema");
      history.replaceState(null, "", location.pathname + location.search);
    });
  }, []);

  useEffect(() => {
    const id = setTimeout(() => saveState(localStorage, state), 300);
    return () => clearTimeout(id);
  }, [state]);

  const [format, setFormat] = useState<object | null>(null);
  useEffect(() => {
    fetch(FORMAT_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((f) => setFormat(f))
      .catch(() => {
        // Without the format the editor still works, it just does not complete
        // the document's own keys.
      });
  }, []);

  const schema = useMemo(() => parseObject(state.schema), [state.schema]);
  const view = useMemo(() => parseObject(state.view), [state.view]);
  useViewDocumentHints(format, schema.value, TEMPLATE_REFS);
  useSchemaRefNavigation();

  const { ref: splitRef, pct: splitPct, onPointerDown: onSplitDown } = useHorizontalSplit();

  // Files: the picker and the drop, both reading the one file as the schema.
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  function readFile(file: File | undefined) {
    if (!file) return;
    void file.text().then((text) => {
      setSchema(text);
      setTab("schema");
    });
  }
  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setDragging(true);
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    readFile(e.dataTransfer.files[0]);
  }

  // The example replaces what is there, and what is there may be an hour of
  // typing: an untouched page loads it at once, anything else asks first.
  const [confirmSample, setConfirmSample] = useState(false);
  const untouched = !state.schema.trim() && state.view === DEFAULT_VIEW;
  function loadSample() {
    setState({ schema: SAMPLE_SCHEMA, view: SAMPLE_VIEW });
    setTab("view");
  }

  async function share() {
    const hash = await encodeShare(state);
    history.replaceState(null, "", `#${hash}`);
    try {
      await navigator.clipboard.writeText(location.href);
      toast.success(t.shareCopied);
    } catch {
      toast.error(t.shareFailed);
    }
  }

  const viewNames = Object.keys(view.value?.views ?? {});
  const name = chartName(schema.value);
  const label = typeof schema.value?.title === "string" ? schema.value.title : name;

  return (
    <div className="flex h-screen flex-col bg-app text-slate-800">
      <header className="shrink-0 border-b border-slate-200 bg-surface">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-4 py-3">
          <h1 className="mr-auto text-base font-semibold text-slate-800">{t.pageTitle}</h1>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              readFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button onPress={() => fileInput.current?.click()}>
            <IconFileUpload size={16} stroke={1.8} />
            {t.openFile}
          </Button>
          <Button onPress={() => (untouched ? loadSample() : setConfirmSample(true))}>
            <IconSparkles size={16} stroke={1.8} />
            {t.loadSample}
          </Button>
          <Button variant="primary" onPress={() => void share()}>
            <IconLink size={16} stroke={1.8} />
            {t.share}
          </Button>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={buttonClass()}>
            <IconBrandGithub size={16} stroke={1.8} />
            {t.sourceLink}
          </a>
          <ThemeMenu />
        </div>
      </header>

      {/* The whole work area takes a dropped file: a drop is aimed at the page,
          not at the one tab that reads it. The overlay inside is what the drag
          would enter and leave otherwise, flickering the frame;
          pointer-events-none keeps it out of the way. */}
      <main
        className="relative mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 overflow-y-auto p-4 lg:min-h-0"
        onDragOver={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-brand-400 bg-brand-50/80 text-sm font-medium text-brand-700">
            {t.dropHere}
          </div>
        )}
        <p className="text-sm text-slate-500">{t.intro}</p>
        <div
          ref={splitRef}
          className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row lg:gap-0"
          style={{ ["--split" as string]: `${splitPct}%` } as React.CSSProperties}
        >
          <Card className="flex flex-col gap-2 lg:min-h-0 lg:min-w-0 lg:shrink-0 lg:basis-[var(--split)]">
            <Tabs
              className="flex min-h-0 flex-1 flex-col"
              selectedKey={tab}
              onSelectionChange={(k) => setTab(String(k))}
            >
              <TabList aria-label={t.pageTitle} className="flex gap-1 border-b border-gray-200">
                <EditorTab id="view">view.schema.json</EditorTab>
                <EditorTab id="schema">values.schema.json</EditorTab>
              </TabList>
              <TabPanel id="view" className="flex min-h-0 flex-1 flex-col gap-2 pt-3 outline-none">
                <div className="editor-frame min-h-[400px] flex-1 rounded-md border border-slate-200 lg:min-h-0">
                  <Editor
                    height="100%"
                    defaultLanguage="json"
                    path={VIEW_MODEL}
                    theme={monacoTheme}
                    value={state.view}
                    onChange={(v) => setView(v ?? "")}
                    options={EDITOR_OPTIONS}
                  />
                </div>
                <SyntaxNote error={view.error} prefix={t.viewSyntax} hint={t.viewHint} />
              </TabPanel>
              <TabPanel id="schema" className="flex min-h-0 flex-1 flex-col gap-2 pt-3 outline-none">
                <div className="editor-frame min-h-[400px] flex-1 rounded-md border border-slate-200 lg:min-h-0">
                  <Editor
                    height="100%"
                    defaultLanguage="json"
                    path={SCHEMA_MODEL}
                    theme={monacoTheme}
                    value={state.schema}
                    onChange={(v) => setSchema(v ?? "")}
                    options={EDITOR_OPTIONS}
                  />
                </div>
                <SyntaxNote error={schema.error} prefix={t.schemaSyntax} hint={t.schemaHint} />
              </TabPanel>
            </Tabs>
          </Card>

          <SplitHandle onPointerDown={onSplitDown} />

          <Card className="flex flex-col gap-2 lg:min-h-0 lg:min-w-0 lg:flex-1">
            {!schema.value ? (
              <PanelNotice Icon={IconFileCode} text={t.schemaEmpty} />
            ) : !view.value ? (
              <PanelNotice Icon={IconAlertCircle} text={t.viewBroken} />
            ) : viewNames.length === 0 ? (
              <p className="text-sm text-gray-500">{t.noViews}</p>
            ) : (
              <PreviewBoundary resetKey={state.view + state.schema}>
                <PreviewPane
                  schema={schema.value}
                  doc={view.value}
                  label={label}
                  project="playground"
                  name={name}
                  version="0.1.0"
                />
              </PreviewBoundary>
            )}
          </Card>
        </div>
      </main>

      <ConfirmDialog
        isOpen={confirmSample}
        onOpenChange={setConfirmSample}
        title={t.sampleReplaceTitle}
        message={t.sampleReplaceMessage}
        confirmLabel={t.sampleReplaceConfirm}
        onConfirm={loadSample}
      />
    </div>
  );
}

// SyntaxNote sits under an editor: the parse error while there is one, the
// panel's hint otherwise. One line either way, so the editor above does not
// jump when the text goes from broken to whole.
function SyntaxNote({ error, prefix, hint }: { error: string | null; prefix: string; hint: string }) {
  if (error)
    return (
      <div className="flex items-start gap-1.5 rounded-md border border-red-100 bg-red-50/50 p-2 text-xs text-red-700">
        <IconAlertCircle size={14} stroke={1.8} className="mt-px shrink-0 text-red-500" />
        <span>
          {prefix}: {error}
        </span>
      </div>
    );
  return <p className="text-xs text-slate-400">{hint}</p>;
}

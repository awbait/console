import Editor from "@monaco-editor/react";
import {
  IconAlertCircle,
  IconCheck,
  IconChevronDown,
  IconHelpCircle,
  IconInfoCircle,
  IconTag,
  IconX,
} from "@tabler/icons-react";
import yaml from "js-yaml";
import { Component, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Button as AriaButton,
  Select as AriaSelect,
  Dialog,
  DialogTrigger,
  Heading,
  ListBox,
  ListBoxItem,
  Modal,
  ModalOverlay,
  Popover,
  SelectValue,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Tooltip,
  TooltipTrigger,
} from "react-aria-components";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { api, HttpError } from "../api/client";
import type {
  ChartPublication,
  OrderRequest,
  PublicationStatus,
  PublicationVersion,
  ViewDocument,
  ViewIssue,
} from "../api/types";
import { chartLabel, useCatalog } from "../app/CatalogContext";
import { useTheme } from "../app/ThemeContext";
import { useToast } from "../app/ToastContext";
import { canModify, useUser } from "../auth/UserContext";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { FormErrors } from "../components/FormErrors";
import { ProductIcon } from "../components/icons";
import { OrderMetaCard, OrderValuesCard } from "../components/OrderFormParts";
import type { PersistValues } from "../components/products/GenericProductTabs";
import { StatusBadge } from "../components/StatusBadge";
import { Button, Card, Chip, ErrorBox, Spinner } from "../components/ui";
import { parseNamespaceDirective, resolveDestNamespace } from "../form/namespace";
import { pruneEmpty, type View } from "../form/SchemaForm";
import { useAsync } from "../hooks/useAsync";
import { compareSemver } from "../lib/semver";
import { RejectedChip, STATUS_LABELS, versionHint } from "./ChartManagePage";
import { Meta, ProductView } from "./requestDetailParts";

type Values = Record<string, unknown>;

// View-document template for a new draft.
const VIEW_TEMPLATE = `{
  "views": {
    "order": {
      "include": [],
      "overrides": {}
    }
  }
}
`;

// Editor for one published version's view document: Monaco + live validation +
// form preview. Deep-linkable: /catalog/:project/:name/manage/:version. The
// versions overview (status, availability, metadata) is the parent manage page.
export function ChartVersionEditPage() {
  const { project = "", name = "", version = "" } = useParams();

  const {
    data: pub,
    loading: pubLoading,
    error: pubError,
  } = useAsync(
    () =>
      api
        .listPublications({ chart: name })
        .then((list) => list.find((p) => p.chart_project === project) ?? null),
    [project, name],
  );

  if (pubLoading && !pub) return <Spinner />;
  if (pubError && !pub) return <ErrorBox error={pubError} />;
  // No publication yet: the overview page hosts the registration form.
  if (!pub) return <Navigate to={`/catalog/${project}/${name}/manage`} replace />;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Breadcrumbs
        items={[
          { label: "Чарты", to: "/catalog" },
          { label: `${project}/${name}`, to: `/catalog/${project}/${name}` },
          { label: "Управление", to: `/catalog/${project}/${name}/manage` },
          { label: version },
        ]}
      />
      {/* Keyed by version: switching versions remounts the editor, so draft
          text/validation state never leaks between versions. */}
      <VersionEditor key={version} pub={pub} version={version} />
    </div>
  );
}

function VersionEditor({ pub, version }: { pub: ChartPublication; version: string }) {
  const { user } = useUser();
  const { reload: reloadCatalog } = useCatalog();
  const { theme } = useTheme();
  const navigate = useNavigate();
  // Monaco lives outside Tailwind tokens: match its theme to the portal theme.
  const monacoTheme = theme === "light" ? "light" : "vs-dark";
  const project = pub.chart_project;
  const name = pub.chart_name;

  // Chart versions (Harbor) feed the switcher; stored rows carry per-version state.
  const { data: chart } = useAsync(() => api.getChart(project, name), [project, name]);
  const { data: versions, reload: reloadVersions } = useAsync(
    () => api.listVersions(pub.id),
    [pub.id],
  );

  // The version's stored row (may not exist yet -> a fresh draft).
  const cur = versions?.find((v) => v.chart_version === version) ?? null;
  const curStatus: PublicationStatus = cur?.status ?? "DRAFT";

  // Chart schema of the version, for validation and the form preview.
  const { data: schema } = useAsync(
    () => api.getSchema(project, name, version),
    [project, name, version],
  );

  const pending = curStatus === "PENDING";
  const isOwner = canModify(user, pub.owner_team);
  const editable = isOwner && !pending;
  const recommended = pub.recommended_version ?? "";
  const isRecommended = recommended === version;

  // View-document draft in the editor, loaded once the stored rows arrive. The
  // ref guards against a background refetch clobbering unsaved edits.
  const [text, setText] = useState(VIEW_TEMPLATE);
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current || versions === null) return;
    const row = versions.find((v) => v.chart_version === version) ?? null;
    const doc = row?.view_json ?? row?.approved_view_json ?? null;
    setText(doc ? JSON.stringify(doc, null, 2) : VIEW_TEMPLATE);
    loaded.current = true;
  }, [versions, version]);

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "save" | "submit" | "withdraw">(null);
  const { success, error } = useToast();
  // Rejected version: show the reason once as a toast when it is opened.
  const firedReject = useRef(false);
  useEffect(() => {
    if (curStatus === "REJECTED" && cur?.review_comment && !firedReject.current) {
      firedReject.current = true;
      error(`Причина: ${cur.review_comment}`, { title: "Отклонено" });
    }
  }, [error, curStatus, cur?.review_comment]);

  // Draggable splitter between the schema panel and the preview: the left
  // panel's share in % (applied only on lg, where the panels sit side by side).
  const splitRef = useRef<HTMLDivElement>(null);
  const [splitPct, setSplitPct] = useState(50);
  const splitDragging = useRef(false);
  function onSplitDown(e: React.PointerEvent) {
    splitDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  }
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const el = splitRef.current;
      if (!splitDragging.current || !el) return;
      const r = el.getBoundingClientRect();
      setSplitPct(Math.min(75, Math.max(25, ((e.clientX - r.left) / r.width) * 100)));
    }
    function onUp() {
      if (!splitDragging.current) return;
      splitDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  // Live validation: local JSON.parse immediately, server-side (format + check
  // against the chart schema) debounced.
  const [issues, setIssues] = useState<ViewIssue[]>([]);
  const [syntaxErr, setSyntaxErr] = useState<string | null>(null);
  const parsed = useMemo<ViewDocument | null>(() => {
    try {
      const doc = JSON.parse(text);
      setSyntaxErr(null);
      return doc;
    } catch (e) {
      setSyntaxErr((e as Error).message);
      return null;
    }
  }, [text]);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!parsed) return;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      api
        .validateVersion(pub.id, version, parsed)
        .then((r) => setIssues(r.issues))
        .catch(() => {}); // validation, best effort, a network blip is fine
    }, 500);
    return () => clearTimeout(debounce.current);
  }, [parsed, pub.id, version]);

  async function onSave(notify = false): Promise<boolean> {
    if (!parsed) {
      setErr("Исправьте синтаксис JSON перед сохранением.");
      return false;
    }
    setBusy("save");
    setErr(null);
    try {
      await api.saveVersionView(pub.id, version, parsed);
      reloadVersions();
      reloadCatalog();
      if (notify) success("Черновик сохранён");
      return true;
    } catch (e) {
      setErr(e instanceof HttpError ? e.message : (e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function onSubmit() {
    if (!(await onSave())) return;
    setBusy("submit");
    try {
      await api.submitVersion(pub.id, version);
      reloadVersions();
      success("Версия отправлена на согласование");
    } catch (e) {
      setErr(e instanceof HttpError ? e.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onWithdraw() {
    setBusy("withdraw");
    setErr(null);
    try {
      await api.withdrawVersion(pub.id, version);
      reloadVersions();
    } catch (e) {
      setErr(e instanceof HttpError ? e.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const st = STATUS_LABELS[curStatus];
  const viewNames = Object.keys(parsed?.views ?? {});
  // Switcher options: Harbor versions plus stored rows Harbor no longer has,
  // sorted by semver highest first (same order as the manage overview table).
  const harborVersions = chart?.versions ?? [];
  const switcherVersions = [
    ...harborVersions,
    ...(versions ?? [])
      .map((r) => r.chart_version)
      .filter((v) => !harborVersions.includes(v)),
  ].sort((a, b) => compareSemver(b, a));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {chartLabel(name)}: версия {version}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {switcherVersions.length > 1 && (
              <VersionSwitcher
                current={version}
                options={switcherVersions}
                rows={versions ?? []}
                recommended={recommended}
                onSwitch={(v) =>
                  navigate(`/catalog/${project}/${name}/manage/${encodeURIComponent(v)}`)
                }
              />
            )}
            {curStatus === "REJECTED" && cur?.review_comment ? (
              <RejectedChip comment={cur.review_comment} />
            ) : (
              <Chip className={st.cls}>
                <st.Icon size={13} stroke={1.8} />
                {st.label}
              </Chip>
            )}
            {cur?.orderable && (
              <Chip className="bg-emerald-50 text-emerald-700">
                <IconCheck size={12} stroke={2.5} />
                В каталоге
              </Chip>
            )}
            {isRecommended && (
              <Chip className="bg-brand-50 text-brand-700">
                <IconTag size={12} stroke={2} />
                Рекомендуемая
              </Chip>
            )}
          </div>
        </div>
        {editable && (
          <div className="flex shrink-0 gap-2">
            <Button isDisabled={busy !== null} onPress={() => onSave(true)}>
              Сохранить черновик
            </Button>
            <Button
              variant="primary"
              isDisabled={busy !== null || !!syntaxErr || issues.length > 0}
              onPress={onSubmit}
            >
              Отправить на согласование
            </Button>
          </div>
        )}
      </div>

      {pending && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>
            Версия {version} на согласовании у администратора, правки заморожены до решения.
          </span>
          {isOwner && (
            <Button isDisabled={busy !== null} onPress={onWithdraw}>
              Отозвать для изменения
            </Button>
          )}
        </div>
      )}
      {err && <FormErrors message={err} />}

      {/* Builder: the document on the left (+ chart schema alongside, read-only), preview on
          the right. On lg the two panels sit side by side and the height lock engages
          (flex-1 + min-h-0): they fill the page's free height and scroll internally, so the
          page itself never scrolls. Below lg the panels stack; the lock is dropped (no
          min-h-0/flex-1) so each keeps its natural height (editor min-h-[400px], preview the
          full form) and the page scrolls normally - two 400px+ panels cannot be crammed into
          a phone-height viewport, and crushing them (min-h-0) only made the editor unusable
          and leaked overflow into the page. Between the panels is a draggable splitter (lg),
          the left panel's share = --split. */}
      <div
        ref={splitRef}
        className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row lg:gap-0"
        style={{ ["--split" as string]: `${splitPct}%` } as React.CSSProperties}
      >
        <Card className="flex flex-col gap-2 lg:min-h-0 lg:min-w-0 lg:shrink-0 lg:basis-[var(--split)]">
          <Tabs className="flex min-h-0 flex-1 flex-col">
            <TabList aria-label="Документы" className="flex gap-1 border-b border-gray-200">
              <EditorTab id="view">view.schema.json</EditorTab>
              <EditorTab id="schema">values.schema.json</EditorTab>
            </TabList>
            <TabPanel id="view" className="flex min-h-0 flex-1 flex-col gap-2 pt-3 outline-none">
              <div className="min-h-[400px] flex-1 overflow-hidden rounded-md border border-slate-200 lg:min-h-0">
                <Editor
                  height="100%"
                  defaultLanguage="json"
                  theme={monacoTheme}
                  value={text}
                  onChange={(v) => setText(v ?? "")}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    automaticLayout: true,
                    wordWrap: "on",
                    readOnly: !editable,
                  }}
                />
              </div>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {syntaxErr ? (
                    <div className="flex items-start gap-1.5 rounded-md border border-red-100 bg-red-50/50 p-2 text-xs text-red-700">
                      <IconAlertCircle
                        size={14}
                        stroke={1.8}
                        className="mt-px shrink-0 text-red-500"
                      />
                      <span>Синтаксис JSON: {syntaxErr}</span>
                    </div>
                  ) : issues.length > 0 ? (
                    <ul className="flex flex-col gap-1.5 rounded-md border border-red-100 bg-red-50/50 p-2 text-xs">
                      {issues.map((i, idx) => (
                        <li key={idx} className="flex items-start gap-1.5 text-red-700">
                          <IconAlertCircle
                            size={14}
                            stroke={1.8}
                            className="mt-px shrink-0 text-red-500"
                          />
                          <span>
                            {i.path && (
                              <code className="mr-1 rounded bg-surface px-1 py-px font-mono text-[11px] text-red-600 ring-1 ring-red-200">
                                {i.path}
                              </code>
                            )}
                            {i.message}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="flex items-center gap-1.5 rounded-md border border-emerald-100 bg-emerald-50/50 p-2 text-xs text-emerald-700">
                      <IconCheck size={14} stroke={2} className="shrink-0 text-emerald-500" />
                      Документ валиден
                    </div>
                  )}
                </div>
                <FormatHelp />
              </div>
            </TabPanel>
            {/* Chart schema, the source of fields for include/exclude/overrides; read-only. */}
            <TabPanel id="schema" className="flex min-h-0 flex-1 flex-col gap-2 pt-3 outline-none">
              {schema ? (
                <>
                  <div className="min-h-[400px] flex-1 overflow-hidden rounded-md border border-slate-200 lg:min-h-0">
                    <Editor
                      height="100%"
                      defaultLanguage="json"
                      theme={monacoTheme}
                      value={JSON.stringify(schema, null, 2)}
                      options={{
                        minimap: { enabled: false },
                        fontSize: 13,
                        automaticLayout: true,
                        wordWrap: "on",
                        readOnly: true,
                        domReadOnly: true,
                      }}
                    />
                  </div>
                  <p className="text-xs text-slate-400">
                    values.schema.json из чарта (v{version}), только чтение. Схема меняется только
                    новой версией чарта.
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray-500">Схема values.schema.json недоступна.</p>
              )}
            </TabPanel>
          </Tabs>
        </Card>

        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={onSplitDown}
          className="group hidden shrink-0 cursor-col-resize touch-none items-stretch justify-center px-1.5 lg:flex"
        >
          <div className="w-1 rounded-full bg-slate-200 transition-colors group-hover:bg-brand-400" />
        </div>

        <Card className="flex flex-col gap-2 lg:min-h-0 lg:min-w-0 lg:flex-1">
          {!schema ? (
            <p className="text-sm text-gray-500">
              Схема values.schema.json недоступна, предпросмотр невозможен.
            </p>
          ) : viewNames.length === 0 ? (
            <p className="text-sm text-gray-500">Добавьте view в документ, чтобы увидеть форму.</p>
          ) : (
            <PreviewBoundary resetKey={text}>
              <PreviewPane
                schema={schema as Record<string, any>}
                doc={parsed!}
                label={chartLabel(name)}
                project={project}
                name={name}
                version={version}
              />
            </PreviewBoundary>
          )}
        </Card>
      </div>
    </div>
  );
}

// Compact chip-styled version switcher: navigates to the sibling version's
// editor page. Each option shows the version plus a muted availability hint.
function VersionSwitcher({
  current,
  options,
  rows,
  recommended,
  onSwitch,
}: {
  current: string;
  options: string[];
  rows: PublicationVersion[];
  recommended: string;
  onSwitch: (v: string) => void;
}) {
  return (
    <AriaSelect
      selectedKey={current}
      onSelectionChange={(k) => k !== current && onSwitch(String(k))}
      aria-label="Версия"
      className="inline-flex"
    >
      <AriaButton className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 outline-none transition-colors hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-brand-500 data-[pressed]:bg-slate-200">
        <span className="font-normal text-slate-400">Версия:</span>
        <SelectValue>{({ selectedText }) => selectedText ?? current}</SelectValue>
        <IconChevronDown size={12} stroke={2} className="text-slate-400" aria-hidden />
      </AriaButton>
      <Popover className="min-w-[var(--trigger-width)] rounded-md border border-slate-200 bg-surface shadow-lg entering:animate-in entering:fade-in">
        <ListBox className="max-h-72 overflow-auto p-1 outline-none">
          {options.map((v) => {
            const hint = versionHint(v, rows.find((r) => r.chart_version === v), recommended);
            return (
              <ListBoxItem
                key={v}
                id={v}
                textValue={v}
                className="flex cursor-pointer items-baseline gap-2 rounded px-2 py-1 text-xs outline-none focus:bg-brand-50 selected:bg-brand-100"
              >
                <span className="font-mono">{v}</span>
                {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
              </ListBoxItem>
            );
          })}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}

function EditorTab({
  id,
  info,
  children,
}: {
  id: string;
  info?: string;
  children: React.ReactNode;
}) {
  return (
    <Tab
      id={id}
      className="-mb-px cursor-pointer border-b-2 border-transparent px-3 py-2 text-sm font-medium text-gray-500 outline-none transition-colors hover:text-gray-700 selected:border-brand-600 selected:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <span className="inline-flex items-center gap-1.5">
        {children}
        {info && <InfoHint text={info} />}
      </span>
    </Tab>
  );
}

// Info hint: a small "i" that shows short text in a tooltip on hover/focus.
// excludeFromTabOrder so it does not interfere with arrow-key navigation (e.g.
// across the tabs it sits next to).
function InfoHint({ text }: { text: string }) {
  return (
    <TooltipTrigger delay={150} closeDelay={0}>
      <AriaButton
        excludeFromTabOrder
        aria-label={text}
        className="inline-flex items-center text-slate-400 outline-none transition-colors hover:text-brand-600 focus-visible:text-brand-600"
      >
        <IconInfoCircle size={15} stroke={1.8} />
      </AriaButton>
      <Tooltip
        offset={6}
        className="max-w-xs rounded-md border border-slate-200 bg-surface px-2.5 py-1.5 text-xs text-slate-700 shadow-lg entering:animate-in entering:fade-in entering:zoom-in-95"
      >
        {text}
      </Tooltip>
    </TooltipTrigger>
  );
}

// FormatHelp, a modal with guidance on filling in view.schema.json.
function FormatHelp() {
  return (
    <DialogTrigger>
      <AriaButton className="inline-flex h-[34px] w-fit shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-600 outline-none transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-brand-500">
        <IconHelpCircle size={14} className="text-slate-400" />
        Как заполнять
      </AriaButton>
      <ModalOverlay
        isDismissable
        className="fixed inset-0 z-10 flex items-start justify-center bg-black/20 p-4 pt-16 entering:animate-in entering:fade-in"
      >
        <Modal className="w-full max-w-2xl rounded-lg border border-slate-200 bg-surface shadow-xl">
          <Dialog className="outline-none">
            {({ close }) => (
              <div className="flex max-h-[80vh] flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <Heading slot="title" className="text-sm font-semibold text-slate-800">
                    Как заполнять view.schema.json
                  </Heading>
                  <AriaButton
                    onPress={close}
                    aria-label="Закрыть"
                    className="rounded p-1 text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    <IconX size={16} />
                  </AriaButton>
                </div>
                <div className="overflow-y-auto text-xs leading-relaxed text-slate-600">
                  <p className="mb-1.5">
                    Документ из трёх разделов: <b>views</b> (формы), <b>tabs</b> (вкладки-таблицы), <b>actions</b>{" "}
                    (пункты меню «Действия»).
                  </p>
                  <ul className="flex list-disc flex-col gap-1.5 pl-4">
                    <li>
                      <b>views</b>: библиотека форм (проекций поверх values.schema.json). View <b>order</b>{" "}
                      обязательна: это форма нового заказа. Прочие views это формы элементов вкладок или формы
                      для «Действий». Сам по себе view не вкладка и не пункт меню.
                    </li>
                    <li>
                      <b>tabs</b>: вкладки продукта, каждая это таблица-список. Поля вкладки: <b>id</b>,{" "}
                      <b>title</b> (заголовок), <b>items</b> (JSON pointer на массив в values, например{" "}
                      <code className="rounded bg-slate-50 px-1 ring-1 ring-slate-200">"/gateways/0/listeners"</code>),{" "}
                      <b>form</b> (id формы элемента из views для добавления/изменения) и <b>ui:table</b>{" "}
                      (колонки:{" "}
                      <code className="rounded bg-slate-50 px-1 ring-1 ring-slate-200">{'[{"path":"name","label":"Имя"}]'}</code>).
                      Без <b>ui:table</b> вкладка покажет заглушку «не сконфигурировано».
                    </li>
                    <li>
                      <b>enums</b> (необязательно): динамические списки в форме элемента. Правило{" "}
                      <code className="rounded bg-slate-50 px-1 ring-1 ring-slate-200">{'{"at":"/parentRefs/0/sectionName","from":"/gateways/0/listeners","value":"name"}'}</code>{" "}
                      наполняет enum поля <b>at</b> значениями <b>value</b> из массива <b>from</b> в values заказа.
                    </li>
                    <li>
                      <b>lookup</b>-колонка (необязательно): вычисляемое значение через join по ссылке вместо{" "}
                      <b>path</b>:{" "}
                      <code className="rounded bg-slate-50 px-1 ring-1 ring-slate-200">{'{"label":"Hostnames","lookup":{"keys":"/parentRefs/*/sectionName","in":"/gateways/0/listeners","match":"name","get":"hostname"}}'}</code>.
                      Собирает <b>keys</b> из элемента (<b>*</b> перебирает массив), ищет в <b>in</b> строки где{" "}
                      <b>match</b> равен ключу, берёт <b>get</b>.
                    </li>
                    <li>
                      <b>actions</b>: кладёт форму-view пунктом в меню «Действия». Элемент:{" "}
                      <code className="rounded bg-slate-50 px-1 ring-1 ring-slate-200">{'{"view":"...","in":"info","label":"..."}'}</code>.{" "}
                      <b>in</b> = <code className="rounded bg-slate-50 px-1 ring-1 ring-slate-200">"info"</code>{" "}
                      (меню вкладки «Общая информация») или{" "}
                      <code className="rounded bg-slate-50 px-1 ring-1 ring-slate-200">{'"tab:<id>"'}</code>{" "}
                      (меню вкладки из <b>tabs</b>). <b>label</b> задаёт текст пункта.
                    </li>
                    <li>
                      <b>include</b> / <b>exclude</b>: какие поля показать или скрыть. <b>overrides</b>: настройка
                      поля (<b>title</b>, <b>ui:view</b> вложенная проекция). <b>ui:widget</b>: "single" массив как
                      один объект, "hidden" скрыть, "edit" раскрыть скрытое в схеме.
                    </li>
                    <li>
                      <b>identity</b> (необязательно): JSON pointer на поле с именем сервиса, например{" "}
                      <code className="rounded bg-slate-50 px-1 ring-1 ring-slate-200">"/gateways/0/name"</code>.
                      Без него имя инстанса берётся из поля «Service name» формы заказа (подходит для
                      cluster-scoped чартов без поля-идентификатора). Подписи полей форма берёт из{" "}
                      <b>title</b> / <b>description</b> в values.schema.json.
                    </li>
                    <li>
                      <b>namespace</b> (необязательно): откуда брать{" "}
                      <code className="rounded bg-slate-50 px-1 ring-1 ring-slate-200">destination.namespace</code> и
                      показывать ли поле «Namespace» в форме. По умолчанию поле показывается и его ввод и есть
                      namespace. Объект меняет источник:{" "}
                      <code className="rounded bg-slate-50 px-1 ring-1 ring-slate-200">
                        {'{"source":"values","pointer":"/namespace/namespaceName","hideOrderField":true}'}
                      </code>
                      . <b>source</b>:{" "}
                      <code className="rounded bg-slate-50 px-1 ring-1 ring-slate-200">"field"</code> (ввод в форме,
                      по умолчанию),{" "}
                      <code className="rounded bg-slate-50 px-1 ring-1 ring-slate-200">"values"</code> (из поля values
                      по <b>pointer</b> - для чартов, что сами создают namespace),{" "}
                      <code className="rounded bg-slate-50 px-1 ring-1 ring-slate-200">"fixed"</code> (константа{" "}
                      <b>value</b> - для операторов и cluster-scoped). <b>hideOrderField: true</b> прячет поле
                      «Namespace» (для values/fixed). Строка{" "}
                      <code className="rounded bg-slate-50 px-1 ring-1 ring-slate-200">"/namespace/namespaceName"</code>{" "}
                      - устаревшая форма-зеркало: ввод «Namespace» копируется в это поле.
                    </li>
                  </ul>
                  <pre className="mt-3 overflow-x-auto rounded-md bg-slate-50 p-3 ring-1 ring-slate-200">
                    {`{
  "views": {
    "order": {
      "identity": "/gateways/0/name",
      "include": ["naming", "gateways"],
      "overrides": {
        "gateways": { "ui:widget": "single", "ui:view": { "exclude": ["hpa"] } }
      }
    },
    "listener": {},
    "route": { "exclude": ["enabled", "hostnames"] },
    "resources": { "include": ["gateways"] }
  },
  "tabs": [
    {
      "id": "listeners",
      "title": "Слушатели",
      "items": "/gateways/0/listeners",
      "form": "listener",
      "ui:table": [
        { "path": "name", "label": "Имя" },
        { "path": "port", "label": "Порт" }
      ]
    },
    {
      "id": "routes",
      "title": "Маршруты",
      "items": "/xroutes",
      "form": "route",
      "enums": [
        { "at": "/parentRefs/0/sectionName", "from": "/gateways/0/listeners", "value": "name" }
      ],
      "ui:table": [
        { "path": "name", "label": "Имя" },
        { "label": "Hostnames", "lookup": { "keys": "/parentRefs/*/sectionName", "in": "/gateways/0/listeners", "match": "name", "get": "hostname" } }
      ]
    }
  ],
  "actions": [
    { "view": "resources", "in": "info", "label": "Редактировать ресурсы" }
  ]
}`}
                  </pre>
                </div>
              </div>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

// readPointer pulls a string out of values by JSON pointer (preview identity).
function readPointer(v: unknown, ptr: string): string {
  let cur: any = v;
  for (const seg of ptr.split("/").slice(1)) {
    if (cur == null) return "";
    cur = Array.isArray(cur) ? cur[Number(seg)] : cur[seg];
  }
  return typeof cur === "string" ? cur : "";
}

// PreviewBoundary contains render crashes caused by a broken intermediate view
// document (the author edits live JSON, so any shape can flow into the form).
// Without it the error escalates to the router's error page and kills the whole
// editor; here only the preview panel degrades to a hint. resetKey (the raw
// document text) retries the render after each edit, so no manual reload is
// needed; while the render succeeds the children stay mounted and keep their
// preview state.
class PreviewBoundary extends Component<{ resetKey: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }
  render() {
    if (this.state.failed)
      return (
        <p className="text-sm text-gray-500">
          Предпросмотр не построился по текущему документу. Продолжайте правку - форма появится,
          когда документ снова станет корректным.
        </p>
      );
    return this.props.children;
  }
}

// The preview is built from the same components as the real pages (the order
// form from OrderFormParts, the product page from ProductView), so it matches
// exactly what the user will see. Values are local: edits in the preview go to
// state (persist), not the API.
function PreviewPane({
  schema,
  doc,
  label,
  project,
  name,
  version,
}: {
  schema: Record<string, any>;
  doc: ViewDocument;
  label: string;
  project: string;
  name: string;
  version: string;
}) {
  const { user } = useUser();
  const orderView = doc.views?.order as (View & { identity?: string; namespace?: unknown }) | undefined;
  const identity = orderView?.identity;
  const ns = parseNamespaceDirective(orderView?.namespace);

  // Order state: shared between the form and the product page (fill the form,
  // switch the tab and you see your order).
  const [values, setValues] = useState<Values>({});
  const [displayName, setDisplayName] = useState(label);
  const [serviceName, setServiceName] = useState("");
  const [cluster, setCluster] = useState("in-cluster");
  const [namespace, setNamespace] = useState("");
  const [mode, setMode] = useState<string>("form");
  const [raw, setRaw] = useState("");

  // The same form/raw switching logic as on the order page (no plugins here:
  // the constructor preview keeps just Form/Raw YAML).
  function switchMode(next: string) {
    if (next === mode) return;
    if (next === "raw") {
      setRaw(yaml.dump(pruneEmpty(values)));
    } else {
      try {
        setValues((yaml.load(raw) as Values) ?? {});
      } catch {
        /* keep previous form values if YAML is invalid */
      }
    }
    setMode(next);
  }

  const team = user?.teams?.[0] ?? "team";
  const svcName = (identity ? readPointer(values, identity) : serviceName) || "demo-service";

  // Synthetic order: lets the preview render with the real product components
  // without a saved order. The id is fake, writes go through persist.
  const request: OrderRequest = {
    id: "preview",
    created_by: user?.sub ?? "",
    created_by_name: user?.name ?? "",
    team,
    chart_project: project,
    chart_name: name,
    chart_version: version,
    service_name: svcName,
    display_name: displayName,
    cluster,
    namespace: namespace || svcName,
    values_yaml: yaml.dump(pruneEmpty(values)),
    status: "HEALTHY",
    argocd_app_name: `${team}-${svcName}`,
    version: 1,
    created_at: "",
    updated_at: "",
    drifted: false,
    imported: false,
  };

  return (
    <Tabs className="flex min-h-0 flex-1 flex-col">
      <TabList aria-label="Предпросмотр" className="flex gap-1 border-b border-gray-200">
        <EditorTab id="order" info="Предпросмотр формы нового заказа">
          Форма заказа
        </EditorTab>
        <EditorTab id="product" info="Предпросмотр страницы заказанного продукта">
          Страница продукта
        </EditorTab>
      </TabList>
      {/* relative: this scroll container is the containing block for react-aria's
          absolutely-positioned hidden nodes (VisuallyHidden inside Select). Without
          it they anchor to the nearest positioned ancestor (main) at their deep
          static position and inflate main's scrollHeight - a phantom empty gap
          below the side-by-side builder. Anchored here, they sit inside the panel's
          own overflow-y-auto and add nothing to the page. */}
      <TabPanel
        id="order"
        className="relative flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1 pt-3 outline-none"
      >
        {orderView ? (
          <>
            <OrderMetaCard
              identity={identity}
              displayName={displayName}
              onDisplayName={setDisplayName}
              serviceName={serviceName}
              onServiceName={setServiceName}
              cluster={cluster}
              onCluster={setCluster}
              namespace={namespace}
              onNamespace={setNamespace}
              hideNamespace={ns.hideField}
              namespaceHint={ns.hideField ? resolveDestNamespace(ns, namespace, values) : undefined}
              team={team}
              version={version}
              latest
              identityName={identity ? readPointer(values, identity) : ""}
            />
            <OrderValuesCard
              schema={schema}
              view={orderView}
              values={values}
              onValues={setValues}
              mode={mode}
              onSwitchMode={switchMode}
              raw={raw}
              onRaw={setRaw}
            />
          </>
        ) : (
          <p className="text-sm text-gray-500">
            В документе нет view "order", форма заказа не строится.
          </p>
        )}
      </TabPanel>
      <TabPanel
        id="product"
        className="relative flex min-h-0 flex-1 flex-col overflow-y-auto pr-1 pt-3 outline-none"
      >
        <ProductPagePreview
          request={request}
          doc={doc}
          schema={schema}
          persist={(v) => setValues(v as Values)}
        />
      </TabPanel>
    </Tabs>
  );
}

// ProductPagePreview shows the order's product page exactly as RequestDetailPage
// renders it: the same header + meta card layout and the shared ProductView
// (tabs, tables, the actions menu). Edits write to local state via persist.
function ProductPagePreview({
  request,
  doc,
  schema,
  persist,
}: {
  request: OrderRequest;
  doc: ViewDocument;
  schema: Record<string, any>;
  persist: PersistValues;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
          <ProductIcon project={request.chart_project} name={request.chart_name} size={22} />
        </span>
        <h1 className="truncate text-xl font-semibold">
          {request.display_name || request.service_name}
        </h1>
      </div>
      <Card className="grid grid-cols-3 gap-4">
        <Meta label="Создатель">
          <span className="text-sm text-gray-800">{request.created_by_name || "-"}</span>
        </Meta>
        <Meta label="Создан">
          <span className="text-sm text-gray-800">-</span>
        </Meta>
        <Meta label="Статус">
          <StatusBadge status={request.status} />
        </Meta>
      </Card>
      <ProductView
        request={request}
        doc={doc}
        modifiable
        reload={() => {}}
        schema={schema}
        persist={persist}
      />
    </div>
  );
}

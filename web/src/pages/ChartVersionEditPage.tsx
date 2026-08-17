import Editor from "@monaco-editor/react";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconCloudOff,
  IconHelpCircle,
  IconPackageOff,
  IconTag,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
  TabList,
  TabPanel,
  Tabs,
} from "react-aria-components";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { api, HttpError } from "../api/client";
import { qk } from "../api/queryKeys";
import type {
  ChartPublication,
  PublicationStatus,
  PublicationVersion,
  ViewDocument,
  ViewIssue,
} from "../api/types";
import { chartLabel, useCatalog } from "../app/CatalogContext";
import { usePlatformHealth } from "../app/PlatformHealthContext";
import { useTheme } from "../app/ThemeContext";
import { useToast } from "../app/ToastContext";
import { canModify, useUser } from "../auth/UserContext";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { FormErrors } from "../components/FormErrors";
import { Button, Card, Chip, ErrorBox, Loading } from "../components/ui";
import {
  EditorTab,
  PreviewBoundary,
  PreviewPane,
  SplitHandle,
  useHorizontalSplit,
} from "../features/publications/viewPreview";
import { useAsync } from "../hooks/useAsync";
import { compareSemver } from "../lib/semver";
import { RejectedChip, STATUS_LABELS, versionHint } from "./ChartManagePage";

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
    (signal) => api.findPublication(project, name, signal),
    [project, name],
    qk.publication(project, name),
  );

  if (pubLoading && !pub) return <Loading label="Загружаем версию" />;
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

// PanelNotice fills a panel that has nothing to show: a circled icon and one
// line, centred - the same empty state the catalog and the order lists use.
function PanelNotice({ Icon, text }: { Icon: typeof IconPackageOff; text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <Icon size={24} stroke={1.6} />
      </span>
      <p className="text-sm text-slate-500">{text}</p>
    </div>
  );
}

function VersionEditor({ pub, version }: { pub: ChartPublication; version: string }) {
  const { user } = useUser();
  const { reload: reloadCatalog } = useCatalog();
  const { theme } = useTheme();
  const publishOutage = usePlatformHealth().blockedReason("publishing");
  const navigate = useNavigate();
  // Monaco lives outside Tailwind tokens: match its theme to the portal theme.
  const monacoTheme = theme === "light" ? "light" : "vs-dark";
  const project = pub.chart_project;
  const name = pub.chart_name;

  // Chart versions (Harbor) feed the switcher; stored rows carry per-version state.
  const { data: chart } = useAsync(
    () => api.getChart(project, name),
    [project, name],
    qk.chart(project, name),
  );
  const { data: versions, reload: reloadVersions } = useAsync(
    () => api.listVersions(pub.id),
    [pub.id],
    qk.versions(pub.id),
  );

  // The version's stored row (may not exist yet -> a fresh draft).
  const cur = versions?.find((v) => v.chart_version === version) ?? null;
  const curStatus: PublicationStatus = cur?.status ?? "DRAFT";

  // Chart schema of the version, for validation and the form preview.
  const { data: schema } = useAsync(
    () => api.getSchema(project, name, version),
    [project, name, version],
    qk.schema(project, name, version),
  );

  const pending = curStatus === "PENDING";
  const isOwner = canModify(user, pub.owner_team);
  // A version the registry no longer has is read-only: the document can be
  // looked at, but there is nothing to check it against and nothing to deploy,
  // so the portal refuses to save or submit it (the server enforces the same).
  // The catalog is the source for "does it exist" - the stored row outlives the
  // artifact, which is the whole reason this state is possible.
  const inRegistry = !chart || (chart.versions ?? []).includes(version);
  const editable = isOwner && !pending && inRegistry;
  // Without the chart there is no schema, so both the form preview and the
  // schema tab have nothing to show. Naming the file that failed to load
  // explains nothing to the person looking at it - say what happened instead.
  const schemaMissing = inRegistry
    ? { Icon: IconCloudOff, text: "Не удалось получить описание чарта" }
    : { Icon: IconPackageOff, text: "Версия не найдена в реестре" };
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
  const { ref: splitRef, pct: splitPct, onPointerDown: onSplitDown } = useHorizontalSplit();

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
            {!inRegistry && (
              <span title="Этой версии нет в реестре. Документ можно посмотреть, изменить - пока она не вернётся - нет.">
                <Chip className="bg-red-50 text-red-700">
                  <IconAlertTriangle size={12} stroke={2} />
                  Нет в реестре
                </Chip>
              </span>
            )}
            {cur?.orderable && inRegistry && (
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
            {/* Sending a version for approval reads the chart back from the
                registry, so an outage there blocks it; the draft above only
                touches the portal's own storage and stays available. */}
            <span title={publishOutage}>
              <Button
                variant="primary"
                isDisabled={busy !== null || !!syntaxErr || issues.length > 0 || !!publishOutage}
                onPress={onSubmit}
              >
                Отправить на согласование
              </Button>
            </span>
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
                <PanelNotice {...schemaMissing} />
              )}
            </TabPanel>
          </Tabs>
        </Card>

        <SplitHandle onPointerDown={onSplitDown} />

        <Card className="flex flex-col gap-2 lg:min-h-0 lg:min-w-0 lg:flex-1">
          {!schema ? (
            <PanelNotice {...schemaMissing} />
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
        className="fixed inset-0 z-10 flex items-start justify-center scrim p-4 pt-16 entering:animate-in entering:fade-in"
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
                    Документ из разделов: <b>views</b> (формы), <b>tabs</b> (вкладки-таблицы), <b>actions</b>{" "}
                    (пункты меню «Действия»), <b>graph</b> (визуальный редактор values).
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
                      <b>graph</b> (необязательно): включает для этой версии визуальный редактор values - в форме
                      заказа рядом с «Форма» и «YAML» появляется вкладка «Граф». Чарту, который называет поля по
                      соглашению, достаточно{" "}
                      <code className="rounded bg-slate-50 px-1 ring-1 ring-slate-200">{'{"profile":"policies"}'}</code>.
                      Если поля названы иначе, их можно переименовать здесь же: <b>entries</b> (JSON pointer на
                      список записей),{" "}
                      <code className="rounded bg-slate-50 px-1 ring-1 ring-slate-200">{'{"entry":{"selector":"podSelector"}}'}</code>,{" "}
                      а также <b>rule</b> и <b>peer</b>. <b>enabled: false</b> выключает редактор, не удаляя
                      настройку. Поля проверяются по values.schema.json этой версии, поэтому несовпадение видно
                      здесь, а не у пользователя при заказе.
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
                    <li>
                      <b>approval</b> (необязательно): как изменения этого сервиса попадают в кластер.{" "}
                      <code className="rounded bg-slate-50 px-1 ring-1 ring-slate-200">
                        {'{"autoMerge": false}'}
                      </code>{" "}
                      означает, что каждое изменение сливает человек. Портал подготовит merge request и
                      остановится - так делают для сервисов, которые смотрит информационная безопасность,
                      например для политик сети. Без этой настройки решает конфигурация портала, и включить
                      автоматическое слияние там, где его выключили, документ версии не может.
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

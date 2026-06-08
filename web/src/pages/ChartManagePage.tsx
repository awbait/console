import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Editor, { DiffEditor } from "@monaco-editor/react";
import {
  Button as AriaButton,
  Dialog,
  DialogTrigger,
  Heading,
  ListBox,
  ListBoxItem,
  Modal,
  ModalOverlay,
  Popover,
  Select as AriaSelect,
  SelectValue,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from "react-aria-components";
import {
  IconAlertCircle,
  IconArrowNarrowRight,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconHelpCircle,
  IconX,
} from "@tabler/icons-react";
import { api, HttpError } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useUser, canModify } from "../auth/UserContext";
import { chartLabel, useCatalog } from "../app/CatalogContext";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Button, Card, ErrorBox, Select, Spinner, TextField } from "../components/ui";
import { SchemaForm, type View } from "../form/SchemaForm";
import type { ChartPublication, PublicationStatus, ViewDocument, ViewIssue } from "../api/types";

type Values = Record<string, unknown>;

// Шаблон view-документа для нового черновика.
const VIEW_TEMPLATE = `{
  "views": {
    "order": {
      "include": [],
      "overrides": {}
    }
  }
}
`;

const STATUS_LABELS: Record<PublicationStatus, { label: string; cls: string }> = {
  DRAFT: { label: "Черновик", cls: "bg-gray-100 text-gray-600" },
  PENDING: { label: "На согласовании", cls: "bg-amber-50 text-amber-700" },
  APPROVED: { label: "Согласовано", cls: "bg-emerald-50 text-emerald-700" },
  REJECTED: { label: "Отклонено", cls: "bg-red-50 text-red-700" },
};

// Управление публикацией чарта: метаданные (категория, владелец) + конструктор
// view-документа (Monaco + live-валидация + предпросмотр форм) + согласование.
export function ChartManagePage() {
  const { project = "", name = "" } = useParams();
  const { user } = useUser();

  // Полная публикация (list -> match по project: фильтр API ключует по имени).
  const {
    data: pub,
    loading: pubLoading,
    error: pubError,
    reload: reloadPub,
  } = useAsync(
    () =>
      api
        .listPublications({ chart: name })
        .then((list) => list.find((p) => p.chart_project === project) ?? null),
    [project, name],
  );

  if (pubLoading) return <Spinner />;
  if (pubError) return <ErrorBox error={pubError} />;

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs
        items={[
          { label: "Чарты", to: "/catalog" },
          { label: `${project}/${name}`, to: `/catalog/${project}/${name}` },
          { label: "Управление" },
        ]}
      />
      {pub ? (
        <ManagePublication pub={pub} reload={reloadPub} />
      ) : (
        <RegisterCard project={project} name={name} onCreated={reloadPub} />
      )}
      {!pub && user?.role === "viewer" && (
        <p className="text-sm text-gray-500">Публиковать чарты могут участники команд.</p>
      )}
    </div>
  );
}

// Регистрация чарта в каталоге: категория + группа-владелец.
function RegisterCard({
  project,
  name,
  onCreated,
}: {
  project: string;
  name: string;
  onCreated: () => void;
}) {
  const { user } = useUser();
  const { categories, reload: reloadCatalog } = useCatalog();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [ownerTeam, setOwnerTeam] = useState<string | null>(user?.teams[0] ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isAdmin = user?.role === "admin";
  const teams = user?.teams ?? [];

  async function onCreate() {
    if (!categoryId || !ownerTeam) {
      setErr("Выберите категорию и группу-владельца.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.createPublication({
        chart: `${project}/${name}`,
        category_id: categoryId,
        owner_team: ownerTeam,
      });
      reloadCatalog();
      onCreated();
    } catch (e) {
      setErr(e instanceof HttpError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex max-w-lg flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold">Публикация чарта {chartLabel(name)}</h1>
        <p className="mt-1 text-sm text-gray-600">
          Зарегистрируйте чарт в каталоге: выберите категорию и группу, которая будет управлять
          публикацией. Автором станете вы.
        </p>
      </div>
      <Select
        label="Категория"
        isRequired
        selectedKey={categoryId}
        onSelectionChange={setCategoryId}
        options={categories.map((c) => ({ id: c.id, label: c.label }))}
      />
      {teams.length > 0 ? (
        <Select
          label="Группа-владелец"
          isRequired
          selectedKey={ownerTeam}
          onSelectionChange={setOwnerTeam}
          options={teams.map((t) => ({ id: t, label: t }))}
        />
      ) : isAdmin ? (
        <TextField
          label="Группа-владелец"
          value={ownerTeam ?? ""}
          onChange={(v: string) => setOwnerTeam(v)}
        />
      ) : null}
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div>
        <Button variant="primary" isDisabled={busy} onPress={onCreate}>
          Опубликовать
        </Button>
      </div>
    </Card>
  );
}

function ManagePublication({ pub, reload }: { pub: ChartPublication; reload: () => void }) {
  const { user } = useUser();
  const { categories, reload: reloadCatalog } = useCatalog();
  const project = pub.chart_project;
  const name = pub.chart_name;

  // Схема чарта (последняя версия), для предпросмотра форм.
  const { data: chart } = useAsync(() => api.getChart(project, name), [project, name]);
  const version = chart?.latest_version ?? "";
  const { data: schema } = useAsync(
    () => (version ? api.getSchema(project, name, version) : Promise.resolve(null)),
    [project, name, version],
  );

  const pending = pub.status === "PENDING";
  const isAdmin = user?.role === "admin";
  const isOwner = canModify(user, pub.owner_team);
  const editable = isOwner && !pending;

  // Черновик view-документа в редакторе.
  const [text, setText] = useState(() =>
    pub.view_json ? JSON.stringify(pub.view_json, null, 2) : VIEW_TEMPLATE,
  );
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "save" | "submit" | "approve" | "reject" | "withdraw">(null);
  const [rejectComment, setRejectComment] = useState("");

  // Live-валидация: локальный JSON.parse, сразу, серверная (формат + сверка со
  // схемой чарта), с дебаунсом.
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
        .validatePublication(pub.id, parsed)
        .then((r) => setIssues(r.issues))
        .catch(() => {}); // валидация, best effort, сеть мигнула, не страшно
    }, 500);
    return () => clearTimeout(debounce.current);
  }, [parsed, pub.id]);

  async function onSave(): Promise<boolean> {
    if (!parsed) {
      setErr("Исправьте синтаксис JSON перед сохранением.");
      return false;
    }
    setBusy("save");
    setErr(null);
    try {
      await api.updatePublication(pub.id, { view: parsed });
      reload();
      reloadCatalog();
      return true;
    } catch (e) {
      setErr(e instanceof HttpError ? e.message : (e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  // Категория/владелец правятся в чипах шапки, но это лишь черновик: live-значения
  // (по ним работают каталог и права) меняются только после согласования.
  async function onMetaChange(patch: { category_id?: string; owner_team?: string }) {
    setErr(null);
    try {
      await api.updatePublication(pub.id, patch);
      reload();
      reloadCatalog();
    } catch (e) {
      setErr(e instanceof HttpError ? e.message : (e as Error).message);
    }
  }

  async function onSubmit() {
    if (!(await onSave())) return;
    setBusy("submit");
    try {
      await api.submitPublication(pub.id);
      reload();
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
      await api.withdrawPublication(pub.id);
      reload();
    } catch (e) {
      setErr(e instanceof HttpError ? e.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onApprove() {
    setBusy("approve");
    setErr(null);
    try {
      await api.approvePublication(pub.id);
      reload();
      reloadCatalog();
    } catch (e) {
      setErr(e instanceof HttpError ? e.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onReject() {
    setBusy("reject");
    setErr(null);
    try {
      await api.rejectPublication(pub.id, rejectComment.trim());
      reload();
    } catch (e) {
      setErr(e instanceof HttpError ? e.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const st = STATUS_LABELS[pub.status];
  const viewNames = Object.keys(parsed?.views ?? {});
  const catLabel = (id: string) => categories.find((c) => c.id === id)?.label ?? id;
  const categoryLabel = catLabel(pub.category_id);
  const ownerOptions = [
    ...new Set([...(user?.teams ?? []), pub.owner_team, pub.draft_owner_team].filter(Boolean) as string[]),
  ];
  // Несогласованная смена метаданных: предложения, ждущие approve.
  const proposals: { label: string; from: string; to: string }[] = [];
  if (pub.draft_category_id)
    proposals.push({ label: "Категория", from: categoryLabel, to: catLabel(pub.draft_category_id) });
  if (pub.draft_owner_team)
    proposals.push({ label: "Владелец", from: pub.owner_team, to: pub.draft_owner_team });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Управление: {chartLabel(name)}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Chip className={st.cls}>{st.label}</Chip>
            <Chip className="bg-slate-100 text-slate-600">
              {project}/{name}
              {version && <span className="text-slate-400">v{version}</span>}
            </Chip>
            {editable ? (
              <ChipSelect
                label="Категория"
                value={pub.draft_category_id || pub.category_id}
                pending={!!pub.draft_category_id}
                options={categories.map((c) => ({ id: c.id, label: c.label }))}
                onChange={(id) => onMetaChange({ category_id: id })}
              />
            ) : pub.draft_category_id ? (
              <ProposalChip label="Категория" from={categoryLabel} to={catLabel(pub.draft_category_id)} />
            ) : (
              <Chip className="bg-slate-100 text-slate-600">
                <span className="text-slate-400">Категория:</span>
                {categoryLabel}
              </Chip>
            )}
            {editable && ownerOptions.length > 1 ? (
              <ChipSelect
                label="Владелец"
                value={pub.draft_owner_team || pub.owner_team}
                pending={!!pub.draft_owner_team}
                options={ownerOptions.map((t) => ({ id: t, label: t }))}
                onChange={(t) => onMetaChange({ owner_team: t })}
              />
            ) : pub.draft_owner_team ? (
              <ProposalChip label="Владелец" from={pub.owner_team} to={pub.draft_owner_team} />
            ) : (
              <Chip className="bg-brand-50 text-brand-700">
                <span className="text-brand-400">Владелец:</span>
                {pub.owner_team}
              </Chip>
            )}
            {pub.created_by_name && (
              <Chip className="bg-slate-100 text-slate-600">
                <span className="text-slate-400">Автор:</span>
                {pub.created_by_name}
              </Chip>
            )}
            {pub.approved_view_json && (
              <Chip className="bg-emerald-50 text-emerald-700">
                <IconCheck size={12} stroke={2.5} />
                view опубликована
              </Chip>
            )}
          </div>
          {editable && proposals.length > 0 && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-700">
              <IconClock size={13} stroke={1.8} className="shrink-0 text-amber-500" />
              Смена {proposals.map((p) => p.label.toLowerCase()).join(" / ")} применится только после
              согласования — отправьте на согласование.
            </p>
          )}
        </div>
        {editable && (
          <div className="flex shrink-0 gap-2">
            <Button isDisabled={busy !== null} onPress={onSave}>
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

      {pub.status === "REJECTED" && pub.review_comment && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-medium">Отклонено{pub.reviewed_by ? ` (${pub.reviewed_by})` : ""}</p>
          <p className="mt-0.5">{pub.review_comment}</p>
        </div>
      )}
      {pending && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>Черновик на согласовании у администратора, правки заморожены до решения.</span>
          {isOwner && (
            <Button isDisabled={busy !== null} onPress={onWithdraw}>
              Отозвать для изменения
            </Button>
          )}
        </div>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}

      {/* Согласование (admin, pending): смена метаданных + diff view. */}
      {pending && isAdmin && (
        <Card className="flex flex-col gap-3 border-amber-200">
          <h2 className="text-sm font-semibold text-slate-800">Согласование</h2>
          {proposals.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-md border border-amber-200 bg-amber-50/60 p-3">
              <p className="text-xs font-medium text-amber-800">Смена метаданных</p>
              <div className="flex flex-wrap gap-1.5">
                {proposals.map((p) => (
                  <ProposalChip key={p.label} label={p.label} from={p.from} to={p.to} />
                ))}
              </div>
            </div>
          )}
          {pub.approved_view_json ? (
            <div className="overflow-hidden rounded-md border border-slate-200">
              <DiffEditor
                height="280px"
                language="json"
                original={JSON.stringify(pub.approved_view_json, null, 2)}
                modified={JSON.stringify(pub.view_json ?? {}, null, 2)}
                options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, fontSize: 12 }}
              />
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              Первая публикация view: действующей версии для сравнения нет.
            </p>
          )}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextField
                label="Комментарий (для отклонения)"
                value={rejectComment}
                onChange={(v: string) => setRejectComment(v)}
              />
            </div>
            <Button variant="primary" isDisabled={busy !== null} onPress={onApprove}>
              Согласовать
            </Button>
            <Button variant="danger" isDisabled={busy !== null} onPress={onReject}>
              Отклонить
            </Button>
          </div>
        </Card>
      )}

      {/* Конструктор: слева документ (+ схема чарта рядом, read-only), справа предпросмотр. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="flex flex-col gap-2">
          <Tabs>
            <TabList aria-label="Документы" className="flex gap-1 border-b border-gray-200">
              <EditorTab id="view">view.schema.json</EditorTab>
              <EditorTab id="schema">values.schema.json</EditorTab>
            </TabList>
            <TabPanel id="view" className="flex flex-col gap-2 pt-3 outline-none">
              <FormatHelp />
              <div className="overflow-hidden rounded-md border border-slate-200">
                <Editor
                  height="480px"
                  defaultLanguage="json"
                  value={text}
                  onChange={(v) => setText(v ?? "")}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    automaticLayout: true,
                    readOnly: !editable,
                  }}
                />
              </div>
              {syntaxErr ? (
                <p className="text-xs text-red-600">Синтаксис: {syntaxErr}</p>
              ) : issues.length > 0 ? (
                <ul className="flex flex-col gap-1.5 rounded-md border border-red-100 bg-red-50/50 p-2 text-xs">
                  {issues.map((i, idx) => (
                    <li key={idx} className="flex items-start gap-1.5 text-red-700">
                      <IconAlertCircle size={14} stroke={1.8} className="mt-px shrink-0 text-red-500" />
                      <span>
                        {i.path && (
                          <code className="mr-1 rounded bg-white px-1 py-px font-mono text-[11px] text-red-600 ring-1 ring-red-200">
                            {i.path}
                          </code>
                        )}
                        {i.message}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center gap-1.5 text-xs text-emerald-600">
                  <IconCheck size={14} stroke={2} />
                  Документ валиден.
                </p>
              )}
            </TabPanel>
            {/* Схема чарта, источник полей для include/exclude/overrides; только чтение. */}
            <TabPanel id="schema" className="flex flex-col gap-2 pt-3 outline-none">
              {schema ? (
                <>
                  <div className="overflow-hidden rounded-md border border-slate-200">
                    <Editor
                      height="480px"
                      defaultLanguage="json"
                      value={JSON.stringify(schema, null, 2)}
                      options={{
                        minimap: { enabled: false },
                        fontSize: 13,
                        automaticLayout: true,
                        readOnly: true,
                        domReadOnly: true,
                      }}
                    />
                  </div>
                  <p className="text-xs text-slate-400">
                    values.schema.json из чарта{version ? ` (v${version})` : ""}, только чтение.
                    Схема меняется только новой версией чарта.
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray-500">Схема values.schema.json недоступна.</p>
              )}
            </TabPanel>
          </Tabs>
        </Card>

        <Card className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-slate-800">Предпросмотр</h2>
          {!schema ? (
            <p className="text-sm text-gray-500">
              Схема values.schema.json недоступна, предпросмотр невозможен.
            </p>
          ) : viewNames.length === 0 ? (
            <p className="text-sm text-gray-500">Добавьте view в документ, чтобы увидеть форму.</p>
          ) : (
            <PreviewPane
              schema={schema as Record<string, any>}
              views={parsed!.views!}
              label={chartLabel(name)}
            />
          )}
        </Card>
      </div>
    </div>
  );
}

// Chip, единый стиль бейджей шапки.
function Chip({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

// ProposalChip, янтарный чип «было → стало (на согласовании)»: показывает
// несогласованную смену категории/владельца там, где правка недоступна.
function ProposalChip({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <Chip className="bg-amber-50 text-amber-700">
      <IconClock size={12} stroke={2} className="text-amber-500" aria-hidden />
      <span className="font-normal text-amber-500">{label}:</span>
      <span className="text-amber-600/70 line-through">{from}</span>
      <IconArrowNarrowRight size={13} stroke={2} className="text-amber-400" aria-hidden />
      {to}
    </Chip>
  );
}

// ChipSelect, селект в форме чипа: компактная правка категории/владельца прямо
// в шапке, без отдельной карточки метаданных. pending подсвечивает чип янтарём:
// выбранное значение — предложение, оно станет активным только после согласования.
function ChipSelect({
  label,
  value,
  options,
  onChange,
  pending = false,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
  pending?: boolean;
}) {
  const tone = pending
    ? "bg-amber-50 text-amber-700 hover:bg-amber-100 data-[pressed]:bg-amber-100"
    : "bg-slate-100 text-slate-600 hover:bg-slate-200 data-[pressed]:bg-slate-200";
  return (
    <AriaSelect
      selectedKey={value}
      onSelectionChange={(k) => k !== value && onChange(String(k))}
      aria-label={label}
      className="inline-flex"
    >
      <AriaButton
        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 ${tone}`}
      >
        <span className={`font-normal ${pending ? "text-amber-500" : "text-slate-400"}`}>{label}:</span>
        <SelectValue />
        {pending && <IconClock size={12} stroke={2} className="text-amber-500" aria-hidden />}
        <IconChevronDown size={12} stroke={2} className={pending ? "text-amber-500" : "text-slate-400"} aria-hidden />
      </AriaButton>
      <Popover className="min-w-[var(--trigger-width)] rounded-md border border-slate-200 bg-white shadow-lg entering:animate-in entering:fade-in">
        <ListBox className="max-h-60 overflow-auto p-1 outline-none">
          {options.map((o) => (
            <ListBoxItem
              key={o.id}
              id={o.id}
              className="cursor-pointer rounded px-2 py-1 text-xs outline-none focus:bg-brand-50 selected:bg-brand-100"
            >
              {o.label}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}

function EditorTab({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <Tab
      id={id}
      className="-mb-px cursor-pointer border-b-2 border-transparent px-3 py-2 text-sm font-medium text-gray-500 outline-none transition-colors hover:text-gray-700 selected:border-brand-600 selected:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      {children}
    </Tab>
  );
}

// FormatHelp, справка по заполнению view.schema.json в модальном окне.
function FormatHelp() {
  return (
    <DialogTrigger>
      <AriaButton className="inline-flex w-fit items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 outline-none transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-brand-500">
        <IconHelpCircle size={14} className="text-slate-400" />
        Как заполнять view.schema.json
      </AriaButton>
      <ModalOverlay
        isDismissable
        className="fixed inset-0 z-10 flex items-start justify-center bg-black/20 p-4 pt-16 entering:animate-in entering:fade-in"
      >
        <Modal className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white shadow-xl">
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
                  <ul className="flex list-disc flex-col gap-1.5 pl-4">
                    <li>
                      Документ: <code className="rounded bg-slate-50 px-1 ring-1 ring-slate-200">{'{"views": { ... }}'}</code>.
                      View <b>order</b> обязательна: это форма нового заказа, она же даёт пункт в левом меню.
                      Остальные views (routes, listeners, resources, ...) становятся вкладками страницы
                      заказанного продукта.
                    </li>
                    <li>
                      <b>include</b> / <b>exclude</b>: какие поля схемы показать или скрыть. Имена берутся из
                      values.schema.json (вкладка рядом).
                    </li>
                    <li>
                      <b>overrides</b>: настройка конкретного поля. <b>title</b> переопределяет подпись,{" "}
                      <b>ui:view</b>: вложенная проекция для объекта или элемента массива.
                    </li>
                    <li>
                      <b>ui:widget</b>: "single" рендерит массив как один объект, "hidden" скрывает поле,
                      "edit" раскрывает поле, скрытое в схеме чарта (override перебивает ui:widget схемы).
                    </li>
                    <li>
                      <b>identity</b>: JSON pointer на поле, из которого берётся имя сервиса, например{" "}
                      <code className="rounded bg-slate-50 px-1 ring-1 ring-slate-200">"/gateways/0/name"</code>.
                    </li>
                    <li>
                      Подписи и описания полей форма берёт из <b>title</b> / <b>description</b> в
                      values.schema.json; чтобы поправить текст, меняйте схему в чарте или title в overrides.
                    </li>
                  </ul>
                  <pre className="mt-3 overflow-x-auto rounded-md bg-slate-50 p-3 ring-1 ring-slate-200">
                    {`{
  "views": {
    "order": {
      "identity": "/gateways/0/name",
      "include": ["naming", "gateways"],
      "overrides": {
        "gateways": {
          "ui:widget": "single",
          "title": "Gateway",
          "ui:view": { "exclude": ["hpa"] }
        }
      }
    },
    "routes": { "include": ["xroutes"] }
  }
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

// readPointer достаёт строку из values по JSON pointer (identity предпросмотра).
function readPointer(v: unknown, ptr: string): string {
  let cur: any = v;
  for (const seg of ptr.split("/").slice(1)) {
    if (cur == null) return "";
    cur = Array.isArray(cur) ? cur[Number(seg)] : cur[seg];
  }
  return typeof cur === "string" ? cur : "";
}

// Человеческие подписи вкладок мока для известных view.
const VIEW_TAB_LABELS: Record<string, string> = {
  routes: "Маршруты",
  listeners: "Слушатели",
  resources: "Ресурсы",
};

function PreviewBadge({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-800">
      {children}
    </p>
  );
}

// Предпросмотр: полноценная форма нового заказа (view "order") и кликабельный
// мок страницы заказанного продукта. Всё рендерится реальным SchemaForm по
// реальной схеме чарта; значения локальные, никуда не отправляются.
function PreviewPane({
  schema,
  views,
  label,
}: {
  schema: Record<string, any>;
  views: Record<string, View & { identity?: string }>;
  label: string;
}) {
  // Значения формы заказа шарятся с моком продукта: заполнил форму, открыл
  // вкладку продукта и видишь свой заказ.
  const [orderValues, setOrderValues] = useState<Values>({});
  return (
    <Tabs>
      <TabList aria-label="Предпросмотр" className="flex gap-1 border-b border-gray-200">
        <EditorTab id="order">Форма заказа</EditorTab>
        <EditorTab id="product">Страница продукта</EditorTab>
      </TabList>
      <TabPanel id="order" className="pt-3 outline-none">
        <OrderFormPreview
          schema={schema}
          view={views.order}
          label={label}
          values={orderValues}
          onChange={setOrderValues}
        />
      </TabPanel>
      <TabPanel id="product" className="pt-3 outline-none">
        <ProductPageMock schema={schema} views={views} label={label} orderValues={orderValues} />
      </TabPanel>
    </Tabs>
  );
}

// Форма нового заказа, как её увидит пользователь: верхние поля заказа +
// SchemaForm c проекцией view "order".
function OrderFormPreview({
  schema,
  view,
  label,
  values,
  onChange,
}: {
  schema: Record<string, any>;
  view?: View & { identity?: string };
  label: string;
  values: Values;
  onChange: (v: Values) => void;
}) {
  const [displayName, setDisplayName] = useState(label);
  const [namespace, setNamespace] = useState("");
  const [svcName, setSvcName] = useState("");
  if (!view) {
    return <p className="text-sm text-gray-500">В документе нет view "order", форма заказа не строится.</p>;
  }
  const identity = view.identity;
  const identityName = identity ? readPointer(values, identity) : "";
  return (
    <div className="flex flex-col gap-3">
      <PreviewBadge>
        Предпросмотр формы нового заказа (view "order"). Значения локальные, никуда не
        отправляются.
      </PreviewBadge>
      <div className="flex max-h-[460px] flex-col gap-3 overflow-y-auto pr-1">
        <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-3">
          {identity ? (
            <p className="text-sm text-gray-600">
              Имя сервиса:{" "}
              <span className="font-medium text-gray-800">{identityName || "(пусто)"}</span>{" "}
              <span className="text-xs text-gray-400">из поля формы (identity: {identity})</span>
            </p>
          ) : (
            <TextField
              label="Имя сервиса"
              value={svcName}
              onChange={(v: string) => setSvcName(v)}
              placeholder="my-service"
            />
          )}
          <TextField
            label="Отображаемое имя"
            value={displayName}
            onChange={(v: string) => setDisplayName(v)}
          />
          <TextField
            label="Namespace"
            value={namespace}
            onChange={(v: string) => setNamespace(v)}
            placeholder="по умолчанию: имя сервиса"
          />
        </div>
        <SchemaForm schema={schema} view={view} value={values} onChange={onChange} />
      </div>
    </div>
  );
}

// Мок страницы заказанного продукта: шапка с псевдостатусом и вкладки,
// сгенерированные из views документа (кроме order). Можно пощёлкать.
function ProductPageMock({
  schema,
  views,
  label,
  orderValues,
}: {
  schema: Record<string, any>;
  views: Record<string, View & { identity?: string }>;
  label: string;
  orderValues: Values;
}) {
  const productViews = Object.keys(views).filter((n) => n !== "order");
  const [vals, setVals] = useState<Record<string, Values>>({});
  const identity = views.order?.identity;
  const serviceName = (identity && readPointer(orderValues, identity)) || "demo-service";
  return (
    <div className="flex flex-col gap-3">
      <PreviewBadge>
        Мок страницы заказанного продукта: вкладки построены из views документа. Данные
        локальные.
      </PreviewBadge>
      <div className="max-h-[460px] overflow-y-auto rounded-md border border-slate-200 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs text-slate-400">{label}</p>
            <p className="text-sm font-semibold text-slate-800">{serviceName}</p>
          </div>
          <Chip className="bg-emerald-50 text-emerald-700">
            <IconCheck size={12} stroke={2.5} />
            HEALTHY
          </Chip>
        </div>
        <Tabs className="mt-2">
          <TabList aria-label="Вкладки продукта" className="flex gap-1 border-b border-gray-200">
            <EditorTab id="__info">Общая информация</EditorTab>
            {productViews.map((n) => (
              <EditorTab key={n} id={n}>
                {VIEW_TAB_LABELS[n] ?? n}
              </EditorTab>
            ))}
          </TabList>
          <TabPanel id="__info" className="pt-3 outline-none">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <MockField label="Сервис" value={serviceName} />
              <MockField label="Статус" value="HEALTHY" />
              <MockField label="Кластер" value="in-cluster" />
              <MockField label="Namespace" value={serviceName} />
              <MockField label="Команда" value="team" />
              <MockField label="ArgoCD App" value={`team-${serviceName}`} />
            </div>
          </TabPanel>
          {productViews.map((n) => (
            <TabPanel key={n} id={n} className="pt-3 outline-none">
              <SchemaForm
                schema={schema}
                view={views[n]}
                value={vals[n] ?? orderValues}
                onChange={(v) => setVals((prev) => ({ ...prev, [n]: v }))}
              />
            </TabPanel>
          ))}
        </Tabs>
      </div>
    </div>
  );
}

function MockField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-slate-800">{value}</p>
    </div>
  );
}

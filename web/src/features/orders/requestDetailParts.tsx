// Shared presentational pieces of the request (product) detail page (RequestDetailPage):
// detail actions, tabs, fields, history, the raw-values modal and date formatting.
// Kept as a separate module so the page component stays focused on data flow.
import { useEffect, useState } from "react";
import {
  Button as AriaButton,
  Dialog,
  DialogTrigger,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  ModalOverlay,
  Popover,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from "react-aria-components";
import Editor from "@monaco-editor/react";
import {
  IconChevronLeft,
  IconChevronRight,
  IconCircleX,
  IconDotsVertical,
  IconExternalLink,
  IconFileCode,
  IconForms,
  IconAlertTriangle,
  IconGitBranch,
  IconGitCommit,
  IconGitFork,
  IconGitMerge,
  IconGitPullRequest,
  IconGitPullRequestClosed,
  IconHistory,
  IconPencil,
  IconRefresh,
  IconSparkles,
  IconTrash,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import { Card } from "../../components/ui";
import { safeHref } from "../../lib/href";
import { statusMeta } from "../../components/StatusBadge";
import { useTheme } from "../../app/ThemeContext";
import { productTabs } from "../../components/products/genericView";
import {
  GenericInfoActions,
  GenericListTab,
  type PersistValues,
} from "../../components/products/GenericProductTabs";
import type { OrderRequest, RequestDetail, RequestEvent, RequestMR, ViewDocument } from "../../api/types";

export function Meta({
  label,
  children,
  align = "start",
}: {
  label: string;
  children: React.ReactNode;
  align?: "start" | "end";
}) {
  return (
    <div className={`flex flex-col gap-1 ${align === "end" ? "items-end text-right" : "items-start"}`}>
      <span className="text-xs uppercase tracking-wide text-gray-400">{label}</span>
      {children}
    </div>
  );
}

// DetailTab is a styled react-aria Tab with an underline indicator.
export function DetailTab({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <Tab
      id={id}
      className="-mb-px cursor-pointer border-b-2 border-transparent px-3 py-2 text-sm font-medium text-gray-500 outline-none transition-colors hover:text-gray-700 selected:border-brand-600 selected:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      {children}
    </Tab>
  );
}

export function Field({ label, value, href }: { label: string; value: string; href?: string }) {
  const safe = safeHref(href);
  return (
    <div>
      <div className="text-xs uppercase text-gray-400">{label}</div>
      {safe && value ? (
        <a
          href={safe}
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex items-center gap-1 text-brand-600 hover:text-brand-700 hover:underline"
        >
          {value}
          <IconExternalLink size={14} stroke={1.8} className="text-brand-400 group-hover:text-brand-600" />
        </a>
      ) : (
        <div className="text-gray-800">{value || "-"}</div>
      )}
    </div>
  );
}

// DetailActions is the header's actions dropdown (vertical dots). It renders
// only the actions available for the current order/role; nothing if there are none.
export function DetailActions({
  isDraft,
  onContinue,
  onSubmit,
  onSync,
  onUpgrade,
  onDelete,
  notify = false,
}: {
  isDraft: boolean;
  onContinue?: () => void;
  onSubmit?: () => void;
  onSync?: () => void;
  onUpgrade?: () => void;
  onDelete?: () => void;
  // Show a notification dot on the trigger (e.g. an upgrade is available).
  notify?: boolean;
}) {
  if (!onContinue && !onSubmit && !onSync && !onUpgrade && !onDelete) return null;
  const item = "cursor-pointer px-3 py-1.5 text-sm text-slate-700 outline-none focus:bg-slate-50";
  return (
    <MenuTrigger>
      <AriaButton className="relative inline-flex shrink-0 items-center gap-1.5 rounded-md border border-brand-200 bg-surface px-3 py-1.5 text-sm font-medium text-brand-600 outline-none hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500">
        <IconDotsVertical size={16} stroke={1.8} className="text-brand-600" />
        Действия
        {notify && (
          <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-brand-500 ring-2 ring-surface" />
        )}
      </AriaButton>
      <Popover className="min-w-48 rounded-md border border-slate-200 bg-surface py-1 shadow-lg outline-none entering:animate-in entering:fade-in">
        <Menu
          className="outline-none"
          onAction={(key) => {
            if (key === "continue") onContinue?.();
            else if (key === "submit") onSubmit?.();
            else if (key === "sync") onSync?.();
            else if (key === "upgrade") onUpgrade?.();
            else if (key === "delete") onDelete?.();
          }}
        >
          {onContinue && (
            <MenuItem id="continue" className={item}>
              Продолжить редактирование
            </MenuItem>
          )}
          {onSubmit && (
            <MenuItem id="submit" className={item}>
              Заказать
            </MenuItem>
          )}
          {onUpgrade && (
            <MenuItem id="upgrade" className={item}>
              Обновить
            </MenuItem>
          )}
          {onSync && (
            <MenuItem id="sync" className={item}>
              Выкатить из Git
            </MenuItem>
          )}
          {onDelete && (
            <MenuItem
              id="delete"
              className="cursor-pointer px-3 py-1.5 text-sm text-red-600 outline-none focus:bg-red-50"
            >
              {isDraft ? "Удалить черновик" : "Удалить"}
            </MenuItem>
          )}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

// ValuesModalButton opens the read-only values.yaml in a centered modal.
export function ValuesModalButton({ request: r }: { request: RequestDetail["request"] }) {
  const { theme } = useTheme();
  return (
    <DialogTrigger>
      <AriaButton className="mb-2 inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm font-medium text-gray-700 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-brand-500">
        <IconFileCode size={16} stroke={1.8} className="text-gray-400" />
        values.yaml
      </AriaButton>
      <ModalOverlay className="fixed inset-0 z-50 flex items-center justify-center scrim p-4 entering:animate-in entering:fade-in">
        <Modal className="w-full max-w-3xl rounded-lg bg-surface shadow-xl outline-none entering:animate-in entering:zoom-in-95">
          <Dialog className="outline-none">
            {({ close }) => (
              <div className="flex flex-col">
                <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                  <h2 className="text-sm font-semibold text-gray-700">values.yaml</h2>
                  <button
                    onClick={close}
                    aria-label="Закрыть"
                    className="rounded-md p-1 text-gray-400 outline-none hover:bg-gray-100 hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    <IconX size={18} stroke={2} />
                  </button>
                </header>
                <div className="overflow-hidden rounded-b-lg">
                  <Editor
                    height="480px"
                    defaultLanguage="yaml"
                    theme={theme === "light" ? "light" : "vs-dark"}
                    value={r.values_yaml}
                    options={{
                      readOnly: true,
                      minimap: { enabled: false },
                      fontSize: 13,
                      automaticLayout: true,
                    }}
                  />
                </div>
              </div>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// useNow ticks so that relative timestamps stay true on a page nobody reloads.
// An order page is left open while the pipeline works, and "только что" that is
// half an hour old is simply wrong.
//
// The tick is well under the minute these labels step by: a label has to change
// shortly after the boundary it crosses, not up to a minute later, or the page
// reads as frozen. It also recomputes when the tab comes back - a background
// tab has its timers throttled, so the first thing a returning user sees would
// otherwise be a stale label.
function useNow(ms = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const t = setInterval(tick, ms);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", tick);
    };
  }, [ms]);
  return now;
}

const MONTHS_GEN = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

// dayLabel names the day an event belongs to: today and yesterday by name, the
// rest by date. It is what makes a flat list read as a sequence.
function dayLabel(iso: string, now: number): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(new Date(now)) - startOf(d)) / 86_400_000);
  if (days === 0) return "Сегодня";
  if (days === 1) return "Вчера";
  const date = `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear() ? date : `${date} ${d.getFullYear()}`;
}

// Time of one row. The day it happened is already written above the group, so
// repeating a full date here says nothing new - past today the clock time is
// the only part that adds anything, and it is what puts the rows in order
// within their day. Today keeps the relative label, which is the form that
// actually answers "how long ago" and the one that ticks.
function fmtEventTime(iso: string, now: number): string {
  const d = new Date(iso);
  const t = new Date(now);
  const sameDay =
    d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
  if (sameDay) return fmtRelative(iso, now);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// fmtRelative renders a compact "X ago" label (abbreviations dodge RU plural
// forms); falls back to the absolute date past a week. Full date is in title=.
// `now` is passed in rather than read here so a caller can re-render on a tick
// and have every row move together (see useNow).
export function fmtRelative(iso: string, now: number = Date.now()): string {
  const sec = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (sec < 5) return "только что";
  if (sec < 60) return `${sec} сек назад`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ч назад`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} дн назад`;
  return fmtDateTime(iso);
}

// ---- Activity history: timeline + merge requests (MRs) ----

type TablerIcon = typeof IconHistory;

const TL_PREVIEW = 8; // events shown inline before "show all"
// Starting guesses only. The real heights come from the rendered rows (see
// useBodyMetrics): a row is one line by construction, but its exact height
// depends on the font the browser ended up using, and guessing it low costs a
// scrollbar while guessing it high leaves a gap the user can see is free.
const ROW_H = 36;
const DAY_H = 34;

// Fallback page size for the first frame, before the body has been measured.
const MODAL_PAGE = 12;
// Merge requests are boxed rows, roughly twice as tall as a timeline line, so
// the same dialog holds about half as many of them. The height includes the
// gap between rows; MR_MODAL_PAGE is the fallback until the body is measured.
const MR_ROW_H = 68;
const MR_GAP = 8; // gap-2 between merge-request rows
const MR_MODAL_PAGE = 6;

const tints: Record<string, string> = {
  slate: "bg-slate-100 text-slate-600",
  indigo: "bg-indigo-100 text-indigo-600",
  blue: "bg-blue-100 text-blue-600",
  rose: "bg-rose-100 text-rose-600",
  amber: "bg-amber-100 text-amber-700",
  emerald: "bg-emerald-100 text-emerald-600",
  sky: "bg-sky-100 text-sky-600",
};

const EVENT_META: Record<string, { label: string; Icon: TablerIcon; tint: string }> = {
  created: { label: "Заказ создан", Icon: IconSparkles, tint: "indigo" },
  draft_updated: { label: "Черновик изменён", Icon: IconPencil, tint: "slate" },
  renamed: { label: "Переименован", Icon: IconForms, tint: "slate" },
  draft_discarded: { label: "Черновик отброшен", Icon: IconTrash, tint: "slate" },
  sync_forced: { label: "Запрошена синхронизация", Icon: IconRefresh, tint: "blue" },
  deleted: { label: "Сервис удалён", Icon: IconCircleX, tint: "rose" },
  drift_detected: { label: "Обнаружено изменение в Git", Icon: IconAlertTriangle, tint: "amber" },
  drift_cleared: { label: "Расхождение с Git устранено", Icon: IconGitMerge, tint: "emerald" },
  git_pulled: { label: "Обновлено из Git", Icon: IconGitFork, tint: "sky" },
  imported: { label: "Импортировано из Git", Icon: IconGitFork, tint: "sky" },
};

// What a status change means, phrased as an event. StatusBadge keeps its own
// wording on purpose: a badge answers "where is the order now", a timeline row
// answers "what happened to it".
const STATUS_EVENT: Record<string, string> = {
  DRAFT: "Черновик создан",
  MR_CREATED: "Отправлен на согласование",
  MR_MERGED: "Согласован",
  MR_CLOSED: "Согласование отклонено",
  DEPLOYING: "Выкатывается",
  HEALTHY: "Работает",
  DEGRADED: "Работает с ошибками",
  ARGO_MISSING: "Не найден в кластере",
  DELETE_REQUESTED: "Запрошено удаление",
  DELETE_MR_MERGED: "Удаление согласовано",
  DELETED: "Удалён",
};

// Events a person recognises as their own action or as a change worth knowing
// about. Everything else is the pipeline talking to itself: a draft saved on
// every keystroke-ish save, and the intermediate transitions it makes to get
// from one meaningful state to the next. Those stay in the trail but fold away.
const TECHNICAL_EVENTS = new Set(["draft_updated"]);
const TECHNICAL_STATUSES = new Set(["DRAFT", "DEPLOYING", "DELETE_MR_MERGED"]);

function isNotable(e: RequestEvent): boolean {
  if (e.event_type === "status_changed") return !TECHNICAL_STATUSES.has(e.to_status ?? "");
  return !TECHNICAL_EVENTS.has(e.event_type);
}

function eventLabel(e: RequestEvent): string {
  if (e.event_type === "status_changed") {
    const to = e.to_status ?? "";
    return STATUS_EVENT[to] ?? statusMeta(to).label;
  }
  return EVENT_META[e.event_type]?.label ?? e.event_type;
}

// ProductView is the view-driven body of the product (order) page: the tab strip
// (Info + one tab per product view + Activity history) and the
// values.yaml button. It is shared by RequestDetailPage (live order, writes via
// the API) and the chart-manage preview (synthetic order, writes to local state
// via `persist` and uses the in-editor `schema`), so both render identically.
export function ProductView({
  request: r,
  doc,
  events = [],
  mrs = [],
  argocdUrl,
  modifiable,
  reload,
  schema,
  persist,
  activeTab,
  onTab,
}: {
  request: OrderRequest;
  doc: ViewDocument;
  events?: NonNullable<RequestDetail["events"]>;
  mrs?: NonNullable<RequestDetail["merge_requests"]>;
  argocdUrl?: string;
  modifiable: boolean;
  reload: () => void;
  // Preview only: preloaded schema + local save adapter (no API).
  schema?: Record<string, any>;
  persist?: PersistValues;
  // Controlled active tab (RequestDetailPage syncs it to the URL). When omitted,
  // ProductView keeps its own tab state (preview).
  activeTab?: string;
  onTab?: (key: string) => void;
}) {
  const [internalTab, setInternalTab] = useState("info");
  const tabs = productTabs(doc);
  const tabIds = ["info", ...tabs.map((t) => t.id), "history"];
  const controlled = onTab !== undefined;
  const requested = controlled ? (activeTab ?? "") : internalTab;
  const active = tabIds.includes(requested) ? requested : "info";
  const setActive = controlled ? onTab! : setInternalTab;

  return (
    <Tabs selectedKey={active} onSelectionChange={(key) => setActive(String(key))}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200">
        <TabList aria-label="Разделы заказа" className="flex gap-1">
          <DetailTab id="info">Общая информация</DetailTab>
          {tabs.map((t) => (
            <DetailTab key={t.id} id={t.id}>
              {t.title ?? t.id}
            </DetailTab>
          ))}
          <DetailTab id="history">История действий</DetailTab>
        </TabList>
        <ValuesModalButton request={r} />
      </div>

      <TabPanel id="info" className="pt-5 outline-none">
        <InfoTab
          request={r}
          argocdUrl={argocdUrl}
          modifiable={modifiable}
          doc={doc}
          onChanged={reload}
          schema={schema}
          persist={persist}
        />
      </TabPanel>
      {tabs.map((t) => (
        <TabPanel key={t.id} id={t.id} className="pt-5 outline-none">
          <Card>
            <GenericListTab
              request={r}
              modifiable={modifiable}
              reload={reload}
              doc={doc}
              tab={t}
              schema={schema}
              persist={persist}
            />
          </Card>
        </TabPanel>
      ))}
      <TabPanel id="history" className="pt-5 outline-none">
        <HistoryTab events={events} mrs={mrs} request={r} />
      </TabPanel>
    </Tabs>
  );
}

function InfoTab({
  request: r,
  argocdUrl,
  modifiable,
  doc,
  onChanged,
  schema,
  persist,
}: {
  request: OrderRequest;
  argocdUrl?: string;
  modifiable: boolean;
  doc: ViewDocument;
  onChanged: () => void;
  schema?: Record<string, any>;
  persist?: PersistValues;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Общая информация</h2>
        {modifiable && (
          <GenericInfoActions
            request={r}
            doc={doc}
            onChanged={onChanged}
            schema={schema}
            persist={persist}
          />
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <Field label="Service name" value={r.service_name} />
        <Field label="Chart" value={`${r.chart_project}/${r.chart_name}`} />
        <Field label="Version" value={r.chart_version} />
        <Field label="Team" value={r.team} />
        <Field label="Cluster" value={r.cluster} />
        <Field label="Namespace" value={r.namespace} />
        <Field label="ArgoCD App" value={r.argocd_app_name} href={argocdUrl} />
      </div>
    </Card>
  );
}

export function HistoryTab({
  events,
  mrs,
  request,
}: {
  events: NonNullable<RequestDetail["events"]>;
  mrs: NonNullable<RequestDetail["merge_requests"]>;
  request: RequestDetail["request"];
}) {
  // Events written before actor_name existed carry only the subject. When that
  // subject is the person who created the order, the order itself knows their
  // name - enough to keep the history readable instead of anonymous.
  const evts = [...events]
    .sort((a, b) => b.id - a.id)
    .map((e) =>
      e.actor_name || e.actor !== request.created_by
        ? e
        : { ...e, actor_name: request.created_by_name },
    );
  const mrList = [...mrs].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  // Two columns, history the wider one: it is what the tab is for, and the
  // merge requests are a short reference list beside it. Stretching them to a
  // common height is what keeps the pair from looking torn - the alternative,
  // one column, left a dead strip down the right of the page. Below lg they
  // stack, where a 1/3 column would be unreadable anyway.
  return (
    <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[2fr_1fr]">
      <TimelineCard events={evts} />
      <MergeRequestsCard mrs={mrList} />
    </div>
  );
}

// `action` fills the right side of the header - the card's own control belongs
// on the line that names it, not floating under the list where it left the
// header half empty.
function SectionHeader({
  Icon,
  title,
  action,
}: {
  Icon: TablerIcon;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-50 text-brand-600">
        <Icon size={16} stroke={1.8} />
      </span>
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-sm text-slate-400">{children}</p>;
}

function TimelineCard({ events }: { events: RequestEvent[] }) {
  const [showAll, setShowAll] = useState(false);
  // Technical rows are dropped outright rather than hidden behind a toggle: an
  // extra control on the page is a worse trade than the completeness it buys,
  // and the trail itself is intact in the database for support.
  const shown = events.filter(isNotable);
  return (
    <Card className="h-full">
      <SectionHeader
        Icon={IconHistory}
        title="Хронология"
        action={
          shown.length > TL_PREVIEW && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="rounded-md px-2 py-1 text-sm font-medium text-brand-600 outline-none hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              Показать все
            </button>
          )
        }
      />
      {shown.length === 0 ? (
        <EmptyHint>Событий пока нет.</EmptyHint>
      ) : (
        <Timeline items={shown.slice(0, TL_PREVIEW)} />
      )}
      <TimelineModal events={shown} isOpen={showAll} onOpenChange={setShowAll} />
    </Card>
  );
}

// The full history lives in a modal, paged. Two things the plain version got
// wrong: the body shrank on a short last page, so the dialog resized under the
// pointer just as it was being clicked, and pages swapped instantly, which
// reads as a redraw rather than as movement. The body is now a fixed height
// with its own scroll, and a page slides in from the side it came from.
function TimelineModal({
  events,
  isOpen,
  onOpenChange,
}: {
  events: RequestEvent[];
  isOpen: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [page, setPage] = useState(1);
  const [back, setBack] = useState(false);
  const now = useNow();
  // The page size follows the dialog, not a constant: a fixed count either
  // leaves the bottom of the body empty while a "next page" button waits below
  // it, or overflows into a scrollbar. Measure the body, fill it.
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const { height, rowH, dayH } = useBodyMetrics(body, isOpen);

  const pageList = paginate(events, height, now, rowH, dayH);
  const pages = pageList.length;
  // The body takes the height of the tallest page, so no page leaves a gap the
  // reader can see is free, and paging does not resize the dialog under them.
  // Only a short last page falls short of it.
  const bodyHeight = height > 0 ? Math.max(...pageList.map((p) => pageCost(p, now, rowH, dayH))) : 0;
  useEffect(() => {
    if (isOpen) setPage(1);
  }, [isOpen]);
  // A resize can shrink the page count under a reader who is on the last page.
  const current = Math.min(page, pages);
  const slice = pageList[current - 1] ?? [];
  const goto = (next: number) => {
    setBack(next < current);
    setPage(next);
  };
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      className="fixed inset-0 z-50 flex items-center justify-center scrim p-4 entering:animate-in entering:fade-in"
    >
      {/* Two passes: while the body is unmeasured the dialog is given a fixed
          height so the body can report how much room there is; once measured,
          the dialog follows its content and the body carries the height of the
          tallest page. The cap keeps a long history from filling the screen. */}
      <Modal
        className={`flex w-full max-w-lg flex-col rounded-lg bg-surface shadow-xl outline-none entering:animate-in entering:zoom-in-95 ${
          bodyHeight > 0 ? "max-h-[min(85vh,34rem)]" : "h-[min(85vh,34rem)]"
        }`}
      >
        <Dialog className="flex min-h-0 flex-1 flex-col outline-none">
          {({ close }) => (
            <>
              <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
                <SectionHeaderInline Icon={IconHistory} title="Хронология" />
                <button
                  onClick={close}
                  aria-label="Закрыть"
                  className="rounded-md p-1 text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <IconX size={18} stroke={2} />
                </button>
              </header>
              <div
                ref={setBody}
                style={bodyHeight > 0 ? { height: bodyHeight } : undefined}
                className={`scroll-slim overflow-y-auto px-5 py-4 ${bodyHeight > 0 ? "" : "min-h-0 flex-1"}`}
              >
                {/* key restarts the animation on every page change; the
                    direction follows the button that was pressed, so the list
                    moves the way the pagination does. */}
                <div
                  key={page}
                  className={`animate-in fade-in duration-200 motion-reduce:animate-none ${
                    back ? "slide-in-from-left-3" : "slide-in-from-right-3"
                  }`}
                >
                  <Timeline items={slice} />
                </div>
              </div>
              {pages > 1 && (
                <footer className="border-t border-slate-200 px-5 py-3">
                  <Pagination page={current} pages={pages} onChange={goto} />
                </footer>
              )}
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

// useBodyMetrics reports how much room a scrollable modal body has and how tall
// its rows actually render. Content-box height (clientHeight minus padding, as
// the browser computed it) rather than a hardcoded padding, and row heights
// read off the DOM rather than assumed - together that is the difference
// between a page that fills the dialog and one that stops two rows short.
function useBodyMetrics(body: HTMLDivElement | null, isOpen: boolean) {
  const [m, setM] = useState({ height: 0, rowH: ROW_H, dayH: DAY_H });
  // Measuring happens once per opening, in the pass where the body is still
  // free to fill the dialog. After that the body is given the height of its
  // tallest page, so measuring it again would only report back what was just
  // written to it. A window resize throws the measurement away and the cycle
  // starts over.
  useEffect(() => {
    if (!isOpen) {
      setM((prev) => (prev.height === 0 ? prev : { ...prev, height: 0 }));
      return;
    }
    const reset = () => setM((prev) => ({ ...prev, height: 0 }));
    window.addEventListener("resize", reset);
    return () => window.removeEventListener("resize", reset);
  }, [isOpen]);

  useEffect(() => {
    if (!body || m.height > 0) return;
    const measure = () => {
      const cs = getComputedStyle(body);
      const height =
        body.clientHeight - Number.parseFloat(cs.paddingTop) - Number.parseFloat(cs.paddingBottom);
      if (height <= 0) return;
      // offsetHeight, not getBoundingClientRect: the dialog animates in with a
      // scale transform, and a rect measured mid-animation is 5% short. Mixing
      // that with clientHeight, which ignores transforms, produces a page size
      // that fits nothing.
      const row = body.querySelector<HTMLElement>("[data-timeline-row]");
      // A heading's cost includes the margins that separate one day from the
      // next, and the first heading has its top margin removed - so measure the
      // last one, and never take less than the fallback: underestimating here
      // means a page that overflows into a scrollbar.
      const days = body.querySelectorAll<HTMLElement>("[data-timeline-day]");
      const day = days[days.length - 1];
      const dayCs = day && getComputedStyle(day);
      setM({
        height,
        rowH: row?.offsetHeight || ROW_H,
        dayH: dayCs
          ? Math.max(
              day.offsetHeight +
                Number.parseFloat(dayCs.marginTop) +
                Number.parseFloat(dayCs.marginBottom),
              DAY_H,
            )
          : DAY_H,
      });
    };
    measure();
    // And once more after the entrance animation has settled, in case the
    // first pass caught the dialog mid-flight.
    const settled = setTimeout(measure, 250);
    return () => clearTimeout(settled);
  }, [body, m.height]);
  return m;
}

// pageCost is what one page of rows plus its day headings occupies.
function pageCost(page: RequestEvent[], now: number, rowH: number, dayH: number): number {
  let day = "";
  let total = 0;
  for (const e of page) {
    const d = dayLabel(e.created_at, now);
    total += rowH + (d === day ? 0 : dayH);
    day = d;
  }
  return total;
}

// paginate fills each page to the height it actually has. A day heading costs
// extra, and it repeats when a day is split across two pages, so the split has
// to account for it as it goes rather than divide by a constant.
function paginate(
  events: RequestEvent[],
  height: number,
  now: number,
  rowH: number,
  dayH: number,
): RequestEvent[][] {
  if (events.length === 0) return [[]];
  if (height <= 0) return chunk(events, MODAL_PAGE);
  const pages: RequestEvent[][] = [];
  let page: RequestEvent[] = [];
  let used = 0;
  let day = "";
  for (const e of events) {
    const d = dayLabel(e.created_at, now);
    const cost = rowH + (d === day ? 0 : dayH);
    if (page.length > 0 && used + cost > height) {
      pages.push(page);
      page = [];
      used = rowH + dayH; // the new page reopens with its own heading
    } else {
      used += cost;
    }
    day = d;
    page.push(e);
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// The history is grouped by day. Which day something happened is the one
// ordering fact that is always true, unlike "this change led to that one",
// which the portal cannot know: an order carries no link between an edit and
// the deployment that followed it, so any such grouping would be a guess
// dressed up as a fact.
function Timeline({ items }: { items: RequestEvent[] }) {
  const now = useNow();
  let lastDay = "";
  return (
    <ol className="flex flex-col">
      {items.map((e) => {
        const day = dayLabel(e.created_at, now);
        const openDay = day !== lastDay;
        lastDay = day;
        return (
          <li key={e.id}>
            {openDay && (
              <div data-timeline-day className="mb-1.5 mt-3 flex items-center gap-3 first:mt-0">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {day}
                </span>
                <span className="h-px flex-1 bg-slate-100" aria-hidden />
              </div>
            )}
            <TimelineRow e={e} now={now} />
          </li>
        );
      })}
    </ol>
  );
}

// One event, one line: what happened, who did it, when. The status pair
// (from -> to) is gone - a person reading their order's history wants the
// event, not the state machine's edge, and the badges answered a question
// nobody was asking here.
function TimelineRow({ e, now }: { e: RequestEvent; now: number }) {
  const isStatus = e.event_type === "status_changed";
  const sMeta = e.to_status ? statusMeta(e.to_status) : null;
  const meta = EVENT_META[e.event_type];
  const circle = isStatus && sMeta ? sMeta.badge : tints[meta?.tint ?? "slate"];
  const Icon = (isStatus && sMeta ? (sMeta.staticIcon ?? sMeta.Icon) : meta?.Icon) ?? IconHistory;
  return (
    <div data-timeline-row className="flex items-center gap-2.5 py-1.5">
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${circle}`}>
        <Icon size={14} stroke={1.8} />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{eventLabel(e)}</span>
      {/* A person is named, the platform is not: an automatic event with
          "system" beside it reads as if someone by that name did it. The icon
          replaces a separator - it says "person" without a character that
          means nothing on its own. */}
      {e.actor_name && (
        <span className="flex shrink-0 items-center gap-1 text-xs text-slate-400">
          <IconUser size={13} stroke={1.8} />
          {e.actor_name}
        </span>
      )}
      <time
        dateTime={e.created_at}
        title={fmtDateTime(e.created_at)}
        className="w-24 shrink-0 text-right text-xs text-slate-400"
      >
        {fmtEventTime(e.created_at, now)}
      </time>
    </div>
  );
}

function SectionHeaderInline({ Icon, title }: { Icon: TablerIcon; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-50 text-brand-600">
        <Icon size={16} stroke={1.8} />
      </span>
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
    </div>
  );
}

function Pagination({ page, pages, onChange }: { page: number; pages: number; onChange: (p: number) => void }) {
  const nums = pageWindow(page, pages);
  const base =
    "min-w-8 rounded-md px-2.5 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-500";
  const arrow = `${base} text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent`;
  return (
    <div className="flex items-center justify-center gap-1">
      <button onClick={() => onChange(page - 1)} disabled={page === 1} aria-label="Назад" className={arrow}>
        <IconChevronLeft size={16} stroke={2} />
      </button>
      {nums.map((n, i) =>
        n === 0 ? (
          <span key={`gap-${i}`} className="px-1 text-slate-400">
            …
          </span>
        ) : (
          <button
            key={n}
            onClick={() => onChange(n)}
            aria-current={n === page ? "page" : undefined}
            className={`${base} ${
              n === page ? "bg-brand-600 font-medium text-on-accent" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {n}
          </button>
        ),
      )}
      <button onClick={() => onChange(page + 1)} disabled={page === pages} aria-label="Вперёд" className={arrow}>
        <IconChevronRight size={16} stroke={2} />
      </button>
    </div>
  );
}

function pageWindow(page: number, pages: number): number[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: number[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pages - 1, page + 1);
  if (start > 2) out.push(0);
  for (let i = start; i <= end; i++) out.push(i);
  if (end < pages - 1) out.push(0);
  out.push(pages);
  return out;
}

const MR_ACTION: Record<string, { label: string; Icon: TablerIcon; tint: string }> = {
  create: { label: "Создание сервиса", Icon: IconGitBranch, tint: "indigo" },
  update: { label: "Обновление", Icon: IconGitCommit, tint: "blue" },
  delete: { label: "Удаление", Icon: IconTrash, tint: "rose" },
};

const MR_STATUS: Record<string, { label: string; className: string; Icon: TablerIcon }> = {
  opened: { label: "Открыт", className: "bg-amber-100 text-amber-800", Icon: IconGitPullRequest },
  merged: { label: "Влит", className: "bg-indigo-100 text-indigo-800", Icon: IconGitMerge },
  closed: { label: "Закрыт", className: "bg-slate-200 text-slate-600", Icon: IconGitPullRequestClosed },
};

function MergeRequestsCard({ mrs }: { mrs: RequestMR[] }) {
  const [showAll, setShowAll] = useState(false);
  return (
    <Card className="h-full">
      <SectionHeader Icon={IconGitMerge} title="Запросы на слияние" />
      {mrs.length === 0 ? (
        <EmptyHint>Запросов на слияние пока нет.</EmptyHint>
      ) : (
        <ul className="flex flex-col gap-2">
          {mrs.slice(0, TL_PREVIEW).map((m) => (
            <MrRow key={m.id} m={m} />
          ))}
        </ul>
      )}
      {mrs.length > TL_PREVIEW && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-brand-600 outline-none hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          Показать все
        </button>
      )}
      <MergeRequestsModal mrs={mrs} isOpen={showAll} onOpenChange={setShowAll} />
    </Card>
  );
}

function MergeRequestsModal({
  mrs,
  isOpen,
  onOpenChange,
}: {
  mrs: RequestMR[];
  isOpen: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [page, setPage] = useState(1);
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const { height, rowH } = useBodyMetrics(body, isOpen);
  useEffect(() => {
    if (isOpen) setPage(1);
  }, [isOpen]);
  const step = (rowH || MR_ROW_H) + MR_GAP;
  const perPage = height > 0 ? Math.max(1, Math.floor((height + MR_GAP) / step)) : MR_MODAL_PAGE;
  const pages = Math.max(1, Math.ceil(mrs.length / perPage));
  const current = Math.min(page, pages);
  const slice = mrs.slice((current - 1) * perPage, current * perPage);
  const fullPage = Math.min(perPage, mrs.length);
  const bodyHeight = height > 0 ? fullPage * step - MR_GAP : 0;
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      className="fixed inset-0 z-50 flex items-center justify-center scrim p-4 entering:animate-in entering:fade-in"
    >
      <Modal
        className={`flex w-full max-w-lg flex-col rounded-lg bg-surface shadow-xl outline-none entering:animate-in entering:zoom-in-95 ${
          bodyHeight > 0 ? "max-h-[min(85vh,34rem)]" : "h-[min(85vh,34rem)]"
        }`}
      >
        <Dialog className="flex min-h-0 flex-1 flex-col outline-none">
          {({ close }) => (
            <>
              <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
                <SectionHeaderInline Icon={IconGitMerge} title="Запросы на слияние" />
                <button
                  onClick={close}
                  aria-label="Закрыть"
                  className="rounded-md p-1 text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <IconX size={18} stroke={2} />
                </button>
              </header>
              <div
                ref={setBody}
                style={bodyHeight > 0 ? { height: bodyHeight } : undefined}
                className={`scroll-slim overflow-y-auto px-5 py-4 ${bodyHeight > 0 ? "" : "min-h-0 flex-1"}`}
              >
                <ul key={current} className="flex animate-in flex-col gap-2 fade-in duration-200 motion-reduce:animate-none">
                  {slice.map((m) => (
                    <MrRow key={m.id} m={m} />
                  ))}
                </ul>
              </div>
              {pages > 1 && (
                <footer className="border-t border-slate-200 px-5 py-3">
                  <Pagination page={current} pages={pages} onChange={setPage} />
                </footer>
              )}
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function MrRow({ m }: { m: RequestMR }) {
  const now = useNow();
  const a = MR_ACTION[m.action] ?? { label: m.action, Icon: IconGitCommit, tint: "slate" };
  const s =
    MR_STATUS[m.mr_status] ?? { label: m.mr_status, className: "bg-slate-100 text-slate-600", Icon: IconGitPullRequest };
  return (
    <li>
      <a
        data-timeline-row
        href={safeHref(m.mr_url)}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 outline-none transition-colors hover:border-brand-300 hover:bg-brand-50/50 focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tints[a.tint]}`}>
          <a.Icon size={16} stroke={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-slate-800">{a.label}</span>
            <span className="shrink-0 text-xs text-slate-400">!{m.mr_iid}</span>
          </div>
          <div className="text-xs text-slate-400" title={fmtDateTime(m.created_at)}>
            {fmtRelative(m.created_at, now)}
          </div>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.className}`}>
          <s.Icon size={12} stroke={2} />
          {s.label}
        </span>
        <IconExternalLink
          size={16}
          stroke={1.8}
          className="shrink-0 text-slate-300 transition-colors group-hover:text-brand-500"
        />
      </a>
    </li>
  );
}

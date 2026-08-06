// Shared presentational pieces of the request (product) detail page (RequestDetailPage):
// detail actions, tabs, fields, history, the raw-values modal and date formatting.
// Kept as a separate module so the page component stays focused on data flow.
import { useEffect, useLayoutEffect, useState } from "react";
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
  IconArrowRight,
  IconChevronLeft,
  IconChevronRight,
  IconCircleX,
  IconDotsVertical,
  IconExternalLink,
  IconFileCode,
  IconForms,
  IconAlertTriangle,
  IconGitFork,
  IconGitMerge,
  IconHistory,
  IconPencil,
  IconRefresh,
  IconSparkles,
  IconTrash,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import { Card, Checkbox } from "../../components/ui";
import { useUser } from "../../auth/UserContext";
import { safeHref } from "../../lib/href";
import { DAY_H, DAY_SEP, paginate, ROW_H } from "./timelineLayout";
import { statusMeta } from "../../components/StatusBadge";
import { useTheme } from "../../app/ThemeContext";
import { productTabs } from "../../components/products/genericView";
import {
  GenericInfoActions,
  GenericListTab,
  type PersistValues,
} from "../../components/products/GenericProductTabs";
import type {
  OrderRequest,
  RequestDetail,
  RequestEvent,
  RequestMR,
  RequestStatus,
  ViewDocument,
} from "../../api/types";

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
  draft_created: { label: "Черновик создан", Icon: IconPencil, tint: "slate" },
  created: { label: "Заказ создан", Icon: IconSparkles, tint: "indigo" },
  draft_updated: { label: "Черновик изменён", Icon: IconPencil, tint: "slate" },
  renamed: { label: "Заказ переименован", Icon: IconForms, tint: "slate" },
  draft_discarded: { label: "Черновик удалён", Icon: IconTrash, tint: "slate" },
  sync_forced: { label: "Запрошена синхронизация", Icon: IconRefresh, tint: "blue" },
  deleted: { label: "Заказ удалён", Icon: IconCircleX, tint: "rose" },
  drift_detected: { label: "Заказ изменили в обход портала", Icon: IconAlertTriangle, tint: "amber" },
  drift_cleared: { label: "Расхождение с Git устранено", Icon: IconGitMerge, tint: "emerald" },
  git_pulled: { label: "Заказ обновлён из Git", Icon: IconGitFork, tint: "sky" },
  imported: { label: "Заказ импортирован из Git", Icon: IconGitFork, tint: "sky" },
};

// What a status change means, phrased as an event. StatusBadge keeps its own
// wording on purpose: a badge answers "where is the order now", a timeline row
// answers "what happened to it".
const STATUS_EVENT: Record<string, string> = {
  DRAFT: "Черновик создан",
  MR_CREATED: "Заказ отправлен на согласование",
  MR_MERGED: "Заказ согласован",
  MR_CLOSED: "Согласование отклонено",
  DEPLOYING: "Заказ разворачивается",
  HEALTHY: "Заказ развёрнут",
  DEGRADED: "Заказ работает с ошибками",
  ARGO_MISSING: "Заказ не найден в кластере",
  DELETE_REQUESTED: "Запрошено удаление заказа",
  DELETE_MR_MERGED: "Удаление согласовано",
  DELETED: "Заказ удалён",
};

// One merge request is opened per action, and its action says which action that
// was. That is the difference between an edit and a first order, which the
// status alone cannot tell apart - both are the same FSM edge into MR_CREATED.
// A first order says it went for approval, because the row above it already
// said it was created; an edit has no such row and names itself.
const MR_ACTION_EVENT: Record<string, string> = {
  create: "Заказ отправлен на согласование",
  update: "Заказ отредактирован",
  delete: "Запрошено удаление заказа",
};

// What the person who ordered the service needs: their own actions, and what
// became of the service. Everything else is the pipeline talking to itself -
// the row it writes when it picks the work up, the intermediate states it
// passes through on the way to a result, the draft saved on every edit. Those
// stay in the trail and appear under "Подробно", which is for whoever is
// working out why an order is where it is.
const NOTABLE_EVENTS = new Set([
  "created",
  "draft_created",
  "draft_discarded",
  "renamed",
  "deleted",
  "drift_detected",
]);
const NOTABLE_STATUSES = new Set([
  "MR_CREATED",
  "DELETE_REQUESTED",
  "MR_CLOSED",
  "DEPLOYING",
  "HEALTHY",
  "DEGRADED",
  "ARGO_MISSING",
  "DELETED",
]);

function isNotable(e: RequestEvent): boolean {
  if (e.event_type === "status_changed") return NOTABLE_STATUSES.has(e.to_status ?? "");
  return NOTABLE_EVENTS.has(e.event_type);
}

function eventLabel(e: TimelineEvent): string {
  if (e.event_type === "status_changed") {
    const to = e.to_status ?? "";
    // An order going for approval is named by what was asked for, not by the
    // state it entered: "Заказ отредактирован" is the event, MR_CREATED is the
    // machinery behind it.
    if ((to === "MR_CREATED" || to === "DELETE_REQUESTED") && e.mr) {
      return MR_ACTION_EVENT[e.mr.action] ?? STATUS_EVENT[to];
    }
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
    // The tab strip stays put and the panel under it takes the rest of the
    // column, so each tab scrolls inside itself instead of scrolling the page
    // out from under its own header. The history tab needs it for a different
    // reason: it pages rather than scrolls, and paging needs a known height.
    <Tabs
      selectedKey={active}
      onSelectionChange={(key) => setActive(String(key))}
      className="flex min-h-0 flex-1 flex-col"
    >
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

      <TabPanel id="info" className="scroll-slim min-h-0 flex-1 overflow-y-auto pt-5 outline-none">
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
        <TabPanel
          key={t.id}
          id={t.id}
          className="scroll-slim min-h-0 flex-1 overflow-y-auto pt-5 outline-none"
        >
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
      {/* The history does not scroll: from lg up it fills the column to the
          bottom of the window and pages through itself. Narrower than that the
          card keeps its own minimum height and the panel scrolls like any other
          tab, because a page of two rows is not a page. */}
      <TabPanel
        id="history"
        className="scroll-slim min-h-0 flex-1 overflow-y-auto pb-1 pt-5 outline-none lg:overflow-hidden"
      >
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
  const named = (e: RequestEvent) =>
    e.actor_name || e.actor !== request.created_by ? e : { ...e, actor_name: request.created_by_name };
  const evts = [...events].sort((a, b) => b.id - a.id).map(named).map((e) => withMR(e, mrs));
  return <TimelineCard events={evts} />;
}

// Every merge request an order ever opened is already a moment in its history:
// the row that says it went for approval, and the row that says the approval
// went through. So the link belongs on those rows rather than in a list beside
// them, which repeated the same events in a second vocabulary and left the
// reader matching one against the other.
//
// Which merge request a row is about is not a guess: an order opens one at a
// time (a second is refused while one is open), and the row's own moment picks
// it - the last one opened at or before it. The rows that are not about a merge
// request get nothing.
const MR_STATUSES = new Set([
  "MR_CREATED",
  "DELETE_REQUESTED",
  "MR_MERGED",
  "MR_CLOSED",
  "DELETE_MR_MERGED",
]);

function withMR(e: RequestEvent, mrs: RequestMR[]): TimelineEvent {
  if (e.event_type !== "status_changed" || !MR_STATUSES.has(e.to_status ?? "")) return e;
  const at = +new Date(e.created_at);
  let found: RequestMR | undefined;
  for (const m of mrs) {
    const t = +new Date(m.created_at);
    if (t <= at && (!found || t > +new Date(found.created_at))) found = m;
  }
  return found ? { ...e, mr: found } : e;
}

type TimelineEvent = RequestEvent & { mr?: RequestMR };

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
    <div className="mb-3 flex shrink-0 items-center gap-2">
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

// The whole history is here, paged rather than scrolled or hidden behind a
// dialog. The card fills the column to the bottom of the window, the list takes
// what is left of the card, and a page is cut to fit that list exactly - as
// many events as it holds, the rest carried to the next page.
//
// The one rule that keeps this honest: the arithmetic reads the layout and
// never writes it. The card's height comes from the page, not from the events,
// so a page can be sized against it without the two chasing each other. That is
// also why the pagination bar keeps its place with a single page - taking it
// away would hand the next measurement room that is about to disappear.
function TimelineCard({ events }: { events: TimelineEvent[] }) {
  const [page, setPage] = useState(1);
  const [back, setBack] = useState(false);
  const now = useNow();
  const { user } = useUser();
  // The full trail is a support tool: it answers "why is this order stuck",
  // which is a question the platform team gets and the person who ordered the
  // service does not ask. So it is theirs to switch on, and it is remembered -
  // whoever works in it works in it all day.
  const canSeeAll = user?.role === "admin" || user?.role === "support";
  const [detailed, setDetailed] = useDetailedHistory(canSeeAll);
  const shown = detailed ? events : events.filter(isNotable);
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const { height, ...metrics } = useBodyMetrics(body);
  const pageList = paginate(shown, height, (e) => dayLabel(e.created_at, now), metrics);
  const pages = pageList.length;
  // A viewport change can shrink the page count under a reader who is on the
  // last page.
  const current = Math.min(page, pages);
  const slice = pageList[current - 1] ?? [];
  const goto = (next: number) => {
    setBack(next < current);
    setPage(next);
  };
  return (
    <Card className="flex min-h-0 flex-col lg:h-full">
      <SectionHeader
        Icon={IconHistory}
        title="Хронология заказа"
        action={
          canSeeAll && (
            <Checkbox
              label="Подробно"
              isSelected={detailed}
              onChange={(v) => {
                setDetailed(v);
                setPage(1); // the rows change under the reader, the page number should not survive it
              }}
              aria-label="Показывать все события заказа"
            />
          )
        }
      />
      {shown.length === 0 ? (
        <EmptyHint>Событий пока нет.</EmptyHint>
      ) : (
        <>
          {/* overflow-hidden, not auto: the page was cut to this height, so a
              scrollbar here would only mean the arithmetic was wrong, and a
              scrollbar next to pagination is two ways through one list.
              min-h keeps the stacked layout readable, where the card has no
              column height to take. */}
          <div ref={setBody} className="min-h-72 flex-1 overflow-hidden lg:min-h-0">
            {/* key restarts the animation on every page change; the direction
                follows the button that was pressed, so the list moves the way
                the pagination does. */}
            <div
              key={current}
              className={`animate-in fade-in duration-200 motion-reduce:animate-none ${
                back ? "slide-in-from-left-3" : "slide-in-from-right-3"
              }`}
            >
              <Timeline items={slice} detailed={detailed} />
            </div>
          </div>
          <CardPagination page={current} pages={pages} onChange={goto} />
        </>
      )}
    </Card>
  );
}

// Remembered across orders and sessions, not per order: it is a way of working,
// not a property of the thing being looked at. Reading is guarded because a
// browser with storage disabled must not take the page down with it.
const DETAILED_KEY = "order-history-detailed";

function useDetailedHistory(enabled: boolean): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(DETAILED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const set = (v: boolean) => {
    setOn(v);
    try {
      localStorage.setItem(DETAILED_KEY, v ? "1" : "0");
    } catch {
      /* no storage - the choice just does not survive a reload */
    }
  };
  return [enabled && on, set];
}

// The pagination bar of a card: a rule across the card's width, the controls
// under it. It stays in the layout with a single page so the list above it is
// measured against the room it will actually keep.
function CardPagination({
  page,
  pages,
  onChange,
}: {
  page: number;
  pages: number;
  onChange: (p: number) => void;
}) {
  return (
    <div
      aria-hidden={pages < 2}
      className={`-mx-4 mt-3 shrink-0 border-t border-slate-200 px-4 pt-3 ${
        pages < 2 ? "invisible" : ""
      }`}
    >
      <Pagination page={page} pages={pages} onChange={onChange} />
    </div>
  );
}

// useBodyMetrics reports how much room a card body has and how tall its rows
// actually render. Content-box height (clientHeight minus the padding the
// browser computed) rather than a hardcoded inset, and row heights read off the
// DOM rather than assumed - together that is the difference between a page that
// fills the dialog and one that stops two rows short.
//
// The measurement is only trustworthy because the dialog it measures cannot be
// moved by what the measurement produces: the dialog is always the same height
// and the footer is always standing, so the body has the same room whether the
// history is two events or two hundred. Anything else feeds back - size a page
// to a body measured without the footer, and the footer then appears and pushes
// those rows out of the dialog. That is why this only reads the layout and
// never writes it, and why a ResizeObserver can be left running: it fires when
// the window changes and stays quiet otherwise.
function useBodyMetrics(body: HTMLDivElement | null) {
  const [m, setM] = useState({ height: 0, rowH: ROW_H, dayH: DAY_H, daySep: DAY_SEP });
  // Layout effect, not effect: the first pass renders a fallback page that is
  // the wrong size by definition, and it must never reach the screen.
  useLayoutEffect(() => {
    if (!body) return;
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
      const day = body.querySelector<HTMLElement>("[data-timeline-day]");
      const dayCs = day && getComputedStyle(day);
      // The gap between day groups is read off a heading that has one - the
      // heading opening a page has no gap above it and would report zero.
      const sep = body.querySelector<HTMLElement>("[data-timeline-sep]");
      const sepCs = sep && getComputedStyle(sep);
      setM((prev) => {
        const next = {
          height,
          rowH: row?.offsetHeight || prev.rowH,
          dayH: dayCs ? day.offsetHeight + Number.parseFloat(dayCs.marginBottom) : prev.dayH,
          daySep: sepCs ? Number.parseFloat(sepCs.marginTop) : prev.daySep,
        };
        const same =
          next.height === prev.height &&
          next.rowH === prev.rowH &&
          next.dayH === prev.dayH &&
          next.daySep === prev.daySep;
        return same ? prev : next;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    return () => ro.disconnect();
  }, [body]);
  return m;
}

// The history is grouped by day. Which day something happened is the one
// ordering fact that is always true, unlike "this change led to that one",
// which the portal cannot know: an order carries no link between an edit and
// the deployment that followed it, so any such grouping would be a guess
// dressed up as a fact.
function Timeline({ items, detailed }: { items: TimelineEvent[]; detailed?: boolean }) {
  const now = useNow();
  let lastDay = "";
  return (
    <ol className="flex flex-col">
      {items.map((e, i) => {
        const day = dayLabel(e.created_at, now);
        const openDay = day !== lastDay;
        // The gap above a day belongs to the days after the first one: the
        // first sits right under the top padding and needs nothing. It cannot
        // be a `first:` rule - every heading is the first child of its own row,
        // so the rule would fire on all of them (and did, which is why the days
        // used to run together). The separation is also priced per page in
        // paginate, so it has to be decided here, not in CSS.
        const sep = openDay && lastDay !== "";
        lastDay = day;
        return (
          <li key={e.id}>
            {openDay && (
              <div
                data-timeline-day
                data-timeline-sep={sep ? "" : undefined}
                className={`mb-1.5 flex items-center gap-3 px-3 ${sep ? "mt-3" : ""}`}
              >
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {day}
                </span>
                <span className="h-px flex-1 bg-slate-100" aria-hidden />
              </div>
            )}
            <TimelineRow e={e} now={now} alt={i % 2 === 1} detailed={detailed} />
          </li>
        );
      })}
    </ol>
  );
}

// One event, one line: what happened, who did it, when, and - when the event is
// about one - the merge request it went through. The FSM edge behind the row is
// shown only under "Подробно": a person reading their order's history wants the
// event, not the state machine.
//
// The banding is per row, not per day, so it survives a page break in the
// middle of a day; it is what carries the eye across a wide row from the label
// on the left to the time on the right. Hover is a step darker than the band so
// the row under the pointer reads on both the light and the dark stripe.
//
// The padding is plain, with no negative margin against it: the band keeps the
// width the card gives it and the row moves inward, which is the point - the
// icon and the time need room between them and the edge of their own stripe.
function TimelineRow({
  e,
  now,
  alt,
  detailed,
}: {
  e: TimelineEvent;
  now: number;
  alt: boolean;
  detailed?: boolean;
}) {
  const isStatus = e.event_type === "status_changed";
  const sMeta = e.to_status ? statusMeta(e.to_status) : null;
  const meta = EVENT_META[e.event_type];
  const circle = isStatus && sMeta ? sMeta.badge : tints[meta?.tint ?? "slate"];
  const Icon = (isStatus && sMeta ? (sMeta.staticIcon ?? sMeta.Icon) : meta?.Icon) ?? IconHistory;
  return (
    <div
      data-timeline-row
      className={`flex items-center gap-3 rounded-md px-3 py-1.5 transition-colors hover:bg-slate-100 ${
        alt ? "bg-slate-50" : ""
      }`}
    >
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${circle}`}>
        <Icon size={14} stroke={1.8} />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{eventLabel(e)}</span>
      {detailed && isStatus && <StatusEdge from={e.from_status} to={e.to_status} />}
      {/* A chip, not a link in a sentence: it is a destination sitting at the
          end of a row, so it carries its own outline and lifts on hover. The
          underline is what a link inside running text needs to be found - here
          it would only add a line across an already busy row. */}
      {e.mr && (
        <a
          href={safeHref(e.mr.mr_url)}
          target="_blank"
          rel="noopener noreferrer"
          title="Открыть запрос на слияние в GitLab"
          className="flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-surface px-1.5 py-0.5 text-xs font-medium text-slate-500 no-underline outline-none transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <IconGitMerge size={13} stroke={1.8} />
          {e.mr.mr_iid}
        </a>
      )}
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

// The FSM edge the row rode in on, for the "Подробно" view: which state the
// order left and which it entered. Icons rather than the status names - the row
// already says in words what happened, and two more phrases would bury it.
// Each carries its name in the tooltip.
function StatusEdge({ from, to }: { from?: RequestStatus; to?: RequestStatus }) {
  if (!to) return null;
  return (
    <span className="flex shrink-0 items-center gap-1" aria-hidden>
      {from && from !== to && (
        <>
          <StatusDot status={from} muted />
          <IconArrowRight size={12} stroke={2} className="text-slate-300" />
        </>
      )}
      <StatusDot status={to} />
    </span>
  );
}

function StatusDot({ status, muted = false }: { status: RequestStatus; muted?: boolean }) {
  const m = statusMeta(status);
  const Icon = m.staticIcon ?? m.Icon;
  return (
    <span
      title={m.label}
      className={`flex h-5 w-5 items-center justify-center rounded-full ${m.badge} ${
        muted ? "opacity-50" : ""
      }`}
    >
      <Icon size={12} stroke={1.8} />
    </span>
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


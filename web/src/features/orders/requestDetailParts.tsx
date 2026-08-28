// Shared presentational pieces of the request (product) detail page (RequestDetailPage):
// detail actions, tabs, fields, history, the raw-values modal and date formatting.
// Kept as a separate module so the page component stays focused on data flow.

import Editor from "@monaco-editor/react";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconChevronLeft,
  IconChevronRight,
  IconCircleX,
  IconDotsVertical,
  IconExternalLink,
  IconFileCode,
  IconForms,
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
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import type {
  OrderRequest,
  RequestDetail,
  RequestEvent,
  RequestMR,
  RequestStatus,
  ViewDocument,
} from "@/api/types";
import { chartLabel } from "@/app/CatalogContext";
import { useTheme } from "@/app/ThemeContext";
import { isPlatformStaff, useUser } from "@/auth/UserContext";
import {
  GenericInfoActions,
  GenericListTab,
  type PersistValues,
} from "@/components/products/GenericProductTabs";
import { productTabs } from "@/components/products/genericView";
import { statusMeta, statusTitle } from "@/components/StatusBadge";
import { buttonClass, Card, Checkbox } from "@/components/ui";
import { orderNamespace } from "@/form/namespace";
import { useMatchMedia } from "@/hooks/useMatchMedia";
import { safeHref } from "@/lib/href";
import { dayLabel, fmtDateTime, fmtRelative } from "@/lib/time";
import { mergeBlockReason } from "./mergeBlock";
import { OrderGraphDialog } from "./OrderGraphDialog";
import { graphFor } from "./orderGraph";
import { DAY_H, DAY_SEP, paginate, ROW_H } from "./timelineLayout";

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

// One fact about the order, a term and its description. The label is set in caps
// with the tracking that caps needs to stay readable, and a step darker than the
// grey it used to be - small grey text on white did not carry enough contrast to
// be read, only enough to be seen.
function Field({ label, value, href }: { label: string; value: string; href?: string }) {
  const safe = safeHref(href);
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-slate-800" title={value || undefined}>
        {safe && value ? (
          <a
            href={safe}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex max-w-full items-center gap-1 text-brand-600 hover:text-brand-700 hover:underline"
          >
            <span className="truncate">{value}</span>
            <IconExternalLink
              size={14}
              stroke={1.8}
              className="shrink-0 text-brand-400 group-hover:text-brand-600"
            />
          </a>
        ) : (
          value || "-"
        )}
      </dd>
    </div>
  );
}

// The facts, three to a row. No icons beside them: an icon earns its place where
// it replaces a label (a status circle in the timeline) or tells apart rows that
// look alike - here every field is already named in words next to it, so an icon
// would repeat the label six times over.
function Fields({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">{children}</dl>;
}

// The platform's own bookkeeping, folded away: which chart the service came from,
// which application deploys it, the values behind it. It opens in place, the same
// grid 0fr -> 1fr as the sidebar sections (see NavSection in Layout) - built by
// hand rather than on react-aria's Disclosure because that one hides the panel
// with the `hidden` attribute, and no transition can touch display: none.
function MoreDetails({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-slate-100 pt-2">
      <AriaButton
        onPress={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="-mx-1 flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-1 text-sm font-medium text-slate-500 outline-none transition-colors hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <IconChevronRight
          size={16}
          stroke={1.8}
          className={`shrink-0 text-slate-400 transition-transform duration-200 motion-reduce:transition-none ${
            open ? "rotate-90" : ""
          }`}
        />
        Подробнее
      </AriaButton>
      {/* visibility rides the same transition: it flips to visible as the panel
          starts opening and back to hidden only once it has closed, so folded
          fields stay out of the tab order without cutting the animation short. */}
      <div
        className={`grid transition-[grid-template-rows,visibility] duration-200 ease-out motion-reduce:transition-none ${
          open ? "visible grid-rows-[1fr]" : "invisible grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">{children}</div>
      </div>
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

// ValuesModalButton opens the order's configuration, read-only, in a centered
// modal. One word on the trigger: a file name on a product page reads as a
// debugging tool, and a verb ("Показать конфигурацию") made the button the widest
// thing in the card. The word names what the button leads to, which is all a
// button in a group of quiet fields has to do; the file name waits in the
// dialog's own header, for the reader who is looking for exactly that.
function ValuesModalButton({ request: r }: { request: RequestDetail["request"] }) {
  const { theme } = useTheme();
  return (
    <DialogTrigger>
      <AriaButton className={buttonClass("secondary", "shrink-0 cursor-pointer")}>
        <IconFileCode size={16} stroke={1.8} className="text-slate-400" />
        Конфигурация
      </AriaButton>
      <ModalOverlay className="fixed inset-0 z-50 flex items-center justify-center scrim p-4 entering:animate-in entering:fade-in">
        <Modal className="w-full max-w-3xl rounded-lg bg-surface shadow-xl outline-none entering:animate-in entering:zoom-in-95">
          <Dialog className="outline-none">
            {({ close }) => (
              <div className="flex flex-col">
                <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <h2 className="text-sm font-semibold text-gray-700">Конфигурация сервиса</h2>
                    <span className="truncate text-xs text-slate-400">values.yaml</span>
                  </div>
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
  merge_blocked: {
    label: "Изменение не удалось применить автоматически",
    Icon: IconAlertTriangle,
    tint: "amber",
  },
};

// What a status change means, phrased as an event. StatusBadge keeps its own
// wording on purpose: a badge answers "where is the order now", a timeline row
// answers "what happened to it".
//
// No row here promises an approval. Most services are merged by the portal with
// nobody reading anything, so "отправлен на согласование" described a wait that
// was not happening and named a decision nobody was going to take. Where a
// person really does read the change, the order page says so while the change is
// in flight (RequestDetailPage) - which is when it can be said truthfully, since
// a row of the history outlives the wait it would be describing.
const STATUS_EVENT: Record<string, string> = {
  DRAFT: "Черновик создан",
  MR_CREATED: "Заказ отправлен",
  MR_MERGED: "Изменение применено",
  MR_CLOSED: "Заказ отклонён",
  DEPLOYING: "Заказ разворачивается",
  HEALTHY: "Заказ развёрнут",
  DEGRADED: "Заказ работает с ошибками",
  ARGO_MISSING: "Заказ не найден в кластере",
  DELETE_REQUESTED: "Запрошено удаление заказа",
  DELETE_MR_MERGED: "Удаление применено",
  DELETED: "Заказ удалён",
};

// One merge request is opened per action, and its action says which action that
// was. That is the difference between an edit and a first order, which the
// status alone cannot tell apart - both are the same FSM edge into MR_CREATED.
// A first order says it was sent, because the row above it already said it was
// created; an edit has no such row and names itself.
const MR_ACTION_EVENT: Record<string, string> = {
  create: "Заказ отправлен",
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
  "merge_blocked",
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
  const label = EVENT_META[e.event_type]?.label ?? e.event_type;
  if (e.event_type === "merge_blocked") {
    const why = mergeBlockReason(String(e.payload?.reason ?? ""));
    return why ? `${label}: ${why}` : label;
  }
  return label;
}

// ProductView is the view-driven body of the product (order) page: the tab strip
// (Info + one tab per product view + Activity history) and the panels under it.
// It is shared by RequestDetailPage (live order, writes via the API) and the
// chart-manage preview (synthetic order, writes to local state via `persist` and
// uses the in-editor `schema`), so both render identically.
export function ProductView({
  request: r,
  doc,
  events = [],
  mrs = [],
  argocdUrl,
  modifiable,
  openMR,
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
  // The change currently in flight, if any: the graph reads it to say why it
  // cannot be drawn on, instead of letting a save fail against it.
  openMR?: RequestMR | null;
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
      <TabList
        aria-label="Разделы заказа"
        className="flex flex-wrap gap-1 border-b border-gray-200"
      >
        <DetailTab id="info">Общая информация</DetailTab>
        {tabs.map((t) => (
          <DetailTab key={t.id} id={t.id}>
            {t.title ?? t.id}
          </DetailTab>
        ))}
        <DetailTab id="history">История действий</DetailTab>
      </TabList>

      <TabPanel id="info" className="min-h-0 flex-1 overflow-y-auto pt-5 outline-none">
        <InfoTab
          request={r}
          argocdUrl={argocdUrl}
          modifiable={modifiable}
          openMR={openMR}
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
          className="min-h-0 flex-1 overflow-y-auto pt-5 outline-none"
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
      {/* The history does not scroll from lg up: the card takes the height its
          events ask for, and once they would run past the bottom of the window
          it pages through itself instead. Narrower than that the panel scrolls
          like any other tab. */}
      <TabPanel
        id="history"
        className="min-h-0 flex-1 overflow-y-auto pt-5 outline-none lg:overflow-hidden"
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
  openMR,
  doc,
  onChanged,
  schema,
  persist,
}: {
  request: OrderRequest;
  argocdUrl?: string;
  modifiable: boolean;
  openMR?: RequestMR | null;
  doc: ViewDocument;
  onChanged: () => void;
  schema?: Record<string, any>;
  persist?: PersistValues;
}) {
  // The graph of this version, when it declares one. Its button sits beside the
  // actions rather than inside them: the actions menu is for people who may
  // change the service, and the graph is the fastest answer to "what talks to
  // what" for everyone else - auditors and security included.
  const graph = graphFor(doc);
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Общая информация</h2>
        <div className="flex shrink-0 items-center gap-2">
          {graph && (
            <OrderGraphDialog
              request={r}
              doc={doc}
              editor={graph}
              modifiable={modifiable}
              openMR={openMR}
              reload={onChanged}
              persist={persist}
            />
          )}
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
      </div>
      {/* Six facts about the service itself, in the order they are asked for:
          what it is, then where it runs. What is left over is the platform's own
          bookkeeping - the chart it came from, the application that deploys it,
          the values behind it - and it waits under "Подробнее" instead of sitting
          between the service name and its namespace as an equal. */}
      <Fields>
        <Field label="Имя сервиса" value={r.service_name} />
        <Field label="Продукт" value={chartLabel(r.chart_name)} />
        <Field label="Версия" value={r.chart_version} />
        <Field label="Команда" value={r.team} />
        <Field label="Кластер" value={r.cluster} />
        <Field label="Namespace" value={orderNamespace(r)} />
      </Fields>
      <MoreDetails>
        <div className="flex flex-col items-start gap-3 pt-2">
          <Fields>
            <Field label="Чарт" value={`${r.chart_project}/${r.chart_name}`} />
            <Field label="Приложение в ArgoCD" value={r.argocd_app_name} href={argocdUrl} />
          </Fields>
          <ValuesModalButton request={r} />
        </div>
      </MoreDetails>
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
// dialog. The card is as tall as its events; when they would run past the bottom
// of the window it stops there, and what did not fit moves to the next page.
//
// The one rule that keeps this honest: the arithmetic reads the layout and
// never writes it. A page is measured against the slot around the card, which
// holds the column height whatever the card does - so the card is free to
// shrink to its content without the measurement following it down and cutting
// the page a second time. Once the events do not fit, the card takes the whole
// column again: a page that shrank to its last two rows would move the ground
// under the reader on the way there.
function TimelineCard({ events }: { events: TimelineEvent[] }) {
  const [page, setPage] = useState(1);
  const [back, setBack] = useState(false);
  const now = useNow();
  const { user } = useUser();
  // The full trail is a support tool: it answers "why is this order stuck",
  // which is a question the platform team gets and the person who ordered the
  // service does not ask. So it is theirs to switch on, and it is remembered -
  // whoever works in it works in it all day.
  const canSeeAll = isPlatformStaff(user);
  const [detailed, setDetailed] = useDetailedHistory(canSeeAll);
  const shown = detailed ? events : events.filter(isNotable);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  const paged = useMatchMedia(PAGED_FROM);
  const { height, ...metrics } = useBodyMetrics({ slot, body, bar, paged });
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
    <div ref={setSlot} className="flex min-h-0 flex-col lg:h-full">
      <Card className={`flex min-h-0 flex-col lg:max-h-full ${pages > 1 ? "lg:h-full" : ""}`}>
        <SectionHeader
          Icon={IconHistory}
          title="История действий"
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
                scrollbar next to pagination is two ways through one list. */}
            <div ref={setBody} className="min-h-0 flex-1 overflow-hidden">
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
            {pages > 1 && (
              <CardPagination page={current} pages={pages} onChange={goto} barRef={setBar} />
            )}
          </>
        )}
      </Card>
    </div>
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
// under it. It appears only once there is a second page - with one page there is
// nothing to switch between, and the room it would take belongs to the events.
// Its height is counted in the arithmetic either way (see BAR_H), so the same
// events split the same way whether or not the bar is on screen.
function CardPagination({
  page,
  pages,
  onChange,
  barRef,
}: {
  page: number;
  pages: number;
  onChange: (p: number) => void;
  barRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div ref={barRef} className="-mx-4 mt-3 shrink-0 border-t border-slate-200 px-4 pt-3">
      <Pagination page={page} pages={pages} onChange={onChange} />
    </div>
  );
}

// From this width up the column has a bottom for the card to fit into, so the
// history pages. Below it the panel scrolls and the history is one page however
// long it is - a page of two rows is not a page. Tailwind's lg, kept here as
// well because the split is decided by arithmetic and not by CSS.
const PAGED_FROM = "(min-width: 1024px)";

// The height the pagination bar takes: a first guess, replaced by the measured
// one as soon as there is a bar to measure. It is subtracted whether or not the
// bar is on screen, which is what keeps the split from depending on itself - a
// page sized against a card without the bar would grow just far enough to
// summon the bar, and the bar would then push its last rows out of the card.
const BAR_H = 53; // mt-3 + the rule + pt-3 + a row of controls

// useBodyMetrics reports how much room a page of history has and how tall its
// rows actually render. Row heights are read off the DOM rather than assumed,
// and the room is what is left of the slot once the card's own furniture is
// taken out - the difference between a page that reaches the bottom of the
// column and one that stops two rows short.
//
// The measurement is trustworthy because nothing it produces can move what it
// measures: the slot keeps the column height whether the history is two events
// or two hundred, and the chrome it subtracts (header, padding, bar) is the same
// either way. That is why this only reads the layout and never writes it, and
// why a ResizeObserver can be left running: it fires when the window changes and
// stays quiet otherwise.
function useBodyMetrics({
  slot,
  body,
  bar,
  paged,
}: {
  slot: HTMLDivElement | null;
  body: HTMLDivElement | null;
  bar: HTMLDivElement | null;
  paged: boolean;
}) {
  const [m, setM] = useState({ height: 0, rowH: ROW_H, dayH: DAY_H, daySep: DAY_SEP });
  const barH = useRef(BAR_H);
  // Layout effect, not effect: the first pass renders a fallback page that is
  // the wrong size by definition, and it must never reach the screen.
  useLayoutEffect(() => {
    if (!body) return;
    const measure = () => {
      // With its margin: the gap above the bar disappears with it, so it is part
      // of what a page gets back when there is only one.
      if (bar) {
        barH.current = bar.offsetHeight + Number.parseFloat(getComputedStyle(bar).marginTop);
      }
      // The card is the element the body sits in, so what the two differ by is
      // everything the events do not get: the header, the card's padding and the
      // bar when it is there.
      const card = body.parentElement;
      const height =
        paged && slot && card
          ? slot.clientHeight - (card.offsetHeight - body.offsetHeight) - (bar ? 0 : barH.current)
          : Number.POSITIVE_INFINITY; // nothing to fit into: one page, the panel scrolls
      if (height <= 0) return;
      // offsetHeight, not getBoundingClientRect: a rect measured while the page
      // slides in is read through the transform, and mixing that with the
      // untransformed heights above produces a page size that fits nothing.
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
    // The slot is watched as well as the body: with everything on one page the
    // body is only as tall as the events, so a window that shrinks under them
    // shows up on the slot alone.
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    if (slot) ro.observe(slot);
    return () => ro.disconnect();
  }, [slot, body, bar, paged]);
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
      {/* The merge request the row rode in on, offered with the rest of the
          machinery under "Подробно" - the row already says in words what
          happened, and whoever ordered the service has no use for the change's
          bookkeeping in Git.

          A chip, not a link in a sentence: it is a destination sitting at the
          end of a row, so it carries its own outline and lifts on hover. The
          underline is what a link inside running text needs to be found - here
          it would only add a line across an already busy row. */}
      {detailed && e.mr && (
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
      // Only the detailed history renders these, and its reader is the one
      // person who needs the exact state rather than the group it is shown in.
      title={statusTitle(status, true)}
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


import type { ActivityEvent, AdminBoard, BoardAttention, BoardComponent, BoardWork } from "@/api/types";
import { statusTitle } from "@/components/StatusBadge";
import { standText } from "@/features/stands/text";
import { actionText, personName } from "@/features/users/text";
import { COMPONENT_LABELS, COMPONENT_ROLE, RECONCILERS } from "@/pages/StatusPage";
import { boardText as t } from "./text";

// The board as the page draws it. The server sends codes and facts
// (api/types.ts AdminBoard); this file turns them into titles, the "where" of
// a row and the link to the place where it is fixed. Keeping that in one
// place means the page lays things out and does not decide what they say.

export type Severity = "critical" | "warning";
export type AttentionKind = BoardAttention["kind"];
export type ComponentState = BoardComponent["state"];

export interface SeriesPoint {
  at: string;
  value: number;
}

// One fact about where something is, drawn as an icon and a value: the icon
// says what the value is (a service, a team, a stand), so the line reads
// "kafka-main, data, idp" instead of spelling out "команда" and "стенд".
export type MetaKind = "service" | "team" | "stand" | "person" | "version" | "setting" | "check" | "job" | "time";
export interface Meta {
  kind: MetaKind;
  text: string;
}

export interface AttentionItem {
  id: string;
  severity: Severity;
  kind: AttentionKind;
  title: string;
  meta: Meta[];
  since?: string;
  to: string;
}

export interface PlatformComponent {
  id: string;
  name: string;
  role: string;
  state: ComponentState;
  note: string;
}

export interface BoardEvent {
  id: string;
  at: string;
  kind: "order" | "publication";
  text: string;
  meta: Meta[];
  to: string;
}

export interface InProgressItem {
  id: string;
  kind: "order" | "stand_job";
  title: string;
  meta: Meta[];
  stage: string;
  progress?: { done: number; total: number };
  startedAt: string;
  to: string;
}

export interface QueueItem {
  id: string;
  service: string;
  change: string;
  team: string;
  to: string;
}

export interface BoardTiles {
  orders: { today: number; total: number; series: SeriesPoint[] };
  actions: { today: number; series: SeriesPoint[] };
  users: { today: number; total: number; series: SeriesPoint[] };
  online: { now: number; series: SeriesPoint[] };
}

export interface BoardView {
  generatedAt: string;
  tiles: BoardTiles;
  attention: AttentionItem[];
  components: PlatformComponent[];
  events: BoardEvent[];
  inProgress: InProgressItem[];
  queue: QueueItem[];
}

const m = (kind: MetaKind, text?: string): Meta[] => (text ? [{ kind, text }] : []);

const orderLink = (id?: string) => (id ? `/requests/${id}` : "/admin/requests");
const standLink = (id?: string) => (id ? `/admin/stands/${id}` : "/admin/stands");

// A stand's mode as the stands page names it.
function modeName(mode?: string): string {
  return mode === "git" ? standText.modeGit : mode === "console" ? standText.modeConsole : standText.modeDeploy;
}

function componentName(id?: string): string {
  if (!id) return "";
  return COMPONENT_LABELS[id] ?? t.componentNames[id] ?? id;
}

function attention(a: BoardAttention): AttentionItem {
  const base = { id: a.id, severity: a.severity, kind: a.kind, since: a.since };
  const title = t.attentionCodes[a.code] ?? a.code;
  switch (a.kind) {
    case "order":
      return {
        ...base,
        title,
        meta: [...m("service", a.service), ...m("team", a.team), ...m("stand", a.stand)],
        to: orderLink(a.order_id),
      };
    case "stand":
      return { ...base, title, meta: m("stand", a.stand), to: standLink(a.stand_id) };
    case "integration":
      return { ...base, title: t.componentDown(componentName(a.component)), meta: [], to: "/admin/status" };
    case "job":
      return {
        ...base,
        title,
        meta: m("job", RECONCILERS[a.job ?? ""]?.label ?? a.job),
        to: "/admin/status",
      };
    case "config":
      return {
        ...base,
        title,
        meta: (a.variables?.length ? a.variables : [componentName(a.component)]).map((v) => ({ kind: "setting", text: v })),
        to: "/admin/config",
      };
    case "maintenance":
      return { ...base, title, meta: m("time", a.until && t.maintenanceWhen(a.code, a.until)), to: "/admin/maintenance" };
    default:
      return { ...base, title, meta: [], to: "/admin" };
  }
}

function component(c: BoardComponent): PlatformComponent {
  const ok = c.state === "ok";
  return {
    id: c.id,
    name: componentName(c.id),
    role: COMPONENT_ROLE[c.id] ?? t.componentRoles[c.id] ?? "",
    state: c.state,
    note: ok ? (t.componentOk[c.id] ?? t.componentOkDefault) : t.componentDownNote,
  };
}

function work(w: BoardWork, i: number): InProgressItem {
  if (w.kind === "stand_job") {
    return {
      id: `job:${w.stand_id}:${i}`,
      kind: "stand_job",
      title: w.job_kind === "delete" ? t.jobDelete : t.jobModeChange(modeName(w.to_mode)),
      meta: [...m("stand", w.stand), ...m("person", w.by)],
      stage: w.job_kind === "delete" ? t.jobDeleteStage : t.jobModeChangeStage,
      progress: w.total ? { done: w.done ?? 0, total: w.total } : undefined,
      startedAt: w.since,
      to: standLink(w.stand_id),
    };
  }
  return {
    id: `order:${w.order_id}`,
    kind: "order",
    title: w.service ?? "",
    meta: [...m("team", w.team), ...m("stand", w.stand)],
    // The same words the order's own badge uses, so the board and the order
    // page cannot name one state two ways.
    stage: statusTitle(w.status ?? ""),
    startedAt: w.since,
    to: orderLink(w.order_id),
  };
}

function event(e: ActivityEvent): BoardEvent {
  const who = personName(e.actor_name, t.someone);
  const to =
    e.source === "order" ? orderLink(e.subject_id) : e.title.includes("/") ? `/admin/approvals/${e.title}` : "/admin/approvals";
  return {
    id: `${e.source}:${e.subject_id}:${e.at}:${e.event_type}`,
    at: e.at,
    kind: e.source,
    text: `${who} ${actionText(e)}`,
    meta: [...m(e.source === "order" ? "service" : "version", e.title), ...m("team", e.team)],
    to,
  };
}

export function toView(b: AdminBoard): BoardView {
  return {
    generatedAt: b.generated_at,
    tiles: {
      orders: { today: b.tiles.orders.value, total: b.tiles.orders.total ?? 0, series: b.tiles.orders.series },
      actions: { today: b.tiles.actions.value, series: b.tiles.actions.series },
      users: { today: b.tiles.users.value, total: b.tiles.users.total ?? 0, series: b.tiles.users.series },
      online: { now: b.tiles.online.value, series: b.tiles.online.series },
    },
    attention: b.attention.map(attention),
    components: b.components.map(component),
    events: b.events.map(event),
    inProgress: b.in_progress.map(work),
    queue: b.queue.map((q) => ({
      id: `${q.kind}:${q.publication_id}:${q.version ?? ""}`,
      service: q.version ? `${q.chart_name} ${q.version}` : q.chart_name,
      change: q.kind === "version" ? t.queueNewVersion : t.queueMetadata,
      team: q.team,
      to: q.version
        ? `/admin/approvals/${q.chart_project}/${q.chart_name}/${q.version}`
        : `/admin/approvals/${q.chart_project}/${q.chart_name}`,
    })),
  };
}

// Demo data for the admin redesign concept. Nothing here comes from the
// backend: the shapes follow what the portal already stores (request_events,
// publication_events, stand_jobs, /api/v1/status) plus the records a full
// audit trail would add, so wiring a page to a real endpoint later replaces
// this module and not the page. All wording lives in ./text.

export type Severity = "critical" | "major" | "minor";
export type IncidentState = "open" | "taken" | "resolved";
export type IncidentKind = "order" | "integration" | "stand" | "loop";

// Something the on-call admin can do about a problem. Ids are stable: the text
// module words them, the page decides which are wired today and which need a
// new endpoint (see ACTION_NEEDS_BACKEND).
export type ActionId =
  | "sync"
  | "retry_merge"
  | "withdraw_change"
  | "git_pull"
  | "open_order"
  | "open_mr"
  | "open_argo"
  | "recheck"
  | "run_checks"
  | "test_webhook"
  | "open_stand"
  | "stop_job"
  | "retry_failed"
  | "run_loop"
  | "open_grafana";

// Actions the portal cannot perform yet: the concept shows them so the gap is
// visible, and the page marks them as such.
export const ACTION_NEEDS_BACKEND: ReadonlySet<ActionId> = new Set<ActionId>([
  "retry_merge",
  "retry_failed",
  "run_loop",
]);

export interface TimelineEntry {
  min: number; // minutes ago
  actor?: string; // a person; absent means the portal itself
  code: string; // event code, worded by text.timelineText
}

export interface Incident {
  id: string;
  kind: IncidentKind;
  severity: Severity;
  state: IncidentState;
  min: number; // open for, minutes
  team?: string;
  service?: string;
  orderId?: string;
  orderStatus?: string;
  stand?: string;
  owner?: string;
  actions: ActionId[];
  timeline: TimelineEntry[];
}

export const PEOPLE = {
  oncall: "Иван Петров",
  anna: "Анна Смирнова",
  oleg: "Олег Козлов",
  maria: "Мария Орлова",
  dmitry: "Дмитрий Волков",
} as const;

export const INCIDENTS: Incident[] = [
  {
    id: "payments-degraded",
    kind: "order",
    severity: "critical",
    state: "open",
    min: 18,
    team: "payments",
    service: "payments-api",
    orderId: "r-1042",
    orderStatus: "DEGRADED",
    stand: "prod",
    actions: ["sync", "open_argo", "open_order"],
    timeline: [
      { min: 18, code: "degraded" },
      { min: 19, code: "sync_ok" },
      { min: 24, actor: PEOPLE.anna, code: "updated" },
    ],
  },
  {
    id: "harbor-slow",
    kind: "integration",
    severity: "critical",
    state: "taken",
    min: 34,
    owner: PEOPLE.oncall,
    actions: ["recheck", "open_grafana"],
    timeline: [
      { min: 6, actor: PEOPLE.oncall, code: "taken" },
      { min: 21, code: "probe_timeout" },
      { min: 34, code: "probe_slow" },
    ],
  },
  {
    id: "billing-merge-blocked",
    kind: "order",
    severity: "major",
    state: "open",
    min: 42,
    team: "billing",
    service: "billing-db",
    orderId: "r-0988",
    orderStatus: "MR_CREATED",
    stand: "prod",
    actions: ["retry_merge", "open_mr", "withdraw_change"],
    timeline: [
      { min: 42, code: "merge_blocked" },
      { min: 44, code: "merge_retried" },
      { min: 47, actor: PEOPLE.oleg, code: "updated" },
    ],
  },
  {
    id: "search-argo-missing",
    kind: "order",
    severity: "major",
    state: "open",
    min: 65,
    team: "search",
    service: "search-gateway",
    orderId: "r-1011",
    orderStatus: "ARGO_MISSING",
    stand: "stage",
    actions: ["sync", "open_order"],
    timeline: [
      { min: 65, code: "argo_missing" },
      { min: 70, code: "mr_merged" },
    ],
  },
  {
    id: "dev-job-failures",
    kind: "stand",
    severity: "major",
    state: "open",
    min: 51,
    stand: "dev",
    actions: ["retry_failed", "stop_job", "open_stand"],
    timeline: [
      { min: 51, code: "job_failures" },
      { min: 58, actor: PEOPLE.maria, code: "job_started" },
    ],
  },
  {
    id: "web-drift",
    kind: "order",
    severity: "minor",
    state: "open",
    min: 130,
    team: "web",
    service: "web-front",
    orderId: "r-0954",
    orderStatus: "HEALTHY",
    stand: "prod",
    actions: ["git_pull", "sync", "open_order"],
    timeline: [{ min: 130, code: "drift" }],
  },
  {
    id: "legacy-delete-stuck",
    kind: "order",
    severity: "minor",
    state: "open",
    min: 190,
    team: "platform",
    service: "legacy-cache",
    orderId: "r-0731",
    orderStatus: "DELETE_REQUESTED",
    stand: "stage",
    actions: ["open_mr", "open_order"],
    timeline: [
      { min: 190, actor: PEOPLE.dmitry, code: "delete_requested" },
    ],
  },
  {
    id: "gitlab-webhook",
    kind: "integration",
    severity: "minor",
    state: "open",
    min: 240,
    actions: ["run_checks", "test_webhook"],
    timeline: [{ min: 240, code: "check_failed" }],
  },
  {
    id: "discovery-loop",
    kind: "loop",
    severity: "minor",
    state: "taken",
    min: 95,
    owner: PEOPLE.oncall,
    actions: ["run_loop", "open_grafana"],
    timeline: [
      { min: 12, actor: PEOPLE.oncall, code: "taken" },
      { min: 95, code: "loop_error" },
    ],
  },
  {
    id: "stage-argo-unwired",
    kind: "stand",
    severity: "minor",
    state: "resolved",
    min: 310,
    stand: "stage",
    owner: PEOPLE.maria,
    actions: ["recheck", "open_stand"],
    timeline: [
      { min: 280, actor: PEOPLE.maria, code: "resolved" },
      { min: 310, code: "stand_check_failed" },
    ],
  },
  {
    id: "orders-degraded-resolved",
    kind: "order",
    severity: "major",
    state: "resolved",
    min: 420,
    team: "data",
    service: "kafka-connect",
    orderId: "r-0902",
    orderStatus: "HEALTHY",
    stand: "prod",
    owner: PEOPLE.oncall,
    actions: ["open_order"],
    timeline: [
      { min: 360, code: "healthy" },
      { min: 372, actor: PEOPLE.oncall, code: "sync_forced" },
      { min: 420, code: "degraded" },
    ],
  },
];

// Health of each upstream over the last 24 hours, one cell per hour, oldest
// first: 0 ok, 1 degraded, 2 down.
export interface ComponentHistory {
  id: "keycloak" | "harbor" | "gitlab" | "argocd" | "postgres" | "redis";
  name: string;
  hours: (0 | 1 | 2)[];
  latencyMs: number;
}

const ok24 = (): (0 | 1 | 2)[] => Array(24).fill(0);
const withHits = (hits: Record<number, 1 | 2>) => {
  const h = ok24();
  for (const [i, v] of Object.entries(hits)) h[Number(i)] = v;
  return h;
};

export const COMPONENTS: ComponentHistory[] = [
  { id: "keycloak", name: "Keycloak", hours: ok24(), latencyMs: 42 },
  { id: "harbor", name: "Harbor", hours: withHits({ 9: 1, 22: 1, 23: 2 }), latencyMs: 4100 },
  { id: "gitlab", name: "GitLab", hours: withHits({ 3: 1 }), latencyMs: 180 },
  { id: "argocd", name: "Argo CD", hours: ok24(), latencyMs: 95 },
  { id: "postgres", name: "PostgreSQL", hours: ok24(), latencyMs: 3 },
  { id: "redis", name: "Redis", hours: ok24(), latencyMs: 1 },
];

// Capabilities as /api/v1/status reports them: ok, or degraded by a component.
export const CAPABILITY_STATE: { id: string; state: 0 | 1 | 2 }[] = [
  { id: "sign_in", state: 0 },
  { id: "catalog", state: 1 },
  { id: "ordering", state: 0 },
  { id: "orders", state: 0 },
  { id: "deploy_status", state: 0 },
  { id: "publishing", state: 1 },
];

export interface LoopState {
  id: string; // reconciler name as cmd/portal registers it
  lastMin: number; // last run, minutes ago
  ms: number;
  error: boolean;
}

export const LOOPS: LoopState[] = [
  { id: "provisioning", lastMin: 0, ms: 340, error: false },
  { id: "drift", lastMin: 1, ms: 1200, error: false },
  { id: "stand-checks", lastMin: 3, ms: 2100, error: false },
  { id: "stand-jobs", lastMin: 0, ms: 80, error: false },
  { id: "catalog-discovery", lastMin: 95, ms: 5000, error: true },
  { id: "chart-versions", lastMin: 7, ms: 900, error: false },
];

export const APPROVALS = [
  { chart: "platform/redis", version: "7.4.1", author: PEOPLE.dmitry, min: 35 },
  { chart: "data/kafka-connect", version: "3.2.0", author: PEOPLE.maria, min: 160 },
  { chart: "web/static-site", version: "1.8.0", author: PEOPLE.anna, min: 1440 },
];

// One row of the audit trail. `source` widens the two journals the portal
// keeps today (order, publication) with what a full trail adds; `recorded`
// says whether the portal already writes this kind of row.
export type AuditSource =
  | "order"
  | "publication"
  | "stand"
  | "variable"
  | "category"
  | "access"
  | "settings";

export interface AuditEvent {
  id: string;
  min: number; // minutes ago
  source: AuditSource;
  type: string;
  actor?: string; // absent: the portal itself
  subject: string;
  team?: string;
  ok: boolean;
  recorded: boolean;
  // Extra facts shown when the row is opened: a change as before/after, or
  // plain key/value facts. Keys are worded by text.auditFact.
  change?: { field: string; before: string; after: string };
  facts?: Record<string, string>;
}

export const AUDIT: AuditEvent[] = [
  { id: "a1", min: 2, source: "order", type: "sync_forced", actor: PEOPLE.oncall, subject: "payments-api", team: "payments", ok: true, recorded: true },
  { id: "a2", min: 6, source: "access", type: "sign_in", actor: PEOPLE.oncall, subject: PEOPLE.oncall, ok: true, recorded: false, facts: { ip: "10.12.4.31", agent: "Firefox 131, Windows" } },
  { id: "a3", min: 9, source: "variable", type: "variable_changed", actor: PEOPLE.maria, subject: "INGRESS_CLASS", ok: true, recorded: false, change: { field: "stage", before: "nginx", after: "gateway" } },
  { id: "a4", min: 18, source: "order", type: "status_changed", subject: "payments-api", team: "payments", ok: false, recorded: true, change: { field: "status", before: "HEALTHY", after: "DEGRADED" } },
  { id: "a5", min: 24, source: "order", type: "updated", actor: PEOPLE.anna, subject: "payments-api", team: "payments", ok: true, recorded: true, facts: { mr: "!412" } },
  { id: "a6", min: 31, source: "publication", type: "version_submitted", actor: PEOPLE.dmitry, subject: "platform/redis 7.4.1", team: "platform", ok: true, recorded: true },
  { id: "a7", min: 42, source: "order", type: "merge_blocked", subject: "billing-db", team: "billing", ok: false, recorded: true, facts: { mr: "!398", reason: "conflict" } },
  { id: "a8", min: 47, source: "order", type: "updated", actor: PEOPLE.oleg, subject: "billing-db", team: "billing", ok: true, recorded: true },
  { id: "a9", min: 58, source: "stand", type: "stand_mode_changed", actor: PEOPLE.maria, subject: "dev", ok: true, recorded: false, change: { field: "mode", before: "console", after: "git" } },
  { id: "a10", min: 63, source: "access", type: "sign_in_failed", actor: "o.kozlov", subject: "o.kozlov", ok: false, recorded: false, facts: { ip: "10.12.9.7", reason: "no_group" } },
  { id: "a11", min: 80, source: "category", type: "category_renamed", actor: PEOPLE.dmitry, subject: "databases", ok: true, recorded: false, change: { field: "name", before: "Базы", after: "Базы данных" } },
  { id: "a12", min: 96, source: "settings", type: "checks_run", actor: PEOPLE.oncall, subject: "gitlab", ok: true, recorded: false },
  { id: "a13", min: 140, source: "publication", type: "version_approved", actor: PEOPLE.oncall, subject: "web/static-site 1.7.2", team: "web", ok: true, recorded: true },
  { id: "a14", min: 190, source: "order", type: "deleted", actor: PEOPLE.dmitry, subject: "legacy-cache", team: "platform", ok: true, recorded: true },
  { id: "a15", min: 260, source: "stand", type: "stand_created", actor: PEOPLE.maria, subject: "perf", ok: true, recorded: false },
  { id: "a16", min: 1500, source: "order", type: "created", actor: PEOPLE.anna, subject: "payments-worker", team: "payments", ok: true, recorded: true },
  { id: "a17", min: 1620, source: "publication", type: "approved", actor: PEOPLE.oncall, subject: "data/kafka-connect", team: "data", ok: true, recorded: true },
];

// Rows the demo "receives" while the page is open, one every few seconds, so
// the live behaviour is visible without a backend.
export const LIVE_POOL: Omit<AuditEvent, "id" | "min">[] = [
  { source: "order", type: "created", actor: PEOPLE.anna, subject: "payments-cache", team: "payments", ok: true, recorded: true },
  { source: "order", type: "status_changed", subject: "search-gateway", team: "search", ok: true, recorded: true, change: { field: "status", before: "ARGO_MISSING", after: "DEPLOYING" } },
  { source: "access", type: "sign_in", actor: PEOPLE.oleg, subject: PEOPLE.oleg, ok: true, recorded: false, facts: { ip: "10.12.9.7", agent: "Chrome 129, macOS" } },
  { source: "publication", type: "version_submitted", actor: PEOPLE.maria, subject: "data/clickhouse 24.8.1", team: "data", ok: true, recorded: true },
  { source: "order", type: "git_pulled", actor: PEOPLE.oleg, subject: "web-front", team: "web", ok: true, recorded: true },
];

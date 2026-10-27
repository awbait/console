import { apiErrorText } from "./errorText";
import type {
  AboutInfo,
  ActivityFeed,
  AdminBoard,
  ApiError,
  AppNotification,
  CatalogResponse,
  Category,
  ChangelogEntry,
  Chart,
  ChartCheckResult,
  ChartDependencies,
  ChartPublication,
  ChartVersion,
  ChecksResponse,
  ConfigResponse,
  CreateOrderBody,
  DeliveryTest,
  Editor,
  FieldError,
  JSONSchema,
  MaintenanceInput,
  MaintenanceView,
  OrderRequest,
  PendingVersion,
  PlatformHealth,
  PlatformOnline,
  PlatformUsers,
  PublicationDetail,
  PublicationVersion,
  RegistryRow,
  RequestDetail,
  Stand,
  StandChecksRun,
  StandChecksSummary,
  StandJob,
  SystemStatus,
  TemplateRef,
  UpdateOrderBody,
  User,
  Variable,
  ViewDocument,
  ViewIssue,
} from "./types";

const BASE = "/api/v1";

// Default network timeout. A hung backend/proxy must not leave a request (and its
// spinner) pending forever; after this the fetch is aborted and surfaced as an error.
const REQUEST_TIMEOUT_MS = 30_000;

// In dev (AUTH_MODE=dev backend) we impersonate a user via headers. In OIDC
// mode these are ignored and the session cookie is used.
function devHeaders(): Record<string, string> {
  if (import.meta.env.VITE_DEV_AUTH !== "true") return {};
  const h: Record<string, string> = {};
  if (import.meta.env.VITE_DEV_TEAMS) h["X-Dev-Teams"] = import.meta.env.VITE_DEV_TEAMS;
  if (import.meta.env.VITE_DEV_ROLE) h["X-Dev-Role"] = import.meta.env.VITE_DEV_ROLE;
  return h;
}

export class HttpError extends Error {
  status: number;
  code: string;
  details: FieldError[];
  // Open merge request that blocks the change (code "open_mr"); lets callers
  // link the user straight to it.
  mrUrl?: string;
  mrIid?: number;
  // Who holds the version document (code "edit_locked"); the constructor
  // names them in its banner.
  editor?: Editor;
  constructor(status: number, body: ApiError | null) {
    // The message is what the user reads, so it is written for them (see
    // errorText). The raw code and status stay on the instance for debug lines.
    super(apiErrorText(body?.error ?? "", status, body?.message));
    this.status = status;
    this.code = body?.error ?? "error";
    this.details = body?.details ?? [];
    this.mrUrl = body?.mr_url;
    this.mrIid = body?.mr_iid;
    this.editor = body?.editor;
  }
}

// Friendly message for any thrown value: HttpError/Error carry their own message,
// anything else is stringified. Used by callers to surface failures (e.g. toasts).
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

// Central 401 handler, registered by the auth layer. Lets a mid-session
// expiry trigger a re-login flow (return-to current page) instead of surfacing
// a raw "unauthorized" error in every caller. Kept out of React so the plain
// fetch wrapper stays dependency-free.
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(h: (() => void) | null) {
  unauthorizedHandler = h;
}

// A session does not expire for one request: the portal always has several in
// the air - who am I, what is healthy, how many unread - and they all come back
// 401 together. The handler leaves for the IdP, and the page keeps running
// until the browser navigates, so every one of those answers used to start
// another login. Only the first one may.
let leavingForLogin = false;
function handleUnauthorized() {
  // With no handler registered yet the first load is still deciding whether
  // anyone is signed in, and nothing is latched: that 401 belongs to the
  // sign-in screen, not to a re-login.
  if (leavingForLogin || !unauthorizedHandler) return;
  leavingForLogin = true;
  unauthorizedHandler();
}

// Central "an upstream just failed" handler, registered by the platform-health
// layer. A request that came back 502 is the earliest evidence the portal has
// that something outside it broke - earlier than any poll - so it is worth
// re-asking what still works right away instead of waiting for the next tick.
let upstreamFailureHandler: (() => void) | null = null;
export function setUpstreamFailureHandler(h: (() => void) | null) {
  upstreamFailureHandler = h;
}

// Central "maintenance turned me away" handler, registered by the
// platform-health layer. A 503 "maintenance" can arrive before the next poll
// says the portal is locked; it is the cue to ask now, so the lock screen
// replaces a page full of failed requests within a moment.
let maintenanceHandler: (() => void) | null = null;
export function setMaintenanceHandler(h: (() => void) | null) {
  maintenanceHandler = h;
}

// keepalive lets a request outlive its page: the browser finishes it after the
// tab is closed. For the few things that must be said on the way out.
interface ReqOptions {
  keepalive?: boolean;
}

async function req<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  opts?: ReqOptions,
): Promise<T> {
  // Combine the default timeout with the caller's signal (useAsync aborts on
  // unmount/deps change), so either source can cancel the in-flight fetch.
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: "include",
      headers: {
        ...devHeaders(),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: combined,
      keepalive: opts?.keepalive,
    });
  } catch (e) {
    // The timeout aborts with a TimeoutError; surface it as a clear message
    // instead of a bare DOMException. A caller-initiated abort keeps its
    // AbortError name so useAsync recognises and ignores it.
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new Error("Превышено время ожидания ответа сервера");
    }
    throw e;
  }
  if (!res.ok) {
    let parsed: ApiError | null = null;
    try {
      parsed = await res.json();
    } catch {
      /* non-JSON error */
    }
    if (res.status === 401) handleUnauthorized();
    if (parsed?.error === "upstream_unavailable") upstreamFailureHandler?.();
    if (parsed?.error === "maintenance") maintenanceHandler?.();
    throw new HttpError(res.status, parsed);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

function chartDependencies(project: string, name: string, version: string, signal?: AbortSignal) {
  return req<ChartDependencies>(
    "GET",
    `/charts/${enc(project)}/${enc(name)}/${enc(version)}/dependencies`,
    undefined,
    signal,
  );
}

// What an admin sets on a stand: everything else on it the portal computes.
type StandFields =
  | "name"
  | "default_cluster"
  | "layout"
  | "git_path"
  | "mode"
  | "chart_registry"
  | "git_url"
  | "argocd_namespace"
  | "argocd_project"
  | "argocd_git_path";

export const api = {
  // auth
  me: () => req<User>("GET", "/auth/me"),
  loginUrl: (returnTo?: string) =>
    returnTo
      ? `${BASE}/auth/login?return_to=${encodeURIComponent(returnTo)}`
      : `${BASE}/auth/login`,
  // Browser-navigated GET: clears the session and bounces through the IdP's
  // end-session endpoint, so it must be a full navigation, not a fetch.
  logoutUrl: () => `${BASE}/auth/logout`,

  // catalog
  listCharts: () => req<Chart[]>("GET", "/charts"),
  // Catalog in one request: Harbor charts + categories + publication overlay.
  getCatalog: () => req<CatalogResponse>("GET", "/catalog"),
  // Check a chart by arbitrary Harbor path (project/name) before publishing.
  checkChart: (path: string) => req<ChartCheckResult>("POST", "/charts/check", { path }),
  getChart: (project: string, name: string, signal?: AbortSignal) =>
    req<Chart>("GET", `/charts/${enc(project)}/${enc(name)}`, undefined, signal),
  getVersion: (project: string, name: string, version: string, signal?: AbortSignal) =>
    req<ChartVersion>("GET", `/charts/${enc(project)}/${enc(name)}/${enc(version)}`, undefined, signal),
  getValues: (project: string, name: string, version: string, signal?: AbortSignal) =>
    req<string>("GET", `/charts/${enc(project)}/${enc(name)}/${enc(version)}/values`, undefined, signal),
  getReadme: (project: string, name: string, version: string, signal?: AbortSignal) =>
    req<string>("GET", `/charts/${enc(project)}/${enc(name)}/${enc(version)}/readme`, undefined, signal),
  getSchema: (project: string, name: string, version: string, signal?: AbortSignal) =>
    req<JSONSchema>("GET", `/charts/${enc(project)}/${enc(name)}/${enc(version)}/schema`, undefined, signal),
  // The version's dependencies plus the schema an order of it is drawn from
  // (the chart's own, with every dependency mounted under its values key).
  // getSchema above stays the chart's file byte for byte: the constructor shows
  // it as the chart wrote it.
  getDependencies: chartDependencies,
  // The schema to draw a form of this version from, or null when the chart
  // describes nothing at all (then the order is raw YAML). Everything that
  // renders or labels an order's values asks for this one, not for the chart's
  // file: a view may name a field that only exists once a dependency is mounted.
  getFormSchema: (project: string, name: string, version: string, signal?: AbortSignal) =>
    chartDependencies(project, name, version, signal).then((d) => d.effective_schema ?? null),
  getAggregatedChangelog: (project: string, name: string, limit = 20, signal?: AbortSignal) =>
    req<ChangelogEntry[]>(
      "GET",
      `/charts/${enc(project)}/${enc(name)}/changelog/aggregated?limit=${limit}`,
      undefined,
      signal,
    ),
  // Approved chart view (view document from the publication). With a version it
  // returns that orderable version's view; without one, the default active view.
  // null - no approved view for the request (form-based ordering unavailable).
  getChartView: (project: string, name: string, version?: string, signal?: AbortSignal) =>
    req<ViewDocument>(
      "GET",
      `/charts/${enc(project)}/${enc(name)}/view${version ? `?version=${enc(version)}` : ""}`,
      undefined,
      signal,
    ).catch((e) => {
      if (e instanceof HttpError && e.status === 404) return null;
      throw e;
    }),

  // What a version document may reference in "defaults" and "initial", for the
  // constructor's completions: one list, the same the portal resolves against.
  viewRefs: () => req<TemplateRef[]>("GET", "/view-refs"),
  // The values a new order form opens with (the version's "initial" block,
  // rendered for this person, team and stand: a variable is worth what the
  // stand says). Best effort: a form that does not get them is still a form
  // somebody can fill in.
  orderInitial: (project: string, name: string, version: string, team: string, stand = "", signal?: AbortSignal) =>
    req<{ values: Record<string, unknown> }>(
      "GET",
      `/charts/${enc(project)}/${enc(name)}/initial?version=${enc(version)}&team=${enc(team)}&stand=${enc(stand)}`,
      undefined,
      signal,
    ),

  // stands: read by anybody signed in (the order form offers them, the list
  // filters by them), written by admins.
  listStands: (signal?: AbortSignal) => req<Stand[]>("GET", "/stands", undefined, signal),
  getStand: (id: string, signal?: AbortSignal) => req<Stand>("GET", `/stands/${enc(id)}`, undefined, signal),
  createStand: (s: Pick<Stand, StandFields>) =>
    req<Stand>("POST", "/stands", {
      name: s.name,
      default_cluster: s.default_cluster,
      layout: s.layout,
      git_path: s.git_path,
      mode: s.mode,
      chart_registry: s.chart_registry,
      git_url: s.git_url,
      argocd_namespace: s.argocd_namespace,
      argocd_project: s.argocd_project,
      argocd_git_path: s.argocd_git_path,
    }),
  updateStand: (s: Pick<Stand, "id" | StandFields>) =>
    req<Stand>("PATCH", `/stands/${enc(s.id)}`, {
      name: s.name,
      default_cluster: s.default_cluster,
      layout: s.layout,
      git_path: s.git_path,
      mode: s.mode,
      chart_registry: s.chart_registry,
      git_url: s.git_url,
      argocd_namespace: s.argocd_namespace,
      argocd_project: s.argocd_project,
      argocd_git_path: s.argocd_git_path,
    }),
  setDefaultStand: (id: string) => req<void>("POST", `/stands/${enc(id)}/default`),
  // The Argo CD wiring of a stand, as YAML text ops applies by hand, and the
  // stand's own checks, run on request. Both admin only.
  standManifests: (id: string, signal?: AbortSignal) =>
    req<string>("GET", `/stands/${enc(id)}/manifests`, undefined, signal),
  standChecks: (id: string, signal?: AbortSignal) =>
    req<StandChecksRun>("GET", `/stands/${enc(id)}/checks`, undefined, signal),
  // Every stand's stored checks, for the status page. Admin only.
  standChecksSummary: (signal?: AbortSignal) =>
    req<{ stands: StandChecksSummary[] }>("GET", "/stands/checks", undefined, signal),
  // A stand's jobs, newest first, and stopping the running one. Admin only.
  standJobs: (id: string, signal?: AbortSignal) =>
    req<{ jobs: StandJob[] }>("GET", `/stands/${enc(id)}/jobs`, undefined, signal),
  stopStandJob: (id: string, jobId: string) =>
    req<StandJob>("POST", `/stands/${enc(id)}/jobs/${enc(jobId)}/stop`),
  // Writing every order's application.yaml again from the stand's settings:
  // how many orders that would look at, and starting the job. Admin only.
  previewRegenerate: (id: string, signal?: AbortSignal) =>
    req<{ total: number }>("GET", `/stands/${enc(id)}/regenerate`, undefined, signal),
  regenerateStand: (id: string) => req<StandJob>("POST", `/stands/${enc(id)}/regenerate`),
  // Starts the job that deletes the stand; name is what the admin typed to
  // confirm. Admin only.
  deleteStand: (id: string, name: string) => req<StandJob>("DELETE", `/stands/${enc(id)}`, { name }),

  // platform variables: read by anybody signed in (the version constructor
  // offers them), written by admins.
  listVariables: () => req<Variable[]>("GET", "/variables"),
  setVariable: (v: Variable) =>
    req<Variable>("PUT", `/variables/${enc(v.name)}`, {
      value: v.value,
      description: v.description,
    }),
  deleteVariable: (name: string) => req<void>("DELETE", `/variables/${enc(name)}`),
  variableUsage: (name: string) =>
    req<{ used_by: string[] }>("GET", `/variables/${enc(name)}/usage`),
  // A variable's own value on one stand. An empty value clears it, the same
  // as the delete; both answer with the variable as it now stands.
  setVariableOverride: (name: string, standId: string, value: string) =>
    req<Variable>("PUT", `/variables/${enc(name)}/stands/${enc(standId)}`, { value }),
  deleteVariableOverride: (name: string, standId: string) =>
    req<void>("DELETE", `/variables/${enc(name)}/stands/${enc(standId)}`),

  // catalog categories (CRUD - admin)
  listCategories: () => req<Category[]>("GET", "/categories"),
  createCategory: (c: Category) => req<Category>("POST", "/categories", c),
  updateCategory: (c: Category) =>
    req<Category>("PATCH", `/categories/${enc(c.id)}`, { label: c.label, sort: c.sort, icon: c.icon }),
  deleteCategory: (id: string) => req<void>("DELETE", `/categories/${enc(id)}`),

  // Teams the portal has seen, for the owner selector. Admin only: everybody
  // else may only hand a service to a team they are in, and the session already
  // carries those.
  listTeams: (signal?: AbortSignal) =>
    req<{ teams: string[] | null }>("GET", "/teams", undefined, signal).then((r) => r.teams ?? []),

  // chart publications (metadata + view builder + approval)
  listPublications: (params?: Record<string, string>) =>
    req<ChartPublication[] | null>("GET", "/publications" + qs(params)).then((r) => r ?? []),
  // Publication of one chart by coordinates. The API filters by chart name
  // only, so the project match happens here; null when the chart has none.
  findPublication: (project: string, name: string, signal?: AbortSignal) =>
    req<ChartPublication[] | null>(
      "GET",
      "/publications" + qs({ chart: name }),
      undefined,
      signal,
    ).then((r) => (r ?? []).find((p) => p.chart_project === project) ?? null),
  createPublication: (body: { chart: string; category_id: string; owner_team: string }) =>
    req<ChartPublication>("POST", "/publications", body),
  getPublication: (id: string) => req<PublicationDetail>("GET", `/publications/${enc(id)}`),
  // Claim an unclaimed auto-discovered publication for a team.
  adoptPublication: (id: string, body: { category_id: string; owner_team: string }) =>
    req<ChartPublication>("POST", `/publications/${enc(id)}/adopt`, body),
  updatePublication: (id: string, body: { category_id?: string; owner_team?: string }) =>
    req<ChartPublication>("PATCH", `/publications/${enc(id)}`, body),
  submitPublication: (id: string) => req<ChartPublication>("POST", `/publications/${enc(id)}/submit`),
  // Drop what the portal cached about the chart, so its files are read from
  // Harbor again. Answers with the number of versions it dropped.
  refreshChart: (id: string) =>
    req<{ versions: number }>("POST", `/publications/${enc(id)}/refresh`),
  withdrawPublication: (id: string) =>
    req<ChartPublication>("POST", `/publications/${enc(id)}/withdraw`),
  approvePublication: (id: string) =>
    req<ChartPublication>("POST", `/publications/${enc(id)}/approve`),
  rejectPublication: (id: string, comment: string) =>
    req<ChartPublication>("POST", `/publications/${enc(id)}/reject`, { comment }),

  // Format of the view document: the rules the portal checks on save, in the
  // form the editor in the version constructor reads (completion, hovers,
  // squiggles). Ships with the portal, so it changes only with a release.
  getViewSchema: (signal?: AbortSignal) =>
    req<JSONSchema>("GET", "/view-schema", undefined, signal),

  // The admin's registry of publications: one row per publication with its
  // versions summarized, its orders counted and its problems named.
  adminPublications: (signal?: AbortSignal) =>
    req<RegistryRow[] | null>("GET", "/admin/publications", undefined, signal).then((r) => r ?? []),

  // publication versions (per-version view builder + approval FSM)
  pendingVersions: (signal?: AbortSignal) =>
    req<PendingVersion[] | null>("GET", "/publications/pending-versions", undefined, signal).then(
      (r) => r ?? [],
    ),
  listVersions: (id: string, signal?: AbortSignal) =>
    req<PublicationVersion[] | null>("GET", `/publications/${enc(id)}/versions`, undefined, signal).then(
      (r) => r ?? [],
    ),
  saveVersionView: (id: string, version: string, view: ViewDocument) =>
    req<PublicationVersion>("PUT", `/publications/${enc(id)}/versions/${enc(version)}`, { view }),
  // The edit lease on a version document (one person edits at a time). Taking
  // it is also renewing it; a 409 "edit_locked" names who holds it instead.
  // force is the administrator's take-over.
  acquireEditLock: (id: string, version: string, force = false) =>
    req<Editor>(
      "POST",
      `/publications/${enc(id)}/versions/${enc(version)}/lock`,
      force ? { force: true } : undefined,
    ),
  // Giving the lease back on the way out: with keepalive the browser finishes
  // the request after the tab is gone.
  releaseEditLock: (id: string, version: string, opts?: { keepalive?: boolean }) =>
    req<void>("DELETE", `/publications/${enc(id)}/versions/${enc(version)}/lock`, undefined, undefined, opts),
  getEditLock: (id: string, version: string, signal?: AbortSignal) =>
    req<{ editing: Editor | null }>(
      "GET",
      `/publications/${enc(id)}/versions/${enc(version)}/lock`,
      undefined,
      signal,
    ),
  validateVersion: (id: string, version: string, view: ViewDocument) =>
    req<{ issues: ViewIssue[] }>("POST", `/publications/${enc(id)}/versions/${enc(version)}/validate`, {
      view,
    }),
  submitVersion: (id: string, version: string) =>
    req<PublicationVersion>("POST", `/publications/${enc(id)}/versions/${enc(version)}/submit`),
  withdrawVersion: (id: string, version: string) =>
    req<PublicationVersion>("POST", `/publications/${enc(id)}/versions/${enc(version)}/withdraw`),
  approveVersion: (id: string, version: string) =>
    req<PublicationVersion>("POST", `/publications/${enc(id)}/versions/${enc(version)}/approve`),
  rejectVersion: (id: string, version: string, comment: string) =>
    req<PublicationVersion>("POST", `/publications/${enc(id)}/versions/${enc(version)}/reject`, {
      comment,
    }),
  setVersionOrderable: (id: string, version: string, orderable: boolean) =>
    req<PublicationVersion>("POST", `/publications/${enc(id)}/versions/${enc(version)}/orderable`, {
      orderable,
    }),
  // Support. Taking a version out of it also clears its catalog flag and its
  // recommendation, so the caller reloads both the versions and the catalog.
  deprecateVersion: (id: string, version: string, note: string) =>
    req<PublicationVersion>("POST", `/publications/${enc(id)}/versions/${enc(version)}/deprecate`, {
      note,
    }),
  undeprecateVersion: (id: string, version: string) =>
    req<PublicationVersion>(
      "POST",
      `/publications/${enc(id)}/versions/${enc(version)}/undeprecate`,
    ),
  setRecommendedVersion: (id: string, version: string) =>
    req<void>("POST", `/publications/${enc(id)}/recommended`, { version }),

  // requests
  listRequests: (params?: Record<string, string>, signal?: AbortSignal) =>
    req<OrderRequest[]>("GET", "/requests" + qs(params), undefined, signal),
  getRequest: (id: string, signal?: AbortSignal) =>
    req<RequestDetail>("GET", `/requests/${enc(id)}`, undefined, signal),
  // The view document of the version this order runs. Asked by order and not by
  // chart version: the chart route serves order forms and answers only for
  // versions still on offer, and an order outlives its version's place in the
  // catalog.
  getRequestView: (id: string, signal?: AbortSignal) =>
    req<ViewDocument>("GET", `/requests/${enc(id)}/view`, undefined, signal),
  createRequest: (body: CreateOrderBody) => req<OrderRequest>("POST", "/requests", body),
  updateRequest: (id: string, body: UpdateOrderBody) =>
    req<OrderRequest>("PATCH", `/requests/${enc(id)}`, body),
  renameRequest: (id: string, display_name: string) =>
    req<OrderRequest>("POST", `/requests/${enc(id)}/rename`, { display_name }),
  submitRequest: (id: string) => req<OrderRequest>("POST", `/requests/${enc(id)}/submit`),
  deleteRequest: (id: string) => req<OrderRequest>("DELETE", `/requests/${enc(id)}`),
  syncRequest: (id: string) => req<unknown>("POST", `/requests/${enc(id)}/sync`),
  // A draft of the order on its own stand or another: same service, team and values,
  // with what the portal fills in rendered for the copy.
  copyRequest: (
    id: string,
    body: { stand_id: string; cluster?: string; service_name?: string; namespace?: string },
  ) =>
    req<OrderRequest>("POST", `/requests/${enc(id)}/copy`, body),
  // Adopt the order's current Git state (values + version) into the portal.
  pullRequest: (id: string) => req<OrderRequest>("POST", `/requests/${enc(id)}/pull`),

  // notifications: the reader's own feed. Who a notification is for is decided
  // on the server from the session, so there is nothing to pass here.
  listNotifications: (params?: Record<string, string>, signal?: AbortSignal) =>
    req<AppNotification[]>("GET", "/notifications" + qs(params), undefined, signal),
  unreadNotifications: (signal?: AbortSignal) =>
    req<{ unread: number }>("GET", "/notifications/unread", undefined, signal),
  readNotification: (id: string) => req<void>("POST", `/notifications/${enc(id)}/read`),
  readAllNotifications: () => req<void>("POST", "/notifications/read-all"),

  // system status (integrations + storage health)
  getSystemStatus: () => req<SystemStatus>("GET", "/status"),
  // configuration checks: what is actually wired up, as opposed to what answers
  // a ping. Its own endpoint on its own rhythm - a round costs the upstreams a
  // handful of API calls, so it is not carried by every status refresh.
  getStatusChecks: (signal?: AbortSignal) =>
    req<ChecksResponse>("GET", "/status/checks", undefined, signal),
  runStatusChecks: () => req<{ queued: boolean }>("POST", "/status/checks/run"),
  // The one active check: asks GitLab to send a sample delivery and waits for it.
  // Takes up to ten seconds to answer.
  testWebhookDelivery: () => req<DeliveryTest>("POST", "/status/checks/webhook-delivery"),
  // runtime configuration, read-only (admin)
  getConfig: () => req<ConfigResponse>("GET", "/config"),
  // The admin duty board. `tz` is the reader's zone, so "today" and the days of
  // the trends are the reader's days.
  getAdminBoard: (tz: string, signal?: AbortSignal) =>
    req<AdminBoard>("GET", `/admin/board?tz=${encodeURIComponent(tz)}`, undefined, signal),
  // who uses the portal (admin). Three calls because they are read at three
  // rhythms: the page loads once, "who is here now" keeps refreshing, and the
  // feed is re-asked whenever it is narrowed to a team or a person.
  getUsers: (signal?: AbortSignal) =>
    req<PlatformUsers>("GET", "/admin/users", undefined, signal),
  getOnline: (signal?: AbortSignal) =>
    req<PlatformOnline>("GET", "/admin/users/online", undefined, signal),
  // One page of the feed. `cursor` is the time of the last event already shown
  // and `sort` says which end to read from.
  getUserEvents: (
    f: { actor?: string; team?: string; limit?: number; cursor?: string; sort?: string },
    signal?: AbortSignal,
  ) => {
    const q = new URLSearchParams();
    if (f.actor) q.set("actor", f.actor);
    if (f.team) q.set("team", f.team);
    if (f.limit) q.set("limit", String(f.limit));
    if (f.cursor) q.set("cursor", f.cursor);
    if (f.sort) q.set("sort", f.sort);
    return req<ActivityFeed>("GET", `/admin/users/events?${q}`, undefined, signal);
  },
  // What the portal can do right now. Answers without a session, so the sign-in
  // screen can ask it too.
  getPlatformHealth: (signal?: AbortSignal) =>
    req<PlatformHealth>("GET", "/platform/health", undefined, signal),

  // maintenance (admin): announce, change, end
  getMaintenance: (signal?: AbortSignal) =>
    req<MaintenanceView>("GET", "/admin/maintenance", undefined, signal),
  setMaintenance: (body: MaintenanceInput) => req<MaintenanceView>("PUT", "/admin/maintenance", body),
  endMaintenance: () => req<MaintenanceView>("DELETE", "/admin/maintenance"),

  // about: portal version + changelog
  getAbout: () => req<AboutInfo>("GET", "/info"),
  getChangelog: () => req<ChangelogEntry[]>("GET", "/changelog"),
};

function enc(s: string) {
  return encodeURIComponent(s);
}
function qs(params?: Record<string, string>) {
  if (!params) return "";
  const entries = Object.entries(params).filter(([, v]) => v !== "");
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(Object.fromEntries(entries)).toString();
}

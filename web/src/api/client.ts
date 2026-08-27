import { apiErrorText } from "./errorText";
import type {
  AboutInfo,
  ActivityFeed,
  ApiError,
  AppNotification,
  CatalogResponse,
  Category,
  ChangelogEntry,
  Chart,
  ChartCheckResult,
  ChartPublication,
  ChartVersion,
  ChecksResponse,
  ConfigResponse,
  CreateOrderBody,
  DeliveryTest,
  FieldError,
  JSONSchema,
  OrderRequest,
  PendingVersion,
  PlatformHealth,
  PlatformOnline,
  PlatformUsers,
  PublicationDetail,
  PublicationVersion,
  RequestDetail,
  SystemStatus,
  UpdateOrderBody,
  User,
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
  constructor(status: number, body: ApiError | null) {
    // The message is what the user reads, so it is written for them (see
    // errorText). The raw code and status stay on the instance for debug lines.
    super(apiErrorText(body?.error ?? "", status, body?.message));
    this.status = status;
    this.code = body?.error ?? "error";
    this.details = body?.details ?? [];
    this.mrUrl = body?.mr_url;
    this.mrIid = body?.mr_iid;
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

async function req<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
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
    throw new HttpError(res.status, parsed);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

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
  createRequest: (body: CreateOrderBody) => req<OrderRequest>("POST", "/requests", body),
  updateRequest: (id: string, body: UpdateOrderBody) =>
    req<OrderRequest>("PATCH", `/requests/${enc(id)}`, body),
  renameRequest: (id: string, display_name: string) =>
    req<OrderRequest>("POST", `/requests/${enc(id)}/rename`, { display_name }),
  submitRequest: (id: string) => req<OrderRequest>("POST", `/requests/${enc(id)}/submit`),
  deleteRequest: (id: string) => req<OrderRequest>("DELETE", `/requests/${enc(id)}`),
  syncRequest: (id: string) => req<unknown>("POST", `/requests/${enc(id)}/sync`),
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

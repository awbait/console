// Stub data for the duty board while the summary endpoint does not exist. The
// shapes are what the page expects from the backend; the values are made up.

export type Severity = "critical" | "warning";
export type AttentionKind = "order" | "stand" | "integration" | "config" | "publication" | "maintenance";
export type ComponentState = "ok" | "degraded" | "down";

export interface SeriesPoint {
  at: string; // ISO date or timestamp
  value: number;
}

export interface BoardTiles {
  orders: { today: number; total: number; series: SeriesPoint[] };
  actions: { today: number; series: SeriesPoint[] };
  users: { today: number; total: number; series: SeriesPoint[] };
  online: { now: number; series: SeriesPoint[] };
}

// One fact about where a problem is, drawn as an icon and a value: the icon
// says what the value is (a service, a team, a stand), so the line reads
// "kafka-main, data, idp" instead of spelling out "команда" and "стенд".
export type MetaKind = "service" | "team" | "stand" | "person" | "version" | "setting" | "check" | "time";
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
  since: string; // ISO timestamp
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
}

export interface InProgressItem {
  id: string;
  kind: "order" | "stand_job";
  title: string;
  meta: Meta[];
  stage: string;
  progress?: { done: number; total: number };
  startedAt: string;
}

export interface QueueItem {
  id: string;
  service: string;
  change: string;
  team: string;
  to: string;
}

export interface BoardSummary {
  checkedAt: string;
  tiles: BoardTiles;
  attention: AttentionItem[];
  components: PlatformComponent[];
  events: BoardEvent[];
  inProgress: InProgressItem[];
  queue: QueueItem[];
}

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

function days(values: number[], now: number): SeriesPoint[] {
  return values.map((value, i) => ({
    at: new Date(now - (values.length - 1 - i) * DAY).toISOString(),
    value,
  }));
}

function hours(values: number[], now: number): SeriesPoint[] {
  return values.map((value, i) => ({
    at: new Date(now - (values.length - 1 - i) * HOUR).toISOString(),
    value,
  }));
}

const ago = (now: number, ms: number) => new Date(now - ms).toISOString();

const svc = (text: string): Meta => ({ kind: "service", text });
const team = (text: string): Meta => ({ kind: "team", text });
const stand = (text: string): Meta => ({ kind: "stand", text });
const person = (text: string): Meta => ({ kind: "person", text });

// People online by hour of the day (0..23): quiet at night, busy in office hours.
const ONLINE_PROFILE = [1, 0, 0, 0, 0, 0, 1, 2, 5, 9, 12, 13, 10, 9, 12, 13, 11, 8, 5, 3, 2, 2, 1, 1];

// The last 24 hours ending at the current one, valued by the hour of the day,
// so the peak lands in the afternoon whatever time the page is opened.
function onlineByHour(now: number): BoardTiles["online"] {
  const hour = new Date(now).getHours();
  const values = Array.from({ length: 24 }, (_, i) => ONLINE_PROFILE[(hour - 23 + i + 24) % 24]);
  return { now: values[23], series: hours(values, now) };
}

export function stubSummary(now = Date.now()): BoardSummary {
  return {
    checkedAt: ago(now, 40 * 1000),
    tiles: {
      orders: { today: 3, total: 412, series: days([4, 6, 2, 0, 1, 7, 5, 8, 3, 2, 0, 6, 9, 3], now) },
      actions: { today: 27, series: days([31, 44, 18, 2, 5, 52, 40, 61, 37, 29, 4, 48, 21, 27], now) },
      users: { today: 18, total: 240, series: days([22, 25, 19, 3, 4, 27, 24, 29, 21, 20, 2, 26, 14, 18], now) },
      online: onlineByHour(now),
    },
    attention: [
      {
        id: "a1",
        severity: "critical",
        kind: "order",
        title: "Заказ не работает",
        meta: [svc("redis-cache"), team("core"), stand("idp")],
        since: ago(now, 48 * MIN),
        to: "/admin/requests",
      },
      {
        id: "a2",
        severity: "critical",
        kind: "stand",
        title: "Стенд не прошёл проверки",
        meta: [stand("test"), { kind: "check", text: "Доступ к Argo CD" }],
        since: ago(now, 3 * HOUR),
        to: "/admin/stands",
      },
      {
        id: "a3",
        severity: "warning",
        kind: "order",
        title: "Заказ долго разворачивается",
        meta: [svc("kafka-main"), team("data"), stand("idp")],
        since: ago(now, 26 * MIN),
        to: "/admin/requests",
      },
      // Only a published version counts: a draft or a version under review
      // cannot be ordered, so its chart missing from the registry breaks
      // nothing. The summary endpoint must apply the same rule.
      {
        id: "a4",
        severity: "warning",
        kind: "publication",
        title: "Опубликованной версии нет в реестре",
        meta: [svc("ingress-gateway"), { kind: "version", text: "9.4.0" }],
        since: ago(now, 20 * HOUR),
        to: "/admin/approvals",
      },
      {
        id: "a6",
        severity: "warning",
        kind: "order",
        title: "Merge request не сливается",
        meta: [svc("postgres-analytics"), team("data"), stand("test")],
        since: ago(now, 2 * HOUR),
        to: "/admin/requests",
      },
      {
        id: "a7",
        severity: "warning",
        kind: "maintenance",
        title: "Запланированы технические работы",
        meta: [{ kind: "time", text: "Сегодня с 22:00 до 23:00" }],
        since: ago(now, 26 * HOUR),
        to: "/admin/maintenance",
      },
      {
        id: "a5",
        severity: "warning",
        kind: "config",
        title: "Настройка с проблемой",
        meta: [{ kind: "setting", text: "HARBOR_URL" }],
        since: ago(now, 5 * HOUR),
        to: "/admin/config",
      },
    ],
    components: [
      { id: "gitlab", name: "GitLab", role: "Репозитории и merge request", state: "ok", note: "Доступен" },
      { id: "argocd", name: "Argo CD", role: "Выкатка и состояние заказов", state: "ok", note: "Доступен" },
      { id: "harbor", name: "Harbor", role: "Каталог и версии", state: "ok", note: "Доступен" },
      { id: "keycloak", name: "Keycloak", role: "Вход и группы", state: "ok", note: "Доступен" },
      { id: "storage", name: "Хранилища", role: "PostgreSQL, Redis", state: "ok", note: "Доступны" },
      { id: "stands", name: "Стенды", role: "test не прошёл проверки", state: "down", note: "Сбой" },
      { id: "jobs", name: "Фоновые задачи", role: "Последний запуск минуту назад", state: "ok", note: "Работают" },
    ],
    events: [
      {
        id: "e1",
        at: ago(now, 3 * MIN),
        kind: "order",
        text: "Заказ redis-cache перестал работать",
        meta: [team("core"), stand("idp")],
      },
      {
        id: "e2",
        at: ago(now, 11 * MIN),
        kind: "order",
        text: "Создан заказ postgres-main",
        meta: [person("Алексей Петров"), team("data"), stand("idp")],
      },
      {
        id: "e3",
        at: ago(now, 16 * MIN),
        kind: "order",
        text: "Изменён заказ kafka-main",
        meta: [person("Мария Иванова"), team("data"), stand("idp")],
      },
      {
        id: "e4",
        at: ago(now, 22 * MIN),
        kind: "publication",
        text: "Redis 7.4.2 отправлен на согласование",
        meta: [person("Сергей Волков"), team("core")],
      },
      {
        id: "e5",
        at: ago(now, 38 * MIN),
        kind: "publication",
        text: "Опубликован nginx 1.27.1",
        meta: [team("platform")],
      },
    ],
    inProgress: [
      {
        id: "p1",
        kind: "order",
        title: "postgres-main",
        meta: [team("data"), stand("idp")],
        stage: "Разворачивается",
        startedAt: ago(now, 4 * MIN),
      },
      {
        id: "p2",
        kind: "order",
        title: "kafka-main",
        meta: [team("data"), stand("idp")],
        stage: "Ждёт слияния merge request",
        startedAt: ago(now, 12 * MIN),
      },
      {
        id: "p3",
        kind: "stand_job",
        title: "Перевод заказов в «Только Git»",
        meta: [stand("console-stand"), { kind: "person", text: "Мария Иванова" }],
        stage: "Переводит заказы",
        progress: { done: 9, total: 15 },
        startedAt: ago(now, 7 * MIN),
      },
    ],
    queue: [
      { id: "q1", service: "Redis 7.4.2", change: "Новая версия", team: "core", to: "/admin/approvals" },
      { id: "q2", service: "PostgreSQL", change: "Смена владельца", team: "data", to: "/admin/approvals" },
    ],
  };
}

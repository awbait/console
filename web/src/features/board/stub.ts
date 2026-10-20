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

export interface AttentionItem {
  id: string;
  severity: Severity;
  kind: AttentionKind;
  title: string;
  where: string;
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
  who: string;
}

export interface InProgressItem {
  id: string;
  kind: "order" | "stand_job";
  title: string;
  where: string;
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
        where: "redis-cache · команда core · стенд idp",
        since: ago(now, 48 * MIN),
        to: "/admin/requests",
      },
      {
        id: "a2",
        severity: "critical",
        kind: "stand",
        title: "Стенд не прошёл проверки",
        where: "test · доступ к Argo CD",
        since: ago(now, 3 * HOUR),
        to: "/admin/stands",
      },
      {
        id: "a3",
        severity: "warning",
        kind: "order",
        title: "Заказ долго разворачивается",
        where: "kafka-main · команда data · стенд idp",
        since: ago(now, 26 * MIN),
        to: "/admin/requests",
      },
      {
        id: "a4",
        severity: "warning",
        kind: "publication",
        title: "Версии нет в реестре",
        where: "ingress-gateway 9.4.0 · рекомендуемая версия",
        since: ago(now, 20 * HOUR),
        to: "/admin/approvals",
      },
      {
        id: "a5",
        severity: "warning",
        kind: "config",
        title: "Настройка с проблемой",
        where: "Конфигурация · адрес Harbor",
        since: ago(now, 5 * HOUR),
        to: "/admin/config",
      },
    ],
    components: [
      { id: "gitlab", name: "GitLab", role: "Репозитории и merge request", state: "ok", note: "Доступен" },
      { id: "argocd", name: "Argo CD", role: "Выкатка и состояние заказов", state: "ok", note: "Доступен" },
      { id: "harbor", name: "Harbor", role: "Каталог и версии", state: "ok", note: "Доступен" },
      { id: "keycloak", name: "Keycloak", role: "Вход и группы", state: "ok", note: "Доступен" },
      { id: "storage", name: "База данных и кеш", role: "PostgreSQL, Redis", state: "ok", note: "Доступны" },
      { id: "stands", name: "Стенды", role: "3 из 4 в порядке", state: "down", note: "Есть проблемы" },
      { id: "jobs", name: "Фоновые задачи", role: "Последний запуск минуту назад", state: "ok", note: "Работают" },
    ],
    events: [
      { id: "e1", at: ago(now, 3 * MIN), kind: "order", text: "Заказ redis-cache перестал работать", who: "стенд idp · core" },
      { id: "e2", at: ago(now, 11 * MIN), kind: "order", text: "Создан заказ postgres-main", who: "Алексей Петров · data" },
      { id: "e3", at: ago(now, 16 * MIN), kind: "order", text: "Изменён заказ kafka-main", who: "Мария Иванова · data" },
      {
        id: "e4",
        at: ago(now, 22 * MIN),
        kind: "publication",
        text: "Redis 7.4.2 отправлен на согласование",
        who: "Сергей Волков · core",
      },
      { id: "e5", at: ago(now, 38 * MIN), kind: "publication", text: "Опубликован nginx 1.27.1", who: "platform" },
    ],
    inProgress: [
      {
        id: "p1",
        kind: "order",
        title: "postgres-main",
        where: "стенд idp · команда data",
        stage: "Разворачивается",
        startedAt: ago(now, 4 * MIN),
      },
      {
        id: "p2",
        kind: "order",
        title: "kafka-main",
        where: "стенд idp · команда data",
        stage: "Ждёт слияния merge request",
        startedAt: ago(now, 12 * MIN),
      },
      {
        id: "p3",
        kind: "stand_job",
        title: "Перевод заказов в «Только Git»",
        where: "стенд console-stand · Мария Иванова",
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

// User-facing text for the admin duty board. Draft wording: the final strings
// go through codex before the pull request (see .claude/rules/user-facing-text.md).
import { ruPlural } from "@/form/fieldErrors";

export const boardText = {
  title: "Администрирование платформы",

  tileOrders: "Новые заказы",
  tileOrdersSeries: "Новые заказы по дням",
  ordersTotalHint: (n: number) => `Всего заказов: ${n}`,
  tileActions: "Действия с заказами",
  tileActionsSeries: "Действия с заказами по дням",
  tileUsers: "Активные пользователи",
  tileUsersSeries: "Активные пользователи по дням",
  usersTotalHint: (n: number) => `Всего пользователей: ${n}`,
  tileOnline: "Пользователи онлайн",
  tileOnlineSeries: "Пользователи онлайн по часам",
  vsYesterday: (diff: number) => `${diff > 0 ? "+" : "−"}${Math.abs(diff)} к вчера`,
  sameAsYesterday: "Как вчера",
  peak: (n: number, at: string) => `Пик ${n} в ${at}`,
  noHistory: "История копится",

  attentionTitle: "Требует внимания",
  allGood: "Всё в порядке",
  allGoodHint: "Проблем не найдено.",
  liveUpdated: (ago: string) => `Обновлено ${ago}`,
  liveHint: "Страница обновляется сама, как только что-то меняется.",
  liveOffline: (time: string) => `Нет связи, данные от ${time}`,
  loadError: "Не удалось загрузить данные борда.",
  groupCritical: "Сбои",
  groupWarning: "Предупреждения",
  criticalCount: (n: number) => `${n} ${ruPlural(n, "сбой", "сбоя", "сбоев")}`,
  warningCount: (n: number) => `${n} ${ruPlural(n, "предупреждение", "предупреждения", "предупреждений")}`,
  showAll: (n: number) => `Все проблемы · ${n}`,
  attentionPanelSubtitle: (n: number) => `${n} ${ruPlural(n, "проблема", "проблемы", "проблем")}, сначала сбои`,
  close: "Закрыть",

  // What a problem is, by the code the server sends. A code the interface has
  // not learned yet shows as itself: a row nobody worded is still a problem.
  attentionCodes: {
    order_degraded: "Заказ не работает",
    order_argo_missing: "Приложения заказа нет в Argo CD",
    order_deploying_long: "Заказ долго разворачивается",
    order_merge_blocked: "Merge request не сливается",
    order_drifted: "Заказ расходится с Git",
    stand_checks_failed: "Стенд не прошёл проверки",
    stand_checks_warn: "У стенда есть замечания",
    storage_down: "Хранилище недоступно",
    job_failing: "Фоновая задача падает",
    config_fail: "Настройка не работает",
    config_warn: "Замечание к настройке",
    maintenance_scheduled: "Запланированы технические работы",
    maintenance_active: "Идут технические работы",
    maintenance_overdue: "Технические работы затянулись",
  } as Record<string, string>,
  componentDown: (name: string) => `${name} не отвечает`,
  maintenanceWhen: (code: string, iso: string) => {
    const d = new Date(iso);
    const at = d.toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    return code === "maintenance_scheduled" ? `Начало ${at}` : `Плановое завершение ${at}`;
  },

  metaLabel: {
    service: "Сервис",
    team: "Команда",
    stand: "Стенд",
    person: "Кто запустил",
    version: "Сервис в каталоге",
    setting: "Настройка",
    check: "Проверка",
    job: "Фоновая задача",
    time: "Когда",
  },
  openAction: {
    order: "Открыть заказ",
    stand: "Открыть стенд",
    integration: "Открыть состояние",
    job: "Открыть состояние",
    config: "Открыть настройку",
    publication: "Открыть публикацию",
    maintenance: "Открыть тех. работы",
  } as Record<string, string>,

  statusTitle: "Состояние платформы",
  statusMore: "Все системы и проверки",
  componentNames: { storage: "Хранилища", stands: "Стенды", jobs: "Фоновые задачи" } as Record<string, string>,
  componentRoles: {
    storage: "База портала и кеш",
    stands: "Проверки подключения стендов",
    jobs: "Проведение заказов, синхронизация и другие циклы",
  } as Record<string, string>,
  componentOk: { storage: "Доступны", stands: "В порядке", jobs: "Работают" } as Record<string, string>,
  componentOkDefault: "Доступен",
  componentDownNote: "Сбой",

  eventsTitle: "Последние события",
  eventsEmpty: "Пока ничего не происходило.",
  someone: "Кто-то",

  progressTitle: "Что происходит",
  progressEmpty: "Сейчас ничего не выполняется.",
  inProgressCount: (n: number) => `${n} в работе`,
  jobModeChange: (mode: string) => `Перевод заказов в «${mode}»`,
  jobModeChangeStage: "Переводит заказы",
  jobDelete: "Удаление стенда",
  jobDeleteStage: "Удаляет заказы",

  queueTitle: "Очередь согласования",
  queueAll: "Все заявки",
  queueCount: (n: number) => `${n} ${ruPlural(n, "ждёт", "ждут", "ждут")}`,
  queueNewVersion: "Новая версия",
  queueMetadata: "Категория и владелец",
};

// User-facing text for the admin duty board. The wording comes from codex
// (see .claude/rules/user-facing-text.md); edit it the same way.
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
  vsYesterday: (diff: number) => `${diff > 0 ? "+" : "−"}${Math.abs(diff)} со вчера`,
  sameAsYesterday: "Как вчера",
  peak: (n: number, at: string) => `Пик ${n} в ${at}`,
  noHistory: "Данные для графика ещё собираются.",

  attentionTitle: "Требует внимания",
  allGood: "Всё в порядке",
  allGoodHint: "Проблем не найдено.",
  liveUpdated: (ago: string) => `Обновлено ${ago}`,
  liveHint: "Страница обновляется сама, как только что-то меняется.",
  liveOffline: (time: string) => `Нет связи, данные от ${time}`,
  loadError: "Не удалось загрузить данные страницы.",
  groupCritical: "Сбои",
  groupWarning: "Предупреждения",
  criticalCount: (n: number) => `${n} ${ruPlural(n, "сбой", "сбоя", "сбоев")}`,
  warningCount: (n: number) => `${n} ${ruPlural(n, "предупреждение", "предупреждения", "предупреждений")}`,
  showAll: (n: number) => `Все проблемы · ${n}`,
  attentionPanelSubtitle: (n: number) => `${n} ${ruPlural(n, "проблема", "проблемы", "проблем")}. Сначала сбои.`,
  close: "Закрыть",

  // What a problem is, by the code the server sends. A code the interface has
  // not learned yet shows as itself: a row nobody worded is still a problem.
  attentionCodes: {
    order_degraded: "Заказ не работает",
    order_argo_missing: "Заказ не найден в Argo CD",
    order_deploying_long: "Заказ долго разворачивается",
    order_merge_blocked: "Не удаётся объединить merge request",
    order_drifted: "Заказ не соответствует настройкам в Git",
    stand_checks_failed: "Стенд не прошёл проверки",
    stand_checks_warn: "У стенда есть замечания",
    storage_down: "Хранилище недоступно",
    job_failing: "Фоновая задача завершается с ошибкой",
    config_fail: "Ошибка в настройке",
    config_warn: "Замечание к настройке",
    maintenance_scheduled: "Запланированы технические работы",
    maintenance_active: "Идут технические работы",
    maintenance_overdue: "Технические работы не завершены в срок",
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
    maintenance: "Открыть технические работы",
  } as Record<string, string>,

  statusTitle: "Состояние платформы",
  statusMore: "Все системы и проверки",
  componentNames: { storage: "Хранилища", stands: "Стенды", jobs: "Фоновые задачи" } as Record<string, string>,
  componentRoles: {
    storage: "Хранение данных портала",
    stands: "Проверки подключения стендов",
    jobs: "Обработка заказов и обновление данных",
  } as Record<string, string>,
  componentOk: { storage: "Доступны", stands: "В порядке", jobs: "Работают" } as Record<string, string>,
  componentOkDefault: "Доступен",
  componentDownNote: "Сбой",

  eventsTitle: "Последние события",
  eventsEmpty: "Событий пока нет.",
  someone: "Пользователь",

  progressTitle: "Что происходит",
  progressEmpty: "Сейчас ничего не выполняется.",
  inProgressCount: (n: number) => `${n} в работе`,
  jobModeChange: (mode: string) => `Перевод заказов в режим «${mode}»`,
  jobModeChangeStage: "Перевод заказов",
  jobDelete: "Удаление стенда",
  jobDeleteStage: "Удаление заказов",

  queueTitle: "Очередь согласования",
  queueAll: "Все заявки",
  queueCount: (n: number) => `${n} ${ruPlural(n, "ждёт", "ждут", "ждут")}`,
  queueNewVersion: "Новая версия сервиса",
  queueMetadata: "Категория и владелец",
};

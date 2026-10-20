// User-facing text for the admin duty board. Draft wording: the final strings
// go through codex before the page replaces the overview.
import { ruPlural } from "@/form/fieldErrors";

export const boardText = {
  title: "Администрирование платформы",
  draftNote: "Черновик дежурного борда. Данные на странице демонстрационные.",

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

  attentionTitle: "Требует внимания",
  allGood: "Всё в порядке",
  allGoodHint: "Проблем не найдено.",
  liveUpdated: (ago: string) => `Обновлено ${ago}`,
  liveHint: "Страница обновляется сама, как только что-то меняется.",
  liveOffline: (time: string) => `Нет связи, данные от ${time}`,
  showOffline: "Показать обрыв связи",
  showOnline: "Вернуть связь",
  groupCritical: "Сбои",
  groupWarning: "Предупреждения",
  criticalCount: (n: number) => `${n} ${ruPlural(n, "сбой", "сбоя", "сбоев")}`,
  warningCount: (n: number) => `${n} ${ruPlural(n, "предупреждение", "предупреждения", "предупреждений")}`,
  showAll: (n: number) => `Все проблемы · ${n}`,
  attentionPanelSubtitle: (n: number) => `${n} ${ruPlural(n, "проблема", "проблемы", "проблем")}, сначала сбои`,
  close: "Закрыть",
  metaLabel: {
    service: "Сервис",
    team: "Команда",
    stand: "Стенд",
    person: "Кто запустил",
    version: "Версия",
    setting: "Настройка",
    check: "Проверка",
    time: "Когда",
  },
  openAction: {
    order: "Открыть заказ",
    stand: "Открыть стенд",
    integration: "Открыть состояние",
    config: "Открыть настройку",
    publication: "Открыть публикацию",
    maintenance: "Открыть тех. работы",
  },
  since: (when: string) => `с ${when}`,
  showEmpty: "Показать пустое состояние",
  showProblems: "Показать проблемы",

  statusTitle: "Состояние платформы",
  statusMore: "Все системы и проверки",

  eventsTitle: "Последние события",

  progressTitle: "Что происходит",
  progressEmpty: "Сейчас ничего не выполняется.",

  queueTitle: "Очередь согласования",
  queueAll: "Все заявки",
  queueCount: (n: number) => `${n} ${ruPlural(n, "ждёт", "ждут", "ждут")}`,
  inProgressCount: (n: number) => `${n} в работе`,
};

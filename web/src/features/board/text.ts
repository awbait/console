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
  checkedAt: (time: string) => `Проверено в ${time}`,
  allGood: "Всё в порядке",
  allGoodHint: (time: string) => `Последняя проверка в ${time}. Проблем не найдено.`,
  groupCritical: "Сбои",
  groupWarning: "Предупреждения",
  criticalCount: (n: number) => `${n} ${ruPlural(n, "сбой", "сбоя", "сбоев")}`,
  warningCount: (n: number) => `${n} ${ruPlural(n, "предупреждение", "предупреждения", "предупреждений")}`,
  showMore: (n: number) => `Показать ещё ${n}`,
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
  statusMore: "Подробнее",

  eventsTitle: "Последние события",

  progressTitle: "Что происходит",
  progressEmpty: "Сейчас ничего не выполняется.",

  queueTitle: "Очередь согласования",
  queueAll: "Все заявки",
  queueReview: "Рассмотреть",
};

// User-facing text for the admin duty board. Draft wording: the final strings
// go through codex before the page replaces the overview.
export const boardText = {
  title: "Администрирование платформы",
  draftNote: "Черновик дежурного борда. Данные на странице демонстрационные.",

  tileOrders: "Новые заказы сегодня",
  tileOrdersSeries: "Новые заказы по дням",
  tileActions: "Действия с заказами сегодня",
  tileActionsSeries: "Действия с заказами по дням",
  tileUsers: "Активные пользователи сегодня",
  tileUsersSeries: "Активные пользователи по дням",
  tileOnline: "Онлайн сейчас",
  tileOnlineSeries: "Пользователи онлайн по часам",
  total: (n: number) => `всего ${n}`,

  attentionTitle: "Требует внимания",
  checkedAt: (time: string) => `Проверено в ${time}`,
  allGood: "Всё в порядке",
  allGoodHint: (time: string) => `Последняя проверка в ${time}. Проблем не найдено.`,
  severityCritical: "Сбой",
  severityWarning: "Внимание",
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

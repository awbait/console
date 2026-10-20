// User-facing text for the admin duty board. Draft wording: the final strings
// go through codex before the page replaces the overview.
export const boardText = {
  title: "Администрирование платформы",
  draftNote: "Черновик дежурного борда. Данные на странице демонстрационные.",

  tileOrders: "Заказы",
  tileOrdersHint: "Новые заказы по дням",
  tileActions: "Действия с заказами",
  tileActionsHint: "Действия пользователей по дням",
  tileUsers: "Активные пользователи",
  tileUsersHint: "Вход в портал по дням",
  tileOnline: "Сейчас онлайн",
  tileOnlineHint: "Пользователи онлайн за сутки",
  today: "сегодня",
  ofTotal: "из",

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

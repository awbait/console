// User-facing wording of copying an order to another stand: the menu item,
// the panel, the toast and the history entry. Kept in one place so the list,
// the order page and the timeline say it the same way.
export const copyText = {
  menuItem: "Скопировать на стенд",
  dialogTitle: "Скопировать заказ на стенд",
  dialogIntro:
    "Вы создадите на выбранном стенде черновик того же сервиса и версии в той же команде. Портал заново подставит значения из переменных для нового стенда, а остальные значения сохранит.",
  standLabel: "Стенд",
  standDescription: "Выберите стенд для нового черновика.",
  clusterDescription: "Подставлен кластер по умолчанию выбранного стенда. При необходимости укажите другой.",
  nameLabel: "Имя сервиса",
  nameDescription:
    "Подставлено имя исходного заказа. Если кластер и namespace остаются прежними, укажите другое имя.",
  submit: "Создать черновик",
  busy: "Создаём черновик…",
  toast: (stand: string) => `Черновик создан на стенде «${stand}».`,
  eventLabel: "Черновик скопирован из другого заказа",
  eventDetail: (source: string) => `Исходный заказ: «${source}».`,
  activity: (stand: string) => `скопировал заказ на стенд «${stand}»`,
} as const;

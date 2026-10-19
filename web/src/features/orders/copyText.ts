// User-facing wording of copying an order, to its own stand or another: the
// menu item, the panel, the toast and the history entry. Kept in one place so
// the list, the order page and the timeline say it the same way.
export const copyText = {
  menuItem: "Создать копию",
  dialogTitle: "Создать копию заказа",
  dialogIntro:
    "Создайте черновик на основе этого заказа на том же или другом стенде. Проверьте параметры перед отправкой.",
  standLabel: "Стенд",
  standDescription: "Выберите стенд для копии. Можно оставить стенд исходного заказа или выбрать другой.",
  clusterLabel: "Кластер",
  clusterSameStand: "Выбран кластер исходного заказа. При необходимости выберите другой кластер этого стенда.",
  clusterOtherStand: "Выбран кластер по умолчанию для этого стенда. При необходимости выберите другой.",
  nameLabel: "Имя сервиса",
  nameSameStand: "Укажите новое имя сервиса для копии на этом стенде.",
  nameOtherStand: "Можно сохранить имя исходного заказа или указать новое.",
  namespaceLabel: "Namespace",
  namespaceFollowsName: "Namespace повторяет имя сервиса. Если нужно, укажите свой.",
  namespaceKept: "Подставлен namespace исходного заказа. При необходимости измените его.",
  versionNote: (from: string, to: string) =>
    `Версия ${from} больше недоступна для заказа. Копия будет создана на последней доступной версии ${to}.`,
  submit: "Создать черновик",
  busy: "Создаём черновик…",
  toast: (stand: string) => `Черновик создан на стенде «${stand}».`,
  eventLabel: "Создан черновик на основе заказа",
  eventDetail: (source: string) => `Исходный заказ: «${source}».`,
  // The same panel on a deleted order, which it restores as a new draft.
  restoreMenuItem: "Восстановить заказ",
  restoreTitle: "Восстановить удалённый заказ",
  restoreIntro:
    "Создайте новый черновик на основе удалённого заказа в той же команде. Проверьте параметры перед отправкой. Удалённый заказ останется удалённым.",
  restoreDataNote:
    "Восстановятся только параметры заказа. Содержимое баз, томов и другие данные сервиса в кластере не вернутся.",
  restoreStandGone: "Стенд удалённого заказа тоже удалён, поэтому выбран стенд по умолчанию.",
  restoreName:
    "Подставлено имя удалённого заказа. Можно сохранить его или указать новое. Если имя уже занято, укажите другое.",
  restoreEventLabel: "Черновик восстановлен из удалённого заказа",
} as const;

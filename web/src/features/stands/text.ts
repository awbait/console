// User-facing wording of everything stands show: the admin page, the order
// form's selector, the orders list and the order page. Kept in one place so the
// same word is used wherever a stand is named.
export const standText = {
  navLabel: "Стенды",
  quickLinkDesc: "настройки стендов",
  pageIntro:
    "Стенд - общее место, куда отправляются заказы сервисов. Здесь вы можете добавить стенд, указать для него кластер по умолчанию и выбрать стенд по умолчанию. При выборе стенда кластер подставится в форму заказа, но вы можете изменить его.",
  emptyList: "Стендов пока нет. Добавьте первый стенд, чтобы пользователи могли указывать его в заказах.",
  namePlaceholder: "dev",
  clusterPlaceholder: "in-cluster",
  nameAria: "Название стенда",
  clusterAria: "Кластер по умолчанию",
  clusterHint: "Этот кластер подставляется в форму заказа для выбранного стенда.",
  defaultBadge: "По умолчанию",
  defaultHint: "Если стенд не выбран, заказ попадёт сюда.",
  makeDefault: "Сделать по умолчанию",
  toastCreated: (name: string) => `Стенд «${name}» добавлен.`,
  toastSaved: (name: string) => `Изменения стенда «${name}» сохранены.`,
  toastDefault: (name: string) => `Стенд «${name}» выбран по умолчанию.`,
  orderStandLabel: "Стенд",
  orderStandDescription: "Выберите, куда отправить заказ. При смене стенда кластер ниже подставится заново.",
  orderClusterDescription:
    "Кластер назначения в Argo CD. Он подставлен из выбранного стенда, при необходимости укажите другой.",
  noStands: "Стендов пока нет. Попросите администратора добавить стенд.",
  tableColumn: "Стенд",
  filterLabel: "Стенды",
  filterSearch: "Найти стенд...",
  detailField: "Стенд",
} as const;

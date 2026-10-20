// User-facing wording of everything stands show: the admin page, the order
// form's selector, the orders list and the order page. Kept in one place so the
// same word is used wherever a stand is named.
export const standText = {
  navLabel: "Стенды",
  pageIntro: "Стенд задаёт среду для заказов, например dev, test или prod. Каждый заказ относится к одному стенду.",
  emptyList: "Стендов пока нет. Добавьте первый стенд, чтобы пользователи могли отправлять на него заказы.",
  namePlaceholder: "dev",
  clusterPlaceholder: "in-cluster",
  nameAria: "Название стенда",
  clusterAria: "Кластер по умолчанию",
  clusterHint: "Укажите кластер, который будет выбран в форме заказа для этого стенда. Пользователь сможет выбрать другой.",
  defaultBadge: "По умолчанию",
  defaultHint: "При открытии формы заказа этот стенд уже выбран.",
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
  layoutLabel: "Хранение в GitLab",
  layoutGroup: "Отдельные репозитории",
  layoutRepository: "Общий репозиторий",
  layoutGroupHint:
    "В группе стенда каждая команда получает свою подгруппу, а каждый сервис свой репозиторий. Доступ в GitLab настраивается отдельно для каждой команды.",
  layoutRepositoryHint:
    "Все команды используют один репозиторий стенда с папками для команд и сервисов. Доступ в GitLab общий, без разделения по командам.",
  pathLabel: "Путь в GitLab",
  pathPlaceholder: "managed-services/stage",
  pathHint:
    "Укажите полный путь группы для варианта «Отдельные репозитории» или репозитория для варианта «Общий репозиторий», например managed-services/stage. Если группы или репозитория нет, портал создаст их при первом заказе, но родительская группа должна уже существовать.",
  lockedHint:
    "Способ хранения в GitLab и путь нельзя изменить, пока на стенде есть заказы. Черновики и удалённые заказы не учитываются.",
  modeLabel: "Обработка заказов",
  modeDeploy: "Развёртывание",
  modeGit: "Только GitLab",
  modeConsole: "Только портал",
  modeHint: "Режим определяет, где сохраняются заказы и разворачиваются ли сервисы на стенде.",
  modeDeployHint:
    "Портал сохраняет файлы заказа в GitLab и открывает merge request. После слияния Argo CD стенда разворачивает сервис, а портал показывает его статус.",
  modeGitHint:
    "Портал сохраняет файлы заказа в GitLab и открывает merge request. После слияния заказ получает статус «Сохранён в Git», а сервис нужно развернуть самостоятельно.",
  modeConsoleHint:
    "Заказ хранится только в портале, файлы в GitLab не отправляются. Изменения вступают в силу сразу, без merge request.",
  deployLeaveHint:
    "Чтобы сменить режим «Развёртывание», сначала удалите заказы стенда. Черновики и удалённые заказы не мешают смене режима.",
  jobRunningHint:
    "Заказы переходят в новый режим. Пока переход не завершён или не остановлен, изменить режим, способ хранения в GitLab и путь нельзя.",
  jobsTitle: "Задачи стенда",
  jobsIntro: "Здесь показаны задачи перевода заказов в другой режим. Перевод идёт в фоне, задачу можно остановить.",
  jobModeChange: (from: string, to: string) => `Перевод заказов из режима «${from}» в режим «${to}»`,
  jobProgress: (done: number, total: number) => `Переведено заказов: ${done} из ${total}.`,
  jobStatusRunning: "Идёт",
  jobStatusDone: "Завершена",
  jobStatusStopped: "Остановлена",
  jobFailuresTitle: "Не удалось перевести",
  jobStop: "Остановить задачу",
  jobStopConfirm:
    "Остановить задачу? Уже переведённые заказы останутся в новом режиме, остальные сохранят прежний режим.",
  jobStoppedToast: "Задача перевода заказов остановлена.",
  jobStartedToast: (name: string) => `Запущена задача перевода заказов стенда «${name}».`,
  jobWaitingMerge: "Часть заказов ожидает слияния запросов в Git.",
  jobNone: "На этом стенде ещё не было задач.",
  rowJobBadge: (done: number, total: number) => `Перевод: ${done} из ${total}`,
  rowDeleteBadge: (done: number, total: number) => `Удаление: ${done} из ${total}`,
  deleteButton: "Удалить",
  deleteDisabledDefault: "Сначала назначьте другой стенд по умолчанию.",
  deleteDisabledLast: "Нельзя удалить последний стенд.",
  deleteDisabledJob: "Дождитесь завершения текущей задачи стенда или остановите её.",
  deleteTitle: (name: string) => `Удалить стенд «${name}»?`,
  deleteMessage:
    "Портал удалит все заказы стенда, а Argo CD удалит развёрнутые сервисы. Это займёт время. Затем портал удалит сам стенд, значения его переменных и группу или репозиторий в GitLab, которые он создал. В Argo CD вам нужно будет вручную удалить ApplicationSet и секреты стенда. Отменить удаление нельзя.",
  deleteNameLabel: (name: string) => `Для подтверждения введите имя стенда «${name}».`,
  deleteNameMismatch: "Введённое имя не совпадает с именем стенда.",
  deleteConfirm: "Удалить стенд",
  deleteStartedToast: (name: string) => `Запущена задача удаления стенда «${name}».`,
  jobDelete: "Удаление стенда",
  jobDeleteKept:
    "Не удалось удалить часть заказов, поэтому стенд остался. Причины указаны в списке заказов задачи. Удалите эти заказы вручную и запустите удаление стенда снова.",
  jobDeleteProgress: (done: number, total: number) => `Удалено заказов: ${done} из ${total}`,
  modeChangeConfirm: (to: string) =>
    `Перевести стенд в режим «${to}»? Новые заказы сразу будут использовать этот режим. Переход существующих заказов займёт время, его можно остановить. До завершения или остановки перехода изменить режим, способ хранения в GitLab и путь нельзя.`,
  registryLabel: "Реестр чартов для Argo CD",
  registryPlaceholder: "harbor.example.com",
  registryHint:
    "Если Argo CD берёт чарты из другого реестра, укажите его адрес: проект, имя и версия чартов должны совпадать с Harbor платформы. Оставьте поле пустым, чтобы использовать Harbor платформы.",
  errRegistry: "Укажите адрес реестра в формате harbor.example.com.",
  gitUrlLabel: "Адрес GitLab для Argo CD",
  gitUrlPlaceholder: "https://gitlab.edp.example.com",
  gitUrlHint:
    "Если Argo CD читает файлы из другого GitLab, укажите его адрес, например https://gitlab.edp.example.com, с теми же путями к репозиториям. Оставьте поле пустым, чтобы использовать GitLab, в который портал сохраняет заказы.",
  errGitUrl: "Укажите адрес GitLab с http:// или https://, например https://gitlab.edp.example.com.",
  argoNsLabel: "Namespace Argo CD",
  argoNsPlaceholder: "ecpk-argocd",
  argoNsHint:
    "Укажите namespace, в котором установлен Argo CD этого стенда. Оставьте поле пустым, чтобы использовать namespace из настроек платформы.",
  errArgoNs: "Укажите namespace, например ecpk-argocd. Используйте строчные латинские буквы, цифры и дефис.",
  argoProjectLabel: "Проект Argo CD",
  argoProjectPlaceholder: "managed-services",
  argoProjectHint:
    "Укажите проект Argo CD для приложений заказов этого стенда. Оставьте поле пустым, чтобы использовать проект из настроек платформы.",
  errArgoProject:
    "Укажите имя проекта не длиннее 63 символов, например managed-services. Используйте строчные латинские буквы, цифры и дефис.",
  argoProjectChangeConfirm:
    "При смене проекта Argo CD уже размещённые заказы не перейдут в новый проект сразу. Каждый заказ получит новый проект, когда портал заново запишет его application.yaml при следующем изменении или обновлении заказа. Убедитесь, что новый проект существует в Argo CD, в нём разрешены репозиторий и кластеры стенда, а учётная запись портала может читать и синхронизировать приложения этого проекта. Заказы, созданные со старым проектом, портал больше не распознает как свои при импорте из Git.",
  orderNoteGit:
    "Портал сохранит файлы заказа в Git и откроет merge request, после слияния которого заказ получит статус «Сохранён в Git». Файлы нужно применить вне портала, сервис на этом стенде не разворачивается.",
  orderNoteConsole:
    "Заказ сразу получит статус «Сохранён в консоли» и будет храниться только в портале. Файлы в Git не создаются, сервис не разворачивается.",
  openPage: "Открыть стенд",
  pageTitle: (name: string) => `Стенд «${name}»`,
  checksTitle: "Проверки стенда",
  checksIntro: "Портал выполняет проверки при открытии страницы, а кнопка «Проверить снова» запускает их повторно.",
  checksRerun: "Проверить снова",
  checkGit: "Доступ к пути в GitLab",
  checkProject: "Проект стенда в Argo CD",
  checkCluster: "Кластеры стенда в Argo CD",
  checkArgo: "Видимость приложений стенда в Argo CD",
  checkNesting: "Вложенные пути",
  checkedAgo: (ago: string) => `Проверено ${ago}`,
  neverChecked: "Проверка ещё не выполнялась",
  argoNotConnected: "Argo CD не подключён",
  argoConnected: "Argo CD видит приложения стенда",
  waitingTitle: "Стенд ещё не подключён к Argo CD",
  waitingHint: "Заказ принят и сохранён в Git. Разворачивание начнётся, когда администратор подключит стенд к Argo CD.",
  waitingAdminLink: "Манифесты на странице стенда",
  statusSectionTitle: "Стенды",
  statusSectionHint:
    "Здесь показаны результаты последних проверок стендов. Статус каждой карточки определяется по худшему результату.",
  manifestsTitle: "Манифесты для Argo CD",
  manifestsIntro:
    "Здесь собраны манифесты ApplicationSet или Application для способа хранения в GitLab «Общий репозиторий» и секреты с токенами GitLab. Портал ничего не создаёт в Argo CD. Замените заглушки токенами GitLab и примените манифесты вручную один раз для этого стенда.",
  manifestsCopy: "Скопировать манифесты",
  manifestsCopied: "Манифесты скопированы.",
  pathMissing: "Укажите путь в GitLab, чтобы отправлять заказы на стенд.",
  addButton: "Добавить стенд",
  addTitle: "Новый стенд",
  addSubmit: "Добавить стенд",
  editButton: "Настройки",
  editTitle: (name: string) => `Настройки стенда «${name}»`,
  editSubmit: "Сохранить",
  submitBusy: "Сохраняем...",
  groupMain: "Основные настройки",
  groupGit: "Хранение заказов",
  groupArgo: "Настройки Argo CD",
  columnState: "Состояние",
  stateConnected: "Подключён",
  stateNotConnected: "Не подключён",
  stateNotChecked: "Не проверен",
  stateReady: "Готов к заказам",
  stateNoPath: "Нет пути",
  moreActions: "Действия со стендом",
  errPathEmpty: "Обязательное поле.",
  errPath: "Используйте латинские буквы, цифры, точку, дефис, подчёркивание и разделитель «/».",
} as const;

// Why a stand check came out the way it did, by the reason the portal names.
export const standCheckReasons: Record<string, string> = {
  path_empty: "Путь в GitLab не задан, поэтому проверка не выполнена.",
  mode_git: "Стенд работает в режиме «Только GitLab» и не разворачивает сервисы, поэтому проверка Argo CD не выполнена.",
  nested_in_deploy:
    "Путь этого стенда находится внутри пути стенда в режиме «Развёртывание». Argo CD того стенда развернёт и файлы по этому пути.",
  contains_other:
    "Внутри пути этого стенда находится путь стенда в режиме «Только GitLab» или «Только портал». Argo CD этого стенда развернёт и файлы вложенного стенда.",
  mode_console: "Стенд хранит заказы только в портале, поэтому проверка не выполнена.",
  group_missing: "Группы по указанному пути пока нет, портал создаст её при первом заказе.",
  repo_missing: "Репозитория по указанному пути пока нет, портал создаст его при первом заказе.",
  repo_found: "Репозиторий найден и доступен токену портала.",
  forbidden: "У токена портала недостаточно прав для проверки.",
  not_member: "Учётная запись портала не входит в группу GitLab.",
  needs_owner: "Для создания подгрупп команд учётной записи портала нужна роль Owner в группе GitLab.",
  needs_maintainer:
    "Для работы с репозиториями и merge request учётной записи портала нужна роль не ниже Maintainer.",
  role_enough: "Прав учётной записи портала достаточно для работы с заказами стенда в GitLab.",
  not_configured: "Подключение к системе не настроено, поэтому проверка не выполнена.",
  unavailable: "Проверить не удалось: система не ответила на запрос.",
  cluster_missing: "В Argo CD зарегистрированы не все кластеры стенда, список недостающих показан рядом.",
  cluster_found: "Кластер по умолчанию и кластеры заказов стенда зарегистрированы в Argo CD.",
  no_orders: "На стенде нет заказов для проверки видимости приложений в Argo CD.",
  apps_missing: "Argo CD не видит приложения ни одного из проверенных заказов стенда.",
  apps_partial: "Argo CD видит приложения только части проверенных заказов стенда.",
  apps_found: "Argo CD видит приложения всех проверенных заказов стенда.",
  project_missing: "Проект не найден в Argo CD.",
  cannot_read:
    "Учётная запись портала не может читать приложения проекта в Argo CD. Поэтому портал видит приложения как отсутствующие, а заказы стенда выглядят удалёнными.",
  cannot_sync: "Учётная запись портала может читать приложения проекта в Argo CD, но не может их синхронизировать.",
  may_read_sync: "Проект найден в Argo CD. Учётная запись портала может читать и синхронизировать его приложения.",
};

// Why a stand job could not move an order, by the reason the portal names.
// "rejected" carries the portal's own sentence in the failure's detail.
export const standJobFailures: Record<string, string> = {
  mr_closed: "Merge request заказа закрыт без слияния.",
  upstream:
    "Не удалось перевести заказ из-за ошибки или отсутствия ответа GitLab или Argo CD. Повторно смените режим стенда, когда система снова станет доступна.",
};

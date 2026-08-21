// Wording for the admin configuration page.
//
// The backend sends variable names, values and accepted options; what each
// variable is *for* is written here, next to the rest of the product copy. A
// variable with no line here still renders - it just shows its name, value and
// default, which is what the page would have shown anyway.

export interface ConfigGroup {
  id: string;
  label: string;
  hint: string;
}

// Sections of the page, in reading order: the portal itself, then who gets in,
// then each upstream, then where state lives, then the background work, then
// what it writes to the outside.
export const CONFIG_GROUPS: ConfigGroup[] = [
  {
    id: "portal",
    label: "Портал",
    hint: "Адреса и порты самого портала.",
  },
  {
    id: "auth",
    label: "Вход и сессии",
    hint: "Подключение к Keycloak и то, сколько живёт сессия пользователя.",
  },
  {
    id: "rbac",
    label: "Роли и команды",
    hint: "Как группы пользователя из Keycloak превращаются в роли портала и команды.",
  },
  {
    id: "harbor",
    label: "Реестр чартов",
    hint: "Harbor: откуда портал берёт чарты, их версии и формы заказа.",
  },
  {
    id: "gitlab",
    label: "Git",
    hint: "GitLab: где заводятся репозитории команд и merge request заказов.",
  },
  {
    id: "argocd",
    label: "Выкатка",
    hint: "Argo CD: куда выкатываются заказы и откуда портал берёт их состояние.",
  },
  {
    id: "storage",
    label: "Хранилища",
    hint: "База данных портала и кеш.",
  },
  {
    id: "sync",
    label: "Обновление состояния",
    hint: "Как часто портал сверяется с внешними системами и какие фоновые задачи включены.",
  },
  {
    id: "observability",
    label: "Логи и метрики",
    hint: "Что портал пишет о себе наружу.",
  },
];

// What each variable does, in one sentence for the person reading the page.
export const CONFIG_TEXT: Record<string, string> = {
  // Портал
  HTTP_PORT: "Порт, на котором портал принимает запросы.",
  PUBLIC_URL: "Внешний адрес портала, по которому его открывают пользователи.",
  METRICS_PORT: "Отдельный порт для метрик. Не публикуется наружу вместе с порталом.",
  COOKIE_SECURE:
    "Отдавать cookie сессии только по HTTPS. Выключайте только для стенда без сертификата.",

  // Вход и сессии
  AUTH_MODE: "Способ входа. Рабочее значение одно - через Keycloak.",
  OIDC_ISSUER: "Адрес realm в Keycloak, через который входят пользователи.",
  OIDC_CLIENT_ID: "Идентификатор портала как клиента Keycloak.",
  OIDC_CLIENT_SECRET: "Секрет клиента портала в Keycloak.",
  OIDC_REDIRECT_URL: "Адрес, на который Keycloak возвращает пользователя после входа.",
  OIDC_POST_LOGIN_REDIRECT: "Куда отправить пользователя после успешного входа.",
  OIDC_POST_LOGOUT_REDIRECT: "Куда отправить пользователя после выхода.",
  OIDC_SCOPES: "Какие данные о пользователе портал запрашивает у Keycloak.",
  SESSION_SECRET: "Ключ шифрования сессии. Со стандартным значением портал не запустится.",
  SESSION_COOKIE_NAME: "Имя cookie, в которой хранится сессия.",
  SESSION_TTL: "Сколько живёт сессия пользователя без повторного входа.",

  // Роли и команды
  RBAC_ADMIN_GROUPS: "Группы Keycloak, дающие роль администратора платформы.",
  RBAC_SUPPORT_GROUPS: "Группы, дающие роль поддержки: доступ к заказам всех команд.",
  RBAC_SECURITY_GROUPS: "Группы, дающие роль информационной безопасности.",
  RBAC_TEAM_GROUP_PREFIX: "Префикс групп, из которых берутся команды пользователя.",
  RBAC_TEAM_GROUP_REGEX:
    "Выражение для нестандартной структуры групп. Если задано, используется вместо префикса.",

  // Реестр чартов
  HARBOR_URL: "Адрес Harbor.",
  HARBOR_ROBOT_USER: "Учётная запись робота, от имени которой портал читает чарты.",
  HARBOR_ROBOT_TOKEN: "Пароль робота Harbor.",
  HARBOR_PROJECTS: "Проекты Harbor, в которых портал ищет чарты.",
  HARBOR_WEBHOOK_SECRET:
    "Секрет входящих уведомлений Harbor. Пусто - портал узнаёт о новых чартах только опросом.",
  HARBOR_INSECURE_TLS: "Не проверять сертификат Harbor. Только для стендов.",
  HARBOR_TIMEOUT: "Сколько ждать ответа от Harbor.",
  CHART_REGISTRY: "Адрес реестра, который портал записывает в манифест заказа как источник чарта.",

  // Git
  GITLAB_URL: "Адрес GitLab.",
  GITLAB_TOKEN: "Токен, от имени которого портал создаёт репозитории и merge request.",
  GITLAB_TIMEOUT: "Сколько ждать ответа от GitLab.",
  GITLAB_AUTO_MERGE:
    "Сливать merge request заказа сразу после создания, без ревью. Сервис, версия которого требует проверки человеком, сливается вручную в любом случае.",
  GITLAB_GITOPS_GROUP: "Группа GitLab, в которой лежат репозитории команд.",
  GITLAB_TEAM_SUBGROUP_TEMPLATE: "Как называется подгруппа команды внутри этой группы.",
  GITLAB_INSTANCE_DIR_TEMPLATE:
    "Как называется папка заказанного сервиса внутри репозитория. Пусто - по имени сервиса. Заказ остаётся в своей папке, поэтому изменение действует только на новые заказы.",
  GITLAB_CREATE_TEAM_SUBGROUP:
    "Заводить подгруппу команды при первом заказе, если её ещё нет. Выключено - подгруппы создаёт кто-то другой, и до этого команда заказать не сможет.",
  GITLAB_DEFAULT_BRANCH: "Ветка, в которую портал вливает изменения заказов.",
  GITLAB_WEBHOOK_TOKEN:
    "Токен входящих уведомлений GitLab. Пусто - портал узнаёт о слиянии только опросом.",
  GITLAB_WEBHOOK_URL:
    "Адрес, по которому GitLab шлёт уведомления порталу. Если он задан, портал заводит вебхук сам, в том числе на новых репозиториях.",
  GITLAB_WEBHOOK_SCOPE:
    "Где заводится этот вебхук: на всей группе, на всём GitLab или на каждом репозитории.",

  // Выкатка
  ARGOCD_URL: "Адрес Argo CD.",
  ARGOCD_TOKEN: "Токен, от имени которого портал читает состояние приложений.",
  ARGOCD_PROJECT: "Проект Argo CD, в который попадают заказы портала.",
  ARGOCD_NAMESPACE:
    "Namespace, в котором работает Argo CD. Портал пишет его в каждый заказ: приложения из чужого namespace Argo CD не видит.",
  ARGOCD_DEFAULT_CLUSTER: "Кластер, в который выкатываются заказы по умолчанию.",
  ARGOCD_APP_NAME_TEMPLATE: "Как строится имя приложения Argo CD для заказа.",

  // Хранилища
  STORE: "Где портал хранит заказы, публикации и категории.",
  CACHE: "Где портал держит кеш файлов чартов.",
  DATABASE_URL: "Подключение к базе данных портала.",
  DATABASE_MAX_CONNS: "Сколько одновременных подключений к базе разрешено.",
  REDIS_URL: "Подключение к кешу.",

  // Обновление состояния
  STATUS_UPDATE_MODE:
    "Как портал узнаёт об изменениях: опросом с уведомлениями (hybrid) или только по уведомлениям (webhook).",
  STATUS_POLL_INTERVAL: "Как часто портал сверяется с внешними системами.",
  DRIFT_DETECTION_ENABLED: "Отмечать заказы, чьи файлы изменили в Git мимо портала.",
  IMPORT_DISCOVERY_ENABLED: "Добавлять в список заказов сервисы, заведённые в Git напрямую.",
  CATALOG_AUTODISCOVER: "Заводить черновики публикаций для чартов, найденных в реестре.",

  // Логи и метрики
  LOG_LEVEL: "Насколько подробно портал пишет журнал.",
  LOG_FORMAT: "Формат журнала: машинный JSON или читаемый текст.",
  GRAFANA_URL: "Адрес Grafana для ссылки на графики. Пусто - ссылки нет.",
};

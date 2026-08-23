// Тексты проверок настройки, в словах, которые читает человек.
//
// Бэкенд (internal/checks) отдаёт только идентификаторы: что проверяли, чем
// закончилось и какие факты увидели. Ни одного предложения он не собирает - так
// же, как для возможностей портала (см. capabilities.ts).
//
// Проверка показывается на странице «Конфигурация», в строке той переменной, о
// которой она. Поэтому здесь нет названия проверки: название строки - это имя
// переменной, а что она делает, уже написано в configText.ts. Отсюда берутся
// только три вещи: что увидели, что с этим делать и как назвать факты.

export type CheckVerdict = "ok" | "warn" | "fail" | "skip" | "unknown";

// Что увидели. Ключ вида «проверка.причина» уточняет общий текст: «не
// настроено» у вебхука GitLab и у секрета Harbor значат разное.
const REASONS: Record<string, string> = {
  // что подтвердили, когда всё в порядке. Зелёная отметка без единого слова -
  // это лампочка, по которой не прочитать, проверил портал что-нибудь или
  // просто не нашёл, к чему придраться.
  "gitlab_token.token_valid": "Токен принадлежит порталу, права api есть, срок в запасе.",
  "gitlab_group.role_enough": "Группа на месте, роли портала в ней хватает на то, что он делает.",
  "gitlab_webhook.hook_live": "Вебхук зарегистрирован, подписан на merge request и не отключён.",
  "gitlab_webhook.delivering": "Уведомления доходят, ни одно не отклонено.",
  "harbor_webhook.delivering": "Уведомления доходят, ни одно не отклонено.",
  "harbor_projects.charts_readable": "Проекты видны порталу, чарты и их версии читаются.",
  "harbor_webhook.policy_found": "В Harbor есть включённая политика, которая шлёт уведомления сюда.",
  "argocd_project.project_exists": "Проект есть в Argo CD.",
  "argocd_cluster.cluster_found": "Кластер зарегистрирован в Argo CD.",
  "argocd_permissions.may_read_sync": "Токен читает приложения проекта и может их синхронизировать.",
  "argocd_namespace.namespace_match": "Совпадает с тем namespace, из которого Argo CD читает приложения.",
  "keycloak_groups_claim.groups_ok": "Группы приходят в токене и разбираются в команды и роли.",

  // общее
  upstream_down: "Система не отвечает, поэтому проверить не удалось.",
  unavailable: "Проверить не удалось: система не ответила на запрос.",
  forbidden: "Прав портала не хватает, чтобы это посмотреть.",
  not_configured: "Не настроено.",

  // шаблоны и режимы
  "instance_dir_template.not_unique":
    "Шаблон не различает сервисы. Два заказа одной команды и чарта попадут в одну папку и перезапишут файлы друг друга.",
  "instance_dir_template.bad_template": "Шаблон не разбирается.",
  "app_name_template.not_unique":
    "Шаблон не различает сервисы. Два заказа дадут одно имя приложения, и Argo CD применит только один.",
  "app_name_template.team_collision":
    "Шаблон не различает команды. Заказы разных команд могут дать одно имя приложения.",
  "app_name_template.chart_collision":
    "Шаблон не различает чарты. Заказы разных чартов могут дать одно имя приложения.",
  "app_name_template.bad_template": "Шаблон не разбирается.",

  // GitLab
  "gitlab_token.missing_scope": "У токена нет прав api. Первый же заказ на нём остановится.",
  "gitlab_token.expired": "Срок токена истёк.",
  "gitlab_token.expires_soon": "Срок токена скоро истечёт.",
  "gitlab_token.revoked": "Токен отозван.",
  "gitlab_token.no_introspection":
    "GitLab не показывает права и срок этого токена. Так бывает с групповыми токенами.",
  "gitlab_group.group_missing": "Группы с таким путём в GitLab нет.",
  "gitlab_group.forbidden": "Группа есть, но токен её не видит.",
  "gitlab_group.needs_owner":
    "Создание подгрупп команд включено, а роли Owner у токена нет. Первый заказ новой команды не пройдёт.",
  "gitlab_group.needs_maintainer":
    "Роли токена не хватает, чтобы заводить репозитории и открывать merge request.",
  "gitlab_group.not_member": "Учётной записи портала нет среди участников группы.",
  "gitlab_webhook.not_configured": "Уведомления из GitLab не настроены, портал узнаёт о слияниях опросом.",
  "gitlab_webhook.url_without_token":
    "Задан адрес, но не задан секрет. Без секрета портал не регистрирует вебхук вовсе.",
  "gitlab_webhook.token_without_url":
    "Задан секрет, но не задан адрес. Портал примет доставки, но регистрировать вебхук будет некому.",
  "gitlab_webhook.path_mismatch": "Адрес ведёт не на приёмник уведомлений портала.",
  "gitlab_webhook.not_registered": "Вебхук не удалось зарегистрировать ни на одном уровне.",
  "gitlab_webhook.hook_missing": "В GitLab такого вебхука нет. Похоже, его удалили после запуска портала.",
  "gitlab_webhook.hook_disabled": "GitLab отключил вебхук после неудачных доставок.",
  "gitlab_webhook.hook_not_mr": "Вебхук не подписан на события merge request.",
  "gitlab_webhook.partial_coverage":
    "Вебхук стоит не на всех репозиториях группы. О слияниях в остальных портал узнаёт опросом.",
  "gitlab_webhook.secret_mismatch":
    "Все доставки отклонены: секрет в портале и секрет в GitLab не совпадают.",
  "gitlab_webhook.some_rejected": "Часть доставок отклонена по секрету.",
  "gitlab_webhook.scheme_mismatch": "Протокол адреса не совпадает с протоколом портала.",
  "gitlab_webhook.host_mismatch":
    "Адрес ведёт на другой хост. Так и должно быть, если GitLab обращается к порталу по внутреннему имени.",

  // Harbor
  "harbor_projects.projects_missing": "В Harbor нет проекта из списка.",
  "harbor_projects.projects_hidden": "Проект из списка не виден под учётной записью портала.",
  "harbor_projects.no_repositories": "Проекты читаются, но чартов в них нет. Каталог будет пустым.",
  "harbor_projects.no_artifacts":
    "Список репозиториев читается, а сами чарты нет. В каталоге они будут без версий.",
  "harbor_projects.not_configured": "Список проектов пуст, каталогу неоткуда собираться.",
  "harbor_webhook.not_configured": "Уведомления из Harbor не настроены, новые версии портал находит опросом.",
  "harbor_webhook.no_policy": "В портале секрет задан, а в Harbor нет политики вебхука, которая шлёт сюда уведомления.",
  "harbor_webhook.policy_disabled": "Политика вебхука есть, но выключена.",
  "harbor_webhook.missing_event": "Политика есть, но не подписана на публикацию артефакта.",
  "harbor_webhook.forbidden": "Учётной записи портала не хватает прав, чтобы посмотреть политики вебхуков.",
  "harbor_webhook.secret_mismatch":
    "Все доставки отклонены: секрет в портале и секрет в Harbor не совпадают.",
  "harbor_webhook.some_rejected": "Часть доставок отклонена по секрету.",

  // Argo CD
  "argocd_project.project_missing":
    "Проекта с таким именем в Argo CD нет. Заказ дойдёт до слияния и остановится уже за пределами портала.",
  "argocd_permissions.cannot_read": "Токен не может читать приложения проекта. Состояние заказов будет пустым.",
  "argocd_permissions.cannot_sync":
    "Токен не может запускать синхронизацию. Кнопка синхронизации на странице заказа не сработает.",
  "argocd_cluster.cluster_missing": "Кластера с таким именем в Argo CD нет.",
  "argocd_namespace.namespace_diff":
    "Портал пишет приложения не в тот namespace, из которого их читает Argo CD. Заказ уедет в Git, а сервис не поднимется.",

  // Keycloak
  "keycloak_groups_claim.no_groups":
    "В токене не пришло ни одной группы. Все входящие получают роль наблюдателя.",
  "keycloak_groups_claim.no_teams": "Группы приходят, но ни одна не подошла под правило команд.",
  "keycloak_groups_claim.roles_unmapped":
    "Группы администраторов не заданы. Роль администратора платформы не сможет получить никто.",
};

// Что с этим делать. Пишется для того, кто держит настройку в руках: одно
// действие, названное конкретно, и запасной вариант, если действие невозможно.
// Без него страница ставит диагноз и оставляет человека с ним наедине.
const ACTIONS: Record<string, string> = {
  "instance_dir_template.not_unique":
    "Добавьте в шаблон {{.ServiceName}}. Заказы, созданные раньше, остаются в своих папках.",
  "instance_dir_template.bad_template": "Проверьте шаблон: он должен быть шаблоном Go, например {{.Namespace}}-{{.ServiceName}}.",
  "app_name_template.not_unique": "Добавьте в шаблон {{.ServiceName}}.",
  "app_name_template.team_collision": "Добавьте в шаблон {{.Team}}.",
  "app_name_template.chart_collision": "Добавьте в шаблон {{.Chart}}.",
  "app_name_template.bad_template": "Проверьте шаблон: он должен быть шаблоном Go, например {{.Team}}-{{.Chart}}-{{.ServiceName}}.",

  "gitlab_token.missing_scope": "Выпустите токен с правами api и пропишите его заново.",
  "gitlab_token.expired": "Выпустите новый токен и пропишите его заново.",
  "gitlab_token.expires_soon": "Выпустите новый токен заранее, пока текущий работает.",
  "gitlab_token.revoked": "Выпустите новый токен и пропишите его заново.",

  "gitlab_group.group_missing": "Создайте группу в GitLab или укажите путь той, которая уже есть.",
  "gitlab_group.forbidden": "Дайте учётной записи портала доступ к группе.",
  "gitlab_group.needs_owner":
    "Дайте учётной записи портала роль Owner на этой группе. Если подгруппы команд заводит кто-то другой, выключите их создание.",
  "gitlab_group.needs_maintainer": "Дайте учётной записи портала роль Maintainer на этой группе.",
  "gitlab_group.not_member": "Добавьте учётную запись портала в группу.",

  "gitlab_webhook.url_without_token": "Задайте секрет и укажите его же в вебхуке на стороне GitLab.",
  "gitlab_webhook.token_without_url": "Укажите адрес, по которому GitLab достучится до портала, и портал заведёт вебхук сам.",
  "gitlab_webhook.path_mismatch": "Адрес должен заканчиваться на /api/v1/webhooks/gitlab.",
  "gitlab_webhook.not_registered":
    "Проверьте, что токену хватает прав на выбранный уровень: группа требует GitLab Premium, инстанс - администратора.",
  "gitlab_webhook.hook_missing": "Нажмите «Проверить сейчас»: портал заведёт вебхук заново.",
  "gitlab_webhook.hook_disabled": "Включите вебхук в GitLab и убедитесь, что портал доступен по указанному адресу.",
  "gitlab_webhook.hook_not_mr": "Включите у вебхука события merge request.",
  "gitlab_webhook.partial_coverage": "Нажмите «Проверить сейчас»: портал дозаведёт вебхуки в остальных репозиториях.",
  "gitlab_webhook.secret_mismatch": "Сверьте секрет портала с секретом вебхука в GitLab и приведите их к одному значению.",
  "gitlab_webhook.some_rejected": "Сверьте секреты: похоже, один из вебхуков остался со старым значением.",
  "gitlab_webhook.scheme_mismatch": "Приведите адрес вебхука к тому же протоколу, по которому открывается портал.",
  "gitlab_webhook.host_mismatch": "Если GitLab обращается к порталу по другому имени, всё в порядке. Иначе исправьте адрес.",

  "harbor_projects.projects_missing": "Создайте проект в Harbor или уберите его из списка.",
  "harbor_projects.projects_hidden": "Дайте роботу доступ к проекту на чтение.",
  "harbor_projects.no_repositories": "Опубликуйте чарты в этих проектах или укажите проекты, где они уже есть.",
  "harbor_projects.no_artifacts": "Дайте роботу право читать артефакты в этих проектах, а не только список репозиториев.",
  "harbor_projects.not_configured": "Перечислите проекты Harbor, из которых собирается каталог.",

  "harbor_webhook.no_policy":
    "Заведите в Harbor политику вебхука на адрес портала с событием публикации артефакта и тем же секретом.",
  "harbor_webhook.policy_disabled": "Включите политику вебхука в Harbor.",
  "harbor_webhook.missing_event": "Добавьте в политику событие публикации артефакта.",
  "harbor_webhook.secret_mismatch": "Сверьте секрет портала с заголовком авторизации в политике Harbor.",
  "harbor_webhook.some_rejected": "Сверьте секреты: похоже, одна из политик осталась со старым значением.",

  "argocd_project.project_missing": "Создайте проект в Argo CD или укажите тот, который уже есть.",
  "argocd_permissions.cannot_read": "Дайте токену право читать приложения этого проекта.",
  "argocd_permissions.cannot_sync": "Дайте токену право запускать синхронизацию приложений этого проекта.",
  "argocd_cluster.cluster_missing": "Зарегистрируйте кластер в Argo CD или укажите уже зарегистрированный.",
  "argocd_namespace.namespace_diff": "Укажите тот namespace, в котором работает Argo CD.",

  "keycloak_groups_claim.no_groups": "Добавьте группы в токен: нужен scope groups и соответствующий mapper в Keycloak.",
  "keycloak_groups_claim.no_teams": "Проверьте, что префикс команд совпадает с тем, как названы группы в Keycloak.",
  "keycloak_groups_claim.roles_unmapped": "Перечислите группы, которые дают роль администратора платформы.",
};

// Подписи фактов: что именно портал увидел.
const FACTS: Record<string, string> = {
  access: "Роль портала в группе",
  accepted: "Принято доставок",
  admin: "Администратор инстанса",
  actual: "На самом деле",
  alert_status: "Состояние вебхука",
  covered: "Репозиториев с вебхуком",
  days_left: "Дней до истечения",
  disabled: "Отключено вебхуков",
  examined: "Проверено репозиториев",
  expected_event: "Нужное событие",
  expected_path: "Нужный путь",
  expected_url: "Нужный адрес",
  expires_at: "Срок токена",
  group_id: "Идентификатор группы",
  groups: "Групп в токене",
  hidden: "Не видны",
  hook_id: "Идентификатор вебхука",
  last_accepted: "Последняя доставка",
  last_rejected: "Последняя отклонённая",
  last_sign_in: "Последний вход",
  missing: "Нет в Harbor",
  mode: "Режим обновления",
  project_id: "Идентификатор репозитория",
  projects: "Проекты",
  public_url: "Адрес портала",
  read: "Чтение приложений",
  registered: "Зарегистрированы",
  rejected: "Отклонено доставок",
  repositories: "Репозиториев",
  repository: "Репозиторий",
  required: "Нужна роль не ниже",
  role: "Полученная роль",
  rbac_scope: "Область прав",
  scope: "Уровень вебхука",
  scopes: "Права токена",
  server: "Адрес кластера",
  since: "Считаем доставки с",
  sync: "Синхронизация",
  teams: "Команд определилось",
  uncovered: "Репозиториев без вебхука",
  unreadable: "Не удалось посмотреть",
  user: "Учётная запись",
  waited_ms: "Ждали, мс",
};

// Итог проверки одним словом.
const VERDICTS: Record<CheckVerdict, string> = {
  ok: "Работает",
  warn: "Стоит поправить",
  fail: "Не работает",
  skip: "Не используется",
  unknown: "Не проверено",
};

// Результат проверки доставки по кнопке.
const DELIVERY_OUTCOMES: Record<string, string> = {
  delivered: "Доставка дошла. Адрес, сеть и секрет в порядке.",
  rejected: "Доставка дошла, но портал её отклонил. Секреты в портале и в GitLab разные.",
  not_delivered: "Доставка не дошла за 10 секунд. GitLab не достучался до указанного адреса.",
  not_configured: "Уведомления из GitLab не настроены, проверять нечего.",
  not_registered: "Вебхук не зарегистрирован, отправлять тестовую доставку не через что.",
  failed: "GitLab отказался отправить тестовую доставку.",
};

// Предложение о том, что увидели. Сначала уточнение для конкретной проверки,
// потом общий текст причины.
export function checkReason(id: string, reason?: string): string {
  if (!reason) return "";
  return REASONS[`${id}.${reason}`] ?? REASONS[reason] ?? "";
}

// Что сделать. Пусто, если делать нечего: у проверки, которая прошла, действия
// нет, и придумывать его не надо.
export function checkAction(id: string, reason?: string): string {
  if (!reason) return "";
  return ACTIONS[`${id}.${reason}`] ?? "";
}

// Подпись факта. Незнакомый ключ показываем как есть: это всё равно понятнее,
// чем прятать данные, ради которых страницу и открыли.
export function factLabel(key: string): string {
  return FACTS[key] ?? key;
}

// Значение факта. Бэкенд отдаёт всё строками, и «true» рядом с подписью
// «Администратор инстанса» читается как данные из лога, а не как ответ.
export function factValue(value: string): string {
  if (value === "true") return "да";
  if (value === "false") return "нет";
  return value;
}

export function verdictLabel(verdict: string): string {
  return VERDICTS[verdict as CheckVerdict] ?? VERDICTS.unknown;
}

export function deliveryOutcomeText(outcome: string): string {
  return DELIVERY_OUTCOMES[outcome] ?? "Проверить доставку не получилось.";
}

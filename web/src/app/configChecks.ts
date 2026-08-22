// Тексты проверок настройки, в словах, которые читает человек.
//
// Бэкенд (internal/checks) отдаёт только идентификаторы: что проверяли, чем
// закончилось и какие факты увидели. Ни одного предложения он не собирает - так
// же, как для возможностей портала (см. capabilities.ts). Всё, что видно на
// экране, живёт здесь, рядом с остальными продуктовыми текстами.

export type CheckVerdict = "ok" | "warn" | "fail" | "skip" | "unknown";

export interface CheckText {
  // Название проверки: короткое, отвечает на вопрос «что проверяли».
  label: string;
  // Зачем эта проверка нужна и чем грозит её провал. Одно предложение.
  what: string;
}

// Что проверяем, по идентификаторам из internal/checks.
export const CHECKS: Record<string, CheckText> = {
  // --- сам портал: читаем конфигурацию и сверяем её саму с собой ---
  webhook_pairing: {
    label: "Уведомления из GitLab",
    what: "Адрес и секрет уведомлений задаются вместе. С одной половиной портал узнаёт о слияниях только опросом.",
  },
  webhook_url: {
    label: "Адрес для уведомлений",
    what: "Адрес, на который GitLab шлёт уведомления, должен вести на этот портал.",
  },
  instance_dir_template: {
    label: "Папка заказа в репозитории",
    what: "Два сервиса одной команды и чарта должны получать разные папки, иначе они перезапишут файлы друг друга.",
  },
  app_name_template: {
    label: "Имя приложения в Argo CD",
    what: "Два заказа не должны давать одно имя приложения, иначе Argo CD применит только один из них.",
  },
  auto_merge: {
    label: "Слияние без ревью",
    what: "Портал сливает свои merge request сам, без участия человека. Это режим для стенда.",
  },
  harbor_webhook_secret: {
    label: "Уведомления из Harbor",
    what: "С секретом Harbor сообщает о новых версиях чартов сразу, без него портал ждёт следующего опроса.",
  },

  // --- GitLab ---
  gitlab_token: {
    label: "Токен GitLab",
    what: "Портал создаёт репозитории и merge request этим токеном. Ему нужны права api и запас по сроку.",
  },
  gitlab_gitops_group: {
    label: "Группа GitOps",
    what: "Группа, в которой лежат репозитории команд. Портал должен её видеть.",
  },
  gitlab_group_access: {
    label: "Права в группе GitOps",
    what: "Роль токена в этой группе решает, сможет ли портал завести репозиторий и подгруппу команды.",
  },
  gitlab_webhook: {
    label: "Вебхук в GitLab",
    what: "Портал регистрирует вебхук сам. Здесь видно, на каком уровне он зарегистрирован и жив ли он.",
  },
  gitlab_webhook_delivery: {
    label: "Доставки из GitLab",
    what: "Что реально дошло до портала с момента запуска. Отклонённые доставки означают, что секреты разошлись.",
  },

  // --- Harbor ---
  harbor_projects: {
    label: "Проекты Harbor",
    what: "Каталог собирается из этих проектов. Проект, которого нет или который не виден роботу, просто пропадает из каталога.",
  },
  harbor_artifacts: {
    label: "Чтение чартов",
    what: "Права на список репозиториев и на чтение артефактов Harbor выдаёт отдельно. Без второго каталог остаётся без версий.",
  },
  harbor_webhook: {
    label: "Вебхук в Harbor",
    what: "Политика вебхука на стороне Harbor, которая шлёт уведомления в портал.",
  },
  harbor_webhook_delivery: {
    label: "Доставки из Harbor",
    what: "Что реально дошло до портала с момента запуска.",
  },

  // --- Argo CD ---
  argocd_project: {
    label: "Проект Argo CD",
    what: "Проект, который портал указывает в каждом манифесте заказа. Без него Argo CD откажется от приложения.",
  },
  argocd_permissions: {
    label: "Права токена Argo CD",
    what: "Портал показывает состояние приложений и умеет запускать синхронизацию вручную.",
  },
  argocd_cluster: {
    label: "Кластер по умолчанию",
    what: "Кластер, в который уезжают заказы, если в них не выбран другой.",
  },
  argocd_namespace: {
    label: "Namespace Argo CD",
    what: "Argo CD подхватывает приложения только из своего namespace. Портал пишет его в каждый манифест.",
  },

  // --- Keycloak ---
  keycloak_groups_claim: {
    label: "Группы в токене",
    what: "Роли и команды портал берёт из групп в токене. Без них каждый входящий получает роль наблюдателя.",
  },
};

// Что именно увидели, по идентификаторам причин. Ключ вида «проверка.причина»
// уточняет общий текст: «не настроено» у вебхука и у секрета Harbor значат
// разное.
const REASONS: Record<string, string> = {
  // общее
  upstream_down: "Система не отвечает, поэтому проверить не удалось.",
  unavailable: "Проверить не удалось: система не ответила на запрос.",
  forbidden: "Прав портала не хватает, чтобы это посмотреть.",
  not_configured: "Не настроено.",

  // сам портал
  "webhook_pairing.url_without_token": "Задан адрес, но не задан секрет. Вебхук не зарегистрирован, портал работает на опросе.",
  "webhook_pairing.token_without_url": "Задан секрет, но не задан адрес. Вебхук нужно завести в GitLab вручную.",
  "webhook_pairing.not_configured": "Уведомления не настроены. Портал узнаёт о слияниях опросом.",
  "webhook_url.path_mismatch": "Адрес ведёт не на приёмник уведомлений портала.",
  "webhook_url.scheme_mismatch": "Протокол адреса не совпадает с протоколом портала.",
  "webhook_url.host_mismatch": "Адрес ведёт на другой хост. Так и должно быть, если GitLab обращается к порталу по внутреннему имени.",
  "instance_dir_template.not_unique": "Шаблон не различает сервисы. Два заказа одной команды и чарта попадут в одну папку.",
  "instance_dir_template.bad_template": "Шаблон не разбирается.",
  "app_name_template.not_unique": "Шаблон не различает сервисы. Два заказа дадут одно имя приложения.",
  "app_name_template.team_collision": "Шаблон не различает команды. Заказы разных команд могут дать одно имя.",
  "app_name_template.chart_collision": "Шаблон не различает чарты. Заказы разных чартов могут дать одно имя.",
  "app_name_template.bad_template": "Шаблон не разбирается.",
  "auto_merge.enabled": "Слияние без ревью включено. Изменение доедет до кластера, и его никто не посмотрит.",
  "harbor_webhook_secret.polling_only": "Секрет не задан. Новые версии чартов портал находит опросом.",

  // GitLab
  "gitlab_token.missing_scope": "У токена нет прав api. Первый же заказ на нём остановится.",
  "gitlab_token.expired": "Срок токена истёк.",
  "gitlab_token.expires_soon": "Срок токена скоро истечёт. Выпустите новый заранее.",
  "gitlab_token.revoked": "Токен отозван.",
  "gitlab_token.no_introspection": "GitLab не показывает права и срок этого токена. Так бывает с групповыми токенами.",
  "gitlab_gitops_group.group_missing": "Группы с таким путём в GitLab нет.",
  "gitlab_group_access.needs_owner": "Создание подгруппы команды включено, а роли Owner у токена нет. Первый заказ новой команды не пройдёт.",
  "gitlab_group_access.needs_maintainer": "Роли токена не хватает, чтобы заводить репозитории и открывать merge request.",
  "gitlab_group_access.not_member": "Учётной записи портала нет среди участников группы.",
  "gitlab_webhook.not_registered": "Вебхук не зарегистрирован ни на одном уровне.",
  "gitlab_webhook.hook_missing": "В GitLab такого вебхука нет. Похоже, его удалили после запуска портала.",
  "gitlab_webhook.hook_disabled": "GitLab отключил вебхук после неудачных доставок.",
  "gitlab_webhook.hook_not_mr": "Вебхук не подписан на события merge request.",
  "gitlab_webhook.partial_coverage": "Вебхук стоит не на всех репозиториях группы. О слияниях в остальных портал узнаёт опросом.",
  "gitlab_webhook.not_configured": "Уведомления из GitLab не настроены.",

  // доставки, обе стороны
  "gitlab_webhook_delivery.secret_mismatch": "Все доставки отклонены. Секрет в портале и секрет в GitLab не совпадают.",
  "gitlab_webhook_delivery.some_rejected": "Часть доставок отклонена по секрету.",
  "gitlab_webhook_delivery.no_deliveries": "С момента запуска не пришло ни одной доставки. Это нормально, если в GitLab ничего не сливали.",
  "gitlab_webhook_delivery.not_configured": "Уведомления из GitLab не настроены.",
  "harbor_webhook_delivery.secret_mismatch": "Все доставки отклонены. Секрет в портале и секрет в Harbor не совпадают.",
  "harbor_webhook_delivery.some_rejected": "Часть доставок отклонена по секрету.",
  "harbor_webhook_delivery.no_deliveries": "С момента запуска не пришло ни одной доставки. Это нормально, если новых версий чартов не было.",
  "harbor_webhook_delivery.not_configured": "Уведомления из Harbor не настроены.",

  // Harbor
  "harbor_projects.projects_missing": "В Harbor нет проекта из списка.",
  "harbor_projects.projects_hidden": "Проект из списка не виден под учётной записью портала.",
  "harbor_projects.no_repositories": "Проекты читаются, но чартов в них нет.",
  "harbor_projects.not_configured": "Список проектов пуст, каталогу неоткуда собираться.",
  "harbor_artifacts.forbidden": "Робот видит репозитории, но не может читать артефакты. В каталоге чарты будут без версий.",
  "harbor_artifacts.no_repositories": "Читать пока нечего: чартов в проектах нет.",
  "harbor_webhook.no_policy": "В Harbor нет включённой политики вебхука, которая шлёт уведомления в портал.",
  "harbor_webhook.policy_disabled": "Политика вебхука есть, но выключена.",
  "harbor_webhook.missing_event": "Политика есть, но не подписана на публикацию артефакта.",
  "harbor_webhook.forbidden": "Учётной записи портала не хватает прав, чтобы посмотреть политики вебхуков.",
  "harbor_webhook.not_configured": "Уведомления из Harbor не настроены.",

  // Argo CD
  "argocd_project.project_missing": "Проекта с таким именем в Argo CD нет. Заказ дойдёт до слияния и остановится уже за пределами портала.",
  "argocd_permissions.cannot_read": "Токен не может читать приложения проекта. Состояние заказов будет пустым.",
  "argocd_permissions.cannot_sync": "Токен не может запускать синхронизацию. Кнопка на странице заказа не сработает.",
  "argocd_cluster.cluster_missing": "Кластера с таким именем в Argo CD нет.",
  "argocd_namespace.namespace_diff": "Портал пишет приложения не в тот namespace, из которого их читает Argo CD. Заказ уедет в Git, а сервис не поднимется.",
  "argocd_namespace.no_applications": "Сравнивать пока не с чем: приложений в Argo CD ещё нет.",

  // Keycloak
  "keycloak_groups_claim.no_sign_in": "С момента запуска портала ещё никто не входил.",
  "keycloak_groups_claim.no_groups": "В токене не пришло ни одной группы. Все входящие получают роль наблюдателя.",
  "keycloak_groups_claim.no_teams": "Группы пришли, но ни одна не подошла под правило команд.",
  "keycloak_groups_claim.roles_unmapped": "Группы администраторов не заданы. Роль администратора платформы не сможет получить никто.",
};

// Подписи фактов: что именно портал увидел.
const FACTS: Record<string, string> = {
  access: "Роль в группе",
  accepted: "Принято доставок",
  admin: "Администратор инстанса",
  actual: "На самом деле",
  alert_status: "Состояние вебхука",
  artifacts: "Артефактов в репозитории",
  cluster: "Кластер",
  configured: "В настройках",
  covered: "Репозиториев с вебхуком",
  days_left: "Дней до истечения",
  disabled: "Отключено вебхуков",
  examined: "Проверено репозиториев",
  expected_event: "Нужное событие",
  expected_path: "Нужный путь",
  expected_url: "Нужный адрес",
  expires_at: "Срок токена",
  group: "Группа",
  group_id: "Идентификатор группы",
  groups: "Групп в токене",
  hidden: "Не видны",
  hook_id: "Идентификатор вебхука",
  hook_url: "Адрес вебхука",
  last_accepted: "Последняя принятая",
  last_rejected: "Последняя отклонённая",
  last_sign_in: "Последний вход",
  missing: "Нет в Harbor",
  mode: "Режим обновления",
  project: "Проект",
  project_id: "Идентификатор репозитория",
  projects: "Проекты",
  public_url: "Адрес портала",
  read: "Чтение приложений",
  registered: "Зарегистрированы",
  requested_scope: "Запрошенный уровень",
  rejected: "Отклонено доставок",
  rendered: "Пример имени",
  rendered_other: "Для другого сервиса",
  repositories: "Репозиториев",
  repository: "Репозиторий",
  required: "Нужна роль",
  role: "Полученная роль",
  scope: "Уровень",
  scopes: "Права токена",
  since: "Считаем с",
  sync: "Синхронизация",
  teams: "Команд определилось",
  template: "Шаблон",
  uncovered: "Репозиториев без вебхука",
  unreadable: "Не удалось посмотреть",
  user: "Учётная запись",
  waited_ms: "Ждали, мс",
};

// Итог проверки одним словом, для правого края карточки.
const VERDICTS: Record<CheckVerdict, string> = {
  ok: "В порядке",
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

// Текст проверки. Идентификатор, о котором фронтенд ещё не знает (бэкенд уехал
// вперёд), получает честную заглушку вместо голого идентификатора на экране.
export function checkText(id: string): CheckText {
  return CHECKS[id] ?? { label: id, what: "Портал проверяет эту часть настройки." };
}

// Предложение о том, что увидели. Сначала уточнение для конкретной проверки,
// потом общий текст причины.
export function checkReason(id: string, reason?: string): string {
  if (!reason) return "";
  return REASONS[`${id}.${reason}`] ?? REASONS[reason] ?? "";
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

import { ruPlural } from "@/form/fieldErrors";
import type { ActionId, AuditSource, IncidentKind, IncidentState, Severity } from "./data";

// Wording of the admin redesign concept. Demo pages, demo scenarios: the
// scenario texts below describe made-up incidents.

// Sidebar labels of the concept pages.
export const conceptNav = {
  board: "Дежурный борд", // on-call board
  incidents: "Проблемы", // problems list
  audit: "Журнал действий", // audit trail
};

export const T = {
  // Banner on every concept page: this is a concept on demo data, numbers are not real.
  conceptNote: "Концепт раздела администратора. Все данные и события вымышлены.",
  live: {
    on: "Обновляется автоматически", // live updates are on
    paused: "Обновление приостановлено", // live updates are paused
    pause: "Приостановить обновление", // button label (aria): pause live updates
    resume: "Возобновить обновление", // button label (aria): resume live updates
    updated: (sec: number): string =>
      sec < 5
        ? "Обновлено только что"
        : `Обновлено ${sec} ${ruPlural(sec, "секунду", "секунды", "секунд")} назад`, // caption: last update N seconds ago, 0-4 sec = "just now"
  },
  severity: { critical: "Критическая", major: "Серьёзная", minor: "Незначительная" } as Record<Severity, string>,
  state: { open: "Не взята в работу", taken: "В работе", resolved: "Решена" } as Record<IncidentState, string>, // open = nobody took it yet, taken = someone works on it
  kind: { order: "Заказ", integration: "Интеграция", stand: "Стенд", loop: "Фоновая задача" } as Record<IncidentKind, string>, // loop = background process of the portal
  // Action buttons on a problem.
  action: {
    sync: "Запустить синхронизацию", // start Argo CD sync
    retry_merge: "Повторить слияние MR", // retry merging the MR
    withdraw_change: "Отменить изменение", // withdraw the change that could not be applied
    git_pull: "Принять изменения из Git", // accept changes from Git
    open_order: "Открыть заказ", // open the order page
    open_mr: "Открыть MR в GitLab", // open the MR in GitLab
    open_argo: "Открыть в Argo CD", // open the app in Argo CD
    recheck: "Проверить снова", // check again now
    run_checks: "Проверить конфигурацию", // run config checks
    test_webhook: "Отправить тестовое уведомление GitLab", // send a test webhook
    open_stand: "Открыть стенд", // open stand page
    stop_job: "Остановить задачу", // stop the background job of the stand
    retry_failed: "Повторить только заказы с ошибками", // retry only the failed orders of the job
    run_loop: "Запустить сейчас", // run the background process now
    open_grafana: "Графики в Grafana", // open the dashboard in Grafana
  } as Record<ActionId, string>,
  board: {
    title: "Дежурный борд",
    onCall: (name: string): string => `На дежурстве: ${name}`, // chip: who is on call now
    verdictTitle: "Платформа работает с ограничениями", // overall verdict: platform works with limitations
    verdictText: "Harbor медленно отвечает уже полчаса, поэтому каталог и публикация сервисов работают с задержкой. Заказ сервисов и работа уже запущенных сервисов от этого не зависят.", // one or two sentences: Harbor answers slowly for half an hour, catalog and publishing are affected, ordering and running services work
    capabilities: "Что доступно пользователям", // aria label for the list of what users can do
    statProblems: (critical: number): string =>
      `Открытые проблемы, из них ${critical} ${ruPlural(critical, "критическая", "критические", "критических")}`, // stat label under the count of open problems, mentions how many are critical
    statOrders: "Заказы с проблемами", // stat label: orders with problems
    statApprovals: "На согласовании", // stat label: waiting for approval
    statLoops: "Фоновые задачи с ошибками", // stat label: background processes with errors
    allProblems: (n: number): string => `Все проблемы (${n})`, // link to all N problems
    needsYou: "Требует внимания", // section title: needs reaction
    statusLink: "Состояние платформы", // link to platform status page
    integrations: "Интеграции за 24 часа", // section title: integrations over 24 hours
    historyLabel: (name: string, hours: number[]): string => {
      const n = hours.filter((hour) => hour === 1 || hour === 2).length;
      return n === 0
        ? `${name}: все 24 часа без проблем.`
        : `${name}: за последние 24 часа проблемы были в течение ${n} ${ruPlural(n, "часа", "часов", "часов")}.`;
    }, // aria label for a 24-cell history strip: name plus how many hours had problems (0 = ok, 1 = slow, 2 = down), or that all 24 hours were fine
    latency: (ms: number): string =>
      ms < 1000 ? `${ms} мс` : `${(ms / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} с`, // short response time: "42 мс", "4,1 с"
    hoursAgo: "24 часа назад", // axis caption left: 24 hours ago
    now: "Сейчас", // axis caption right: now
    loops: "Фоновые задачи", // section title: background processes
    loopFailing: "Сбой", // short status of a failing background process
    auditLink: "Журнал действий", // link to the audit trail
    recent: "Последние события", // section title: latest events
    approvalsLink: "Очередь на согласование", // link to the approval queue
    approvals: "На согласовании", // section title: waiting for approval
  },
  incidents: {
    title: "Проблемы",
    openFor: (min: number): string => {
      if (min < 60) return `${min} мин`;
      const hours = Math.floor(min / 60);
      const minutes = min % 60;
      return minutes === 0 ? `${hours} ч` : `${hours} ч ${minutes} мин`;
    }, // how long the problem lasts: minutes under 60, then hours and minutes, e.g. "3 ч 10 мин"
    unowned: "Никто не взял в работу", // nobody took the problem
    actionMissing: (action: string): string =>
      `«${action}» пока недоступно в концепте. Нужна доработка портала.`, // toast: this action needs a portal change and does not work in the concept yet
    actionDone: (action: string): string => `Действие «${action}» выполнено на демо-данных.`, // toast: demo action done
    statesLabel: "Состояние проблемы", // aria label for the tabs open/taken/resolved
    search: "Найти по сервису, команде или стенду", // search placeholder: by service, team or stand
    kindsLabel: "Тип проблемы", // aria label for kind filters
    allKinds: "Все типы", // filter: all kinds
    empty: "По выбранным фильтрам проблем нет.", // empty list for these filters
    take: "Взять в работу", // button: take into work
    resolve: "Отметить решённой", // button: mark resolved
    reopen: "Открыть снова", // button: reopen
    factService: "Сервис",
    factTeam: "Команда",
    factStand: "Стенд",
    factStatus: "Статус заказа", // order status
    whatToDo: "Что можно сделать", // section title: what can be done
    needsBackend: "Действия со значком ключа требуют доработки портала и пока недоступны в концепте.", // note under actions: buttons marked with a wrench need a portal change
    timeline: "Хронология", // section title: timeline
    notePlaceholder: "Что важно знать следующей смене", // textarea placeholder: a note for the next shift
    noteSave: "Добавить заметку", // button: add note
  },
  // Demo scenarios: title is one line for a list, summary is two or three sentences: what happened and what it affects.
  incident: {
    "payments-degraded": {
      title: "payments-api не работает на prod",
      summary: "Сервис payments-api команды payments на стенде prod перестал работать 18 минут назад. После последнего изменения Argo CD сообщает о сбое сервиса, хотя синхронизация завершилась без ошибок.",
    }, // service payments-api of team payments on stand prod stopped working 18 min ago, Argo CD reports the app as degraded after the latest change, sync went fine
    "harbor-slow": {
      title: "Harbor отвечает с задержкой",
      summary: "Harbor уже полчаса отвечает примерно за 4 секунды вместо 0,2 секунды, несколько проверок не дождались ответа. Каталог и публикация сервисов работают медленнее. Заказ сервисов и работа уже запущенных сервисов от этого не зависят.",
    }, // Harbor answers in about 4 seconds instead of 0.2 for half an hour, a few checks timed out, catalog and publishing are slow, ordering and running services are not affected
    "billing-merge-blocked": {
      title: "Изменение billing-db остановлено из-за конфликта в MR",
      summary: "Изменение billing-db команды billing не удалось применить: в MR !398 возник конфликт. Портал один раз повторил попытку слияния и остановил изменение до решения человека.",
    }, // change of billing-db (team billing) cannot be merged: MR !398 has a conflict, the portal retried once and stopped waiting for a person
    "search-argo-missing": {
      title: "search-gateway отсутствует в Argo CD",
      summary: "MR заказа search-gateway на стенде stage слит час назад. Приложение в Argo CD так и не появилось, разворачивание сервиса не началось.",
    }, // MR of search-gateway on stand stage was merged an hour ago, but Argo CD has no application for it
    "dev-job-failures": {
      title: "Три заказа на dev не переведены в новый режим",
      summary: "При смене режима стенда dev переведено 37 из 40 заказов. Три заказа завершились с ошибками, задача ждёт решения администратора.",
    }, // mode change of stand dev: 37 of 40 orders moved, 3 failed, the job waits for a decision
    "web-drift": {
      title: "web-front на prod отличается от версии в Git",
      summary: "Запущенный сервис web-front команды web на стенде prod отличается от версии в Git. Изменения внесены вне портала.",
    }, // web-front of team web on prod: what runs differs from what is in Git, someone changed it outside the portal
    "legacy-delete-stuck": {
      title: "Удаление legacy-cache ждёт слияния MR",
      summary: "Удаление legacy-cache на стенде stage запрошено три часа назад. MR на удаление ещё не слит, сервис пока не удалён.",
    }, // deletion of legacy-cache on stage requested 3 hours ago, the deletion MR is not merged yet
    "gitlab-webhook": {
      title: "Портал отклоняет уведомления GitLab",
      summary: "Проверка конфигурации выявила несовпадение секретов для уведомлений GitLab, поэтому портал отклоняет их. Статусы обновляются только при регулярной проверке и приходят с задержкой.",
    }, // config check failed: GitLab webhooks are rejected because the secret does not match, statuses update only on the regular poll, slower
    "discovery-loop": {
      title: "Новые сервисы из Harbor не появляются в каталоге",
      summary: "Поиск новых сервисов в Harbor завершается с ошибкой уже полтора часа. Портал повторяет попытки, увеличивая паузы между ними. Новые чарты пока не появляются в каталоге.",
    }, // the background process that finds new services in Harbor fails for an hour and a half, retries with growing pauses, new charts do not appear in the catalog
    "stage-argo-unwired": {
      title: "Подключение stage к Argo CD восстановлено",
      summary: "Проверка стенда stage показала, что Argo CD не был подключён, поэтому заказы не разворачивались. Мария Орлова подключила стенд и отметила проблему решённой.",
    }, // stand stage check: Argo CD was not connected, fixed by Мария Орлова
    "orders-degraded-resolved": {
      title: "kafka-connect на prod снова работает",
      summary: "Сервис kafka-connect команды data на стенде prod не работал около часа. После принудительной синхронизации работа восстановилась.",
    }, // kafka-connect of team data on prod did not work for an hour, recovered after forced sync
  } as Record<string, { title: string; summary: string }>,
  // Timeline entries, after the actor's name or after "Портал" for the portal itself. Past tense, masculine form like in features/users/text.ts.
  timeline: {
    degraded: "сообщил, что сервис перестал работать", // reported that the service stopped working
    healthy: "сообщил, что сервис снова работает", // reported that the service works again
    sync_ok: "завершил синхронизацию без ошибок", // finished sync without errors
    sync_forced: "запустил синхронизацию", // started sync
    updated: "изменил заказ", // changed the order
    taken: "взял проблему в работу", // took the problem
    resolved: "отметил проблему решённой", // marked the problem resolved
    reopened: "снова открыл проблему", // reopened the problem
    note: "оставил заметку", // left a note
    probe_slow: "заметил задержку ответа Harbor", // noticed Harbor answers slowly
    probe_timeout: "не дождался ответа Harbor", // did not get an answer from Harbor in time
    merge_blocked: "остановил изменение до решения человека", // stopped the change until a person decides
    merge_retried: "повторил попытку слияния MR", // retried the merge
    argo_missing: "не нашёл приложение в Argo CD", // did not find the application in Argo CD
    mr_merged: "зафиксировал слияние MR", // registered the merged MR
    job_failures: "завершил перевод заказов с ошибками", // finished moving with errors
    job_started: "запустил смену режима стенда", // started changing the stand mode
    drift: "обнаружил отличия от версии в Git", // found differences from Git
    delete_requested: "запросил удаление сервиса", // requested deletion
    check_failed: "обнаружил ошибку при проверке конфигурации", // config check failed
    stand_check_failed: "обнаружил ошибку при проверке стенда", // stand check failed
    loop_error: "завершил фоновую задачу с ошибкой", // background process failed
  } as Record<string, string>,
  // Background processes of the portal, short names for a list.
  loopName: {
    provisioning: "Проведение заказов", // moves orders through MR and deploy
    drift: "Контроль изменений в Git", // compares running services with Git
    "stand-checks": "Проверка стендов", // checks stands
    "stand-jobs": "Перевод заказов", // runs stand jobs
    "catalog-discovery": "Поиск сервисов в реестре", // finds new services in Harbor
    "chart-versions": "Новые версии сервисов", // tracks new versions of services
  } as Record<string, string>,
  audit: {
    system: "Портал", // actor name for the portal itself
    title: "Журнал действий",
    export: "Скачать CSV", // button: download CSV
    exported: (n: number): string =>
      `Демо: ${n} ${ruPlural(n, "строка выгружена", "строки выгружены", "строк выгружено")}.`, // toast: N rows downloaded (demo)
    search: "Найти по человеку, сервису или действию", // placeholder: by person, service or action
    whoLabel: "Кто выполнил действие", // aria: who
    whoAll: "Все",
    whoPeople: "Люди",
    whoSystem: "Портал",
    periodLabel: "Период", // aria: period
    periodDay: "За 24 часа", // 24 hours
    periodWeek: "За 7 дней", // 7 days
    periodMonth: "За 30 дней", // 30 days
    failedOnly: "Только с ошибками", // filter: only failed
    colWhen: "Когда",
    colWho: "Кто",
    colWhat: "Что сделал",
    colTeam: "Команда",
    colResult: "Результат",
    empty: "По выбранным фильтрам действий нет.",
    dayLabel: (minAgo: number): string => {
      const now = new Date();
      const date = new Date(now.getTime() - minAgo * 60_000);
      if (date.toDateString() === now.toDateString()) return "Сегодня";
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      if (date.toDateString() === yesterday.toDateString()) return "Вчера";
      return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
    }, // day group header from minutes ago: today, yesterday, otherwise date like "11 октября"
    details: "Показать подробности", // aria: show details
    notRecorded: "Пока не записывается", // small badge: the portal does not record this kind of action yet
    notRecordedHint: "Это пример для концепта: портал пока не записывает такие действия в журнал.", // tooltip for that badge: one sentence why it is shown
    ok: "Успешно", // result: success
    failed: "Ошибка", // result: error
  },
  source: {
    order: "Заказы",
    publication: "Публикации",
    stand: "Стенды",
    variable: "Переменные",
    category: "Категории каталога", // catalog category
    access: "Вход в портал", // sign-ins
    settings: "Настройки и проверки портала", // portal settings and checks
  } as Record<AuditSource, string>,
  // Actions new to the trail, after the actor's name. Same style as features/users/text.ts.
  auditAction: {
    updated: "изменил заказ", // changed the order
    sign_in: "вошёл в портал", // signed in
    sign_in_failed: "не смог войти в портал", // tried to sign in, without success
    variable_changed: "изменил переменную", // changed variable
    stand_mode_changed: "изменил режим стенда", // changed mode of stand
    stand_created: "добавил стенд", // created stand
    category_renamed: "переименовал категорию", // renamed category
    checks_run: "запустил проверку конфигурации для", // ran config checks for
  } as Record<string, string>,
  // Labels of facts in the details row.
  auditFact: {
    status: "Статус заказа", // order status
    mode: "Режим", // stand mode
    name: "Название", // name
    stage: "Значение для стенда stage", // value for stand stage
    ip: "IP-адрес", // IP address
    agent: "Браузер", // browser
    mr: "MR", // MR
    reason: "Причина", // reason
  } as Record<string, string>,
  // Values of facts that are codes.
  factValue: {
    conflict: "В MR есть конфликт.", // MR has a conflict
    no_group: "Пользователь не входит ни в одну группу портала.", // the user is not in any portal group
  } as Record<string, string>,
};
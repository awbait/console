# Internal Developer Portal

Go backend + React SPA для IDP: каталог Helm-чартов из **Harbor**, self-service
заказ managed-services через **GitOps-MR** в GitLab, наблюдение за деплоем через
**ArgoCD**. Полная спека — [`docs/idp-spec.md`](./docs/idp-spec.md), конвенция
чартов — [`docs/chart-convention.md`](./docs/chart-convention.md).

> Аутентификация: вход через Keycloak; команда определяется по группе `team-*`
> (напр. `team-core`, `team-dbaas`) — суффикс группы = имя команды. Маппинг групп
> настраивается (`RBAC_TEAM_GROUP_PREFIX` / `RBAC_TEAM_GROUP_REGEX`).

## Возможности

- Каталог чартов из Harbor (живой листинг — новые версии видны сразу), README/
  CHANGELOG/values/schema из артефакта.
- Заказ сервиса → коммит `application.yaml`+`values.yaml` в GitLab → MR → ArgoCD
  деплоит чарт **из Harbor**. Статус заказа (`DRAFT→…→HEALTHY`) — через поллер +
  live-обновления по SSE.
- Обратная синхронизация с Git: **drift**-детект (правки в Git мимо портала),
  **pull** («Подтянуть из Git»), **import** осиротевших манифестов.
- Страница **«Статус»** — здоровье интеграций (Keycloak/Harbor/GitLab/ArgoCD) и
  хранилищ.

## Статус

Upstream'ы реализованы реальными клиентами (**Harbor** API v2.0 + OCI-pull,
**GitLab**, **ArgoCD**). `*_MODE=real` — **дефолт**; `fake` (in-memory) — для
тестов и явного локального запуска без инфраструктуры.

## Запуск

**Локально без инфраструктуры** (фейки + memory store/cache; каталог = минимальная
тест-фикстура):

```sh
make run        # HARBOR/GITLAB/ARGOCD_MODE=fake выставляются явно
```

**Полный dev-стек в Docker** (Postgres + Redis + Keycloak + backend + frontend, в
fake-режиме upstream'ов):

```sh
make up         # docker compose -f deployments/docker-compose.yml up --build
make down       # остановить и снести volume'ы
```

| URL | Что |
|---|---|
| http://localhost:8088 | Фронтенд (SPA) — nginx, проксирует `/api` |
| http://localhost:8080 | Backend (`/health`, `/ready`, `/metrics`) |
| http://localhost:8081 | Keycloak (admin/admin) |

Контейнерный backend — `AUTH_MODE=dev`, nginx инжектит `X-Dev-*` (SPA открывается
как member команды `core`). OIDC-флоу гоняется хостовым процессом (см. ниже).

### Реальный стек (GitLab CE + Harbor + ArgoCD)

KinD-стенд (`deployments/kind/`, см. [`deployments/kind/README.md`](./deployments/kind/README.md))
поднимает Argo CD + Harbor + istio; оверлей `docker-compose.upstreams.yml` —
GitLab CE + backend/frontend в `*_MODE=real`.

```sh
make stand-up         # KinD + Argo CD + Harbor; печатает ARGOCD_TOKEN -> deployments/.env
make up-upstreams     # Postgres + Redis + Keycloak + GitLab CE + backend + frontend
make gitlab-seed      # один раз, когда GitLab healthy: группа managed-services + team-* + токен
```

Чарты в репозитории **не вендорятся** — их источник Harbor. Засеять Harbor стенда
из внешнего каталога чартов: `make stand-charts` со `STAND_CHARTS_DIR=<path>`
(или `deployments/kind/50-charts.ps1 -ChartsDir <path>`).

| URL | Что |
|---|---|
| http://localhost:8929 | GitLab CE |
| https://localhost:8084 | Harbor (admin/Harbor12345) |
| http://localhost:8083 | Argo CD |

`gitlab-seed` идемпотентен и кладёт фиксированный токен
`glpat-localdev0123456789abcd` (он же `GITLAB_TOKEN` в оверлее).

## OIDC через Keycloak

Минимальный Keycloak (dev, импорт realm `internal`): клиент `portal`, группы
`team-core`/`team-dbaas`/`team-payments`/`platform-admins`, group-mapper в claim
`groups`. Тестовые юзеры:

| Пользователь | Пароль | Группы | Роль |
|---|---|---|---|
| `alice` | `alice` | `team-core`, `team-dbaas` | member (команды `core`, `dbaas`) |
| `padmin` | `padmin` | `platform-admins`, `team-core`, `team-dbaas` | admin |

Браузер и портал должны делить один issuer, поэтому для OIDC портал запускается
**на хосте** (Windows/PowerShell):

```powershell
make up                                            # postgres + redis + keycloak
.\deployments\scripts\run-oidc.ps1                 # localhost, fakes + memory
.\deployments\scripts\run-oidc.ps1 -BindHost 10.10.100.33 -RealGitlab   # реальный стек
```

Затем `http://<host>:8080/api/v1/auth/login` → после логина сессия в cookie,
`/api/v1/auth/me` вернёт юзера с командами и ролью.

## Dev-режим аутентификации

`AUTH_MODE=dev` подставляет пользователя без Keycloak; переопределяется
заголовками `X-Dev-Sub`, `X-Dev-Name`, `X-Dev-Teams` (csv), `X-Dev-Role`
(`viewer|member|admin`).

## Конфигурация

Все переменные с описанием — в [`.env.example`](./.env.example). Ключевое:

| Переменная | Значения | Назначение |
|---|---|---|
| `HARBOR_MODE` / `GITLAB_MODE` / `ARGOCD_MODE` | `real`(деф.)\|`fake` | upstream'ы; `real` требует URL/токен (иначе старт падает) |
| `STORE` / `CACHE` | `memory`(деф.)\|`postgres` / `redis` | состояние / кэш+сессии |
| `AUTH_MODE` | `oidc`\|`dev` | аутентификация |
| `RBAC_TEAM_GROUP_PREFIX` / `RBAC_TEAM_GROUP_REGEX` | — | маппинг групп→команды (вложенные/внешние IdP) |
| `CHART_REGISTRY` | — | OCI-база чарт-source в `application.yaml` (Harbor) |
| `GITLAB_AUTO_MERGE` | `false`\|`true` | поллер сам мёржит MR (локалка/демо) |
| `DRIFT_DETECTION_ENABLED` / `IMPORT_DISCOVERY_ENABLED` | — | обратная синхронизация с Git |

## Фронтенд

SPA на **React + React Aria + Tailwind + Monaco** (Vite, TS) в [`web/`](./web):
каталог, динамическая форма по `values.schema.json` (+ raw-YAML в Monaco),
заказы с live-статусом по SSE, страница статуса.

```sh
make stand-up   # (или) запусти backend отдельно
.\deployments\scripts\dev-web.ps1   # vite на :5173, проксирует /api -> :8080
# либо: cd web && npm install && npm run dev
```

## Структура

```
cmd/portal/          — entrypoint
internal/
  config/            — env-конфиг
  auth/              — OIDC + сессии (Redis) + RBAC + dev-режим
  harbor/ gitlab/ argocd/ — порты + fake (тесты) + real HTTP/OCI-клиенты
  store/ cache/      — Postgres/Redis (+ миграции) и memory
  catalog/ changelog/— каталог чартов + парсер CHANGELOG
  provisioning/      — заказы: FSM, gitops, реконсиляция, drift/import/pull
  status/ events/    — read-only Argo + поллер; in-process pub/sub для SSE
  api/               — chi-роутер, хендлеры, SSE, /status
pkg/models/          — доменные типы
web/                 — фронтенд
deployments/         — стенд и запуск:
  docker-compose*.yml, keycloak/, gitlab/   — compose-стек
  kind/              — KinD + Argo CD + Harbor (стенд)
  scripts/           — хост-хелперы (run-oidc, dev-web, reset-state, seed-import)
internal/harbor/charts/ — минимальная тест-фикстура чарта (НЕ деплоится; см. docs/chart-convention.md)
```

## Заметки по архитектуре

- **Источник чартов — Harbor**; репозиторий chart-agnostic (реальные чарты живут
  отдельно, публикуются в Harbor своим пайплайном).
- **Git — источник истины** для values; `values_yaml` в БД — снимок для UI
  (drift/pull синхронизируют его с Git).
- **Одна реплика**: поллер/SSE in-process (техдолг до масштабирования — `TODO.md`).
- **Один открытый MR на заказ** + оптимистичная блокировка (`version`).
```

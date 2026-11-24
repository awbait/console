# MCP-сервер Console

Console может запускать встроенный Model Context Protocol (MCP) сервер на отдельном HTTP-порту (`MCP_PORT`, по умолчанию `8090`), изолированно от основного порта портала (`HTTP_PORT`) и публичного Ingress веб-интерфейса.

Транспорт - stateless **Streamable HTTP** (`MCP_PATH`, по умолчанию `/mcp`), поэтому сервер безопасно работает за балансировщиком с несколькими репликами без sticky sessions.

## Включение и переменные окружения

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `MCP_ENABLED` | `false` | Запускать отдельный HTTP-слушатель MCP. |
| `MCP_PORT` | `8090` | Порт слушателя MCP. |
| `MCP_PATH` | `/mcp` | HTTP-путь Streamable HTTP эндпоинта. |
| `MCP_PUBLIC_URL` | `http://localhost:<MCP_PORT>` | Внешний базовый URL MCP-слушателя для RFC 9728 metadata и заголовка `WWW-Authenticate`. |
| `MCP_WRITE_ENABLED` | `false` | Разрешать мутирующие инструменты (в v1 - `create_draft_order`). |
| `MCP_OIDC_AUDIENCE` | `OIDC_CLIENT_ID` | Ожидаемый клейм `aud` в Bearer JWT. |
| `MCP_ALLOWED_ORIGINS` | origin из `MCP_PUBLIC_URL` | Разрешённые значения `Origin` для браузерных запросов. |

## Аутентификация (OAuth 2.1 Resource Server + Keycloak)

Слушатель MCP работает как OAuth 2.1 Resource Server:
- Публикует RFC 9728 Protected Resource Metadata по адресам `/.well-known/oauth-protected-resource` и `/.well-known/oauth-protected-resource<MCP_PATH>` со ссылкой на `OIDC_ISSUER`.
- На запросы без валидного `Authorization: Bearer <jwt>` отвечает `401 Unauthorized` с заголовком `WWW-Authenticate: Bearer resource_metadata="..."`.
- Проверяет подпись, `iss`, `exp` и `aud` токена по JWKS Keycloak (`go-oidc`) и строит `*models.User` через общие правила `RBAC_*`.
- Если клейм `groups` не включён в `access_token`, выполняет fallback-запрос в `userinfo` Keycloak с кэшем на 60 секунд (в Redis при `CACHE=redis`).

На локальном стенде (`deployments/keycloak/realm-internal.json`) преднастроен публичный PKCE-клиент `portal-mcp` с мапперами `groups` и `aud=portal-mcp`. Для запуска локально:

```env
MCP_ENABLED=true
MCP_PORT=8090
MCP_PUBLIC_URL=http://localhost:8090
MCP_OIDC_AUDIENCE=portal-mcp
MCP_WRITE_ENABLED=true
```

## Инструменты и ресурсы

Все вызовы проходят через те же доменные сервисы, что и REST API: соблюдаются `AllowedTeams` (скрытые чарты возвращают `not_found`), изоляция команд, проверка ролей, аудит и `maintenanceGate` (во время техработ не-админам доступен только `whoami`).

### Инструменты
- **Контекст и стенды:** `whoami`, `list_stands`.
- **Каталог и чарты:** `list_catalog`, `get_chart_version`, `get_chart_changelog`, `check_chart`.
- **Заказы и валидация:** `list_orders`, `get_order`, `validate_new_order`, `validate_order_update`, а при `MCP_WRITE_ENABLED=true` также `create_draft_order` (создаёт только `DRAFT` в БД, не трогает GitLab и Argo CD, возвращает прямую ссылку в портал).
- **Публикации и уведомления:** `list_publications`, `get_publication_versions`, `get_view_authoring_context`, `validate_publication_version`, `list_notifications`.
- **Только для `admin`:** `get_admin_board`, `get_platform_status`, `get_platform_config` (секреты скрыты).

### Ресурсы
- `console://view-schema`
- `console://charts/{project}/{name}/{version}/readme`
- `console://charts/{project}/{name}/{version}/schema`
- `console://charts/{project}/{name}/{version}/values`
- `console://orders/{id}`

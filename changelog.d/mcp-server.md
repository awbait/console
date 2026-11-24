### Added

#### en
Added a built-in MCP server on a dedicated port (enabled via `MCP_ENABLED`) authenticated with Keycloak Bearer tokens under the same roles and team permissions as the web portal. Clients can browse the service catalog, chart versions and schemas, inspect orders, validate parameters before ordering or updating, read publications and notifications, and view platform status and configuration as an administrator. When `MCP_WRITE_ENABLED` is enabled, clients can also create draft orders with a direct link to review and submit them in the portal.

#### ru
Добавили встроенный MCP-сервер на отдельном порту (включается переменной `MCP_ENABLED`) с входом по токенам Keycloak и теми же ролями и правами команд, что в веб-интерфейсе. Через MCP доступны каталог, версии и схемы чартов, диагностика заказов, проверка параметров до заказа или обновления, публикации и уведомления, а администраторам - обзор платформы, проверки и конфигурация. При включённой переменной `MCP_WRITE_ENABLED` можно также создавать черновики заказов со ссылкой для проверки и отправки в портале.

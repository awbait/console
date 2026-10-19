### Added

#### en
Added the `SHUTDOWN_DRAIN` environment variable to help prevent interrupted requests during Kubernetes rollouts. During shutdown, the portal first reports that it is not ready to accept requests, then continues serving requests already heading to it for the configured duration. The default is `0`, with no delay.

#### ru
Добавили переменную окружения `SHUTDOWN_DRAIN`, чтобы избежать обрыва запросов при обновлении портала в Kubernetes. При остановке портал сначала сообщает, что не готов принимать запросы, затем в течение указанного времени продолжает обслуживать уже идущие к нему запросы. По умолчанию `0`, без задержки.

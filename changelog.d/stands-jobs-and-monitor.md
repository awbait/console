### Fixed

#### en
Fixed switching the default stand failing with an internal error on PostgreSQL, prevented stopped stand jobs from resuming or deleting a stand after being stopped, and made upstream failure responses trigger immediate health re-checks.

#### ru
Исправили ошибку 500 при смене стенда по умолчанию в PostgreSQL, защитили остановленные задачи стенда от возобновления и удаления стенда после остановки, а также починили внеочередную проверку состояния интеграций при сбоях запросов.

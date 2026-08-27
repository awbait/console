-- Возврат заказов, которые заперло закрытое изменение.
--
-- MR_CLOSED - терминальное состояние: из него нет ни одного перехода. До этой
-- версии туда уходило любое закрытое изменение, в том числе правка или удаление
-- уже работающего сервиса. Сервис при этом оставался в кластере, а заказ по нему
-- переставал принимать правки, обновление и удаление и выпадал из ListActive -
-- то есть портал переставал следить и за состоянием, и за дрейфом.
--
-- Теперь MR_CLOSED значит только одно: закрыли первый заказ, сервиса не было.
-- Записи, попавшие туда по старому правилу, возвращаем в MR_MERGED: манифесты
-- сервиса лежат в Git, а до DEPLOYING, HEALTHY, DEGRADED или ARGO_MISSING заказ
-- доведёт поллер сам.
--
-- Отличаем такие записи по последнему изменению заказа: update или delete -
-- сервис уже существовал, create - первый заказ, его не трогаем.
--
-- Смена статуса без следа в хронологии выглядит как необъяснимый скачок из
-- «Отклонён» в «Разворачивается», поэтому пишем такое же событие, какое пишет
-- поллер: от системы, с обоими статусами.
WITH unstuck AS (
  UPDATE requests
     SET status = 'MR_MERGED', updated_at = NOW()
   WHERE status = 'MR_CLOSED'
     AND deleted_at IS NULL
     AND (
       SELECT m.action
         FROM request_mrs m
        WHERE m.request_id = requests.id
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 1
     ) IN ('update', 'delete')
  RETURNING id
)
INSERT INTO request_events (request_id, actor, actor_name, event_type, from_status, to_status)
SELECT id, 'system', '', 'status_changed', 'MR_CLOSED', 'MR_MERGED' FROM unstuck;

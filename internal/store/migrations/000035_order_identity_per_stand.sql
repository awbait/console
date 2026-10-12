-- Заказ уникален в пределах стенда.
--
-- Имя кластера назначает Argo CD стенда, поэтому у двух стендов может быть
-- одинаковое имя, например in-cluster, хотя кластеры разные. Ключи без стенда
-- принимали копию заказа на такой стенд за повтор того же заказа.
-- NULL в stand_id бывает только до SeedDefaultStand: COALESCE сводит такие
-- строки в один ключ, чтобы они по-прежнему сталкивались друг с другом.
DROP INDEX IF EXISTS uniq_active_service;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_service
  ON requests (COALESCE(stand_id, '00000000-0000-0000-0000-000000000000'::uuid),
               team, chart_name, service_name, cluster,
               COALESCE(NULLIF(namespace, ''), service_name))
  WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS uniq_active_namespace_identity;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_namespace_identity
  ON requests (COALESCE(stand_id, '00000000-0000-0000-0000-000000000000'::uuid),
               cluster, namespace, chart_name, resource_identity)
  WHERE deleted_at IS NULL AND namespace <> '' AND resource_identity <> '';

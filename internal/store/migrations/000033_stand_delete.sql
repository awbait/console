-- Удаление стенда.
--
-- Стенд удаляется мягко: deleted_at. На него ссылаются заказы, и история
-- удалённого заказа должна показывать, где он был. Удалённый стенд пропадает
-- из списков, а его имя освобождается: уникальность имени теперь только среди
-- живых стендов.
--
-- storage_created: группу или репозиторий стенда в GitLab создал сам портал.
-- Только такие портал удаляет вместе со стендом: чужую группу, на которую
-- администратор показал путём, он не трогает.
ALTER TABLE stands
  ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS storage_created BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE stands DROP CONSTRAINT IF EXISTS stands_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_stands_name_live ON stands (name) WHERE deleted_at IS NULL;

-- Задача перегенерации application.yaml на стенде.
--
-- skipped: сколько заказов задача оставила как есть, потому что манифест в
-- Git уже совпадал. handled: что задача уже решила по каждому заказу
-- ({"<order_id>": "updated" | "skipped"}): после слияния обновлённый заказ
-- ничем не отличается от ещё не просмотренного, поэтому задача хранит свою
-- запись, а не читает Git заново на каждом проходе.
ALTER TABLE stand_jobs
  ADD COLUMN IF NOT EXISTS skipped INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS handled JSONB NOT NULL DEFAULT '{}';

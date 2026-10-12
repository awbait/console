-- Фоновые задачи по заказам стенда: перевод заказов в новый режим стенда.
--
-- Задача пересчитывает total, done и waiting на каждом проходе. failures -
-- заказы, которые задача перевести не смогла, с причиной: она их больше не
-- трогает, новая задача пробует снова. На стенде одновременно идёт не больше
-- одной задачи, это держит частичный уникальный индекс.
CREATE TABLE IF NOT EXISTS stand_jobs (
  id          UUID PRIMARY KEY,
  stand_id    UUID NOT NULL REFERENCES stands(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  from_mode   TEXT NOT NULL DEFAULT '',
  to_mode     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL CHECK (status IN ('running', 'done', 'stopped')),
  total       INT  NOT NULL DEFAULT 0,
  done        INT  NOT NULL DEFAULT 0,
  waiting     INT  NOT NULL DEFAULT 0,
  failures    JSONB NOT NULL DEFAULT '[]',
  created_by  TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stand_jobs_running ON stand_jobs (stand_id) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_stand_jobs_stand ON stand_jobs (stand_id, created_at DESC);

-- Режим технических работ.
--
-- Окно работ одно на портал: строка либо есть, либо нет. Второе окно, пока
-- открыто первое, - это то же окно с новыми сроками, поэтому таблица держит
-- ровно одну строку (singleton). Состояние («объявлено», «идёт») не хранится:
-- оно следует из starts_at и текущего времени.
CREATE TABLE IF NOT EXISTS maintenance (
  singleton        BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  -- Имя окна: по нему уведомления об одном окне отличаются от уведомлений о
  -- следующем. Не меняется при правке сроков.
  id               UUID NOT NULL,
  starts_at        TIMESTAMPTZ NOT NULL,
  -- Плановый конец; NULL - срок неизвестен.
  ends_at          TIMESTAMPTZ,
  -- Что читают те, кого не пускают.
  message          TEXT NOT NULL DEFAULT '',
  -- Останавливать ли фоновые циклы, которые пишут в GitLab, Argo CD и реестр.
  pause_background BOOLEAN NOT NULL DEFAULT TRUE,
  -- Заканчивать ли окно само в плановое время.
  auto_end         BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by       TEXT NOT NULL DEFAULT '',
  updated_by_name  TEXT NOT NULL DEFAULT '',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (NOT auto_end OR ends_at IS NOT NULL)
);

-- История окон: кто объявил, включил, продлил, завершил. Строка окна при
-- завершении удаляется, история остаётся.
CREATE TABLE IF NOT EXISTS maintenance_events (
  id         BIGSERIAL PRIMARY KEY,
  window_id  UUID NOT NULL,
  action     TEXT NOT NULL,
  actor      TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  -- Сроки и текст окна после события.
  starts_at  TIMESTAMPTZ,
  ends_at    TIMESTAMPTZ,
  message    TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS maintenance_events_created_at ON maintenance_events (created_at DESC);

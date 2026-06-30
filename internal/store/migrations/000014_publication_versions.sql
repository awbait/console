-- Версии публикации сервиса: у одного чарта может быть несколько опубликованных
-- версий, каждая со своим view-документом и собственным FSM согласования.
-- chart_publications остаётся сервисом (владелец, категория, координаты чарта,
-- draft-метаданные); конкретные версии живут здесь 1:N.
CREATE TABLE IF NOT EXISTS publication_versions (
  id                   UUID PRIMARY KEY,
  publication_id       UUID NOT NULL REFERENCES chart_publications(id) ON DELETE CASCADE,
  chart_version        TEXT NOT NULL,                  -- версия чарта в Harbor
  view_json            JSONB,                          -- черновик view под эту версию
  approved_view_json   JSONB,                          -- согласованный view этой версии
  status               TEXT NOT NULL,                  -- DRAFT | PENDING | APPROVED | REJECTED
  orderable            BOOLEAN NOT NULL DEFAULT FALSE, -- allowlist: доступна для заказа
  approved_description  TEXT NOT NULL DEFAULT '',      -- снапшоты на момент approve
  approved_icon_url     TEXT NOT NULL DEFAULT '',
  reviewed_by          TEXT NOT NULL DEFAULT '',
  review_comment       TEXT NOT NULL DEFAULT '',
  version              INT NOT NULL DEFAULT 1,         -- optimistic lock
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (publication_id, chart_version)
);

CREATE INDEX IF NOT EXISTS idx_pub_versions_pub ON publication_versions(publication_id);
CREATE INDEX IF NOT EXISTS idx_pub_versions_status ON publication_versions(status);

-- Рекомендуемая владельцем версия сервиса (nullable -> хранится как пустая строка).
-- Если пусто или указывает на неактуальную версию, фолбэк на стороне приложения:
-- максимальная orderable + APPROVED версия.
ALTER TABLE chart_publications
  ADD COLUMN IF NOT EXISTS recommended_version TEXT NOT NULL DEFAULT '';

-- Бэкфилл: для каждой публикации с согласованным view создаём одну строку версии
-- (chart_version = approved_view_version, перенос approved_view_json/description/icon,
-- status=APPROVED, orderable=true) и проставляем recommended_version. Старые колонки
-- approved_* остаются на переходный период и удаляются отдельной поздней миграцией.
INSERT INTO publication_versions
  (id, publication_id, chart_version, view_json, approved_view_json, status,
   orderable, approved_description, approved_icon_url, reviewed_by, review_comment,
   version, created_at, updated_at)
SELECT
  gen_random_uuid(), id, approved_view_version, NULL, approved_view_json, 'APPROVED',
  TRUE, approved_description, approved_icon_url, reviewed_by, review_comment,
  1, created_at, updated_at
FROM chart_publications
WHERE approved_view_json IS NOT NULL;

UPDATE chart_publications
  SET recommended_version = approved_view_version
  WHERE approved_view_json IS NOT NULL;

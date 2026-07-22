-- Финальная чистка legacy-хранения view на уровне публикации: view-документы
-- живут только в publication_versions (см. 000014). Сначала страховочный
-- бэкфилл для публикаций, согласованных legacy-путём уже после 000014, затем
-- удаление старых колонок.
INSERT INTO publication_versions
  (id, publication_id, chart_version, view_json, approved_view_json, status,
   orderable, approved_description, approved_icon_url, reviewed_by, review_comment,
   version, created_at, updated_at)
SELECT
  gen_random_uuid(), p.id, p.approved_view_version, NULL, p.approved_view_json, 'APPROVED',
  TRUE, p.approved_description, p.approved_icon_url, p.reviewed_by, p.review_comment,
  1, p.created_at, p.updated_at
FROM chart_publications p
WHERE p.approved_view_json IS NOT NULL
  AND p.approved_view_version <> ''
  AND NOT EXISTS (
    SELECT 1 FROM publication_versions v
    WHERE v.publication_id = p.id AND v.chart_version = p.approved_view_version
  );

UPDATE chart_publications
  SET recommended_version = approved_view_version
  WHERE approved_view_json IS NOT NULL
    AND approved_view_version <> ''
    AND recommended_version = '';

ALTER TABLE chart_publications
  DROP COLUMN IF EXISTS view_json,
  DROP COLUMN IF EXISTS approved_view_json,
  DROP COLUMN IF EXISTS approved_view_version,
  DROP COLUMN IF EXISTS approved_description,
  DROP COLUMN IF EXISTS approved_icon_url;

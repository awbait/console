ALTER TABLE chart_publications
  DROP COLUMN IF EXISTS draft_category_id,
  DROP COLUMN IF EXISTS draft_owner_team;

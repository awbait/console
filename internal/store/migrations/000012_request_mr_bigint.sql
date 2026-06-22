-- Widen MR identifiers from INT (int4) to BIGINT. GitLab project IDs and merge
-- request IIDs can exceed 2^31 on large/long-lived instances, which would
-- overflow the int4 columns. The Go model uses int (64-bit on the deployed
-- platforms), so only the column type needs widening.
ALTER TABLE request_mrs
  ALTER COLUMN gitlab_project_id TYPE BIGINT,
  ALTER COLUMN mr_iid TYPE BIGINT;

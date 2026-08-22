-- Why GitLab last refused to merge this change, in GitLab's own vocabulary
-- (its detailed_merge_status: not_approved, discussions_not_resolved, ...).
-- Empty while nothing is refusing.
--
-- It is remembered rather than only reported because the portal has to say this
-- once and not again: a change waiting for a person is refused on every poller
-- tick, and the reason used to be held in memory, so every restart of the portal
-- announced the same block again in the order's history. It is also what the
-- order page shows instead of a bare "could not be applied".
ALTER TABLE request_mrs ADD COLUMN IF NOT EXISTS blocked_reason TEXT NOT NULL DEFAULT '';

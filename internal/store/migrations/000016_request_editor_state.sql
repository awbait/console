-- Opaque per-order editor state for visual values editors (the policies graph
-- today, any future graph profile tomorrow). The canvas carries facts the chart
-- values cannot express - service accounts and exposed ports of workloads that
-- have no links yet, standalone workloads, empty namespaces, node positions -
-- and the chart schema forbids extra keys, so they cannot ride along in values.
-- The portal never looks inside: the document is {profile, version, data} and
-- only the editor that wrote it reads it back.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS editor_state JSONB;

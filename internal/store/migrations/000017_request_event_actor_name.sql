-- Display name of the person behind an event. `actor` is the OIDC subject: it
-- is stable and right for an audit trail, but it is a UUID, and the timeline
-- was printing it at the user. The name cannot be looked up later either - the
-- portal keeps no user directory, so it has to be recorded when the event is
-- written. Empty for anything the platform did on its own; that emptiness is
-- what the timeline reads as "no person to name here".
ALTER TABLE request_events ADD COLUMN IF NOT EXISTS actor_name TEXT NOT NULL DEFAULT '';

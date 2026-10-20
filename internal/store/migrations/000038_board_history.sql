-- History for the admin board tiles. Both tables only grow from the moment
-- this ships: there is no way to reconstruct who was online last week.

-- user_hours: who was seen in which hour. One row per person per hour,
-- written next to users.last_seen (at most once per touch window). Kept in
-- hours rather than days so "today" can be cut in the reader's time zone.
CREATE TABLE IF NOT EXISTS user_hours (
  hour    TIMESTAMPTZ NOT NULL,
  subject TEXT        NOT NULL,
  PRIMARY KEY (hour, subject)
);

-- online_samples: how many people were online, sampled by the leader.
CREATE TABLE IF NOT EXISTS online_samples (
  at     TIMESTAMPTZ PRIMARY KEY,
  online INT NOT NULL
);

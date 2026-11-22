CREATE TABLE IF NOT EXISTS visitors (
  fingerprint TEXT PRIMARY KEY,
  last_seen INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_visitors_last_seen ON visitors(last_seen);

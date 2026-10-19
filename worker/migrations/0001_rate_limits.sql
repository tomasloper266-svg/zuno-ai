-- Rate-limit counters for the ZUNO chat proxy.
-- Applied at deploy time: wrangler d1 execute DB --remote --file=migrations/0001_rate_limits.sql
-- Keep in sync with test/schema.ts (the test suite creates this same table in local D1).

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  ip_hash TEXT NOT NULL,
  window TEXT NOT NULL CHECK (window IN ('minute', 'day')),
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, window)
);

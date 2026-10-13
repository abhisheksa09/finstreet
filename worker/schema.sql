-- Market News Aggregator — D1 schema (SPEC §6)
-- Headlines and links only: RSS descriptions are never stored.

CREATE TABLE IF NOT EXISTS sources (
  id          TEXT PRIMARY KEY,                -- 'et-markets'
  publisher   TEXT NOT NULL,                   -- 'Economic Times'
  section     TEXT,                            -- 'Markets'
  region      TEXT NOT NULL CHECK (region IN ('india', 'global')),
  feed_url    TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  last_ok_at  INTEGER,                         -- unix seconds of last successful fetch
  fail_count  INTEGER NOT NULL DEFAULT 0       -- consecutive failed runs
);

CREATE TABLE IF NOT EXISTS stories (
  id            TEXT PRIMARY KEY,              -- hash of the normalised title of the first copy seen
  title         TEXT NOT NULL,
  region        TEXT NOT NULL,
  sectors       TEXT NOT NULL DEFAULT '[]',    -- JSON array of sector names
  companies     TEXT NOT NULL DEFAULT '[]',    -- JSON array of NSE symbols
  first_seen_at INTEGER NOT NULL               -- unix seconds; drives feed ordering
);
CREATE INDEX IF NOT EXISTS idx_stories_region_time ON stories(region, first_seen_at DESC);
-- Time-only index for queries across both regions (My Stocks, 24 h tab counts, retention pruning).
CREATE INDEX IF NOT EXISTS idx_stories_time ON stories(first_seen_at DESC);

CREATE TABLE IF NOT EXISTS links (
  story_id     TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  source_id    TEXT NOT NULL REFERENCES sources(id),
  url          TEXT NOT NULL UNIQUE,
  published_at INTEGER,                        -- publisher's own time, unix seconds
  PRIMARY KEY (story_id, source_id)
);

-- Small key/value store for run metadata (e.g. last_run_at).
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

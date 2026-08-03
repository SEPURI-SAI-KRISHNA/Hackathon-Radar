-- D1 schema for the personal tracker.
-- Apply with:
--   wrangler d1 execute hackathon-tracker --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS tracker (
  -- Matches Hackathon.id from public/data/hackathons.json (stable across refreshes).
  hackathon_id TEXT PRIMARY KEY,
  status       TEXT NOT NULL CHECK (status IN ('interested','registered','submitted','won','skipped')),
  notes        TEXT NOT NULL DEFAULT '',
  -- Client-supplied ISO-8601; drives last-write-wins across devices.
  updated_at   TEXT NOT NULL
);

-- The tracker view lists most-recently-touched first.
CREATE INDEX IF NOT EXISTS idx_tracker_updated_at ON tracker (updated_at DESC);

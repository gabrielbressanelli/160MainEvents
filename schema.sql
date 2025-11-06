
CREATE TABLE IF NOT EXISTS rsvps (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  event_slug TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name  TEXT NOT NULL,
  phone      TEXT NOT NULL,
  email      TEXT NOT NULL,
  will_attend TEXT NOT NULL,
  notes      TEXT,
  ip         TEXT,
  user_agent TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT
);
CREATE INDEX IF NOT EXISTS idx_rsvps_email ON rsvps(email);
CREATE INDEX IF NOT EXISTS idx_rsvps_event ON rsvps(event_slug);

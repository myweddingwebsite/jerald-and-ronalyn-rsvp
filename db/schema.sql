-- Wedding RSVP — Jerald & Ronalyn
-- The app creates these tables automatically on first request.
-- Run this file in the Neon SQL Editor only if you prefer to create them yourself.

CREATE TABLE IF NOT EXISTS guests (                -- was the "GUEST LIST" sheet
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  seats       INTEGER NOT NULL DEFAULT 1 CHECK (seats BETWEEN 1 AND 20),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS guests_name_lower_idx ON guests (lower(name));

CREATE TABLE IF NOT EXISTS responses (             -- was the "Responses" sheet
  id               SERIAL PRIMARY KEY,
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  main_name        TEXT NOT NULL,
  main_status      TEXT NOT NULL,                  -- 'Joyfully Accepts' | 'Regretfully Declines'
  total_attending  INTEGER NOT NULL DEFAULT 0,
  message          TEXT NOT NULL DEFAULT '',       -- Message to the Couple (optional)
  guests           JSONB NOT NULL DEFAULT '[]'::jsonb  -- [{ "name": "...", "status": "..." }, ...] main guest first
);
CREATE UNIQUE INDEX IF NOT EXISTS responses_main_lower_idx ON responses (lower(main_name));

CREATE TABLE IF NOT EXISTS settings (              -- was the "Admin Settings" sheet
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES ('rsvp_active', 'true') ON CONFLICT (key) DO NOTHING;

-- Handy views for exporting straight from Neon
CREATE OR REPLACE VIEW response_guests AS
SELECT r.id AS response_id, r.submitted_at, r.main_name, g.ord AS guest_no,
       g.value->>'name' AS guest_name, g.value->>'status' AS guest_status, r.message
FROM responses r, jsonb_array_elements(r.guests) WITH ORDINALITY AS g(value, ord);

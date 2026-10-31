import { neon } from '@neondatabase/serverless';

// One HTTP-based Neon client per function instance.
// Vercel's Neon integration sets DATABASE_URL automatically.
let sqlClient = null;
export function db() {
  if (!sqlClient) {
    const found = findDatabaseUrl();
    if (!found) throw configError('The database is not connected. In Vercel, open Storage, connect the Neon database to this project, then redeploy.');
    sqlClient = neon(found.value);
  }
  return sqlClient;
}

// Lets local tests swap in another client with the same .query(text, params) shape.
export function configError(msg) {
  const e = new Error(msg);
  e.isConfig = true;
  return e;
}

// Vercel's Neon integration may add a custom prefix (e.g. LOVEANNE1_URL)
export function findDatabaseUrl() {
  const names = ['DATABASE_URL', 'POSTGRES_URL', 'NEON_DATABASE_URL'];
  for (const n of names) if (process.env[n]) return { name: n, value: process.env[n] };
  // Any custom prefix, e.g. LOVEANNE1_URL — prefer the pooled URL over *_UNPOOLED
  const cands = Object.entries(process.env)
    .filter(([k, v]) => v && /_URL$/.test(k) && /^postgres(ql)?:\/\//.test(v))
    .sort(([a], [b]) => /UNPOOLED|NON_POOLING/.test(a) - /UNPOOLED|NON_POOLING/.test(b));
  return cands.length ? { name: cands[0][0], value: cands[0][1] } : null;
}

export function setDb(client) {
  sqlClient = client;
  schemaReady = null;
}

export async function q(text, params = []) {
  return db().query(text, params);
}

// Auto-creates the tables on first use (the Vercel equivalent of setupSheets).
// Safe to run repeatedly — every statement is idempotent.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS guests (
     id          SERIAL PRIMARY KEY,
     name        TEXT NOT NULL,
     seats       INTEGER NOT NULL DEFAULT 1 CHECK (seats BETWEEN 1 AND 20),
     created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS guests_name_lower_idx ON guests (lower(name))`,
  `CREATE TABLE IF NOT EXISTS responses (
     id               SERIAL PRIMARY KEY,
     submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
     main_name        TEXT NOT NULL,
     main_status      TEXT NOT NULL,
     total_attending  INTEGER NOT NULL DEFAULT 0,
     message          TEXT NOT NULL DEFAULT '',
     guests           JSONB NOT NULL DEFAULT '[]'::jsonb
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS responses_main_lower_idx ON responses (lower(main_name))`,
  `CREATE TABLE IF NOT EXISTS settings (
     key    TEXT PRIMARY KEY,
     value  TEXT NOT NULL
   )`,
  `INSERT INTO settings (key, value) VALUES ('rsvp_active', 'true') ON CONFLICT (key) DO NOTHING`,
];

let schemaReady = null;
export function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const stmt of SCHEMA) await q(stmt);
    })().catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

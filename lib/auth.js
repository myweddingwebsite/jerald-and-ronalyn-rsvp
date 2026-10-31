import crypto from 'node:crypto';
import { q, ensureSchema, configError } from './db.js';

const SESSION_HOURS = 12;
export const MIN_PASSWORD_LEN = 6;

// The password starts as the ADMIN_PASSWORD environment variable.
// Once it's changed from the dashboard, a salted scrypt hash is stored in
// the settings table and takes over from the environment variable.
async function storedHash() {
  await ensureSchema();
  const rows = await q(`SELECT value FROM settings WHERE key = 'admin_password_hash'`);
  return rows.length ? rows[0].value : '';
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return 'scrypt$' + salt + '$' + hash;
}

function verifyHash(pw, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(pw), salt, 64);
  const want = Buffer.from(hash, 'hex');
  return test.length === want.length && crypto.timingSafeEqual(test, want);
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// Sessions are signed with the secret plus the current password hash, so
// changing the password signs out every other device.
function signingKey(hash) {
  const s = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD;
  if (!s) throw configError('ADMIN_PASSWORD is not set. In Vercel, open Settings → Environment Variables, add ADMIN_PASSWORD, then redeploy.');
  return s + '|' + (hash || '');
}

function sign(data, hash) {
  return crypto.createHmac('sha256', signingKey(hash)).update(data).digest('base64url');
}

export async function checkPassword(password) {
  const hash = await storedHash();
  if (hash) return verifyHash(password || '', hash);
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) throw configError('ADMIN_PASSWORD is not set. In Vercel, open Settings → Environment Variables, add ADMIN_PASSWORD, then redeploy.');
  return safeEqual(password || '', expected);
}

export async function issueToken() {
  const hash = await storedHash();
  const body = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_HOURS * 3600e3 })).toString('base64url');
  return body + '.' + sign(body, hash);
}

export async function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [body, sig] = token.split('.');
  if (!safeEqual(sig, sign(body, await storedHash()))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(body, 'base64url').toString());
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}

export async function setPassword(newPassword) {
  await ensureSchema();
  await q(
    `INSERT INTO settings (key, value) VALUES ('admin_password_hash', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [hashPassword(newPassword)]
  );
}

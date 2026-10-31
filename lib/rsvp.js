// ============================================================
//  WEDDING RSVP — server logic (Neon Postgres)
//  Jerald & Ronalyn — Greenery
//  February 26, 2027 · RSVP deadline January 26, 2027
//
//  Same behaviour as the Google Apps Script version:
//  • Up to 20 guests per entry (open companion mode)
//  • Each guest has an individual "Joyfully Accepts" / "Regretfully Declines"
//  • Fuzzy guest search with "Did you mean…" suggestions
//  • Optional "Message to the Couple"
//  • Admin: dashboard, guest list CRUD/import, responses, RSVP on/off
// ============================================================
import { q, ensureSchema } from './db.js';
import { fuzzyMatch } from './fuzzy.js';
import { checkPassword, issueToken, setPassword, MIN_PASSWORD_LEN } from './auth.js';

export const MAX_GUESTS = 20;
export const MAX_MESSAGE_LEN = 500;
const ACCEPT = 'Joyfully Accepts';
const DECLINE = 'Regretfully Declines';
const CLOSED_MSG = 'RSVPs are now closed. Please reach out to the couple directly.';

const clampSeats = (n) => Math.min(Math.max(Number(n) || 1, 1), MAX_GUESTS);
const cleanStatus = (s) => (s === ACCEPT || s === DECLINE ? s : DECLINE);

async function isRsvpActive() {
  const rows = await q(`SELECT value FROM settings WHERE key = 'rsvp_active'`);
  return !rows.length || String(rows[0].value).toLowerCase() !== 'false';
}

// ============================================================
//  GUEST-FACING
// ============================================================
export async function getGuestData(name) {
  if (!name || !String(name).trim()) return { found: false };
  await ensureSchema();

  if (!(await isRsvpActive())) return { found: false, closed: true, message: CLOSED_MSG };

  const guests = await q(`SELECT name, seats FROM guests ORDER BY id`);
  if (!guests.length) return { found: false };

  const res = fuzzyMatch(name, guests.map((g) => g.name));
  if (!res.match) return { found: false, suggestions: res.suggestions };

  const guest = guests.find((g) => g.name === res.match);
  const dup = await q(`SELECT 1 FROM responses WHERE lower(main_name) = lower($1) LIMIT 1`, [guest.name]);
  if (dup.length) return { found: true, alreadySubmitted: true, name: guest.name };

  return { found: true, alreadySubmitted: false, name: guest.name, seat: clampSeats(guest.seats), guests: [] };
}

// Payload: { name, mainStatus, guest2..guest20, status2..status20, totalSeat, message }
export async function submitForm(data) {
  if (!data || !data.name) return { success: false, message: 'Invalid submission.' };
  await ensureSchema();

  if (!(await isRsvpActive())) return { success: false, message: CLOSED_MSG };

  // Only names on the guest list may RSVP — always store the registered spelling
  const rows = await q(`SELECT name, seats FROM guests WHERE lower(name) = lower($1) LIMIT 1`, [String(data.name).trim()]);
  if (!rows.length) return { success: false, message: "We couldn't find that name on the guest list." };
  const guest = rows[0];
  const seatCap = clampSeats(guest.seats);

  const list = [{ name: guest.name, status: cleanStatus(String(data.mainStatus || '').trim()) }];
  for (let i = 2; i <= seatCap; i++) {
    const gName = String(data['guest' + i] || '').trim().slice(0, 120);
    if (gName) list.push({ name: gName, status: cleanStatus(String(data['status' + i] || '').trim()) });
  }
  // recompute the attending count server-side rather than trusting the client value
  const attending = list.filter((g) => g.status === ACCEPT).length;
  const message = String(data.message || '').trim().slice(0, MAX_MESSAGE_LEN);

  try {
    await q(
      `INSERT INTO responses (main_name, main_status, total_attending, message, guests)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [guest.name, list[0].status, attending, message, JSON.stringify(list)]
    );
  } catch (err) {
    if (err && err.code === '23505') return { success: false, message: "You've already submitted your RSVP." };
    throw err;
  }
  return { success: true, message: "We can't wait to celebrate with you!" };
}

// ============================================================
//  ADMIN — AUTH
// ============================================================
export async function adminLogin(password) {
  if (await checkPassword(password)) return { success: true, token: await issueToken() };
  await new Promise((r) => setTimeout(r, 600)); // slow down password guessing
  return { success: false, message: 'Incorrect password.' };
}

// Returns a fresh token so this device stays signed in;
// every other signed-in device is signed out.
export async function adminChangePassword(currentPassword, newPassword) {
  newPassword = String(newPassword || '');
  if (!(await checkPassword(currentPassword))) {
    await new Promise((r) => setTimeout(r, 600));
    return { success: false, message: 'Your current password is incorrect.' };
  }
  if (newPassword.length < MIN_PASSWORD_LEN) {
    return { success: false, message: 'New password must be at least ' + MIN_PASSWORD_LEN + ' characters.' };
  }
  if (newPassword.length > 128) return { success: false, message: 'New password is too long.' };
  if (newPassword === String(currentPassword)) {
    return { success: false, message: 'New password must be different from the current one.' };
  }
  await setPassword(newPassword);
  return { success: true, token: await issueToken(), message: 'Password updated. Other devices have been signed out.' };
}

// ============================================================
//  ADMIN — DASHBOARD
//  "Attending" / "Not Attending" use the MAIN respondent's status;
//  "Attending Guests" / "Not Attending Guests" count every individual.
// ============================================================
export async function adminGetDashboard() {
  await ensureSchema();
  const [g] = await q(`SELECT count(*)::int AS invited, coalesce(sum(seats), 0)::int AS seats FROM guests`);
  const resps = await q(`SELECT main_status, total_attending, guests FROM responses`);

  let attending = 0, notAttending = 0, seatsConfirmed = 0, notAttendingGuests = 0;
  for (const r of resps) {
    if (r.main_status === ACCEPT) attending++;
    else if (r.main_status === DECLINE) notAttending++;
    seatsConfirmed += Number(r.total_attending) || 0;
    for (const x of r.guests || []) if (x.name && x.status === DECLINE) notAttendingGuests++;
  }
  return {
    success: true,
    rsvpActive: await isRsvpActive(),
    stats: {
      totalInvited: g.invited,
      totalSeatsAllotted: g.seats,
      totalResponses: resps.length,
      pending: Math.max(0, g.invited - resps.length),
      attending,
      notAttending,
      seatsConfirmed,
      notAttendingGuests,
    },
  };
}

// ============================================================
//  ADMIN — GUEST LIST CRUD
// ============================================================
export async function adminGetGuestList() {
  await ensureSchema();
  const rows = await q(`SELECT id, name, seats FROM guests ORDER BY id`);
  return { success: true, guests: rows.map((r) => ({ id: r.id, name: r.name, seats: r.seats })) };
}

export async function adminAddGuest(name, seats) {
  name = String(name || '').trim();
  if (!name) return { success: false, message: 'Guest name is required.' };
  await ensureSchema();
  try {
    await q(`INSERT INTO guests (name, seats) VALUES ($1, $2)`, [name, clampSeats(seats)]);
  } catch (err) {
    if (err && err.code === '23505') return { success: false, message: 'A guest with this name already exists.' };
    throw err;
  }
  return { success: true, message: 'Guest added.' };
}

export async function adminUpdateGuest(id, name, seats) {
  name = String(name || '').trim();
  if (!name) return { success: false, message: 'Guest name is required.' };
  await ensureSchema();
  try {
    const rows = await q(`UPDATE guests SET name = $2, seats = $3 WHERE id = $1 RETURNING id`, [Number(id), name, clampSeats(seats)]);
    if (!rows.length) return { success: false, message: 'Guest not found — it may have been deleted.' };
  } catch (err) {
    if (err && err.code === '23505') return { success: false, message: 'A guest with this name already exists.' };
    throw err;
  }
  return { success: true, message: 'Guest updated.' };
}

// Deleting a guest also removes their RSVP, keeping both tables in sync.
export async function adminDeleteGuest(id) {
  await ensureSchema();
  const rows = await q(`DELETE FROM guests WHERE id = $1 RETURNING name`, [Number(id)]);
  if (!rows.length) return { success: false, message: 'Guest not found.' };
  const del = await q(`DELETE FROM responses WHERE lower(main_name) = lower($1) RETURNING id`, [rows[0].name]);
  return { success: true, message: 'Guest deleted.' + (del.length ? ' Their RSVP was also removed.' : '') };
}

export async function adminBulkDeleteGuests(ids) {
  await ensureSchema();
  ids = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger);
  if (!ids.length) return { success: false, message: 'No guests selected.' };
  const rows = await q(`DELETE FROM guests WHERE id = ANY($1::int[]) RETURNING name`, [ids]);
  const names = rows.map((r) => r.name.toLowerCase());
  const del = names.length
    ? await q(`DELETE FROM responses WHERE lower(main_name) = ANY($1::text[]) RETURNING id`, [names])
    : [];
  return {
    success: true,
    message: rows.length + ' guest(s) deleted.' + (del.length ? ' ' + del.length + ' related RSVP(s) also removed.' : ''),
  };
}

// rows: [{ name, seats }] — duplicates by name (existing or within the file) are skipped
export async function adminImportGuests(rows) {
  await ensureSchema();
  const seen = new Set();
  const names = [], seats = [];
  let skipped = 0;
  for (const g of Array.isArray(rows) ? rows : []) {
    const name = String((g && g.name) || '').trim();
    if (!name || seen.has(name.toLowerCase())) { skipped++; continue; }
    seen.add(name.toLowerCase());
    names.push(name);
    seats.push(clampSeats(g.seats));
  }
  let added = 0;
  if (names.length) {
    const ins = await q(
      `INSERT INTO guests (name, seats)
       SELECT n, s FROM unnest($1::text[], $2::int[]) AS t(n, s)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [names, seats]
    );
    added = ins.length;
    skipped += names.length - added;
  }
  return { success: true, message: added + ' guest(s) imported, ' + skipped + ' skipped (duplicate/blank).' };
}

// ============================================================
//  ADMIN — RESPONSES
// ============================================================
export async function adminGetResponses() {
  await ensureSchema();
  const rows = await q(
    `SELECT id, submitted_at, main_name, main_status, total_attending, message, guests
       FROM responses ORDER BY submitted_at DESC, id DESC`
  );
  return {
    success: true,
    responses: rows.map((r) => ({
      id: r.id,
      timestamp: new Date(r.submitted_at).toISOString(),
      name: r.main_name,
      mainStatus: r.main_status,
      totalAttending: r.total_attending,
      message: r.message || '',
      guestList: r.guests || [],
    })),
  };
}

export async function adminDeleteResponse(id) {
  await ensureSchema();
  await q(`DELETE FROM responses WHERE id = $1`, [Number(id)]);
  return { success: true, message: 'RSVP deleted.' };
}

export async function adminBulkDeleteResponses(ids) {
  await ensureSchema();
  ids = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger);
  if (!ids.length) return { success: false, message: 'No RSVPs selected.' };
  const rows = await q(`DELETE FROM responses WHERE id = ANY($1::int[]) RETURNING id`, [ids]);
  return { success: true, message: rows.length + ' RSVP(s) deleted.' };
}

// ============================================================
//  ADMIN — SETTINGS
// ============================================================
export async function adminGetRsvpActive() {
  await ensureSchema();
  return { success: true, active: await isRsvpActive() };
}

export async function adminSetRsvpActive(active) {
  await ensureSchema();
  await q(
    `INSERT INTO settings (key, value) VALUES ('rsvp_active', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [active ? 'true' : 'false']
  );
  return { success: true, active: !!active };
}

// ============================================================
//  FUZZY GUEST SEARCH
//  • Typos            "Jaun Dela Cruz"      → Juan Dela Cruz
//  • Joined surname   "Juan Delacruz"       → Juan Dela Cruz
//  • Reversed order   "dela cruz juan"      → Juan Dela Cruz
//  • Accents/periods  "Jose Rizzal", "Ma Cristina" → José Rizal, Ma. Cristina
//  • First name only  "Mark"                → "Did you mean…" suggestions
//  A single word never opens an invitation by itself — the guest taps
//  their own name from the suggestions.
// ============================================================

export const FUZZY_THRESHOLD = 0.8;   // score needed to open an invitation directly
export const SUGGEST_THRESHOLD = 0.75; // score needed to appear as a suggestion
export const MAX_SUGGESTIONS = 6;

export function normName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents (ñ -> n)
    .replace(/[^a-z0-9\s]/g, ' ')                      // punctuation -> space
    .replace(/\s+/g, ' ')
    .trim();
}

// Damerau-Levenshtein distance (insert / delete / substitute / transpose)
function lev(a, b) {
  const d = [];
  for (let i = 0; i <= a.length; i++) d[i] = [i];
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

function sim(a, b) {
  const m = Math.max(a.length, b.length);
  return m ? 1 - lev(a, b) / m : 1;
}

// Whole-name score (0..1) — q and n are already normalised
function nameScore(q, n) {
  if (!q || !n) return 0;
  if (q === n) return 1;
  const qc = q.replace(/ /g, ''), nc = n.replace(/ /g, '');
  if (qc === nc) return 0.995;                                  // "delacruz" vs "dela cruz"
  const qs = q.split(' ').sort().join(' '), ns = n.split(' ').sort().join(' ');
  if (qs === ns) return 0.995;                                  // same words, different order
  return Math.max(sim(q, n), sim(qc, nc), sim(qs, ns));
}

// Every typed word must match a word of the registered name — exactly,
// as the start of the word (2+ letters), or with a small typo.
function wordScore(q, n) {
  if (!q || !n) return 0;
  const qt = q.split(' '), nt = n.split(' '), used = {};
  let total = 0;
  for (const w of qt) {
    let bestTok = 0, bestIdx = -1;
    nt.forEach((t, j) => {
      if (used[j]) return;
      let sc = 0;
      if (w === t) sc = 1;
      else if (w.length >= 2 && t.startsWith(w)) sc = 0.9;
      else if (w.length >= 4) sc = sim(w, t);
      if (sc > bestTok) { bestTok = sc; bestIdx = j; }
    });
    if (bestTok < 0.75) return 0;
    used[bestIdx] = true;
    total += bestTok;
  }
  return total / qt.length;
}

// Returns { match: "Registered Name" } or { suggestions: [...] }
export function fuzzyMatch(typed, names) {
  const q = normName(typed);
  if (q.length < 2) return { suggestions: [] };
  const oneWord = !q.includes(' ');

  let best = null, bestScore = 0;
  const cands = [];
  for (const rawName of names) {
    const raw = String(rawName || '').trim();
    if (!raw) continue;
    const nn = normName(raw);
    const sc = nameScore(q, nn);
    if (sc > bestScore) { bestScore = sc; best = raw; }
    const sug = Math.max(sc, wordScore(q, nn));
    if (sug >= SUGGEST_THRESHOLD) cands.push({ name: raw, score: sug });
  }
  cands.sort((a, b) => b.score - a.score);

  // exact (after normalising) always opens
  if (best && bestScore >= 0.99) return { match: best };

  // confident full-name match with no close rival opens directly
  const rivals = cands.filter((c) => c.name !== best);
  if (best && !oneWord && bestScore >= FUZZY_THRESHOLD &&
      (!rivals.length || rivals[0].score < bestScore - 0.08)) {
    return { match: best };
  }
  return { suggestions: cands.slice(0, MAX_SUGGESTIONS).map((c) => c.name) };
}

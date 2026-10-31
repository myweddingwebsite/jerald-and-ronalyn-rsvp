// Public JSON API for an RSVP form embedded on a separate invitation website
// (replaces the Apps Script doGet / doPost endpoints).
//
//   GET  /api/rsvp?action=lookup&name=Mark
//   POST /api/rsvp  { "action": "lookup", "name": "Mark" }
//   POST /api/rsvp  { "action": "submit", "name": "...", "mainStatus": "...", "guest2": "...", "status2": "...", "message": "..." }
import { getGuestData, submitForm } from '../lib/rsvp.js';

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      if (req.query.action === 'lookup') return res.status(200).json(await getGuestData(String(req.query.name || '')));
      return res.status(400).json({ success: false, message: 'Unknown action.' });
    }
    if (req.method === 'POST') {
      const payload = parseBody(req);
      const action = String(payload.action || 'submit');
      if (action === 'lookup') return res.status(200).json(await getGuestData(String(payload.name || '')));
      if (action === 'submit') return res.status(200).json(await submitForm(payload));
      return res.status(400).json({ success: false, message: 'Unknown action: ' + action });
    }
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ success: false, message: 'Method not allowed.' });
  } catch (err) {
    console.error('rsvp api', err);
    if (err && err.isConfig) return res.status(500).json({ success: false, setupError: true, message: err.message });
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
}

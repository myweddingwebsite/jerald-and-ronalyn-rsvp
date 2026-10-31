# Wedding RSVP — Jerald & Ronalyn

Greenery · Moss Green, Eucalyptus Green, White & a Touch of Gold
Wedding: **February 26, 2027** · RSVP deadline: **January 26, 2027**

This version runs on **Vercel Functions + Neon Postgres**, not Google Apps Script.
The pages look and work the same way as the Apps Script version.

## What's inside

```
public/index.html   Guest RSVP page            →  https://your-site.vercel.app/
public/admin.html   Admin dashboard            →  https://your-site.vercel.app/admin
api/rpc.js          Backend for both pages (takes the place of google.script.run)
api/rsvp.js         Public JSON API, for an RSVP form embedded on an invitation website
lib/rsvp.js         RSVP logic (lookup, submit, dashboard, guest list, responses, settings)
lib/fuzzy.js        Fuzzy guest-name search
lib/db.js           Neon connection; creates the tables automatically
lib/auth.js         Admin sign-in (signed 12-hour session)
db/schema.sql       The same tables, if you'd rather create them yourself
```

## Deploy (about 10 minutes)

1. **Put the folder on GitHub.** Upload this folder as a new repository.
   You can also run `npx vercel` inside it.
2. **Import it in Vercel.** Go to Add New → Project and pick the repo.
   Set Framework Preset to **Other** and leave the build settings empty.
3. **Connect Neon.** Open the project, go to **Storage → Create Database → Neon**, and connect it to the project.
   That adds `DATABASE_URL` for you.
4. **Add environment variables** under Settings → Environment Variables:
   - `ADMIN_PASSWORD`: the first dashboard password. After you change it under **Settings → Admin Password**, the new one is stored (hashed) in the database and this variable is no longer used for sign-in.
   - `SESSION_SECRET`: any long random string, for example from `openssl rand -hex 32`.
5. **Redeploy** under Deployments → ⋯ → Redeploy, so the new variables take effect.
6. **Open `/admin`** and sign in. Use **Guest List → Import** to upload the guest list (.xlsx or .csv with *Guest Full Name* and *Seats Allotted* columns), or add guests one at a time.

The tables are created automatically on the first request. Unlike the sheet version, no sample guests are added.

## Troubleshooting sign-in

Open **`https://your-site.vercel.app/api/health`**. It shows what's set up, without revealing any values:

```
{"ok":true,"checks":{"ADMIN_PASSWORD":"set","database_url":"found in DATABASE_URL","database_connection":"ok","tables":"ok — 0 guest(s), 0 response(s)"}}
```

- **`ADMIN_PASSWORD` MISSING:** Add it under Settings → Environment Variables, ticking Production, then **Redeploy**.
- **`database_url` MISSING:** Go to Storage → your Neon database → **Connect Project**, choose this project, then **Redeploy**.
- **`database_connection` FAILED:** Reconnect the database in Storage, then Redeploy. The message says why it failed.
- **HTTP 404 on sign-in:** The `api` folder wasn't deployed. Check that Settings → General → **Root Directory** points at the folder containing `api/` and `public/`.

Environment variables only take effect after a redeploy.

## Where the data lives

| Apps Script sheet | Neon table | Notes |
|---|---|---|
| GUEST LIST | `guests` | Names are unique, ignoring capital letters. Seats can be 1–20. |
| Responses | `responses` | Each guest's name and status is stored in `guests` (JSON), with the main guest first. `message` holds the Message to the Couple. |
| Admin Settings | `settings` + env vars | `rsvp_active` is in the table. The password is `ADMIN_PASSWORD` until it's changed in the dashboard; after that it's the `admin_password_hash` row. |

To browse or export the data, open the **Neon console → Tables** or the SQL Editor. The `response_guests` view in `db/schema.sql` lists one row per guest.

## Embedded RSVP form (optional)

If an invitation website called the old Apps Script `/exec` URL, point it at `/api/rsvp` instead:

```
GET  /api/rsvp?action=lookup&name=Mark
POST /api/rsvp   {"action":"lookup","name":"Mark"}
POST /api/rsvp   {"action":"submit","name":"Mark Christopher Lim","mainStatus":"Joyfully Accepts",
                  "guest2":"Ana Lim","status2":"Joyfully Accepts","message":"Congratulations!"}
```

The response JSON has the same shape as the Apps Script version.

## Built-in safeguards

- Admin functions return 401 without a valid session. An expired session sends the admin back to the sign-in screen.
- A failed sign-in waits about half a second before answering, which slows down password guessing.
- A changed password is stored as a salted scrypt hash, not as plain text. Changing it signs out every other device.
- **Forgot the password?** In the Neon SQL Editor run `DELETE FROM settings WHERE key = 'admin_password_hash';`. Sign-in then goes back to `ADMIN_PASSWORD`.
- Only names on the guest list can RSVP. The registered spelling is saved, and companions beyond the allotted seats are dropped.
- Each guest can submit only one RSVP; the database enforces this.
- The attending count is recalculated on the server. Messages are trimmed to 500 characters and shown as plain text in the admin.

## Local development

```
npm install
npx vercel link
npx vercel env pull .env.local
npx vercel dev
```

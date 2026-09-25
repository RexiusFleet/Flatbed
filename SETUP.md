# Setting up the Dept 12 Dashboard on Supabase

This walks you through connecting a real Supabase project to this code,
step by step. Plan on about an hour the first time. Do the steps in order.

> ## ⚠️ Read this first — login is a placeholder
>
> This version signs **everyone in with one shared email + password**, and
> anyone signed in can see and change **everything** (including Settings →
> Access, which is not enforced yet). That is fine for trying it out with
> the people who already use the local app, but it is **not safe to hand
> the link to anyone else or treat it as secure**. Real per-person logins
> are the next phase — see [Before real users](#before-real-users) at the
> bottom. Until then:
>
> - keep sign-ups turned **off** (step 3) — this is the one setting that
>   stops strangers from making their own account, and
> - only give the shared password to people who should have full access.

---

## What you'll need

- A Supabase account (supabase.com). A **paid (Pro) project** is
  recommended for real use: free projects pause after a week of no use and
  have no daily backups.
- This repository (rexiusfleet/flatbed) on your Mac.
- The Mac that runs the current local app — the real data and document
  files live there, and step 7–8 copy them over.
- **Terminal** on that Mac. Commands to copy are in grey boxes.
- The **Supabase CLI**. Install it once:

  ```bash
  brew install supabase/tap/supabase
  ```

Words you'll see:

| Word | Meaning |
|---|---|
| **Project URL** | `https://<something>.supabase.co` — your project's address. Public. |
| **Publishable key** | `sb_publishable_…` (older projects call it the `anon` key). Public — it goes in the website. |
| **Secret key** | `sb_secret_…` (older: `service_role`). **Private.** Bypasses all security. Only ever typed into your own Terminal for step 8. Never paste it into a file, chat, or the website. |
| **Database password** | The one you pick in step 1. Private. |
| **Project ref** | The `<something>` part of the Project URL. |

---

## Step 1 — Create the Supabase project

1. supabase.com → **New project**.
2. Name: `dept12-dashboard` (anything is fine).
3. **Database password:** click *Generate*, then save it in your password
   manager. You need it in step 7.
4. **Region:** *West US (Oregon)* — closest to the trucks.
5. Create, and wait until the project finishes setting up (a few minutes).

## Step 2 — Build the database (migrations)

This creates every table, rule, and function. The files are in
`supabase/migrations/` and run in order.

1. **Turn on the scheduler extension first** (it deletes History older than
   14 days every night): Dashboard → **Database → Extensions** → search
   `pg_cron` → enable it.
2. In Terminal, go to this repository's folder and connect it to the project:

   ```bash
   cd ~/path/to/flatbed
   ```

   ```bash
   supabase login
   ```

   ```bash
   supabase link --project-ref YOUR_PROJECT_REF
   ```

   (It asks for the database password from step 1.)
3. Push the migrations:

   ```bash
   supabase db push
   ```

   It lists 56 migrations and asks to confirm. Say yes. It should finish
   without errors.

**Check it worked:** Dashboard → **Table Editor** shows tables like
`orders`, `loads`, `trucks`. Dashboard → **Storage** shows a bucket named
`documents` marked **Private**.

> Do **not** run `supabase/seed.sql` on this project — it's fake test data.

## Step 3 — Sign-in settings (important)

1. Dashboard → **Authentication → Sign In / Providers**:
   - **Allow new users to sign up: OFF.** ← the important one.
   - **Email** provider: enabled. ("Confirm email" can stay on; you'll
     confirm the one user yourself below.)
2. Dashboard → **Authentication → Users → Add user → Create new user**:
   - Email: a shared address for the team, e.g. `dispatch@rexius.com`.
   - Password: a long, strong one (save it in the password manager).
   - Tick **Auto Confirm User**.

That email + password is the shared team login for now.

## Step 4 — Deploy the two server functions

Only two things run on a server, because they use private keys that must
never reach a web browser: **Motive mileage sync** and the **Google Sheets
driver-tab push**. From the repository folder:

```bash
supabase functions deploy motive-sync
```

```bash
supabase functions deploy sheets-push
```

**Check it worked:** Dashboard → **Edge Functions** lists `motive-sync` and
`sheets-push`.

## Step 5 — Add the Motive and Google keys (function secrets)

The keys go into Supabase's secret store — **not** into any file in this
repository. The functions read them from there.

| Secret name | Value | Where it is today |
|---|---|---|
| `MOTIVE_API_KEY` | The Motive API key text | `secrets/motive-key.txt` in the local app folder |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The **entire** contents of the Google service-account key file (starts with `{` and ends with `}`) | `secrets/dept-12-dash-….json` in the local app folder |

Easiest and safest way — Terminal reads each file and sends it straight to
Supabase, so the key is never copy-pasted anywhere (run from this
repository's folder, adjusting the local app path if yours differs):

```bash
supabase secrets set MOTIVE_API_KEY="$(cat ~/Desktop/'building dept 12 dashboard'/secrets/motive-key.txt)"
```

```bash
supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON="$(cat ~/Desktop/'building dept 12 dashboard'/secrets/dept-12-dash-*.json)"
```

(Or: Dashboard → **Edge Functions → Secrets** → add each name and paste
the value.)

Notes:
- The Google service account already has edit access to the driver mirror
  sheet (the local app uses it today). Nothing to change in Google.
- The push always writes to the **mirror** sheet the 8 tablets read
  (`15f12Q0N…`). That ID is built into the function on purpose, so no
  setting can ever point it at the dispatcher's working sheet.

**Check it worked:** `supabase secrets list` shows both names (values are
hidden, which is correct).

## Step 6 — Connect the website to the project

1. Dashboard → **Project Settings → Data API**: copy the **Project URL**.
2. Dashboard → **Project Settings → API Keys**: copy the **publishable**
   key (`sb_publishable_…`; on older projects, the `anon` key).
3. Open `config.js` in this repository and paste them in:

   ```js
   window.DEPT12_CONFIG = {
     supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
     supabaseKey: "sb_publishable_…"
   };
   ```

   These two values are public by design — it's fine to commit them.
   **Never** put the secret key here.
4. Commit and push `config.js`.

**Host the site** — it's plain files, no build step. GitHub Pages is
simplest since the repo is already on GitHub:

1. GitHub → the repo → **Settings → Pages**.
2. Source: **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. After a minute it's live at `https://rexiusfleet.github.io/Flatbed/`.

> The repository is **public**, so the code (not the data) is visible to
> anyone. That's OK — no secrets are in it — but it's one more reason not
> to rely on the placeholder login for anything sensitive.

## Step 7 — Copy the real data from the local app

Do this when nobody is using the local app (it's a one-way copy; changes
made locally afterwards won't come across).

1. Dashboard → **Connect** (top of the page) → **Session pooler** → copy
   the connection string. It looks like
   `postgresql://postgres.YOURREF:[YOUR-PASSWORD]@aws-0-us-west-1.pooler.supabase.com:5432/postgres`.
   Replace `[YOUR-PASSWORD]` with the database password from step 1.
2. In Terminal, from this repository's folder:

   ```bash
   read -s TARGET_DB; export TARGET_DB
   ```

   (Paste the connection string and press Enter — it won't show on screen,
   and it isn't saved anywhere.)

   ```bash
   ./tools/import-local-data.sh
   ```

It prints row counts from the local database, loads everything into
Supabase in one go (if anything fails, nothing is changed), then prints the
counts again from Supabase. **The two sets of numbers should match.** The
temporary dump file is deleted automatically.

## Step 8 — Upload the document files (PDFs)

The database now knows about every document; this copies the actual files
into the private `documents` bucket, at the exact paths it expects.

1. Dashboard → **Project Settings → API Keys** → reveal and copy a
   **secret** key.
2. In Terminal, from this repository's folder:

   ```bash
   read -s SUPABASE_SECRET_KEY; export SUPABASE_SECRET_KEY
   ```

   ```bash
   SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co STORAGE_DIR=~/Desktop/'building dept 12 dashboard'/app/storage node tools/upload-documents.mjs
   ```

It reports how many files were uploaded (about 850 today) and should say
`failed 0`. Safe to run again — it skips files already there. It also
writes `upload-manifest.txt` (a list of file fingerprints); keep that
private and don't commit it (it's already in `.gitignore`).

When done, close Terminal (the key disappears with it).

## Step 9 — Check everything works

Open the site, sign in with the shared login from step 3, and check:

- [ ] **Scheduler** shows this week's real loads; scroll back a month.
- [ ] Open an order (click a chip) → **Documents → View** opens the PDF.
- [ ] Drag a chip to another cell, then **Undo** (⌘Z) puts it back.
- [ ] **History** (clock icon in the toolbar) lists that move with your
      shared email as the person who did it.
- [ ] **Bag Orders → Add Orders** gives the next number in sequence.
- [ ] **Billing** → drop a POD PDF → it attaches to the right order.
- [ ] **Export & Reports** → download a report; it opens in Excel.
- [ ] **Bag Orders → Sync Mileage** runs (it says how many days it filled,
      or "Nothing to sync").
- [ ] **Current Week → Update Google Schedule** shows the "Are you sure?"
      box with the right dates. **Only click the red confirm button when
      you actually mean to update the drivers' tablets** — it writes the
      live mirror sheet, same as the local app did.

If something fails, see Troubleshooting below.

---

## Before real users

Everything marked `TODO(AUTH)` in the code is what's missing. The plan
(its own phase, not done yet):

1. Give each person their own Supabase login (ideally Microsoft sign-in
   for the Rexius tenant) instead of the shared account.
2. Link each login to its `app_users` row (the table Settings → Access
   already edits), so History shows the real person.
3. Replace the three stub functions in
   `supabase/migrations/20260924000001_supabase_platform.sql` /
   `…000002_api_functions.sql` — `dept12_is_admin()`,
   `dept12_require_admin()`, `dept12_enforce_view_window()` — with real
   checks against `app_users` / `app_user_grants`.
4. Tighten the `… to authenticated using (true)` row-level security
   policies to match those grants (read AND write, per section).
5. Make the two Edge Functions admin-only (see `_shared/common.ts`).
6. Remove the "Not enforced yet" notice on Settings → Access.

`docs/supabase-server-port-plan.md` (reference copy in `docs/reference/`)
has the longer security checklist from before this port.

## Not included in this version

- **Outlook / billing email drafts** — removed. Billing still downloads
  the merged package PDF; send it however you normally would.
- **Automatic email of any kind** — none.
- **Rexius Bag Orders tablet portal** (`east_portal/`) — not ported yet.
  Its table (`driver_receipt_completions`) is in the database, ready for
  it.

## Troubleshooting

| What you see | Likely cause / fix |
|---|---|
| "Not connected to Supabase yet" | `config.js` still empty, or the site hasn't redeployed yet (step 6). |
| "Invalid login credentials" | Wrong shared email/password, or the user wasn't auto-confirmed (step 3). |
| Scheduler empty after sign-in | Data not imported yet (step 7), or migrations failed (step 2). |
| "Could not open that document" | That PDF wasn't uploaded (step 8) — rerun the upload. |
| "…needs the API key — set the MOTIVE_API_KEY…" | Step 5 secret missing or misspelled; `supabase secrets list`. |
| "…needs the service-account key…" | Step 5 Google secret missing, or the value wasn't the whole JSON file. |
| Google push error mentioning permission | The service account lost edit access to the mirror sheet — share it with the service account's `client_email` again. |
| `supabase db push` fails on `pg_cron` | Enable the extension first (step 2.1), then push again. |
| Dates look a day off | Every migration sets Pacific time; check Dashboard → **Database → Settings** timezone and re-run `supabase db push`. |

Function logs: Dashboard → **Edge Functions → (function) → Logs**.
Database errors: Dashboard → **Logs → Postgres**.

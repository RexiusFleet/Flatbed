# Dept 12 Dashboard (Supabase edition)

Rexius Dept 12's flatbed dispatch and invoicing dashboard: the Scheduler
(truck × day × slot), Current Week and Driver Tabs, Bag Orders / Internal
Freight / External Orders trackers, document ingestion with in-browser
PDF parsing and OCR, Billing packages, the Database grids (customers,
Pick/Drop list, Fleet, departments, custom databases and sheets), reports,
admin History with revert, Motive mileage sync, and the Google Sheets push
that feeds the eight driver tablets.

This is the hosted version: static files + Supabase. There is no app
server and no build step.

> **Login is a placeholder (`TODO(AUTH)`)** — one shared account, full
> access for anyone signed in. Not safe for general or public use yet.
> See [SETUP.md → Before real users](SETUP.md#before-real-users).

## Getting it running

**[SETUP.md](SETUP.md)** — plain-language, step by step: create the
Supabase project, run the migrations, deploy the two functions, set the
Motive/Google secrets, fill in `config.js`, host the page, copy the real
data and documents over, and check each piece works.

## How it's put together

```
Browser (index.html + app.js + supabase-api.js)
   │  hand-rolled fetch client, publishable key + the user's login token
   ├─► Supabase Data API  ── tables (RLS)            simple CRUD
   │                      └─ rpc/api_*  functions     business rules, 1 transaction each
   ├─► Supabase Storage   ── private "documents" bucket (signed URLs only)
   └─► Edge Functions     ── motive-sync  (holds MOTIVE_API_KEY)
                          └─ sheets-push  (holds GOOGLE_SERVICE_ACCOUNT_JSON,
                                           writes ONLY the driver mirror sheet)
```

| Path | What it is |
|---|---|
| `index.html`, `app.css`, `rexius-logo.png` | Page shell and styles. |
| `app.js` | The whole dashboard UI (one file; section banners mark the original `app/web/js/*.js` split). |
| `supabase-api.js` | Data layer: maps every old `/api/<route>` call onto Supabase; shared-login stub; Storage helpers. |
| `config.js` | Project URL + publishable key (public values). |
| `vendor/` | pdf.js, pdf-lib, Tesseract + English model — PDF parsing/OCR stays in the browser. |
| `supabase/migrations/` | Full schema history. The first 54 files are the original local migrations, unchanged; `20260924000001` adds RLS/grants/timezone/storage/audit adaptation; `20260924000002` adds the `api_*` functions. |
| `supabase/functions/` | The two Edge Functions and their shared helpers. |
| `supabase/seed.sql` | Synthetic test data only — never for the real project. |
| `tools/` | One-time helpers: copy local data in, upload document files. |
| `dev/` | Local test harness (fake Supabase on one machine) and smoke tests. |
| `docs/ARCHITECTURE.md` | Route-by-route map from the old Python server to Supabase, plus port notes. |
| `docs/reference/` | Business rules and decision history carried over from the original repo. |

## What changed from the local version

- The Python server is gone. Each of its routes is now a Postgres function,
  a direct table call, a Storage call, or (Motive, Google only) an Edge
  Function — see `docs/ARCHITECTURE.md`.
- **Removed:** Outlook billing drafts and every kind of outbound email.
  "Draft" buttons are gone; Billing downloads the merged package instead.
- Documents live in a private Storage bucket instead of `app/storage/`.
- History (audit) keeps working through the same database triggers; each
  browser request is labeled the same way the server used to label it.
- **Not ported yet:** the Rexius Bag Orders tablet portal (`east_portal/`).

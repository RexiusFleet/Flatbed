# WORKTREE

Compact repository map. Keep this file current when files move or their roles
change. Detailed rules live in `CLAUDE.md`; decisions and verification live in
`docs/decisions.md`.

## Current state

- Local Python/Postgres dashboard; no build step and no pip dependencies for the
  app. App-wide Supabase Auth and delegated Outlook Graph drafts are scaffolded
  behind disabled-by-default feature flags; see `docs/auth-outlook-activation.md`.
- Client code is assembled from `app/web/js/*.js` into `/app.js` at request
  time. Restart the server after editing `app/server.py`.
- Database migrations are in `supabase/migrations/`; `supabase/seed.sql` is
  synthetic data only.
- Migrations are strictly ordered and additive — never edit an already-applied
  file, add a new one. Latest is `20260912000001`; what each one changed and
  why lives in the current or archived decision logs (start at
  `docs/decisions.md`), not here.
- Real-data imports belong in `scripts/` and write to local Postgres, never to
  `seed.sql`.
- Current feature status and open work: `CLAUDE.md` and the tail of
  `docs/decisions.md`.

## Main paths

| Path | Role |
|---|---|
| `app/server.py` | Local HTTP server, API routes, Postgres queries, client assembly. |
| `app/adapters.py` | Sheets, Motive, storage, mail, and auth adapters; external integrations. |
| `app/web/index.html` | UI shell and vendored library loading. |
| `app/web/app.css` | Application styling. |
| `app/web/js/*.js` | Browser client, split by responsibility below. |
| `east_portal/` | Separate Rexius Bag Orders tablet web app and local server. |
| `login/` | Standalone Microsoft/Supabase login surface; disabled configuration by default. |
| `docs/auth-outlook-activation.md` | Auth/Outlook architecture and activation checklist. |
| `docs/east-driver-portal-plan.md` | Rexius Bag Orders local workflow and temporary boundary. |
| `docs/supabase-server-port-plan.md` | Whole-dashboard Supabase/server architecture, staging gates, cutover, rollback, and retirement. |
| `docs/archive/` | Completed point-in-time reports that remain useful as history. |
| `docs/decisions-archive*.md` | Older numbered decision ranges; linked from the current decision log. |
| `supabase/migrations/` | Ordered schema and RLS changes. |
| `supabase/seed.sql` | Synthetic development fixtures; never add real customer data. |
| `scripts/` | One-off/import utilities for real local data, plus reversible stress/smoke tests. |
| `scripts/fill_missing_bag_order_numbers.py` | D224 blank Bag Order number/pallet repair; delivery-month numbering, one-month shift for earlier duplicates, conflict review and original-row audits. |
| `scripts/reconcile_umatilla_season.py` | D221 Umatilla correction including reviewed related routes; dry-run preview, original-record audit, and repeat-safe local apply. |
| `scripts/reconcile_schedule_notes.py` | D221 instructions/holidays to schedule notes; protects paperwork and shared trips, preserves text/placement, and audits removed import rows. |
| `scripts/reconcile_bag_customers.py` | D221 confirmed customer/pallet mappings; preserves short numbers and flags unresolved order months. |
| `scripts/reconcile_external_orders.py` | D221 continued: external broker/load#/order# assignment from a hand-confirmed `ALIASES` dict; holds genuine collisions instead of guessing. |
| `scripts/reconcile_internal_orders.py` | D221 continued: internal (Bag Order) full numbering + brand/store-number customer matching; same collision-holding model. |
| `scripts/reconcile_yard1_transfers.py` | D221 continued (2026-09-12): one-time, id-matched cleanup — deletes/notes two dead rows and reclassifies the Stutzman/Columbia Carb/Ultra Block "to Yard #1" routes to Internal Freight against Yard 1 - 03. |
| `scripts/add_new_brokers.py` | D222: diffs the live "outside customer list" Google Sheet tab against local `parties(is_broker)` by normalized name; adds only genuinely new brokers. |
| `scripts/import_pickdrop_list.py` | D227: replaces the Pick/Drop List's test-only state with the dispatcher sheet's real "Pick/Drop List" tab (938 rows) — one-time, deletes the unreferenced seed.sql placeholder first. |
| `scripts/reconcile_lignetics.py` | D222: Lignetics rows are external freight for Bi-Mart, not a Bag Order — one-time fix to `kind='external'` + broker=BI-MART for all 27 imported rows. |
| `scripts/reconcile_unmatched_to_notes.py` | D222: final import disposition — any remaining unmatched external (no broker) or internal (no customer) order becomes plain `schedule_notes` text (raw text preserved), excluding transfers and rows held for a number collision. |
| `scripts/fill_missing_bag_order_numbers.py` | D224: fills missing Bag Order full numbers from `order/pallet` notation in notes, delivery-month numbering with a one-month shift for a same-month duplicate; holds ties/collisions. |
| `scripts/index_sent_pdfs.py` | D225: read-only page/text inventory for the local `Sent - 2026/` scanned PDF batch — step 1 of the document-matching pipeline. |
| `scripts/export_sent_match_context.py` | D225: read-only DB snapshot (external orders + brokers) for matching the Sent - 2026 batch — step 2. |
| `scripts/ocr_sent_pdfs.swift` | D225: local macOS Vision OCR of the Sent - 2026 batch, resumable — step 3. Compile with `swiftc`. |
| `scripts/plan_sent_documents.py` | D225: read-only classification (rate_con/pod/invoice/other) + conservative order matching from OCR text — step 4, writes `output/sent-2026/plan.json`. |
| `scripts/apply_sent_documents.py` | D225: the only writing step — splits each planned document into its own PDF and files it into `documents`, preview-then-`--commit`, idempotent. |
| `fixtures/` | Small test documents, including the scanned rate-con fixture. |
| `output/pdf/` | Generated synthetic demo documents only; never real paperwork. |
| `legacy/` | Original Apps Script and invoicing apps plus superseded UI prototypes; reference/spec, do not edit. |
| `docs/` | Active schema, design, integration plans, decisions, and archived history. |
| `docs/design.md` | Design tokens, component conventions, protected exceptions — read before touching `app.css` or adding UI. |

## Client fragment map

| File | Responsibility |
|---|---|
| `00-auth.js` | Dormant Supabase session, authenticated fetch, and Outlook consent shell; also the local test-login client + gate (D125). |
| `01-core.js` | Globals, navigation shell/footer, order-number formatting, shortcuts, preferences, lookups, placement, shared state. |
| `02-chips-extract.js` | Chips, dates, PDF/OCR extraction, broker matching, colors. |
| `03-drawer-billing.js` | Order drawers, locations, freight, billing actions. |
| `04-views.js` | Scheduler, Current Week, Driver View, Orders, Billing, Database, Reports. |
| `05-settings-nav-search.js` | Settings, navigation, render loop, global/date search. |
| `06-modals-grids.js` | Modals, viewers, custom fields/sheets, editing, ingestion. |
| `07-events.js` | Click delegation, keyboard navigation, drops, drag events. |
| `08-undo.js` | App-wide undo/redo and persistence helpers. |
| `09-color.js` | Scheduler colors, context menus, copy/paste, conditional formatting. |
| `10-select.js` | Multi-cell selection and pointer marquee. |
| `11-toolbar.js` | Formatting toolbar, fonts, sizes, borders, drag plumbing. |
| `12-touch-boot.js` | Touch drag behavior and initial bootstrap. |
| `13-history.js` | Admin-only durable history panel, restore previews, and reversal UI. |

## Legacy reference

- `legacy/tms-appsscript/CLAUDE.md` — sheet tabs and columns; primary dispatch
  reference.
- `legacy/tms-appsscript/Code.js` — original scheduler and driver-tab logic.
- `legacy/invoicing-local/index.html` — active local invoicing UI, extraction,
  OCR, and broker matching logic.
- `legacy/invoicing-appsscript/` — superseded Drive-backed invoicing version.
- `legacy/assets/` — unused alternate source artwork retained for reference.
- `legacy/prototypes/` — superseded dashboard UI explorations.
- Vendored libraries under `legacy/*/vendor/` and `app/web/vendor/` are needed
  for offline PDF/OCR behavior.

## Local run

```sh
python3 app/server.py   # http://localhost:8770
python3 east_portal/server.py   # http://localhost:8785
```

Environment variables and domain traps are documented in `CLAUDE.md`. Do not
commit `secrets/` or local storage.

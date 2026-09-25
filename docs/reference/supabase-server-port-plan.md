# Dept 12 Dashboard — Supabase and Production Server Port Plan

Last reviewed: 2026-09-11

Feature baseline: D1–D213, including all migrations through
`20260910000004_directory_archives.sql`

## Purpose

This is the source of truth for moving the **entire Dept 12 dashboard** from the
local Mac/Postgres setup to a hosted production server backed by Supabase.

It covers the dashboard first: dispatch, order trackers, database grids,
documents, billing, reports, permissions, history, Google driver-sheet push,
Motive mileage, and Microsoft Outlook drafts. **Rexius Bag Orders is one small
connected component of this port**, not the center of the architecture.

The code can continue to be built and tested locally. Nothing should point to a
production Supabase project until the staging gates in this document pass.

## Decisions already made

- Supabase Postgres becomes the only business-data source of truth.
- PDFs and other document bytes move to one private Supabase Storage bucket;
  `documents` rows remain the searchable metadata/source link.
- Browsers talk to trusted Python servers, not directly to business tables or
  private Storage.
- The dashboard and login share one HTTPS origin.
- Rexius Bag Orders keeps a separate tablet-friendly HTTPS web-app origin, but
  uses the same orders, trucks, documents, database, and private bucket.
- Google Drive is not part of the Bag Orders workflow.
- The existing Google Sheets **driver mirror** remains an outbound dashboard
  integration until the regular eight-tablet scheduling workflow is retired.
- Production starts with one long-running dashboard instance and one small Bag
  Orders instance. This matches the current code and avoids a serverless rewrite.
- Production dates use `America/Los_Angeles`; business dates must not silently
  change because a hosted database defaults to UTC.
- No commit, migration, or deployment is applied directly to production before
  it passes against a separate staging Supabase project.

## Review baseline

The plan was checked against the current repository, the 30 most recent feature
commits, every environment-variable call site, the complete migration chain,
both Python servers, all API route families, the login scaffold, adapters, local
document storage, and the current local Postgres schema.

At review time the local production-shaped database had:

- PostgreSQL 17.10 with `America/Los_Angeles` session time;
- 31 application tables and 4 views before the Bag Orders migration;
- 32 application tables after the Bag Orders migration;
- `pgcrypto` and `btree_gist` extension requirements;
- 11 locally stored document objects (about 1.3 MB at that moment); and
- durable-history triggers on every existing mutable table after
  `20260910000002_driver_receipt_history.sql` is applied; and
- the Bagger Customer archive timestamp/index from
  `20260910000003_bagger_customer_archive.sql`; and
- the External Customer and Internal Freight archive timestamps/indexes from
  `20260910000004_directory_archives.sql`.

Those numbers are an audit snapshot, not cutover values. Recalculate all counts,
sizes, and checksums immediately before staging import and production cutover.

## Current feature coverage

Every row below must survive the port. A successful login and a visible home
page are not enough to call the migration complete.

| Current capability | Hosted dependency/treatment | Required proof |
|---|---|---|
| Scheduler, Staging, Current Week, truck-off days, free-text cells, drag/drop, outside-carrier lane | Same Postgres schema and dashboard API | Schedule, move, unschedule, carrier, free-text, and truck-off smoke tests persist after reload. |
| Driver Tabs dashboard view and live eight-tablet mirror push | Google Sheets API service account; mirror ID must remain `15f12…` | Dry run and confirmed push preserve the exact D178–D185 columns, chip text, blank lines, map links, colors, tab order, and free-text cells. |
| Bag Orders, Internal Freight, and External Orders | `orders`, routes/stops, loads, joins, parties, locations, departments | Create/copy/bulk-add/stage/cancel/delete/lock rules and sequential order numbering behave under concurrent hosted requests. |
| Custom external routes and stop-specific paperwork | `order_stops`, `load_stops`, document relationships | Simple/custom-route conversion, stop order, and locked delivered/invoiced routes remain intact. |
| Motive mileage sync | Outbound HTTPS to Motive using a server-only key | Admin-only sync preserves no-data stamps, manual mileage overrides, and truck/day matching. |
| Internal freight rate and minimum (D170/D187) | `internal_freight_rate` plus order mileage/transfer amount | Motive and hand-entered mileage fill only blank transfer amounts; a typed-over dollar value always wins. |
| Bagger Customers, Pick/Drop, Fleet, Internal Freight, External Customers | Typed tables plus metadata-described built-in grids | Values, dropdowns, row order, field order, colors, and custom columns match local; archives for Bagger Customers, External Customers, and Internal Freight stay out of future pickers/search/export but remain available to old orders and can be restored. |
| Custom databases/sheets and cell formatting | `entities`, `fields`, `records`, `sheets`, `sheet_cells`, grid formatting/order tables | Create/edit/reorder/delete and formatting survive reload and export. |
| Document ingestion, matching, OCR, attachment, viewer, package generation | Private Storage plus `documents`; vendored PDF.js, pdf-lib, Tesseract and language data ship with the app | Rate-con/POD/invoice/other matching cascade, scanned OCR, unmatched queue, viewer, attachment move, and merged PDFs work. |
| Billing and Outlook draft creation | Delegated Microsoft Graph; local Outlook COM is not available on a hosted server | Approved user can reconnect Outlook, create a draft with small and large attachments, and open the returned draft. |
| Reports and friendly CSV export | Current SQL views/queries and server authorization | Every report runs with local-equivalent totals, filters, and friendly headers. |
| Admin users, grants, and Scheduler date windows | Supabase Auth mapped to `app_users` and server-side read/write enforcement | Admin/restricted/disabled/unmapped accounts get exactly the intended data and actions. |
| Durable History, single-event revert, 4-day warning, 14-day retention | Audit triggers, authenticated actor mapping, and one singleton purge worker | All mutable tables audit correctly, reverts conflict-check, external effects stay non-reversible, old events purge once. |
| Appearance, scheduler sizing, days shown, rail width, keymap, formatting palette | Deliberately device-local browser storage | Preferences remain per browser; no database migration is expected. |
| Store-map/image links and map searches | Existing external URLs; no blob import is currently planned | Links still open from the hosted origin and no secret is required in the browser. |
| Rexius Bag Orders | Separate web app; same Postgres/Storage; automatic completion mail | Umatilla filter, receipt view, signature, active truck number, ordinary POD, delivered state, and email all pass end to end. |

Recent UI-only commits (toolbar rules, status pills, design tokens, empty states,
button naming, row/column sizing, tab behavior, and scroll-preserving mileage
edits) do not add cloud services, but they are still part of the browser
acceptance pass. The hosted files must be the exact current `app/web` files, not
an older generated bundle.

## Target architecture

```text
Staff browser
  -> https://dashboard.<company-domain>
     -> login + dashboard static files
     -> dashboard Python API
        -> Supabase Auth verification
        -> Supabase Postgres (dashboard runtime role)
        -> private Supabase Storage `documents` bucket
        -> Google Sheets API (driver mirror only)
        -> Motive API (read-only mileage)
        -> Microsoft Graph (delegated billing drafts)

Driver tablet Safari / Home Screen
  -> https://bagorders.<company-domain>
     -> Rexius Bag Orders static files + Python API
        -> same Supabase Postgres (restricted portal runtime role)
        -> same private `documents` bucket
        -> server-only completion-mail delivery worker
           -> Microsoft Graph application mail
              -> nathanl@rexius.com

Browser-only outbound links
  -> Google Maps / saved store-map URLs / existing location image URLs
```

The dashboard frontend calls only its same-origin dashboard API. The tablet
frontend calls only its same-origin Bag Orders API. No database password,
Supabase secret/service key, Google service-account key, Motive key, or Microsoft
application credential is sent to a browser.

## Hosting shape

Use a managed persistent container/VM platform that supports:

- long-running Python processes;
- raw TLS Postgres connections to Supabase;
- outbound HTTPS to Supabase, Microsoft Graph, Google APIs, and Motive;
- an HTTPS custom domain and reverse proxy;
- secret injection or mounted secret files;
- health checks, restart-on-failure, logs, and one-instance minimums; and
- enough request/body capacity for base64 document upload and PDF processing.

An edge-only/static Site host is not suitable for the current Python servers
because they use raw Postgres sockets and long-running process state. It would
require an unnecessary HTTP-data-layer rewrite. Static assets may use a CDN in
front of the servers later, but that is not required for the first year.

Start with one instance of each server. The dashboard currently runs the 14-day
history purge in a background thread, and both servers currently keep a bounded
amount of process-local cache/session state. Before horizontal scaling, move the
purge to a singleton scheduled job and confirm all other state is shared or
disposable.

### Production runtime work still required

- Pin a supported Python version and runtime dependencies (`psycopg[binary]`
  and `certifi`) in a deployable requirements/lock file.
- Add a container/service definition that runs as a non-root user and excludes
  `.env`, `secrets/`, local Postgres data, test outboxes, and local documents.
- Put both Python services behind managed HTTPS ingress; never expose their raw
  ports directly.
- Keep loopback as the local default and set `DEPT12_HOST`/
  `EAST_PORTAL_HOST=0.0.0.0` only inside their containers.
- Add `/health/live` and database/Storage-aware `/health/ready` endpoints.
- Replace unbounded per-thread Postgres connections with explicitly sized
  application pools and close/recycle stale connections.
- Set request concurrency, header/body limits, upstream and downstream timeouts,
  graceful shutdown, and restart behavior.
- Return generic production errors while logging structured diagnostics with a
  request ID; never print connection strings, access tokens, or document data.
- Set `Cache-Control: no-store` for authenticated JSON/reports/documents and
  production security headers (CSP, HSTS at ingress, frame restrictions,
  content-type protection, referrer and permissions policies).
- Vendor or exactly pin the Supabase browser SDK; do not ship an unpinned `@2`
  CDN dependency under a strict production CSP.

## Supabase project and database connection

Use separate Supabase projects for staging and production. Production should be
on a paid plan so it is not paused for inactivity and has managed daily database
backups. Decide separately whether the extra cost of PITR is justified; the
initial recommended recovery target for this small one-year system is a tested
24-hour maximum backed by daily independent exports.

For each long-running server:

- use the direct connection when the host supports IPv6;
- otherwise use the shared Supavisor **session pooler** on its documented port;
- do not use transaction mode for the current session-state/audit design;
- copy the exact connection string from Supabase **Connect**;
- require TLS (`sslmode=verify-full` with the downloaded project CA when the host
  supports it; at minimum `sslmode=require`); and
- set the Postgres session timezone to `America/Los_Angeles` on every new
  connection.

Migration/backup jobs use a separate admin connection. Runtime containers never
receive the migration owner password.

Official references: [connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres),
[pooling and limits](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits),
and [SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement).

## Database security

The browser does not need Supabase REST or GraphQL access to business data.
Therefore the safest first production configuration is:

1. turn off the Supabase Data API for the project, or expose a deliberately
   empty/dedicated API schema instead of `public`;
2. revoke `anon` and `authenticated` business-table, sequence, and routine
   privileges and remove the current broad `authenticated ... using (true)`
   policies as defense in depth;
3. create two custom login roles outside normal app migrations:
   - dashboard runtime: required DML/read access across the application schema;
   - Bag Orders runtime: only the order/location/truck/document reads and
     completion writes its routes require;
4. create explicit RLS policies for those runtime roles rather than making the
   services table owners or giving them `BYPASSRLS`;
5. keep audit tables writable only through their security-definer capture
   function and the dashboard's narrowly authorized history operations; and
6. test from an external client that the publishable key plus a valid staff JWT
   cannot query, mutate, or call business objects directly.

Supabase recommends disabling the Data API when it is unused and using a
dedicated exposed schema when it is needed:
[securing the Data API](https://supabase.com/docs/guides/api/securing-your-api).

## Supabase Auth and dashboard permissions

Microsoft company sign-in is scaffolded but is **not production-ready by
flipping a flag**. Token verification and local dashboard authorization are
currently separate systems. Before staging:

1. add a unique stable Supabase user ID (`auth.users.id`) plus normalized email
   to `app_users`;
2. provide an admin-controlled mapping/invitation process; never authorize only
   because an email exists;
3. map each verified JWT to one enabled `app_users` row on every request;
4. make existing admin/grant/date-window checks use that mapped row;
5. attribute durable-history events to that same row and display name;
6. enforce **view** grants server-side on bootstrap data, reports, documents,
   history, and all GET endpoints—not only by hiding browser tabs;
7. enforce edit/admin grants server-side on every POST route, failing closed for
   unmapped routes;
8. reject disabled, deleted, duplicate, and unmapped identities;
9. disable `DEPT12_LOCAL_AUTH_ENABLED` in staging and production; and
10. test token refresh, expiry, revocation, sign-out, direct file URLs, and
    concurrent sessions.

Configure the Entra/Supabase Azure provider for the Rexius tenant only, request
the required `email` scope, set exact production/staging Site URLs and redirect
allowlists, and avoid broad wildcard production redirects. Supabase's current
Azure setup is documented at [Sign in with Azure](https://supabase.com/docs/guides/auth/social-login/auth-azure)
and [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

Serve login under the dashboard origin for production. Replace the current
hard-coded localhost links/config with server-provided environment values. The
browser-readable publishable key is acceptable; the Supabase secret/service key
and Entra client secret are not.

## Private document storage

Create one private bucket named `documents`. All order document kinds share it:
rate confirmations, unsigned delivery receipts, PODs, invoices, packages, and
other attachments. Bag Orders does not get a separate bucket or folder system.

Required work:

- finish staging verification of `SupabaseStorage.save/read/move/delete` with
  filenames containing spaces and non-PDF MIME types;
- keep `documents.storage_path` relative and unchanged across local and hosted
  storage;
- make uploads create UUID-prefixed object paths and prevent an accidental
  overwrite outside an explicit migration rerun;
- validate file signatures/types and cap decoded size before storing;
- make database/object failure compensation explicit so neither orphan rows nor
  orphan objects accumulate;
- serve files only through an authorized server route or narrowly scoped,
  short-lived signed URL;
- never return the Storage secret/service key to either browser; and
- inventory object count, size, and SHA-256 before and after every migration.

Supabase secret/service keys bypass Storage RLS and must remain server-only.
Private bucket downloads require authorization or a signed URL:
[Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
and [bucket fundamentals](https://supabase.com/docs/guides/storage/buckets/fundamentals).

## External integrations

### Google Sheets driver mirror

This remains part of the hosted dashboard because the regular eight driver
tablets still read the existing mirror sheet.

- Mount/store the current Google service-account JSON as a server secret.
- Grant it edit access only to the required mirror workbook.
- Keep `DEPT12_SHEETS_ID` fixed to the mirror `15f12…`, never the replaceable
  dispatcher workbook `1KlPQ…`.
- Keep the push manual/confirmed and admin-only.
- Add explicit HTTPS timeouts and bounded exponential backoff for 429/5xx
  responses. A repeated push is safe because it rewrites the same projection.
- Keep the current dry-run response and audit the confirmed push as a
  non-reversible external effect.
- Test every real truck tab plus Current Week, tab order, colors, formatting,
  free-text cells, and the exact D178–D185 driver columns.

Google documents per-minute quotas and recommends exponential backoff for quota
errors: [Sheets API usage limits](https://developers.google.com/workspace/sheets/api/limits).

### Motive mileage

- Provide the read-only Motive key through the server secret manager or a
  read-only mounted secret file.
- Preserve the current truck-number/date matching and one-call-per-date-range
  batching.
- Keep sync/admin routes unavailable to restricted users.
- Add explicit network timeout, bounded retry, and a clear partial-failure log.
- Test no-data stamping, old orders, adjusted mileage, handwritten mileage, and
  D187's freight calculation/type-over rule.

### Microsoft billing drafts

Hosted Outlook COM is impossible, so production billing drafts use the existing
delegated Graph path. Keep this separate from automatic Bag Orders mail.

- Use the Supabase/Entra signed-in user's delegated provider token.
- Request `Mail.ReadWrite` only when the user connects Outlook.
- Decide before production whether periodic Outlook reconnection is acceptable;
  otherwise implement a server-side encrypted refresh-token broker.
- Never persist provider refresh tokens in public/browser-readable tables.
- Test direct attachment and upload-session paths, draft ownership, returned
  Outlook link, and revoked consent.

### External map and image URLs

Google Maps searches, saved store-map links, and current location-image URLs can
remain browser links. Inventory the image domains for the CSP and verify they are
durable. If the external store-image repository is ever retired, copy those
images into the same private/object-storage strategy through a separate planned
migration; do not silently break the URLs during this port.

## Rexius Bag Orders connection

Rexius Bag Orders stays visually and operationally separate for the two or three
tablets, but it consumes ordinary dashboard data:

1. dashboard staff drops an unsigned PDF into the Bag Order's normal Documents
   box;
2. the dashboard creates a normal `delivery_receipt` document;
3. the portal shows an open Bag Order only when its **order delivery location**
   is Umatilla (`locations.is_umatilla = true`) and no completion exists;
4. the driver signs and submits an active truck number;
5. the portal creates one ordinary `pod`, one
   `driver_receipt_completions` row, and marks the order delivered; and
6. both the original and signed PDF remain in the dashboard's same Documents
   list.

`DRIVER_PORTAL_SCOPE=umatilla` is the initial setting. Changing it to `all`
later expands the queue without changing tables, documents, or workflow.

The portal has no driver picker. Use a strong one-time shared tablet access code
that creates a signed, secure, HttpOnly device cookie. Hosted activation must
refuse blank access/session secrets, rate-limit unlock attempts, validate same-
origin state-changing requests, and provide a way to rotate all tablet sessions.

### Reliable completion email without extra UI

The signed POD/database transaction remains authoritative. To ensure the email
is not lost if the server stops immediately after that transaction, add a small
server-only delivery ledger/outbox keyed uniquely to the completion:

- the completion transaction inserts the email job atomically with the POD;
- a single worker sends through Microsoft Graph application mail;
- success records provider/message ID and `sent_at`;
- failures record a sanitized error and retry with a bounded schedule;
- duplicate completion requests cannot create another POD or mail job; and
- no pending-email screen, driver prompt, or dashboard workflow is added.

Use a separate Entra application registration for this application-only
`Mail.Send` path. Scope it to one approved sender mailbox with Exchange Online
App RBAC, store its credential only in the server secret manager, and send the
signed PDF to `nathanl@rexius.com`. Microsoft describes App RBAC as the current
resource-scoped model; legacy Application Access Policies have been replaced:
[Exchange App RBAC](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac).

## Time, background work, and concurrency

- Set Supabase/database project expectations and every application connection
  to `America/Los_Angeles` for `current_date`, truck assignment dates, delivery
  dates, completed-today lists, and history boundaries.
- Keep `timestamptz` values stored as instants and convert only for display/day
  grouping.
- Preserve database constraints as the final defense against double scheduling,
  duplicate order numbers, and duplicate receipt completion.
- Test two simultaneous schedule writes and two simultaneous portal completion
  writes; one must win cleanly and the loser must receive a safe conflict.
- Run exactly one history-retention worker and one email-delivery worker. If the
  host scales processes, add database advisory locks/job claiming before adding
  replicas.
- External API calls need explicit timeouts so one Sheets/Motive/Graph request
  cannot hold a server thread indefinitely.

## Schema and data migration method

Do not copy the local database wholesale over Supabase system schemas. Use a
schema-first, data-only application migration:

1. create a fresh staging Supabase project in the intended production region;
2. verify `pgcrypto` and `btree_gist` availability;
3. apply every repository migration in filename order to an empty application
   schema, including all production security/Auth/outbox migrations added by
   this plan;
4. compare the resulting tables, columns, enums, constraints, indexes, views,
   functions, triggers, policies, and grants against a freshly rebuilt local
   database;
5. create an encrypted `pg_dump` data-only archive of application tables—never
   use `supabase/seed.sql` for real data;
6. restore data with audit/business triggers disabled for the load so imported
   rows are not duplicated, recalculated, or recorded as thousands of fake
   history events;
7. restore/set sequence values, re-enable triggers, and run constraint checks;
8. upload local document objects separately, preserving every `storage_path`;
9. verify every table row count, relevant business total, sequence head, object
   count, byte length, and SHA-256 hash; and
10. run application acceptance against staging.

Use direct/session mode for native migration tools, `--no-owner`, and
`--no-privileges`; never restore local roles over Supabase-managed roles. Keep
the dump encrypted while at rest/in transit and destroy temporary copies after
the acceptance/rollback window. Supabase's current Postgres migration guidance
is here: [migrate from Postgres](https://supabase.com/docs/guides/platform/migrating-to-supabase/postgres).

## Backups and recovery

Supabase database backups do **not** include Storage objects. Production needs
both halves:

- managed daily Supabase database backups on a paid project;
- a daily independent logical application-data export;
- a daily private Storage object copy/manifest with hashes;
- separately protected configuration/secret inventory (not secret values in
  the repository);
- a monthly restore drill into a disposable project during the one-year run;
- a documented recovery owner and maximum acceptable data loss; and
- a final archival export when Rexius Bag Orders is retired.

Supabase documents the database-only boundary of its backups here:
[database backups](https://supabase.com/docs/guides/platform/backups).

## Environment and secret inventory

Hosted secrets belong in the hosting provider's secret manager, not `.env` in
the image. Staging and production values must never be shared.

| Setting/secret | Dashboard | Bag Orders | Notes |
|---|---:|---:|---|
| `DEPT12_DSN` | yes | yes, restricted role | TLS connection copied from Supabase Connect. |
| migration/admin DSN | migration job only | no | Never in runtime services. |
| `DEPT12_HOST`, `DEPT12_PORT` | yes | no | Container bind; local remains loopback. |
| `EAST_PORTAL_HOST`, `EAST_PORTAL_PORT` | no | yes | Separate portal origin. |
| `DEPT12_TIMEZONE` | yes | yes | `America/Los_Angeles`. |
| `SUPABASE_URL` | yes/login | yes for Storage | Public project URL. |
| `SUPABASE_PUBLISHABLE_KEY` | yes/login | no | Browser-safe Auth key, not authorization. |
| `SUPABASE_SERVICE_KEY` | server only | server only until a narrower Storage credential is implemented | Never browser-visible. |
| `DEPT12_AUTH_ENABLED=true` | yes | no | Staff dashboard only. |
| `DEPT12_LOCAL_AUTH_ENABLED=false` | yes | no | Mandatory when hosted. |
| `DEPT12_LOGIN_URL` / cookie values | yes | no | Exact HTTPS dashboard origin. |
| `DEPT12_STORAGE=supabase` | yes | yes | Same adapter and bucket. |
| `DEPT12_STORAGE_BUCKET=documents` | yes | yes | One private bucket. |
| Google service-account secret + mirror ID | yes | no | Mirror workbook only. |
| Motive API secret | yes | no | Read-only. |
| delegated Outlook configuration | yes | no | Billing drafts. |
| `DRIVER_PORTAL_SCOPE=umatilla` | no | yes | Can later be `all`. |
| portal access/session secrets | no | yes | Strong, separately rotatable values. |
| portal request-size limit | no | yes | Covers base64 expansion safely. |
| Graph app tenant/client credential + sender | no | yes/worker | Automatic completion email. |
| `EAST_NOTIFY_EMAIL=nathanl@rexius.com` | no | yes | Completion recipient. |

Before deployment, generate a startup validation report containing only which
requirements are present/valid—not their values—and refuse to start production
with local storage, local auth, blank portal protection, no TLS requirement, or
the file/none email mode.

## Ordered implementation and cutover plan

### Phase A — Production-readiness code, still local

- [x] Make dashboard bind host and shared timezone configurable.
- [x] Make Storage bucket configurable and correctly encode object paths/MIME.
- [x] Add no-store handling for API/document responses.
- [x] Add Bag Orders history coverage and clear its connection audit context.
- [ ] Add deployable runtime/container files and pinned dependencies.
- [ ] Add bounded database pools, health endpoints, request limits, timeouts,
  safe errors/logging, and production security headers.
- [ ] Implement Supabase identity mapping plus server-side read/write grants.
- [ ] Add the restrictive Data API/runtime-role/RLS migration and provisioning
  runbook.
- [ ] Finish and test Supabase Storage compensation and migration tooling.
- [ ] Add external API timeout/retry behavior.
- [ ] Add the hidden Bag Orders email outbox and Graph application sender.
- [ ] Add production startup validation.

**Gate:** a clean local rebuild, automated tests, and simultaneous-write tests
all pass before any hosted project is connected.

### Phase B — Build Supabase staging

- [ ] Create paid-shape staging settings in the intended region.
- [ ] Enforce database TLS and record the CA/connection mode.
- [ ] Disable the Data API or expose only the dedicated empty API schema.
- [ ] Apply the complete migration/security chain.
- [ ] Create dashboard and portal runtime roles with separate credentials.
- [ ] Create the private `documents` bucket.
- [ ] Configure tenant-specific Supabase/Entra Auth and exact redirect URLs.
- [ ] Create mapped test users for admin, restricted, disabled, and unmapped
  cases.

**Gate:** independent probes prove no browser role can reach business tables or
private objects directly.

### Phase C — Rehearse migration into staging

- [ ] Back up local Postgres and all local document objects.
- [ ] Import real approved data through the schema-first/data-only method.
- [ ] Import every document and verify hashes.
- [ ] Compare schema manifests, row counts, sequence heads, and business totals.
- [ ] Repeat from scratch once so the runbook is proven, not improvised.

**Gate:** the second clean rehearsal produces the same verified result.

### Phase D — Deploy and connect the dashboard staging service

- [ ] Deploy login/dashboard/API together on one HTTPS origin.
- [ ] Activate Supabase Auth identity mapping and disable local auth.
- [ ] Activate private Supabase Storage.
- [ ] Connect Google Sheets mirror credentials and verify a dry run first.
- [ ] Connect Motive with read-only credentials.
- [ ] Activate delegated Outlook drafts in a non-production mailbox.
- [ ] Verify all feature-matrix rows and recent UI behavior.

**Gate:** Nate approves the dashboard itself before the tablet portal is used as
a reason to call the overall port complete.

### Phase E — Connect Rexius Bag Orders staging

- [ ] Deploy the separate portal origin with its restricted database role.
- [ ] Configure strong tablet access/session secrets and Umatilla scope.
- [ ] Activate the hidden Graph mail outbox/sender.
- [ ] Install staging on one test iPad Home Screen.
- [ ] Complete an unsigned-to-signed order flow and verify the same dashboard
  Documents list plus one delivered email.

**Gate:** portal acceptance passes without changing the dashboard's ordinary
document workflow.

### Phase F — Production cutover

- [ ] Create the production Supabase project and both production services from
  the exact approved artifacts.
- [ ] Configure secrets, DNS, certificates, Auth, private bucket, runtime roles,
  backups, and alerts before importing data.
- [ ] Announce a short local write freeze.
- [ ] Take the final encrypted database dump and document hash inventory.
- [ ] Import data/files and verify every count/hash/sequence/business total.
- [ ] Run read-only production smoke tests.
- [ ] Switch the staff dashboard URL first and verify a real controlled write.
- [ ] Confirm the Google mirror, Motive, and delegated draft integrations.
- [ ] Add Rexius Bag Orders to each approved tablet and enter the device code
  once.
- [ ] Keep the local system unchanged and read-only through the rollback window.

**Gate:** Nate signs off. Only then retire local writes.

### Phase G — Operate for the year

- [ ] Monitor availability, database connections, failed external calls,
  document mismatches/orphans, and unsent completion mail.
- [ ] Verify daily database and Storage backups.
- [ ] Rotate service, Microsoft, Google, Motive, and portal credentials on a
  documented schedule and immediately after device/credential loss.
- [ ] Apply migrations through staging first with a rollback plan.
- [ ] Perform monthly restore drills and quarterly access reviews.

## Full acceptance checklist

### Schema and data

- [ ] Fresh migration chain builds with no manual SQL.
- [ ] Every expected table/view/enum/index/constraint/function/trigger/policy is
  present; no local-only schema drift remains.
- [ ] Row counts, order/load totals, billed/internal freight totals, sequence
  heads, and report totals match.
- [ ] PostgreSQL date behavior is Pacific-time at the UTC day boundary.

### Authentication and authorization

- [ ] Approved Microsoft user maps to exactly one `app_users` row.
- [ ] Restricted view/edit grants are enforced by the server on GET and POST.
- [ ] Admin-only routes reject non-admins.
- [ ] Disabled/deleted/unmapped users and expired/revoked tokens fail.
- [ ] Direct Data API and private object probes fail with browser credentials.
- [ ] Audit events show the real mapped staff actor.

### Dashboard

- [ ] Every feature-matrix row passes after a hard reload and a server restart.
- [ ] Two concurrent writes produce a constraint/conflict, not lost data.
- [ ] Reports and downloads are correct and carry no-store headers.
- [ ] Device-local preferences remain local and do not affect shared records.

### External integrations

- [ ] Google dry-run and confirmed mirror push match the latest Driver Tabs
  layout and preserve the never-change mirror ID.
- [ ] Sheets 429/5xx and timeout behavior is bounded and retry-safe.
- [ ] Motive sync, no-data stamps, manual adjustments, and freight auto-calc all
  match local behavior.
- [ ] Delegated Outlook small/large draft creation and reconnect behavior work.
- [ ] External map and store-image links work under production CSP.

### Documents and Bag Orders

- [ ] Private Storage save/read/move/delete passes for PDF and non-PDF files,
  including names with spaces.
- [ ] Direct private URLs fail; authorized server downloads work.
- [ ] Database/document compensation tests leave no orphan rows or objects.
- [ ] Normal Bag Order upload creates `delivery_receipt`.
- [ ] Umatilla Early/Anytime appear; a non-Umatilla order does not.
- [ ] Blank/unknown/inactive truck numbers are rejected.
- [ ] A valid submission creates one signed POD, one completion, one delivered
  order, and one durable mail job.
- [ ] Double-tap/concurrent submissions do not duplicate POD or mail.
- [ ] A forced server restart after database commit still results in exactly one
  eventual completion email to `nathanl@rexius.com`.
- [ ] Safari Home Screen relaunch, cookie expiry, secret rotation, and deployment
  cache refresh work on a real iPad.

### Operations and recovery

- [ ] Liveness/readiness, restart, log redaction, and alert tests pass.
- [ ] Database and Storage backups are both present and independently restorable.
- [ ] A full restore to a disposable project has been timed and verified.
- [ ] Production rollback has been rehearsed once.

## Rollback

Before cutover, preserve one immutable local database dump, document inventory,
and the unchanged local application. If production verification fails:

1. stop hosted writes;
2. keep the failed hosted database/objects unchanged for diagnosis;
3. return staff to the unchanged local system;
4. do not permit two writable sources of truth; and
5. retry only from a fresh, newly verified snapshot.

After the rollback window, recovery uses the tested hosted database **and**
Storage backups. A database-only restore is incomplete.

## One-year Bag Orders retirement

Retire only the temporary portal surface: disable its host, worker, restricted
runtime role, Graph app credential, access/session secrets, and tablet icons.
Keep `delivery_receipt`, `pod`, `driver_receipt_completions`, audit evidence still
inside its retention window, and the shared document objects. The dashboard,
database, regular driver mirror, and ordinary document workflow continue.

## Remaining decisions before infrastructure is purchased

The plan does not need more application workflow decisions. Before creating the
hosted environments, record these operational values:

- production/staging region;
- persistent container provider and the two final hostnames;
- production Supabase plan and whether 24-hour backups are enough or PITR is
  required;
- approved automatic-mail sender mailbox;
- who owns production alerts, restores, and credential rotation; and
- how long the local read-only rollback copy is retained.

Everything else above is an implementation or verification task, not an open
architecture question.

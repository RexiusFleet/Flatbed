# Architecture and port notes

How the original local app (Python `app/server.py` + Postgres) maps onto
Supabase, and the decisions made while porting. The original business rules
(CLAUDE.md "Traps", decision log) are in `docs/reference/` and still apply
to the UI code in `app.js` — only the server side moved.

## The rule for where logic lives

1. **Postgres function (`api_*`, via `POST /rest/v1/rpc/…`)** — anything
   with a business rule, a lock/guard, or more than one statement. Each is a
   line-for-line port of the Python handler (same validation messages, same
   return shape) and runs as **one transaction** (the Python server ran most
   statements in autocommit, so a failed guard could leave half an action).
   `SECURITY DEFINER` only for guarded rules that must hold even when
   per-user RLS later gets stricter: order numbering, cancel/delete locks,
   bulk freight pricing, delivery-date sync, document delete, history.
2. **Direct table REST call** — plain single-row CRUD (add driver, add
   location, add department, bill/unbill, delete a custom record, admin
   grants/date windows).
3. **Edge Function** — only where a third-party secret is needed:
   `motive-sync` (Motive key) and `sheets-push` (Google service account).
   Both call the database *as the signed-in user* (they forward the
   caller's own headers), so they need no Supabase secret key at all.
4. **Browser** — PDF parsing, OCR, merging (unchanged, vendored libraries).

`supabase-api.js` keeps the old contract: `app.js` still calls
`api("order/update", {...})`, and the table there routes it.

## Route map

| Old route | Now |
|---|---|
| `GET /api/bootstrap` | `rpc/api_bootstrap` (+ stub `me` = admin, TODO(AUTH)) |
| `/api/order`, `/api/order/ingest` | `rpc/api_order_create`, `rpc/api_order_ingest` |
| `/api/internal-order` | `rpc/api_internal_order_add` (DEFINER, advisory lock) |
| `/api/order/transfer`, `/api/order/copy` | `rpc/api_transfer_order_add`, `rpc/api_order_copy` |
| `/api/order/update`, `/api/order/route` | `rpc/api_order_update`, `rpc/api_order_route_save` |
| `/api/order/cancel`, `/api/order/delete` | `rpc/api_order_cancel`, `rpc/api_order_delete` (DEFINER) + Storage delete |
| `/api/order/bill` | REST `PATCH orders` (`billed_at`) |
| `/api/document` | `rpc/api_document_save` (D7 matching, returns path) → Storage upload (row removed if upload fails) |
| `/api/document/attach` | Storage move → `rpc/api_document_attach` (move undone if the RPC fails) |
| `/api/document/delete` | `rpc/api_document_delete` (DEFINER) → Storage delete |
| `/api/file/<path>` | Storage signed URL (5 min) / authenticated download |
| `/api/create-draft` | **Removed** (Outlook out of scope) |
| `/api/schedule`, `/api/load/carrier`, `/api/unschedule` | `rpc/api_schedule`, `rpc/api_load_carrier`, `rpc/api_unschedule` |
| `/api/cell/color`, `/api/cell/format` | `rpc/api_cell_color`, `rpc/api_cell_format` |
| `/api/truck/off`, `/api/day-note`, `/api/category` | `rpc/api_truck_off`, `rpc/api_day_note`, `rpc/api_category` |
| `/api/freight` | `rpc/api_freight` |
| `/api/internal-freight-rate`, `…/calculate` | `rpc/api_internal_freight_rate_save`, `rpc/api_internal_freight_rate_calculate` (DEFINER) |
| `/api/sync-delivery-dates` | `rpc/api_sync_delivery_dates` (DEFINER) |
| `/api/motive/sync-miles` | Edge `motive-sync` → `rpc/motive_sync_candidates`, `rpc/motive_apply_miles` |
| `/api/sheets/push-driver-tabs` | Edge `sheets-push` → `rpc/driver_week_dates`, `rpc/driver_week_data`, `rpc/driver_week_mark_pushed` |
| `/api/driver`, `/api/location`, `/api/department` | REST `POST` on the table |
| `/api/truck`, `/api/assign-truck`, `/api/truck/driver`, `/api/customer` | `rpc/api_truck_add`, `rpc/api_assign_truck`, `rpc/api_truck_driver`, `rpc/api_customer_add` |
| `/api/row`, `/api/row/custom`, `/api/grid/cell-fmt` | `rpc/api_row_update`, `rpc/api_row_custom`, `rpc/api_grid_cell_fmt` |
| `/api/grid/column*` | `rpc/api_grid_column_add` / `_update` / `_delete` |
| `/api/entity*`, `/api/field*` | `rpc/api_entity_*`, `rpc/api_field_*` |
| `/api/record`, `/api/record/update` | `rpc/api_record_create`, `rpc/api_record_update` |
| `/api/record/delete` | REST `DELETE records` |
| `/api/grid/row`, `…/delete`, `…/reorder`, `/api/database/archive` | `rpc/api_grid_row_add`, `rpc/api_grid_row_delete`, `rpc/api_grid_row_reorder`, `rpc/api_database_archive` |
| `/api/sheet`, `/api/sheet/cell` (in-app spreadsheets — not Google) | `rpc/api_sheet`, `rpc/api_sheet_cell` |
| `/api/report/<name>` | `rpc/api_report` → CSV built in the browser with the same headers |
| `/api/history`, `…/preview`, `…/revert` | `rpc/api_history_list`, `rpc/api_history_preview`, `rpc/api_history_revert` (DEFINER; audit tables are not directly readable) |
| `/api/admin/users`, `/grants`, `/view-window` | REST on `app_users` / `app_user_grants` |
| `/api/admin/user/delete`, `/order-number-settings` | `rpc/api_admin_user_delete`, `rpc/api_order_number_settings_save` |
| `/api/local-login`, `/local-logout`, `/local-session` | Replaced by the shared Supabase Auth login (TODO(AUTH)) |
| `/api/sheets/status`, `/api/motive/status` | Dropped (the client never called them) |

## Audit history on PostgREST

The Python server opened one `audit_events` row per request and stored its
id in a **session-level** setting. PostgREST reuses connections between
requests, so that would leak one request's event onto the next (the exact
D131 trap). Now:

- the id is stored **transaction-locally**; one HTTP request = one
  transaction = one event;
- the browser sends `x-dept12-route` / `-label` / `-section` / `-sub`
  headers (the same `HISTORY_LABELS` the server used, ported into
  `supabase-api.js`), and the capture trigger creates the event from them
  on the first changed row;
- the actor is the signed-in user's email (today, the shared login);
- revert keeps D250's three FK-safe passes.

## Things verified before this was committed

Against a local copy of the real data (local PostgREST + a stand-in for
Auth/Storage/Functions, see `dev/`):

- The full 56-migration chain builds from an empty database and re-applies
  cleanly.
- `dev/smoke-test.mjs`: 23 end-to-end checks through the real
  `supabase-api.js` (scheduling, D250 note replace + History revert,
  carrier lane, numbering, locks, freight pricing, routes, documents +
  Storage, grids, custom databases, reports, anon-key lockout).
- Every report CSV is **byte-identical** to the Python server's output on
  the same data; the driver-tab payload and the Google Sheets cell
  formatting requests are identical across three busy weeks (658 chips);
  the Motive mileage parser matches the Python one on a fixture.
- The UI was exercised in a browser: sign-in, Scheduler, drawers, document
  view via signed URL, loose POD drop + auto-match, History panel, Billing,
  Settings/Access, Google push dry run.

**Not verifiable locally (needs the real project / real keys):** an actual
write to the Google mirror sheet, a real Motive API call, and Supabase's
hosted Auth/Storage services themselves. SETUP.md step 9 covers these.

## Port decisions worth knowing

- **Fixed a pre-existing bug:** the D7 matcher labels an exact order-number
  match `'solomon'`, which is not a valid `match_method` value, so the
  Python server failed to save any document auto-matched by order number
  (confirmed against the original code). The port stores
  `'solomon_order_no'`.
- Report CSVs print numbers exactly like Python's `float()` (`255.0`) and
  pad timestamp microseconds to six digits, so exports don't change.
- Storage object names keep the local layout
  (`<order id or "unmatched">/<doc id>_<filename>`); characters Storage
  rejects are replaced with `_` in the object name only (the original file
  name is still stored). All existing paths were already safe.
- The Google mirror sheet ID is a constant in `sheets-push`, deliberately
  not a setting (CLAUDE.md: "its ID must never change").
- `docs/reference/supabase-server-port-plan.md` planned for browsers to
  reach only a trusted server. This port follows the team's
  "static page + Supabase REST + RLS" convention instead, with the
  secret-holding integrations in Edge Functions; the plan's staging,
  backup, and auth-mapping checklists still apply.

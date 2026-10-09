# Dept 12 Dashboard — File Map

A quick guide to what's where. Search this page (⌘F) for a screen, a
button, or a word, and it points you to the file and the part of the file.

---

## 1. How it all connects

```
 Dashboard (dispatcher, signs in)       Driver page /driver/      Bag plant page /bagplant/
   https://rexiusfleet.github.io/Flatbed/   (iPads, pick a name)       (kiosk screen, read-only)
   │  index.html loads, in order:           │ driver/index.html         │ bagplant/index.html
   │    vendor/*.js ─ PDF reading, merging, OCR (in the browser)        │   (both load driver/driver.js,
   │    config.js ─── which Supabase project (public URL + public key)  │    publish-schedule.js, config.js)
   │    publish-schedule.js ─ builds the schedule drivers/bag plant see │
   │    supabase-api.js ─ the "phone line" to Supabase: sign-in + data  │
   │    app.js ───── the whole dashboard                                │
   │    app.css ──── how it looks (driver pages reuse it + driver.css)  │
   ▼                                        ▼                           ▼
 Supabase project  hejfskuvehauviocqhxu  (supabase.com dashboard)
   ├─ Authentication ─── the dashboard login (email + password)
   ├─ Database ───────── all the data (orders, loads, customers, trucks…)
   │    ├─ tables              → Table Editor
   │    ├─ api_* functions     → the dashboard's business rules (staff only, need sign-in)
   │    └─ public_* functions  → what the driver and bag plant pages call (no sign-in, read the
   │                             published schedule, add notes, register scans, log views)
   ├─ Edge Functions ─── code that holds private keys, runs on Supabase's servers
   │    ├─ motive-sync         → talks to Motive (truck mileage and delivery dates)
   │    └─ sheets-push         → RETIRED, delete it in Supabase (see §6)
   ├─ Edge Function Secrets ─ MOTIVE_API_KEY (GOOGLE_SERVICE_ACCOUNT_JSON is retired, delete it)
   └─ Storage ────────── "documents" bucket (private) for PDFs dropped in the app and driver scans
```

**The one rule:** the browser never holds a secret. Everything the browser
needs is public by design (`config.js`). Anything needing a private key
(Motive) goes through an Edge Function on Supabase. There is no Google
Sheets or Google Maps code any more.

**Publishing:** dispatch edits do NOT reach drivers or the bag plant until
**Publish Schedule** is pressed (Scheduler, Current Week, Driver Tabs). That
builds the week in the browser and saves it as the latest published copy;
the driver pages refresh it on load, on return to the tab, every 45 minutes,
and with their Refresh button.

### What calls what

| When you… | The browser (file → function) | Which calls, on Supabase |
|---|---|---|
| open the site / sign in | `supabase-api.js` → `renderLoginGate`, `localAuthCheck` | Authentication (password sign-in) |
| open the dashboard | `app.js` → `reload()` → `api("bootstrap")` → `supabase-api.js` → `loadBootstrap` | `api_bootstrap_v2` (everything except 2025 history older than ~90 days); the view `dept12_boot_orders` lists columns explicitly, so newer `orders` columns are fetched separately (`addApptColumns`, `addRateColumns`) |
| save anything (then refresh) | same `api("bootstrap")` | `api_bootstrap_since` — only rows changed since the last fetch, found through the History log |
| scroll / jump / search back past ~90 days | `app.js` → `ensureHistory()` | `api_bootstrap_history` — the older history, once per session |
| change anything | `app.js` → `api("<route>", {...})` | `supabase-api.js` → `ROUTES["<route>"]` → a Database function or table |
| click **Sync Mileage & Dates** | `app.js` → `runSyncAll` → `api("motive/sync-miles")`, then `api("sync-delivery-dates")` | Edge Function `motive-sync` (last 31 days only) → Motive → `motive_apply_miles`; then `api_sync_delivery_dates`; `syncResultsModal` shows an editable review window |
| click **Publish Schedule** | `api("sheets/push-driver-tabs")` (the route keeps its old name) → `publish-schedule.js` | `driver_week_dates` / `driver_week_data`, then `api_publish_schedule` |
| drop / view a PDF | `api("document")`, `openViewer`, `fetchStoredFile` | Storage bucket `documents` + `api_document_save` |
| open Reports | `vReports` → `api("report-rows")` | `api_report_rows` (falls back to `api_report` "dump" if that function is missing); saved/pinned reports use `api_saved_report_*` |
| export a report | `api("report/<name>")` or the pivot's Export CSV | Database function `api_report` → CSV built in the browser |
| open History | `13-history` section → `api("history…")` | `api_history_list` / `_preview` / `_revert` |
| driver opens `/driver/` | `driver/driver.js` | `public_published_schedule`, `public_log_view` ("Seen by"), `public_add_driver_note`, `public_register_scan`, `public_driver_activity` |

---

## 2. Files in this repo

| File | What it is | Edit it when… |
|---|---|---|
| `index.html` | The page skeleton: header, sidebar, main area, Staging rail, drawer. Loads the scripts in order. | Adding a new script or a new always-there element. |
| `config.js` | Supabase project URL + publishable key. Public by design. | Moving to a different Supabase project. **Never put a secret key here.** |
| `supabase-api.js` | Sign-in (shared login), the Supabase request helpers, the route table that turns `api("…")` calls into Supabase calls, document storage helpers, report CSV builder, History labels. | Adding a new kind of save/load, or changing how login works. |
| `app.js` | The whole dashboard UI — about 10,700 lines, split into 13 labeled sections (see §3). | Almost any change to screens, buttons, behavior. |
| `publish-schedule.js` | Builds the week (each driver tab + Current Week) that **Publish Schedule** saves for the driver and bag plant pages. Global `Dept12BuildSchedule`. Keep it matching `vDriverView`. | Changing the driver-tab layout. |
| `app.css` | All styling (colors, spacing, fonts). Design tokens at the top (`--brand`, `--fs-…`). Also used by the driver and bag plant pages. | Anything visual. |
| `driver/index.html`, `driver/driver.js`, `driver/driver.css`, `driver/scanner.js` | The driver page (`/driver/`): pick a name, Current Week + own tab, notes, POD/BOL scanner (`scanner.js`), "Seen by". Reads only the published schedule. Also try `/driver/?demo` for sample data. `driver.js` has its own copy of the chip rendering (`dvChip`/`dvPlace` in `app.js` is the dashboard's copy of the same view; keep both in step). | Anything drivers see. |
| `bagplant/index.html` | The bag plant page (`/bagplant/`). Same `driver/driver.js`, switched to bag plant mode by `FLATBED_MODE`. Backhaul flags are hidden from it. | Rarely; look changes go in `driver.js`/`driver.css`. |
| `rexius-logo.png` | Header/login logo. | — |
| `vendor/pdf.min.js`, `pdf.worker.min.js` | pdf.js — reads text out of PDFs (rate cons, invoices). | Never (third-party). |
| `vendor/pdf-lib.min.js` | Splits and merges PDFs (invoice batches, billing packages). | Never. |
| `vendor/tesseract*.js`, `worker.min.js`, `eng.traineddata.gz` | OCR for scanned PDFs with no text. | Never. |
| `.gitignore` | Stops secret files and business data from ever being uploaded. | Rarely. Keep it. |

**Not in this repo (on purpose, local-only on the owner's computer):**
`DESIGN.md`, `CLAUDE.md`, `BACKLOG.md`, `archive/` (the removed Google Sheets
and Maps code), `supabase/sql/` (the dated SQL change files the owner pastes into
the SQL Editor), `.claude/` (local dev server `serve.py` and test pages),
`secrets/`, and the unrelated side projects `east_portal/` and `mass-draft-app/`.
The original database setup (`supabase/migrations/`) and Edge Function source
(`supabase/functions/`) are in **Desktop → Dept 12 Supabase setup → backup of
removed repo files**.

---

## 3. Inside `app.js` — section by section

`app.js` is one file split by banner comments. Search for the banner to
jump there, e.g. ⌘F `═══ 04-views`.

| Banner (search this) | What lives there | Key functions |
|---|---|---|
| `═══ 01-core` | Global state, helpers, preferences (theme, accent, font), sidebar navigation, keyboard shortcuts, order-number formatting. | `NAV` list (in 05), `renderSideNav`, `runShortcut`, `formatOrderNumber`, `canView`/`canEdit`, `toast` |
| `═══ 02-chips-extract` | Lookups (`order()`, `party()`), what a **chip** says and what color it is, date helpers, **PDF text + OCR + rate-con parsing**, broker matching. | `buildChip`, `chipHtml`, `pushColorFor`, `cellHasLoad`, `parseRateCon`, `extractInvoiceInfo`, `ocrPdf`, `mergePdfs` |
| `═══ 03-drawer-billing` | The **order drawer** (the panel that slides in when you click a chip or row), pickup/delivery pickers, billing packages. | `openOrder` (external), `openInternalOrder` (bag), `openTransferOrder` (internal freight), `routeSectionHtml` (the Pickup/Drop table with Add Stop and drag reorder), `rateInputHtml` (External Rate), `locCombo`, `partyCombo`, `doPackage`, `billDone` |
| `═══ 04-views` | **Every screen's layout**: Scheduler, Current Week, Driver Tabs, the three order trackers (sortable column headers via `tsortTh`), Billing, Database grids, custom sheets, Reports (dashboard tiles, pivot builder, saved/pinned reports: `RPT_SYSTEM`, `rptRun`, `rptDashHtml`, `rptWinOpen`). | `vScheduler`, `vCurrentWeek`, `vDriverView`, `vInternal`, `vInternalFreight`, `vOrders`, `vBilling`, `vDatabase`, `vSheet`, `vReports`, `toolbarHtml` |
| `═══ 05-settings-nav-search` | Settings pages, the Staging rail, the **`render()` dispatcher** (decides which screen to draw), `reload()`, global search box, **Sync Mileage & Dates** and its review window. | `render`, `reload`, `vSettings`, `renderRail`, `renderSearch`, `NAV`, `runSyncAll`, `syncResultsModal` |
| `═══ 06-modals-grids` | Popups (add customer/location/truck, Add New Location, bulk add orders, day note, confirm), document viewer, spreadsheet-style cell editing, **document ingestion** (rate con / loose POD / invoice batch). | `openModal`, `addLocationModal`, `parseLocationText`, `openViewer`, `startEdit`/`commitEdit`, `ingestRateCon`, `ingestLoose`, `ingestBatch` |
| `═══ 07-events` | The big **click / change / keyboard handlers** — where each button's action is wired. | Search the button's id or `data-…` attribute here, e.g. `"motive-sync"`, `data-report`, `new-order` |
| `═══ 08-undo` | ⌘Z / ⌘⇧Z undo-redo, and the save helpers that record undo steps. | `histPush`, `moveLoad`, `scheduleNote`, `orderFieldSet`, `freightValueSet` |
| `═══ 09-color` | Scheduler cell colors, truck-off days, copy/paste of cells, right-click menus, adding/removing day rows. | `openCtxMenu`, `openDayMenu`, `setTruckOff`, `copyCell`/`pasteCell`, `addDayRow` |
| `═══ 10-select` | Multi-cell selection (drag box), fill handle, dragging a note by its border, smart date fields. | `selStart`, `fillHandleDown`, `noteDragStart`, `smartDateFeed` |
| `═══ 11-toolbar` | The formatting toolbar (fill, text color, bold, borders, font, size, zoom) and drag-and-drop of chips onto cells/Staging. | `renderFmtBar`, `applyFormat`, `applyZoom`, `dropLoadOnCell` |
| `═══ 12-touch-boot` | Touch-screen dragging, sidebar resize, and **startup** (`bootDashboard`). | `bootDashboard`, `startTouchDrag` |
| `═══ 13-history` | The admin **History** panel (list, group by day, revert). | `renderHistoryPanel`, `openHistoryRevertPreview` |

---

## 4. The app, screen by screen

| Sidebar → screen | Draws it (in `04-views`) | What it reads/writes on Supabase |
|---|---|---|
| **Dispatch → Scheduler** | `vScheduler`, `schedCellHtml`, `buildChip` | `api_schedule` (place/move/note/clear), `api_load_carrier`, `api_unschedule`, `api_cell_color`, `api_cell_format`, `api_truck_off`, `api_day_note` |
| **Dispatch → Current Week** | `vCurrentWeek` | same as Scheduler; **Publish Schedule** → `publish-schedule.js` → `api_publish_schedule` |
| **Dispatch → Driver Tabs** | `vDriverView`, `dvSlotCellsHtml` (mirrors what the driver page shows; keep in step with `driver/driver.js`) | same as Scheduler + `publish-schedule.js` |
| **Orders → Bag Orders** | `vInternal`, `bagOrderRowHtml` | `api_internal_order_add` (numbering), `api_order_update`, `api_freight`, **Sync Mileage & Dates** (`motive-sync`, `api_sync_delivery_dates`) |
| **Orders → Internal Freight** | `vInternalFreight`, `xferOrderRowHtml` | `api_transfer_order_add`, `api_order_update`, `api_freight` |
| **Orders → External Orders** | `vOrders`, `extOrderRowHtml` | `api_order_create`, `api_order_update`, `api_order_route_save`, `api_order_copy`, `api_order_cancel`, `api_order_delete` |
| **Billing → Invoices & Packages** | `vBilling` | `api_document_save` / `_attach` / `_delete` + Storage; `orders.billed_date` |
| **Reports → Export & Reports** | `vReports` (dashboard tiles, pivot builder, pinned reports) | `api_report_rows`, `api_report` (CSV), `api_saved_report_list` / `_save` / `_delete` |
| **Database** (tabs across the top) | `vDatabase` → `vBuiltin` (Bagger Customers, External Customers, Pick/Drop, Fleet, Internal Freight departments), `vSheet` (custom sheets) | `api_row_update`, `api_row_custom`, `api_grid_row_*`, `api_database_archive`, `api_grid_column_*`, `api_entity_*`, `api_field_*`, `api_record_*`, `api_sheet*` |
| **Settings** (gear, bottom left) | `vSettings` (General, Shortcuts) | `api_order_number_settings_save` |
| **History** (clock icon, toolbar) | `13-history` | `api_history_list`, `api_history_preview`, `api_history_revert` |
| **Order drawer** (click any chip/row) | `03-drawer-billing` → `openOrder` / `openInternalOrder` / `openTransferOrder` | `api_order_update`, `api_freight`, documents |

---

## 5. Inside `supabase-api.js`

| Search for | What it does |
|---|---|
| `renderLoginGate` / top-of-file comment | How sign-in works. Everyone signed in has full access; accounts are managed in Supabase. |
| `function sbFetch` | Every request to Supabase goes through here (adds the key + login token, refreshes the login when it expires). |
| `function rpc` / `function rest` | Call a Database function / read or write a table directly. |
| `loadBootstrap` | Dashboard data: first load, "only what changed" refreshes, packed-row unpacking, the older-history loader. Falls back to the old `api_bootstrap` if the new functions aren't in the database. |
| `var ROUTES` | **The route table.** `api("order/update")` → `ROUTES["order/update"]` → `api_order_update`. Look here to find what any button actually does on Supabase. |
| `HISTORY_LABELS` | The names shown in the History panel for each kind of change. |
| `REPORT_LABELS` | The column headers used in exported CSVs. |
| `storageUpload`, `storedFileUrl`, `fetchStoredFile` | PDFs in the private Storage bucket (short-lived links only). |

---

## 6. On Supabase (not in this repo)

| Where in the Supabase dashboard | What's there |
|---|---|
| **Table Editor** | The data. Main tables: `orders`, `loads`, `load_orders` (which order is on which load), `schedule_notes` (text in Scheduler cells), `truck_off_days`, `day_notes`, `parties` (customers + brokers + carriers), `locations` (Pick/Drop list + bagger stores), `trucks`, `drivers`, `driver_truck_assignments`, `departments`, `order_stops` / `load_stops` (multi-stop routes), `documents`, `categories` (cell colors), `entities` / `fields` / `records` (custom databases), `sheets` / `sheet_cells` (custom sheets), `audit_events` / `audit_changes` (History), `published_schedules` (what Publish Schedule saves), `driver_notes`, driver scan/view activity, `saved_reports` (pinned reports). |
| **Database → Functions** | Every `api_…` function (the business rules), plus `dept12_…` helpers. Source copy: backup folder → `supabase/migrations/20260924000002_api_functions.sql`. |
| **Edge Functions** | `motive-sync` (in use). `sheets-push` is retired: delete it. Source copy: backup folder → `supabase/functions/`. |
| **Edge Functions → Secrets** | `MOTIVE_API_KEY` (needs an admin to add). |
| **Authentication → Users** | The logins. Add people here (sign-ups off), then add their email to `dept12_private.allowed_logins`. |
| **Storage → documents** | Uploaded PDFs, in folders named by order ID. |
| **SQL Editor** | Where we paste database changes. |

---

## 7. Find it fast

| I want to change… | Go to |
|---|---|
| What a chip says or its color | `app.js` → `═══ 02-chips-extract` → `buildChip`, `chipHtml`, `pushColorFor` |
| A screen's layout or columns | `app.js` → `═══ 04-views` → the `v…` function in §4 |
| What a button does | `app.js` → `═══ 07-events` → search the button's id; then `supabase-api.js` → `ROUTES` |
| A rule (numbering, locks, what can be moved) | Supabase → the matching `api_…` function (§4 lists which) |
| A popup / form | `app.js` → `═══ 06-modals-grids` → `…Modal` |
| Colors, spacing, fonts | `app.css` (tokens at the top) |
| Rate-con / invoice reading | `app.js` → `═══ 02-chips-extract` → `parseRateCon`, `extractInvoiceInfo` |
| Keyboard shortcuts | `app.js` → `═══ 01-core` → `BASE_SHORTCUTS`, `runShortcut` |
| Sidebar menu items | `app.js` → `═══ 05-settings-nav-search` → `var NAV` |
| What drivers and the bag plant see | `publish-schedule.js` (the data) and `driver/driver.js` (the look); keep `vDriverView` in `app.js` matching |
| Pickup/Drop table, External Rate, backhaul | `app.js` → `═══ 03-drawer-billing` → `routeSectionHtml`, `rateInputHtml` |
| Reports dashboard / pivot builder | `app.js` → `═══ 04-views` → `RPT_SYSTEM`, `rptRun` |
| Delete rules for orders | `app.js` → `canDeleteOrder` (and the matching `api_order_delete` rules in Supabase) |
| Report columns | Supabase → `api_report_rows` / `api_report`; headers in `supabase-api.js` → `REPORT_LABELS` |
| Who can sign in | Supabase → Authentication → Users, plus `dept12_private.allowed_logins` (approved emails) |

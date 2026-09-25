# Dept 12 Dashboard — File Map

A quick guide to what's where. Search this page (⌘F) for a screen, a
button, or a word, and it points you to the file and the part of the file.

---

## 1. How it all connects

```
 Your browser
   │   opens  https://rexiusfleet.github.io/Flatbed/   (GitHub Pages hosts the files in this repo)
   │
   │   index.html loads, in order:
   │     vendor/*.js ─── PDF reading, PDF merging, OCR (all run inside the browser)
   │     config.js ───── which Supabase project to talk to (public URL + public key)
   │     supabase-api.js ─ the "phone line" to Supabase: sign-in + every data request
   │     app.js ──────── the whole dashboard (every screen, button, drag & drop)
   │     app.css ─────── how it looks
   │
   ▼
 Supabase project  hejfskuvehauviocqhxu  (supabase.com dashboard)
   ├─ Authentication ─── the login (email + password)
   ├─ Database ───────── all the data (orders, loads, customers, trucks…)
   │    ├─ tables              → Table Editor
   │    └─ api_* functions     → the business rules (numbering, scheduling, locks…)
   ├─ Edge Functions ─── code that holds private keys, runs on Supabase's servers
   │    ├─ motive-sync         → talks to Motive (truck mileage)
   │    └─ sheets-push         → writes the drivers' Google Sheet (the mirror)
   ├─ Edge Function Secrets ─ MOTIVE_API_KEY, GOOGLE_SERVICE_ACCOUNT_JSON
   └─ Storage ────────── "documents" bucket (private) for PDFs dropped in the app
```

**The one rule:** the browser never holds a secret. Everything the browser
needs is public by design (`config.js`). Anything needing a private key
(Motive, Google) goes through an Edge Function on Supabase.

### What calls what

| When you… | The browser (file → function) | Which calls, on Supabase |
|---|---|---|
| open the site / sign in | `supabase-api.js` → `renderLoginGate`, `localAuthCheck` | Authentication (password sign-in) |
| open the dashboard | `app.js` → `reload()` → `api("bootstrap")` → `supabase-api.js` → `loadBootstrap` | `api_bootstrap_v2` (everything except 2025 history older than ~90 days) |
| save anything (then refresh) | same `api("bootstrap")` | `api_bootstrap_since` — only rows changed since the last fetch, found through the History log |
| scroll / jump / search back past ~90 days | `app.js` → `ensureHistory()` | `api_bootstrap_history` — the older history, once per session |
| change anything | `app.js` → `api("<route>", {...})` | `supabase-api.js` → `ROUTES["<route>"]` → a Database function or table |
| click **Sync Mileage** | `api("motive/sync-miles")` | Edge Function `motive-sync` → Motive → `motive_apply_miles` |
| click **Update Google Schedule** | `api("sheets/push-driver-tabs")` | Edge Function `sheets-push` → Google Sheets (mirror only) |
| drop / view a PDF | `api("document")`, `openViewer`, `fetchStoredFile` | Storage bucket `documents` + `api_document_save` |
| export a report | `api("report/<name>")` | Database function `api_report` → CSV built in the browser |
| open History | `13-history` section → `api("history…")` | `api_history_list` / `_preview` / `_revert` |

---

## 2. Files in this repo

| File | What it is | Edit it when… |
|---|---|---|
| `index.html` | The page skeleton: header, sidebar, main area, Staging rail, drawer. Loads the scripts in order. | Adding a new script or a new always-there element. |
| `config.js` | Supabase project URL + publishable key. Both public. | Moving to a different Supabase project. **Never put a secret key here.** |
| `supabase-api.js` | Sign-in (shared login), the Supabase request helpers, the route table that turns `api("…")` calls into Supabase calls, document storage helpers, report CSV builder, History labels. | Adding a new kind of save/load, or changing how login works. |
| `app.js` | The whole dashboard UI — about 10,000 lines, split into 13 labeled sections (see §3). | Almost any change to screens, buttons, behavior. |
| `app.css` | All styling (colors, spacing, fonts). Design tokens at the top (`--brand`, `--fs-…`). | Anything visual. |
| `rexius-logo.png` | Header/login logo. | — |
| `vendor/pdf.min.js`, `pdf.worker.min.js` | pdf.js — reads text out of PDFs (rate cons, invoices). | Never (third-party). |
| `vendor/pdf-lib.min.js` | Splits and merges PDFs (invoice batches, billing packages). | Never. |
| `vendor/tesseract*.js`, `worker.min.js`, `eng.traineddata.gz` | OCR for scanned PDFs with no text. | Never. |
| `.gitignore` | Stops secret files and business data from ever being uploaded. | Rarely. Keep it. |

**Not in this repo (on purpose):** the database setup SQL, the Edge
Function source, and the old setup docs. They live in the Supabase project
itself, with a copy in **Desktop → Dept 12 Supabase setup → backup of
removed repo files** (`supabase/migrations/`, `supabase/functions/`).

---

## 3. Inside `app.js` — section by section

`app.js` is one file split by banner comments. Search for the banner to
jump there, e.g. ⌘F `═══ 04-views`.

| Banner (search this) | What lives there | Key functions |
|---|---|---|
| `═══ 01-core` | Global state, helpers, preferences (theme, accent, font), sidebar navigation, keyboard shortcuts, order-number formatting. | `NAV` list (in 05), `renderSideNav`, `runShortcut`, `formatOrderNumber`, `canView`/`canEdit`, `toast` |
| `═══ 02-chips-extract` | Lookups (`order()`, `party()`), what a **chip** says and what color it is, date helpers, **PDF text + OCR + rate-con parsing**, broker matching. | `buildChip`, `chipHtml`, `pushColorFor`, `cellHasLoad`, `parseRateCon`, `extractInvoiceInfo`, `ocrPdf`, `mergePdfs` |
| `═══ 03-drawer-billing` | The **order drawer** (the panel that slides in when you click a chip or row), pickup/delivery pickers, billing packages. | `openOrder` (external), `openInternalOrder` (bag), `openTransferOrder` (internal freight), `locCombo`, `partyCombo`, `doPackage`, `billDone` |
| `═══ 04-views` | **Every screen's layout**: Scheduler, Current Week, Driver Tabs, the three order trackers, Billing, Database grids, custom sheets, Reports. | `vScheduler`, `vCurrentWeek`, `vDriverView`, `vInternal`, `vInternalFreight`, `vOrders`, `vBilling`, `vDatabase`, `vSheet`, `vReports`, `toolbarHtml` |
| `═══ 05-settings-nav-search` | Settings pages, the Staging rail, the **`render()` dispatcher** (decides which screen to draw), `reload()`, global search box. | `render`, `reload`, `vSettings`, `renderRail`, `renderSearch`, `NAV` |
| `═══ 06-modals-grids` | Popups (add customer/location/truck, bulk add orders, route editor, day note, confirm), document viewer, spreadsheet-style cell editing, **document ingestion** (rate con / loose POD / invoice batch). | `openModal`, `routeEditorModal`, `openViewer`, `startEdit`/`commitEdit`, `ingestRateCon`, `ingestLoose`, `ingestBatch` |
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
| **Dispatch → Current Week** | `vCurrentWeek` | same as Scheduler; **Update Google Schedule** → Edge Function `sheets-push` |
| **Dispatch → Driver Tabs** | `vDriverView`, `dvSlotCellsHtml` (mirrors the drivers' Google tab columns) | same as Scheduler + `sheets-push` |
| **Orders → Bag Orders** | `vInternal`, `bagOrderRowHtml` | `api_internal_order_add` (numbering), `api_order_update`, `api_freight`, `motive-sync`, `api_sync_delivery_dates` |
| **Orders → Internal Freight** | `vInternalFreight`, `xferOrderRowHtml` | `api_transfer_order_add`, `api_order_update`, `api_freight` |
| **Orders → External Orders** | `vOrders`, `extOrderRowHtml` | `api_order_create`, `api_order_update`, `api_order_route_save`, `api_order_copy`, `api_order_cancel`, `api_order_delete` |
| **Billing → Invoices & Packages** | `vBilling` | `api_document_save` / `_attach` / `_delete` + Storage; `orders.billed_at` |
| **Reports → Export & Reports** | `vReports` | `api_report` |
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
| **Table Editor** | The data. Main tables: `orders`, `loads`, `load_orders` (which order is on which load), `schedule_notes` (text in Scheduler cells), `truck_off_days`, `day_notes`, `parties` (customers + brokers + carriers), `locations` (Pick/Drop list + bagger stores), `trucks`, `drivers`, `driver_truck_assignments`, `departments`, `order_stops` / `load_stops` (multi-stop routes), `documents`, `categories` (cell colors), `entities` / `fields` / `records` (custom databases), `sheets` / `sheet_cells` (custom sheets), `audit_events` / `audit_changes` (History). |
| **Database → Functions** | Every `api_…` function (the business rules), plus `dept12_…` helpers. Source copy: backup folder → `supabase/migrations/20260924000002_api_functions.sql`. |
| **Edge Functions** | `motive-sync`, `sheets-push`. Source copy: backup folder → `supabase/functions/`. |
| **Edge Functions → Secrets** | `MOTIVE_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON` (need an admin to add). |
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
| Google driver-tab layout | Edge Function `sheets-push` (backup: `supabase/functions/sheets-push/`) — and keep `vDriverView` matching it |
| Report columns | Supabase → `api_report`; headers in `supabase-api.js` → `REPORT_LABELS` |
| Who can sign in | Supabase → Authentication → Users, plus `dept12_private.allowed_logins` (approved emails) |

# Dept 12 Dashboard — File Map

A quick guide to what's where. Search this page (⌘F) for a screen, a
button, or a word, and it points you to the file and the part of the file.

---

## 1. How it all connects

```
 Dashboard (dispatcher, signs in)       Driver page /driver/      Bag plant page /bagplant/
   https://rexiusfleet.github.io/Flatbed/   (Kevin's app, signs in)    (Kevin's app, read-only)
   │  index.html loads, in order:           │ driver/index.html         │ bagplant/index.html
   │    (vendor/*.js ─ PDF reading, merging, OCR: loaded on first use)   │   (both load driver/driver.js,
   │    config.js ─── which Supabase project (public URL + public key)  │    publish-schedule.js, config.js)
   │    publish-schedule.js ─ builds the schedule drivers/bag plant see │
   │    supabase-api.js ─ the "phone line" to Supabase: sign-in + data  │
   │    app.js ───── the whole dashboard (built from src/js/ by build.js)│
   │    app.css ──── how it looks (driver pages reuse it + driver.css)  │
   ▼                                        ▼                           ▼
 Supabase project  hejfskuvehauviocqhxu  (supabase.com dashboard)
   ├─ Authentication ─── the dashboard login (email + password)
   ├─ Database ───────── all the data (orders, loads, customers, trucks…)
   │    ├─ tables              → Table Editor
   │    ├─ api_* functions     → the dashboard's business rules (staff only, need sign-in)
   │    ├─ public_* functions  → read the published schedule, add notes, register scans, log views
   │    │                         (still open to the public key until the cutover SQL is run)
   │    └─ app_* functions     → the same, for the driver / bag plant pages signed in as the app login
   │                             (flatbedauth@rexius.com): they take an employee number and work out the driver
   ├─ Edge Functions ─── code that holds private keys, runs on Supabase's servers
   │    ├─ motive-sync         → ONE function, three jobs picked by `mode` in the request:
   │    │                          (no mode)       old per-order mileage fill
   │    │                          "days"         truck-days (miles, odometers, first on / last off, hours worked)
   │    │                          "unidentified" gives shop yard-move trips to Shop Mechanic 1 / 2 (see §8)
   │    └─ sheets-push         → unused (still deployed; to be deleted in Supabase, see §6)
   ├─ Edge Function Secrets ─ MOTIVE_API_KEY (GOOGLE_SERVICE_ACCOUNT_JSON is unused)
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
| click **Sync Delivery Dates** | `app.js` → `runSyncAll` → `api("sync-delivery-dates")`, then `motEnsure` (pulls only Motive days not saved yet), then `mrvOpen` (the mileage review window: miles and cost per delivered order, Save confirms) | `api_sync_delivery_dates`; Edge Function `motive-sync` (mode "days") → Motive; `api_motive_days_save` / `_list` (table `motive_daily`); `api_freight`; `orders.miles_confirmed_at` |
| open **Reports → Motive** | `vMotiveTab`, `motWeekHtml`, `motPull` | `api_motive_days_list`; Pull From Motive → `motive-sync` (mode "days") → `api_motive_days_save` |
| click **Publish Schedule** | `api("sheets/push-driver-tabs")` (the route keeps its old name) → `publish-schedule.js` | `driver_week_dates` / `driver_week_data`, then `api_publish_schedule` |
| drop / view a PDF | `api("document")`, `openViewer`, `fetchStoredFile` | Storage bucket `documents` + `api_document_save` |
| open Reports | `vReports` → `api("report-rows")` | `api_report_rows` (falls back to `api_report` "dump" if that function is missing); saved/pinned reports use `api_saved_report_*` |
| export a report | `api("report/<name>")` or the pivot's Export CSV | Database function `api_report` → CSV built in the browser |
| open History | `13-history` section → `api("history…")` | `api_history_list` / `_preview` / `_revert` |
| driver opens `/driver/` or `/bagplant/` (signed in by the company app) | `driver/driver.js` → app mode (`appStart`, `appResolve`, `rpcPublic`) | `app_driver_by_employee` (employee number → driver + current truck), `public_published_schedule`, `app_log_view` ("Seen by"), `app_add_driver_note`, `app_register_scan`, `public_driver_activity` |
| add / rename / switch / retire a driver in **Database → Fleet** | `app.js` → `addDriverModal`, the `data-truckdriver` blur handler, `spareDriversHtml`, `formerDriversHtml`, `data-driveractive` | `api("driver")` (adds a driver), `truck/driver` → `api_truck_driver` (puts a driver on a truck), `row` (rename, Active), `driver/employee-no`, `driver/phone`, `driver/delete` → `api_driver_delete`, `driver/former` (reads inactive drivers) |

---

## 2. Files in this repo

| File | What it is | Edit it when… |
|---|---|---|
| `index.html` | The page skeleton: header, sidebar, main area, Staging rail, drawer. Loads the scripts in order. | Adding a new script or a new always-there element. |
| `config.js` | Supabase project URL + publishable key. Public by design. | Moving to a different Supabase project. **Never put a secret key here.** |
| `supabase-api.js` | Sign-in (shared login), the Supabase request helpers, the route table that turns `api("…")` calls into Supabase calls, document storage helpers, report CSV builder, History labels. | Adding a new kind of save/load, or changing how login works. |
| `app.js` | The whole dashboard UI, about 12,900 lines in one file. **Built, do not edit by hand:** it is the files in `src/js/` joined in order (see §3). | Never directly; edit `src/js/`. |
| `src/js/` | The source of `app.js`: `head.js` (opens the one shared scope), one file per section `01-core.js` … `13-history.js`, `tail.js` (closes it). All sections share one private scope, so a function in one file is callable from every other. | Almost any change to screens, buttons, behavior. Then run `node build.js`. |
| `build.js` | Joins `src/js/*` into `app.js` and sets every `?v=` cache tag in the three html files to a short hash of that file, so a browser re-fetches a file exactly when it changed. `node build.js` rebuilds; `node build.js --check` changes nothing and fails if anything is out of date. Node only, no packages. | Adding a new section file (add it to `JS_PARTS`). |
| `publish-schedule.js` | Builds the week (each driver tab + Current Week) that **Publish Schedule** saves for the driver and bag plant pages. Global `Dept12BuildSchedule`. Keep it matching `vDriverView`. | Changing the driver-tab layout. |
| `ratecon-parser.js` | The rate con reader: `Dept12RateCon.parse(text, opts)` turns OCR text, a PDF text layer, or a pasted email into load #, PO, rate, broker, pickup, delivery (with appointment text), each marked `ok` or `check`. One handler per broker layout (Tradewinds, Nationwide, Aaron Wilson / Smokey Mountain, OpenRoad, Iosco, the ITS dispatch family, Oasis, Vanport, Inland, labeled-form brokers) plus a generic reader, an email reader, and a reader for a customer's own dispatch screen pasted from an email ("Dispatched 09/22/26", "Cust PO. #", fuel surcharge). It reads numbers, rate and the stops; it does not read notes. Runs in the browser and in node, so it can be tested on its own. | A new broker's rate cons read wrong: add or fix its handler. |
| `app.css` | All styling (colors, spacing, fonts). Design tokens at the top (`--brand`, `--fs-…`). Also used by the driver and bag plant pages. | Anything visual. |
| `driver/index.html`, `driver/driver.js`, `driver/driver.css`, `driver/scanner.js`, `driver/paperwork.js`, `driver/outbox.js` | The driver page (`/driver/`): needs the app sign-in (`REQUIRE_APP_LOGIN` at the top of `driver.js`; `?app=1` forces it on). The company app passes the login and employee number in the link hash (`#access_token=…&refresh_token=…&emp=…`) or through `window.dept12App` (`setSession`, `setEmployee`, `signOut`); a sign-in form is the fallback. The employee number is checked in the database; no match = Current Week only, no personal tab. The old name picker is still in the code behind `NAME_PICKER`. Names show as first names (`dFirst`). `paperwork.js` is the paperwork viewer: a PDF the office marked **Show To Driver** is listed as a PDF file chip on the load (next to the scan's chip), opens full screen, and a driver can sign it with a finger or pencil; Send Signed Copy stamps the drawing onto a copy (pdf-lib) and uploads it like a scan (`sendScan`), so it arrives as that driver's POD. pdf.js and pdf-lib load only when one is opened. Every request has a time limit (`fetchTimeout`); the last schedule that loaded is kept on the phone (`cacheSave` / `cacheLoad`) so the page reopens with no signal; notes, scans and signed copies are saved on the phone first and sent by themselves (`driver/outbox.js`, `outboxFlush`, retried when the signal is back). The bag plant page (same file) shows a banner line, a zoom toggle (100% to start), and an Outside Carrier column. Current Week + own tab, notes, POD/BOL scanner (`scanner.js`: take a photo, drag the four corners onto the page, it straightens it and removes shadows; Adjust Edges after), "Seen by". Reads only the published schedule. Also try `/driver/?demo` for sample data. `driver.js` has its own copy of the chip rendering (`dvChip`/`dvPlace` in `app.js` is the dashboard's copy of the same view; keep both in step). | Anything drivers see. |
| `bagplant/index.html` | The bag plant page (`/bagplant/`). Same `driver/driver.js` (and the same sign-in), switched to bag plant mode by `FLATBED_MODE`. Backhaul flags are hidden from it. | Rarely; look changes go in `driver.js`/`driver.css`. |
| `rexius-logo.png` | Header/login logo. | — |
| `vendor/pdf.min.js`, `pdf.worker.min.js` | pdf.js — reads text out of PDFs (rate cons, invoices). Not in index.html: `loadVendor("pdfjs")` in `src/js/02-chips-extract.js` loads it the first time a PDF is read. | Never (third-party). |
| `vendor/pdf-lib.min.js` | Splits and merges PDFs (invoice batches, billing packages, the signed copy) and builds the driver scanner's PDF. Loaded on first use: `loadVendor("pdflib")` on the dashboard, `loadPdfLib` in `driver/scanner.js` (starts when the scanner opens). | Never. |
| `vendor/tesseract*.js`, `worker.min.js`, `eng.traineddata.gz` | OCR for scanned PDFs with no text. Loaded on first use (`loadVendor("tess")` via `getOcrWorker`); opening External Orders warms it up. | Never. |
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

Each section is its own file in `src/js/`, e.g. `04-views` is
`src/js/04-views.js`. `node build.js` joins them, in order, into `app.js`,
which keeps the same `═══ 04-views` banners, so a search there still lands in
the right place. Edit the `src/js/` file, never `app.js`. Everything shares
one private scope (one IIFE: `src/js/head.js` opens it, `src/js/tail.js`
closes it), so files call each other's functions freely and no name leaks
onto `window`. Two functions with the same name anywhere in `src/js/` would
silently override each other (the later file wins): search before naming.

| File in `src/js/` (banner in `app.js`) | What lives there | Key functions |
|---|---|---|
| `01-core.js` | Global state, helpers, preferences (theme, accent, font), sidebar navigation, keyboard shortcuts, order-number formatting. | `NAV` list (in 05), `renderSideNav`, `runShortcut`, `formatOrderNumber`, `toast` |
| `02-chips-extract.js` | Lookups (`order()`, `party()`), what a **chip** says and what color it is, date helpers, **PDF text + OCR + rate-con parsing** (`parseRateCon` wraps `ratecon-parser.js`), broker matching, and rate-con **autofill** (`afApply`, `afMatchLocation`). | `buildChip`, `chipHtml`, `pushColorFor`, `cellHasLoad`, `parseRateCon`, `extractInvoiceInfo`, `ocrPdf`, `mergePdfs` |
| `03-drawer-billing.js` | The **order drawer** (the panel that slides in when you click a chip or row), pickup/delivery pickers, billing packages. | `openOrder` (external), `openInternalOrder` (bag), `openTransferOrder` (internal freight), `rateInputHtml` (External Rate), `locCombo`, `partyCombo`, `doPackage`, `billDone` |
| `04-views.js` | **Every screen's layout**: Scheduler, Current Week, Driver Tabs, the three order trackers (sortable column headers via `tsortTh`), Billing, Database grids, custom sheets, Reports (dashboard tiles, pivot builder, saved/pinned reports: `RPT_SYSTEM`, `rptRun`, `rptDashHtml`, `rptWinOpen`). | `vScheduler`, `vCurrentWeek`, `vDriverView`, `vInternal`, `vInternalFreight`, `vOrders`, `vBilling`, `vDatabase`, `vSheet`, `vReports`, `toolbarHtml` |
| `05-settings-nav-search.js` | Settings pages, the Staging rail, the **`render()` dispatcher** (decides which screen to draw), `reload()`, global search box, **Sync Delivery Dates** and the Motive mileage review window (`MOT`, `motBuckets`, `mrvCalc`). | `render`, `reload`, `vSettings`, `renderRail`, `renderSearch`, `NAV`, `runSyncAll`, `mrvOpen` |
| `06-modals-grids.js` | Popups (add customer/location/truck, Add New Location, bulk add orders, day note, confirm), document viewer, spreadsheet-style cell editing, **document ingestion** (rate con / loose POD / invoice batch). | `openModal`, `addLocationModal`, `parseLocationText`, `routeSectionHtml`, `openViewer`, `startEdit`/`commitEdit`, `ingestRateCon`, `ingestLoose`, `ingestBatch` |
| `07-events.js` | The big **click / change / keyboard handlers** — where each button's action is wired. | Search the button's id or `data-…` attribute here, e.g. `"motive-sync"`, `data-report`, `new-order` |
| `08-undo.js` | ⌘Z / ⌘⇧Z undo-redo, and the save helpers that record undo steps. | `histPush`, `moveLoad`, `scheduleNote`, `orderFieldSet`, `freightValueSet` |
| `09-color.js` | Scheduler cell colors, truck-off days, copy/paste of cells, right-click menus, adding/removing day rows. | `openCtxMenu`, `openDayMenu`, `setTruckOff`, `copyCell`/`pasteCell`, `addDayRow` |
| `10-select.js` | Multi-cell selection (drag box), fill handle, dragging a note by its border. | `selStart`, `fillHandleDown`, `noteDragStart` |
| `11-toolbar.js` | The formatting toolbar (fill, text color, bold, borders, font, size, zoom) and drag-and-drop of chips onto cells/Staging. | `renderFmtBar`, `applyFormat`, `applyZoom`, `dropLoadOnCell` |
| `12-touch-boot.js` | Touch-screen dragging, sidebar resize, and **startup** (`bootDashboard`). | `bootDashboard`, `startTouchDrag` |
| `13-history.js` | The admin **History** panel (list, group by day, revert). | `renderHistoryPanel`, `openHistoryRevertPreview` |

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
| **Billing → Invoices & Packages** | `vBilling`, `billDocCardHtml` (To Match cards), `invoiceCandidates` / `readInvoiceBands` (the invoice reader), `ingestBatch`, `attachInvoiceDoc` | `api_document_save` / `_attach` / `_delete` + Storage; `orders.billed_date` |
| **Reports → Export & Reports** | `vReports` (dashboard tiles, pivot builder, pinned reports) | `api_report_rows`, `api_report` (CSV), `api_saved_report_list` / `_save` / `_delete` |
| **Database** (tabs across the top) | `vDatabase` → `vBuiltin` (Bagger Customers, External Customers, Pick/Drop, Fleet, Internal Freight departments), `vSheet` (custom sheets) | `api_row_update`, `api_row_custom`, `api_grid_row_*`, `api_database_archive`, `api_grid_column_*`, `api_entity_*`, `api_field_*`, `api_record_*`, `api_sheet*` |
| **Settings** (gear, bottom left) | `vSettings` (General, Shortcuts) | `api_order_number_settings_save` |
| **History** (clock icon, toolbar) | `13-history` | `api_history_list`, `api_history_preview`, `api_history_revert` |
| **Order drawer** (click any chip/row) | `03-drawer-billing` → `openOrder` / `openInternalOrder` / `openTransferOrder` | `api_order_update`, `api_freight`, documents |

---

## 5. Inside `supabase-api.js`

| Search for | What it does |
|---|---|
| `renderLoginGate` / top-of-file comment | How sign-in works. Any signed-in account has full access (the database check `dept12_is_admin()` is simply "signed in"); who can sign in is managed in Supabase, with public sign-ups turned off. |
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
| **Edge Functions** | `motive-sync` (in use: mileage, truck-days, shop trips). `sheets-push` is unused and still deployed (to be deleted). The source is pasted into Supabase by hand (Edge Functions → motive-sync → Deploy); the owner's local copy is `supabase/functions/motive-sync/index.ts`, which is not in git. |
| **Edge Functions → Secrets** | `MOTIVE_API_KEY` (needs an admin to add). |
| **Authentication → Users** | The logins. Add people here (turn "Allow new users to sign up" OFF: that is the whole gate). Every signed-in login is treated the same, including the company app's `flatbedauth@rexius.com`. The old `dept12_private.allowed_logins` / `app_logins` lists and `dept12_check_request()` exist but are not used. |
| **Storage → documents** | Uploaded PDFs, in folders named by order ID. |
| **SQL Editor** | Where we paste database changes. Files in `supabase/sql/` (local): `2026-10-19_01` employee numbers, `2026-10-21_01` driver phone, `_02` lock the public key out of everything but the open driver functions, `_03` app login (flatbedauth) + `app_*` functions, `_04` delete a driver, `_05` CUTOVER (closes the open driver functions; run only when the company app is live), `_06` rollback of the cutover, `_07` temporary dispatcher access for flatbedauth. `2026-10-23_02` lets a signed-in login download documents marked Show To Driver (function `dept12_doc_driver_visible`, storage rule `documents_driver_read`), `2026-10-23_05` adds each scan's file location to what drivers see back (`public_driver_activity`), so a scan opens from any phone, `2026-10-23_04` makes every signed-in login work the same on the driver functions and driver scans (`dept12_app_caller()` = signed in). `2026-10-23_07` lets any document be deleted, `_08` makes saving a note / registering a scan safe to repeat (no duplicates after a lost reply), `_10` and `_12` add outside-carrier loads to `driver_week_data` (`_12`: any load marked `is_carrier`, named or not), `_11` the page banner (`dept12_private.ticker`), `2026-10-23_13` transfer adjustments (`transfer_adjustments`: cost changes made after a transfer go out as plus / minus lines in the next batch). |

---

## 7. Find it fast

Where it says `app.js` → a name, the code is in one of the `src/js/` files:
find it with `grep -n "function name" src/js/*.js`, edit it there, then run
`node build.js`.

| I want to change… | Go to |
|---|---|
| What a chip says or its color | `src/js/02-chips-extract.js` → `buildChip`, `chipHtml`, `pushColorFor` |
| A screen's layout or columns | `src/js/04-views.js` → the `v…` function in §4 |
| What a button does | `src/js/07-events.js` → search the button's id; then `supabase-api.js` → `ROUTES` |
| A rule (numbering, locks, what can be moved) | Supabase → the matching `api_…` function (§4 lists which) |
| A popup / form | `src/js/06-modals-grids.js` → `…Modal` |
| Colors, spacing, fonts | `app.css` (tokens at the top) |
| Rate-con reading (what it fills, what it misses) | `ratecon-parser.js` (per-broker handlers), then `app.js` → `ingestRateCon`, `ingestParsed`, `afApply` |
| The window that confirms a rate con or pasted load before an order is made (no tags in the side window any more) | `app.js` → `afReview`, then `ingestParsed` and `afApply` (fills only blank boxes) |
| The **Sign window** (a window over the app): a dragged-in rate con (or a document's **Sign** button) beside the review boxes, with initials / date / text box stamps (`sgnGhost` preview, `sgnEditText`), the signed copy written in a worker (`SGN_WRITER`, `sgnBuild`) and shown as a draggable file chip | `app.js` → `sgnOpen` (section "Sign window"), `afFormHtml` / `afFormBind` (the boxes), `ingestRateCon`, `signDocument`, `sgnBuild` (pdf-lib), styles `.sgn*` in `app.css` |
| The PDF **file chip** on each document row (drag it out, or click to save) and the "what are these?" window for dropped files | `app.js` → `docRowHtml`, `docChipHtml`, `docPrefetch` (`DOCBLOB`), `dropDocType`, `docTypeChooser`; `packageDocs` (a signed copy replaces its original) |
| Paste Load Info | `app.js` → `pasteLoadModal`, `runPasteLoad` |
| Live updates when a second dispatcher changes something | `app.js` → `livePoll`, `liveBusy`, `liveApply` (every 4 seconds); `supabase-api.js` → route `bootstrap/poll` (asks `api_bootstrap_since`, which reads the History log) |
| New Order button (header): External / Bag Order / Internal Freight | `app.js` → `newOrderModal`, `newExternalModal`, `newBagPanel`, `newBagGo` (a bag order number that exists opens that order; a new one is added) |
| The + that files a note to a customer or pick/drop (writes the stamped line into the existing Notes column) | `app.js` → `pnTargets`, `pnOpen`, `pnGo`, `pnSectionHtml` |
| Staging rail: new orders added automatically, labeled groups, shared between dispatchers | `app.js` → `reload()` (`AUTOSTAGE_OFF`), `renderRail`, `stageFromDB` / `stageSyncUp`; the list is stored on the orders themselves (`orders.autofill._staged`, no extra table) and read back in `reload()` → `stageFromDB` |
| A chip going back to the plain look after an edit until you publish again | `app.js` → `PUB.dirty`, `pubOrderIds`, `pubSetDirty`, and the `pushed` check at the top of `chipHtml` |
| Driver page: loads and typed notes | `driver/driver.js` → `vDriverGrid`, `vDriverCards`, `tabChipHtml`; `driver/driver.css` → `.dvx-note-row` |
| Invoice reading | `app.js` → `extractInvoiceInfo` |
| The PDF/OCR libraries loading on first use (none load with the page) | `app.js` → `loadVendor`, `VENDOR` (`src/js/02-chips-extract.js`); driver page: `driver/scanner.js` → `loadPdfLib` |
| Cache tags (`?v=…`) on the script and style links | Set by `node build.js`; never edit them by hand |
| Keyboard shortcuts | `src/js/01-core.js` → `BASE_SHORTCUTS`, `runShortcut` |
| Sidebar menu items | `src/js/05-settings-nav-search.js` → `var NAV` |
| What drivers and the bag plant see | `publish-schedule.js` (the data) and `driver/driver.js` (the look); keep `vDriverView` in `app.js` matching |
| Pickup/Drop table, External Rate, backhaul | `src/js/06-modals-grids.js` → `routeSectionHtml` (the Pickup/Drop table with Add Stop and drag reorder); `src/js/03-drawer-billing.js` → `rateInputHtml` |
| Reports dashboard / pivot builder | `src/js/04-views.js` → `RPT_SYSTEM`, `rptRun` |
| Delete rules for orders | `app.js` → `canDeleteOrder` (and the matching `api_order_delete` rules in Supabase) |
| Report columns | Supabase → `api_report_rows` / `api_report`; headers in `supabase-api.js` → `REPORT_LABELS` |
| Who can sign in | Supabase → Authentication → Users (sign-ups off); every signed-in login has the same access |
| Paperwork drivers can open: the **Show To Driver** switch on a document (flag in the document's `extracted_fields.driver_visible`), the list sent to drivers, the viewer and signing | `src/js/06-modals-grids.js` → `docRowHtml`, `docDriverOn`, `docPaperDirty` (the switch); `src/js/04-views.js` → `pubDocFlip` (counts the switch as an unpublished change); `supabase-api.js` → route `document/driver-visible` and the `payload.docs` step in `sheets/push-driver-tabs` (sent with Publish Schedule); `driver/driver.js` → `paperDocs`, `paperChips`, `scanList` / `scanHtml` (every scan of the order as a chip: a name the driver typed, "Signed <file>" for a signed copy, else "<order #> scan1, scan2…"; the name rides in the stored file's name, `scanSafeName` / `scanNameOf`), `filesHtml`, `openPaper`; `driver/paperwork.js` (`Dept12Paper.open`, `toPdf` maps a drawn point onto a rotated / cropped PDF page); styles `.paper*`, `.chip-files` in `driver/driver.css`. Reading the file needs the storage rule `documents_driver_read` (local SQL file `2026-10-23_02_driver_paperwork.sql`) |
| Reports → Transfer: the due list for the From / Through dates, the flags for changes made after a transfer and for orders the last transfer missed, adjustments in a batch | `src/js/04-views.js` → `trfDue`, `trfFlagsHtml`, `vTransferTab`, `trfMarkModal`, `trfCsv`; database `api_transfer_list / create / lines`, tables `transfer_batches`, `transfer_batch_orders`, `transfer_adjustments` |
| Banner on the drivers' page / bag plant page (typed on the dashboard's Current Week bar, 40 characters each, empty = hidden) | `src/js/04-views.js` → `tickerBoxesHtml`, `tickerLoadBoxes`; `supabase-api.js` → routes `ticker`, `ticker/get`; `driver/driver.js` → `tickerHtml`, `tickerLoad`. Database: `dept12_private.ticker`, `api_ticker_get/set`, `app_ticker()` |
| Bag plant TV: zoom (`ZOOMS`, `zoomHtml`) and the Outside Carrier column (`payload.outside` built in `publish-schedule.js`; `driver_week_data` now includes loads that have a carrier and no truck) | `driver/driver.js` → `vCurrentWeek`; `publish-schedule.js` → `outside` |
| No signal, waiting to send, saved copy (no banners: a waiting note or scan is marked on the item itself; Refresh retries) | `driver/driver.js` → `OUTBOX`, `outboxFlush`, `cacheSave`; `driver/outbox.js` |
| Driver page sign-in (login form, hand-off, token refresh, employee check) | `driver/driver.js` → `REQUIRE_APP_LOGIN`, `appReadLink`, `appToken`, `appStart`, `appResolve`, `vAppLogin` |
| Fleet: add driver, add truck, put a driver on a truck, rename, Make Inactive / Reinstate, Former drivers | `app.js` → `addDriverModal`, `addTruckModal`, `spareDriversHtml`, `formerDriversHtml`; `supabase-api.js` → `driver/former` |
| Drivers shown by first name (Matt S. when two share one) | `app.js` and `driver/driver.js` → `dFirst` |
| Employee # and Phone boxes (Fleet) and their keyboard flow | `app.js` → `empInput`, `empEnsure`, `empBusy`, the `data-empno` / `data-empphone` handlers |

---

## 8. Shop trips: giving "Yard Move in shop" trips to the shop drivers (Motive)

Happens **inside the Edge Function `motive-sync` (mode `"unidentified"`)**, and the dashboard triggers it from `app.js` → `motAssignShop(from, to)`, which `motPull` calls
before it reads each chunk of truck-days. So it runs on **every Pull From Motive** (and on Sync Delivery Dates, which pulls missing days through `motPull`). There is no separate button.

What it does, exactly:

1. Asks Motive for the **driving periods that have no driver** (`GET /v1/driving_periods?assigned_to_driver=false`) for the days being pulled.
2. **Fleet only.** The dashboard sends the truck numbers of the active trucks in the Fleet table (`DB.trucks`). A trip on any other vehicle is ignored completely. Without a fleet list the function refuses to assign in bulk.
3. **Only trips whose Motive note is exactly `Yard Move in shop`** (the note Motive's geofence puts on the trip; compared ignoring case and extra spaces). Trips with any other note, or no note, are never assigned.
4. **The note is never changed.** The assign call sends only the driver (`PUT /v1/driving_periods/{id}?driver_id=…`) and no `notes`.
5. Assigned to **Shop Mechanic 1**; if Mechanic 1 is already driving something at that time, to **Shop Mechanic 2**; if both are busy the trip is **skipped** (left unidentified). Both are Motive drivers in exempt mode (Motive only lets exempt drivers be assigned this way).
6. Also left alone: trips that are not finished (still in progress), trips that start **today (Pacific time)**, and trips within **15 minutes** of a real driver's own trip on the same truck (a driver rolling the truck just before logging in).
7. Without `apply: true` plus either `only_ids` or `apply_all` + the fleet list, the function only reports the plan and changes nothing in Motive. Debug requests (`debug: true`) also return the first raw Motive records and the shop drivers' own trips, so the note field and its exact text can be checked against real data.

After a pull the dashboard says how many trips were handed over ("gave N shop trips to the shop drivers"). Motive does not document an undo for an assignment; fix a wrong one in Motive's own screen.

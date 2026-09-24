# Dept 12 Dashboard

Dispatch and billing for Rexius flatbed trucking, Department 12.

This replaces two tools that currently run the operation: a Google Sheet driven
by Apps Script, and a local browser app that packages invoices. Both work. Both
store their real data as **formatted text inside spreadsheet cells and PDF
blobs**, which means nobody can answer a question like *"what did we haul for
Tradewinds in Q2 and what did it pay?"* without opening files by hand.

The goal is to move the record into Postgres so it is queryable and pivot-able,
**without changing anything the drivers see**, and to shape it so an Acumatica
integration can be dropped in later.

---

## The two systems being replaced

### 1. TMS — dispatch and scheduling

A Google Apps Script bound to the "future TMS" sheet. The dispatcher drags load
"chips" around a grid; a publisher rebuilds a **separate read-only mirror
sheet** that 8 driver tablets read.

There are **two sheets, and only one is driver-facing**. This matters more than
anything else in the project:

- `1KlPQ…` — the dispatcher's working sheet. Can be replaced.
- `15f12…` — the **mirror**. 8 tablets read it. **This ID must never change.**

The mirror is already a pure projection — `updateDriverTabs` deletes and rebuilds
each driver tab on every run. So "Supabase is the source of truth, the Sheet is
an I/O adapter" is a swap of what feeds the existing renderer, not a rewrite.

### 2. Invoicing — document packaging

A local browser app. Drag in a rate con, it OCRs and files it; attach the POD and
invoice; it merges all three into one PDF and drafts an Outlook email.

It already reads the TMS sheet — its broker list comes from the sheet's
`outside customer list` tab.

---

## Core concepts

### An order is not a load

- **Order** — something the business sells and tracks *before* anyone hauls it.
- **Load** — one truck run on one day.

They differ by type of work:

| | Orders per load | Stops |
|---|---|---|
| **Internal** (bagged product) | Several combined onto one truck | One pickup, several drops |
| **External** (broker freight) | Normally one | One pickup, several drops, one billed rate |

`load_orders` joins them so both shapes work without special-casing.

### Three identifiers, none of them a primary key

| Identifier | Example | Where it comes from |
|---|---|---|
| `solomon_order_no` | `12-0426-0001` | Microsoft Solomon, the current accounting system |
| `broker_load_no` | `884895` | The broker's own number, off the rate con |
| `id` | uuid | Ours |

`12-` and `07-` are the current department prefixes, but they are not schema
rules. Settings → General stores the current Bag/External patterns and reporting
department codes. The visible number, department, and Bag Order month/year are
independent fields, so future formats do not require renumbering historical rows.

Solomon is the system Acumatica will replace, so `solomon_order_no` is the
eventual ERP join key — not an incidental reference.

### The chip is built, never stored

A load chip is *rendered* from the order plus the customer record. In the sheet
the chip text **is** the data, which is why the legacy code needs three fallback
strategies to read it back out. Storing rendered text and re-parsing it is the
specific mistake this project exists to undo.

### Driver and truck are separate

The sheet fuses them into a column header (`"Jordan 63/80 F"`) and has a *Swap
Trucks* feature with nowhere to record the change — so a load hauled in March
silently reports whatever truck the driver has *today*.

`driver_truck_assignments` carries `effective_from`/`effective_to`, so historical
reporting is correct. This is verified: after a swap, a February load still
reports the February truck.

### Two money paths

| | Path |
|---|---|
| **External load** | `invoices.amount`, captured at invoice generation, which closes the load |
| **Internal load** | **Both**: a hand-entered freight charge to the bag plant (`orders.internal_freight_amount`, reported per truck + department for a date range) **and** an end-customer invoice |

The invoice — not the rate con — is the money of record, because the rate con can
be superseded by adjustments and the invoice is what closes the load.

---

## Layout

Five work sections share one persistent collapsible sidebar. Dispatch, Orders,
Billing, and Reports expose their destinations directly there. Database is one
separated sidebar entry and keeps its spreadsheet tabs inside the page.
Settings and Profile sit in a footer below a divider instead of mixing account
controls into the work navigation.

The hamburger sits in the sidebar's own top cell. The Rexius/search header,
formatting toolbar, and page content all begin where the sidebar ends, so
resizing or collapsing navigation moves those three boundaries together.
In the expanded sidebar, Settings and Profile are side by side. In the
collapsed rail, Settings is above Profile. The gear opens Settings directly;
its General, Shortcuts, Time Calc, and admin-only Access pages use the same
in-page tab treatment as Database.

When the sidebar is collapsed, small plain `<` and `>` glyphs beneath the
hamburger cycle through the current section's destinations without opening its
accordion. The formatting toolbar stays open; on Orders pages, Internal Rate is
anchored at its far-right edge. Its light panel background matches the app
shell instead of using the darker table-header tone.

Each collapsed section icon opens that section directly. Its separate small
`↓`/`↑` arrow only expands or collapses the subsection choices.
Navigation destinations share the dashboard's compact body type, rounded
active state, and capsule-style order counts in both expanded and collapsed
modes. Selection, focused fields, and the Scheduler Today marker follow the
user's chosen accent instead of using a separate fixed color.

On narrow screens, the same centered hamburger opens a full-label slide-out
navigation drawer. It closes after navigation, on backdrop tap, or with
`Escape`; the page and formatting toolbar remain usable with touch. Physical
keyboard users can press bare Left/Right to cycle the current section when no
cell, field, menu, or drawer owns input. Existing grid arrow navigation still
takes priority.

| Section | Contains |
|---|---|
| **Dispatch** | Scheduler, Current Week, Driver Tabs |
| **Orders** | Bag Orders (dept 07), Internal Freight (dept-to-dept transfers, no customer, D127), External Orders |
| **Billing** | The invoicing workflow *(placeholder — design not settled)* |
| **Reports** | Custom reports and full CSV export |
| **Database** | Bagger Customers, External Customers, Pick/Drop List, Fleet, Internal Freight (the Departments lookup, D127) |

Everything is editable like a spreadsheet: click a cell and type, `Tab` across,
`Enter` down, arrows to move, `Esc` to cancel, `Delete` to clear. That applies to
the scheduler grid and every Database table.

---

## Features

### Scheduler
The dispatch board — **the full year, top to bottom**. Drivers across the top,
dates down the side, three slots per driver per day. Jump to any date with the
date picker or the Today button, both on the left of the toolbar. Sundays stay
in the grid but minimized, since weekend work is rare and almost always
Saturday. **Update Google schedule** — the same push Current Week and Driver
Tabs use — sits on the right, the toolbar's one accent-colored button.

Cells hold **either** a load dragged from staging **or** free text, exactly like
the sheet — an ad-hoc job, a shop day, a reminder. Nothing blocks you.

**Staging** mirrors the sheet's A:C area — a backlog of loads waiting to be
placed. It handles 100+ loads (brokers dump batches) with a filter box.
Staging dedupes: staging something already on the board is skipped and reported,
the same as `copySelectionToScheduler`.

A pinned, grayed-out **Outside Carrier** column sits at the far right of every
driver. Drag a staged load onto it the same way as any truck — no carrier
name or cost required up front, it's on the schedule immediately. Fill in
who's hauling it and what you paid, whenever, from a collapsible "Outside
carrier" section in that order's drawer. It never reaches a driver's tablet,
since the driver-tab push only ever looks at real trucks. Works for internal
and external loads alike.

### Current Week
The five-day view derived from the Scheduler. This is what gets mirrored out to
the driver sheet.

### Driver View
What a tablet shows: **Date · Load · Notes · Pickup · Drop · Store Map**.

Rebuilt from Current Week plus the External Order Tracker plus Bagger Customers —
external chips are replaced by the tracker's fuller Driver Load Chip, and internal
loads pick up a STORE MAP link. This mirrors `updateDriverTabs` exactly.

### Bag Order Tracker
Dept 07's own product, hauled by dept 12 trucks. Chips are generated here by
pulling the customer's record from Bagger Customers. Delivery dates sync back
after scheduling. A dedicated Open column always opens the order panel; beside
it, a fixed-width joined control keeps Status, Copy, and the collapsible Stage
action centered and predictable. A numbered gutter on the left selects one or more rows (click, Shift
for a range, ⌘/Ctrl to toggle one — same as a Database grid) for the toolbar's
Cancel selected/Delete selected; a locked order (delivered/billed) caught in
the selection is skipped, not errored. Tracker rows use fixed sizing; mileage
and Transfer $ are directly tabbable and clickable. The sync,
Cancel/Delete Selected, and New/Add Orders toolbar actions all use the same
compact button size. The side drawer starts
with a live preview of the real load chip, then customer reference, editable
order/freight data, and documents last. Order # is type-overable and the
grid stays sorted by it live as you edit; "Add orders" reserves a block of
sequential numbers from the admin-defined pattern, starting at either the next
free number or one you type in yourself — handy for off-season manual entry or
importing a range that doesn't continue from the current max. Month/year grouping
is stored separately, so changing the pattern never moves historical rows.

Missing imported Bag Order numbers can be repaired with
`scripts/fill_missing_bag_order_numbers.py` (preview by default). It reads
order/pallet notation from notes, uses the delivery month, and moves earlier
same-month duplicates back one month. Same-day ties and remaining collisions
stay unresolved. Existing numbers, customer links and trip dates are preserved;
the assigned order month also controls the Bag Orders month tab.

### Internal Freight Tracker
Dept-to-dept mileage/$ transfers that carry no customer at all — a bag-plant-
to-yard move, a shop run, anything charged internally rather than invoiced.
Tagged to a real, editable **Departments** list (Database → Departments) so
the numbers trace back to which department, not just "internal-ish". Same
actual-miles + hand-entered $ transfer figure as the Bag Order Tracker, synced
from Motive the same way. Never gets a Solomon order number and never appears
in Billing — there's no customer to invoice. "+ Add order" bulk-creates any
number of blank rows at once; "+ Add one" at the bottom adds a single row and
opens its drawer right away. The same numbered-gutter multi-select as the
other two trackers drives Cancel selected/Delete selected. The Internal
Freight/Freight Transfer/Mileage reports (below) roll these in alongside Bag
Orders, split by department.

The same Year picker every order tracker uses filters this one too, by the
transfer's real order date — a transfer is never held back as "2025
history" the way an ordinary imported bag/external order is, so a reviewed
2025 transfer is available under its selected year. The tracker opens
directly to the grid, without a separate count banner.

Reviewed legacy-import corrections are applied with the `scripts/reconcile_*`
utilities, which preview by default and keep original records under ignored
`output/import-review/`. Use a fresh database backup before applying them.
Load/Deliver instructions and holiday lettering remain visible as schedule
notes and no longer count as trips. Reviewed bag customers have pallet counts
and source short order numbers retained separately from pending full order
identifiers. The original 2025/2026 importers still implement the earlier
baseline; rerunning their reset imports would require reapplying the reviewed
corrections and resolving any subsequently edited records first.

### External Order Tracker
Broker loads with order #, load #, broker, PU/PO, delivery #, notes, pickup,
drop, and rate. **No release step** — broker loads are pre-planned.
Status, Copy, and the folding Stage/Restore action share the same joined control;
the dedicated Open column is the only order-panel target. The same
numbered-gutter multi-select as Bag Orders drives the toolbar's Cancel
selected/Delete selected. Its side drawer also starts with a live preview of
the real load chip.

Most orders are a simple one-pickup/one-drop lane. When a load genuinely needs
more stops, the route editor (opened from the pickup/drop cell) adds, removes,
and drag-reorders 2-20 pickups/drops; saving switches that order onto a
**custom route**, reflected in its chip, its grid cell, and the driver-tab
push. "Return to simple route" reverts to the plain PU/drop fields.

### Bagger Customers
The customer directory, and **where load-chip annotations originate**. Timing
window (Early / Afternoon / Anytime, and EAST variants), forklift type (NF /
Forklift / Spyder), trailer notes, and free-text notes.

Anything written here **rides along on every chip for that customer**, so it's in
front of you on the board while you reshuffle.

**These are annotations, not rules.** Nothing blocks an assignment. They exist to
stop you forgetting — flatbeds are straight trailer *or* B-train, so there's no
clean constraint to enforce anyway.

**Designation → chip color.** Each customer carries a *designation* (Early store,
Anytime store, Umatilla side, …). Right-click the **Designation column header →
Conditional formatting** to edit its rules. Those same column rules paint every
matching internal chip in Dispatch; there is no second toolbar-level editor.
Timing and equipment remain high-contrast badges on the colored chip. Equipment
is normalized to Forklift, Spyder, or No Forklift; lane/location is conveyed by
the designation color rather than a separate EAST badge.

Click the numbered gutter to select a row (Shift or Command/Ctrl for several).
**Bagger Customers, External Customers, and Internal Freight** use **Archive
Selected** instead of delete. Archived rows leave their active directory and new
order pickers while existing orders, documents, reports, and history remain
intact. **Show Archived** opens each directory's archive view, where the same
gutter selection can restore rows. Pick/Drop List, Fleet, and custom databases
keep their guarded delete behavior.

Rows can be reordered by dragging the gutter, or by opening the sort dialog
(sort any column ascending/descending, then optionally save that order as the
grid's new default). The saved order persists per grid — the same customer can
sort differently in Bagger Customers vs. External Customers.

A cell whose entire value is a URL renders as a real clickable link (opens in
a new tab) instead of plain text — paste a store locator or website link into
any Notes-style column and it's clickable immediately, including after a fill
or paste.

Billing's unmatched-document queue has a confirmed Delete action. It permanently
removes only genuinely unmatched files; anything attached to an order/load/stop
is protected.

### Custom sheets
The Database section is also a **spreadsheet app**. The **+** controls in its
in-page tab row add a custom database or a blank sheet (up to 10 sheets). Each
sheet is a real grid — default 25×25, grow it with **+ Row** / **+ Column**.
Cells select, arrow-navigate, and type-to-edit exactly like the other grids, and
persist as you go. Double-click a tab to rename it; right-click a custom tab to
delete it.

The **formatting toolbar** (above every grid, scheduler, and sheet) is
Sheets-style: fill and text color — each with a swatch bar showing the last-used
color — bold, italic, a **font picker** (27 system typefaces, each previewed in
its own face), and a **− N +** font-size stepper. The **borders** button opens a
Google-Sheets-style window — a grid of position options (all / inner / horizontal
/ vertical / outer / each edge / clear), a color pencil, and a line-style picker
(thin / medium / thick / dashed / dotted). Positional borders understand the
selected range, so "outer" frames the block and inner edges stay open. Every
change is one undo step, and per-cell fonts/sizes/borders are saved with the cell.
A global font also lives in Settings → General as a dropdown with a live sample.

**Settings → General** combines the user's profile, account status, Outlook
connection, theme, accent, font, workspace order numbering, and Scheduler sizing
in one place. Number formats are free-form templates: `{MM}`, `{YY}`, and `{YYYY}`
insert dates and a run such as `{####}` places the sequential number wherever it
belongs. The current 07/12 formats remain the defaults until an administrator
changes them, and changes apply only to new numbers. Accent starts
with ten readable presets; an optional custom picker can save up to 12 personal
colors for quick switching. Button and badge text switches light/dark
automatically, and colors that disappear into either base theme are rejected. The old compact
density option is retired—comfortable spacing is the fixed baseline, while
Scheduler row height and truck-column width remain directly adjustable.

Admins also get **History**, opened from the far-left toolbar icon: a permanent
left sidebar (pushes the rest of the app over, doesn't cover it) showing every
change as a chip — who, when, and what changed, all visible without expanding
anything. Click a chip to jump to and highlight whatever it touched — the order
drawer, the scheduler cell, the database row. Revert any single action after a
conflict-checked preview; reverting a revert reads as **Redo**. Reverts are
themselves recorded and never erase the original history. External effects such
as an Outlook draft or Google Sheets push are identified but cannot be taken
back. The panel stays open across navigation until closed. Restricted users do
not see History and cannot call its APIs.

Keyboard actions are customizable in **Settings → Shortcuts**, including
app-wide Undo/Redo and contextual Delete. Any built-in action can also have
additional custom key combinations. Delete clears the current selection or
opens the same guarded delete confirmation as the visible button; while typing,
Backspace/Delete remain normal text-editing keys. Current Week uses a compact
`− value +` stepper for its persisted 1–14 day window.

**Settings → Time Calc** is a time card calculator: enter a start and end
clock time and it shows both as military (24-hour) time plus the total hours
between them (handles an overnight span). **Help & FAQ** lives in the profile
avatar's dropdown menu instead (a popup, not a settings tab).

Current Week is the rolling driver handoff: choose the first day drivers should
see and how many visible days to send (three by default). Empty weekends are
skipped, so Friday naturally rolls to Monday/Tuesday; a weekend with a real load
is included. The update shows a confirmation preview and replaces the previous
driver-tab window instead of leaving old days behind. Scheduler Saturdays and
Sundays are compact gray rows until a load exists or you right-click the date to
activate that weekend.

Past Scheduler days remain available for correcting notes, but are lightly
dimmed and their row structure is locked. Moving a load into or out of history
requires confirmation — but only once the edit is more than 4 days stale, so a
same-day or next-day fix (a truck breakdown, a late correction) doesn't prompt
every time. Future-day rows can be added or removed through the day
menu; removal compacts bottom-row contents upward, stages overflow loads, and is
fully undoable.

Order trackers keep a fixed-width Status / Stage column beside a dedicated,
centered Open column. Status → Copy → Stage/Restore reads as one joined control;
the final Stage segment folds away after staging instead of reserving a gap.
Cancel/Delete are bulk-only now, via each tracker's numbered-gutter
multi-select.

### Brokers & Pick/Drop
The broker directory with AP billing emails (feeds invoicing) and the company
address directory (feeds pickup/drop dropdowns).

### Fleet
Drivers and trucks, with swaps recorded over time rather than overwritten.

### Reporting
The point of the whole project. Every one of these is a single SQL statement:

- Revenue by broker by quarter
- Loads per driver per month, using the **historically correct** truck
- Average order-to-delivery days per customer
- Loads missing a POD
- Internal freight transfer, per truck + department, for a date range — Bag
  Orders (dept 07) and Internal Freight transfers together
- Mileage split three ways for a date range — Bag Orders by customer,
  Internal Freight by department, external as one total (derived by
  subtraction from Motive ELD, not tracked per external load)
- Export all Bagger Customers (address, timing, designation, forklift, miles, contact)
- Export all External / freight customers (Rexius #, AP email, phone, notes)
- Export Fleet info (truck, equipment, active, current driver)
- Export entire app — every order/load/truck/driver/customer/broker field in
  one wide CSV, built for pivot tables

Every export's CSV header row is a friendly label ("Order #", "Load Info",
"Transfer $"), not the raw database column name — reusing the app's own
grid/drawer wording wherever a column has an on-screen equivalent.

---

## Status

| Phase | State |
|---|---|
| 0 — Freshness check | Done. Invoicing app had no repo; Apps Script manifests drift from deployed. |
| 1 — Repo consolidation | Done. Three codebases into `legacy/`, byte-identical. |
| 2 — Postgres schema | Done and running locally on PostgreSQL 17.10. |
| 3 — Sheets sync layer | Functionally complete; remaining fallback/write-back decisions are documented in `CLAUDE.md`. |
| 4 — Document ingestion | Functionally complete, including client-side OCR and document packaging. |
| 5 — Dashboard UI | Functionally complete and running from `app/server.py`; metadata-driven platform rebuild is in progress. |
| 6 — Reporting / export | Done, with reports UI and CSV exports. |
| 7 — Conflict / edge-case testing | Not started. |
| 8 — Hosted Supabase/server cutover | Planned. Dashboard and Rexius Bag Orders launch together against one database and private document bucket; see [`docs/supabase-server-port-plan.md`](docs/supabase-server-port-plan.md). |

### Known gaps

- Supabase Storage remains deferred; local document storage is active. The
  required hosted architecture, migration, security, and cutover gates are now
  specified in [`docs/supabase-server-port-plan.md`](docs/supabase-server-port-plan.md).
- The Billing section still needs its planned Active Loads view.
- Main-sheet write-back remains an open workflow decision.
- **Filename matching beats text extraction** on scanned documents and is ranked
  accordingly in the matching cascade.
- **The broker list is served over a public, unauthenticated URL** — 102 broker
  names and AP billing emails readable by anyone with the sheet ID.
- **RLS is permissive** — denies anon, allows any authenticated user.

---

## Running things

**The invoicing app**
```bash
python3 legacy/invoicing-local/server.py
```
Serves on `localhost:8765`. The Outlook draft path needs Windows + `pywin32`.

**The dashboard**
```bash
python3 app/server.py
```
Serves the real app at `http://localhost:8770`. Picks up a `.env` file at
the repo root automatically (a small hand-rolled loader, no
python-dotenv dependency) — copy `.env.example` to `.env` for local
config like the Google Sheets push credentials and
`DEPT12_LOCAL_AUTH_ENABLED`; a real shell-exported env var always wins
over the file.

**Rexius Bag Orders**
```bash
python3 east_portal/server.py
```
Serves the separate tablet web app at `http://localhost:8785`. It uses the
dashboard's normal Bag Orders, trucks, and order documents. Its local workflow
is documented in [`docs/east-driver-portal-plan.md`](docs/east-driver-portal-plan.md);
its required place in the hosted Supabase/server port is documented in
[`docs/supabase-server-port-plan.md`](docs/supabase-server-port-plan.md).

**The standalone login page**
```bash
python3 -m http.server 8780 --bind 127.0.0.1 --directory login
```
Serves at `http://localhost:8780`. Supabase authentication and delegated
Outlook drafts are fully scaffolded but disabled by default. Activation values,
feature flags, and the security checklist are in
[`docs/auth-outlook-activation.md`](docs/auth-outlook-activation.md).

**Local test login + permissions (D125)** — separate, dependency-free, and
off by default (`DEPT12_LOCAL_AUTH_ENABLED=true` to try it). No hosted
service needed: a username-only sign-in (no password) gates the dashboard
behind two account classes — an admin with full access, and restricted
accounts that default to read-only Scheduler until an admin grants specific
sections (view or view+edit, down to individual Database grids) and,
optionally, a hard date-range boundary on what Scheduler dates they can see
or touch. Manage grants from Settings → Access once signed in as an admin; the
Account card in General links there directly.

**The database** — the real dev DB is `dept12`, reached at `psql -d dept12 -h /tmp`:
```bash
LC_ALL="en_US.UTF-8" /opt/homebrew/opt/postgresql@17/bin/pg_ctl -D /opt/homebrew/var/postgresql@17 -l /tmp/pg.log start
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
createdb dept12   # first time only
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -d dept12 -f "$f"; done
```
Migrations are sequential and additive (never edit an applied one — start at
`docs/decisions.md` for the current and archived history). For a disposable smoke-test
DB against just the initial schema + synthetic fixtures instead of the real
migration chain:
```bash
dropdb --if-exists dept12_check && createdb dept12_check
psql -v ON_ERROR_STOP=1 -d dept12_check -f supabase/migrations/20260804000001_initial_schema.sql
psql -v ON_ERROR_STOP=1 -d dept12_check -f supabase/seed.sql
```

Nothing is connected to a hosted Supabase project, by design.

# Dept 12 Dashboard — Spec & Agent Instructions

> **Current history lives in `docs/decisions.md`; older ranges are linked from
> that file.** This file is the lean,
> load-bearing rules + reference an agent needs every session. Do not paste
> changelogs here — record decisions (with the *why*) in `docs/decisions.md`.

## Docs to keep in sync (as part of the same change, not a follow-up)

| File | Holds | Update when |
|---|---|---|
| `CLAUDE.md` | Rules, reference, domain, traps | A rule/reference/trap changes |
| `WORKTREE.md` | Every file + the `app.js` section map | A file is added/moved/deleted or a section shifts |
| `docs/design.md` | Design tokens, component conventions, protected exceptions | A CSS token, toolbar/pill/empty-state convention, or the icon set changes |
| `README.md` | What the app is; each feature | A feature is added or changes |
| `docs/decisions.md` | Current decisions, open items, and archive links | Any non-obvious call |
| `docs/supabase-server-port-plan.md` | Hosted architecture, gates, migration, rollback | A hosted connection, security, deployment, or cutover decision changes |

A stale WORKTREE (or design.md) is worse than none — the next agent trusts it.

## Working style

- **Missing Bag Order numbers (D224):** Nate authorized extracting an
  order/pallet pair from imported order notes and using the delivered month
  for its full number. Within a delivery month, an earlier duplicate uses
  the previous month. Shift only once; retain existing full numbers and
  flag same-day ties or remaining collisions. Update `order_period` with
  the assigned month so the Bag Orders grid groups the record correctly.
  Dates such as "Rdy 2/24" are not order/pallet pairs.

- **Order-screen copy (D223):** no standalone counts such as "21 transfers
  in 2026" or routine explanatory clutter. Keep concise identities, real
  order fields, useful empty states, and actionable notices.

- **Verify, don't assert.** Nothing is "done" until run. Show real output; if a
  test fails or you skipped a step, say so. Don't round results up.
- **Legacy code is the spec.** Label anything that isn't a faithful port as new
  behaviour — silently "improving" a workflow breaks a dispatcher's muscle memory.
- **Ask when the answer changes the work.** Nate knows the freight domain; guessing
  business rules produces confident, wrong schemas (this has cost rebuilds — D31).
- **Don't over-engineer.** Prefer surfacing information over enforcing logic —
  Nate wants annotations that prevent mistakes, not rules that block work.
- **Session efficiency:** restart/reload the server only when you need to observe
  behaviour — batch edits, verify once. Edit `app/web/*` in place; never
  regenerate a whole file. Don't narrate routine progress; report what changed,
  broke, or needs input.
- **Caveman mode (Nate's ask).** Chat replies: short, blunt, low-effort words.
  No fluff, no "Let me..." narration, no long explain. Small caveman talk
  fine. Save deep reasoning/tokens for the real work (code, tools, verify) —
  not for the chat text around it. Code/commits/docs stay normal professional
  English — this is chat-voice only.

## What this is

One dispatch/operations dashboard consolidating (1) the TMS Google Sheet + Apps
Script (driver-facing scheduling) and (2) the invoice-packaging automation.
Goal: escape Sheets' limits while keeping drivers' experience identical, and get
granular queryable data (load-level fields, not PDFs) for reporting. Built to
plug into **Acumatica** later; standalone now.

**Out of scope for current local development:** folding in the rate calculator
app; connecting a live Supabase; any Acumatica build; anything that changes what
the existing schedule-sheet drivers see. The future live connection is planned
in `docs/supabase-server-port-plan.md`; Rexius Bag Orders is a required component
of that cutover, not an independent later deployment.

## Golden rules (non-negotiable)

- **Driver-facing sheet tabs are read-only** — drivers never write; no
  write-conflict handling needed.
- **Two sheets:** `1KlPQ…` is the dispatcher's working sheet (**replaceable**);
  `15f12…` is the **mirror** 8 tablets read — **its ID must never change**. The
  mirror is a pure projection (`updateDriverTabs` rebuilds each driver tab), so
  pointing it at Postgres is a data-source swap, not a rewrite — the app's own
  `push-driver-tabs` (D98/D107) now does exactly that: it writes named driver
  tabs straight into the **mirror**, not the working sheet (D111).
- **Supabase/Postgres is the source of truth**, not the Sheet. Model the schema
  around real freight entities, not the Sheet's columns.
- **Adapter pattern** for every external source (Sheets now, Acumatica later) so
  the backend swaps without rewriting the core.
- **Supabase stays local/unconnected** for now — build schema + RLS as if live,
  don't point at a hosted instance.
- **No file-blob-as-database** — PDFs go to Supabase Storage; key fields are
  extracted into Postgres columns at ingest. The PDF is an attachment, never the
  record.
- **Dependency-free** (D24) — no pip deps in the app; hand-roll (e.g. JWT signing
  in `app/adapters.py`). One-off `scripts/` may use libs (openpyxl, etc.).

## Data model

> **Platform pivot in progress (D85).** The Database section is becoming
> **metadata-driven** (`entities`/`fields`/`records`, migration `20260814000002`)
> so an admin can rename/reorder/resize/retype fields, add databases, and later
> re-wire dispatch — Airtable-style. This softens the old "model the schema around
> real freight entities" rule: new fields live generically, but two carve-outs
> **stay typed + SQL-queryable no matter what — delivery date/timing and internal
> transfer cost** (mark such fields `locked`). A `field.id` is the stable wiring
> anchor; `key`/`label` are renamable. The 4 built-in Database grids are now
> metadata-described wrappers over their real backing tables (`fields.storage =
> column:<table>.<field>`); dispatch still reads the real tables. See D85 for the
> phased plan; built-ins keep working throughout.

Real schema: `supabase/migrations/` (initial `20260804000001`), explained in
`docs/schema.md`. Applied to PostgreSQL 17.10. Key shape:

- **An order is not a load.** `orders` → `load_orders` → `loads` (internal
  combines several orders on one truck; external is one order, several drops).
- **Three identifiers:** `solomon_order_no` (current 12/07 formats but admin-
  configurable, future Acumatica join key), `broker_load_no`, and our uuid —
  independent namespaces. Never parse business metadata from the visible number.
- **Internal loads have two money paths:** a hand-entered freight charge to the
  bag plant (`orders.internal_freight_amount`, moved off `loads` by D103;
  reported as a truck+department total for a picked date range, not a fixed
  weekly bucket, D127), AND an end-customer invoice.
- **Document matching cascade (D7):** exact Solomon → exact broker load # →
  filename → text/OCR → unmatched queue (manual attach). Filename beats text
  because scanned rate cons have no text layer.

## Phase status

Phases 0–2 complete and verified. 3 (Sheets sync), 4 (doc ingestion), 5
(dashboard UI) functionally complete except where noted below; 6 (reporting)
done (D40); 7 (edge-case testing) open. Still open across phases: Supabase
Storage (deferred by golden rule); Billing's "Active Loads" view. The
color/merge half of the driver-tab push is done (D107). Detail per phase is
in the current and archived logs linked from `docs/decisions.md`.

Phase 8 (hosted Supabase/server cutover) is planned but not started. The
dashboard and separate Rexius Bag Orders web app must launch through the staged
gates in `docs/supabase-server-port-plan.md`, sharing one Postgres database and
one private document bucket. Do not treat the portal as an East-only database
or a separate document lane.

App-wide Supabase Auth and delegated Outlook Graph drafts are fully
scaffolded but **disabled by default** (D110) — see
`docs/auth-outlook-activation.md` before assuming either is live.

## Reference

| Thing | Value |
|---|---|
| Dispatcher sheet (replaceable) | `1KlPQrxbXjDssy3Y5QrU75FoaGpeCmTmQhUC-m0p1mJ4` |
| **Mirror sheet (never change)** | `15f12Q0Nz4NFNUwbtQ7NgE7eCwSfqx3ai0VJAeZjtKJs` |
| TMS Apps Script ID | `1CpJeAMukE5rseJwV13FfDfqX1eEkzWAjKW3NogqcbTGZAjSZePGP09ke` |
| Invoicing Apps Script ID | `1wTYhPSy1KJUe_2SsLnltWpXktsLzfN8XRRn1e7xjn9_Syg9iahIKE7_T` |
| Driver tablets | 8 (shared account) |
| Extraction logic | `legacy/invoicing-local/index.html` — `parseRateCon:2404`, `extractInvoiceInfo:1738`, `findBroker:1512`, `matchBrokerForFile:1567`, `normBroker:1500`, `GENERIC_SET:1539` |
| Store images | `github.com/NateTooNice/storeimages` (~300 MB — URL only, never vendor) |
| Sheets sync key | `secrets/dept-12-dash-*.json` (gitignored). Wired up by default via `.env` (D163) with `DEPT12_SHEETS=google DEPT12_SHEETS_CREDS=… DEPT12_SHEETS_ID=15f12…` (the **mirror** — server.py's only use of `SHEETS` is `push-driver-tabs`, which writes named driver tabs that only exist there, D111). One-off `scripts/` that read dispatcher input hardcode `1KlPQ…` themselves instead. |
| Motive ELD key | `secrets/motive-key.txt` (gitignored). `DEPT12_MOTIVE=motive DEPT12_MOTIVE_CREDS=…`. Read-only per-truck-per-day miles (D48), synced for both Bag Orders (kind=internal) and Internal Freight transfers (is_transfer, D127) — external's mileage is derived by subtraction, never synced per-load. An order Motive has no data for (predates that truck/account being on Motive) is stamped `motive_synced_at` and never retried (D124) |
| Internal Freight tracker (D127) | Orders → Internal Freight — dept-to-dept mileage/$ transfers with no customer (e.g. "Bag Plant to Umatilla Yard"). `orders.kind` stays `'external'`; `is_transfer` + `transfer_department_id` mark them. Department is a real Database grid, labeled **"Internal Freight"** there too (`slug='departments'` stays stable; renamed/reordered by migration `20260819000003`), addable/editable like Fleet/Bagger Customers via a real popup (`addDepartmentModal`). Created via `/api/order/transfer`, opened by `openTransferOrder` (`03-drawer-billing.js`); Copy via the same `/api/order/copy` External Orders uses (`api_copy_order` branches on `is_transfer`). Never invoiced — no solomon #, no customer/broker, ever (`orders_transfer_shape` CHECK). Chip color is per-department — `departments.color`, same Fleet-style color-chip UI as the driver color field (migration `20260819000005`, superseding a same-day single-swatch-for-everyone attempt at `20260819000004`). Right-click a color chip to copy/paste its hex, or paste to every row currently multi-selected via the numbered gutter (`COLORCLIP`, `09-color.js`). Dashboard chip and driver-pushed text use two separate fields, now universal across all three order kinds (D130, generalized D140): `notes` ("Load info"/"Notes" in the drawer) is dispatcher-private and never pushed — for transfers specifically it also drives the chip title; `driver_note` ("Driver tab note") is the one note that reaches the driver's Sheets tab (`_transfer_chip_text` for transfers, folded into every kind's pushed NOTES column by `_driver_week_payload`), editable from any drawer, from Driver Tabs' Notes column, or by typing directly over a chip in Scheduler/Current Week — all three write the same field via `driverNoteSet`/`orderFieldSet`. There is no third, load-level note anymore — `loads.notes` was retired (D140). |
| Scheduler sizing (D175/D216) | `PREFS.rowHeight`/`PREFS.colWidth` (56–160px / 100–320px, default 84/150) drive `--row-h`/`--col-w` on `:root` — `.slotrow`/`.slotrow .chip` and the truck-column `<th>`s all read from those, not a literal `72px`/`150px`. Adjustable in Settings → General's "Scheduler sizing" card via the same `.fb-fs` stepper component as font-size/Days-shown (D174), with a live preview built from real `.grid`/`.slotrow`/`.chip` markup — no separate preview-sizing logic, it resizes for free off the same CSS variables. Any new place that renders a truck-column width must read `PREFS.colWidth`, not hardcode `150` — the two JS-computed *table* width formulas (`vScheduler`/`vCurrentWeek`) already do. |
| Internal freight rate (D170, D187, D205) | One persisted settings row, `internal_freight_rate` (`rate_per_mile`, `minimum_charge`), bootstrap-loaded as `DB.internal_freight_rate`. Toolbar UI: a plain `<`/`>` glyph (`IFR_OPEN`, `05-settings-nav-search.js`, `internalFreightRateHtml()`), anchored at the far right of the always-open global formatting toolbar on Orders pages; Sync mileage/Sync delivery dates remain in each order tracker's own toolbar — there's no manual "calculate" trigger. `/api/internal-freight-rate/calculate` (`app/server.py`) only ever runs chained after a successful `/api/motive/sync-miles`, and only when a rate is set. `charge = greatest(miles * rate, minimum)` — `minimum = 0` means the floor never binds. **`api_freight` also applies this same formula inline (D187)** whenever miles is typed directly into a tracker cell or drawer field — not just after a Motive sync — so hand-typed mileage auto-prices an order too. Applies to both Bag Orders (`kind='internal'`) and Internal Freight transfers (`is_transfer`), same pairing as Motive sync (D127/D48). Both paths only fill orders where `internal_freight_amount is null` — never overwrite an already-priced order, hand-entered or from an earlier run under a different rate, so typing the $ amount directly always wins regardless of edit order. `/api/internal-freight-rate/*` routes are deliberately admin-only by omission from `API_PERMISSIONS` (see that trap below) — `/api/freight` itself is not (dispatchers use it constantly). |
| Local DB / server | `psql -d dept12 -h /tmp`; `python3 app/server.py` → port 8770. Picks up `.env` at repo root automatically (D163, hand-rolled loader, no python-dotenv — D24) — a real shell-exported var always wins over the file. |
| Auth/Outlook scaffold (dormant) | `DEPT12_AUTH_ENABLED`/`DEPT12_OUTLOOK_ENABLED`, both `false` by default. Activation steps: `docs/auth-outlook-activation.md` |
| Hosted Supabase/server port (planned) | `docs/supabase-server-port-plan.md` — includes the dashboard and separate Rexius Bag Orders host, shared Postgres/private Storage, Auth mapping, automatic completion mail, staging gates, cutover, rollback, and retirement. |
| Local test login + permissions (D125/D126/D216) | `DEPT12_LOCAL_AUTH_ENABLED` — on by default via `.env` since D163 (Nate: "til told otherwise"), `false` if that file is ever removed — separate, dependency-free, no external services. Roster: `Nate` (admin), `Test1`/`Test2`/`Test3` (restricted), seeded in `supabase/migrations/20260819000001_local_auth.sql`. Account identity/status now lives in Settings → General; the avatar menu has one Settings entry rather than separate Settings/Account destinations. Access UI: Settings → Access (admin-only, internal sub-key remains `admin`) — card-style expandable account rows, View/Edit toggle per section, delete user. Scheduler date range with nothing explicitly set defaults to a rolling 3-weeks-back/1-week-forward window (`_default_view_window`), not unbounded. |

Sheet tab layouts are documented column-by-column in
`legacy/tms-appsscript/CLAUDE.md` — the most useful reference in the repo.

## Domain notes an agent won't infer

- **Solomon** is the current (Microsoft) accounting system Acumatica will replace.
  External numbers are typed by staff; their current pattern begins with 12.
- **External** is Nate's own dispatch/broker business and **Bag Orders** is the
  bagger's product hauled by Nate's trucks. Their current reporting codes are 12
  and 07, but both codes and visible number patterns are admin-configurable
  (`order_number_settings`, D217). Kind, department, and number text must remain
  independent. "Dept 12 hauls ~80% of Dept 07's freight" does
  NOT mean internal orders are numbered 12 — that reading cost a rebuild (D31).
- **Bagger / bag plant** — Rexius's bagged-product operation. Internal loads haul
  its product; it's charged freight internally, weekly, per truck.
- **Chips** = the unit dispatchers think in; a chip is a load. **Staging** = the
  A:C area of SCHEDULER where unassigned chips wait (app models it as a flat backlog).
- **Truck types:** `F` flatbed, `BT` B-Train, `CV` Curtain Van — a flatbed fleet.
  Trucks move between drivers; that history matters for reporting.
- **Timing windows** (Early / Anytime / Afternoon, + EAST variants) and **forklift
  type** (NF / Forklift / Spyder) are annotations, never validation rules.
- **Umatilla / EAST** = long-haul eastern Oregon, colour-coded on the sheet.
- **Seasonality:** Jan–Jul peak, Aug–Dec off-season (fixed months).

## Traps (read before touching related code)

- **Real customer/business data → local Postgres via a `scripts/` importer, never
  `seed.sql`** (which is synthetic test data committed to git). No real
  names/phones/addresses in seed.sql (D36). The xlsx (2025 backfill, D65, and
  its 2026 sibling, D220) is gitignored, as is `output/` (scratch/backups —
  a `pg_dump` is real business data too).
- **`isHistorical(o)` (`02-chips-extract.js`) and `isSheetImport(o)` are
  deliberately different checks (D220) — don't merge them.** `isHistorical`
  matches `custom.source === 'sheet2025'` only and gates the 4 places that
  exclude a row from the working Orders grids/biller queue — 2025 stays
  permanent read-only history. `isSheetImport` matches any `sheet20\d\d`
  source and only feeds `buildChip`'s raw-lane-text fallback (no
  broker/customer/pickup/delivery on either import) — the 2026 backfill
  (`import_2026_schedule.py`) needs that same chip fallback but must stay
  fully visible/editable, since Nate plans to eventually document-match and
  bill it like a normal external order. A new import source tag needs to be
  added to `isSheetImport`'s regex (or its own case) to get the chip
  fallback, and to `isHistorical` only if it should also hide like 2025.
  Neither script writes `loads.category_id` from the sheet's own fill
  colors (Nate: "we dont care about colors on import") — internal loads
  land uncategorized (he assigns each Bagger Customer's real designation by
  hand afterward) and external loads get `pushed_at` set at insert so they
  pick up the truck's current driver color through the existing
  `pushColorFor` mechanism, no bespoke coloring. Both scripts populate
  `orders.department`/`order_period` (D217) from the *live*
  `order_number_settings` row and the load's real date — skipping either
  makes an internal import invisible in every Bag Orders month tab (found
  live) even though it exists and renders fine on the Scheduler.
- The **scheduler DOM node is cached and detached** while another section shows —
  anything repainting cells must search that node (`schedNode`), not `document`
  (`repaintCell` handles both copies).
- **Scheduler cell coordinates are `truck_id`, not `driver_id` (D32)** — touches
  `schedule_notes`, `loads`, every payload from `td.dataset.key.split("|")`.
  Driver View (`vDriverView`) is truck-keyed too now (D116) — `DRIVER_VIEW`
  holds a **truck** id, one tab per `DB.trucks` row (Fleet's `sort_order`),
  not one per `DB.drivers` row; a driver-keyed picker meant an unassigned
  truck got no tab and the count silently drifted from the real fleet size.
  **One more exception (D115):** the pinned "Outside
  Carrier" lane uses `CARRIER_TID = "carrier"` as its cell-key identity — a
  client-only constant, never a real `trucks` row. A load placed there has
  `truck_id`/`driver_id` both null and `is_carrier=true` instead
  (`loads_driver_xor_carrier`, in the schema since the initial migration).
  `placement()`/`cellContents()`/`carrierMap()` branch on **`is_carrier`**
  (D122), not `carrier_party_id` — a load can sit on the lane before it has
  a carrier name, so `carrier_party_id` alone isn't a reliable "is this on
  the lane" signal. Placing onto the lane needs no name up front (drag from
  Staging like any cell; `moveLoad` routes a `CARRIER_TID` target to
  `/api/load/carrier` internally) — name/cost are filled in later from a
  collapsible drawer section (`carrierSectionHtml`), not a blocking modal.
  Don't assume every `loads` row with a `scheduled_date`/`slot` has a real
  truck.
- **A `.chip` (or Driver Tabs' `.dv-cell[data-oid]`, D138) click opens the
  drawer everywhere** (checked first in the click delegator, `07-events.js`);
  relies on the browser not firing `click` after a completed HTML5 drag.
  Don't add a competing chip click handler. The match is deliberately
  `.chip[data-oid]` **or** `.dv-cell[data-oid]`, never a bare `[data-oid]` —
  the drawer's own carrier-name/location-combo inputs also carry `data-oid`,
  and a generic match would re-open the drawer while typing inside one.
- **Drag/drop drop-target and drag-source matching is generic across the whole
  app, not Scheduler-only (D137).** `11-toolbar.js`/`12-touch-boot.js`
  match on `[data-key]:not([data-field])` (any element, not just `<td>`)
  for drop targets and `[draggable=true][data-oid]` for drag sources — no
  `SUB`/view check anywhere. `RAIL_ON` (`05-settings-nav-search.js`) is the
  only thing gating whether Staging (and its own drag/drop) is visible on a
  given view; Scheduler, Current Week, and Driver Tabs all share these same
  handlers. **`:not([data-field])` is load-bearing** — Database/Sheet grid
  cells (`dcell`/`sheetCellHtml`/`dcellRow`) also use `data-key`, in an
  unrelated `table-id-field`/`sheet-id-r|c` format, and always pair it with
  `data-field`; that's what keeps them from being treated as Scheduler-style
  drop targets now that the tag requirement is gone. Any new `data-key`
  emitter that ISN'T a real cellKey (`truckId|date|slot`) target must also
  set `data-field` (any value) to stay excluded. Driver Tabs' `.dv-cell`
  deliberately mimics a chip's four drag attributes
  (`data-key`/`draggable`/`data-oid`/`data-from`) without the `.chip` class
  — it's a valid drag source/target, and (D138) a valid click-to-open
  target via its own explicit `.dv-cell[data-oid]` match in the click
  delegator, but is NOT a `.chip` and must never be treated as one
  elsewhere (chip-specific formatting/selection code shouldn't assume
  `.dv-cell` matches `.chip`).
- **A Scheduler cell is only "occupied" (blocks a chip drop) when it holds a
  real load — a plain text note doesn't (D250).** `CELLS[key]` holds either
  a real load (`.oid` set) or a bare `schedule_notes` row (`.text`, no
  `.oid`); use the shared `cellHasLoad(key)` (`02-chips-extract.js`), not a
  truthy check on `CELLS[key]` itself, anywhere that decides whether a cell
  can be dropped onto — the mouse dragover/drop gates (`11-toolbar.js`), the
  touch-drag gate (`12-touch-boot.js`), and `moveLoad`'s own guard
  (`08-undo.js`) all need this distinction. `api_schedule`'s place-an-order
  path has always silently deleted a destination note before inserting the
  load (pre-existing server behavior) — dropping onto a note is a real,
  silent replacement, no confirm/alert. `pasteCell` (D66, `09-color.js`)
  deliberately was NOT extended this same way — still a pure "cell
  occupied" reject — that's a narrower, separate ask, not overlooked.
- **Editable order-tracker rows do not open on whole-row click (D211).** Their
  dedicated 44px `trackerOpenTd()` column is the only drawer target, which
  removes the old ambiguity between inline edit/selection and row-open.
  Non-tracker `data-roworder` rows retain D43 whole-row open, excluding form
  controls and `[data-frcell]`. Internal mileage/Transfer-$ cells continue to
  own their full cell click target and focus the input.
- Internal vs external orders use **different drawer functions** (`openInternalOrder`
  vs `openOrder`); `openOrder` dispatches to the internal one for `kind==='internal'`,
  and to `openTransferOrder` for `is_transfer` (checked first — a transfer is still
  `kind==='external'` underneath, D127).
- **Internal Freight transfers (D127) are `kind='external'` with `is_transfer=true`,
  never a third `kind` value** — the UI tab is fully separate ("Bag Orders" →
  "Internal Freight" → "External Orders" in that nav order; "Bag Orders" is
  the renamed old "Internal Orders" label only, `kind` is still literally
  `'internal'` for it), but ~19+9 call sites across the app branch on `kind`
  directly, so a real third enum value would mean auditing all of them. A
  transfer can never carry a customer/broker/solomon # — that's the
  `orders_transfer_shape` CHECK, and it's deliberate: it's the one clean,
  reliable tell (real 2025-import data proved auto-detecting "is this a
  transfer" from blank customer/broker fields is NOT reliable — some blank
  rows are genuine external loads with the customer/PO sitting in a free-text
  note instead of a structured field, never retrofitted). Any code that
  filters "external orders" for a UI list, a billing-eligibility check, or a
  stop-sync must add its own `!is_transfer`/`is_transfer` guard — `isExt(o)`
  itself stays a pure kind check and does NOT exclude transfers.
- **Internal Freight has no season concept (D221, added then removed same
  day 2026-09-12)** — `orders.transfer_season` was added in migration
  `20260912000001` and dropped again in `20260912000002`; Nate's call, the
  tracker's Year picker already does that job and a second concept just
  confused it. A transfer is never treated as "2025 permanent history" the
  way an ordinary bag/external import row is — it always shows under its
  real `ordered_at` year via the same `externalOrderInYear` every other
  tracker uses, `sheet2025`-sourced or not. Don't reintroduce a season
  field or a `transferOrderInYear` helper. Bag Plant → Umatilla is
  confirmed Internal Freight credited to Bagger - 07, superseding D220's
  bag-order mapping. Stutzman/Marion AG/Columbia Carb/Ultra Block routes
  "to Yard #1" are confirmed Internal Freight credited to Yard 1 - 03
  (2026-09-12). Other Bag Plant routes still need review.
- **Schedule import meaning (D221):** Load/Deliver instructions (including
  prefixed times or order numbers), holiday text/lettering and forklift
  reminders are schedule notes, not freight. Do not delete a real trip
  merely because another trip copied its number. A leading number on an
  actual external freight entry is its short order number; a parenthesized
  code identifies the broker/customer, followed by its load number. Preserve
  raw notation and resolve month/spaced-number ambiguities before assigning
  full identifiers. BM DC means the Bi-Mart DC bag customer; bag notation is
  order number / pallet count. North End Boise is confirmed Northend Organics
  for the reviewed mixed-route entry, not a Umatilla transfer.
  **Order-number/broker assignment (D221 continued, 2026-09-12):**
  `scripts/reconcile_external_orders.py` (`12-{MM}{YY}-{####}` + broker via
  a hand-confirmed `ALIASES` dict — extend it only from Nate's own
  confirmation, never fuzzy-guess) and `scripts/reconcile_internal_orders.py`
  (`07-{MM}{YY}-{####}` + brand/store-number customer matching) are both
  idempotent preview-then-`--commit` scripts, same collision-holding model:
  a genuine same-candidate collision between two real trips is left
  unassigned and logged, never guessed. 341 such collisions are sitting in
  `custom.external_import_review`/`custom.internal_import_review` (`issues`
  contains `repeated_full_order_number`/`repeated_broker_load_number`) —
  query those, don't re-derive the list, and don't auto-resolve them; Nate
  is working through `duplicate_order_numbers.csv` by hand. Re-running
  either script after he assigns a number by hand is safe (it skips rows
  whose `after` state already matches).
  **`buildChip`'s raw-lane-text fallback checks resolution, not just
  source (2026-09-12)** — `isSheetImport(o)` alone used to gate it, so a
  row either reconcile script had since matched still showed its original
  raw note forever (reconciliation never clears `custom.source`). Use
  `sheetImportUnresolved(o)` instead: same raw-text path, but only while
  the row is still actually unmatched (`!broker_party_id` external,
  `!customer_party_id` internal); a transfer is excluded (already has its
  own real chip line). Don't revert this to a plain `isSheetImport(o)`
  check.
  **Broker directory + final import cleanup (D222, 2026-09-12):**
  `scripts/add_new_brokers.py` diffs the live "outside customer list"
  Google Sheet tab (`legacy/invoicing-local/index.html`'s
  `BROKER_SHEET_URL`) against local `parties(is_broker)` by normalized
  name and adds only genuinely new companies — re-run it before assuming
  the ALIASES tail is unresolvable; the directory grows independently of
  this codebase. `reconcile_external_orders.py`'s `ALIASES` (~85 entries)
  is now cross-checked against that same directory — a new code should be
  confirmed against it (or Nate directly) before adding, never
  fuzzy-guessed. **Anything left genuinely unmatched after that is
  deliberately converted to plain `schedule_notes` text, not left as a
  broken-looking order** (`scripts/reconcile_unmatched_to_notes.py`, Nate:
  "make the shit plain text on the scheduler... i can still search by
  number and once i give u documents to match u can do the same thing and
  create loads from the docs"). This is the final disposition for import
  edge cases — don't reintroduce a "leave it as an unresolved order"
  fallback; a fake order with no broker/customer is worse than a text
  cell. It still excludes `repeated_full_order_number`/
  `repeated_broker_load_number`-held rows (Nate is reviewing
  `duplicate_order_numbers.csv` by hand) and `is_transfer` rows.
- **`order()`/`party()`/`locFor()`/`locById()` (`02-chips-extract.js`) are
  id-indexed maps rebuilt once per `render()` via `reindexLookups()`, not a
  linear scan per call (D222)** — found live as real, reproducible lag
  after the full 2025/2026 import (~3700 orders): these were called from
  `buildChip` across every visible chip, and a per-call `O(n)` scan that
  was fine at a few hundred rows was not fine at that count. Any new
  lookup over `DB.orders`/`DB.parties`/`DB.locations` by id should use
  these maps (or add a same-pattern one), not a fresh `.forEach`/`.find`.
  `locFor` preserves first-match-wins for a party with 2+ locations, same
  as the old scan's array order — don't let it flip to last-wins.
- **The Scheduler's rolling month window prunes its far edge past
  `SCHED_MAX_MONTHS` (`04-views.js`, D222)** — `buildScheduler`/
  `onSchedScroll` (D53) used to only grow, and every month ever scrolled
  past stayed resident forever; harmless when historical months were
  sparse, genuinely slow (and could make a browser drop a native
  `dragstart` mid-drag) once real chip-dense data filled every month.
  `pruneSchedTop`/`pruneSchedBottom` remove the oldest/newest resident
  month once the cap is exceeded; pruning the top compensates `scrollTop`
  by the removed height (removing DOM above the viewport shifts everything
  below it up) the same way the existing prepend path already does — don't
  remove that compensation.
- **Truck-off days now push "OFF" in red (D222).** `_driver_week_payload`
  (`server.py`) used to never consult `truck_off_days` at all — a slot
  with no load on an off day pushed blank (or, worse, whatever unrelated
  `schedule_notes` text happened to sit in that slot). `truck_rows()` now
  checks `off_by_key` first and wins over a note in the same slot, writing
  `chip="OFF"` + `color=TRUCK_OFF_COLOR` (`"#FF0000"`, in `DARK_FILLS` for
  white text). Current Week's `truck_rows(t, compact=True)` call shares
  this same function, so both driver tabs and Current Week get this for
  free — don't add separate off-day handling to either push path.
- **Day notes (D230) are a separate concept from `schedule_notes` —
  one plain dispatcher-only note per calendar DATE (`day_notes`, no
  truck/slot, no fmt), never pushed to driver tabs or Sheets.** Opened via
  the date-header right-click menu (`openDayMenu`, `09-color.js`) →
  `dayNoteModal` (`06-modals-grids.js`) → `/api/day-note` (upsert by
  `note_date`; empty text deletes the row). `DAY_NOTES`/`dayNote(ds)`
  (`02-chips-extract.js`) is rebuilt by `buildDayNotes()` in `render()`
  right next to `buildOffDays()` — same pattern, deliberately a separate
  date-only map (not `truck|date` like `OFFDAYS`). Rendered as real text
  under the date in `td.rowhd` (`schedMonthHtml`, `04-views.js`), not just
  a hover title — Nate wants to read it while scrolling, not hover for it.
  **No longer a standalone report (D245, reversing the original D230
  design) — Nate: "i don't need dispatch notes being its own report, i
  just wanted to make sure the field shows if i export the entire app."**
  `_DAY_NOTES_SQL`/`PARAM_SQL["day_notes"]`/`_REPORT_LABELS["day_notes"]`
  and the `day_notes` card in `vReports` are gone; `_DUMP_SQL` instead
  left-joins `day_notes` on the same `activity_date` expression every
  order row already sorts/pivots by (`coalesce(scheduled_date,
  delivered_at, ordered_at)`), so a note surfaces on whichever order(s)
  land on that date. Don't reintroduce the separate report — a day note's
  only way out of the app now is the full "Export entire app" dump.
  Remember the `api_bootstrap` explicit-select-list trap below if
  `day_notes` ever grows a new column the *dashboard UI itself* needs to
  read (unrelated to the dump, which is a fresh SQL join, not bootstrap).
- **Every generic drawer-field blur handler (`data-of`, `data-fr`) now goes
  through `refreshOrderDrawerAfterSave(saveOid)` instead of an unconditional
  `openOrder(oid)` rebuild (D122/D127/D128)** — confirmed live as a REAL bug,
  not just theoretical: two ordinary adjacent text fields (Notes → Miles;
  Miles → Transfer $), not just the transfer department picker, silently lost
  the first field's edit when the second was focused before the first one's
  save round-trip landed, because the rebuild tore out the field the user
  had since moved into. `refreshOrderDrawerAfterSave` checks
  `document.activeElement`: if focus is still on another editable drawer
  field (`[data-of],[data-fr],[data-frorder],[data-transferdept],
  input[data-cust],[data-carrier]`) when the save resolves, it patches only
  the chip preview + title (`refreshDrawerTitle`, works on any drawer — all
  three now carry `id="dw-title"`) instead of rebuilding; otherwise it does
  the full rebuild as before. Any BRAND NEW drawer field mechanism that
  doesn't ride `data-of`/`data-fr` (like `data-carrier`/`data-transferdept`,
  which already do their own narrow patching) needs the same guard, or the
  same class of bug reappears. A `<select>` on such a path also needs its
  own `change`-event branch for the instant, pre-save chip-preview update
  text fields get for free via the shared `input` listener — see the
  `data-transferdept` branch in `07-events.js`'s `change` listener.
- **`api_bootstrap`'s per-table `select` lists are explicit column lists, not
  `select *`** (caught live on `departments.color`, D127 follow-up #3) — a
  new column on an already-bootstrapped table is invisible client-side,
  with NO error anywhere (the value just silently reads `undefined`/falls
  back), until it's added to that table's line in `api_bootstrap`. Check
  this immediately whenever a migration adds a column the client needs to
  read, not just whenever a new *table* is added.
- **CSV report headers are translated, not raw column names (D161).**
  `_csv(rows, labels)` maps each column through `_REPORT_LABELS[report]`
  (`app/server.py`) for display; row data still keys off the real column.
  Adding a column to `_DUMP_SQL`/`_FREIGHT_SQL`/`_MILEAGE_SQL` or any
  `REPORTS[...]` query without a matching entry in that report's
  `_REPORT_LABELS` dict doesn't error — it just silently falls back to the
  raw SQL name in the exported header row. A header that would read like a
  path/formula (a slash) uses an underscore instead (Nate's rule) — e.g.
  `po_number` → "PU_PO", not "PU/PO". **`_csv()` returns a bare `""` for
  zero matching rows — not even a header line (D260)** — found live: a
  date range that matched nothing downloaded a real, silently empty
  `.csv` while the client still toasted "Exported ...". The generic
  report-export click handler (`07-events.js`, keyed off `data-report` —
  covers every report card, not just one) now checks `!j.csv` first and
  toasts "No data for that range" instead; any new report added through
  this same button convention gets that check for free, but a bespoke
  export path elsewhere would need its own guard.
- **An order-tracker grid's `data-oedit` inline-select handler patches the
  local order from `/api/order/update`'s raw `returning *` row (D84,
  extended D127)** — that keeps real columns (`customer_party_id` etc.) in
  sync, but `customer_name`/`broker_name`/`transfer_department_name` are
  server-side JOINs, not real columns, so they silently go stale until the
  next full `reload()`. Any code that patches an order in place after one of
  these three FK fields changes (not just the tracker's own handler — undo/
  redo's `orderFieldSet` needed the same fix) must also call
  `applyOrderFkDenorm(o, field, value)` (`02-chips-extract.js`) to resolve
  the display name from already-loaded `DB.parties`/`DB.departments`.
- **`fieldCell`/`fieldRawValue`'s `f.ui === "color"` branch has two cases,
  not one (D127 follow-up #2)** — `f.storage === "column:drivers.color"` is
  Fleet's special case (color lives on `drivers`, reached through the
  truck's current `driver_id`, since a truck's row context has no
  `ctx.drivers` slot); any OTHER `ui:'color'` field falls through to the
  generic column-backed branch, which resolves directly through its own
  row context (`ctx[table].obj[field]`) — no indirection, no special
  lookup. Adding a color field to a NEW builtin entity should ride the
  generic branch for free; only a color field that (like Fleet's) lives on
  a *different* table than the row itself needs its own special case.
- **A Database grid's `<select>`/color-chip cells are pinned to 26px and
  centered, not stretched to the 32px row (D160).** `table.data td`'s
  height was bumped 26→32px so the row-selection ring's border has real
  clearance instead of sitting on top of an edge-to-edge colored fill
  (looked like the fill was "clipping" the instant its row was selected).
  The fix is `table.data:not(.order-tracker) td > .cell[style*="padding:0"]
  > select.cell-i,...> .colorchip{height:26px}` — deliberately excludes
  `.order-tracker` (which also uses a `style="padding:0"` cell wrapper for
  the broker/customer combo, for an unrelated reason, and has its own
  34px row height already). Don't drop that `:not()` scope.
- **Any grid `<select>`/`<input>.cell-i` MUST carry `data-key`/`data-table`/
  `data-id`/`data-field` on its `<td>` (D173) — the same shape `dcell()`
  and `selectFieldCell()` use — or Tab silently breaks on it.** The
  keydown handler in `06-modals-grids.js` special-cases Tab on an INPUT/
  SELECT only when it's inside a real `td[data-key]`, driving the normal
  `move()` cell-to-cell navigation; anything else falls through to a
  blanket guard that lets the *browser's native tab order* take over —
  which only visits focusable elements, so it skips every plain cell and
  jumps straight to the next focusable `.cell-i`, while the app's own
  `SEL`/`.sel` ring stays frozen on the old cell (found live: "two
  selected cells," Tab only ever cycling through dropdowns). This is
  exactly what happened to `designationSelect()` (D72), which predates the
  `data-key` convention (D144/D145) and had never been retrofitted.
  **Exception:** a select/input reusing one of these renderers *outside* a
  real grid (e.g. `designationSelect()` inside the order drawer's
  read-only customer panel, `03-drawer-billing.js:195`) must NOT get
  `data-key` — the generic `mousedown` handler that sets `SEL` isn't
  scoped to an actual grid ancestor, so an ungated `data-key` there paints
  a stray selection ring with nothing to Tab through. `designationSelect`
  takes a `gridMode` param for exactly this — pass `true` only from a real
  grid call site.
- **Internal = the delivery customer is a Bagger Customer** (D65) — not the color,
  not the department guess. Internal is always dept 07, external dept 12 (D31).
- **Internal chip color = the Bagger Time Window field's conditional rules,**
  resolved from the customer's designation name (D94), not a second toolbar
  legend or `categories.color`. The customer is resolved via
  `customer_party_id`, NOT `delivery_location_id` (D72). Internal orders leave
  `delivery_location_id` null; the bagger customer is on `customer_party_id` →
  `locFor(pid)` → `locations.category_id` → category name → the Bagger
  `category_id` field's `conditional_format`. Internal is purely
  time-window-driven (no per-load paint); external keeps, in order, **push color
  (once `loads.pushed_at` is set) > `fmt.fill` > per-load category > timing edge**
  (D85 Phase 2) — push color is the truck's CURRENT `driver_color`
  (`pushColorFor`/`truckById`), looked up live so it follows reassignment, not
  frozen at push time. Edit colors by right-clicking the **Time Window** column
  in Database → Bagger Customers. `designationRuleColor` drives both its select
  and Dispatch chips. Timing/equipment badges use the same neutral callout;
  equipment is Forklift/Spyder/No Forklift and no EAST badge is rendered.
- **External (non-transfer) chips get a dedicated two-line meta layout,
  dashboard-only (D251) — city/state route bold and one step larger, load#/
  order# below it, never touching Sheets/drivers.** `buildChip`'s external
  branch (`02-chips-extract.js`) returns `route` ("City, ST → City, ST") and
  `nums` (`broker_load_no / solomon_order_no`) as their own fields alongside
  the existing joined `line` (still used by the tooltip and Staging's search
  filter — don't remove it for those). `chipHtml`'s `metaHtml` renders this
  via a `.meta-route` block (`.route-line` span + the normal small line)
  whenever `isExt(o) && !o.is_transfer` — Internal Freight transfers (no real
  route) and Bag Orders (own PAL/order# 2-line layout) are untouched. **A
  flex column child needs BOTH `min-width:0` and `width:100%` to actually
  wrap instead of overflowing (confirmed live)** — `.meta-2line` is
  `display:flex;flex-direction:column`, and a flex item with neither sizes
  its cross-axis to its own unwrapped content width, growing silently past
  the chip's edge under `overflow:hidden` instead of breaking to a second
  line. Any future multi-line chip content in this same container needs both
  rules, not just one.
- Internal order numbers are type-overable (D157), same `data-oedit` pattern
  as External's `solomon_order_no`. `+ Add one` and bulk Add Orders use
  `order_number_settings.internal_pattern`; bulk takes an explicit **Starting #
  / Ending #** range (D233 — not a count; the save handler computes
  `count = end - start + 1` before calling `/api/internal-order`, same
  endpoint as always). Pattern tokens are `{MM}`, `{YY}`, `{YYYY}`, and one
  `{###...}` sequence block. `orders.order_period`, not string slicing, owns
  the Bag Order month/year tab, so retyping or changing the workspace pattern
  never moves historical data. `orders.department` is also stored
  independently and filled from the current Bag/External department setting
  for newly numbered rows (D217).
  **Bag Orders has no monthly breakout anymore (D233, removed
  `MONTH_GROUPS`/`INT_MONTH`/`currentMonthGroup`/`orderMonthCode` —
  don't reintroduce them)** — flat and year-scoped only, newest-to-oldest by
  `bagOrderCompare` (same numeric-locale-compare tail as
  `externalOrderCompare`, safe because the grid is already year-scoped by the
  Year picker). The grid re-sorts live as a number is edited, without a full
  re-render (`resortInternalTrackerRow`, `04-views.js`) — a full render on
  every blur would break tab-through the same way D84 already fixed for the
  broker/customer combos. It now also has to stay inside whichever
  live/Delivered bucket the row was already in (see the tracker-collapse
  trap below) and falls back to a real `render()` if the row's correct next
  neighbor isn't currently in the DOM (paged out) rather than guess a
  position. **"Year-scoped" still needs a null-safe filter (D261)** — a
  copied/blank Bag Order has no `order_period`/`solomon_order_no` yet, so
  `orderYearCode(o)` returns null for it; filtering with `orderYearCode(o)
  === yy` (the naive version) made a fresh copy vanish from every year's
  tracker — still existed, still counted toward the nav badge, just
  nowhere to click until it got a real number. Found live copying a
  Delivered row. `internalOrderInYear(o, yy)` (`01-core.js`) is the
  null-safe wrapper — `!code || code === yy`, same shape
  `externalOrderInYear` already used for exactly this reason — and is now
  what `vInternal`'s row filter and `resortInternalTrackerRow` both call.
  Any new Bag Orders year-filter needs the same wrapper, not a bare
  `orderYearCode(o) === yy` comparison.
- **Billed (External Orders) / Delivered (Bag Orders, Internal Freight) rows
  collapse into one shared disclosure + paging system (D232/D233/D235,
  `04-views.js`) — don't render a "handled" bucket eagerly or fully.**
  `TRACKER_COLLAPSED_OPEN`/`trackerCollapseToggleRow` is the closed-by-default
  arrow-row (mirrors the History panel's day headers, D135); it only hides
  `<tr>`s, never filters `orders()`, so global search and drawer-open-by-id
  still find a collapsed order same as always. Once expanded,
  `trackerCollapsedRowsHtml`/`TRACKER_COLLAPSED_SHOWN`/`TRACKER_COLLAPSE_PAGE`
  cap the render to 150 rows plus a "Show more" row — External's Billed
  group alone is 1,000+ real rows, and rendering all of them at once was
  the actual cause of a real, reproducible scroll-lag complaint (D235, same
  class of problem D222 already fixed for the Scheduler: too many live DOM
  nodes, not anything re-rendering on scroll). Collapsing again clears the
  shown-count so reopening always restarts at one page. `EXT_TRACKER_COLS`/
  `XFER_TRACKER_COLS`/`INT_TRACKER_COLS` are the toggle/more rows' `colspan`,
  hand-kept in sync with each tracker's own `<thead>` — same class of
  coupling as the `dvSlotCellsHtml` sibling-count trap below, bump it
  whenever a column is added/removed from one of these three trackers.
- **`orders.truck_id` (D239) is stamped only by `api_sync_delivery_dates`
  ("Sync Delivery Dates"), same staleness model as `delivered_at` itself —
  it is NOT kept live in sync on every reschedule, and nothing else writes
  it.** Bag Orders'/Internal Freight's read-only Truck column
  (`truckCell`, `04-views.js`, placed directly before Miles — Nate: "keep
  miles and $ next to each other but we need truck") reads the denormalized
  `orders.truck_number` `api_bootstrap` joins in from `trucks` — don't add
  a `data-oedit`/dropdown for this field, a manual override would
  misrepresent which truck actually ran the load. `_DUMP_SQL` prefers this
  column over its older lateral-subquery-through-`loads` truck guess,
  falling back to that lateral only when `truck_id` is still null; deliberately
  did NOT touch `_FREIGHT_SQL` the same way — that report's truck resolution
  is date-range-filtered off `loads` directly (not a lateral, not actually
  convoluted), and switching it to `orders.truck_id` would silently drop
  any load whose order hasn't been through a delivery-date sync yet, a real
  regression for a report used for actual billing.
- External Orders' Pickup/Delivery live on `orders`
  (`pickup_location_id`/`delivery_location_id`, D33), **not** `load_stops`
  (`load_stops.load_id` is NOT NULL, but pickup/delivery is set before scheduling).
  **D108** added `order_stops` as an explicit itinerary layer on top of this —
  every order still has `route_mode='simple'` by default and
  `_sync_simple_order_stops` keeps a 2-row shadow there in lockstep with the
  plain fields above, so this trap still holds for the ordinary case. Only a
  deliberate save from the route editor sets `route_mode='custom'` and adds
  real stops beyond the shadow pair; read `order_stops`, not
  `pickup_location_id`/`delivery_location_id`, wherever a custom route must
  be honored (chip text, the External Orders grid, Sheets push).
- The **Pick/Drop List** is the same `locations` table as Bagger Customers, just
  unfiltered by `party_id` — no parallel table.
- **Bagger Customers, External Customers, and Internal Freight archive; they do
  not delete (D191/D192).** Role-specific timestamps are
  `parties.customer_archived_at`, `parties.broker_archived_at`, and
  `departments.archived_at`. An archived row leaves its active Database view and
  future order pickers/matching/export, but its party/location/department,
  historical orders, documents, reports, and audit history remain. Archiving one
  party role never disables another customer/broker/carrier role on the same
  party. **Show Archived** uses the same grid and numbered-gutter selection to
  restore rows. Each active/archive pair preserves the other's saved row-order
  population under its existing grid key. Existing open orders continue through
  the dashboard and Rexius Bag Orders portal normally; archiving is not
  cancellation. Pick/Drop List, Fleet, and custom databases retain guarded
  permanent delete.
- **Database grid row order is not table order (D109).** A saved
  `grid_row_orders` row (per `grid` key, so the same party can sort
  differently across grids) wins over source order; `storedOrderRows` applies
  it at render time. Don't assume the rows a query returns are the rows a
  user sees — drag-reorder and the sort-and-save dialog both write here.
- **Invoiced loads are locked** (D29): no clear, overwrite, or reschedule. Repeat
  lanes get copied into a new order via External Orders' Copy (D30).
- **Order cancel/delete is guarded (D93).** Both trackers and both drawers use
  `/api/order/cancel` for cancel/restore and `/api/order/delete` for permanent
  deletion. Cancel detaches the order from staging/scheduling but preserves the
  order and paperwork; restore does not recreate its old placement. Delete is
  confirmed and removes unlocked order-owned documents/files. Delivered,
  billed, or invoiced orders are locked against both actions. When detaching one
  order from a shared internal load, keep the other orders/load intact.
- **Tracker workflow controls are split by intent (D100/D211), Cancel/Delete
  remain bulk-only (D159).** Every tracker uses a fixed 220px Status / Stage
  column containing one joined control ordered Status → Copy → Stage/Restore.
  Status is a fixed 78px caption segment, Copy is fixed, and the final Stage
  segment folds to zero when the order moves into Staging, leaving no reserved
  gap. Bag Orders, Internal Freight, and External Orders all expose Copy.
  Cancel and Delete no longer
  have per-row buttons or a far-right Actions column (removed, D159) — both
  order trackers and the drawer's own Cancel are gone, replaced entirely by
  the numbered-gutter multi-select's bulk Cancel/Delete (select one row for
  a single order, same as before). The workflow column is not sticky.
- `driver_truck_assignments`: when reassigning, close **both** old sides before
  inserting (else `dta_no_driver_overlap`); a same-day correction must be
  **deleted**, not closed with `effective_to = today-1` (violates `dta_range_valid`).
- `locations.timing_window` is `early`/`anytime` **only** — Umatilla is a separate
  `is_umatilla boolean` (D36). Check both wherever legend/color logic runs.
- Spreadsheet cell editing has **no per-keystroke undo**: typing over a selected
  cell replaces its whole value immediately (a stray keystroke has clobbered a
  truck number). App-wide Cmd-Z undo exists (D63) for committed actions.
- **Clearing a cell keeps its formatting** (D82, Sheets parity): a `schedule_notes`
  row survives — body blanked — whenever `fmt` (fill/border) or `category_id` is set,
  and is deleted only when the cell is truly bare. So "empty cell" does NOT imply "no
  row." Clear/color-null preserve fmt on both server (`api_schedule` clear,
  `api_cell_color`) and client (`scheduleNote`, `setCellColor`).
- **No 3-rows-per-day cap** anymore (D65/D68/D82): `loads` and `schedule_notes` both
  allow `slot >= 1`. Any per-slot constraint/logic must not assume `slot ≤ 3`.
- **Single-cell selection is set in `selStart` (pointer flow), NOT the `mousedown`
  handler** (D83): the marquee's `pointerdown.preventDefault()` suppresses the
  compatibility `mousedown`, so a `mousedown`-bound `selectCell` never fires on a
  real click. Don't move cell selection back onto `mousedown`. Backspace/Delete
  clears the whole marquee via `deleteSelection()`, not just `SEL`.
  **The same suppression silently broke `#ctxmenu`/`#palette`'s
  dismiss-on-click-away listener (D259)** — found live: right-click a
  Scheduler cell to open `#ctxmenu`, then click a different cell, and the
  menu stayed on screen (selection moved underneath it) because that
  listener keyed off `mousedown`, which never fires for a click `selStart`
  handles. Fixed by switching that listener (`09-color.js`) to
  `pointerdown` — always fires regardless of a later `preventDefault()`,
  and registering in 09-color.js (before 10-select.js alphabetically)
  still runs it ahead of `selStart`. Any new "close this popup on an
  outside click" listener must bind `pointerdown`, not `mousedown`, or it
  will silently never fire for a click that lands on a grid cell.
- **A text note's border-drag (D254, `10-select.js`) is a THIRD pointer-driven
  drag alongside the marquee and the fill handle, registered before
  `selStart` specifically so it can `stopImmediatePropagation()` on a
  matching pointerdown** — plain `stopPropagation()` doesn't stop a sibling
  listener on the same `document` target from also firing, only
  `stopImmediatePropagation()` does. Only fires on the cell the selection is
  ALREADY on (mirrors the fill handle's own precondition, D118), within
  `NOTE_BORDER_PX` of an edge, and only when that cell is a plain text note
  (`CELLS[key].text`, no `.oid`) — never a real load. Moves text only, not
  fmt/category (same scope choice D250 made); dropping onto a cell with a
  real load is refused via the same `cellHasLoad` D250 introduced. Known
  trade-off: a double-click landing inside that same border band starts a
  drag instead of opening the cell for editing — accepted, not fixed.
- **The 4 built-in Database grids render from `entities`/`fields` metadata** (D85)
  via `vDatabase → vBuiltin` (`fieldTh`/`fieldCell`/`builtinRows`), NOT hardcoded
  columns. Special cells are field `ui` handlers (designation/equipment/truckdriver/
  color). The custom-column/selection "grid" key is NOT the entity slug: brokers'
  grid key is `external` (`gridKey(slug)`). Resolve a toolbar grid key back to
  metadata with `entityForGrid(key)`, not `entityByKey(key)`; the latter does not
  translate `external` → `brokers` (D92). Custom columns still ride `grid_columns`
  (`customTh`/`customTd`) — unify into `fields` later. Fixed layout is scoped via
  `.gridfixed`; don't apply it to custom sheets.
- **Database grids scroll inside a flex-fill `.grid-wrap`, not the page (D93,
  mechanism changed under D256).** D93's original fix was a Database-only
  `.pad.grid-pad` flex/overflow hack; D256 retired it in favor of the same
  generic direct-`#main`-mount + `.grid-wrap{flex:1}` every other section
  now uses (see the `render()` dispatcher bullet above) — same effect
  (Bagger Customers' 274 rows scroll in place instead of expanding the
  outer page to ~7,100px and causing severe layout lag), simpler mechanism.
  Whichever camp a view is in, don't let its grid lose a `flex:1;overflow:
  auto` scroll container of its own. The `.col-resize` hitbox is centered
  on the header divider.
- **Database rows use the numbered gutter as their selector (D94), never a
  checkbox.** `ROWSEL`/`paintRowSel` enable and count the `Delete selected`
  button. Clicking the same sole-selected row again clears it; Database headers
  use the same toggle behavior through `COLSEL` (D96). Built-in deletes go
  through guarded `/api/grid/row/delete`; custom rows use `/api/record/delete`.
  **The three order trackers share this same `ROWSEL` selection engine
  (D159)** via their own gutter, `trackerSelTh`/`trackerSelTd`
  (`06-modals-grids.js`) — grid keys `"int"`/`"xfer"`/`"ext"` — but without
  Database's drag-reorder grip (trackers have a real sort, not a manual
  order) and routed through the real guarded `/api/order/cancel`/
  `/api/order/delete` via `data-ordercancelrows`/`data-orderdelrows`, not
  the generic grid-row-delete endpoints. A tracker row's gutter `<td
  data-rowsel>` had to be added to the whole-row-click-opens-drawer
  exclusion list (D43) or clicking it would open the drawer instead of
  selecting. **A plain mousedown-drag across `[data-rowsel]` cells range-
  selects too (D193)**, on every one of these gutters (Database and
  trackers alike) — `rowSelStartDrag`/`rowSelDragTo`/`rowSelEndDrag`
  (`06-modals-grids.js`) plus the `mousedown`/`mousemove`/`mouseup`
  listeners in `07-events.js`. Shift/Cmd/Ctrl+mousedown deliberately don't
  arm it, so those stay pure click-only via `handleRowSel`. The trailing
  `click` after a real drag is suppressed once (`ROWSEL_SUPPRESS_CLICK`)
  so it doesn't collapse the drag's range back to one row. A new numbered
  gutter automatically gets drag-select for free as long as it emits real
  `[data-rowsel]` cells — no separate wiring needed — but if it also wants
  Database's row-reorder grip (`.rowgrip`), mousedown on the grip must stay
  excluded from arming a drag-select (already handled generically, not
  per-grid).
- **Built-in Database columns have one visible order (D96).** `databaseColumns`
  interleaves metadata `fields` and legacy `grid_columns`; both header types
  drag through `reorderDatabaseColumns`, and the trailing `+` header opens the
  add-column dialog. Do not restore the old toolbar `+ Column` / `Columns` UI.
- **Undo/redo is one app-wide 50-action stack (D96).** Every committed,
  reversible mutation should register server-backed old/new closures with
  `histPush`; use the primitives in `08-undo.js` so UI and Postgres move
  together. Confirmed permanent deletes are deliberately not in the fast
  session stack.
- **Durable History is separate and admin-only (D131/D132).** `audit_events`
  groups one request and `audit_changes` stores immutable before/after row
  snapshots; `dept12_capture_history` triggers cover every current
  primary-key table and direct scripts fall back to a System event. New
  mutable tables added after migration `20260819000007` must receive the
  same trigger (`driver_receipt_completions` does in `20260910000002`, D190).
  Never update/delete audit evidence. A flat timeline with a
  conflict-checked single-event revert (appends an inverse event, doesn't
  edit the original) — no bulk "restore to a point"; that mode existed
  briefly (D131) and was cut (D132) as the fragile, rarely-needed path,
  reverting a chain one event at a time is safer. The preview's baseline
  sequence must still match at execution so an admin never confirms against
  a stale change list. **Every mutating request must clear
  `dept12.history_event_id` when it finishes, success or error** — it's set
  on the pooled per-thread Postgres connection with `is_local=false`, so it
  outlives the request; an uncleared value silently misattributes the next
  trigger-fired write on that connection to the wrong event (found live,
  D131 follow-up: a fresh user's `/api/local-login` insert landed on
  whatever event the previous request on that thread had left set). Cleared
  unconditionally in `do_POST`'s `finally`, not just its `except`.
  **`#history-panel` is a persistent left grid column (D133), not an
  overlay drawer** — first child inside `#bodywrap`, shown via
  `.body.history-on` adding a `300px` track (`display:none` on the panel
  itself the rest of the time, so it claims no width closed). It stays open
  across navigation until the admin closes it; `openHistoryPanel`/
  `closeHistoryPanel` toggle both the panel's `.on` and `#bodywrap`'s
  `.history-on` together — don't reintroduce a `closeHistoryPanel()` call
  inside a jump target, that was the old right-side-overlay behavior and
  the whole point of moving it left was so a jump doesn't have to fight the
  panel for space. Each chip has no expand/collapse — changed-field text
  renders inline unconditionally; the whole chip is the click-to-navigate
  target (`historyEventJump` — first non-DELETE change with a live row to
  jump to), looked up against the CURRENT `DB.orders`/`DB.loads`/etc., not
  the change's own pruned before/after. **Revert/redo chains are collapsed
  client-side into one chip (D134)** — every toggle still appends a real,
  separate `audit_events` row server-side (D131's append-only design is
  unchanged), but `historyGroupedEvents` walks `reverts_event_id`/
  `reverted_by_event_id` to find each chain's root + current tip and
  renders one chip per chain. State is chain-depth **parity** (even hops
  from root = back to original data → "Revert action"; odd → "Redo"), not
  `!!tip.reverts_event_id` — that flag is true for every link past the
  first and reads "Redo" forever, which is the actual bug Nate hit
  (toggling stacked literal "Reverted: Reverted: Reverted: …" chips). Any
  new history UI must group by chain the same way, not render one card per
  raw event. `reload()` (already called after nearly every mutation)
  refreshes the open panel for free — don't add separate polling.
  **Chains with nothing left to act on are dropped from the list entirely
  (D135)** — the panel only shows "days with edits you can reverse," not a
  general audit browser; a non-reversible or already-fully-toggled-through
  chain never renders a chip. Survivors bucket into collapsible day headers
  keyed by the **root's** original `occurred_at` (local calendar day, not
  the tip's — undo should live with when the mistake happened, not
  whenever it was last toggled); the newest day opens by default,
  `HISTORY_OPEN_DAYS` persists open/closed state across a live-refresh's
  `reload()` so a background sync doesn't slam collapsed whatever the
  admin has open. **A 14-day retention purge runs in the background (D169)**
  — `_history_purge_loop` (a daemon thread started at the bottom of
  `server.py`, next to `ThreadingHTTPServer(...).serve_forever()`) calls
  `_history_purge_old()` immediately on server start and then every 24h.
  `HISTORY_RETENTION_DAYS = 14` is the one constant to change if the window
  ever moves. This is a real `delete` of `audit_events`/`audit_changes` rows
  older than the window (children first — `audit_changes.event_id` is `ON
  DELETE RESTRICT`) — distinct from the separate "never update/delete audit
  evidence" rule above, which is about not rewriting history during a
  revert, not about retention. `reverts_event_id`/`reverted_by_event_id`/
  `superseded_by_event_id` are `ON DELETE SET NULL`, so a chain whose root
  ages out just loses that link rather than blocking the purge.
- **`api_history_revert` applies inverses in three FK-safe passes, not one
  reverse-chronological pass (D250)** — found live (reproduced directly via
  `curl`, a real 500: `violates foreign key constraint
  "load_orders_load_id_fkey"`) reverting an event that both deleted an old
  `loads`/`load_orders` pair and inserted a new one for the same order (any
  load moved from one real cell to another shapes an event exactly this
  way, not just D250's new drag-onto-a-note case — this bug was latent
  before D250 and just never got exercised via History until this
  verification pass). Reverting strictly newest-change-first works for a
  simple dependent chain but not here: it asks to re-insert the old
  `load_orders` row before the old `loads` row it references exists again.
  Fixed by splitting `_history_changes`' DESC-ordered list into: undo every
  INSERT (a delete) first, most-recent-first; then undo every DELETE (a
  re-insert) in ORIGINAL chronological order (a parent row's delete was
  always captured before its dependent child's in every case checked, so
  replaying forward recreates parents before children); then UPDATEs
  (order-independent for FK purposes). Any future change to this ordering
  needs a live repro against a real move-a-load-between-cells event, not
  just a single-table test — that's what hid this the first time.
- **Scheduler row structure is historical (D100).** Past rows are subtly dimmed
  and cannot be added, removed, or weekend-expanded, though their notes remain
  editable. Future-day Add/Remove row actions are undoable. Remove always takes
  the bottom extra row, shifts its cells into each truck's first opening, and
  sends overflow loads to Staging after confirmation. Any user-initiated load
  move into or out of a past date also requires a history confirmation —
  **but only past `histCutoff()` (D166), a rolling 4-day grace period, not
  literally `TODAY`** — Nate: a truck breakdown that delays a schedule fix
  to the next day (or two) shouldn't trigger this every time. `08-undo.js`'s
  `historicalMoveMessage` and `06-modals-grids.js`'s `deleteSelection` are
  the two call sites; both read `histCutoff()`, not `TODAY`, for the
  boundary. A new past-date confirmation check must do the same.
- **Keyboard actions are user-rebindable (D97/D217), one key per action
  (D231 — `CUSTOM_SHORTCUTS`/"Add shortcut" is gone; don't reintroduce a
  second-binding-for-one-action concept, Nate found it pointless once every
  action already has its own Record button).** `BASE_SHORTCUTS` and
  `KEYMAP` in `01-core.js` own Undo, Redo, contextual Delete, navigation,
  and the three "New order" shortcuts (external/bag/transfer). Settings
  pages use the in-page tab strip opened by the sidebar-footer gear; each
  row's own Record/Reset rebinds that one action's key.
  `contextualDelete` delegates to the existing guarded UI action. Never fire app
  shortcuts while the user is typing in an input/textarea/select/contenteditable
  or live cell editor; macOS Backspace normalizes to Delete only outside typing.
  **Two separate `keydown` listeners share grid-cell keys (D121).** The
  rebindable-shortcuts one (`01-core.js`) deliberately yields to the grid
  whenever a cell/range is selected — the *real* handler for Delete,
  Backspace, arrows, Enter-to-edit, and now Cmd/Ctrl+C/V is the plain grid
  listener in `06-modals-grids.js`. Both `SEL` (single cell) and `SELSET`
  (a marquee/shift-click range, `09-color.js`) need checking — `SEL` is
  null whenever a real range is selected, so guarding on `SEL` alone silently
  breaks every one of these actions for a range while single-cell selection
  keeps working, which is exactly what shipped and went unnoticed until live
  testing (D121). Any new grid keyboard action needs the same
  `SEL || SELSET.length` reach.
- **Arrow-key cell movement reveals the destination through `revealCell(td)`
  (D248), not a bare `scrollIntoView` — a sticky column/header can overlap a
  cell that `scrollIntoView` already considers "in view."** Found live:
  arrowing right off a Scheduler row's last truck wraps to the next row's
  first truck, and `scrollIntoView({inline:"nearest"})` left it sitting
  under the sticky `td.rowhd` date column, clipped to less than its real
  width, since sticky overlap isn't part of that API's visibility math.
  `revealCell` (`06-modals-grids.js`, both call sites in `move()`) measures
  real bounding rects for the row's own `td.rowhd` and the table's `thead`
  and nudges `scrollLeft`/`scrollTop` directly when the target falls behind
  either — a no-op on a grid with neither. Any new cell-navigation call
  site should reveal through this, not a raw `scrollIntoView`.
- **A batch cell-write must tolerate partial failure (D121).** The generic
  Database cell system (`data-field`) has no per-column type awareness, so a
  fill/paste spanning mixed column types (numeric, a CHECK-constrained
  value) will genuinely 500 on the incompatible cells — that's expected, not
  a bug to route around. Committing a batch with `Promise.all` is: one
  rejected cell drops the undo record for every cell that *did* succeed,
  leaving real committed changes with no way back. Use `commitCellOps`
  (`06-modals-grids.js`, `Promise.allSettled`) for any new batch cell
  mutation — it keeps the successful ops undoable and reports failures
  without losing them. Cell DOM text must update only *after* the server
  confirms (inside the op's own `.then()`), never optimistically before, or
  a rejected write still shows the wrong value on screen.
- **Current Week is a rolling driver handoff (D98), not a Monday week.**
  `CW_START` + `CW_DAYS` drive `currentWeekDates`; weekdays count and weekends
  count only when they contain a real load. `/api/sheets/push-driver-tabs` must
  receive the same start/count and dry-run before confirmation. Do not return
  to `_week_dates()`. **Driver Tabs shares this exact window now (D139)** —
  `vDriverView()` also calls `currentWeekDates()` and renders the same
  `#cw-start`/`#cw-days`/`data-cw-step`/`#push-driver-tabs` controls Current
  Week does (same element ids, same generic handlers in `07-events.js`, not
  a separate synced copy). Don't give Driver Tabs its own date range again —
  that was the actual bug (it used to iterate a hardcoded Monday+5,
  unrelated to what a push would actually send). The confirmed write always clears/formats up to the full
  14-day ceiling (D98's clamp), never just the current push's day count
  (D114) — clearing only `row_count` rows was the actual "5 days" bug, since
  a shrunk window left a wider previous push's rows sitting below it. The
  real hand-made tabs also turned out to be capped at a fixed **17-row**
  grid — `push-driver-tabs` grows any tab short of `1 + 14×3` rows before
  writing (D112/D114); don't reintroduce a fixed clear range without also
  checking `gridProperties.rowCount` first, or it 400s on the real sheet.
- **`_driver_week_payload` reads both `loads` and `schedule_notes` now
  (D165)** — a Scheduler cell with no real load can still hold free text
  (README: "an ad-hoc job, a shop day, a reminder"), and until D165 that
  text was silently dropped from the push (the payload only ever queried
  `loads`). A no-load slot now falls back to its `schedule_notes` row —
  `notes_by_key[(truck_id, date, slot)]` — landing in `row["chip"]`, not
  `row["notes"]`, since it's the cell's actual content, not an annotation
  on some order. Keep this distinct from `driver_note` (D130/D140): that's
  a real order's own note field, pushed to the *notes* column alongside its
  real chip — a load and a schedule_note are mutually exclusive per cell
  ("A cell holds a load or a note, never both" — `api_schedule`), so the two
  paths never collide, but don't blur them into one concept.
- **The Scheduler UI never re-fetches after a confirmed Sheets push
  (D164) unless the handler explicitly does so.** `push-driver-tabs`'s
  click handler (`07-events.js`) chains `reload()` after the confirmed
  write specifically because the push flips `loads.pushed_at`, which
  changes an external chip's color (`pushColorFor`, D85 Phase 2) — without
  it the Scheduler/Current Week/Driver Tabs views kept showing the
  pre-push color until some unrelated action happened to trigger a
  render. Caught live (Nate: pushed a chip, ran it, no visual change).
- **Weekends are collapsed by default (D98).** `WEEKEND_ON` is the per-device
  manual override; schedule data auto-expands Saturday/Sunday. Right-click the
  date header to activate/collapse an empty weekend. Selection overlays must
  remain below sticky Scheduler headers, and `clearMulti()` clears both range
  and single-cell state.
- **Enter accepts every popup's one obvious action (D98, broadened D194);
  Escape exits every popup, and Cmd/Ctrl+Enter submits from inside a
  textarea (D230, "ensure all popup windows submit with enter or return,
  and exit with escape, thats app wide").** All three live as capture-phase
  `keydown` listeners in `06-modals-grids.js`, right after `openModal`/
  `closeModal`. Enter: targets known confirm-dialog ids
  (`#modal-confirm,#confirm-del,#confirm-customer-archive,#history-confirm`)
  first, then falls back to the popup's single `.modal-ft .btn.pri` when
  none of those exist — every add/edit popup has exactly one, per the
  toolbar's "exactly one primary action" contract (D171), so a NEW popup
  gets Enter-to-submit for free as long as it follows that convention and
  doesn't need separate wiring. The one popup with two `.btn.pri` buttons
  (the sort/reorder modal's Save A→Z / Save Z→A) is the reason the
  fallback only engages when there's exactly one primary — with two,
  Enter picking either would be a guess, so it still does nothing there. A
  `<textarea>` target is excluded from plain Enter (multi-line editing,
  e.g. the day-note popup, D230) — Cmd/Ctrl+Enter is the textarea's own
  submit path instead, same single-`.btn.pri` resolution. Escape: clicks
  the popup's `#modal-cancel` (every popup has one, same D171 contract),
  falling back to a bare `closeModal()`; also closes `#viewer.on` (the
  in-app document viewer, not part of `#modal` but the same kind of
  dismissible overlay). All three are guarded on an actual open
  `#modal`/`#viewer` so they never fire — and never `stopPropagation()` —
  otherwise, leaving the grid's own Escape-deselect (D196) and the
  drawer's Escape-close (both later in this same file) untouched for every
  other case. **Testing Enter in this app's Browser-pane tooling:** its
  synthetic `key` action for "Enter"/"Return" dispatches a keydown with an
  EMPTY `.key` string, not `"Enter"` — every app-level Enter handler
  correctly no-ops on it, which reads exactly like "Enter is broken" but
  isn't (`key:"Escape"` maps fine). Dispatch a real
  `KeyboardEvent({key:"Enter", ...})` via `javascript_tool` instead — same
  class of trap as `computer.type` vs `computer.key` for the smart-date
  fields (D226).
- **Only genuinely unmatched Billing documents may be deleted (D94).** The UI
  requires `matched_by='unmatched'` with no order/load/stop, and
  `/api/document/delete` repeats that guard before deleting the row + storage.
  Do not expose that action for attached paperwork.
- **Scanned-batch document ingestion (D225) is a 5-script read-then-write
  pipeline, run in order, not one script.** `index_sent_pdfs.py` (page/text
  inventory) → `export_sent_match_context.py` (read-only DB snapshot of
  external orders + brokers) → `ocr_sent_pdfs.swift` (macOS Vision, resumable
  — it skips any `(sha256,page)` already in its own output, so re-running
  after a partial run costs nothing extra) → `plan_sent_documents.py`
  (read-only classification + matching, `output/sent-2026/plan.json`) →
  `apply_sent_documents.py` (the only one that writes — preview-then-
  `--commit`, same model as every other reconcile script). Re-running any of
  the first four after adding more scanned PDFs to `Sent - 2026/` and
  re-running `apply_sent_documents.py` is safe and idempotent — it checks
  each document's `extracted_fields.sent2026_sha256`/`sent2026_pages` against
  already-filed rows before creating a duplicate. A matched group's
  `documents.matched_by` is always `'document_text'` — the ID came from OCR'd
  page text, not a structured field or filename, so don't reuse `'solomon'`/
  `'broker_load_no'`/`'filename'` for this path. `plan_sent_documents.py`'s
  `match_group()` only confirms a match on an exact printed order number
  (broker-checked, no conflicting load hit — corroboration isn't required
  once the number and broker both check out), a broker + unique load/PO hit
  (date-corroborated for a non-invoice), or, as a last resort, a broker match
  plus a document date 0–14 days after exactly one candidate order's
  `delivered_at` (Nate: "invoice date is usually a week or so after the load
  was delivered, sometimes sooner") — a genuine collision, conflict, or a
  date match against more than one order is left unmatched, never guessed.
  **An unmatched group never becomes a `documents` row (D225 continued,
  2026-09-14) — Nate: "if they aren't able to be matched they can't clutter
  the app."** Only a matched group is inserted into `documents`/Billing's
  queue; an unmatched group's split pages land in a plain local folder,
  `output/sent-2026/unmatched-review/<source stem>/`, that the app never
  reads. Don't reintroduce inserting unmatched groups as `matched_by=
  'unmatched'` rows — that was tried and reverted the same day once Nate
  saw 512 of them sitting in Billing. `Sent - 2026/` and `app/storage/` are
  both gitignored (real paperwork, D36's rule); `output/` is too.
- **Both order drawers start with `drawerChipPreview` (D95).** It uses the exact
  `chipHtml` pipeline (including scheduled load note/external pushed color), and
  `[data-of]` input events repaint it while typing. Drawer blur saves serialize
  through `queueDrawerSave`; don't reintroduce out-of-order field writes. (See
  the `refreshOrderDrawerAfterSave` trap above for the full-rebuild-vs-still-
  editing race this same area is prone to.) One narrower nuance not covered
  there: a save whose client-side validity check depends on ANOTHER field's
  value must read that field's live DOM value, not a cached model
  (`carrierMap()`) that only updates after its own save's round trip —
  otherwise a fast Tab between two fields races the cache and rejects a value
  that was, in fact, already entered.
- **Database/sheet cells linkify a whole-value URL (D123)** — real `<a
  target="_blank">`, not plain text, via `cellDisplayHtml` (`01-core.js`).
  Every render/repaint path for a `data-field` cell body must go through it
  (and use `.innerHTML`, not `.textContent`) or the link silently reverts to
  plain text on the next repaint: `dcell`/`sheetCellHtml` (render),
  `repaintGridCell`/`repaintSheetCell` (format repaint), `commitEdit` (live
  editor), `fillCellOp` (shared by fill-handle drag and paste). Only applies
  to the built-in Database grids and custom sheets (plain `<div class="cell">`
  cells) — custom Database *entities'* `jsonCell` fields are real `<input>`
  elements and can't host an `<a>` without a bigger restructure.
- **Custom databases (D85 Phase 2)** are `entities` rows with `kind='custom'`,
  no `slug`, no `backing_table` — addressed everywhere as `"custom:<id>"`
  (`entityByKey`/`entityKey`), same convention as sheets' `"sheet:<id>"`. Their
  columns are real `fields` (`storage='json'`) instead of the legacy
  `grid_columns`; their rows are `records` (`data` jsonb keyed by **field id**,
  not key — a field rename never orphans data). `vBuiltin` branches on
  `ent.kind` for both the row source and which add-row/add-column/delete
  endpoints to call — don't assume `ent.backing_table`/`ent.slug` are non-null.
- **Row/column/database deletion and per-field conditional formatting live on
  a right-click context menu, not inline buttons** (D85) — extends the
  scheduler's existing `openCtxMenu` (D66) via a generic `openMenu(x,y,items)`
  in `09-color.js`. Right-click a field/column header, a sheet tab, or a
  custom-database tab; don't re-add inline ⋮/delete buttons for these.
- **Dispatch/drawer UI is starting to read field labels from metadata (D85
  Phase 3)** — `fieldLabel(slug, key, fallback)` (`04-views.js`, next to
  `entityBySlug`) looks up a field's current admin label so a rename in a
  Database grid propagates outside the grid too; used by `openInternalOrder`'s
  customer panel (`03-drawer-billing.js`) and the Internal Orders grid's
  Customer/Timing headers (`04-views.js`, D92). Chip building, Driver View,
  and the rest of the order grids/drawers still hardcode labels — not yet
  ported. Always pass the current literal
  as `fallback` so a missing field/entity can't blank a label.
- **Every list-style page shares one toolbar contract (D171) — always build
  a new toolbar through `toolbarHtml(title, {context, secondary, primary,
  plain})` (`04-views.js`, right before `vScheduler`), never a hand-rolled
  `<div class="toolbar">...` string.** Layout is fixed: title, optional
  context controls, a flexible spacer, secondary/bulk actions, then exactly
  one `.btn.pri` primary action, always rightmost — that's what "unified
  across the dashboard" (Nate) actually meant, and Database/Billing had
  quietly drifted from it (no title, primary button on the wrong end, or no
  primary at all) before this. `plain: true` gives the borderless variant
  (a heading row inside the scrolling `.pad`, not a sticky bar) — still
  used by Reports/Settings, the only two sections left in that camp.
  Bag Orders/Internal Freight/External Orders stopped being `plain` at
  D237, and Billing/Database followed at D256 — a real page-mechanics
  difference tied to which `render()` mounting camp a view is in (see that
  bullet below), keep making `plain` a caller choice, not
  something the helper flattens away. A status/toggle indicator (e.g. "a
  custom sort is active") is `.btn.active` (outline+tint), never `.btn.pri`
  — `.pri` is reserved for the one real call to action per toolbar, or a
  second green button competes with it.
- **`render()`'s section dispatcher (`05-settings-nav-search.js`) has two
  structurally different ways of mounting a view's HTML into `#main` — know
  which one a view uses before touching its layout.** Scheduler, Current
  Week, Driver Tabs, Bag Orders/Internal Freight/External Orders (D237),
  and — since D256 — Billing and every Database grid/sheet all go straight
  in via `main.insertAdjacentHTML` — no `.pad` wrapper — relying on
  `main{display:flex;flex-direction:column}` being generic, so their
  toolbar sits at natural height and their `.grid-wrap{flex:1;overflow:
  auto}` (also generic, not `.pad`-scoped) fills all remaining height
  edge-to-edge, independently scrollable from a fixed toolbar/footer.
  Database's old `.pad.grid-pad` hack (D93) is gone — it was hand-rolling
  this exact same flex-fill-and-scroll behavior with padding on top; the
  generic mechanism replaces it outright, no regression in the "Bagger
  Customers expands the outer page to ~7,100px" fix D93 was for (re-
  verified live: `document.documentElement.scrollHeight` still matches
  `innerHeight` exactly while scrolling a 270+-row grid). Billing's several
  stacked sections (drop zones, unmatched-docs table, invoice pool, billing
  queue table) are wrapped in ONE outer `.grid-wrap` by `vBilling()` so they
  keep scrolling together as a single region, same as they did inside the
  old `.pad` — the two narrower `.grid-wrap`s already nested inside it
  (unmatched table, queue table) aren't flex items of anything there, so
  they're unaffected and still only scroll horizontally. **Only Reports and
  Settings still use the `.pad` wrapper now** (`padding:10px 14px;
  overflow:auto` — the whole thing, toolbar included, scrolls as one inset
  block) — nobody's asked for those to change. A view moved from one camp
  to the other needs its `toolbarHtml()` `plain` flag flipped to match (see
  the bullet above) or its background/border will look wrong for its new
  context.
- **`applyZoom()`'s CSS `zoom` targets `#main` as a whole, but every page's
  own `.toolbar` counter-zooms itself back to 1:1 (D252)** — Nate doesn't
  want the zoom control affecting a page's toolbar header (Current Week's
  "Days shown" stepper, etc.), only the grid/table content below it.
  `#main .toolbar{zoom:calc(1 / var(--zoom, 1))}` (`app.css`) cancels the
  ancestor's zoom for exactly that element — `zoom` isn't a real inherited
  property, so nesting one multiplies against the ancestor's rather than
  replacing it. `applyZoom()` (`11-toolbar.js`) sets `--zoom` on `<html>`
  alongside `#main.style.zoom` specifically so this CSS rule has something
  to read; keep both in sync if either changes. `.fb-font`'s width (154px,
  D253) is tuned against `.fb-fs`'s own hardcoded `left:600px` (D241) — if
  that 600px constant ever moves, re-measure the gap rather than assuming
  154px still lands close to it.
- **Full design token reference lives in `docs/design.md` (D172) — read it
  before touching `app.css` or adding any new UI, not just this bullet.**
  The short version: `--brand`/`--brand-soft` is the one personalizable
  accent (primary buttons, active nav, links, toggle-on). Selection CSS still
  uses the semantic `--focus`/`--focus-soft` names, but those now alias the
  chosen accent (D213), covering every selection ring, drag target, drop-zone
  hover, input focus, and Scheduler Today marker. `--billed` remains separate.
  `--brand-ink` is calculated from the chosen accent for readable text, and
  `accentIsReadable()` rejects colors that disappear into either base theme.
  Settings leads with ten safe `ACCENT_PRESETS`; optional custom colors are kept
  in `pref_saved_accents` (maximum 12) for quick reuse (D216).
  Font sizes are `--fs-caption` through `--fs-h1` (8 steps), radii are
  `--r-sm`/`--r-md`/`--r-lg` (3 steps), floating-panel shadows are `--e1`/
  `--e2` — reach for the nearest existing step, don't invent a new raw
  pixel value. Static interface copy uses `--font`; compact labels, counts,
  statuses, and tabular numbers use `--mono`. The header lockup
  (`.brand-copy b`/`span` — Nate: leave it exactly as it reads today) is the
  remaining raw size exception. D211's
  tracker status now uses `--fs-caption` inside a fixed 78px segment, so the
  former D100 8px hard-fit exception is retired.
- **`app.js` concatenates ~30 files into one global scope (D172 caught this
  live) — a top-level `var` in a new file silently wins or loses against a
  same-named `var` anywhere else, whichever runs last in `sorted(os.listdir)`
  order, with no error either way.** `11-toolbar.js` already owned a global
  named `ICONS` (Material Symbols path data for the cell-formatting
  toolbar) before D172 added a *second*, unrelated icon set for nav/toolbar
  buttons — every new icon silently rendered as an empty `<span>` until the
  second one was renamed `NAV_ICONS`. Before adding any new app-wide-sounding
  global (not just `ICONS` — same risk for any short, generic name), grep
  `app/web/js/*.js` for it first.
- **`app.js` is reassembled from `app/web/js/*.js` on every request — `server.py`
  is not.** Editing server-side Python needs a server restart to take effect;
  editing client JS doesn't. A silent `{"ok": true}` from a `/api/row`-style
  endpoint (empty `sets`, meaning none of the posted keys matched the
  allowlist) is the tell that a just-added allowlist column isn't live yet —
  check the process was restarted before debugging further.
- This machine's python.org Python has **no root CA certs** — a bare
  `urllib.request.urlopen` on HTTPS fails `CERTIFICATE_VERIFY_FAILED`. Use
  `_urlopen()` in `app/adapters.py` (certifi bundle) for outbound HTTPS (D35).
- The `secrets/` Google JSON must be a real **service-account** key (has
  `private_key`/`client_email`); a raw `AIza…` API key can't authenticate Sheets
  writes (D35). `GoogleSheetsSync` A1 ranges must be URL-encoded — real tab names
  have spaces (D36).
- Postgres jsonb params: follow the existing pattern — `json.dumps(...)` with an
  explicit `%s::jsonb` cast; a bare param bound to a jsonb/`"any"` arg raises
  `IndeterminateDatatype`. Same for a null compared with `%s is null` → cast
  `%s::text`.
- `parseRateCon`/`LOAD_PATS`/`RATE_PATS` (`02-chips-extract.js`) were stress-tested
  against 11 real broker rate cons + the Rosboro fixture and tightened (D27→D105):
  the "PO Box" false-positive is fixed, along with several more found the same
  way (rate regex grabbing a boilerplate penalty clause instead of the real
  total, bare label words like "Order Number" or "PORTLAND" being captured as
  if they were the identifier). Every captured token now requires a digit
  (`NUMTOK`) and rate matching is tiered so specific phrases ("Total Pay",
  "Net Pay") win before the generic fallback. Broker-name matching against
  parties NOT yet in the DB is still unsolved — a brand-new broker's own
  letterhead name is never captured, only matched against existing parties.
  **Re-stress-tested against 133 real, already-matched rate cons (D244,
  `scripts/test_ratecon_extraction.js` — a reusable regression harness, not
  run automatically) using the D225 pipeline's own answer key.** Two more
  fixes came out of it: the literal broker-name-in-text match now takes
  whichever real party name occurs EARLIEST in the text (`text.indexOf`),
  not whichever comes first in `DB.parties`' array order — a document
  legitimately mentioning two real parties (the broker up top, a pickup/
  delivery customer further down) used to pick whichever query order
  happened to return first; and `LOAD_PATS` gained "Freight Bill #" (must
  stay ahead of "trip" — Tradewinds prints both, and Freight Bill # is the
  one Nate actually records) and "Our Billing #" (tolerant of Nationwide's
  OCR-flattened "Our Billing # :\nCompany :\n<number>" table read). Before
  chasing a NEW rate-con matching bug, re-run that harness first — it may
  already be a known, accepted gap (documented in D244) rather than a
  fresh regression, and any regex change belongs in the harness's numbers
  before it lands.
- **`extractInvoiceInfo` (`02-chips-extract.js`, feeds `ingestBatch`'s
  invoice-splitting pool) now has the same thin-text → `ocrPdf()` fallback
  `ingestRateCon` already had (D246)** — found live testing against all
  326 real matched invoice documents from D225 (same method as D244): it
  used to ONLY read `pdfjsLib`'s embedded text layer with no OCR fallback
  at all, and every one of those real invoices is a scanned/faxed page
  with no text layer, so it extracted nothing (a blank "Invoice N" pill)
  on 100% of them — the auto-label convenience never fired once against
  real production paperwork. Same `<40`-non-whitespace-char thin-text
  threshold as `ingestRateCon`; the position-aware item-coordinate pass is
  skipped on the OCR path (it only means anything against a real text
  layer) but both regex fallbacks re-run against the OCR'd string. Don't
  remove this fallback thinking the position-aware pass alone is
  "good enough" — it measurably is not, against real scanned batches.
- **Local-auth permissions (D125) are enforced server-side by a single
  fail-closed table, not per-handler checks.** `API_PERMISSIONS` in
  `app/server.py` maps every mutating route to the `(section, sub)` it needs
  `edit` on; a route missing from that table is admin-only by default. A new
  `/api/...` mutation route added later needs an entry here or a restricted
  user can never call it (fails closed, not silently open — but still worth
  checking when adding a route). `current_local_user()` reads a second slot
  on the same per-thread `_local` object `db()` already uses — don't
  thread identity through handler signatures, read it from there instead.
  **Database grants are per-grid, which some endpoints can't resolve from
  the path alone** — Bagger Customers and Brokers are both the `parties`
  table, split only by `is_customer`/`is_broker` on the row being touched, so
  `/api/row`/`/api/row/custom`/`/api/grid/cell-fmt` do one extra lookup
  (`_database_sub_for_table`) rather than trusting `d["table"]` alone.
  **The client-side `canEdit`/`canView` gates are UX only** — real
  enforcement is server-side; a client check existing on a function (e.g.
  `moveLoad`) doesn't mean every path to a mutation is covered, so a new
  Scheduler/Database mutation still needs its own `API_PERMISSIONS` entry
  even if some client button already happens to be disabled.
- **A restricted user's Scheduler `view_start`/`view_end` both null does NOT
  mean unbounded (D126)** — `_default_view_window()` (`server.py`) applies a
  rolling 3-weeks-back/1-week-forward-from-today window whenever both are
  null, checked in both `_enforce_view_window` and the bootstrap filter.
  Don't read "no window set" as "no restriction" anywhere new; call
  `_default_view_window()` the same way the existing call sites do.
- **The Scheduler date-range hard boundary (D125) is scoped to `loads`/
  `schedule_notes` only** — `truck_off_days` and `categories` are
  deliberately NOT filtered by a restricted user's `view_start`/`view_end`.
  Any new Scheduler-date-bearing mutation needs its own `_enforce_view_window()`
  call (see `api_schedule`/`api_load_carrier`/`api_load_note`/`api_cell_color`/
  `api_cell_format`/`api_unschedule` for the pattern) — it is not automatic
  just because the route is gated to `dispatch/sched` in `API_PERMISSIONS`.
- **The Driver Tabs dashboard view (`vDriverView`/`dvSlotCellsHtml`,
  `04-views.js`) is a deliberate column-for-column mirror of
  `_driver_week_payload`'s real B:I sheet layout (D185, following D137) —
  Nate's ask: "whatever i edit inside of the driver tabs on the dash i can
  just directly push to the sheet and its perfect all of its in the same
  spots."** It had already drifted once — D178–D183 moved PO#/Delivery#
  into their own columns and relocated the map links to H/I on the real
  sheet, but nobody updated the dashboard grid alongside, so it sat one
  layout-generation behind for an entire session before Nate caught it.
  Any future change to the driver-tab column set (`_driver_week_payload`'s
  `values` row order, or the push handler's B2:I range) must land in
  `dvSlotCellsHtml`/`vDriverView`'s grid in the same change — not as a
  follow-up. `dvSlotCellsHtml` must always emit exactly as many sibling
  `.dv-cell` elements as `repaintDvSlot`'s generic sibling-walk expects
  (currently 7); adding/removing a column means updating both the no-order
  and has-order branches together, or the two branches produce a different
  number of cells and `repaintDvSlot` silently fails past that slot.
- **The sidebar (`#sidenav`, D200–D202) owns section navigation — the old
  persistent top-level `.sections`/`.subs` bars are permanently hidden, not
  removed. Database is the deliberate exception: its spreadsheet-style
  `#database-tabs` strip is rendered inside `#main`.** The sidebar is a real
  grid column (`.body`'s `grid-template-columns`,
  first slot), not an overlay: `renderSideNav()` runs on every `render()`
  so active-section highlighting and per-sub badge counts stay current,
  and it never removes itself from the DOM. `.header-row` reserves the same
  `--nav-w` first column in `.nav-head`, so the hamburger belongs to the nav
  shell and the brand/search/profile header begins exactly at the sidebar's
  right edge (D206). Collapsing (`#navtoggle`, the nav-header hamburger — the
  *only* toggle, deliberately a plain glyph that
  never changes) swaps `#sidenav-body`'s content between `navMenuHtml()`
  and `navMenuCollapsedHtml()` (01-core.js) rather than just clipping
  text — collapsed mode is a single-open icon+accordion
  (`NAV_OPEN_SEC`), not a hover flyout, for Dispatch/Orders/Billing/Reports.
  Within each collapsed section control, the icon and arrow are separate hit
  targets (D207): icon navigates to that section's current/first visible
  destination; the plain `↓`/`↑` arrow only opens/closes its subsection list.
  The hamburger is centered in `.nav-head` at every rail width (D209).
  The collapsed Orders icon's badge is the sum of the visible Bag Orders,
  Internal Freight, and External Orders **unplaced** counts (D203), not a
  different all-active metric; it must reconcile with the accordion rows.
  **"Unplaced" means genuinely needs scheduling, not just "not on a load
  right now" (D249).** `navUnplacedCounts()`/`needsPlacement(o, pm)`
  (`01-core.js`) exclude `stage === "cancelled"` for all three kinds (D93 —
  a cancelled order is detached from scheduling for good) and each kind's
  own "done" field, matching its tracker's own live/collapsed-group split
  exactly: `billed_at` for External (`vOrders`), `delivered_at` for Bag
  Orders and Internal Freight (`vInternal`/`vInternalFreight`,
  `04-views.js`). Found live as a real stray count: a billed external
  order that had never been scheduled counted toward the badge forever,
  since the old check only looked at placement + `STAGED` membership.
  Any new "does this order still need attention" tally should read off
  the same per-kind done field its own tracker uses, not reinvent one.
  In collapsed mode, `.fmtbar-navspacer` shows `<`/`>` subsection-cycle
  controls (D204). They wrap through `subsOf(SEC)` without opening the
  accordion, update their tooltip to name the destination, and disable when
  fewer than two visible subsections exist. The spacer's collapsed-mode
  inset `::after` rule and `.nm-section-div` share the same 1px `--rule-2`
  styling and visual side inset; keep those two rail separators identical.
  Bare keyboard `ArrowLeft`/`ArrowRight` invokes that same cycler only when
  there is no cell/range/row selection, editor, form field, drawer, menu,
  modal, or conflicting configured shortcut (D209). `ArrowUp`/`ArrowDown`
  share that exact guard (`navArrowShortcutAvailable`'s `axis` param, D214)
  to cycle top-level sections instead of subsections —
  `navVisibleSections()`/`cycleNavSection()` (`01-core.js`) walk `NAV` in
  its render order, landing on each section's current/last-visited sub via
  the same `navSectionLandingSub`/`databaseLandingSub` helpers the
  collapsed-icon click already uses. Existing grid navigation
  keeps priority, and `Escape` remains the way out of active selections.
  **Settings lives outside `NAV` by design (D54) but both axes now reach
  it (D247).** Plain Left/Right already cycles `subsOf(SEC)` generically,
  so `navArrowShortcutAvailable`'s "is this a real current section" check
  also accepts `SEC === "settings"` — Settings' own tab strip
  (`settingsTabsHtml`) rides the exact same `cycleNavSub` every other
  section uses, no separate cycling code. A held **Shift** on Up/Down
  invokes a second cycler, `cycleNavSectionWithSettings` — the same shape
  as `cycleNavSection` but with Settings appended as one more stop past
  Database — via `navArrowShortcutAvailable`'s new `allowShift` param
  (every other caller still rejects a held Shift, so this can't fight a
  real shifted shortcut or a shift-select gesture). Plain Up/Down is
  unchanged: Settings still isn't in `navVisibleSections()`, so a bare
  arrow from Settings falls through to the normal 5-section cycle same as
  always — only Shift reaches or leaves Settings via this route.
  Database is one direct entry after `.nm-section-div` in both sidebar
  states; it never opens an accordion. Reports deliberately precedes that
  divider. Database entity/sheet navigation plus add/rename/delete stays in
  `#database-tabs`: click to navigate, double-click a tab to rename, and
  right-click custom tabs to delete. The Database sidebar entry returns to
  the last active Database tab for the current browser session. `--nav-w`
  is a JS-driven inline custom property on `<body>` (`applyNavWidth()`,
  12-touch-boot.js,
  mirroring `--rail-w`/D44) with separate persisted widths for expanded vs.
  collapsed (`localStorage["navW"]`/`["navCW"]`) — the fmtbar row's
  `.nav-head` and `.fmtbar-navspacer` inherit the same variable so the header
  and real toolbar
  content lines up with `main`, not the sidebar. The formatting toolbar is
  always open and uses `--panel`, matching the header/sidebar rather than the
  darker `--panel-2` table-header tone (D210); on Orders pages its far-right
  edge contains Internal Rate.
  **Arrow glyphs throughout
  the app show the toggle's action direction, not its current state**
  (Nate's explicit rule, D201): the Staging rail toggle and the IFR-rate
  arrow both follow this. D205 removes button borders/backgrounds from those
  toggles and the subsection cycler, and lowers collapsed drag minimum to 44px.
  At `max-width:980px`, the desktop rail state is suspended and the hamburger
  opens a full-label off-canvas navigation drawer (D208). Choosing a
  destination, tapping its backdrop, pressing `Escape`, or returning to a
  wider viewport closes it without changing the saved desktop collapse state.
  Mobile uses one content column, hides desktop-only Staging/History rails,
  keeps the formatting toolbar horizontally scrollable, and uses 16px form
  controls. Layout is width-driven; `pointer:coarse` independently enlarges
  touch targets, including wide tablets. Do not add user-agent/device sniffing.
- **A smart-date field (D151) treats a click differently from a Tab-in
  (D226).** `10-select.js`'s `focus` handler always resets all three
  segments blank (the "tab in and type a whole new date from scratch"
  flow) — a `click` handler right after it re-seeds the segments from the
  field's real value and blanks only the ONE segment the caret landed in,
  so clicking into an existing date to fix one part no longer wipes the
  whole thing. It backs off once anything's been typed this focus session
  (`s.touched`); don't remove that guard or it'll fight an in-progress
  edit. **Only the clicked segment is marked `opened` — the other two keep
  their real value AND stay protected from the next digit that lands in
  them via auto-advance/`/`/Tab, not just from the click itself.**
  `smartDateFeed` clears a segment the first time a digit actually lands in
  it (checking `s.opened[s.cur]`), not eagerly when `cur` arrives there —
  filling day and rolling into year without touching it further leaves
  year alone, but one more keystroke past day correctly restarts year
  fresh instead of appending onto its old digits (found live: typing past
  day turned an intact "2026" into "20265", which then failed length
  validation and silently reverted to the stale year — looked exactly like
  "typing the day took the year away"). Any new segment your code adds to
  this state machine needs the same lazy-clear-on-first-digit treatment,
  not an eager clear when `cur` moves onto it. **Testing this class of bug: `computer.type`'s synthetic text
  insertion bypasses the smart-date keydown handler entirely** (it doesn't
  fire real per-character `keydown` events, so `e.preventDefault()` never
  runs and the browser's native insertion happens instead) — it will look
  exactly like the field silently "not intercepting" even when the real
  keyboard-driven code is correct. Use `computer.key` one keystroke at a
  time to test or reproduce anything in this file.
- **`.loc-suggest` (D42/D148, `locCombo`/`partyCombo`) is ONE shared panel
  parked on `document.body` (`locSuggestPanel()`, `03-drawer-billing.js`,
  D229) — never a per-combo child anymore.** Two reasons, both found live:
  (1) repositioning it via `getBoundingClientRect()` on every keystroke
  forced a synchronous layout flush, genuinely laggy on External Orders'
  1000+-row unwindowed tracker (Nate: "it lags a lot when you start typing
  a broker") — fixed by only repositioning when the panel transitions
  closed→open (or on `focus`, which always passes `force=true`; a
  continued keystroke into the same still-open combo skips it). (2) **any
  explicit CSS `zoom` on an ancestor — including exactly `1` — makes that
  ancestor the containing block for a `position:fixed` descendant AND
  re-scales its offset by the zoom factor again on top of that**, a
  non-standard but reproducible browser quirk; a `.loc-suggest` rendered
  as a `.loccombo` child inside `#main` (every tracker-grid combo) landed
  down-and-right of its input the moment `#main` had zoom applied at all
  (Nate: "the dropdown is like down and off to the right"). Parking the
  ONE panel on `body` sidesteps this entirely — it's never inside a zoomed
  subtree, so position math is always plain, uncompensated
  `getBoundingClientRect()` values. `SUGGEST_INPUT` (`01-core.js`) tracks
  which input the shared panel currently serves, since `handleLocPick`/
  `handlePartyPick` can no longer find it by walking up from the clicked
  option — read `SUGGEST_INPUT`, don't reintroduce
  `opt.closest(".loccombo")`. `.loc-suggest`'s z-index is 330 (above
  `#drawer`'s 301 and `#modal`'s 320) since it no longer inherits
  stacking-above-the-scrim for free from being nested inside the drawer.
  `render()` hides the shared panel at the top of every re-render so it
  can't survive pointing at an input `#main`'s about-to-be-replaced
  innerHTML is going to detach.
- **`locCombo`'s "+Create" opens the real `addLocationModal` fill-out
  form now, not a comma-split name/city/state guess (D228).**
  `addLocationModal(prefillName, target)` takes an optional `{oid, field}`
  — when given, `#modal-save-loc`'s handler (`07-events.js`) also assigns
  the saved location onto that order/field via `/api/order/update` before
  reloading, so confirming the popup finishes the pick in one step. Global
  `MODAL_LOC_TARGET` (`01-core.js`) carries this across the modal's open/
  save round trip; it's read-and-cleared at the top of the save handler,
  so a plain "+ Add Location" from Pick/Drop List's own toolbar (no
  target) still just adds the row with no side effect. Any new caller of
  `addLocationModal` that wants the "also assign this" behavior passes a
  target the same way — don't reintroduce a separate crude create path.
- **`ingestRateCon`'s pickup/delivery extraction now also grows the Pick/
  Drop List, not just the confirm-combo suggestion (D228).**
  `resolveStopToLocationId(stop)` (`03-drawer-billing.js`) matches a
  rate-con-extracted stop against `DB.locations` by exact case-insensitive
  name before creating a new one (so re-ingesting the same shipper/
  consignee never duplicates it), and `ingestRateCon` only writes the
  result onto the order's own `pickup_location_id`/`delivery_location_id`
  when that field is still null — a matched EXISTING order that already
  has real pickup/delivery is never overwritten. This intentionally
  auto-creates the ADDRESS BOOK entry but is still conservative about the
  order's own field, matching the pre-existing "rate cons are noisy, don't
  over-trust them" caution baked into `parseRateCon`'s comments — don't
  widen this to overwrite an already-set pickup/delivery without a new,
  explicit ask.

## Design system

`docs/design.md` is the compact design-token/component reference — same
role for look-and-feel that `WORKTREE.md` plays for file layout. **Read it
before touching `app.css` or adding any new UI**, and update it in the same
change whenever a token, component convention, or protected exception
changes (it's in the "Docs to keep in sync" table at the top of this file
for exactly that reason). A stale design.md is worse than none — the next
agent will trust its token list and its two protected exceptions (the
order-tracker status pill, the header lockup) at face value.

## Open questions for Nate (in `docs/decisions.md`)

1. **Main-sheet write-back** (Supabase → dispatcher sheet as a write-only
   fallback) — decide in Phase 3.
2. **Public broker list** — an unauthenticated CSV endpoint exposes 102 broker
   names + AP emails; his call whether to lock it down.

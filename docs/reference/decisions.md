# Decision Log

Decisions that are not recoverable from the code, with the reasoning behind
them. Newest last. Referenced by the phase plans.

---

> **Archived decisions:** [D1–D124](decisions-archive.md) · [D125–D213](decisions-archive-125-213.md) · [D214–D249](decisions-archive-214-249.md). This file keeps active open items plus the newest five decisions.

## Open — needs Nate

None right now.

### D250 — Dragging a chip onto a text-only Scheduler cell replaces the note, not blocked (2026-09-18)

Nate: "id like there to be the [ability] on the scheduler to drag a load
chip and drop it over a box with text in it and have replace the text,
we don't need any errors or alerts associated with it, if i screw up i
can undo it so make sure the undo works before oyu roll that feature
out. same with reverting via history." The server's own `api_schedule`
already fully supported this — its place-an-order path has always
deleted any `schedule_notes` row at the destination before inserting the
new load (`app/server.py`, pre-existing) — the ONLY blocker was the
client refusing to even attempt the drop. `CELLS[key]` holds either a
real load (`.oid` set) or a plain note (`.text`, no `.oid`); the
dragover/drop gates in `11-toolbar.js` and the touch-drag gate in
`12-touch-boot.js` all treated ANY populated `CELLS[key]` as "occupied,"
and `moveLoad`'s own guard (`08-undo.js`) separately rejected the same
case. New shared `cellHasLoad(key)` (`02-chips-extract.js`) — true only
when `.oid` is set — replaces all four of those checks, so a text-only
cell is now a valid drop target while a real load still blocks it
exactly as before. No new confirm/alert for the replacement itself (the
existing historical-move confirm is unrelated — it fires on the
*origin* date being old, same as it always has).

Undo needed more than `moveLoad`'s existing pair (that only ever puts
the LOAD back where it came from) — `dropLoadOnCell` now captures the
destination's note text *before* the drop (since `CELLS[to]` is about to
be overwritten) and, on undo only, restores it via `scheduleNote` after
the load moves back. Redo needs nothing extra: placing the load forward
again naturally re-deletes the note server-side, same as the original
drop. Deliberately does NOT try to restore fmt/category on undo — the
forward action doesn't preserve those either (same server-side hard
delete a load-over-empty-formatted-cell drop already lived with), so
undo restores exactly what changed, not more.

**Found and fixed a real, pre-existing bug in the History revert engine
while verifying this per Nate's explicit ask** — reverting is a
different code path from client-side undo (D131/D250 both write through
the server, but revert replays the row-level `audit_changes` from
scratch), and it broke on exactly this kind of compound event.
`api_history_revert` (`app/server.py`) applied every change's inverse in
strict reverse-chronological order, which is correct for a simple chain
but not for a single event that both deletes an old loads/load_orders
pair (moving a load off its origin cell) AND inserts a new one (placing
it at the destination) — reverting in strict reverse order tries to
re-insert the old `load_orders` row before the old `loads` row it
references exists again, a real `violates foreign key constraint
"load_orders_load_id_fkey"` 500 (reproduced directly: `curl .../api/
history/revert` → 500, confirmed via `psql` that neither the load nor
the note actually moved despite History showing a "Reverted" event with
zero real changes). This isn't specific to the note-replace feature —
any drag that moves a load from one real cell to another shapes an
event the same way, so this bug was latent before D250 too, just never
exercised via a History revert until this verification pass. Fixed by
splitting the ordered `changes` list into three passes instead of one
reverse-chronological pass: undo every INSERT (a delete) first,
most-recent-first (safe — a row created later in an event is never a
dependency of one created earlier), then undo every DELETE (a
re-insert) in ORIGINAL chronological order (a parent row like `loads`
was captured before its dependent `load_orders` row in every case
checked, so replaying deletes' inverses forward recreates parents
before children), then UPDATEs (order-independent for FK purposes).

Verified live end-to-end, twice (once via direct `curl` against
`/api/history/revert` pre- and post-fix, once through the real UI):
dragged a real chip onto a real text note, confirmed the note was
replaced with no alert; Undo (toolbar button) correctly moved the chip
back AND restored the exact note text; Redo correctly re-placed the
chip and re-cleared the note; History panel's "Revert action" on the
resulting "5 changes" event correctly moved the chip back and restored
the note (confirmed both via the UI, which showed "REVERTED" + a
"Redo" button and the note text back in the grid, and via direct
`psql` — before the fix this 500'd and changed nothing; after, it
correctly reversed the load placement and reinserted the note row).
Cleaned up every test note/chip-position artifact afterward; confirmed
the real order (`8aef7711…`) ended back at its real original cell.

### D251 — External Orders chips: city/state route on its own bold line, load#/order# below it (2026-09-18)

Nate: "on the load chips themselves, this doesnt effect google sheets or
the drivers this is just the dashboard... i want there to be the city ->
city and then there needs to be a new line for the set of numbers...
city to city needs to include state as well, and also be much easier to
see cause city to city is one of the most important things im looking
at as i scan, so make it bold and slightly larger... this is
specifically for external orders btw, bag orders dont have this."
`buildChip`'s external (non-transfer) branch (`02-chips-extract.js`) now
builds `route` ("City, ST → City, ST", state appended only when the
location has one) and `nums` (`broker_load_no / solomon_order_no`)
as separate fields alongside the existing joined `line` (still the full
string, used by the tooltip and Staging's search filter — unchanged
consumers). `chipHtml`'s `metaHtml` gains a third case (alongside
internal's existing 2-line PAL/order# layout and the generic
single-line fallback) for `isExt(o) && !o.is_transfer`: a `.meta-route`
block with the route on its own `.route-line` span, numbers below on the
normal small line — Internal Freight transfers and Bag Orders are
unaffected (transfers have no real pickup/delivery route to show; Bag
Orders keep the existing PAL/order# 2-line layout untouched, per Nate:
"bag orders dont have this").

`.route-line` (`app.css`) is `--fs-body-sm` (12.5px, one step up from
the meta line's `--fs-caption`) at `font-weight:800`, real ink color
(not the muted `--ink-2` the numbers line uses) — "much easier to see."
**Both `min-width:0` and `width:100%` are load-bearing, confirmed live**:
`.meta-2line` is a column flex container, and a flex item without an
explicit width sizes its cross-axis to its own unwrapped content instead
of stretching to the container — without both, a long "City, ST →
City, ST" string silently grew past the chip's right edge (invisible
under the chip's `overflow:hidden`) instead of wrapping to a second
line, which is the exact "getting cut off" problem this whole change
was meant to fix. Confirmed via `getComputedStyle` before and after: the
span's own `width` was stuck at its unwrapped content width (162px) with
only `min-width:0` applied, and only dropped to the container's real
available width (125px, `scrollHeight` correctly doubling) once
`width:100%` was added too.

Verified live: search-jumped to a real scheduled external order with a
real pickup/delivery, confirmed the drawer's chip preview AND the real
Scheduler chip both render "Eugene, OR → Culver, OR" on its own bold
line, wrapping cleanly to two lines with no clipping, with "36 195260 05
/ 12-0926-0050" on its own line below at the normal size. Console clean.

### D252 — Zoom no longer scales each page's own toolbar header (2026-09-18)

Nate: "zoom shouldnt change the header below the tool bar, like where
current week days shown, etc are. that bar doesn't change with zoom only
the app itself." `applyZoom()` (`11-toolbar.js`) sets CSS `zoom` on
`#main` as a whole, but every page's own toolbar (Current Week's "Days
shown" stepper, Scheduler's home-base bar, every order tracker's
toolbar, etc.) lives inside `#main` too — D171's `toolbarHtml()` always
emits the shared `.toolbar` class, so it was scaling right along with
the grid/table content Nate actually wants zoom to affect.

Fixed with a nested inverse zoom rather than restructuring where zoom
applies: `applyZoom()` now also sets a `--zoom` CSS custom property on
`<html>`, and a new rule, `#main .toolbar{zoom:calc(1 / var(--zoom,
1))}`, cancels `#main`'s zoom back out for exactly that element — `zoom`
isn't a real inherited property, so a descendant's own `zoom` value
multiplies against its ancestor's rather than replacing it, letting the
toolbar render at true 1:1 scale while its sibling `.grid-wrap` content
still scales normally.

Verified live at 150% zoom on both Current Week and Scheduler: toolbar
`getBoundingClientRect()` width/height matched the 100%-zoom values
exactly (computed `zoom` on the toolbar read back as `0.666667` = 1/1.5,
correctly canceling), while the grid header row height and truck-name
text visibly grew. No layout glitches on Scheduler's `.home-base-bar`
left accent rail at the counter-zoomed scale.

### D253 — Font selector widened to close the gap before the font-size stepper (2026-09-18)

Nate: "the font selector if you screenshot and look theres a gap
between it and the size selector if you could make that gap smaller by
increasing the width of the font selector." Root cause: `.fb-fs` (the
font-size stepper) is pinned at a hardcoded `position:absolute;
left:600px` from `.fmtbar`'s own edge (D241, so it lines up pixel-for-
pixel with Current Week's identical stepper) — since every element
before `.fb-font` in the toolbar is a fixed-width icon/button/select,
`.fb-font`'s own right edge sits at a constant offset from that same
edge regardless of window width, and the 600px mark just happened to
land a consistent ~54px past it. Confirmed the gap doesn't vary with
viewport width once past the mobile breakpoint (measured identical 54.5px
at both 1400px and 1600px) — a genuinely fixed gap, not a responsive
symptom. `.fb-font{min-width:110px}` → `min-width:154px` closes it to
~10px without touching the 600px constant D241 depends on (that
alignment was re-verified unaffected: `.fmtbar .fb-fs` and `.cw-daysshown
.fb-fs` both still land at the same screen X).

Verified live via `getBoundingClientRect()` before/after: gap dropped
from 54.5px to 10.5px on the main toolbar; Current Week's days-shown
stepper still lines up exactly with the main toolbar's font-size
stepper (both `left:696` at a 1600px test width).

### D254 — Move a schedule note by dragging the selection's border (2026-09-18)

Nate: "on those text notes id like to be able to move them if i c[l]ick
and drag from the borders of the selection but leave the drag and fill
dot on there and functionality alone." New pointer-based drag in
`10-select.js`, modeled directly on the existing fill-handle drag (D118)
— same shape (source/target/auto-scroll-timer state, `edgeAutoScroll`
reused as-is), registered as its own `pointerdown`/`pointermove`/
`pointerup` set. Scoped narrowly: only fires when the pointerdown lands
within `NOTE_BORDER_PX` (6px) of an edge of the cell the **selection is
already on** (mirrors the fill handle's own "already selected" rule) and
that cell holds a plain text note (`CELLS[key].text`, no `.oid`) — a
click anywhere else, or near a different cell's border, is unaffected
normal marquee/selection. `noteDragSourceTd`'s check runs and, if it
matches, calls `stopImmediatePropagation()` so the pre-existing
`selStart` listener (registered right after it, same `document` target)
never also processes that pointerdown — plain `stopPropagation()`
wouldn't have been enough since both listeners sit on the same element.

Moves text only, not fmt/category — same scope call D250 made for
dropping a chip onto a note: the destination keeps whatever fmt it
already had (the existing `scheduleNote` upsert only ever touches
`body`), and the source clears via the exact same `scheduleNote(key,"")`
call D82's "clearing keeps fmt" behavior already uses everywhere else,
so nothing new needed server-side. Dropping onto a cell that holds a
real load is refused (reuses `cellHasLoad`, D250) — this is a note move,
not a way to clobber a scheduled load. Undo bundles the two writes
(clear destination, restore source) into one `histPush` entry, same
pattern as D250's note-restore-on-undo.

Verified live (both by me and by Nate testing it independently in his
own browser): created a note, dragged from its right edge onto an
adjacent empty cell — text moved, source cleared, no alert. Undo
restored it to the original cell. Nate: "it seems to have worked" / "i
tested it too and it worked" / "undo works you can commit." Known,
accepted trade-off: double-clicking exactly within the 6px border band
of an already-selected note (rather than its center) starts a border-
drag instead of opening the cell for text editing — a narrow target,
not expected to come up in practice, not worth the extra complexity of
distinguishing a click from a drag-start at pointerdown time.

### D255 — Housekeeping sweep: archived the decision log, removed confirmed dead code (2026-09-19)

Nate: "clean up the decision tree, use agents to sweep the codebase for
dead code and errors and clean the app up." Two parts:

**Decision log.** `decisions.md` had grown to 40 decisions (D214–D254)
instead of its own stated "newest five plus open items" — split
D214–D249 into `decisions-archive-214-249.md`, same format as the
existing D1–D124/D125–D213 archives, content verified byte-identical
before/after the split (nothing edited, just relocated). Updated the
archive-links line. `WORKTREE.md`'s own reference to archive files is
already a glob (`docs/decisions-archive*.md`) so it needed no change.

**Dead code.** Two background agents (client JS/CSS; server Python +
scripts) independently swept the codebase — both instructed to report
only, explicitly told to ignore `legacy/` (deliberately kept read-only
historical reference) and `scripts/*.py` files' mere existence (one-off,
run-by-hand scripts are expected to have no importers). Every finding
was independently re-verified by hand (grep across all of `app/web/js/*.js`
+ `index.html`, or `app/*.py` + `scripts/*.py`) before touching anything —
this is a live production app, so a false-positive deletion is a real
cost. Confirmed and removed:

- `fmtLocation` (`04-views.js`), `accentPresetName`/`isActiveOrder`
  (`05-settings-nav-search.js`) — defined, zero call sites anywhere.
  (`isActiveOrder` was already independently spotted as dead scaffolding
  during D249's work this session — same finding, now acted on.)
- An entire stale "legend editor" CSS cluster (`.legend`, `.legend-h`,
  `.legend-grid`, `.legrow`, `.legname`(`:focus`), `.legoff`, `.legdel`,
  `.condfmt-pop` + its `.cf-h`/`.cf-sub`/nested `.legend-grid`) —
  predates the current conditional-formatting rewrite
  (`condFmtFieldModal`/`condRuleRowHtml`, `06-modals-grids.js`), which
  emits entirely different classes. `.legcolor` was the one survivor
  still genuinely in use (the rule-row color swatch input) — kept, moved
  to sit next to `.colmgr-row` where it's actually used instead of under
  the deleted "Designation legend (D72)" heading.
  `.colmenu`/`.fb-size`(only ever paired with the still-live
  `.fb-zoomsel`)/`.rail-ft` — no matching markup anywhere.
- `GoogleSheetsSync.list_tabs()`/`.sheet_id()` (`app/adapters.py`) —
  both superseded by `tab_props()` (D112, one call instead of a
  round-trip per driver) and never called again after that rework.
  `_driver_week_payload`'s dead `"tab_label"` field (`server.py`) — the
  real push-driver-tabs flow builds its own tab-title string separately
  and never reads this precomputed one.
- No dead `api_xxx` handlers, no dead routes, no unused imports (cross-
  checked with `pyflakes` too), no unreachable code, no bare `except:`,
  no SQL placeholder/param-count mismatches, no TODO/FIXME markers, no
  orphaned files, in either sweep. Consistent with the project's existing
  no-over-engineering discipline — there just wasn't much to find.

Not touched (flagged by an agent but not real findings): `.section-tab`
and friends — CSS already has an explicit comment saying these are
deliberately kept-but-hidden since the D200–202 sidebar rewrite, not new
dead code. A CLAUDE.md/D230 "staleness" the server-sweep flagged turned
out to already be correct (updated in this same session's own D245 work)
— no action needed, false alarm on the agent's part.

Verified live after each round of edits: syntax-checked every touched
file, restarted the server for the Python changes, confirmed the
conditional-formatting popup (the main consumer of the CSS classes
touched) still renders and behaves identically, confirmed
`/api/sheets/push-driver-tabs`'s dry-run still returns 200 with the
expected shape post-`tab_label` removal, and confirmed a genuinely fresh
browser tab shows zero console errors (an earlier tab's console buffer
turned out to be carrying stale errors from unrelated debugging several
turns back — cross-checked, not a regression).

### D256 — Database and Billing get the same real-toolbar/fill-the-space header system as the rest of the app (2026-09-19)

Nate, answering the open zoom question: "they dont need to [scale] but we
do need to create this header system for the database and billing
sections to match the app." (Resolves D136's open question — the drawer/
modals staying excluded from zoom is correct as-is, no change needed.)

Database and Billing were the last two sections still on the older half
of `render()`'s mounting split (see the CLAUDE.md bullet on this) — wrapped
in a `.pad` div with a `plain:true` borderless toolbar, the whole thing
scrolling as one inset block. Moved both to the same direct-`#main`-mount
pattern D237 already gave Scheduler/Current Week/Driver Tabs/the three
Orders trackers: `toolbarHtml()` without `plain`, so the toolbar gets a
real sticky background/border instead of a borderless heading row, and
`.grid-wrap{flex:1;overflow:auto}` (already generic) fills all remaining
height edge-to-edge instead of sitting inset.

**Database**: `vBuiltin()` already ended its output in a `.grid-wrap`
around the table — just dropped `plain:true`. This retires D93's
`.pad.grid-pad` hack outright rather than special-casing it further: that
hack was hand-rolling the identical flex-fill-and-scroll behavior with
`padding:10px 14px` layered on top, and the generic mechanism does the
same job with no Database-specific CSS needed at all.

**Billing**: `vBilling()` has several stacked sections (drop zones,
unmatched-documents table, invoice pool, billing queue table), not one
single grid — wrapped the whole thing (everything after the toolbar) in
ONE outer `.grid-wrap` so it all keeps scrolling together as a single
region below the now-fixed toolbar, same as it did inside the old `.pad`.
The two narrower `.grid-wrap`s already nested inside it (the unmatched-
docs table's horizontal-scroll wrapper, the queue table's own) aren't
flex items of anything in this new outer wrapper (it isn't
`display:flex`), so they're unaffected — still horizontal-scroll-only,
exactly as before.

`render()`'s dispatcher: `SUB === "bill"` and `SEC === "database"` moved
into the same branch as `cw`/`driver`/`int`/`xfer`/`ext`; the remaining
`.pad`-wrapping branch now only ever handles `SUB === "rep"` (Reports) and
`SEC === "settings"` — nobody asked for those to change, left alone.

Verified live: Bagger Customers (274 real rows), Fleet, External
Customers (real production data, confirmed the D222-session alphabetical
sort and archived count both intact) all render with the new sticky
real-background toolbar and fill available height correctly —
`document.documentElement.scrollHeight` matches `innerHeight` exactly
while scrolling, confirming D93's original "outer page expands to
~7,100px" bug has not resurfaced. Billing renders the same way (drop
zones, empty-state unmatched/queue sections — no unbilled orders in the
current data to check a populated queue's scroll, but it's the identical
proven `.grid-wrap` mechanism already load-bearing everywhere else).
Reports and Settings screenshot-confirmed unchanged. Console clean.

### D257 — Retired the app's own dependency on the public broker-sheet CSV export (2026-09-21)

Resolves the "public broker list" open question above. Nate: "do 2" — stop
depending on the unauthenticated `gviz/tq?tqx=out:csv` export so the sheet's
link-sharing can eventually be locked down without breaking anything the app
still needs, rather than trying to route broker names through Postgres
instead (`add_new_brokers.py`'s whole job is diffing the live sheet against
Postgres `parties` to find new entries, so it still has to read the sheet —
the fix is the auth mechanism, not the data source).

`scripts/add_new_brokers.py` and `scripts/import_pickdrop_list.py` were the
only in-app code left depending on that public export (grep confirmed —
`reconcile_external_orders.py` only mentions it in a comment). Both switched
to `GoogleSheetsSync.read_range` (`app/adapters.py`), the same
service-account creds path `import_outside_customers.py` already used.
Re-verified live: `add_new_brokers.py` correctly read 117 rows via the API
(1 new broker found, not committed — out of scope for this change);
`import_pickdrop_list.py` correctly read 938 rows (confirmed already
migrated from its original one-time run, not re-run).

**Found and fixed a real bug surfaced by this:** `GoogleSheetsSync.read_range`/
`write_range` quoted the A1 range with `urllib.parse.quote`'s default
`safe="/"`, so a tab name containing a literal `/` ("Pick/Drop List") left
that slash un-escaped and split the request URL into the wrong path
segments — a generic Google Drive "Page Not Found" 400 HTML page, not a
real Sheets API error, which looked like a permissions problem until the
raw response was inspected. Fixed by quoting with `safe=""` instead. No
other current caller (`push-driver-tabs`, Current Week's push, the other
import scripts) passes a `/` in a range, so this only adds escaping — it
doesn't change any existing call's resulting URL.

`legacy/invoicing-local/index.html`'s own `BROKER_SHEET_URL` fetch is
untouched — legacy is reference-only, off-limits to edit — and isn't served
by `server.py` (grep confirmed zero references), so it's not a live
exposure through the app itself. It would still hit the public export if
Nate ever opens that file directly. **One remaining step is Nate's, not
code's:** once he's confirmed he's not still opening that legacy file for
anything, flip the dispatcher sheet's (1KlPQ…) share setting from "Anyone
with the link" to restricted — that's a Google Sheets permission, not
something this repo can change, and it's the actual thing that makes the
CSV endpoint unauthenticated in the first place. Nothing left in the
codebase needs that public access once he does.

### D258 — Time card calculator rebuilt redcort-style; a Motive auto-fill was built, then deliberately pulled (2026-09-21)

Nate pointed at redcort.com's free timecard calculator as the model: "blank
the first one is am second one is pm but u can switch it but thats the
default... make it easy to type into like itll accept single digits and
convert it, like if its single digits in minutes it goes to 08 for example
but in hours it just accepts it as the hour time since its non miltary
converting to miltary." Confirmed redcort's actual behavior live before
building (its hour/minute fields are two plain text inputs per time, not a
native `<input type="time">`, plus a separate AM/PM toggle — a real digit
typed into the hour box stays as typed, the minute box zero-pads to 2
digits only once you tab out).

Rebuilt on that model in `05-settings-nav-search.js`: `timeFieldHtml`
renders `.tc-hh`/`.tc-mm` text inputs (`inputmode="numeric"`, `maxlength=2`)
plus a `.tc-ampm` toggle button per time, replacing the old native
`<input type="time">` pair. `tcSanitizeDigits` strips non-digits on input;
`tcClampHour`/`tcClampMinute` clamp to 1-12/0-59 on blur, and only the
minute clamp zero-pads (`tcPadMinute`) — the hour field deliberately never
gets a leading zero, matching Nate's explicit ask. `tcMinutesOf` reads a
field's minutes-since-midnight for the total-hours calc, keyed off the
AM/PM button's own text rather than a stored flag. Start defaults AM, End
defaults PM, both independently click-to-toggle (`[data-tc-ampm]` in
`07-events.js`) — same default redcort uses. Verified live: typed digits
behave exactly like the reference page (a bare "8" stays "8" in the hour
box, a bare "5" becomes "05" in the minute box on blur, out-of-range values
clamp), AM/PM toggling recomputes the total, and the existing overnight-
wrap note still fires correctly.

Nate also asked, mid-request, for a Motive lookup on the same page: a date
+ truck/driver picker that pulls odometer start/end and the driver's
on-duty/driving window for that day, "when i run the function." Built and
verified live end-to-end — a new `MotiveClient.day_detail(date)`
(`app/adapters.py`) reading the same `/v1/logs` endpoint `daily_miles`
already uses (no driver/vehicle filter param exists on that endpoint,
confirmed against the real API, so filtering happened server-side), a new
read-only `/api/motive/day-detail` (`app/server.py`, doesn't touch
`motive_synced_at`/`motive_miles` — a one-off lookup, not the sync
pipeline), and a "Look up from Motive" section with Fill-start/Fill-end
buttons wired to it. Along the way, `.env` got Motive's `DEPT12_MOTIVE`/
`DEPT12_MOTIVE_CREDS` added (previously unset — `MOTIVE.available` was
false in a plain local run), same on-by-default pattern D163 gave Sheets,
so the lookup and the existing Sync Mileage button both worked without
exporting env vars by hand. Confirmed live against real data (truck 31,
driver Wayne, 2026-09-16): matched "Wayne Johnson" correctly even though
`drivers.full_name` is stored first-name-only in this app's real data
("Wayne") — the match checks Motive's `driver_first_name` alone first, a
detail that would silently break a naive "first + last" match.

**Nate then explicitly reversed the Motive piece after seeing it work:**
"im stopping you cause i think we should get rid of the motive thing in
the time card i changed my mind on that cause i should manually find it if
i need to find their time cards, and also if im training someone on this
job i do not want them to rely on that for driver pay just a bad deal." A
deliberate call about driver pay, not a bug report — everything Motive-
specific was removed: `api_motive_day_detail` and its route, `day_detail`
off both `MotiveAdapter`/`MotiveClient`, the "Look up from Motive" UI
section, `motiveDayDetailHtml`/`tcSetFieldFromDate`, the `[data-tc-run]`/
`[data-tc-fill-start]`/`[data-tc-fill-end]` handlers, and the `.env`
addition (reverted to unset, its prior state). The redcort-style hour/
minute/AM-PM rebuild above stays — that part was never in question. Don't
reintroduce an automated Motive-driven fill for this calculator; a
dispatcher (or someone training on this job) looking up a driver's actual
hours for pay should do it by hand, on purpose, every time.

### D259 — Bug hunt: right-click menus not closing, Admin Access rows auto-collapsing (2026-09-21)

Nate: "can you test the dashboard for bugs, right click bugs, things not
disappearing just do a bunch of bug tests. i want to make sure it works
as intended try features we havent used or built upon in a long time make
sure they work as intended." Worked through the app live (Scheduler
right-click menus, day notes, route editor, numbered-gutter select/
delete, custom database create/delete, conditional formatting, Fleet's
color picker, global search, the History panel, Admin Access) — two real
bugs found and fixed, everything else checked out working as designed
(including several false alarms chased down and ruled out: "? → ?" on
older chip routes is the correct unresolved-location placeholder per
D251/D220, not a bug; a garbled-looking conditional-formatting popup
screenshot was just a mid-fade-in capture, confirmed clean a moment
later; `computer.key`'s "Escape" is the same synthetic-key tooling gap
D226 already documented for "Enter" — dispatching a real `KeyboardEvent`
confirmed the app's Escape handling was correct all along).

**Bug 1 — `#ctxmenu`/`#palette` didn't close when clicking a Scheduler
cell.** Right-click a cell to open the context menu (or open the fill/
text-color palette), then click a different cell — the menu/palette
stayed on screen while the cell selection moved underneath it. Root
cause: the dismiss-on-outside-click listener (`09-color.js`) was bound to
`mousedown`, but `selStart`'s `pointerdown.preventDefault()` (D83)
suppresses the browser's compatibility `mousedown` event for any ordinary
cell click — so the listener simply never ran for the single most common
case (clicking another cell). Confirmed with a live repro (menu stayed
open, a capture-phase test listener showed zero `mousedown` events
reaching `document` for that click) before touching anything. Fixed by
switching the listener to `pointerdown`, which always fires regardless of
what a later handler does with `preventDefault()`; registering in
`09-color.js` (alphabetically before `10-select.js`) still runs it ahead
of `selStart`, same ordering trick D254's note-border-drag already uses.
Confirmed clicking a non-grid area (the Staging panel) always worked —
only the grid-cell case was broken, which is exactly what pointed at
`selStart`.

**Bug 2 — Settings → Access rows collapsed after every single grant
toggle.** Expand a restricted user's permission grid, check one View/Edit
box, and the `<details class="admin-row">` panel snapped shut —
confirmed live granting Test3 permissions one at a time. Root cause: both
grant checkboxes' change handlers (`07-events.js`) set `ADMIN_ROSTER =
null` and call `render()` to refresh the summary counts, which rebuilds
`settingsAdmin()`'s `<details>` markup from scratch with no `open`
attribute — every toggle silently re-closed the row an admin was actively
working in. Fixed with the same in-memory open-state-tracking pattern
`HISTORY_OPEN_DAYS`/`TRACKER_COLLAPSED_OPEN` already use elsewhere: a new
`ADMIN_OPEN` object (`05-settings-nav-search.js`) read when rendering the
`open` attribute, kept in sync by a capture-phase `toggle` event listener
(`07-events.js` — `toggle` doesn't bubble, same reason `blur` listeners in
that file are capture-phase) so manually collapsing a row via `<summary>`
also survives the next unrelated re-render, not just the grant-triggered
one. Verified live: granted and revoked three permissions on Test3 in a
row with the panel staying open throughout, then restored Test3 back to
its real original state (0 view/0 edit) since it's live account data, not
a throwaway.

Also created and fully cleaned up test fixtures along the way (a blank
External order — route-edited, then deleted via the guarded numbered-
gutter delete; a custom "QA Test DB" database — created, then deleted via
its own right-click menu) — verified via direct `psql` queries that
neither left anything behind, not just via the UI's own post-action view.

### D260 — Bug hunt continued: Billing checkbox threw on every click; a report export could silently download an empty file (2026-09-21)

Nate: "keep testing, check billing and reports too." Billing needed a
real test order to exercise (the live queue was genuinely empty — 0
unbilled external orders — not a bug, verified via `psql`), so one was
created, route-edited, given two synthetic PDF attachments via a real
dispatched `drop` `DragEvent` (not a mock — this exercises the actual
`#dw-drop`/`#file-doc` ingestion path), taken through Mark Complete, and
afterward fully removed (order + `documents` rows + `app/storage/`
files) via direct `psql`/`rm`, since a billed order is correctly locked
against the UI's own guarded delete.

**Bug 1 — Billing queue checkbox threw on every click.** Checking a row's
checkbox threw an uncaught `TypeError: Cannot set properties of null
(setting 'textContent')` every time, and as a direct result "Download
Selected (N)" never updated its displayed count (stuck at "(0)" no
matter how many rows were checked, though the underlying selection was
tracked correctly — Download/Draft/Mark Done still acted on the right
rows). Root cause: the shared `data-group` checkbox handler
(`07-events.js`) unconditionally wrote `$("#group-btn").textContent =
...` — `#group-btn` is a Database-only row-merge button that doesn't
exist on the Billing page, so the lookup returned `null` and the
assignment threw, aborting the handler before anything Billing-specific
could run. Fixed by guarding the `#group-btn` lookup and adding the
missing counterpart: `#bill-dl-sel`'s own text now updates the same way.
Verified live: checking/unchecking a Billing row updates "Download
Selected (N)" immediately with a clean console, checked via a genuinely
fresh tab (not the stale-console-buffer tab) to be sure.

**Bug 2 — a report export with no matching rows silently saved an empty
file while still claiming success.** Testing Internal Freight Transfer
with both date fields left blank downloaded a real, genuinely 0-byte
`dept12_freight.csv` (not even a header row) while still toasting
"Exported dept12_freight.csv" — indistinguishable from a working export
short of opening the file. Root cause: `_csv()` (`app/server.py`)
returns a bare `""` when the query matches zero rows (no header, since
headers come from the first row's own keys), and the client
(`07-events.js`) always saved-and-toasted whatever `j.csv` came back,
never checking whether it was empty. Fixed by checking `!j.csv` first
and toasting "No data for that range" instead of writing/announcing an
empty file. The other 5 reports (entire-app dump, mileage, Bagger
Customers, External/freight customers, Fleet) all returned real,
non-empty CSVs, including the two of those that also take a date range
(mileage, entire-app dump) — their queries just don't exclude everything
the way freight transfer's did on this dataset with no range given.

**Also, mid-session:** clicking "Export CSV" is a real browser download
on Nate's own machine, not a sandboxed action — each test click saved a
`dept12_*.csv` file to his actual Downloads folder. Nate flagged it;
told he was fine leaving them, only the misleading empty
`dept12_freight.csv` was removed (the artifact of Bug 2, not a real
export). Worth remembering for any future live-testing pass: report/
export buttons aren't side-effect-free to click repeatedly the way a
toast-only action is.

### D261 — Bug hunt continued: copying a Bag Order made it vanish from its own tracker (2026-09-21)

Nate: "i uncovered a bug, i added a drivers name to the fleet and ended up
gliutching an unfinished order in the order counter." Live reproduction
of the Fleet-driver-assignment angle specifically came up empty —
`/api/truck/driver` only ever touches `driver_truck_assignments`, never
`orders`/`loads`, and two direct repro attempts (a brand-new driver name,
and moving an existing driver to a different truck) left every nav badge
unchanged. Nate confirmed separately he could no longer reproduce it
("i guess it went away now that im looking at it"), so that specific
trigger is unconfirmed and not chased further — but the symptom he
described ("an unfinished order" miscounting "in the order counter") is
exactly what turned up independently while continuing the bug-hunt pass
through Bag Orders: copying a Delivered row.

**Bug found:** a freshly copied Bag Order (via the tracker's own Copy
button, D30) immediately disappeared from view — not just visually
collapsed, genuinely unreachable from the tracker — while still counting
toward the Bag Orders nav badge. Root cause: `api_copy_order` deliberately
leaves a copy's `order_period`/`solomon_order_no` blank (unique-per-load
fields a copy shouldn't inherit), so `orderYearCode(o)` (`01-core.js`)
returns null for it. `vInternal`'s row filter and
`resortInternalTrackerRow` (`04-views.js`) both compared this directly —
`orderYearCode(o) === yy` — which is false for null against any year,
silently excluding the row from the currently-selected year (and every
other year) until it got a real order number. `externalOrderInYear`
already had the right shape for this exact situation (a row with no date/
number yet should show regardless of the selected year); added the same
null-safe wrapper for Bag Orders, `internalOrderInYear(o, yy)` — `!code ||
code === yy` — and pointed both call sites at it.

Verified live: copied a real Delivered row, confirmed the copy showed up
correctly as a STAGING row, then switched the Year picker to 2025 (a year
with no relationship to the copy) and confirmed it stayed visible there
too — before the fix this is exactly the moment it would have vanished.
Cleaned up the test copy afterward (confirmed removed via `psql`).

**Full test-data cleanup for this whole bug-hunt session, confirmed via
`psql` against every table touched, not just the UI's own after-action
view:** the Fleet driver reassignments from the (unconfirmed) repro
attempt were reverted — truck 31 back to Wayne, trucks 80/135 back to
unassigned, the synthetic "TestDriverQA" driver row deleted, and Wayne's
`driver_truck_assignments` history on truck 31 specifically restored to
one continuous stint (2026-08-14–present) instead of the two-stint
artifact the reassignment-and-back sequence would otherwise have left in
real history. Every other test order/document/custom-database/permission
grant created across this session's earlier rounds (D259, D260) was
already confirmed removed. Theme was switched to Dark to check contrast
and switched back to Light; the Shortcuts page's Focus-search key was
recorded to F4 to confirm Record/apply works, then Reset back to F3.

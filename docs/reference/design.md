# DESIGN

Compact design-system reference. Read this before touching `app.css` or
adding any new UI — same spirit as `WORKTREE.md` for file layout, but for
look and feel. Detailed rules and traps live in `CLAUDE.md`; the reasoning
behind every choice here (including what was tried and rejected) lives in
[`decisions-archive-125-213.md`](decisions-archive-125-213.md), D172 and its
predecessors D160–D171.

## Philosophy

Order trackers open directly from the toolbar into their grids. Avoid
standalone record-count banners and routine explanatory subtitles; reserve
notices for missing information, actionable exceptions, and useful empty states.

Dense, spreadsheet-native tool, not a marketing-adjacent product — 13px body
copy, tabular-numeral data, sticky headers, cell-level editing. Warm,
paper-toned palette (`--paper`/`--panel`/`--sunk`) rather than the
blue-on-white or slate-on-white most internal tools default to. Every font is
a system stack — no webfonts, by design (offline-safe, works inside a
locked-down CSP, D24 dependency-free). Genuinely personalizable: light/dark
surfaces, a guarded full-spectrum accent, and 27 system font choices are all
live-switchable from Settings. Comfortable spacing is the fixed baseline;
Scheduler row/column dimensions remain directly adjustable. Every rule below
has to keep working regardless of the chosen theme, accent, or font.

## Color tokens

Declared once in `app.css`'s bare `:root{}` (theme-invariant: type scale,
radius scale, and elevation don't change between light/dark) plus three
theme blocks (`@media prefers-color-scheme:dark`, `[data-theme="dark"]`,
`[data-theme="light"]`) that redefine the theme-dependent ones.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#F0EDE6` | `#16181A` | page ground |
| `--panel` | `#FAF8F4` | `#1D2022` | cards, toolbars |
| `--panel-2` | `#E7E3DA` | `#25282B` | headers, tab bar |
| `--sunk` | `#E2DED4` | `#111314` | recessed wells |
| `--ink` / `--ink-2` / `--ink-3` | dark→light grays | light→dark grays | primary / secondary / caption text |
| `--rule` / `--rule-2` | translucent ink | translucent paper | hairlines / stronger borders |
| `--brand` / `--brand-soft` | `#E2510B` (declared default) | `#FF6B24` | **the one personalizable accent** — see below |
| `--brand-ink` | calculated black or white | calculated black or white | readable text/icons on the chosen accent |
| `--focus` / `--focus-soft` | `var(--brand)` | `var(--brand)` | accent-linked selection/focus/drag-target |
| `--billed` | `#6B4FA8` | `#9F7FCC` | `.pill.billed` only |
| `--good` / `--warn` / `--bad` | green/amber/red | brighter variants | delivered / mid-state / error, cancel |

**`--brand` isn't what a fresh session actually shows.** `PREFS.accent`
(`01-core.js`) defaults to Forest green `#3F7D3A` (D125), not the CSS file's
declared `#E2510B`. `--good`'s value is *also* `#3F7D3A` — the shipped accent
and the "delivered" status color are the same hex, not just the same family.
That's real, not a rounding coincidence. `--billed` remains separate because
it communicates lifecycle meaning. `--focus`/`--focus-soft` remain separate
role names for selection CSS, but resolve to `--brand`/`--brand-soft` so
interaction feedback follows the user's chosen accent (D213). `--brand-ink`
is recalculated as black or white for the selected color; do not hardcode white
inside accent-filled controls (D216).

**Rule of thumb:** `--brand` = "click this / this is the current section /
this toggle is on" (primary buttons, active nav underline, links,
`.btn.active`, `.fb.on`/`.font-opt.on`/`.bord-sty.on` toggle states).
`--focus` = "you're interacting with this specific target right now" (every
`:focus` ring, multi-cell/row/column selection, drag-over, drop-zone hover,
the live cell editor border, and Scheduler Today marker). It aliases the
accent but keeps a separate role name so component intent stays clear. Use
`--focus`, not `--brand`, when authoring selection CSS; never use either one
for billed or lifecycle status.

Text filters that already have a visible field border, including the global
Search and staging rail's Filter Staged Loads inputs, replace the default
outer outline with `border-color: var(--focus)` while focused. This keeps the
typing state contained on the field edge and consistent across both themes.

## Type scale

8 steps, `app.css`'s bare `:root{}`. Each step's value is whichever size
already had the most call sites in its cluster when D172 collapsed 17 ad hoc
sizes down to these — a rename + merge, not a new design.

| Token | Size | Typical use |
|---|---|---|
| `--fs-caption` | 10px | chip meta, uppercase field labels |
| `--fs-label` | 11px | table cells, small buttons |
| `--fs-body-sm` | 12.5px | default button text, section tabs |
| `--fs-body` | 13px | base body size |
| `--fs-body-lg` | 15px | drawer/modal headings |
| `--fs-h3` | 16px | card headings |
| `--fs-h2` | 19px | rare, larger headings |
| `--fs-h1` | 23px | largest heading in the app |

**One literal-px exception, on purpose, not an oversight:**

- `.brand-copy b` / `.brand-copy span` — the header lockup ("Dept 12" /
  "Flatbed Trucking" next to the Rexius logo). Nate: leave it exactly as it
  reads today. Not a fit issue, a direct instruction — don't resize it as a
  side effect of a global sweep.

All static app chrome and generated explanatory copy use these tokens. Dynamic
per-cell formatting may still emit a user-selected pixel size, and font-picker
previews intentionally set their own family. The normal UI otherwise has two
deliberate families: `--font` for readable interface copy and `--mono` for
numbers, compact labels, counts, and statuses.

## Radius scale

3 steps, same file/location.

| Token | Size | Use |
|---|---|---|
| `--r-sm` | 3px | inputs, buttons, chips, cells |
| `--r-md` | 6px | cards, dropdowns, toolbars |
| `--r-lg` | 10px | modals, big popovers, avatars |

`border-radius:50%` (circular avatars/swatches/dots) and the one deliberate
`border-radius:0` (a nested icon button that should read as square) are
untouched — they were never part of the px-based scale.

## Elevation

2 reusable tokens for floating UI that doesn't have a required shadow
direction:

| Token | Value | Use |
|---|---|---|
| `--e1` | `0 1px 2px rgba(0,0,0,.08)` | subtle — the Rexius logo box's own depth |
| `--e2` | `0 8px 28px rgba(0,0,0,.28)` | floating — menus, dropdowns, popovers |

The three heavy overlay shadows — `.modal-card`, `#drawer`, `#navmenu` —
stay their own literal declarations on purpose: each needs a different
offset direction (down for a centered modal, left for a right-sliding
drawer, right for a left-sliding nav), so one shared value can't serve all
three. Conceptually still "the e3 tier," just not shareable as a single CSS
custom property. `.loc-suggest`'s lighter shadow and `.touch-ghost`'s drag
shadow are deliberately their own weight too, not omissions.

## Motion

One shared rule: `.btn,.hbtn,.pill,.chip,.sub-tab,.section-tab,.swatch,
td.rowgut,.nm-item,.nm-dbentry,.nav-cycle{transition:background-color,border-color,color,box-shadow
.15s ease-out}`. Applied only to toggle/hover chrome — **deliberately not**
to the selection-ring family (`td.sel`, `td.over`, `tr.rowsel`, the marquee,
fill-handle, copy-marquee ants). Those repaint per-cell during a fast
drag-select; an eased transition there would make multi-cell selection feel
smeared instead of instant. `@media(prefers-reduced-motion:reduce){*{
transition:none!important;animation:none!important}}` already zeroes
everything app-wide — new motion doesn't need its own reduced-motion guard,
that rule already covers it.

## Navigation

`#sidenav` is a persistent, user-resizable grid column. Its shell continues
through `.nav-head` above the page body: that top cell contains the hamburger,
while the brand/search/profile header begins at the sidebar's right edge. The
header, formatting toolbar, and main content therefore share one left boundary.
Expanded mode shows
section labels and their destinations; collapsed mode shows every section icon
with at most one under-icon accordion open. The nav-header hamburger is the only
control that changes between those modes, and each mode keeps its own saved
width. Expanded mode is draggable from 160–360px; collapsed mode defaults to
96px but can be dragged from 44–200px so its plain cycler can sit close to the
left edge.

In the collapsed rail, the section icon and its vertical disclosure arrow are
separate targets. The icon navigates immediately to that section's current
visible destination (or its first permitted destination when entering it); the
plain `↓`/`↑` arrow only shows or hides the subsection list. This lets the icon
act like navigation while the arrow remains a true dropdown control.

Only the collapsed Orders icon carries a count badge. It is the sum of the
visible order destinations' unplaced counts, uses the existing `.ct` badge, and
is hidden at zero. Do not show a separate all-active total: the icon count must
always reconcile with the counts revealed by its accordion.

In collapsed mode, the empty `.fmtbar-navspacer` below the hamburger becomes a
plain `<` / `>` subsection cycler. Its 16px glyphs have no border, fill, or
button treatment. It wraps through the current section's
visible destinations, names the next target in each tooltip, and disables both
buttons for a section with fewer than two destinations. The spacer's collapsed
`::after` divider uses the same 1px `--rule-2` treatment and visual side inset as
`.nm-section-div` above Database, so the compact rail has one consistent
separator language.

The order is **Dispatch → Orders → Billing → Reports**, followed by a soft
`.nm-section-div` and one **Database** entry. Database is intentionally not an
accordion or a list of sidebar destinations: selecting it opens the spreadsheet
workspace, where `.db-tabs` reuses the existing `.sub-tab` treatment for
entities, custom databases, and sheets. This keeps the sidebar quiet while
preserving familiar tab, add, rename, and custom-delete interactions inside the
Database page. Returning to Database keeps the last active workspace tab for
the current browser session.

A `--rule-2` divider separates work navigation from the footer controls.
Settings and Profile share one row in the expanded sidebar; in the collapsed
rail they form a vertical stack with the gear above the profile avatar. The
profile menu opens upward from this footer. Settings is not a work-navigation
accordion: the gear opens General and `.settings-tabs` uses the same horizontal
`.sub-tab` language as Database for General, Shortcuts, Time Calc, and Access.
Permission filtering still controls which Settings tabs a viewer can reach.

Use `--brand-soft`/`--brand` for the active sidebar destination and `--rule-2`
for the Database separator. Do not introduce a second selected-state treatment
or move Database's individual tabs back into the sidebar.

Sidebar section labels use the caption-size mono treatment; destinations use
`--fs-body-sm`. Active destination surfaces use `--r-lg`, and every `.ct`
order-count badge uses the shared caption-size capsule treatment in expanded
and collapsed navigation. Do not hand-size or square individual count badges.

### Mobile and touch

At `max-width:980px`, navigation becomes a full-label off-canvas drawer below
the 52px top row. The centered hamburger opens and closes it; selecting a
destination, tapping the backdrop, pressing `Escape`, or widening the viewport
closes it. The mobile drawer is temporary session state and must not overwrite
the user's saved expanded/collapsed desktop preference.

Narrow layouts use one content column and hide the desktop-only Staging and
History rails. The formatting toolbar remains fixed open and scrolls
horizontally rather than wrapping into an unpredictable stack. Form controls
stay at least 16px to avoid browser zoom on focus. Keep selectors for hidden
rails scoped to the body grid—never hide every `aside`, because the order
drawer also uses that element.

Responsive layout is based on available width, not a device or browser name.
Use `pointer:coarse` separately for larger physical targets, including wide
landscape tablets that still have room for the desktop shell. Bare keyboard
Left/Right may cycle subsections only when no grid selection, field, editor,
drawer, modal, menu, or conflicting shortcut owns the keys; `Escape` remains
the universal exit from active selections and temporary navigation.

## Toolbar contract

The global cell-formatting toolbar uses `--panel`, matching the header and
sidebar shell. Reserve the darker `--panel-2` surface for table headers, tab
bars, and hover feedback; using it across the whole toolbar makes that strip
read heavier than the rest of the app.

Every list-style page (Scheduler, Current Week, Driver Tabs, all three
Orders trackers, Billing, all five Database grids) builds its toolbar
through one shared helper — never hand-roll a `<div class="toolbar">...`
string:

```js
toolbarHtml(title, {context, secondary, primary, plain})
```

Layout is fixed, left to right: **title** → optional **context** controls
(date pickers, a year picker) → a flexible spacer → **secondary**/bulk
actions → exactly one **primary** action, always rightmost. `plain: true`
gives the borderless variant Orders trackers and Database grids use (a
heading row inside the scrolling `.pad`, not a sticky bar) — a real
page-mechanics difference, not part of the button-order rule, so it's a
caller choice rather than something the helper flattens away.

A status/toggle indicator (e.g. "a custom sort is active") is `.btn.active`
(outline + tint via `--brand`, no fill) — never `.btn.pri`. `.pri` is
reserved for the one real call to action per toolbar; a second filled green
button competes with it. Every toolbar should have exactly one `.btn.pri`,
never zero, never two.

**Button labels are Title Case** (D177) — every word capitalized ("Add
Customer", "Reserve Numbers", "Delete Selected"), not sentence case. Single
words stay as-is ("Save", "Cancel", "Continue"). Applies to real `.btn`/
`.pm-item` action labels only — leave modal `<h2>` headings, right-click
context-menu items (`openMenu`), and ordinary prose sentence-case; those
aren't buttons.

Orders tracker toolbars use the compact `.btn.sm` size for their entire action
group: both sync actions, Cancel Selected, Delete Selected, and the primary
New/Add Orders action. Do not mix the default and compact button heights in
that row. The group stays on one horizontally scrollable line instead of
wrapping the primary action onto a visually unrelated second row.

## Status and workflow controls

Two coexisting looks, picked by context, not by preference:

- **General `.pill`** (drawer status strip and billing doc rows) — dot + tinted outline. `color` carries the
  status (`--good`/`--warn`/`--bad`/`--billed`/`--ink-3`), a `::before`
  pseudo-element dot picks it up via `currentColor`, border is a 45%-mixed
  tint of the same color.
- **Order trackers (`.stage-actions`, D211)** — one joined control inside a
  fixed 220px Status / Stage column, ordered Status → Copy → Stage/Restore.
  The status segment is a fixed 78px and uses `--fs-caption`, so every label
  stays centered without the retired D100 8px hard-fit exception. Copy and
  Stage/Restore are 62px segments; Stage is always last and folds inward to
  zero when it becomes unavailable, leaving Status and Copy unmoved with no
  blank slot. Status colors use existing semantic tokens and `--paper` text so
  contrast reverses correctly in light and dark themes.
- **Count badges (`.ct`)** — caption-size mono numerals in one shared rounded
  capsule. Context controls its fill, but not its type size, padding, or shape.

Each tracker places a separate 44px Open column between the numbered selector
and workflow column. Its header glyph and every row target are centered with
flex alignment. The row button is the only way an editable tracker row opens
the order drawer; clicks elsewhere keep their spreadsheet edit/selection
meaning. Do not restore whole-row open on these tables.

Use `emptyStateHtml(text)` (below), not a pill, for "there's nothing here"
— pills are for one order/row's status, not for an empty collection.

## Empty states

`emptyStateHtml(text)` (`01-core.js`) — an icon + one line of muted copy,
centered. Deliberately used in exactly three places, not sprinkled
everywhere a list *could* be empty:

- Staging rail (`renderRail`, `05-settings-nav-search.js`) — distinguishes
  "nothing staged" from "no matches for a filter."
- Any Database grid (built-in or custom) with zero rows (`vBuiltin`,
  `04-views.js`).
- Billing's unmatched-documents queue specifically when it's at zero
  (`vBilling`) — before this, "queue is empty" and "this section hasn't
  loaded yet" looked identical (both rendered nothing).

Adding a fourth spot should be a deliberate call, not a reflex — the point
was fixing three real trouble spots someone actually stares at, not
building a general "always show something" rule.

## Icons

`NAV_ICONS` / `icon(name)` (`01-core.js`) — hand-drawn inline SVG, 12–22px,
`stroke="currentColor"` so an icon inherits its button's own color/hover/
disabled state for free. No webfont, no icon library (D24). Currently:
`sync`, `calendar`, `empty`. Add new ones the same way — small, stroke-based,
`currentColor`. A second, separate set — `NAV_SEC_ICONS` / `navSecIcon(k)`
(also `01-core.js`, D201) — labels the sidebar's five top-level sections
(truck/box/invoice/grid/bar-chart), shown both in the collapsed icon rail
and next to each `.nm-sec` header when expanded; same stroke style, kept
as its own map since it's keyed by section, not by icon name.

**Collapse/expand arrows show the toggle's action direction, not the
panel's current state (D201, Nate's explicit rule, app-wide).** An arrow
points the way the panel will move when clicked — the Staging rail
(`#rail-toggle`, right-docked) shows `>` expanded (collapsing shrinks it
rightward) and `<` collapsed (expanding grows it back left); a vertical
accordion (the sidebar's collapsed-mode section expand, D201) shows `↓`
closed (expanding reveals content below) and `↑` open (collapsing pulls
it back up). Plain `<`/`>`/`↓`/`↑` characters, not triangle glyphs — Nate
specifically dislikes "the little triangle thing" (this cost the
IFR-rate arrow, D170/D188, its original `◂`/`▸` glyphs). Any new
collapsible control should follow this same rule rather than a static or
current-state-indicating icon.

The subsection cycler, Staging toggle, and Internal Rate toggle use those plain
angle glyphs without borders, filled backgrounds, or pill/button chrome (D205).
The cell-formatting toolbar is fixed open—there is no toolbar collapse control
or persisted `fmtbarOpen` state. On Orders pages only, the Internal Rate toggle
and its expanded inputs occupy the far-right edge of that global toolbar; Sync
mileage and Sync delivery dates remain in the order page's action toolbar.

**Naming trap:** `11-toolbar.js` (the cell-formatting toolbar — fonts, bold,
italic, borders) already owns an unrelated global called `ICONS` (Material
Symbols path data). `app.js` concatenates every file in `app/web/js/*.js`
into one scope (`sorted(os.listdir(...))` order, alphabetical) — a second
top-level `var ICONS` doesn't error, it just silently wins or loses
depending on load order, and the loser's icons render as empty `<span>`s
with zero console errors. This is why the nav/toolbar icon set is named
`NAV_ICONS`, not `ICONS`. Grep `app/web/js/*.js` for a name before adding
any new app-wide-sounding global — this file has roughly 30 of them and
nothing enforces uniqueness.

## Personalization system

Settings → General, with appearance values persisted per-device in `localStorage` and
applied instantly via `applyPrefs()` (`01-core.js`) setting inline custom
properties on `<html>`:

- **Theme** — `PREFS.theme` defaults to the literal string `"light"`, not
  `"system"`. A fresh session always hard-sets `data-theme="light"` before
  anything else runs; dark mode only shows up if someone explicitly picks
  it in Settings. Don't assume a fresh install follows the OS.
- **Accent** — `PREFS.accent` defaults to `#3F7D3A` (Forest green, D125),
  overriding `--brand`/`--brand-soft` directly via `root.style.setProperty`.
  `--focus`/`--focus-soft` alias those tokens, so cell/row/column selection,
  focused fields, drag targets, active tabs, and the Scheduler Today marker
  follow the same accent automatically. Ten pre-checked visual swatches are the
  primary picker. The optional custom color well plus hex input accepts any color
  with at least 3:1 contrast against both base panels, and users can retain up to
  12 custom colors in `pref_saved_accents` for one-click switching;
  `accentInk()` picks black or white for at least 4.5:1 text contrast and writes
  `--brand-ink`. Rejected colors never replace the saved value (D216).
- **Font** — the sampled dropdown writes `PREFS.font`, one of 27 system stacks,
  to `--font`. `--mono`
  is never touched — tabular numbers, compact labels, counts, and statuses
  remain consistently monospace regardless of the chosen body font.
- **Scheduler sizing** — `PREFS.rowHeight`/`PREFS.colWidth` (D175), 56-160px
  / 100-320px, default 84/150, drive `--row-h`/`--col-w`. Adjustable via the
  "Scheduler sizing" card's `.fb-fs` steppers with a live preview built from
  real `.grid`/`.slotrow`/`.chip` markup, not a mockup image. Any code that
  renders a truck-column width must read `PREFS.colWidth`, never hardcode
  `150` — that includes JS-computed *table* width totals
  (`vScheduler`/`vCurrentWeek`), not just individual `<th>` widths.

Profile, account status, and Outlook connection share the General page with
appearance. They are not separate profile-menu destinations. Rich texture,
motion, or illustrated themes should be implemented as complete named theme
packs layered above these base controls, never as one-off decoration inside
General (D216).

Workspace order-number patterns also live on General but are shared database
settings, not per-device appearance. Keep their format inputs and live examples
inside the full-width Numbering card. A format change must never rewrite an
existing identifier or determine a Bag Order's month; `orders.order_period` owns
that grouping (D217).

Nothing in this file should assume one fixed accent, one fixed theme, or
one fixed font — nearly every rule above has to keep working across all of
them.

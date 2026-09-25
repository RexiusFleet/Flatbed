/* Dept 12 Dashboard — browser client (one IIFE).
   Formerly assembled at request time from app/web/js/*.js by the Python server;
   now a single static file. Section banners mark the original files.
   Data access goes through api() in supabase-api.js. */
(function () {
"use strict";
/* ═══ 01-core ═══ */
var $ = function (s) { return document.querySelector(s); };
var $$ = function (s) { return [].slice.call(document.querySelectorAll(s)); };
/* Small inline-SVG icon set (D172, redline 05) — a dense toolbar was reading
   as pure text ("Sync mileage", "Sync delivery dates"), which reads
   correctly but scans slowly. Hand-drawn, not a webfont/icon library (D24
   dependency-free) — 12px, stroke-based, colored with currentColor so an
   icon inherits whatever color/state its button already has for free (no
   separate hover/disabled styling needed). Kept to the handful actually
   used in compact app controls; not a general-purpose icon system. */
var NAV_ICONS = {
  sync: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 8a6 6 0 0 1 10.2-4.2M14 8a6 6 0 0 1-10.2 4.2M12 2v3h-3M4 14v-3h3"/></svg>',
  calendar: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M5 1.5v3M11 1.5v3"/></svg>',
  copy: '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="5" y="5" width="8" height="8" rx="1"/><path d="M3 11H2.5A1.5 1.5 0 0 1 1 9.5v-7A1.5 1.5 0 0 1 2.5 1h7A1.5 1.5 0 0 1 11 2.5V3"/></svg>',
  orderPanel: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2" width="13" height="12" rx="1"/><path d="M10.5 2v12M5 8h4M7 6l2 2-2 2"/></svg>',
  empty: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8"/></svg>'
};
function icon(name) {
  return '<span class="ico" aria-hidden="true">' + (NAV_ICONS[name] || "") + "</span>";
}
/* Designed empty state (D172, redline 07) — three specific spots that
   previously just rendered nothing (an empty Staging rail, a Database grid
   with zero rows, Billing's unmatched-documents queue at zero), not a
   general pattern sprinkled everywhere. One line of copy + a small glyph
   instead of blank space. */
function emptyStateHtml(text) {
  return '<div class="empty-state">' + icon("empty") + "<span>" + esc(text) + "</span></div>";
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}
/* Database/sheet cell display (D123): a cell whose ENTIRE trimmed value is a
   URL renders as a real clickable link (new tab, so it never steals the
   cell-select/type-to-edit click) instead of plain text. Only a whole-value
   match — no partial-sentence URL detection — so a note that happens to
   mention a URL mid-sentence stays plain text. Every render/repaint path
   that writes a data-field cell's body must go through this, not esc()
   directly or a bare .textContent write, or the link silently reverts to
   plain text the next time that cell repaints (fill, paste, live edit). */
var CELL_URL_RE = /^(https?:\/\/\S+|www\.\S+\.\S+)$/i;
function cellDisplayHtml(val) {
  var v = val == null ? "" : String(val), t = v.trim();
  if (!t || !CELL_URL_RE.test(t)) return esc(v);
  var href = /^https?:\/\//i.test(t) ? t : "https://" + t;
  return '<a class="cell-link" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(v) + "</a>";
}
/* Readable text color on a filled swatch/chip (D66) — luminance threshold. */
function textOn(hex) {
  if (!hex || hex.charAt(0) !== "#" || hex.length < 7) return "";
  var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#1a1a1a" : "#ffffff";
}
/* CSS supports #RRGGBBAA, which keeps color and opacity together in existing
   text/JSON fields without a schema change. Older six-digit colors stay opaque. */
function colorBase(color) {
  return /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color || "") ? color.slice(0, 7) : "#888888";
}
function colorOpacity(color) {
  if (!/^#[0-9a-f]{8}$/i.test(color || "")) return 100;
  return Math.round(parseInt(color.slice(7, 9), 16) * 100 / 255);
}
function colorWithOpacity(color, opacity) {
  var base = colorBase(color), pct = Math.max(0, Math.min(100, Number(opacity)));
  if (pct >= 100) return base;
  return base + Math.round(pct * 255 / 100).toString(16).padStart(2, "0");
}
function toast(m, bad) {
  var t = $("#toast"); t.textContent = m;
  t.className = "show" + (bad ? " bad" : "");
  clearTimeout(t._h); t._h = setTimeout(function () { t.className = ""; }, 3200);
}
/* api(path, body) — the one data-access choke point — now lives in
   supabase-api.js, which maps each old "/api/<path>" route onto Supabase
   (REST, RPC, Storage, or an Edge Function). Expose DB to it so it can
   label History events with the right section. */
window.DEPT12_DB = function () { return DB; };
/* Local-auth permission gates (D125). DB.me is absent whenever local auth is
   off or the request wasn't authenticated locally — everything is
   unrestricted in that case, matching the app's behavior before this feature
   existed. An admin (or no DB.me) always passes. These are UX fast-fails
   only — the server enforces the real boundary (app/server.py's
   API_PERMISSIONS / _check_route_permission), so a stale/bypassed client
   check can never actually grant access it shouldn't. */
function canView(sec, sub) {
  if (!DB || !DB.me || DB.me.is_admin) return true;
  if (sec === "dispatch" && sub === "sched") return true;   // baseline every restricted user gets for free
  return DB.me.grants.some(function (g) { return g.section === sec && g.sub === sub; });
}
function canEdit(sec, sub) {
  if (!DB || !DB.me || DB.me.is_admin) return true;
  var g = DB.me.grants.filter(function (g) { return g.section === sec && g.sub === sub; })[0];
  return !!(g && g.can_edit);
}
function b64FromBytes(bytes) {
  var s = "", C = 0x8000;
  for (var i = 0; i < bytes.length; i += C) s += String.fromCharCode.apply(null, bytes.subarray(i, i + C));
  return btoa(s);
}
function bytesFromB64(b64) {
  var bin = atob(b64), a = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}

/* YEAR is the year the Scheduler board, Internal Order Tracker, and External
   Order Tracker are showing (D117 added External). It's switchable (D52) so
   several years coexist — the eventual 2024→today backfill lands in the same
   UI. Defaults to the real current year (clamped into the available range).
   TODAY stays the real date; when the demo data year differs it's pinned so
   the "today" row still lands on data.

   The range always covers 2024 through real-current-year+1, but Nate wants
   direct control rather than waiting on the clock to roll over (D117) — +
   Add Year appends the next year explicitly and persists it per device
   (EXTRA_YEARS, localStorage), so it doesn't disappear on reload and doesn't
   need a server round trip (this only widens what the picker offers; the
   underlying order data was never restricted by it). */
var EXTRA_YEARS = (function () {
  try { return JSON.parse(localStorage.getItem("extraYears") || "[]"); }
  catch (e) { return []; }
})();
function availableYears() {
  var now = new Date().getUTCFullYear(), max = Math.max(now + 1, 2026);
  EXTRA_YEARS.forEach(function (y) { if (y > max) max = y; });
  var ys = [];
  for (var y = 2024; y <= max; y++) ys.push(y);
  return ys;
}
var YEAR = (function () {
  var now = new Date().getUTCFullYear(), ys = availableYears();
  return ys.indexOf(now) >= 0 ? now : 2026;
})();
var TODAY = new Date().toISOString().slice(0, 10);
if (TODAY.slice(0, 4) !== "2026") TODAY = "2026-08-04";  // demo data year
function addNextYear() {
  var ys = availableYears(), next = ys[ys.length - 1] + 1;
  EXTRA_YEARS.push(next);
  localStorage.setItem("extraYears", JSON.stringify(EXTRA_YEARS));
  YEAR = next;
  render();
}
/* A <select> of the available years, reused on the Scheduler, Internal
   Orders, and External Orders so switching year anywhere is consistent
   (same YEAR global). "+ Add Year" rides as the trailing option instead of
   a standing separate button (D117 follow-up) — Nate clicks it once a year,
   so it shouldn't sit next to the select the other 364 days. */
function yearPicker() {
  return '<select id="year-pick" class="btn" title="Year">' + availableYears().map(function (y) {
    return '<option value="' + y + '"' + (y === YEAR ? " selected" : "") + ">" + y + "</option>";
  }).join("") + '<option value="__add__">+ Add year…</option></select>';
}
function orderYearCode(o) {
  if (o.order_period) return String(o.order_period).slice(2, 4);
  var m = String(o.solomon_order_no || "").match(/^..-(0[1-9]|1[0-2])(\d{2})-/);
  return m ? m[2] : null;
}
/* A copied/blank Bag Order has no order_period and no solomon_order_no yet
   (D30's Copy button deliberately leaves those unique-per-load fields
   blank, and api_copy_order sets no year field at all) — orderYearCode(o)
   returns null for it, which used to fail `=== yy` and silently vanish the
   row from every year's tracker until it got a real number (found live,
   D261: copying a Bag Order made the copy un-openable from the tracker —
   it still existed, still counted toward the nav badge, just had nowhere
   to click). Same missing safeguard `externalOrderInYear` already has for
   this exact scenario — a year filter shouldn't hide a live row just
   because it doesn't have a date/number yet. */
function internalOrderInYear(o, yy) {
  var code = orderYearCode(o);
  return !code || code === yy;
}
/* External's own order numbers are hand-typed from Solomon (D117), so there is
   no reliable year to parse out of them. Year filtering goes by ordered_at. An order
   with no ordered_at yet always shows regardless of the selected year — the
   existing "keep the live workflow independent of dates" rule
   (externalOrderCompare) already protects incomplete/live rows from being
   sorted away by date; a year filter shouldn't quietly hide them either. */
function externalOrderInYear(o, year) {
  return !o.ordered_at || +String(o.ordered_at).slice(0, 4) === year;
}

var DB = null, SEC = "dispatch", SUB = "sched", SEL = null, EDITING = null;
var schedNode = null, DRAG = null, Q = "", DRIVER_VIEW = null;
/* Outside-carrier Scheduler lane (D115) — a fixed, non-truck pseudo-column
   pinned to the far right, client-side only (never a real trucks row, never
   sent as a truck_id to the server). CARRIER_TID is just the cell-key
   identity that cellKey()/CELLS/schedCellHtml already work with generically. */
var CARRIER_TID = "carrier";
var STAGED = [], POOL = [], GROUP = [];
/* Excel-style row selection for the Database grids (D50): each grid tracks its
   selected row ids and a shift-range anchor. Selection is applied directly to
   the DOM (no re-render), so it survives cell edits within the same view. */
var ROWSEL = {}, ROWSEL_ANCHOR = {};
/* Click-and-drag range select across the numbered gutter (D193, Nate:
   "i cant drag and select mroe than one order in the orders tab i need
   that fixed") — mousedown on a plain (no-modifier) gutter cell arms
   ROWDRAG; mousemove into another gutter cell in the same grid extends the
   selection live, the same range math Shift+click already does. Shared by
   every numbered gutter (Database grids and all three order trackers) since
   they're all `[data-rowsel]`/`handleRowSel` under the hood. */
var ROWDRAG = null, ROWDRAG_MOVED = false, ROWSEL_SUPPRESS_CLICK = false;
/* Per-grid view sort (Nate's ask) — a toolbar "Sort" control, session-only
   (not persisted, doesn't touch sort_order). {fieldId, dir} keyed by grid
   key; a grid with no entry renders in its stored/manual order. */
var GRIDSORT = {};
var ROUTE_DRAFT = null, ROUTE_DRAG = null;
/* Set by addLocationModal(name, target) when it's opened from a loccombo's
   "+Create" instead of Pick/Drop List's own toolbar — {oid, field} to also
   assign onto once the location is saved, or null for a bare add. */
var MODAL_LOC_TARGET = null;
/* The <input> a loccombo/partycombo suggestion panel is currently open for
   (see locSuggestPanel, 03-drawer-billing.js) — the panel itself is a
   single shared element parked in document.body, not a per-combo child,
   so pick handlers read this instead of DOM-walking up from the clicked
   option. */
var SUGGEST_INPUT = null;

/* Rolling driver handoff window (D98). This is deliberately separate from the
   old Monday-based cwDays preference: the new workflow starts on a chosen date,
   defaults to 3 visible delivery days, and skips empty weekends. */
var CW_DAYS = Math.max(1, Math.min(14, parseInt(localStorage.getItem("cwDaysRolling"), 10) || 3));
var CW_START = localStorage.getItem("cwStart") || TODAY;
var WEEKEND_ON = (function () {
  try { return JSON.parse(localStorage.getItem("weekendActive") || "{}"); } catch (e) { return {}; }
})();
/* D170: the internal freight rate/minimum controls on the Orders toolbar
   collapse behind an arrow by default — Nate: "otherwise itll be annoying
   for me to look at." Per-device, like every other toolbar UI preference. */
var IFR_OPEN = localStorage.getItem("ifrOpen") === "1";

/* ── UI preferences (D54) ────────────────────────────────────────────────────
   Persisted in localStorage until there's a per-user settings store (arrives
   with Supabase Auth). Applied to :root so the whole app follows. */
var DEFAULT_ACCENT = "#3F7D3A";
/* Ten curated accents are the first-choice experience. Every swatch passes
   the same light/dark contrast guard as a custom color, so switching themes
   later cannot make primary controls disappear. */
var ACCENT_PRESETS = [
  ["#3F7D3A", "Forest"], ["#6B8E23", "Moss"], ["#2F7F68", "Evergreen"],
  ["#118A8A", "Teal"], ["#3F72A8", "Lake"], ["#775FC0", "Violet"],
  ["#C2417B", "Berry"], ["#B34B40", "Brick"], ["#E2510B", "Ember"],
  ["#9B6A00", "Ochre"]
];
/* Font choices — all system-available stacks (no external fonts; the app is
   offline/CSP-locked). --mono is left alone so tabular/label text stays mono.
   Shared by Settings (whole-app --font) AND the toolbar's per-cell font picker
   (D78), so every stack must degrade gracefully across macOS/Windows. */
var FONTS = [
  ["", "System"],
  ["Arial,Helvetica,sans-serif", "Arial"],
  ["'Helvetica Neue',Helvetica,Arial,sans-serif", "Helvetica"],
  ["'Trebuchet MS',Verdana,sans-serif", "Trebuchet"],
  ["Verdana,Geneva,sans-serif", "Verdana"],
  ["Tahoma,Geneva,sans-serif", "Tahoma"],
  ["'Gill Sans','Gill Sans MT',Calibri,sans-serif", "Gill Sans"],
  ["Optima,Candara,'Segoe UI',sans-serif", "Optima"],
  ["Futura,'Century Gothic','Trebuchet MS',sans-serif", "Futura"],
  ["Avenir,'Avenir Next','Segoe UI',sans-serif", "Avenir"],
  ["Georgia,'Times New Roman',serif", "Georgia"],
  ["'Times New Roman',Times,serif", "Times"],
  ["'Palatino Linotype','Book Antiqua',Palatino,serif", "Palatino"],
  ["Baskerville,'Baskerville Old Face',Georgia,serif", "Baskerville"],
  ["Garamond,'EB Garamond','Apple Garamond',serif", "Garamond"],
  ["Didot,'Bodoni MT','Times New Roman',serif", "Didot"],
  ["'American Typewriter','Courier New',serif", "Typewriter"],
  ["Rockwell,'Rockwell Nova','Courier New',serif", "Rockwell"],
  ["'Courier New',Courier,monospace", "Courier"],
  ["ui-monospace,'SF Mono',Menlo,Consolas,monospace", "Monospace"],
  ["Menlo,Monaco,Consolas,monospace", "Menlo"],
  ["Impact,Haettenschweiler,'Arial Narrow Bold',sans-serif", "Impact"],
  ["'Comic Sans MS','Comic Sans',cursive", "Comic Sans"],
  ["'Brush Script MT','Segoe Script',cursive", "Brush Script"],
  ["'Chalkboard SE','Comic Sans MS',cursive", "Chalkboard"],
  ["Copperplate,'Copperplate Gothic Light',serif", "Copperplate"],
  ["Papyrus,fantasy", "Papyrus"]];
/* Scheduler row height / truck-column width (D175) — Nate: chips were
   getting cut off at the old fixed 72px row height. Customizable per
   device like every other PREFS value; clamped so a stray localStorage
   value (or a future bad migration) can't collapse the grid to something
   unusable. Defaults: 84px row (was a hardcoded 72px), 150px column
   (unchanged default, now just adjustable). */
function clampInt(v, lo, hi, dflt) {
  var n = parseInt(v, 10);
  return isNaN(n) ? dflt : Math.max(lo, Math.min(hi, n));
}
var PREFS = {
  theme: localStorage.getItem("pref_theme") || "light",
  accent: localStorage.getItem("pref_accent") || DEFAULT_ACCENT,
  font: localStorage.getItem("pref_font") || "",
  rowHeight: clampInt(localStorage.getItem("pref_rowHeight"), 56, 160, 84),
  colWidth: clampInt(localStorage.getItem("pref_colWidth"), 100, 320, 150)
};
/* Density used to tighten fixed scheduler cells. Scheduler dimensions are now
   directly adjustable, so comfortable is the only layout and the stale device
   preference is intentionally retired. */
localStorage.removeItem("pref_density");
function normalizeHex(hex) {
  var v = String(hex || "").trim();
  if (/^#[0-9a-f]{3}$/i.test(v)) v = "#" + v.slice(1).split("").map(function (c) { return c + c; }).join("");
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : "";
}
function colorRgb(hex) {
  var n = parseInt(normalizeHex(hex).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function colorLuminance(hex) {
  var rgb = colorRgb(hex).map(function (v) {
    v /= 255;
    return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4);
  });
  return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
}
function contrastRatio(a, b) {
  var l1 = colorLuminance(a), l2 = colorLuminance(b);
  return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
}
/* Accent text and controls need to work in both app themes. Blocking colors
   that disappear into either panel avoids a saved accent becoming unreadable
   when the OS or the user switches theme later. */
function accentIsReadable(hex) {
  var v = normalizeHex(hex);
  return !!v && contrastRatio(v, "#FAF8F4") >= 3 && contrastRatio(v, "#1D2022") >= 3;
}
function accentInk(hex) {
  return contrastRatio(hex, "#FFFFFF") >= contrastRatio(hex, "#111315") ? "#FFFFFF" : "#111315";
}
if (!accentIsReadable(PREFS.accent)) {
  PREFS.accent = DEFAULT_ACCENT;
  localStorage.setItem("pref_accent", PREFS.accent);
}
function hexToSoft(hex) {
  var rgb = colorRgb(hex);
  return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",.14)";
}
function applyPrefs() {
  var root = document.documentElement;
  if (PREFS.theme === "light" || PREFS.theme === "dark") root.setAttribute("data-theme", PREFS.theme);
  else root.removeAttribute("data-theme");
  if (PREFS.accent) {
    root.style.setProperty("--brand", PREFS.accent);
    root.style.setProperty("--brand-soft", hexToSoft(PREFS.accent));
    root.style.setProperty("--brand-ink", accentInk(PREFS.accent));
  } else { root.style.removeProperty("--brand"); root.style.removeProperty("--brand-soft"); }
  if (PREFS.font) root.style.setProperty("--font", PREFS.font);
  else root.style.removeProperty("--font");
  root.style.setProperty("--row-h", PREFS.rowHeight + "px");
  root.style.setProperty("--col-w", PREFS.colWidth + "px");
}
function setPref(k, v) { PREFS[k] = v; localStorage.setItem("pref_" + k, v); applyPrefs(); }
function setAccentPref(v) {
  var hex = normalizeHex(v);
  if (!accentIsReadable(hex)) return false;
  setPref("accent", hex);
  return true;
}
function accentIsPreset(hex) {
  hex = normalizeHex(hex);
  return ACCENT_PRESETS.some(function (preset) { return normalizeHex(preset[0]) === hex; });
}
var SAVED_ACCENTS = (function () {
  try {
    var raw = JSON.parse(localStorage.getItem("pref_saved_accents") || "[]"), seen = {};
    return raw.map(normalizeHex).filter(function (hex) {
      if (!accentIsReadable(hex) || accentIsPreset(hex) || seen[hex]) return false;
      seen[hex] = true; return true;
    }).slice(0, 12);
  } catch (e) { return []; }
})();
function persistSavedAccents() {
  localStorage.setItem("pref_saved_accents", JSON.stringify(SAVED_ACCENTS));
}
function saveAccent(hex) {
  hex = normalizeHex(hex);
  if (!accentIsReadable(hex) || accentIsPreset(hex)) return false;
  if (SAVED_ACCENTS.indexOf(hex) < 0) SAVED_ACCENTS.unshift(hex);
  SAVED_ACCENTS = SAVED_ACCENTS.slice(0, 12); persistSavedAccents(); return true;
}
function forgetAccent(hex) {
  hex = normalizeHex(hex);
  SAVED_ACCENTS = SAVED_ACCENTS.filter(function (saved) { return saved !== hex; });
  persistSavedAccents();
}
applyPrefs();

/* Local profile (D58/D218) — a display name whose initials fill the sidebar-
   footer avatar, Outlook-style. Real sign-in/out arrives with Supabase Auth;
   this per-device placeholder keeps the avatar useful right now. */
var profileName = localStorage.getItem("profile_name") || "Nate Lee";
function initials(name) {
  var p = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}
function renderProfile() {
  var b = document.querySelector("#profile-btn"); if (!b) return;
  var avatar = b.querySelector(".nav-profile-avatar");
  if (avatar) avatar.textContent = initials(profileName);
}
renderProfile();
/* Sidebar-footer profile dropdown — sign-in/out home until Supabase. */
function openProfileMenu() {
  var m = document.querySelector("#profile-menu");
  if (m) { closeProfileMenu(); return; }  // toggle
  var accountLine = "Shared team login";  // TODO(AUTH): per-person accounts
  m = document.createElement("div"); m.id = "profile-menu";
  m.innerHTML = '<div class="pm-hd"><span class="avatar lg">' + esc(initials(profileName)) + "</span>" +
    '<div class="pm-who"><b>' + esc(profileName) + "</b><span>" + esc(accountLine) + "</span></div></div>" +
    '<div class="pm-actions"><button class="pm-item" data-profile="help"><b>Help &amp; FAQ</b><span>Guides and keyboard help</span></button>' +
    '<button class="pm-item danger" data-profile="signout"><b>Sign out</b></button></div>';
  document.body.appendChild(m);
  var r = document.querySelector("#profile-btn").getBoundingClientRect();
  m.classList.add("from-nav");
  m.style.top = Math.max(8, r.top - m.offsetHeight - 7) + "px";
  m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8)) + "px";
}
function closeProfileMenu() {
  var m = document.querySelector("#profile-menu");
  if (!m || m.classList.contains("closing")) return;
  m.classList.add("closing");
  setTimeout(function () { if (m.parentNode) m.remove(); }, 130);
}

/* ── Sidebar nav (D200 → D202) — a persistent left grid column, not an
   overlay (Nate: "it needs to be persistent so i can toggle the open and
   close but if i choose to keep it open it looks like it matches the
   ui"). Replaces the retired top-level .sections/.subs bars. Normal section
   items carry data-navto="sec|sub". Database is deliberately one direct
   sidebar destination; its dynamic entity/sheet navigation lives in the
   in-page spreadsheet tab strip instead (D202).
   Collapsing (#navtoggle, persisted to localStorage like the Staging
   rail's own collapse, D199) switches the sidebar to a narrow icon rail —
   Nate: "i will need a way to navigate to each of the sub sections in
   collapsed mode though... an expandable sub menu underneath the icons to
   get there" — so collapsed mode isn't just clipped labels, it's a
   different render (navMenuCollapsedHtml): one icon per top-level section,
   click to expand that section's real subs directly beneath it (single-open
   accordion, NAV_OPEN_SEC), not a hover flyout. */
/* Hand-drawn, matching NAV_ICONS' stroke style (D172) — one per top-level
   section, shown in the collapsed icon rail (and could label the expanded
   section headers too, but Nate only asked for collapsed-mode icons). */
var NAV_SEC_ICONS = {
  dispatch: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="8" height="6"/><path d="M9 7h3l2 2v1h-2"/><circle cx="4" cy="12" r="1.3"/><circle cx="11.5" cy="12" r="1.3"/></svg>',
  orders: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5l6-3 6 3-6 3-6-3z"/><path d="M2 5v6l6 3 6-3V5"/><path d="M8 8v6"/></svg>',
  billing: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="1.5" width="10" height="13" rx="1"/><path d="M5.5 5h5M5.5 8h5M5.5 11h3"/></svg>',
  database: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2" width="13" height="12" rx="1"/><path d="M1.5 6h13M1.5 10h13M6 2v12M10.5 2v12"/></svg>',
  reports: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 14V9M6 14V5M10 14V7M14 14V2"/></svg>',
  settings: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>'
};
function navSecIcon(k) { return '<span class="ico" aria-hidden="true">' + (NAV_SEC_ICONS[k] || "") + "</span>"; }
var NAV_COLLAPSED = localStorage.getItem("navCollapsed") === "1";
var NAV_OPEN_SEC = null;  // which section's accordion is open in collapsed mode
var MOBILE_NAV_OPEN = false;
var MOBILE_NAV_QUERY = window.matchMedia ? window.matchMedia("(max-width: 980px)") : null;
function mobileNavMode() { return !!(MOBILE_NAV_QUERY && MOBILE_NAV_QUERY.matches); }
function closeMobileNav() {
  if (!MOBILE_NAV_OPEN) return;
  MOBILE_NAV_OPEN = false;
  renderSideNav();
}
var LAST_DATABASE_SUB = null;
/* A closed-out order never "needs placement" again, but this used to only
   check placement/staging — found live (2026-09-18) as a real stray count:
   a billed external order with no load ever attached still counted toward
   unExt forever, since billed_at/stage were never consulted, showing "1"
   in the nav badge with no matching row for Nate to actually go place.
   `needsPlacement` excludes cancelled orders across all three kinds (D93 —
   a cancelled order is detached from scheduling for good); each kind's own
   "done" field matches its own tracker's live/collapsed-group split
   (`vOrders`/`vInternal`/`vInternalFreight`, 04-views.js): billed_at for
   External, delivered_at for Bag Orders and Internal Freight. */
function needsPlacement(o, pm) {
  return o.stage !== "cancelled" && !pm[o.id] && STAGED.indexOf(o.id) < 0;
}
function navUnplacedCounts() {
  var pm = placement(); // built once (D222) — needsPlacement takes it in, not a fresh scan per order
  return {
    unInt: orders().filter(function (o) { return o.kind === "internal" && !o.delivered_at && needsPlacement(o, pm); }).length,
    unXfer: orders().filter(function (o) { return o.is_transfer && !o.delivered_at && needsPlacement(o, pm); }).length,
    unExt: orders().filter(function (o) { return o.kind === "external" && !o.is_transfer && !o.billed_at && needsPlacement(o, pm); }).length
  };
}
function navOrderCountFor(subKey, counts) {
  return subKey === "int" ? counts.unInt :
    subKey === "xfer" ? counts.unXfer : subKey === "ext" ? counts.unExt : 0;
}
function navVisibleOrderTotal(counts) {
  return subsOf("orders").reduce(function (total, sub) {
    return total + navOrderCountFor(sub.k, counts);
  }, 0);
}
/* One subsection item, in either the expanded list or collapsed accordion. */
function navSubItemHtml(secKey, sub, ct, compact) {
  var on = SEC === secKey && SUB === sub.k;
  return '<button class="' + (compact ? "nm-citem" : "nm-item") + (on ? " on" : "") +
    '" data-navto="' + secKey + "|" + sub.k + '">' + esc(sub.t) +
    (ct ? '<span class="ct">' + ct + "</span>" : "") + "</button>";
}
function navSectionSubsHtml(secKey, compact, counts) {
  var visibleSubs = subsOf(secKey);
  if (!visibleSubs.length) return "";
  if (secKey === "orders" && !counts) counts = navUnplacedCounts();
  var html = "";
  visibleSubs.forEach(function (sub) {
    var ct = secKey === "orders" ? navOrderCountFor(sub.k, counts) : null;
    html += navSubItemHtml(secKey, sub, ct, compact);
  });
  return html;
}
function databaseLandingSub() {
  var dbSubs = subsOf("database");
  if (!dbSubs.length) return "";
  if (SEC === "database" && dbSubs.some(function (sub) { return sub.k === SUB; })) {
    LAST_DATABASE_SUB = SUB;
    return SUB;
  }
  if (LAST_DATABASE_SUB && dbSubs.some(function (sub) { return sub.k === LAST_DATABASE_SUB; })) {
    return LAST_DATABASE_SUB;
  }
  return dbSubs[0].k;
}
/* The collapsed section icon is a navigation target of its own (D207), while
   the adjacent vertical arrow only opens/closes that section's destination
   list. Re-enter the current visible subsection when possible; otherwise use
   the first destination the signed-in user can see. */
function navSectionLandingSub(secKey) {
  var visible = subsOf(secKey);
  if (!visible.length) return "";
  if (SEC === secKey && visible.some(function (sub) { return sub.k === SUB; })) return SUB;
  return visible[0].k;
}
// The old section-level "total active orders" badge (D51) was dropped in
// D201 because it did not reconcile with the actionable per-sub unplaced
// counts. D203 restores a collapsed-only badge using the sum of those same
// visible per-sub counts, so opening Orders always explains the total.
function navMenuHtml() {
  var html = "";
  NAV.forEach(function (s) {
    if (s.k === "database") {
      var dbLanding = databaseLandingSub(); if (!dbLanding) return;
      html += '<div class="nm-section-div"></div><button class="nm-dbentry' +
        (SEC === "database" ? " on" : "") + '" data-navto="database|' + dbLanding + '">' +
        navSecIcon("database") + '<span>Database</span></button>';
      return;
    }
    var body = navSectionSubsHtml(s.k, false);
    if (!body) return;
    html += '<div class="nm-sec">' + navSecIcon(s.k) + esc(s.t) + "</div>" + body;
  });
  return html;
}
/* Collapsed icon rail — D207 splits navigation from disclosure. Clicking the
   icon opens that section's current/first visible destination; the separate
   vertical arrow only opens/closes its subsection list. The arrow still shows
   the direction the toggle will move (D201), not its current state. */
function navMenuCollapsedHtml() {
  var html = "";
  NAV.forEach(function (s) {
    if (s.k === "database") {
      var dbLanding = databaseLandingSub(); if (!dbLanding) return;
      html += '<div class="nm-section-div"></div><button class="nm-cicon nm-dbentry' +
        (SEC === "database" ? " on" : "") + '" data-navto="database|' + dbLanding +
        '" title="Database">' + navSecIcon("database") + "</button>";
      return;
    }
    var orderCounts = s.k === "orders" ? navUnplacedCounts() : null;
    var body = navSectionSubsHtml(s.k, true, orderCounts);
    if (!body) return;
    var open = NAV_OPEN_SEC === s.k;
    var orderTotal = orderCounts ? navVisibleOrderTotal(orderCounts) : 0;
    var navLabel = s.t + (orderTotal ? ", " + orderTotal + " unplaced orders" : "");
    var landing = navSectionLandingSub(s.k); if (!landing) return;
    html += '<div class="nm-csec"><div class="nm-crow' + (SEC === s.k ? " on" : "") + '">' +
      '<button class="nm-cicon" data-navto="' + s.k + "|" + landing + '" title="Open ' + esc(s.t) +
      '" aria-label="' + esc(navLabel) + '">' + navSecIcon(s.k) +
      (orderTotal ? '<span class="ct" aria-hidden="true">' + orderTotal + "</span>" : "") + "</button>" +
      '<button class="nm-carrow" data-navsec="' + s.k + '" title="' + (open ? "Hide " : "Show ") + esc(s.t) +
      ' destinations" aria-label="' + (open ? "Hide " : "Show ") + esc(s.t) +
      ' destinations" aria-expanded="' + open + '">' + (open ? "&#8593;" : "&#8595;") + "</button></div>" +
      (open ? '<div class="nm-csub">' + body + "</div>" : "") + "</div>";
  });
  return html;
}
function navFooterHtml() {
  return '<div class="nav-footer-actions">' +
    '<button class="nav-footer-btn nav-settings-btn' + (SEC === "settings" ? " on" : "") +
      '" data-navto="settings|appearance" title="Settings" aria-label="Open Settings">' +
      navSecIcon("settings") + '<span>Settings</span></button>' +
    '<button class="nav-footer-btn nav-profile-btn" id="profile-btn" title="Profile" aria-label="Open profile">' +
      '<span class="nav-profile-avatar">' + esc(initials(profileName)) + '</span><span>Profile</span></button>' +
    '</div>';
}
function renderSideNav() {
  // Toggled on <body>, not #bodywrap — --nav-w lives there too (app.css) so
  // the nav header and fmtbar spacer inherit the same width the sidebar
  // column uses, with no separate JS wiring. The nav-header hamburger
  // (#navtoggle) is the only toggle (Nate: "get rid of the <> thing...
  // the hamburger is fine") — it never changes glyph.
  var mobile = mobileNavMode();
  document.body.classList.toggle("nav-collapsed", !mobile && NAV_COLLAPSED);
  document.body.classList.toggle("mobile-nav-open", mobile && MOBILE_NAV_OPEN);
  $("#sidenav-body").innerHTML = mobile ? navMenuHtml() : (NAV_COLLAPSED ? navMenuCollapsedHtml() : navMenuHtml());
  $("#sidenav-footer").innerHTML = navFooterHtml();
  renderProfile();
  var toggle = $("#navtoggle");
  if (toggle) {
    toggle.title = mobile ? (MOBILE_NAV_OPEN ? "Close menu" : "Open menu") : "Toggle menu";
    toggle.setAttribute("aria-label", toggle.title);
    toggle.setAttribute("aria-expanded", mobile ? String(MOBILE_NAV_OPEN) : String(!NAV_COLLAPSED));
  }
  var scrim = $("#nav-scrim");
  if (scrim) {
    var scrimOpen = mobile && MOBILE_NAV_OPEN;
    scrim.setAttribute("aria-hidden", scrimOpen ? "false" : "true");
    scrim.tabIndex = scrimOpen ? 0 : -1;
  }
  renderNavCycleControls();
}
/* Compact previous/next glyphs live in the toolbar spacer directly below the
   hamburger (D204/D205). They cycle the current section's visible subs without
   requiring its collapsed accordion to be opened, and intentionally have no
   button chrome so the collapsed rail can be dragged down to 44px. */
function renderNavCycleControls() {
  var host = $("#nav-cycle-controls"); if (!host) return;
  var subs = subsOf(SEC), current = -1;
  for (var i = 0; i < subs.length; i++) if (subs[i].k === SUB) current = i;
  [].forEach.call(host.querySelectorAll("[data-navcycle]"), function (btn) {
    var delta = parseInt(btn.dataset.navcycle, 10);
    var disabled = !NAV_COLLAPSED || subs.length < 2;
    btn.disabled = disabled;
    if (disabled) {
      btn.title = delta < 0 ? "No previous subsection" : "No next subsection";
      btn.setAttribute("aria-label", btn.title);
      return;
    }
    var targetIndex = current < 0 ? (delta < 0 ? subs.length - 1 : 0) :
      (current + delta + subs.length) % subs.length;
    var direction = delta < 0 ? "Previous" : "Next";
    btn.title = direction + ": " + subs[targetIndex].t;
    btn.setAttribute("aria-label", btn.title);
  });
}
function cycleNavSub(delta) {
  var subs = subsOf(SEC); if (subs.length < 2) return;
  var current = -1;
  for (var i = 0; i < subs.length; i++) if (subs[i].k === SUB) current = i;
  var next = current < 0 ? (delta < 0 ? subs.length - 1 : 0) :
    (current + delta + subs.length) % subs.length;
  SUB = subs[next].k; SEL = null; render();
}
// Sections a viewer can actually reach right now — mirrors navMenuHtml's own
// skip logic (a section with no visible subs, or Database with nowhere to
// land, doesn't render a nav entry and shouldn't be cyclable either).
function navVisibleSections() {
  return NAV.filter(function (s) {
    return s.k === "database" ? !!databaseLandingSub() : subsOf(s.k).length > 0;
  });
}
/* Up/Down section cycling (Nate: "if i go left right it uses those arrows
   but up and down takes me section to section") — same idea as cycleNavSub,
   one level up. Lands on each section's current/last-visited sub via the
   same helpers the sidebar's own collapsed-icon click uses
   (navSectionLandingSub/databaseLandingSub), so cycling into a section shows
   whatever you'd see clicking its icon, not always its first sub. */
function cycleNavSection(delta) {
  var sections = navVisibleSections(); if (sections.length < 2) return;
  var current = -1;
  for (var i = 0; i < sections.length; i++) if (sections[i].k === SEC) current = i;
  var next = current < 0 ? (delta < 0 ? sections.length - 1 : 0) :
    (current + delta + sections.length) % sections.length;
  var target = sections[next];
  var landing = target.k === "database" ? databaseLandingSub() : navSectionLandingSub(target.k);
  if (!landing) return;
  SEC = target.k; SUB = landing; SEL = null; render();
}
/* Shift+Up/Down reaches one more stop the plain cycler can't (Nate: "let me
   go through the nav in ways i normally can't... if i hold shift it'll
   actually take me to settings") — Settings lives outside NAV by design
   (D54, see subsOf's comment above) so the everyday cycler should keep
   skipping it, but a held Shift explicitly asks for the wider loop. Appends
   Settings as one extra stop after the normal visible sections; landing
   into it reuses navSectionLandingSub the same way any other section does,
   so it reopens on whichever settings tab was last open, not always
   "General". */
function cycleNavSectionWithSettings(delta) {
  var sections = navVisibleSections().slice();
  if (subsOf("settings").length) sections.push({ k: "settings" });
  if (sections.length < 2) return;
  var current = -1;
  for (var i = 0; i < sections.length; i++) if (sections[i].k === SEC) current = i;
  var next = current < 0 ? (delta < 0 ? sections.length - 1 : 0) :
    (current + delta + sections.length) % sections.length;
  var target = sections[next];
  var landing = target.k === "database" ? databaseLandingSub() : navSectionLandingSub(target.k);
  if (!landing) return;
  SEC = target.k; SUB = landing; SEL = null; render();
}
/* D209: bare Left/Right mirrors the nav cycler, Up/Down cycles sections
   (same trigger, one axis over) — both only fire when the workspace has no
   active selection or editing surface. Grid arrow movement, form controls,
   menus, overlays, and modified shortcuts all keep priority. Escape already
   clears cell/range/row selections in 06-modals-grids.js. `allowShift` lets
   the Shift+Up/Down section-extended cycler (above) through; every other
   caller keeps rejecting a held Shift so it never fights a real shifted
   shortcut or a shift-click/shift-select gesture elsewhere in the app.
   Settings counts as a valid "current section" for both axes now (D247) —
   it lives outside NAV, but once you've actually landed there (via Shift or
   the header gear) its own tab strip should cycle with plain Left/Right
   like Database's does, and Shift+Up/Down should still be able to cycle
   back out of it. */
function navArrowShortcutAvailable(e, axis, allowShift) {
  if (e.altKey || e.ctrlKey || e.metaKey || (e.shiftKey && !allowShift) || EDITING || DRAWER_OID || MOBILE_NAV_OPEN) return false;
  var combo = comboFromEvent(e);
  if (Object.keys(KEYMAP).some(function (id) { return KEYMAP[id] === combo; })) return false;
  if (SEL || (typeof SELSET !== "undefined" && SELSET.length)) return false;
  if (Object.keys(ROWSEL).some(function (grid) { return (ROWSEL[grid] || []).length; })) return false;
  var active = document.activeElement;
  if (active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable)) return false;
  if (document.querySelector("#modal.on,#viewer.on,#profile-menu,#palette,#ctxmenu")) return false;
  if (!NAV.some(function (section) { return section.k === SEC; }) && SEC !== "settings") return false;
  if (axis === "section-ext") return navVisibleSections().length + (subsOf("settings").length ? 1 : 0) >= 2;
  return axis === "section" ? navVisibleSections().length >= 2 : subsOf(SEC).length >= 2;
}
document.addEventListener("keydown", function (e) {
  var horiz = e.key === "ArrowLeft" || e.key === "ArrowRight";
  var vert = e.key === "ArrowUp" || e.key === "ArrowDown";
  if (!horiz && !vert) return;
  if (e.shiftKey) {
    if (!vert || !navArrowShortcutAvailable(e, "section-ext", true)) return;
    e.preventDefault();
    cycleNavSectionWithSettings(e.key === "ArrowUp" ? -1 : 1);
    return;
  }
  if (!navArrowShortcutAvailable(e, horiz ? "sub" : "section")) return;
  e.preventDefault();
  if (horiz) cycleNavSub(e.key === "ArrowLeft" ? -1 : 1);
  else cycleNavSection(e.key === "ArrowUp" ? -1 : 1);
});
function toggleSideNav() {
  if (mobileNavMode()) {
    MOBILE_NAV_OPEN = !MOBILE_NAV_OPEN;
    renderSideNav();
    return;
  }
  NAV_COLLAPSED = !NAV_COLLAPSED;
  document.body.classList.add("shell-animating");
  clearTimeout(toggleSideNav._motionTimer);
  toggleSideNav._motionTimer = setTimeout(function () { document.body.classList.remove("shell-animating"); }, 260);
  localStorage.setItem("navCollapsed", NAV_COLLAPSED ? "1" : "0");
  renderSideNav();
  if (typeof applyNavWidth === "function") applyNavWidth();
}
if (MOBILE_NAV_QUERY) {
  var navModeChanged = function () {
    MOBILE_NAV_OPEN = false;
    if (DB) renderSideNav();
  };
  if (MOBILE_NAV_QUERY.addEventListener) MOBILE_NAV_QUERY.addEventListener("change", navModeChanged);
  else if (MOBILE_NAV_QUERY.addListener) MOBILE_NAV_QUERY.addListener(navModeChanged);
}
function toggleNavSection(secKey) {
  NAV_OPEN_SEC = NAV_OPEN_SEC === secKey ? null : secKey;
  renderSideNav();
}
/* Database is one sidebar destination but remains a spreadsheet workspace:
   entities and sheets are navigated, renamed, added, and removed from this
   in-page strip. Existing .sub-tab handlers preserve those behaviors. */
function databaseTabsHtml() {
  var dbSubs = subsOf("database");
  var entities = dbSubs.filter(function (s) { return s.k.indexOf("sheet:") !== 0; });
  var sheets = dbSubs.filter(function (s) { return s.k.indexOf("sheet:") === 0; });
  function tab(s) {
    return '<button class="sub-tab" data-sub="' + s.k + '" aria-selected="' + (SUB === s.k) +
      '" role="tab">' + esc(s.t) + "</button>";
  }
  return '<div class="db-tabs" id="database-tabs" role="tablist" aria-label="Database sheets">' +
    entities.map(tab).join("") +
    '<button class="sub-tab addsheet" data-adddb="1" title="Add Database" aria-label="Add Database">+</button>' +
    '<span class="sub-div" aria-hidden="true"></span>' +
    sheets.map(tab).join("") +
    '<button class="sub-tab addsheet" data-addsheet="1" title="Add Sheet" aria-label="Add Sheet">+</button>' +
    "</div>";
}
function settingsTabsHtml() {
  return '<div class="db-tabs settings-tabs" id="settings-tabs" role="tablist" aria-label="Settings pages">' +
    subsOf("settings").map(function (s) {
      return '<button class="sub-tab" data-sub="' + s.k + '" aria-selected="' + (SUB === s.k) +
        '" role="tab">' + esc(s.t) + '</button>';
    }).join("") + '</div>';
}

/* ── Keyboard shortcuts (D59, simplified D231) ──────────────────────────────
   Sensible defaults, fully customizable per-device (localStorage until Supabase
   accounts). Shortcuts fire only when you're not typing in a field or editing a
   grid cell; modifier combos (Alt/Ctrl/Cmd) fire even over a selected cell.
   One key per action, rebindable in place (Record/Reset) — no more "add an
   extra key combo for an action you can already rebind" (CUSTOM_SHORTCUTS,
   dropped D231): Nate found it pointless once every base action already has
   its own Record button — a second binding for the same action was never
   actually useful, it just remapped the same thing twice. */
var BASE_SHORTCUTS = [
  { id: "undo", label: "Undo last action", def: /Mac|iPhone|iPad/.test(navigator.platform || "") ? "Meta+Z" : "Ctrl+Z" },
  { id: "redo", label: "Redo last action", def: /Mac|iPhone|iPad/.test(navigator.platform || "") ? "Shift+Meta+Z" : "Ctrl+Shift+Z" },
  { id: "delete", label: "Delete selected / current item", def: "Delete" },
  { id: "search", label: "Focus search", def: "F3" },
  { id: "sched", label: "Go to Scheduler", def: "Alt+S" },
  { id: "cw", label: "Go to Current Week", def: "Alt+W" },
  { id: "orders", label: "Go to Orders", def: "Alt+O" },
  { id: "billing", label: "Go to Billing", def: "Alt+B" },
  { id: "database", label: "Go to Database", def: "Alt+D" },
  { id: "reports", label: "Go to Reports", def: "Alt+R" },
  { id: "today", label: "Jump to today (Scheduler)", def: "Alt+T" },
  { id: "neworder", label: "New external order", def: "Alt+N" },
  { id: "bagorder", label: "New Bag Order number", def: "Alt+I" },
  { id: "xferorder", label: "New Internal Freight order", def: "Alt+F" },
  { id: "settings", label: "Open settings", def: "Alt+," }
];
var SHORTCUTS = BASE_SHORTCUTS;
var KEYMAP = (function () {
  var m = {}; SHORTCUTS.forEach(function (s) { m[s.id] = s.def; });
  try { var saved = JSON.parse(localStorage.getItem("keymap") || "{}");
    Object.keys(saved).forEach(function (k) {
      if (SHORTCUTS.some(function (s) { return s.id === k; })) m[k] = saved[k];
    }); } catch (e) {}
  if (m.search === "/") m.search = "F3";   // D73: retired the old "/" default for search
  return m;
})();
function saveKeymap() { localStorage.setItem("keymap", JSON.stringify(KEYMAP)); }
var RECORDING = null;
/* A stable, display-independent combo string from a keydown. */
function comboFromEvent(e) {
  if (["Control", "Alt", "Shift", "Meta"].indexOf(e.key) >= 0) return null;
  var mods = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Meta");
  var k = e.key;
  if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) k = e.code.slice(5);
  else if (k === " ") k = "Space";
  else if (k === "Backspace") k = "Delete"; // Mac labels its backward-delete key “Delete”
  else if (k.length === 1) k = k.toUpperCase();
  return mods.concat([k]).join("+");
}
function keyLabel(combo) {
  if (!combo) return "—";
  return combo.replace(/Meta/g, "⌘").replace(/Alt/g, "⌥").replace(/Shift/g, "⇧").replace(/Ctrl/g, "⌃").replace(/\+/g, " ");
}
function gotoSec(sec, sub) { SEC = sec; SUB = sub; SEL = null; render(); }
/* Route one Delete action to the currently meaningful destructive control.
   The existing buttons still own confirmation/guards; the shortcut only
   activates them. A selected spreadsheet range keeps Sheets behavior and is
   cleared through the undoable deleteSelection() path. */
function contextualDelete() {
  var focused = document.activeElement && document.activeElement.closest &&
    document.activeElement.closest("[data-delete-doc],[data-delrows],[data-orderdelrows]");
  if (focused && !focused.disabled) { focused.click(); return true; }
  // Order-tracker rows are deleted via the numbered-gutter multi-select now
  // (D159, replacing a per-row Delete button) — same "an enabled bulk-delete
  // button exists somewhere on screen" fallback the Database grids already use.
  var rowDelete = document.querySelector('[data-delrows]:not([disabled]),[data-orderdelrows]:not([disabled])');
  if (rowDelete) { rowDelete.click(); return true; }
  // A multi-cell marquee/shift-click range nulls SEL (setSel, 09-color.js) in
  // favor of SELSET — checking SEL alone here meant a selected RANGE fell
  // through to the "nothing to delete" toast below even though
  // deleteSelection() already handles SELSET correctly (D119 fix — caught
  // live: single-cell delete worked, a shift-click range didn't).
  var hasSel = SEL || (typeof SELSET !== "undefined" && SELSET.length);
  if (hasSel && typeof deleteSelection === "function") { deleteSelection(); return true; }
  toast("Select a row, cell, order, or document to delete", true);
  return false;
}
function runShortcut(id) {
  switch (id) {
    case "undo": histUndo(); break;
    case "redo": histRedo(); break;
    case "delete": contextualDelete(); break;
    case "search": var s = $("#gsearch"); if (s) { s.focus(); s.select(); } break;
    case "sched": gotoSec("dispatch", "sched"); break;
    case "cw": gotoSec("dispatch", "cw"); break;
    case "orders": gotoSec("orders", "int"); break;
    case "billing": gotoSec("billing", "bill"); break;
    case "database": gotoSec("database", "bagger"); break;
    case "reports": gotoSec("reports", "rep"); break;
    case "today": gotoSec("dispatch", "sched"); jumpTo(TODAY); break;
    case "settings": gotoSec("settings", "appearance"); break;
    case "neworder":
      api("order", { kind: "external" }).then(function (o) {
        return reload().then(function () { openOrder(o.id); toast("New order — fill it in"); });
      }).catch(function (err) { toast(err.message, true); });
      break;
    // Same one-click logic the Bag Orders/Internal Freight tracker toolbars
    // use for their own "+ Add" buttons (addBagOrderNumber/addTransferOrder,
    // 07-events.js) — callable from anywhere, not just while already on
    // that tracker (D231).
    case "bagorder": addBagOrderNumber(); break;
    case "xferorder": addTransferOrder(); break;
  }
}
document.addEventListener("keydown", function (e) {
  if (RECORDING) {
    if (["Control", "Alt", "Shift", "Meta"].indexOf(e.key) >= 0) return;  // wait for a real key
    e.preventDefault();
    if (e.key !== "Escape") {
      var c = comboFromEvent(e);
      if (c) {
        var conflict = Object.keys(KEYMAP).filter(function (id) { return KEYMAP[id] === c && id !== RECORDING; })[0];
        if (conflict) {
          delete KEYMAP[conflict];
          var oldAction = SHORTCUTS.filter(function (s) { return s.id === conflict; })[0];
          toast("Reassigned from " + (oldAction ? oldAction.label : conflict));
        }
        KEYMAP[RECORDING] = c; saveKeymap();
      }
    }
    RECORDING = null; render(); return;
  }
  var el = e.target;
  if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
  if (document.querySelector("#modal.on, #viewer.on")) return;
  var combo = comboFromEvent(e); if (!combo) return;
  var hasMod = e.altKey || e.ctrlKey || e.metaKey;
  var isFn = /^F\d{1,2}$/.test(combo);      // function keys (F3 search) fire even over a selected cell
  var hasRange = typeof SELSET !== "undefined" && SELSET.length;
  if (!hasMod && !isFn && (EDITING || SEL || hasRange)) return;  // single-key shortcuts yield to the grid
  var actionId = Object.keys(KEYMAP).filter(function (k) { return KEYMAP[k] === combo; })[0];
  if (actionId) { e.preventDefault(); runShortcut(actionId); }
});

function orderNumberSettings() {
  return (DB && DB.order_number_settings) || {
    internal_pattern: "07-{MM}{YY}-{####}", internal_department: "07",
    external_pattern: "12-{MM}{YY}-{####}", external_department: "12"
  };
}
function formatOrderNumber(pattern, month, year, sequence) {
  var m = String(month).padStart(2, "0"), y = String(year), seq = /\{(#+)\}/.exec(pattern || "");
  var out = String(pattern || "").replace(/\{MM\}/g, m).replace(/\{YYYY\}/g, y).replace(/\{YY\}/g, y.slice(-2));
  return seq ? out.replace(seq[0], String(sequence).padStart(seq[1].length, "0")) : out;
}
function orderPatternExample(pattern) {
  return formatOrderNumber(pattern, TODAY.slice(5, 7), TODAY.slice(0, 4), 1);
}
function externalOrderPlaceholder() { return orderPatternExample(orderNumberSettings().external_pattern); }
/* Pattern-aware "Starting #" prefill. The server repeats this check under a
   transaction lock, so simultaneous reservations cannot overlap. */
function nextInternalOrderStart(month, year) {
  var pattern = orderNumberSettings().internal_pattern || "07-{MM}{YY}-{####}";
  var seq = /\{(#+)\}/.exec(pattern); if (!seq) return 1;
  var marker = "__SEQ__", rendered = formatOrderNumber(pattern, month, year, marker);
  var escaped = rendered.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var numberRe = new RegExp("^" + escaped.replace(marker, "(\\d+)") + "$", "i"), max = 0;
  orders().forEach(function (o) {
    var found = numberRe.exec(o.solomon_order_no || "");
    if (found && +found[1] > max) max = +found[1];
  });
  return max + 1;
}

var WIN = {
  early:     { t: "EARLY",      c: "var(--early)",     label: "Early Store" },
  afternoon: { t: "AFTERNOON",  c: "var(--anytime)",   label: "Afternoon" },
  anytime:   { t: "ANYTIME",    c: "var(--anytime)",   label: "Anytime" },
  earlyE:    { t: "EARLY EAST", c: "var(--early-e)",   label: "Early EAST" },
  anytimeE:  { t: "ANY EAST",   c: "var(--anytime-e)", label: "Anytime EAST" },
  ext:       { t: "BROKER",     c: "var(--ext)",       label: "External / Broker" }
};
/* ═══ 02-chips-extract ═══ */
/* ── Lookups ─────────────────────────────────────────────────────────────── */
/* order()/party()/locFor()/locById() were a linear scan per call — fine at a
   few hundred rows, genuinely slow (found live, 2026-09-12, after the full
   2025/2026 schedule import: ~3700 orders) once buildChip's per-cell lookups
   ran across a scheduler window with real chip density on every day instead
   of mostly-empty months. Indexed by id (rebuilt once per render alongside
   CELLS/CATCOLOR, not per lookup) the same way — id maps are exact
   (unique ids can't collide); locFor keeps first-match-wins on a party_id
   with more than one location, matching the old linear scan's array order,
   since which location "the" designation location is for a multi-address
   party is meaningful and shouldn't silently flip to whichever loaded last. */
var ORDERS_BY_ID = {}, PARTIES_BY_ID = {}, LOCS_BY_ID = {}, LOCS_BY_PARTY = {};
function reindexLookups() {
  ORDERS_BY_ID = {}; (DB.orders || []).forEach(function (o) { ORDERS_BY_ID[o.id] = o; });
  PARTIES_BY_ID = {}; (DB.parties || []).forEach(function (p) { PARTIES_BY_ID[p.id] = p; });
  LOCS_BY_ID = {}; LOCS_BY_PARTY = {};
  (DB.locations || []).forEach(function (l) {
    LOCS_BY_ID[l.id] = l;
    if (l.party_id && !(l.party_id in LOCS_BY_PARTY)) LOCS_BY_PARTY[l.party_id] = l;
  });
}
function orders() { return DB.orders; }
function order(id) { return ORDERS_BY_ID[id] || null; }
function party(id) { return PARTIES_BY_ID[id] || null; }
function locFor(pid) { return LOCS_BY_PARTY[pid] || null; }
function departmentById(id) { return (DB.departments || []).filter(function (d) { return d.id === id; })[0] || null; }
function departmentsForPicker(currentId) {
  return (DB.departments || []).filter(function (d) { return !d.archived_at || d.id === currentId; });
}
/* An order row's *_party_id/*_department_id fields are FKs; their matching
   display name (customer_name/broker_name/transfer_department_name) is a
   server-side JOIN in the bootstrap query, NOT a column /api/order/update's
   `returning *` includes — so patching an order in place with that raw row
   (the D84 pattern every inline order-field editor uses, to avoid a full
   reload blowing away whatever's being tabbed into) leaves the old,
   now-stale display name sitting there until the next full reload. Called
   after any such patch so the chip/tracker/drawer show the new name
   immediately, not just the raw id. */
function applyOrderFkDenorm(o, field, value) {
  if (!o) return;
  if (field === "customer_party_id") o.customer_name = value ? (party(value) || {}).name || null : null;
  else if (field === "broker_party_id") o.broker_name = value ? (party(value) || {}).name || null : null;
  else if (field === "transfer_department_id")
    o.transfer_department_name = value ? (departmentById(value) || {}).name || null : null;
}
/* Every order currently sitting on the outside-carrier lane (D115), keyed by
   order id -> {carrierId, carrierCost}. Same one-map-per-render convention
   as placement(). Keyed off is_carrier (D122), not carrier_party_id — a
   freshly-dropped load sits here before it has a carrier name, and both the
   tracker's Carrier pill and the drawer's collapsible section need to know
   it's on the lane at all, not just once it's named. */
function carrierMap() {
  var m = {};
  DB.loads.forEach(function (l) {
    if (!l.is_carrier) return;
    (l.order_ids || []).forEach(function (oid) {
      m[oid] = { carrierId: l.carrier_party_id, carrierCost: l.carrier_cost };
    });
  });
  return m;
}
function locById(id) { return id ? (LOCS_BY_ID[id] || null) : null; }
/* Category color index (D72) — the editable legend, keyed by id. */
var CATCOLOR = {};
function buildCatColor() { CATCOLOR = {}; (DB.categories || []).forEach(function (c) { CATCOLOR[c.id] = c.color; }); }
/* Custom Database sheets (D74). */
function sheetById(id) { for (var i = 0; i < (DB.sheets || []).length; i++) if (DB.sheets[i].id === id) return DB.sheets[i]; return null; }
var SHEETCELLS = {};   // sheet_id -> { "r|c": {value,fmt} }
function buildSheetCells() {
  SHEETCELLS = {};
  (DB.sheet_cells || []).forEach(function (sc) {
    (SHEETCELLS[sc.sheet_id] = SHEETCELLS[sc.sheet_id] || {})[sc.r + "|" + sc.c] = { value: sc.value, fmt: sc.fmt || {} };
  });
}
/* Spreadsheet column label: 0->A, 25->Z, 26->AA … */
function colLetter(n) { var s = ""; n = +n; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; }
/* Per-cell formatting on the built-in Database grids (D76), keyed table|id|field. */
var GRIDFMT = {};
function buildGridFmt() {
  GRIDFMT = {};
  (DB.grid_cell_fmt || []).forEach(function (g) { GRIDFMT[g.table_name + "|" + g.row_id + "|" + g.field] = g.fmt || {}; });
}
function gridFmtOf(table, id, field) { return GRIDFMT[table + "|" + id + "|" + field] || {}; }
/* Conditional chip color for internal/bagger loads (D72): the fill comes LIVE
   from the bagger customer's designation, never the per-load stamp. An internal
   order names its bagger customer via `customer_party_id` (D65) — resolve that
   party to its location and read `category_id`. External orders return "" so the
   manual fmt/category path in chipHtml still applies. */
function designationColor(o) {
  if (!o || o.kind !== "internal") return "";
  var loc = o.customer_party_id ? locFor(o.customer_party_id) : null;
  var cid = loc && loc.category_id;
  return designationRuleColor(cid);
}
/* Internal Freight chip color (D127 follow-up #2) — per-department, same
   shape as Fleet's driver color field (departments.color, edited via the
   color chip in Database → Internal Freight, same Sheets-style picker).
   A department with no color set yet shows no fill. */
function transferChipColor(o) {
  var dept = o && o.transfer_department_id ? departmentById(o.transfer_department_id) : null;
  return (dept && dept.color && dept.color.charAt(0) === "#") ? dept.color : "";
}
function driver(id) { for (var i = 0; i < DB.drivers.length; i++) if (DB.drivers[i].id === id) return DB.drivers[i]; return null; }
function truckById(id) { for (var i = 0; i < DB.trucks.length; i++) if (DB.trucks[i].id === id) return DB.trucks[i]; return null; }
/* External push-coloring (D85 Phase 2): once a load's pushed_at is set (the
   driver-tab push, D37), its chip follows the truck's CURRENT driver color —
   reassignment-aware, not frozen at push time — instead of the pre-push
   fmt/category color. Internal stays purely designation-driven (D72). */
function pushColorFor(o, v) {
  if (!o || o.kind !== "external" || !v || !v.pushedAt || !v.truckId) return "";
  var t = truckById(v.truckId);
  return (t && t.driver_id && t.driver_color && String(t.driver_color).charAt(0) === "#") ? t.driver_color : "";
}
function docsFor(oid) { return DB.documents.filter(function (d) { return d.order_id === oid; }); }
function isExt(o) { return o && o.kind === "external"; }
/* Backfilled 2025 rows (D65) — real on the Scheduler and in Reports, but kept
   out of the working Orders grids and the biller queue so history doesn't flood
   the live workflow. */
function isHistorical(o) { return !!(o && o.custom && o.custom.source === "sheet2025"); }
/* Any sheet-imported order (2025 or the 2026 YTD backfill, D220) — used only
   for chip rendering (buildChip below). 2026 rows are NOT isHistorical: Nate
   wants them visible in Orders/Billing and eventually document-matched/
   billed like normal orders, unlike 2025's permanent read-only history. They
   still land with no broker/customer/pickup/delivery set though, so the
   chip needs the same raw-lane-text fallback 2025 already has, or it'd show
   a broken-looking "(no customer)" / "? -> ?" instead of anything useful. */
function isSheetImport(o) { return !!(o && o.custom && /^sheet20\d\d$/.test(o.custom.source || "")); }
/* A sheet-imported row that reconciliation has since resolved to a real
   broker (external) or customer (internal) — D221 continued, found live
   2026-09-12: buildChip's raw-lane-text fallback below keyed purely off
   isSheetImport, so a row reconcile_external_orders.py/reconcile_internal_
   orders.py had already matched still rendered its original raw note
   forever instead of a real chip, because reconciliation never clears
   custom.source. A transfer is excluded here — it already gets its own
   "Internal Freight · <department>" line further down and was never
   raw-text to begin with once reclassified. */
function sheetImportUnresolved(o) {
  if (!isSheetImport(o) || o.is_transfer) return false;
  return isExt(o) ? !o.broker_party_id : !o.customer_party_id;
}
/* Truck-off lookup, keyed "truck|date" -> note (D65). */
var OFFDAYS = {};
function buildOffDays() {
  OFFDAYS = {};
  (DB.truck_off_days || []).forEach(function (o) {
    OFFDAYS[o.truck_id + "|" + String(o.off_date).slice(0, 10)] = o.note || "Off";
  });
}
/* Day-note lookup, keyed by date -> {id, text} (D230). A dispatcher-only
   annotation on the date itself, not a truck/slot — never confuse with
   OFFDAYS (per-truck) or CELLS' schedule_notes (per-cell). */
var DAY_NOTES = {};
function buildDayNotes() {
  DAY_NOTES = {};
  (DB.day_notes || []).forEach(function (n) {
    DAY_NOTES[String(n.note_date).slice(0, 10)] = n;
  });
}
function dayNote(ds) { return DAY_NOTES[ds] || null; }
function cellKey(d, dt, s) { return d + "|" + dt + "|" + s; }

/* Where every order currently sits on the board. Keyed by truck (D32) — a
   truck has the permanent Scheduler spot, the driver riding it is whoever
   driver_truck_assignments currently says. */
function placement() {
  var map = {};
  DB.loads.forEach(function (l) {
    if (!l.scheduled_date || !l.slot) return;
    // Carrier-lane loads (D115) have no truck_id by design (loads_driver_
    // xor_carrier) — CARRIER_TID is their cell-key identity instead. Keyed
    // off is_carrier (D122), not carrier_party_id, so an unnamed carrier
    // load still renders on the lane instead of vanishing.
    var tid = l.is_carrier ? CARRIER_TID : l.truck_id;
    if (!tid) return;
    (l.order_ids || []).forEach(function (oid) {
      map[oid] = cellKey(tid, String(l.scheduled_date).slice(0, 10), l.slot);
    });
  });
  return map;
}
/* DAYSLOT: how many load-rows a given date needs (max slot used across trucks),
   so a day can grow past the default 3 when a truck has more loads (D65). */
var DAYSLOT = {};
/* Extra rows a day shows beyond its loads (D68) — "add a row to this day" for
   the rare 4th+ load on a truck. Right-click the date. */
var DAYADD = {}; // date -> explicit displayed slot count above the required minimum
function cellContents() {
  var m = {}; DAYSLOT = {};
  function bump(ds, slot) { if (slot > (DAYSLOT[ds] || 0)) DAYSLOT[ds] = slot; }
  DB.loads.forEach(function (l) {
    if (!l.scheduled_date || !l.slot) return;
    var tid = l.is_carrier ? CARRIER_TID : l.truck_id;
    if (!tid) return;
    var ds = String(l.scheduled_date).slice(0, 10);
    var k = cellKey(tid, ds, l.slot);
    if ((l.order_ids || []).length) {
      m[k] = { oid: l.order_ids[0], cat: l.cat_color || "",
               catId: l.category_id || "", fmt: l.fmt || {}, truckId: l.truck_id, pushedAt: l.pushed_at,
               carrierId: l.carrier_party_id, carrierCost: l.carrier_cost };
      bump(ds, l.slot);
    }
  });
  DB.notes.forEach(function (n) {
    var ds = String(n.scheduled_date).slice(0, 10);
    m[cellKey(n.truck_id, ds, n.slot)] = { text: n.body, cat: n.cat_color || "", catId: n.category_id || "", fmt: n.fmt || {} };
    bump(ds, n.slot);
  });
  return m;
}
var CELLS = {};
/* A cell entry with no .oid is a plain schedule_notes row (text and/or fmt/
   category, no real load) — distinct from a real placed load. Drag/drop
   (D250) treats only a real load as "occupied"; a text-only cell is a valid
   drop target that gets replaced. */
function cellHasLoad(key) { return !!(CELLS[key] && CELLS[key].oid); }

/* ── Chip construction — built, never stored ─────────────────────────────── */
function buildChip(o) {
  var flags = [], notes = [], win = "anytime", title, line, route, nums;
  /* Backfilled sheet rows (D65, extended D220) carry the raw sheet lane text
     and no broker/order number — show the lane text plainly, the way the old
     sheet read, instead of "(no broker) / NO ORDER #". */
  if (sheetImportUnresolved(o)) {
    return { title: o.notes || "(load)", line: o.customer_name || "",
             win: isExt(o) ? "ext" : "anytime", flags: [], note: "", needsNumber: false };
  }
  if (isExt(o) && o.is_transfer) {
    win = "ext";
    title = o.notes || "(no load info)";
    line = "Internal Freight · " + (o.transfer_department_name || "(no department)");
  } else if (isExt(o)) {
    win = "ext";
    title = o.broker_name || "(no customer)";
    /* City → City is the single most-scanned field on an external chip
       (Nate, dashboard-only — this never reaches Sheets/drivers) — it gets
       its own bold, slightly-larger line plus the state, and the load#/
       order# pair moves to a second line so neither one gets cut off
       squeezed onto a single joined string (chipHtml's meta-2line-route
       branch below renders route/nums as two real lines). */
    var origin = locById(o.pickup_location_id), drop = locById(o.delivery_location_id);
    var originTxt = origin && origin.city ? origin.city + (origin.state ? ", " + origin.state : "") : "?";
    var dropTxt = drop && drop.city ? drop.city + (drop.state ? ", " + drop.state : "") : "?";
    route = originTxt + " → " + dropTxt;
    if (o.route_mode === "custom") route += " · " + routeCompactLabel(o);
    nums = (o.broker_load_no || "no load #") + " / " + (o.solomon_order_no || "no order #");
    line = route + " · " + nums;
    if (o.tarp) flags.push("TARP");
    if (o.notes) notes.push(o.notes);
  } else {
    title = o.customer_name || "(no customer)";
    line = (o.pallet_count ? o.pallet_count + " PAL · " : "") + (o.solomon_order_no || "no order #");
    var loc = o.customer_party_id ? locFor(o.customer_party_id) : null;
    if (loc) {
      // EAST/Umatilla is a separate is_umatilla boolean (D36), NOT a timing_window
      // value — the old `=== "umatilla"` check never matched, so EAST cells lost
      // their color (D82). timing_window is early/anytime only.
      var east = loc.is_umatilla;
      win = loc.timing_window === "early" ? (east ? "earlyE" : "early") : (east ? "anytimeE" : "anytime");
      if (loc.timing_window) flags.push(String(loc.timing_window).toUpperCase());
      /* Color/designation already communicates the lane. The equipment badge
         says only what the driver needs: forklift, Spyder, or no forklift. */
      if (loc.forklift) {
        var fork = String(loc.forklift).trim().toLowerCase();
        if (fork === "nf" || fork === "none" || fork === "no" || fork === "no forklift") flags.push("NO FORKLIFT");
        else if (fork.indexOf("spyder") >= 0) flags.push("SPYDER");
        else flags.push("FORKLIFT");
      }
      if (loc.notes) notes.push(loc.notes);
    }
    if (o.notes) notes.push(o.notes); // this dispatch's own note, from the drawer — D34
  }
  return { title: title, line: line, route: route, nums: nums, win: win, flags: flags,
           note: notes.join(" · "), needsNumber: !o.solomon_order_no && !o.is_transfer };
}
function chipHtml(o, drag, extra, catColor, fmt, pushColor) {
  var ch = buildChip(o), w = WIN[ch.win] || WIN.anytime;
  fmt = fmt || {};
  // Driver tab note (D140) — the one note that's actually pushed to the
  // driver's Sheets tab, same field on every order kind. o.notes ("Load
  // Info") is the separate dispatcher-private note (ch.note above) and
  // never shows here.
  var dispatchNote = o.driver_note || "";
  /* Fill precedence: internal/bagger loads are PURELY designation-driven (D72) —
     the delivery customer's designation color wins and the per-load fmt/category
     is ignored. Internal Freight transfers (D127 follow-up #2) are purely their
     department's static color (departments.color, per-department, same tier as
     designation) — no push/fmt/category override. External loads: once pushed,
     the truck's current driver color wins (D85 Phase 2); pre-push keeps the D67
     rule — hand-painted fmt.fill, else the per-load category color, else the
     derived timing edge. */
  var dsg = designationColor(o);
  var fill = (o && o.is_transfer) ? transferChipColor(o)
           : dsg ? dsg
           : (o && o.kind === "internal") ? ""   // internal, no designation set yet
           : (pushColor && pushColor.charAt(0) === "#") ? pushColor
           : (fmt.fill && fmt.fill.charAt(0) === "#") ? fmt.fill
           : (catColor && catColor.charAt(0) === "#") ? catColor : "";
  var filled = !!fill;
  var edge = fill || w.c;
  var textc = (fmt.text && fmt.text.charAt(0) === "#") ? fmt.text : (filled ? textOn(fill) : "");
  var ws = "";
  if (textc) ws += "color:" + textc + ";";
  if (fmt.bold) ws += "font-weight:800;";
  if (fmt.italic) ws += "font-style:italic;";
  if (fmt.size) { var _fs = parseInt(fmt.size, 10); if (_fs > 0) ws += "font-size:" + _fs + "px;"; }
  var bg = filled ? ";background:" + fill + (textc ? ";color:" + textc : "") : "";
  var chipTitle = [ch.title, ch.line].concat(ch.flags || []).concat(ch.note ? [ch.note] : [])
    .concat(dispatchNote ? [dispatchNote] : []).filter(Boolean).join(" · ");
  /* Timing (EARLY/ANYTIME) uses the same high-contrast callout as EAST,
     forklift, and tarp. A timing-colored badge disappeared into a filled
     designation chip when the two colors were close. */
  var f = ch.flags.map(function (x) {
    return '<span class="flag">' + esc(x) + "</span>";
  }).join("");
  if (ch.needsNumber) f += '<span class="flag warn" title="No Rexius order number">NO ORDER #</span>';
  /* Internal (Bag Orders) chips: PAL count and Solomon # on their own lines,
     not joined into one "24 PAL · 07-0826-0100" string (Nate, live) — the
     joined form let the browser's default line-breaking treat the order
     number's hyphens as break points, splitting it mid-string when the
     chip ran narrow. .meta-2line stacks unconditionally (not a width-
     dependent wrap) and .nowrap keeps the order number itself atomic, so
     it always moves to its own line whole, never splits. Scoped to
     kind==='internal' only — Internal Freight transfers keep the single
     joined .meta line (they don't have a real pickup/delivery route).
     External (non-transfer) chips get their own two-line layout (dashboard
     only, never Sheets/drivers, Nate: "city to city is one of the most
     important things im looking at as i scan") — city/state route on its
     own bold, slightly-larger line via .meta-route, load#/order# below it
     on the normal small line so neither gets cut off squeezed into one
     joined string. */
  var metaHtml = (o.kind === "internal" && !o.is_transfer)
    ? '<div class="meta meta-2line">' +
        (o.pallet_count ? "<span>" + esc(o.pallet_count) + " PAL</span>" : "") +
        '<span class="nowrap">' + esc(o.solomon_order_no || "no order #") + "</span></div>"
    : (isExt(o) && !o.is_transfer)
    ? '<div class="meta meta-2line meta-route"><span class="route-line">' + esc(ch.route) +
        '</span><span class="nowrap">' + esc(ch.nums) + "</span></div>"
    : '<div class="meta"><span>' + esc(ch.line) + "</span></div>";
  return '<div class="chip' + (filled ? " filled" : "") + '" style="--edge:' + edge + bg + '" draggable="' + (drag ? "true" : "false") +
    '" data-oid="' + o.id + '" title="' + esc(chipTitle) + '" ' + (extra || "") + ">" +
    '<div class="who"' + (ws ? ' style="' + ws + '"' : "") + ">" + esc(ch.title) + "</div>" +
    metaHtml +
    (f ? '<div class="flags">' + f + "</div>" : "") +
    (ch.note ? '<div class="note">&#9873; ' + esc(ch.note) + "</div>" : "") +
    /* Driver tab note (D140) — the pushed note, distinct from ch.note above
       (dispatcher-private, customer/location-derived, never pushed). */
    (dispatchNote ? '<div class="dnote">&#9998; ' + esc(dispatchNote) + "</div>" : "") + "</div>";
}

/* ── Dates ───────────────────────────────────────────────────────────────── */
var DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
var MON = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
function iso(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { var r = new Date(d); r.setUTCDate(r.getUTCDate() + n); return r; }
/* MM/DD/YYYY display <-> ISO, for the smart date-range inputs (D151). */
function isoToMdy(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  var p = iso.split("-");
  return p[1] + "/" + p[2] + "/" + p[0];
}
/* Parses whatever's currently typed into MM/DD/YYYY digits — "8/22/2026",
   "08222026", "8-22-26", mid-typing "8/22" — into an ISO date. A missing
   or 2-digit year is inferred: 2-digit expands to 2000+YY; a fully absent
   year falls back to fallbackIso's year (the field's own last real value)
   else today's real year — so "8 [advance] 22 [commit]" alone is enough,
   matching Nate's ask, without forcing a third segment. Returns "" if
   month/day can't be read at all. */
function mdyToIso(text, fallbackIso) {
  var digits = (text || "").replace(/\D/g, "");
  if (digits.length < 3) return "";
  var mm, dd, yy;
  if (digits.length >= 4) { mm = digits.slice(0, 2); dd = digits.slice(2, 4); yy = digits.slice(4, 8); }
  else { mm = digits.slice(0, 1); dd = digits.slice(1, 3); yy = ""; }  // exactly 3 digits: "822" -> 8/22
  var m = parseInt(mm, 10), d = parseInt(dd, 10);
  if (!m || !d || m > 12 || d > 31) return "";
  var y;
  if (yy.length === 4) y = parseInt(yy, 10);
  else if (yy.length === 2) y = 2000 + parseInt(yy, 10);
  else {
    var fb = fallbackIso && /^\d{4}-\d{2}-\d{2}$/.test(fallbackIso) ? fallbackIso.slice(0, 4) : null;
    y = fb ? parseInt(fb, 10) : new Date().getFullYear();
  }
  var mmS = String(m).padStart(2, "0"), ddS = String(d).padStart(2, "0");
  return y + "-" + mmS + "-" + ddS;
}

/* ── PDF extraction — ported from legacy/invoicing-local ─────────────────── */
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

function pdfText(b64) {
  if (!window.pdfjsLib) return Promise.resolve("");
  return pdfjsLib.getDocument({ data: bytesFromB64(b64) }).promise.then(function (pdf) {
    var jobs = [];
    for (var p = 1; p <= pdf.numPages; p++) jobs.push(pdf.getPage(p).then(function (pg) {
      return pg.getTextContent().then(function (c) { return c.items.map(function (i) { return i.str; }).join(" "); });
    }));
    return Promise.all(jobs).then(function (a) { return a.join("\n"); });
  }).catch(function () { return ""; });
}

/* ── OCR fallback for scanned rate cons (Phase 4, D27) ──────────────────────
   Scanned PDFs have no text layer at all — pdf.js returns nothing, as it does
   on fixtures/Rosboro 884895.pdf (D6). Vendored the same way as pdf.js: a
   Tesseract.js worker running fully client-side against the vendored English
   model, so this works offline and needs no server or cloud OCR account. */
var OCR_WORKER = null;
function getOcrWorker() {
  if (!window.Tesseract) return Promise.reject(new Error("OCR engine not loaded"));
  if (!OCR_WORKER) {
    var base = new URL("vendor/", location.href).href; // must be absolute — the worker's own base URL is a blob:, so relative paths don't resolve. Relative to the page so a sub-path static host works.
    OCR_WORKER = Tesseract.createWorker("eng", 1, {
      workerPath: base + "worker.min.js",
      corePath: base + "tesseract-core.wasm.js",
      langPath: base.slice(0, -1),
      gzip: true
    });
  }
  return OCR_WORKER;
}
function pdfPageImage(pdf, pageNum) {
  return pdf.getPage(pageNum).then(function (page) {
    var viewport = page.getViewport({ scale: 2.5 }); // upscaled for OCR legibility
    var canvas = document.createElement("canvas");
    canvas.width = viewport.width; canvas.height = viewport.height;
    return page.render({ canvasContext: canvas.getContext("2d"), viewport: viewport }).promise
      .then(function () { return canvas.toDataURL("image/png"); });
  });
}
function ocrPdf(b64, onProgress) {
  if (!window.Tesseract || !window.pdfjsLib) return Promise.resolve("");
  return pdfjsLib.getDocument({ data: bytesFromB64(b64) }).promise.then(function (pdf) {
    return getOcrWorker().then(function (worker) {
      var pages = []; for (var i = 1; i <= pdf.numPages; i++) pages.push(i);
      return pages.reduce(function (chain, n) {
        return chain.then(function (acc) {
          if (onProgress) onProgress(n, pdf.numPages);
          return pdfPageImage(pdf, n).then(function (dataUrl) {
            return worker.recognize(dataUrl).then(function (r) { return acc + "\n" + (r.data.text || ""); });
          });
        });
      }, Promise.resolve(""));
    });
  }).catch(function (e) { console.error("OCR failed", e); return ""; });
}

/* normBroker / GENERIC_SET / distinctiveTokens / matchBrokerForFile —
   legacy/invoicing-local/index.html:1500, :1539, :1552, :1567 */
var STRIP_WORDS = /\b(INC|LLC|CO|CORP|LTD|INCORPORATED|COMPANY|COMPANIES|INDUSTRIES|INDUSTRY|TRANSPORTATION|TRANSPORT|LOGISTICS|LOGISTIC|FREIGHT|TRUCKING|TRUCK|SERVICES|SERVICE|GROUP|INTERNATIONAL|INTL|SUPPLY|ENTERPRISES|ENTERPRISE|BROKER|BROKERS|BROKERAGE|CARRIER|CARRIERS|DISTRIBUTION|WAREHOUSING|HOLDINGS)\b/g;
var GENERIC_SET = (function () {
  var m = {};
  ("INC LLC CO CORP LTD INCORPORATED COMPANY COMPANIES INDUSTRIES INDUSTRY TRANSPORTATION TRANSPORT " +
   "LOGISTICS LOGISTIC FREIGHT TRUCKING TRUCK SERVICES SERVICE GROUP INTERNATIONAL INTL SUPPLY " +
   "ENTERPRISES ENTERPRISE BROKER BROKERS BROKERAGE CARRIER CARRIERS DISTRIBUTION WAREHOUSING HOLDINGS " +
   "THE AND OF INVOICE INVOICES INV LOAD LOADS POD PODS RATECON REXIUS FINAL COPY SIGNED SCAN SCANNED " +
   "DOC DOCUMENT PACKAGE PKG BILLING PAID").split(" ").forEach(function (w) { m[w] = 1; });
  return m;
})();
function normBroker(s) {
  return (s || "").toUpperCase().replace(/\+\+.*$/, "").replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\b\d+\b/g, " ").replace(STRIP_WORDS, " ").replace(/\s+/g, " ").trim();
}
function distinctiveTokens(s) {
  var raw = (s || "").toUpperCase().replace(/\+\+.*$/, "").replace(/[^A-Z0-9]+/g, " ").trim();
  if (!raw) return [];
  var toks = raw.split(/\s+/);
  var sig = toks.filter(function (t) { return t.length >= 2 && !/^[0-9]+$/.test(t) && !GENERIC_SET[t]; });
  if (!sig.length) sig = toks.filter(function (t) { return t && !/^[0-9]+$/.test(t); });
  var seen = {}, out = [];
  sig.forEach(function (t) { if (!seen[t]) { seen[t] = 1; out.push(t); } });
  return out;
}
/* The legacy app matched against the whole "outside customer list" tab, which is
   the AP-billing directory — it holds mills and direct customers, not just
   brokers. Rate con filenames are often the MILL ("Rosboro 884895"), so
   filtering to is_broker only would miss them. Match the same population. */
function brokerList() {
  return DB.parties.filter(function (p) {
    return (p.is_broker && !p.broker_archived_at) ||
      (p.is_customer && !p.customer_archived_at);
  });
}
function findBroker(raw) {                       // Jaccard, threshold 0.45
  var inv = normBroker(raw); if (!inv) return null;
  var best = null, bestScore = 0;
  brokerList().forEach(function (b) {
    var br = normBroker(b.name); if (!br) return;
    var score;
    if (inv === br) score = 1;
    else if (inv.indexOf(br) !== -1 || br.indexOf(inv) !== -1) score = 0.9;
    else {
      var iw = {}, bw = {}, inter = 0, union = 0;
      inv.split(/\s+/).forEach(function (w) { if (w) iw[w] = 1; });
      br.split(/\s+/).forEach(function (w) { if (w) bw[w] = 1; });
      Object.keys(iw).forEach(function (w) { union++; if (bw[w]) inter++; });
      Object.keys(bw).forEach(function (w) { if (!iw[w]) union++; });
      score = union > 0 ? inter / union : 0;
    }
    if (score > bestScore) { bestScore = score; best = b; }
  });
  return bestScore >= 0.45 ? { broker: best, score: bestScore } : null;
}
function matchBrokerForFile(text) {              // token coverage, threshold 0.4
  var ft = distinctiveTokens(text); if (!ft.length) return null;
  var fset = {}; ft.forEach(function (t) { fset[t] = 1; });
  var best = null, bestScore = 0, bestShared = 0;
  brokerList().forEach(function (b) {
    var bt = distinctiveTokens(b.name); if (!bt.length) return;
    var shared = 0; bt.forEach(function (t) { if (fset[t]) shared++; });
    if (!shared) return;
    var score = (shared / ft.length) * 0.7 + (shared / bt.length) * 0.3;
    if (score > bestScore || (score === bestScore && shared > bestShared)) {
      bestScore = score; bestShared = shared; best = b;
    }
  });
  return best && bestScore >= 0.4 ? { broker: best, score: bestScore } : null;
}
/* parseRateCon — legacy :2404. Tightened against a set of 11 real broker
   rate cons plus the existing Rosboro scan (D104-adjacent, 2026-08-17): a
   strict label match is tried first for every term; "pro" gets a second,
   looser colon-only pattern because carriers routinely render "Pro: 702229"
   with no "#"/"No." marker for OCR to lose in the first place. "trip" was
   entirely missing. Every captured token must contain at least one digit
   (NUMTOK) — without that, a stray "Order Number" table header or "PO
   Number:" label with no value on the same line gets captured as if IT were
   the identifier (confirmed on two real fixtures). Numbers may carry a
   comma (a real Trip # rendered "206,775") — stripped after capture so
   load_no matching stays comma-free and consistent with the filename-digit
   fallback below.
   Tightened again (2026-09-18) against the 133 real rate cons already
   matched by the D225 scanned-batch pipeline (the answer key: which order
   each one really belongs to is already known) — two more label families
   confirmed live and added ahead of "trip"/"order" so they win when a
   document prints more than one number: Tradewinds' template always shows
   "Trip #: 206,775" directly above "Freight Bill #: B179452" — Trip # is
   the carrier's own scratch number, Freight Bill # is what actually gets
   filed under broker_load_no, so it must win when both are present.
   Nationwide's template splits "Our Billing #" from its value across a
   flattened two-column table — OCR reads "Our Billing # :" then the
   unrelated "Company :" label, THEN the real number — every one of ~26
   real Nationwide fixtures showed this exact interleaving. */
var NUMTOK = "(?=[A-Z0-9,\\-]*[0-9])([A-Z0-9][A-Z0-9,\\-]{2,})";
var LOAD_PATS = [
  new RegExp("freight\\s*bill\\s*(?:#|num(?:ber)?|no\\.?)\\s*:?\\s*" + NUMTOK, "i"),
  new RegExp("our\\s*billing\\s*#?\\s*:?\\s*(?:company\\s*:?\\s*)?" + NUMTOK, "i"),
  new RegExp("load\\s*(?:#|num(?:ber)?|no\\.?)\\s*:?\\s*" + NUMTOK, "i"),
  new RegExp("trip\\s*(?:#|num(?:ber)?|no\\.?)\\s*:?\\s*" + NUMTOK, "i"),
  new RegExp("order\\s*(?:#|num(?:ber)?|no\\.?)\\s*:?\\s*" + NUMTOK, "i"),
  new RegExp("pro\\s*(?:#|num(?:ber)?|no\\.?)\\s*:?\\s*" + NUMTOK, "i"),
  new RegExp("\\bpro\\s*:\\s*" + NUMTOK, "i"),
  new RegExp("confirmation\\s*(?:#|num(?:ber)?|no\\.?)\\s*:?\\s*" + NUMTOK, "i"),
  new RegExp("dispatch\\s*(?:#|num(?:ber)?|no\\.?)\\s*:?\\s*" + NUMTOK, "i"),
  new RegExp("shipment\\s*(?:#|num(?:ber)?|no\\.?)\\s*:?\\s*" + NUMTOK, "i"),
  new RegExp("ref(?:erence)?\\s*(?:#|num(?:ber)?|no\\.?)\\s*:?\\s*" + NUMTOK, "i")
];
var SOLOMON = /\d{2}-\d{4}-\d{4}/;              /* legacy tms Code.js:517, :876 */

/* Tiered so dense boilerplate (rate-adjustment clauses, non-compete
   penalties, weight/volume totals) can't out-rank the real total: a
   confirmed real-fixture bug had "decrease the Agreed Rate by $100.00" beat
   the actual $1,000.00 total because both matched a single generic
   "rate...$" pattern and the first hit in the text always won. Each tier
   here requires a "$" or "USD" marker except the final catch-all (which
   keeps the original loose behavior as a last resort) — that's what keeps
   "Total Weight 61,206" (no currency marker) from ever being mistaken for a
   dollar amount, confirmed against the real Rosboro fixture. */
var CUR = "(?:\\$|USD)\\s*";
var RATE_PATS = [
  new RegExp("\\btotal\\s*pay\\b\\D{0,15}" + CUR + "([0-9][0-9,]*\\.?[0-9]{0,2})", "i"),
  new RegExp("\\bgrand\\s*total\\b\\D{0,15}" + CUR + "([0-9][0-9,]*\\.?[0-9]{0,2})", "i"),
  new RegExp("\\bnet\\s*pay\\b\\D{0,15}" + CUR + "([0-9][0-9,]*\\.?[0-9]{0,2})", "i"),
  new RegExp("\\btotal\\s*(?:cost|charges?|freight)\\b\\D{0,15}" + CUR + "([0-9][0-9,]*\\.?[0-9]{0,2})", "i"),
  new RegExp("\\bagreed\\s*(?:rate|amount)\\D{0,15}" + CUR + "([0-9][0-9,]*\\.?[0-9]{0,2})", "i"),
  new RegExp("\\btotal\\b\\D{0,15}" + CUR + "([0-9][0-9,]*\\.?[0-9]{0,2})", "i"),
  /\b(?:rate|amount|linehaul|pay|flat)\D{0,12}\$?\s*([0-9][0-9,]*\.?[0-9]{0,2})/i
];

function parseRateCon(text, filename) {
  var out = { broker: "", load_no: "", solomon: "", po: "", rate: null, source: [] };
  for (var i = 0; i < LOAD_PATS.length; i++) {
    var m = text.match(LOAD_PATS[i]);
    if (m) { out.load_no = m[1].replace(/,/g, ""); out.source.push("load# from text"); break; }
  }
  var sm = text.match(SOLOMON);
  if (sm) { out.solomon = sm[0]; out.source.push("solomon# from text"); }
  /* "Purchase Order" is a common spelled-out alias for "PO" across the ITS
     Dispatch rate-con family (Bob Murray/Jenks/Witham) — missing it meant
     the PO field silently stayed blank on real fixtures that never use the
     literal letters "PO". (?![A-Za-z]) keeps bare "PO" from matching as a
     prefix of an unrelated word — a confirmed real false-positive: an
     address line reading "...PORTLAND OR, 97217" was being read as "PO" +
     "RTLAND" and captured "RTLAND" as the PO number. The negative lookahead
     separately skips "PO Box 872" (a mailing address, not a PO #) — the
     original confirmed false-positive (D27); the engine just keeps scanning
     for a genuine PO mention elsewhere in either case. */
  var pm = text.match(/\b(?:PO|P\.O\.|Purchase\s*Order)(?![A-Za-z])\s*#?\s*[:\-]?\s*(?!BOX\b)(?=[A-Z0-9\-]*[0-9])([A-Z0-9\-]{3,})/i);
  if (pm) { out.po = pm[1]; out.source.push("PO from text"); }
  for (var r = 0; r < RATE_PATS.length; r++) {
    var rm = text.match(RATE_PATS[r]);
    if (rm) { out.rate = parseFloat(rm[1].replace(/,/g, "")); out.source.push("rate from text"); break; }
  }

  /* Rank literal-name hits by where they occur, not by party-table array
     order (found live, 2026-09-18, on a real fixture): a rate con almost
     always mentions more than one real party by name — the broker's own
     letterhead up top, then the actual pickup/delivery location further
     down (e.g. a real "Clarkes Sheet Metal" pickup stop on a real Inland
     Transport rate con) — and the old first-array-match logic picked
     whichever party happened to sit earlier in DB.parties, ignoring which
     one the document was actually FROM. The broker/sender name is reliably
     the earliest such match in practice, so the earliest index wins. */
  var hit = null, hitIdx = Infinity, lower = (text || "").toLowerCase();
  brokerList().forEach(function (b) {
    if (!b.name) return;
    var idx = lower.indexOf(b.name.toLowerCase());
    if (idx !== -1 && idx < hitIdx) { hitIdx = idx; hit = { broker: b, score: 1 }; }
  });
  if (hit) out.source.push("broker by name in text");
  /* Scanned rate cons have no text layer at all — the filename is the only
     signal left, and it measured better than text on the real fixture (D7). */
  if (!hit && filename) { hit = matchBrokerForFile(filename); if (hit) out.source.push("broker from filename"); }
  if (!hit && text) { hit = findBroker(text.slice(0, 400)); if (hit) out.source.push("broker fuzzy from text"); }
  if (hit) out.broker = hit.broker.name;
  if (!out.load_no && filename) {
    var fm = filename.match(/\b(\d{5,9})\b/);
    if (fm) { out.load_no = fm[1]; out.source.push("load# from filename"); }
  }
  /* Best-effort pickup/delivery from the body (D42). Rate cons vary wildly
     and scanned ones are OCR-noisy, so this only pre-fills the confirm combo
     — Nate always confirms/overrides. Anchors on the usual labels, grabs a
     name-ish line and a "City, ST" near it. */
  out.pickup = extractStop(text, ["shipper", "pick\\s*up", "pickup", "origin", "\\bPU\\b"]);
  out.delivery = extractStop(text, ["consignee", "deliver(?:y|ery)?", "receiver", "drop", "destination", "\\bDEL\\b"]);
  out.stops = extractAllStops(text);
  if (out.pickup && (out.pickup.city || out.pickup.name)) out.source.push("pickup from text");
  if (out.delivery && (out.delivery.city || out.delivery.name)) out.source.push("delivery from text");
  return out;
}
/* Conservative multi-stop detector. It never changes an order automatically;
   it only records possible repeated stop blocks so the drawer can tell Nate to
   review the advanced route. That keeps noisy broker PDFs out of the normal
   workflow while still surfacing the rare exception. */
function extractAllStops(text) {
  if (!text) return [];
  var re = /\b(pick\s*up|pickup|shipper|origin|consignee|deliver(?:y|ery)?|receiver|drop(?:\s*off)?|destination)\b/ig;
  var hits = [], m;
  while ((m = re.exec(text)) && hits.length < 20) hits.push({ index: m.index, label: m[0] });
  var out = [], seen = {};
  hits.forEach(function (hit, i) {
    var chunk = text.slice(hit.index, hits[i + 1] ? hits[i + 1].index : hit.index + 220);
    var pickup = /^(pick\s*up|pickup|shipper|origin)$/i.test(hit.label.trim());
    var parsed = extractStop(chunk, [pickup ? "pick\\s*up|pickup|shipper|origin" : "consignee|deliver(?:y|ery)?|receiver|drop(?:\\s*off)?|destination"]);
    if (!parsed) return;
    var key = (pickup ? "pickup" : "delivery") + "|" + (parsed.name || "").toLowerCase() + "|" + (parsed.city || "").toLowerCase();
    if (seen[key]) return; seen[key] = true;
    parsed.stop_type = pickup ? "pickup" : "delivery"; out.push(parsed);
  });
  return out;
}
function extractStop(text, labels) {
  if (!text) return null;
  var re = new RegExp("(?:" + labels.join("|") + ")", "i");
  var m = re.exec(text);
  if (!m) return null;
  var chunk = text.slice(m.index, m.index + 180);
  var cs = chunk.match(/([A-Za-z][A-Za-z .'\-]{2,30}),\s*([A-Z]{2})\b/); // "City, ST"
  var after = chunk.slice(m[0].length).replace(/^[\s:;,\-]+/, "");
  var nm = after.match(/([A-Z][A-Za-z0-9 &.'\-]{2,40})/);
  var name = nm ? nm[1].replace(/\s+/g, " ").trim() : "";
  var city = cs ? cs[1].replace(/\s+/g, " ").trim() : "";
  var state = cs ? cs[2] : "";
  if (!name && !city) return null;
  return { name: name, city: city, state: state };
}
/* extractInvoiceInfo — legacy :1738, position-aware then regex fallback.
   Real invoice batches (D225's 326 already-matched fixtures, tested
   2026-09-18) are scanned/faxed pages with NO embedded text layer at
   all — pdf.js's getTextContent() found nothing on every single one,
   so this always fell through to a blank "Invoice N" pill needing 100%
   manual drag-to-match. Same OCR fallback ingestRateCon already has
   (D7/D27): a thin text layer triggers ocrPdf(), then the same
   invoice#/solomon regexes run again against the OCR'd text — the
   position-aware item-coordinate pass only makes sense against a real
   text layer, so it's skipped on the OCR path. */
function extractInvoiceInfo(b64) {
  if (!window.pdfjsLib) return Promise.resolve({ invoiceNum: null, customerName: null });
  return pdfjsLib.getDocument({ data: bytesFromB64(b64) }).promise.then(function (pdf) {
    return pdf.getPage(1).then(function (page) {
      return page.getTextContent().then(function (content) {
        var items = content.items, W = page.view[2], H = page.view[3];
        var str = function (i) { return (i.str || "").trim(); };
        var invoiceNum = null, i, j;
        for (i = 0; i < items.length; i++) {
          if (/invoice\s*no\.?/i.test(str(items[i]))) {
            var same = str(items[i]).match(/invoice\s*no\.?\s*([0-9]{4,10})/i);
            if (same) { invoiceNum = same[1]; break; }
            for (j = i + 1; j < Math.min(i + 5, items.length); j++) {
              if (/^[0-9]{4,10}$/.test(str(items[j]))) { invoiceNum = str(items[j]); break; }
            }
            if (invoiceNum) break;
          }
        }
        if (!invoiceNum) {
          var c = [];
          items.forEach(function (it) {
            var s = str(it);
            if (/^[0-9]{5,8}$/.test(s) && it.transform[4] > W * 0.5 && it.transform[5] > H * 0.65)
              c.push({ num: s, x: it.transform[4], y: it.transform[5] });
          });
          c.sort(function (a, b) { return b.y - a.y || b.x - a.x; });
          if (c.length) invoiceNum = c[0].num;
        }
        var full = items.map(function (i2) { return i2.str; }).join(" ");
        if (!invoiceNum) {
          var fm = full.match(/Invoice\s*(?:No\.?|#|Number)\s*[:\s]\s*([0-9]{4,10})/i);
          if (fm) invoiceNum = fm[1];
        }
        var sm = full.match(SOLOMON);
        var thin = full.replace(/\s/g, "").length < 40;
        if (thin) {
          return ocrPdf(b64).then(function (ocrText) {
            if (ocrText.replace(/\s/g, "").length < 20) return { invoiceNum: invoiceNum, solomon: sm ? sm[0] : null, text: full };
            var ocrInv = ocrText.match(/Invoice\s*(?:No\.?|#|Number)\s*[:\s]\s*([0-9]{4,10})/i);
            var ocrSol = ocrText.match(SOLOMON);
            return { invoiceNum: invoiceNum || (ocrInv ? ocrInv[1] : null), solomon: (sm && sm[0]) || (ocrSol ? ocrSol[0] : null), text: ocrText };
          });
        }
        return { invoiceNum: invoiceNum, solomon: sm ? sm[0] : null, text: full };
      });
    });
  }).catch(function () { return { invoiceNum: null, solomon: null, text: "" }; });
}
function mergePdfs(b64s) {
  return PDFLib.PDFDocument.create().then(function (out) {
    return b64s.reduce(function (p, b) {
      return p.then(function () {
        return PDFLib.PDFDocument.load(bytesFromB64(b)).then(function (src) {
          return out.copyPages(src, src.getPageIndices()).then(function (pgs) {
            pgs.forEach(function (pg) { out.addPage(pg); });
          });
        });
      });
    }, Promise.resolve()).then(function () { return out.save(); }).then(b64FromBytes);
  });
}
function saveBlob(name, bytes, type) {
  var b = new Blob([bytes], { type: type || "application/pdf" });
  var u = URL.createObjectURL(b), a = document.createElement("a");
  a.href = u; a.download = name; a.click();
  setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
}
function fileB64(file) {
  return file.arrayBuffer().then(function (buf) { return b64FromBytes(new Uint8Array(buf)); });
}
/* ═══ 03-drawer-billing ═══ */
/* ── Order drawer ────────────────────────────────────────────────────────── */
var DRAWER_OID = null;
var DRAWER_SAVE = Promise.resolve();
/* Serialize drawer blur saves so a fast edit/refocus cannot let an older HTTP
   response land after the newer value. */
function queueDrawerSave(work) {
  // Gated by the OPEN ORDER's own kind (D125), not the ambient SEC/SUB — a
  // drawer opened from the Scheduler still edits order data, so it's the
  // Orders grant that governs it, independent of how it was reached.
  var o = DRAWER_OID && order(DRAWER_OID);
  var sub = o && o.is_transfer ? "xfer" : o && o.kind === "internal" ? "int" : "ext";
  if (o && !canEdit("orders", sub)) {
    toast("View-only — you can't edit this order.", true);
    return Promise.reject(new Error("View-only"));
  }
  DRAWER_SAVE = DRAWER_SAVE.catch(function () {}).then(work);
  return DRAWER_SAVE;
}
/* The most recent OTHER order this customer has, if any (D34) — shown at the
   bottom of the internal drawer so Nate can see order history without
   leaving the screen. */
function lastOrderDate(customerId, excludeId) {
  var dates = DB.orders.filter(function (o2) {
    return o2.customer_party_id === customerId && o2.id !== excludeId && o2.ordered_at;
  }).map(function (o2) { return String(o2.ordered_at).slice(0, 10); });
  if (!dates.length) return null;
  dates.sort();
  return dates[dates.length - 1];
}
/* A label+value row reusing the same data-table/data-id/data-field cell the
   Database tables already use — clicking and typing here edits the same
   underlying party/location row, no new editing mechanism needed. */
function dcellRow(label, table, id, field, val) {
  return '<tr><td style="padding:4px 8px;color:var(--ink-3);font-size:var(--fs-label);white-space:nowrap">' +
    esc(label) + "</td>" + (id
      ? '<td data-key="' + table + "-" + id + "-" + field + '" data-table="' + table + '" data-id="' + id +
        '" data-field="' + field + '"><div class="cell">' + esc(val == null ? "" : val) + "</div></td>"
      : '<td><div class="cell" style="color:var(--ink-3)">—</div></td>') + "</tr>";
}
/* Internal orders get a deliberately simpler drawer (D34): pallets and a
   note, then everything on file for the customer (from Bagger Customers),
   then when Nate last ordered from them. No Load #/PO/dates section — those
   already live in the Internal Orders table itself. */
/* Where an order sits on the board — the date of the cell it occupies, or null
   if it's not placed (D55). */
function schedValueForOrder(oid) {
  for (var k in CELLS) { var v = CELLS[k]; if (v && v.oid === oid) return { key: k, value: v }; }
  return null;
}
function schedDateForOrder(oid) {
  var found = schedValueForOrder(oid);
  return found ? found.key.split("|")[1] : null;
}
/* The exact scheduler chip, including its placement note and external pushed
   color when present. Used at the top of both order drawers. */
function drawerChipMarkup(o) {
  var found = schedValueForOrder(o.id), v = found && found.value;
  return chipHtml(o, false, "", v && v.cat,
    (v && v.fmt) || {}, pushColorFor(o, v));
}
/* Outside-carrier section (D115/D122) — only renders once an order is
   actually sitting on the carrier lane (is_carrier, before or after it has a
   name); nothing to show/edit before that. Same section in both drawers
   since Nate wants this available for internal and external alike. A
   collapsible <details> (matching the drawer's Customer section convention)
   instead of a blocking modal at drop time — name/cost autosave on blur
   like every other drawer field. */
function carrierSectionHtml(oid) {
  var c = carrierMap()[oid]; if (!c) return "";
  var cp = c.carrierId ? party(c.carrierId) : null;
  return '<details><summary class="sec-h" id="dw-carrier-summary">Outside carrier' +
    (cp ? " — " + esc(cp.name) : "") + '</summary>' +
    '<div class="fields">' +
      '<label>Carrier name</label><input data-carrier="name" data-oid="' + oid +
        '" value="' + esc(cp ? cp.name : "") + '" placeholder="Who’s hauling it">' +
      '<label>What you paid ($)</label><input data-carrier="cost" data-oid="' + oid +
        '" value="' + esc(c.carrierCost != null ? c.carrierCost : "") + '" placeholder="0.00">' +
    "</div></details>";
}
/* Patches just the collapsible summary text after a carrier field save,
   instead of the full openOrder() rebuild every other drawer field uses —
   tabbing straight from Carrier name into Cost fast enough for a full
   drawer rebuild to land mid-keystroke would otherwise tear out the cost
   input and silently drop what was typed into it (D122). */
function refreshCarrierSummary(oid) {
  var s = $("#dw-carrier-summary"); if (!s) return;
  var c = carrierMap()[oid] || {}, cp = c.carrierId ? party(c.carrierId) : null;
  s.textContent = "Outside carrier" + (cp ? " — " + cp.name : "");
}
/* Patches just the drawer's <h2> title (any of the three drawer types all
   carry id="dw-title") after a field save — same narrow-patch pattern as
   refreshCarrierSummary, generalized from the transfer-only version (D127)
   once the same class of bug turned up on plain text fields too (see
   refreshOrderDrawerAfterSave below). */
function refreshDrawerTitle(oid) {
  var t = $("#dw-title"); if (!t || DRAWER_OID !== oid) return;
  var o = order(oid); if (!o) return;
  t.textContent = buildChip(o).title;
}
function drawerChipPreview(o) {
  return '<div><div class="sec-h">Load chip / driver-visible summary</div>' +
    '<div class="dw-chip-preview" id="dw-chip-preview">' + drawerChipMarkup(o) + "</div></div>";
}
function refreshDrawerChipPreview() {
  var host = $("#dw-chip-preview"), o = DRAWER_OID && order(DRAWER_OID);
  if (host && o) host.innerHTML = drawerChipMarkup(o);
}
/* Every drawer field's blur handler saves, then wants the drawer to reflect
   the (possibly server-recomputed, e.g. a denormalized name) fresh value.
   A full openOrder(oid) rebuild does that reliably — but if the user has
   since moved on to typing in ANOTHER drawer field, that rebuild tears the
   new field out from under them mid-keystroke and silently drops it (the
   same D122/D127 race, confirmed live on ordinary text-field pairs too:
   Notes → Miles, Miles → Transfer $, not just the transfer department
   picker). Skip the full rebuild whenever focus is still on an editable
   drawer field when the save resolves — a narrow chip/title patch is
   enough there, since the field the user is CURRENTLY in already shows
   what they typed and doesn't need touching. */
function refreshOrderDrawerAfterSave(saveOid) {
  if (DRAWER_OID !== saveOid) return;
  var ae = document.activeElement;
  var stillEditing = ae && ae.closest && ae.closest("#drawer") &&
    ae.closest("[data-of],[data-fr],[data-frorder],[data-transferdept],input[data-cust],[data-carrier]");
  if (stillEditing) { refreshDrawerChipPreview(); refreshDrawerTitle(saveOid); return; }
  openOrder(saveOid);
}
/* Drawer status strip — shares the same lifecycle pill as the order grids'
   leftmost Stage column (stagePill(), 04-views.js) so the two never drift,
   plus a jump-to-scheduler button once it's actually placed on a date.
   Cancel/Delete used to live here too; retired (D159) in favor of the
   order trackers' numbered-gutter multi-select, which covers a single
   order the same way (select one row) plus real multi-select. */
function schedBar(oid) {
  var o = order(oid); if (!o) return "";
  var ds = schedDateForOrder(oid);
  var controls = stageControls(o, !!ds, false);
  if (ds) return '<div class="dw-sched">' + controls +
    '<span style="font-size:var(--fs-label);color:var(--ink-3);margin-left:2px">' + esc(prettyDate(ds)) + "</span>" +
    '<button class="btn sm" data-showsched="' + oid + '" data-schedds="' + ds + '">Show On Scheduler &rarr;</button>' +
    "</div>";
  if (STAGED.indexOf(oid) >= 0) return '<div class="dw-sched">' + controls +
    '<span style="font-size:var(--fs-label);color:var(--ink-3)">In the staging rail — not on the board yet.</span></div>';
  return '<div class="dw-sched">' + controls + "</div>";
}
function openInternalOrder(o) {
  var ch = buildChip(o), ds = docsFor(o.id);
  var have = {}; ds.forEach(function (d) { have[d.doc_type] = 1; });
  var cust = o.customer_party_id ? party(o.customer_party_id) : null;
  var loc = o.customer_party_id ? locFor(o.customer_party_id) : null;

  var h = '<div class="dw-hd"><div style="flex:1"><h2 id="dw-title">' + esc(ch.title) + "</h2>" +
    '<div class="sub">' + esc(o.solomon_order_no || "— no order # —") + "</div></div>" +
    '<button class="btn" id="dw-close">Close</button></div><div class="dw-body">';
  h += schedBar(o.id);

  /* Lead with the exact scheduler chip: this is the dispatch summary and the
     quickest way to confirm what the driver-facing workflow is carrying. */
  h += drawerChipPreview(o);
  h += carrierSectionHtml(o.id);

  /* Editable tracker fields lead the body now (Nate's ask) — the day-to-day
     dispatch fields come before the customer reference lookup, not after. */
  h += '<div><div class="sec-h">Order details</div><div class="fields">' +
    fld("pallet_count", "PAL", o.pallet_count, "") +
    fld("ordered_at", "Ordered", o.ordered_at && String(o.ordered_at).slice(0, 10), "", "date") +
    fld("delivered_at", "Delivered", o.delivered_at && String(o.delivered_at).slice(0, 10), "", "date") +
    fld("notes", "Notes", o.notes, "") +
    "</div></div>";

  /* Two notes, every order kind (D140): Notes above is dispatcher-private,
     never pushed. Driver tab note is the one thing that reaches the
     driver's Sheets tab — same field/pattern Internal Freight transfers
     already had (D130), now universal. */
  h += '<div><div class="sec-h">Driver tab note</div><div class="fields">' +
    fld("driver_note", "Notes", o.driver_note, "What the driver should see when this pushes") +
    "</div></div>";

  /* Freight to the bag plant (D38) — actual miles and the hand-entered
     internal charge, saved on the ORDER via /api/freight (D103) — editable as
     soon as the order exists, no staging required. Aggregated weekly per
     truck in v_freight_transfer_weekly once the order is on a load. */
  h += '<div><div class="sec-h">Mileage / transfer cost</div><div class="fields">' +
    frFld("miles", "Miles", o.miles, "") +
    frFld("freight_amount", "Transfer $", o.internal_freight_amount, "") +
    "</div></div>";

  /* Customer reference is collapsed by default (Nate's ask) — it's lookup
     detail, not something edited on every visit; a <details> keeps it one
     click away without new toggle state to track. */
  h += '<details><summary class="sec-h">Customer' + (cust ? " — " + esc(cust.name) : "") + "</summary>";
  if (cust) {
    h += '<table class="data" style="width:100%"><tbody>' +
      dcellRow(fieldLabel("bagger", "address", "Address"), "locations", loc && loc.id, "address", loc && loc.address) +
      dcellRow(fieldLabel("bagger", "city", "City"), "locations", loc && loc.id, "city", loc && loc.city) +
      '<tr><th>' + esc(fieldLabel("bagger", "category_id", "Time Window")) + '</th>' + designationSelect(loc) + '</tr>' +
      dcellRow(fieldLabel("bagger", "forklift", "Forklift"), "locations", loc && loc.id, "forklift", loc && loc.forklift) +
      dcellRow(fieldLabel("bagger", "standard_miles", "Miles"), "locations", loc && loc.id, "standard_miles", loc && loc.standard_miles) +
      dcellRow(fieldLabel("bagger", "phone", "Phone"), "parties", cust.id, "phone", cust.phone) +
      dcellRow(fieldLabel("bagger", "manager_name", "Manager"), "parties", cust.id, "manager_name", cust.manager_name) +
      dcellRow(fieldLabel("bagger", "notes", "Customer notes"), "locations", loc && loc.id, "notes", loc && loc.notes) +
      "</tbody></table>";
    var last = lastOrderDate(cust.id, o.id);
    h += '<div class="note-bar" style="margin-top:8px">Last order: ' + (last ? esc(last) : "none found") + "</div>";
  }
  h += "</details>";

  h += '<div><div class="sec-h">Documents — ' + ds.length + "</div>" +
    '<div class="doclist" id="dw-docs">';
  ds.forEach(function (d) {
    h += '<div class="docrow"><span class="pill">' + esc(d.doc_type.replace("_", " ")) + "</span>" +
      '<span class="nm">' + esc(d.original_filename || "") + "</span>" +
      '<button class="btn sm" data-viewpath="' + esc(d.storage_path) + '" data-viewname="' +
        esc(d.original_filename || "") + '">View</button>' +
      '<a class="btn sm" href="#" data-filepath="' + esc(d.storage_path) + '" data-filename="' +
        esc(d.original_filename || "") + '" data-filemode="download">Download</a></div>';
  });
  h += '</div><div class="drop" id="dw-drop" style="margin-top:9px"><b>Drop documents here</b>' +
       "Delivery receipt, signed POD, invoice — stays linked to this order.</div></div>";

  h += "</div>";
  $("#drawer").innerHTML = h;
  $("#drawer").classList.add("on"); $("#scrim").classList.add("on");
  $("#drawer").setAttribute("aria-hidden", "false");
}
/* ── Pickup/Delivery type-ahead combo (D42) ──────────────────────────────────
   As Nate types it autofills from the Pick/Drop List (locations); picking one
   sets the order's pickup/delivery, and a non-matching name can be created on
   the spot (never auto-created silently — his call). A dropped rate con
   pre-fills the box as a suggestion, which he confirms or overrides. */
function orderStops(oid) {
  return (DB.order_stops || []).filter(function (s) { return s.order_id === oid; })
    .sort(function (a, b) { return a.sequence - b.sequence; });
}
function routeCounts(oid) {
  var out = { pickup: 0, delivery: 0 };
  orderStops(oid).forEach(function (s) { if (out[s.stop_type] != null) out[s.stop_type]++; });
  return out;
}
function routeStopLabel(stop) {
  var loc = stop && stop.location_id ? locById(stop.location_id) : null;
  return loc ? [loc.name, loc.city, loc.state].filter(Boolean).join(", ") : "— location needed —";
}
function routeCompactLabel(o) {
  var c = routeCounts(o.id);
  return c.pickup + " pick" + (c.pickup === 1 ? "" : "s") + " · " +
    c.delivery + " drop" + (c.delivery === 1 ? "" : "s");
}
function rateConSuggest(oid) {
  var d = docsFor(oid).filter(function (x) { return x.doc_type === "rate_con" && x.extracted_fields; })[0];
  var ef = (d && d.extracted_fields) || {};
  return { pickup: ef.pickup || null, delivery: ef.delivery || null, stops: ef.stops || [] };
}
/* A dropped rate con used to only ever SUGGEST pickup/delivery text — Nate
   always had to confirm or manually "+Create" it (rate cons vary wildly and
   scanned ones are OCR-noisy, so nothing auto-applied). Nate: "be able to add
   locations to picks and drops based on the rate con dropping" — the main
   workflow being dropping a rate con in means that friction is gone now: an
   extracted stop that doesn't already exist in the Pick/Drop List becomes a
   real location outright, matched by exact (case-insensitive) name first so
   re-ingesting the same shipper/consignee doesn't pile up duplicates. This
   only touches the ADDRESS BOOK, never an order's own pickup/delivery pick —
   ingestRateCon still only fills that in when the field was blank. */
function resolveStopToLocationId(stop) {
  if (!stop || !stop.name) return Promise.resolve(null);
  var qn = stop.name.trim().toLowerCase();
  var existing = (DB.locations || []).filter(function (l) { return (l.name || "").trim().toLowerCase() === qn; })[0];
  if (existing) return Promise.resolve(existing.id);
  return api("location", { name: stop.name, city: stop.city || null, state: stop.state || null })
    .then(function (loc) { return loc.id; });
}
function locCombo(oid, field, currentId, suggest) {
  var cur = currentId ? locById(currentId) : null;
  var val = cur ? cur.name : (suggest ? [suggest.name, suggest.city].filter(Boolean).join(", ") : "");
  return '<div class="loccombo"><input class="cell-i loc-in" data-loccombo="' + field + '" data-oid="' + oid +
    '" data-locid="' + (currentId || "") + '"' + (!currentId && val ? ' data-suggested="1"' : "") +
    ' value="' + esc(val) + '" placeholder="Search Picks and Drops" autocomplete="off"></div>';
}
/* Shared by every .loc-suggest panel (locations, parties, D149) — the first
   (best) match starts highlighted so Up/Down/Enter/Tab all have something
   to act on immediately, not just after an explicit ArrowDown. */
function markFirstLocOpt(panel) {
  var first = panel.querySelector(".loc-opt");
  if (first) first.classList.add("on");
}
/* ONE shared panel parked directly on <body>, not a child of whichever
   .loccombo is open (D228 follow-up) — a tracker grid's loccombo lives
   inside #main, and #main's own CSS `zoom` (the spreadsheet zoom control)
   turns out to make itself the containing block for any `position:fixed`
   descendant AND re-scale that descendant's offset by the zoom factor a
   second time. A panel rendered as a .loccombo child inherited that
   double-scaling and landed down-and-right of the input at any zoom other
   than 100% (found live, Nate: "the dropdown is like down and off to the
   right"). Parking it on body sidesteps the whole quirk instead of trying
   to out-math it — position math here is always plain viewport pixels,
   at every zoom level, because the panel is never inside the zoomed
   subtree. SUGGEST_INPUT (01-core.js) tracks which combo it's currently
   serving, since pick handlers can no longer find the input by walking up
   from the clicked option (the panel isn't a DOM descendant of it). */
function locSuggestPanel() {
  var p = document.getElementById("loc-suggest-portal");
  if (!p) {
    p = document.createElement("div");
    p.id = "loc-suggest-portal";
    p.className = "loc-suggest";
    p.style.display = "none";
    document.body.appendChild(p);
  }
  return p;
}
function positionLocSuggest(inp, panel) {
  var r = inp.getBoundingClientRect();
  panel.style.left = r.left + "px";
  panel.style.top = r.bottom + "px";
  panel.style.width = r.width + "px";
}
function renderLocSuggest(inp, force) {
  var panel = locSuggestPanel();
  var wasOpen = panel.style.display !== "none" && SUGGEST_INPUT === inp;
  SUGGEST_INPUT = inp;
  var qv = inp.value.trim().toLowerCase();
  /* Match against ANY field on the location, not just the name (Nate's ask) —
     address, city, state, phone, notes all count, so typing a street or town
     finds the row even when he doesn't remember the company name. */
  var matches = !qv ? [] : DB.locations.filter(function (l) {
    return [l.name, l.address, l.city, l.state, l.phone, l.notes]
      .filter(Boolean).join(" ").toLowerCase().indexOf(qv) >= 0;
  }).slice(0, 8);
  var html = matches.map(function (l) {
    var sub = [l.address, [l.city, l.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
    return '<div class="loc-opt" data-locpick="' + l.id + '">' + esc(l.name) +
      (sub ? ' <span class="c">' + esc(sub) + "</span>" : "") + "</div>";
  }).join("");
  var exact = matches.some(function (l) { return (l.name || "").toLowerCase() === qv; });
  if (qv && !exact)
    html += '<div class="loc-opt create" data-loccreate="' + esc(inp.value.trim()) + '">+ Create &ldquo;' +
      esc(inp.value.trim()) + "&rdquo;</div>";
  panel.innerHTML = html;
  panel.style.display = html ? "block" : "none";
  // getBoundingClientRect() forces a synchronous layout — on a 1000+ row
  // tracker that's a real, felt cost paid on every keystroke if it runs
  // every render. The input's own on-screen position doesn't move while
  // the user types, so skip it for a same-input re-render already showing
  // — but a fresh `focus` always passes force=true (07-events.js), so
  // refocusing the same field after the page scrolled/zoomed/reflowed
  // elsewhere never leaves the panel showing a stale position (found
  // live: changing zoom while a panel from an earlier focus was still
  // open left it exactly where the old zoom had put it).
  if (html) { markFirstLocOpt(panel); if (!wasOpen || force) positionLocSuggest(inp, panel); }
}
function handleLocPick(opt) {
  var inp = SUGGEST_INPUT;
  var oid = inp.dataset.oid, field = inp.dataset.loccombo;
  locSuggestPanel().style.display = "none";
  var body = { id: oid };
  if (opt.dataset.locpick) {
    var l = locById(opt.dataset.locpick);
    inp.value = l ? l.name : ""; inp.dataset.locid = opt.dataset.locpick;
    body[field] = opt.dataset.locpick;
    api("order/update", body).then(reload).catch(function (e) { toast(e.message, true); });
  } else {
    // A real fill-out form, not a guessed comma-split (Nate: "add locations
    // to my pick and drop list right then and there") — same popup the
    // Pick/Drop List's own "+ Add Location" uses, just pre-named and wired
    // to finish this pick once saved.
    addLocationModal(opt.dataset.loccreate.split(",")[0].trim(), { oid: oid, field: field });
  }
}

/* Order-tracker Customer/Broker picker (D148) — Nate: "the order trackers
   dropdowns need to be more sensitive to typing... if im typing in the
   customer box 607 then the stores with 607 need to populate." Bag Orders'
   Customer and External Orders' Broker/Customer columns were both a plain
   <select> over the FULL party list (272+ rows) — a native select's
   type-to-jump only matches the START of an option's text, so typing "607"
   never found "BI-MART #607". Reuses the exact loccombo/.loc-suggest UI
   (D42) rather than building a second combo widget — same type-ahead
   panel, click-to-pick, positioned-under-input mechanics — just searching
   parties instead of locations, and no "+ Create" option (a brand-new
   customer/broker already has its own "+ Add customer" flow; a combo that
   can also silently create one is a second, easier-to-fat-finger path to
   the same duplicate-party risk locCombo's create option doesn't have to
   worry about, since a location has no separate identity to collide with). */
function partySubsetFor(field) {
  if (field === "customer_party_id") return (DB.parties || []).filter(function (p) {
    return p.is_customer && !p.customer_archived_at;
  });
  if (field === "broker_party_id") return (DB.parties || []).filter(function (p) {
    return p.is_broker && !p.broker_archived_at;
  });
  return [];
}
function partyCombo(oid, field, currentId, placeholder, disabled) {
  var cur = currentId ? party(currentId) : null;
  return '<div class="loccombo"><input class="cell-i loc-in" data-partycombo="' + field + '" data-oid="' + oid +
    '" data-partyid="' + (currentId || "") + '" value="' + esc(cur ? cur.name : "") +
    '" placeholder="' + esc(placeholder) + '" autocomplete="off"' + (disabled ? " disabled" : "") + '></div>';
}
function renderPartySuggest(inp, force) {
  var panel = locSuggestPanel();
  var wasOpen = panel.style.display !== "none" && SUGGEST_INPUT === inp;
  SUGGEST_INPUT = inp;
  var qv = inp.value.trim().toLowerCase();
  var pool = partySubsetFor(inp.dataset.partycombo);
  // Substring match anywhere, not just a leading match — "607" finding
  // "BI-MART #607" is the whole point (a native <select> only jumps to an
  // option whose text STARTS with what you type).
  var matches = !qv ? [] : pool.filter(function (p) {
    return (p.name || "").toLowerCase().indexOf(qv) >= 0;
  }).slice(0, 8);
  var html = matches.map(function (p) {
    return '<div class="loc-opt" data-partypick="' + p.id + '">' + esc(p.name) + "</div>";
  }).join("");
  panel.innerHTML = html;
  panel.style.display = html ? "block" : "none";
  if (html) { markFirstLocOpt(panel); if (!wasOpen || force) positionLocSuggest(inp, panel); }
}
function handlePartyPick(opt) {
  var inp = SUGGEST_INPUT;
  var oid = inp.dataset.oid, field = inp.dataset.partycombo;
  locSuggestPanel().style.display = "none";
  var pid = opt.dataset.partypick, p = party(pid);
  inp.value = p ? p.name : ""; inp.dataset.partyid = pid;
  var body = { id: oid }; body[field] = pid;
  api("order/update", body).then(reload).catch(function (e) { toast(e.message, true); });
}

/* Internal Freight drawer (D127) — mirrors openInternalOrder's simpler shape
   (schedBar, chip preview, carrier section, mileage/transfer-$ fields) but
   swaps Customer for a Department picker and drops Documents entirely
   (transfers never get rate-con paperwork matched — no solomon/broker_load_no
   for the matching cascade to key off). */
function openTransferOrder(o) {
  var ch = buildChip(o);
  var h = '<div class="dw-hd"><div style="flex:1"><h2 id="dw-title">' + esc(ch.title) + "</h2>" +
    '<div class="sub">Internal Freight</div></div>' +
    '<button class="btn" id="dw-close">Close</button></div><div class="dw-body">';
  h += schedBar(o.id);
  h += drawerChipPreview(o);
  h += carrierSectionHtml(o.id);

  /* Department uses its own save path (data-transferdept), not the generic
     data-of full-drawer rebuild — picking a department then immediately
     typing the route note below it is the natural fill-out order for a new
     transfer, and a full rebuild landing mid-keystroke would tear the note
     input out and silently drop what was typed (same race D122 fixed for
     the carrier name→cost sequence; the generic data-of/data-fr handlers
     now guard against it too via refreshOrderDrawerAfterSave). Patches
     just the title + chip preview instead (refreshDrawerTitle). */
  h += '<div><div class="sec-h">Transfer details</div><div class="fields">' +
    '<label>Department</label><select data-transferdept="' + o.id + '">' +
    '<option value="">— pick department —</option>' +
    departmentsForPicker(o.transfer_department_id).map(function (dpt) {
      return '<option value="' + dpt.id + '"' + (dpt.id === o.transfer_department_id ? " selected" : "") + ">" +
        esc(dpt.name) + "</option>";
    }).join("") + "</select>" +
    fld("notes", "Load info", o.notes, "e.g. Bag Plant to Umatilla Yard # 23") +
    fld("ordered_at", "Date", o.ordered_at && String(o.ordered_at).slice(0, 10), "", "date") +
    fld("delivered_at", "Delivered", o.delivered_at && String(o.delivered_at).slice(0, 10), "", "date") +
    "</div></div>";

  /* Load info stays dispatcher-facing only (drives the chip title, never
     pushed). driver_note is the separate field that actually reaches the
     driver's Sheets tab — D130. */
  h += '<div><div class="sec-h">Driver tab note</div><div class="fields">' +
    fld("driver_note", "Notes", o.driver_note, "What the driver should see when this pushes") +
    "</div></div>";

  h += '<div><div class="sec-h">Mileage / transfer cost</div><div class="fields">' +
    frFld("miles", "Miles", o.miles, "") +
    frFld("freight_amount", "Transfer $", o.internal_freight_amount, "") +
    "</div></div>";

  h += "</div>";
  $("#drawer").innerHTML = h;
  $("#drawer").classList.add("on"); $("#scrim").classList.add("on");
  $("#drawer").setAttribute("aria-hidden", "false");
}
function openOrder(oid) {
  DRAWER_OID = oid;
  var o = order(oid); if (!o) return;
  if (o.is_transfer) return openTransferOrder(o);
  if (!isExt(o)) return openInternalOrder(o);
  var ch = buildChip(o), ds = docsFor(oid);
  var need = ["rate_con", "pod", "invoice"];
  var have = {}; ds.forEach(function (d) { have[d.doc_type] = 1; });
  var pkgLabel = "rate con + POD/BOL + invoice";

  var h = '<div class="dw-hd"><div style="flex:1"><h2 id="dw-title">' + esc(ch.title) + "</h2>" +
    '<div class="sub">' + esc(o.solomon_order_no || "— no order # —") +
    (o.broker_load_no ? " · load " + esc(o.broker_load_no) : "") + "</div></div>" +
    '<button class="btn" id="dw-close">Close</button></div><div class="dw-body">';
  h += schedBar(oid);
  if (o.billed_at)
    h += '<div class="dw-sched"><span class="pill on">Billed out</span>' +
      '<button class="btn sm" data-reopen-bill="' + oid + '">Reopen For Billing</button></div>';

  h += drawerChipPreview(o);
  h += carrierSectionHtml(oid);

  if (!o.solomon_order_no)
    h += '<div class="note-bar"><b>Needs a Rexius order number</b> — can\'t bill out without it.</div>';

  h += '<div><div class="sec-h">Order</div><div class="fields">' +
    "<label>Broker</label>" + partyCombo(oid, "broker_party_id", o.broker_party_id, "Search brokers") +
    fld("solomon_order_no", "Order #", o.solomon_order_no, externalOrderPlaceholder()) +
    fld("broker_load_no", "Load #", o.broker_load_no, "") +
    fld("po_number", "PU / PO", o.po_number, "") +
    fld("delivery_number", "Delivery #", o.delivery_number, "") +
    fld("ordered_at", "Ordered", o.ordered_at && String(o.ordered_at).slice(0, 10), "", "date") +
    fld("delivered_at", "Delivered", o.delivered_at && String(o.delivered_at).slice(0, 10), "", "date") +
    fld("notes", "Notes", o.notes, "") +
    "</div><label style=\"display:flex;align-items:center;gap:6px;font-size:var(--fs-body-sm);color:var(--ink-2);margin-top:8px\">" +
    '<input type="checkbox" data-oedit="' + oid + '" data-field="tarp"' + (o.tarp ? " checked" : "") +
    "> Tarp load</label></div>";

  /* Two notes, every order kind (D140): Notes above is dispatcher-private,
     never pushed. Driver tab note is the one thing that reaches the
     driver's Sheets tab — same field/pattern Internal Freight transfers
     already had (D130), now universal. */
  h += '<div><div class="sec-h">Driver tab note</div><div class="fields">' +
    fld("driver_note", "Notes", o.driver_note, "What the driver should see when this pushes") +
    "</div></div>";

  /* Pickup / Delivery (D42) — type-ahead against the Pick/Drop List, pre-filled
     from the rate con when it extracted something. */
  var sug = rateConSuggest(oid);
  var prefilled = (!o.pickup_location_id && sug.pickup) || (!o.delivery_location_id && sug.delivery);
  h += '<div><div class="sec-h">Pickup / Drop</div>';
  if (o.route_mode === "custom") {
    h += '<div class="route-summary"><b>' + esc(routeCompactLabel(o)) + '</b>' +
      orderStops(oid).map(function (s) { return '<span><strong>' + s.sequence + ' ' +
        (s.stop_type === "pickup" ? "PICK" : "DROP") + '</strong> ' + esc(routeStopLabel(s)) + '</span>'; }).join("") +
      '</div><button class="btn" data-route-edit="' + oid + '" style="margin-top:8px">Edit Full Route…</button>';
  } else {
    h += '<div style="display:flex;flex-direction:column;gap:9px">' +
      '<div><label style="font-size:var(--fs-body-sm);color:var(--ink-2);display:block;margin-bottom:3px">Pickup</label>' +
        locCombo(oid, "pickup_location_id", o.pickup_location_id, sug.pickup) + "</div>" +
      '<div><label style="font-size:var(--fs-body-sm);color:var(--ink-2);display:block;margin-bottom:3px">Drop</label>' +
        locCombo(oid, "delivery_location_id", o.delivery_location_id, sug.delivery) + "</div></div>" +
      (prefilled ? '<div class="note-bar" style="margin-top:7px">Prefilled from the rate con — confirm each or pick from the list.</div>' : "") +
      ((sug.stops || []).filter(function (s) { return s.stop_type === "pickup"; }).length > 1 ||
       (sug.stops || []).filter(function (s) { return s.stop_type === "delivery"; }).length > 1
        ? '<div class="note-bar" style="margin-top:7px"><b>Possible multi-stop route detected.</b> Use Edit full route to review it.</div>' : "") +
      '<button class="btn" data-route-edit="' + oid + '" style="margin-top:8px">Edit Full Route…</button>';
  }
  h += "</div>";

  h += '<div><div class="sec-h">Documents — ' + ds.length + "</div>" +
    '<div class="doclist" id="dw-docs">';
  ds.forEach(function (d) {
    h += '<div class="docrow"><span class="pill">' + esc(d.doc_type.replace("_", " ")) + "</span>" +
      '<span class="nm">' + esc(d.original_filename || "") + "</span>" +
      '<button class="btn sm" data-viewpath="' + esc(d.storage_path) + '" data-viewname="' +
        esc(d.original_filename || "") + '">View</button>' +
      '<a class="btn sm" href="#" data-filepath="' + esc(d.storage_path) + '" data-filename="' +
        esc(d.original_filename || "") + '" data-filemode="download">Download</a></div>';
  });
  h += "</div>";
  var missing = need.filter(function (t) { return !have[t]; });
  if (o.route_mode === "custom") {
    var deliveryCount = routeCounts(o.id).delivery;
    h += '<div class="note-bar" style="margin-top:7px">' + deliveryCount + ' delivery stop' +
      (deliveryCount === 1 ? "" : "s") + ' — one combined POD or stop-specific PODs are both accepted.</div>';
  }
  if (missing.length)
    h += '<div style="margin-top:7px;font-size:var(--fs-label);color:var(--bad)">Missing: ' +
         missing.map(function (m) { return m.replace("_", " "); }).join(", ") + "</div>";
  h += '<div class="drop" id="dw-drop" style="margin-top:9px"><b>Drop documents here</b>' +
       "Anything — POD, BOL, invoice, signed paperwork. Stays linked to this order.</div></div>";

  /* Outlook drafting lives only in the Biller app now (D55) — the order drawer
     just produces the package files. */
  h += '<div><div class="sec-h">Billing package</div>' +
    '<p style="font-size:var(--fs-label);color:var(--ink-3);margin-bottom:8px">' + esc(pkgLabel) + "</p>" +
    '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
    '<button class="btn pri" data-pkg="merged">Download Merged</button>' +
    '<button class="btn" data-pkg="individual">Download Individually</button></div></div>';

  h += "</div>";
  $("#drawer").innerHTML = h;
  $("#drawer").classList.add("on"); $("#scrim").classList.add("on");
  $("#drawer").setAttribute("aria-hidden", "false");
}
function fld(name, label, val, ph, type) {
  // Every date field in the app is a smart date input now (D152) — same
  // typing behavior everywhere, not just Reports/Current Week.
  if (type === "date") {
    return "<label>" + esc(label) + '</label><input data-of="' + name +
      '" type="text" inputmode="numeric" data-smartdate data-last-iso="' + esc(val || "") +
      '" value="' + esc(isoToMdy(val)) + '" placeholder="MM/DD/YYYY">';
  }
  return "<label>" + esc(label) + '</label><input data-of="' + name + '" type="' + (type || "text") +
    '" value="' + esc(val == null ? "" : val) + '" placeholder="' + esc(ph || "") + '">';
}
/* Like fld() but saves via /api/freight (D38/D103) instead of /api/order. */
function frFld(name, label, val, ph) {
  return "<label>" + esc(label) + '</label><input data-fr="' + name + '" type="number" step="0.1"' +
    ' value="' + esc(val == null ? "" : val) + '" placeholder="' + esc(ph || "") + '">';
}
function closeDrawer() {
  $("#drawer").classList.remove("on"); $("#scrim").classList.remove("on");
  $("#drawer").setAttribute("aria-hidden", "true"); DRAWER_OID = null;
}
function packageDocs(oid) {
  var o = order(oid), ds = docsFor(oid);
  var wanted = isExt(o) ? ["rate_con", "pod", "invoice"] : ["pod", "invoice"];
  var out = [];
  wanted.forEach(function (t) { ds.forEach(function (d) { if (d.doc_type === t) out.push(d); }); });
  return out;
}
function fetchDocB64(d) {
  return fetchStoredFile(d.storage_path).then(function (r) { return r.arrayBuffer(); })
    .then(function (b) { return b64FromBytes(new Uint8Array(b)); });
}
function doPackage(oid, mode) {
  var o = order(oid), ds = packageDocs(oid);
  if (!ds.length) { toast("No documents attached to package.", true); return Promise.reject(new Error("no docs")); }
  var base = (buildChip(o).title || "package").replace(/[^A-Za-z0-9]+/g, "") + "_" +
             (o.solomon_order_no || o.broker_load_no || "pkg");
  if (mode === "individual") {
    ds.forEach(function (d) {
      fetchDocB64(d).then(function (b) { saveBlob(d.original_filename || (base + ".pdf"), bytesFromB64(b)); });
    });
    toast("Downloading " + ds.length + " file(s) individually");
    return Promise.resolve();
  }
  return Promise.all(ds.map(fetchDocB64)).then(mergePdfs).then(function (merged) {
    // Outlook billing drafts were removed in the Supabase port (out of
    // scope: no Microsoft Graph, no outbound email). "merged" is the only
    // packaged mode left; "individual" is handled above.
    saveBlob(base + ".pdf", bytesFromB64(merged)); toast("Merged package downloaded");
  });
}
/* Billing completion (D62) — mark an external order billed (out of the queue)
   or reopen it. */
function billOrder(oid, billed) {
  return api("order/bill", { id: oid, billed: billed !== false }).then(function () {
    var o = order(oid); if (o) o.billed_at = billed === false ? null : new Date().toISOString();
  });
}
function isFulfilled(oid) {
  var have = {}; docsFor(oid).forEach(function (d) { have[d.doc_type] = 1; });
  return !!(have.pod && have.invoice);
}
function billDone(oid) {
  if (!isFulfilled(oid) &&
      !confirm("This order doesn't have both a POD and an invoice yet. Mark it billed anyway?")) return;
  billOrder(oid, true).then(reload).then(function () {
    toast("Billed out");
    histPush("bill out",
      function () { return billOrder(oid, false).then(reload); },
      function () { return billOrder(oid, true).then(reload); });
  }).catch(function (e) { toast(e.message, true); });
}
/* Download the selected fulfilled orders in sequence, billing each out. */
function billBatch(mode) {
  var ids = GROUP.filter(function (id) { var o = order(id); return o && isExt(o) && !o.billed_at && isFulfilled(id); });
  if (!ids.length) { toast("Tick fulfilled orders (POD + invoice) first.", true); return; }
  var chain = Promise.resolve();
  ids.forEach(function (id) {
    chain = chain.then(function () { return doPackage(id, "merged"); })
      .then(function () { return billOrder(id); });
  });
  chain.then(function () { GROUP = []; return reload(); })
    .then(function () { toast(ids.length + " order(s) billed out"); })
    .catch(function (e) { toast(e.message || "Batch failed", true); reload(); });
}
function billBatchDone() {
  var ids = GROUP.filter(function (id) { var o = order(id); return o && isExt(o) && !o.billed_at; });
  if (!ids.length) { toast("Tick orders first.", true); return; }
  var incomplete = ids.filter(function (id) { return !isFulfilled(id); });
  if (incomplete.length &&
      !confirm(incomplete.length + " of these aren't fulfilled (missing POD/invoice). Mark all billed anyway?")) return;
  Promise.all(ids.map(function (id) { return billOrder(id); })).then(function () { GROUP = []; return reload(); })
    .then(function () { toast(ids.length + " marked billed"); }).catch(function (e) { toast(e.message, true); });
}
/* ═══ 04-views ═══ */
/* ── Views ───────────────────────────────────────────────────────────────── */
/* Truck is the Scheduler column's identity (D32); driver is the current
   occupant, shown secondary and tinted with their color if set. */
function truckColHeader(t) {
  var dc = t.driver_color ? ' style="--dc:' + esc(t.driver_color) + '"' : "";
  return '<span class="drv"' + dc + '>' + esc(t.driver_name || "— unassigned —") + "</span>" +
    '<span class="trk">' + esc(t.number) + " " + esc(t.eq || "") + "</span>";
}
/* Outside-carrier lane header (D115) — pinned to the far right of the main
   Scheduler only (not Current Week/push-driver-tabs, which stay real-fleet
   only by construction: a carrier load's truck_id is always null so it never
   matches a real truck's column there). Deliberately not driven off DB.trucks
   — it's not a truck. */
function carrierColHeader() {
  return '<span class="drv">Outside Carrier</span><span class="trk">brokered loads</span>';
}
/* Drag-and-drop truck column reorder (Nate's ask). Cell keys are truck_id-
   keyed (D32), not column-index-keyed, so reordering DB.trucks is purely a
   display change — no CELLS/loads rewiring needed. Current Week renders from
   the same DB.trucks array (vCurrentWeek, no separate copy), so it mirrors
   automatically once DB.trucks is reordered here. Persists trucks.sort_order
   via the existing generic /api/row updater (D85-era pattern); re-renders
   immediately and lets the network calls land in the background. */
function reorderTrucks(draggedId, targetId) {
  if (draggedId === targetId) return;
  var from = DB.trucks.findIndex(function (t) { return t.id === draggedId; });
  var to = DB.trucks.findIndex(function (t) { return t.id === targetId; });
  if (from < 0 || to < 0) return;
  var moved = DB.trucks.splice(from, 1)[0];
  DB.trucks.splice(to, 0, moved);
  schedNode = null; render();
  Promise.all(DB.trucks.map(function (t, i) {
    return api("row", { table: "trucks", id: t.id, values: { sort_order: i } });
  })).catch(function (err) { toast(err.message, true); reload(); });
}
/* Row drag-reorder for every Database grid. It writes the same grid-specific
   order used by “Save as row order”, so a party shared by Bagger and External
   Customers can occupy a different position in each database. */
function reorderGridRow(grid, draggedId, targetId) {
  if (draggedId === targetId) return;
  var ent = entityForGrid(grid); if (!ent) return;
  var rows = storedOrderRows(ent.kind === "custom" ? recordRows(ent.id) : builtinRows(ent.slug), grid, ent);
  var from = rows.findIndex(function (row) { return rowIdForEntity(row, ent) === draggedId; });
  var to = rows.findIndex(function (row) { return rowIdForEntity(row, ent) === targetId; });
  if (from < 0 || to < 0) return;
  var moved = rows.splice(from, 1)[0]; rows.splice(to, 0, moved);
  var ids = rows.map(function (row) { return rowIdForEntity(row, ent); });
  DB.grid_row_orders = (DB.grid_row_orders || []).filter(function (r) {
    if (r.grid !== grid) return true;
    if (!archiveConfigForGrid(grid)) return false;
    return databaseRowIsArchived(grid, r.row_id) !== archiveViewForGrid(grid);
  });
  ids.forEach(function (id, i) { DB.grid_row_orders.push({ grid: grid, row_id: id, sort_order: (i + 1) * 10 }); });
  render();
  api("grid/row/reorder", { grid: grid, row_ids: ids,
    archived_view: archiveViewForGrid(grid) })
    .catch(function (err) { toast(err.message, true); reload(); });
}
/* Spreadsheet-style Database column drag. Metadata fields and the older JSON
   custom columns share the visible sequence; each keeps its own update API. */
function applyDatabaseColumnOrder(grid, refs) {
  var ent = entityForGrid(grid); if (!ent) return Promise.reject(new Error("database not found"));
  var cols = databaseColumns(ent, grid), byRef = {};
  cols.forEach(function (c) { byRef[c.kind + ":" + c.id] = c; });
  cols = refs.map(function (ref) { return byRef[ref]; }).filter(Boolean);
  if (!cols.length) return Promise.resolve();
  cols.forEach(function (c, i) { c.obj.sort_order = (i + 1) * 10; });
  render();
  return Promise.all(cols.map(function (c) {
    var endpoint = c.kind === "field" ? "field/update" : "grid/column/update";
    return api(endpoint, { id: c.id, sort_order: c.obj.sort_order });
  }));
}
function reorderDatabaseColumns(grid, draggedRef, targetRef) {
  if (draggedRef === targetRef) return;
  var ent = entityForGrid(grid); if (!ent) return;
  var cols = databaseColumns(ent, grid), before = cols.map(function (c) { return c.kind + ":" + c.id; });
  var from = cols.findIndex(function (c) { return c.kind + ":" + c.id === draggedRef; });
  var to = cols.findIndex(function (c) { return c.kind + ":" + c.id === targetRef; });
  if (from < 0 || to < 0) return;
  var moved = cols.splice(from, 1)[0]; cols.splice(to, 0, moved);
  var after = cols.map(function (c) { return c.kind + ":" + c.id; });
  applyDatabaseColumnOrder(grid, after).then(function () {
    histPush("reorder columns",
      function () { return applyDatabaseColumnOrder(grid, before); },
      function () { return applyDatabaseColumnOrder(grid, after); });
  }).catch(function (err) { toast(err.message, true); reload(); });
}
function cellInner(key) {
  var v = CELLS[key];
  if (!v) return "";
  if (v.oid) { var o = order(v.oid); if (o) return chipHtml(o, true, 'data-from="' + key + '"', v.cat, v.fmt, pushColorFor(o, v)); }
  var fill = effFill(v), fm = v.fmt || {};
  var st = "";
  if (fm.text && fm.text.charAt(0) === "#") st += "color:" + fm.text + ";";
  else if (fill) st += "color:" + textOn(fill) + ";";
  if (fm.bold) st += "font-weight:800;";
  if (fm.italic) st += "font-style:italic;";
  if (fm.size) { var _fs = parseInt(fm.size, 10); if (_fs > 0) st += "font-size:" + _fs + "px;"; }
  if (fm.font) st += "font-family:" + fm.font + ";";
  return '<div class="txt"' + (st ? ' style="' + st + '"' : "") + ">" + esc(v.text || "") + "</div>";
}
/* Effective fill for a non-chip cell: manual fmt.fill wins over the category/
   conditional color (D67). */
function effFill(v) {
  var f = (v && v.fmt && v.fmt.fill) || (v && v.cat) || "";
  return (f && f.charAt && f.charAt(0) === "#") ? f : "";
}
/* Per-side cell borders (D73; style+width D79) — real CSS borders on the inner
   `.cell` (box-sizing:border-box, fills the td) so they never shift the grid and
   sit inside the td's own 1px grid line / 3px day separator. Real borders (unlike
   the old inset box-shadow) render solid/dashed/dotted at any width.
   fmt.border = { t,b,l,r : "#hex", s: style, w: px }, any subset of sides. */
function cellBorderCss(cv) {
  var b = cv && cv.fmt && cv.fmt.border; if (!b) return "";
  var st = b.s || "solid", w = (b.w || 1) + "px ", out = "";
  if (b.t) out += "border-top:" + w + st + " " + b.t + ";";
  if (b.b) out += "border-bottom:" + w + st + " " + b.b + ";";
  if (b.l) out += "border-left:" + w + st + " " + b.l + ";";
  if (b.r) out += "border-right:" + w + st + " " + b.r + ";";
  return out;
}
/* One scheduler/Current-Week cell — used by the initial build AND Current Week so
   fills + borders render identically in both (D73). `off` is the truck-off note. */
function schedCellHtml(key, off, firstRow, cls) {
  var cv = CELLS[key], fill = (cv && !cv.oid) ? effFill(cv) : "", bd = cellBorderCss(cv);
  var cn = [cls, off ? "offday" : ""].filter(Boolean).join(" ");
  return '<td data-key="' + key + '"' +
    (cn ? ' class="' + cn + '"' : "") + (off ? ' title="' + esc(off) + '"' : "") +
    (fill ? ' style="background-color:' + fill + '"' : "") +   // not shorthand: keeps CSS background-clip (D73)
    '><div class="cell"' + (bd ? ' style="' + bd + '"' : "") + ">" + cellInner(key) + "</div></td>";
}
/* ── Rolling calendar (D53) ──────────────────────────────────────────────────
   The Scheduler is no longer one fixed year — it renders a moving window of
   months and grows as you scroll (append the next month at the bottom, prepend
   the previous one at the top). Cells are keyed by real date, so any range
   works and the board can span as many years as the business lasts. */
function monthStart(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }
function addMonths(d, n) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)); }
var SCHED_WIN = null, schedNeedsScroll = false, schedBusy = false, schedScrollTop = 0;
function schedWinInit() {
  var t = new Date(TODAY + "T00:00:00Z");
  /* One month of history above today, five ahead — today lands near the top. */
  SCHED_WIN = { start: addMonths(monthStart(t), -1), end: addMonths(monthStart(t), 5) };
}
/* HTML for one month's rows (a month header + its day/slot rows). */
function schedMonthHtml(mStart) {
  var y = mStart.getUTCFullYear(), mo = mStart.getUTCMonth(), cols = DB.trucks.length + 1;
  var h = '<tr class="monthrow"><td colspan="' + (cols + 1) + '">' + MON[mo] + " " + y + "</td></tr>";
  var d = new Date(Date.UTC(y, mo, 1));
  while (d.getUTCMonth() === mo) {
    var ds = iso(d), dow = d.getUTCDay(), isWeekend = dow === 0 || dow === 6;
    /* Saturday/Sunday are compact gray rows until explicitly activated or a
       load/note exists. Activated/occupied weekends become normal 3-slot days. */
    var weekendOpen = isWeekend && (WEEKEND_ON[ds] || (DAYSLOT[ds] || 0) > 0);
    var base = isWeekend && !weekendOpen ? 1 : 3;
    var slots = Math.max(base, DAYSLOT[ds] || 0, DAYADD[ds] || 0);
    for (var s = 1; s <= slots; s++) {
      h += '<tr class="' + (ds === TODAY ? "today " : "") + (ds < TODAY ? "past " : "") +
        (isWeekend && !weekendOpen ? "weekend-collapsed" : "slotrow") + (s === 1 ? " dstart" : "") + '">';
      if (s === 1) { var dn = dayNote(ds); h += '<td class="rowhd' + (dn ? " has-daynote" : "") +
        '" rowspan="' + slots + '" id="row-' + ds + '"' + (dn ? ' title="' + esc(dn.text) + '"' : "") +
        '><span class="dwk">' + DOW[dow] + '</span><br><span class="dnum">' + ds.slice(8) +
        '</span><br><span class="trk">' + ds.slice(5, 7) + "/" + ds.slice(8) + "/" + ds.slice(2, 4) + "</span>" +
        (dn ? '<div class="daynote-txt">' + esc(dn.text) + '</div>' : "") + "</td>"; }
      DB.trucks.forEach(function (t) {
        var key = cellKey(t.id, ds, s), off = OFFDAYS[t.id + "|" + ds];
        h += schedCellHtml(key, off);
      });
      h += schedCellHtml(cellKey(CARRIER_TID, ds, s), null, false, "carriercell");
      h += "</tr>";
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return h;
}
/* Months resident in the DOM at once before the far edge gets pruned. The
   window only ever grew before this (found live, 2026-09-12): scrolling
   through the full 2025/2026 import — now real chip-dense every day,
   not the mostly-empty months this was written against — left every month
   ever scrolled past still sitting in the DOM, and the resulting page-wide
   slowdown was exactly what made dragging a load "in the past" feel laggy
   and occasionally drop the drag entirely (a big enough DOM/reflow can make
   a browser miss the native dragstart). 8 gives a few months of buffer past
   the 6 the initial window loads (schedWinInit) before pruning kicks in. */
var SCHED_MAX_MONTHS = 8;
function schedMonthCount() {
  var n = 0;
  for (var m = new Date(SCHED_WIN.start); m < SCHED_WIN.end; m = addMonths(m, 1)) n++;
  return n;
}
/* Removes the oldest resident month (the top of the DOM) and returns its
   pixel height so the caller can hold scrollTop steady — removing rows
   above the viewport shifts everything below them up by that much. */
function pruneSchedTop(body) {
  var rows = body.querySelectorAll(".monthrow");
  if (rows.length < 2) return 0;
  var first = rows[0], second = rows[1];
  var removed = second.getBoundingClientRect().top - first.getBoundingClientRect().top;
  for (var node = first; node && node !== second;) { var next = node.nextElementSibling; node.remove(); node = next; }
  SCHED_WIN.start = addMonths(SCHED_WIN.start, 1);
  return removed;
}
/* Removes the newest resident month (the bottom of the DOM) — below the
   viewport already, so no scroll compensation is needed. */
function pruneSchedBottom(body) {
  var rows = body.querySelectorAll(".monthrow");
  if (rows.length < 2) return;
  for (var node = rows[rows.length - 1]; node;) { var next = node.nextElementSibling; node.remove(); node = next; }
  SCHED_WIN.end = addMonths(SCHED_WIN.end, -1);
}
function onSchedScroll(e) {
  var el = e.currentTarget, body = el.querySelector("#sched-body");
  if (!body || schedBusy) return;
  if (el.scrollTop + el.clientHeight > el.scrollHeight - 500) {
    schedBusy = true;
    body.insertAdjacentHTML("beforeend", schedMonthHtml(SCHED_WIN.end));
    SCHED_WIN.end = addMonths(SCHED_WIN.end, 1);
    if (schedMonthCount() > SCHED_MAX_MONTHS) el.scrollTop -= pruneSchedTop(body);
    schedBusy = false;
  } else if (el.scrollTop < 500) {
    schedBusy = true;
    var prev = addMonths(SCHED_WIN.start, -1), before = el.scrollHeight;
    body.insertAdjacentHTML("afterbegin", schedMonthHtml(prev));
    SCHED_WIN.start = prev;
    el.scrollTop += el.scrollHeight - before;  // hold the viewport steady
    if (schedMonthCount() > SCHED_MAX_MONTHS) pruneSchedBottom(body);
    schedBusy = false;
  }
}
function buildScheduler() {
  if (!SCHED_WIN) schedWinInit();
  var cols = DB.trucks.length + 1;
  var h = '<table class="grid" id="sched-table" style="width:' + (88 + cols * PREFS.colWidth) + 'px"><thead><tr>' +
       '<th class="corner"><span class="lbl">Date</span></th>';
  DB.trucks.forEach(function (t) {
    h += '<th class="trkcol" draggable="true" data-truckid="' + t.id + '" style="width:var(--col-w,150px)">' +
      truckColHeader(t) + "</th>";
  });
  // Outside-carrier lane (D115) is always last, not part of DB.trucks and
  // not draggable — it's not a real truck to reorder among the fleet.
  h += '<th class="trkcol carriercol" style="width:var(--col-w,150px)">' + carrierColHeader() + "</th>";
  h += '</tr></thead><tbody id="sched-body">';
  for (var m = new Date(SCHED_WIN.start); m < SCHED_WIN.end; m = addMonths(m, 1)) h += schedMonthHtml(m);
  h += "</tbody></table>";
  var wrap = document.createElement("div");
  wrap.className = "grid-wrap"; wrap.id = "sched-wrap"; wrap.innerHTML = h;
  wrap.addEventListener("scroll", onSchedScroll);
  schedNeedsScroll = true;  // render() scrolls this to today once it's in the DOM
  return wrap;
}
/* The scheduler node is detached while another section is showing, so search it
   directly — querying the document silently finds nothing. */
function repaintCell(key) {
  /* A cell key can appear in two places at once now that Current Week is an
     editable portal onto the same board (D56) — the detached scheduler node and
     the visible Current Week grid. Repaint every copy. */
  var sel = '[data-key="' + CSS.escape(key) + '"]', tds = [];
  if (schedNode) tds = tds.concat([].slice.call(schedNode.querySelectorAll(sel)));
  tds = tds.concat([].slice.call(document.querySelectorAll(sel)));
  tds.forEach(function (td) {
    // Driver Tabs' load cell (D137/D140/D147) has no nested .cell and no
    // offday/fill styling of its own — a full 5-cell slot repaint (Load,
    // Notes, Pickup, Drop, Store Maps together), not a narrower innerHTML
    // patch, since all five depend on which order (if any) now occupies
    // the slot. Must run for an EMPTY slot too (dataset.oid unset), not
    // just one that already has a chip — that was the actual bug: dropping
    // a load onto a previously-empty Driver Tabs cell, or dragging one out
    // of a Driver Tabs cell, needed a full page reload to show correctly.
    if (td.classList.contains("dv-cell")) { repaintDvSlot(key); return; }
    var c = td.querySelector(".cell");
    if (c) { c.innerHTML = cellInner(key); c.style.cssText = cellBorderCss(CELLS[key]); }
    var p = key.split("|"), cv = CELLS[key], off = OFFDAYS[p[0] + "|" + p[1]];
    var fill = (cv && !cv.oid) ? effFill(cv) : "";
    td.classList.toggle("offday", !!off);
    if (off) td.setAttribute("title", off); else td.removeAttribute("title");
    td.style.background = "";                    // clear any prior shorthand
    td.style.backgroundColor = fill || "";       // background-color keeps CSS background-clip (D73)
  });
}
function jumpTo(ds) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) return;
  /* Re-center the rolling window on the target month if it isn't loaded (D53),
     then scroll to the day. */
  var ms = monthStart(new Date(ds + "T00:00:00Z"));
  if (!SCHED_WIN || ms < SCHED_WIN.start || ms >= SCHED_WIN.end) {
    SCHED_WIN = { start: addMonths(ms, -1), end: addMonths(ms, 2) };
    schedNode = null; render();
  }
  var el = document.getElementById("row-" + ds);
  if (el) el.scrollIntoView({ block: "center" });
}

/* Shared toolbar contract (D172) — Nate: "make sure the design is unified
   across the dashboard... if buttons persist they are in the same spots
   where it makes sense, that's the overall polish I'm looking for." Every
   list-style toolbar now reads the same way, left to right: title, then
   optional context controls (date pickers, a year picker, ...), then a
   flexible spacer, then secondary/bulk actions, then exactly one primary
   action, always rightmost. `plain` matches the borderless variant Orders
   trackers and Database grids use (a heading row inside the scrollable
   .pad, not a sticky bar) — a real layout difference, not part of the
   button-order fix, so it stays a caller choice rather than being folded away. */
function toolbarHtml(title, opts) {
  opts = opts || {};
  return '<div class="toolbar' + (opts.className ? " " + opts.className : "") + '"' +
    (opts.plain ? ' style="border:0;background:none;padding:0 0 8px"' : "") + '>' +
    (title ? "<h2>" + esc(title) + "</h2>" : "") +
    (opts.context || "") +
    '<span style="flex:1"></span>' +
    (opts.secondary || "") +
    (opts.primary || "") +
    "</div>";
}
function vScheduler() {
  return toolbarHtml("Scheduler", {
    className: "home-base-bar",
    context: '<input type="text" inputmode="numeric" placeholder="MM/DD/YYYY" data-smartdate id="jump" data-last-iso="' + TODAY +
      '" value="' + esc(isoToMdy(TODAY)) + '">' +
      '<button class="btn" id="jump-btn">Go</button><button class="btn" id="today-jump">Today</button>',
    primary: '<button class="btn pri" id="push-driver-tabs">' + icon("sync") + 'Update Google Schedule</button>'
  });
}
/* Current Week — an editable window onto the Scheduler (D56, was read-only D28).
   It shows the next CW_DAYS from this Monday with the *same* data-key cells as
   the board, so typing, drag/drop, and chip-clicks all work and write straight
   through to the same data — edit here or on the Scheduler, both stay in sync.
   This is the slice that mirrors to the driver-facing sheet (legacy Code.js:774
   updateDriverTabs). */
function vCurrentWeek() {
  var h = toolbarHtml("Current Week", {
    className: "cw-toolbar",
    context: '<span class="lbl">First day drivers see</span><input type="text" inputmode="numeric" placeholder="MM/DD/YYYY" data-smartdate id="cw-start" data-last-iso="' + esc(CW_START) + '" value="' + esc(isoToMdy(CW_START)) + '">' +
      '<span class="cw-daysshown"><span class="lbl" style="margin-left:6px">Days shown</span><span class="fb-fs" aria-label="Days shown">' +
        '<button class="fb-fs-b" data-cw-step="-1" title="Show one fewer day"' + (CW_DAYS <= 1 ? " disabled" : "") + '>&minus;</button>' +
        '<input class="fb-fs-inp" type="text" inputmode="numeric" id="cw-days" value="' + CW_DAYS + '" title="Days shown (1–14)">' +
        '<button class="fb-fs-b" data-cw-step="1" title="Show one more day"' + (CW_DAYS >= 14 ? " disabled" : "") + '>+</button>' +
      "</span></span>",
    primary: '<button class="btn pri" id="push-driver-tabs">' + icon("sync") + 'Update Google Schedule</button>'
  });
  var dates = currentWeekDates();
  h += '<div class="grid-wrap"><table class="grid" style="width:' +
    (88 + DB.trucks.length * PREFS.colWidth) + 'px"><thead><tr><th class="corner"><span class="lbl">Date</span></th>';
  DB.trucks.forEach(function (t) {
    h += '<th style="width:var(--col-w,150px)">' + truckColHeader(t) + "</th>";
  });
  h += "</tr></thead><tbody>";
  for (var i = 0; i < dates.length; i++) {
    var day = dates[i], ds = iso(day), dow = day.getUTCDay(), isWeekend = dow === 0 || dow === 6;
    var slots = Math.max(3, DAYSLOT[ds] || 0);
    for (var s = 1; s <= slots; s++) {
      h += '<tr class="' + (ds === TODAY ? "today " : "") + (isWeekend ? "weekend-active " : "") + 'slotrow">';
      if (s === 1) h += '<td class="rowhd" rowspan="' + slots + '"><span class="dwk">' + DOW[dow] +
        '</span><br><span class="dnum">' + ds.slice(8) + "</span></td>";
      DB.trucks.forEach(function (t) {
        var key = cellKey(t.id, ds, s);
        h += schedCellHtml(key, OFFDAYS[t.id + "|" + ds]);
      });
      h += "</tr>";
    }
  }
  return h + "</tbody></table></div>";
}
/* The next N driver-visible dates from the chosen start. Weekdays always count;
   Saturday/Sunday count only when schedule data exists on that date. */
function currentWeekDates() {
  var out = [], d = new Date(CW_START + "T00:00:00Z"), guard = 0;
  while (out.length < CW_DAYS && guard++ < 45) {
    var ds = iso(d), dow = d.getUTCDay(), weekend = dow === 0 || dow === 6;
    var hasLoad = (DB.loads || []).some(function (l) {
      return String(l.scheduled_date || "").slice(0, 10) === ds && (l.order_ids || []).length;
    });
    if (!weekend || hasLoad) out.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
/* A "view this location" Google Maps link (D113/D137) — mirrors server.py's
   _maps_view_link exactly (same query construction), so Pickup/Drop/Store
   Maps columns here match what actually gets pushed. */
function mapsViewLink(name, address, city, state) {
  var citystate = [(city || "").trim(), (state || "").trim()].filter(Boolean).join(" ");
  var query = [(address || "").trim(), citystate].filter(Boolean).join(", ") || (name || "").trim();
  return query ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(query) : "";
}
function mapLinkHtml(url, label) {
  return url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener" style="color:var(--brand);font-weight:600;font-size:var(--fs-caption)">' +
    esc(label) + "</a>" : "";
}
function driverPickupDropLinks(o) {
  if (o.route_mode === "custom") {
    var stops = orderStops(o.id);
    var pick = stops.filter(function (s) { return s.stop_type === "pickup"; })[0];
    var drops = stops.filter(function (s) { return s.stop_type === "delivery"; });
    var drop = drops[drops.length - 1];
    var pl = pick && locById(pick.location_id), dl = drop && locById(drop.location_id);
    return {
      pickup: pl ? mapsViewLink(pl.name, pl.address, pl.city, pl.state) : "",
      drop: dl ? mapsViewLink(dl.name, dl.address, dl.city, dl.state) : ""
    };
  }
  var pl = locById(o.pickup_location_id), dl = locById(o.delivery_location_id);
  return {
    pickup: pl ? mapsViewLink(pl.name, pl.address, pl.city, pl.state) : "",
    drop: dl ? mapsViewLink(dl.name, dl.address, dl.city, dl.state) : ""
  };
}
/* The 7 non-date cells of one Driver Tabs slot (Load/Notes/PO-PU#/
   Delivery#/Store Maps/Pickup/Drop, D185 — column order now matches the
   real pushed sheet's B:I layout letter-for-letter, not just Date/Load/
   Notes/Pickup/Drop/Store Maps like before) — factored out of
   vDriverView's render loop (D147) so a drag-drop move can repaint a slot
   exactly the way the initial render built it, instead of the narrower
   innerHTML-only patch repaintCell() used to do (which only ever touched
   the Load cell, and even then only when dropping onto a cell that
   already had a chip — an empty slot receiving a drag, or a slot a load
   was dragged OUT of, still needed a full page reload to show correctly).
   Every caller must emit exactly 7 sibling elements in this order —
   repaintDvSlot() below walks siblings by position, there's no other way
   to address them (the .dv grid has no per-row wrapper, D137). */
function dvSlotCellsHtml(key) {
  var v = CELLS[key], o = v && v.oid ? order(v.oid) : null;
  if (!o) {
    var scheduleNoteInput = '<textarea class="dv-note" data-notekey="' + key + '" placeholder="Note">' +
      esc(v ? (v.text || "") : "") + "</textarea>";
    return '<div class="dv-cell" data-key="' + key + '"' +
      (v && v.text ? ' style="color:var(--ink-2)"' : "") + '>' + (v && v.text ? esc(v.text) : "") + "</div>" +
      '<div class="dv-cell">' + scheduleNoteInput + "</div><div></div><div></div><div></div><div></div><div></div>";
  }
  var links = isExt(o) ? driverPickupDropLinks(o) : { pickup: "", drop: "" };
  var storeMap = (!isExt(o) && o.customer_party_id) ? (locFor(o.customer_party_id) || {}).map_url || "" : "";
  // Placeholder is generic "Note" (Nate's ask) — it shouldn't announce what
  // the field becomes once you're in it; that's what the label column
  // already says.
  var driverNoteInput = '<textarea class="dv-note" data-notekey="' + key + '" data-oid="' + o.id +
    '" placeholder="Note">' + esc(o.driver_note || "") + "</textarea>";
  // PO/PU# and Delivery# (D185) — same two fields that land in the pushed
  // sheet's E/F columns, editable here the same way; internal orders never
  // carry them, matching `_driver_week_payload`'s own external-only gate.
  var poInput = isExt(o) ? '<input class="dv-field-inp" type="text" data-dvfield="po_number" data-oid="' +
    o.id + '" value="' + esc(o.po_number || "") + '">' : "";
  var deliveryInput = isExt(o) ? '<input class="dv-field-inp" type="text" data-dvfield="delivery_number" data-oid="' +
    o.id + '" value="' + esc(o.delivery_number || "") + '">' : "";
  return '<div class="dv-cell" data-key="' + key + '" draggable="true" data-oid="' + o.id + '" data-from="' + key +
    '" style="cursor:grab">' + chipHtml(o, false, "", v.cat, v.fmt, pushColorFor(o, v)) + "</div>" +
    '<div class="dv-cell">' + driverNoteInput + "</div>" +
    '<div class="dv-cell">' + poInput + "</div>" +
    '<div class="dv-cell">' + deliveryInput + "</div>" +
    '<div class="dv-cell">' + mapLinkHtml(storeMap, "Store Maps") + "</div>" +
    '<div class="dv-cell">' + mapLinkHtml(links.pickup, "Pickup") + "</div>" +
    '<div class="dv-cell">' + mapLinkHtml(links.drop, "Drop") + "</div>";
}
/* Repaints one Driver Tabs slot in place after its data changes (drag-drop
   move, note save) — finds the slot's Load cell by data-key, then swaps it
   and its 6 known siblings (Notes/PO-PU#/Delivery#/Store Maps/Pickup/Drop,
   in that fixed order, D185) for freshly built ones. Returns false if the
   slot isn't currently on screen (a different truck tab is showing), so
   callers can fall back. */
function repaintDvSlot(key) {
  var loadEl = document.querySelector('.dv-cell[data-key="' + CSS.escape(key) + '"]');
  if (!loadEl) return false;
  var temp = document.createElement("div");
  temp.innerHTML = dvSlotCellsHtml(key);
  var newEls = [].slice.call(temp.children);
  var oldEls = [loadEl], cur = loadEl;
  for (var i = 1; i < newEls.length; i++) { cur = cur.nextElementSibling; if (!cur) return false; oldEls.push(cur); }
  oldEls.forEach(function (old, idx) { old.replaceWith(newEls[idx]); });
  return true;
}
/* Driver Tabs — an editable view onto a single driver's real Google Sheets
   tab (D137), column-for-column: DATE | {driver name} | NOTES | PO/PU# |
   DELIVERY# | STORE MAPS | PICKUP | DROP, matching push-driver-tabs' own
   B:I layout letter-for-letter (D185 — Nate: "whatever i edit inside of
   the driver tabs on the dash i can just directly push to the sheet and
   its perfect all of its in the same spots"; the view had drifted out of
   sync with D178–D183's column changes — PO#/Delivery# didn't exist here
   at all, and Pickup/Drop sat where PO#/Delivery# now live on the real
   sheet). The Load column renders the actual scheduler chip (D140 — was
   raw ported text before, which looked and read nothing like the same
   load's chip everywhere else in the app); Notes edits the order's
   driver_note, the one note that's actually pushed to the driver's Sheets
   tab (D140 — was the load's own notes field before, a third,
   since-retired note concept nobody could tell apart from the other two).
   PO/PU# and Delivery# edit the same `po_number`/`delivery_number` fields
   `_driver_week_payload` reads for columns E/F — external orders only,
   same gate the payload itself uses. Bypasses .pad (05-settings-nav-
   search.js) the same way Current Week does, so the header is pixel-
   identical between the two views. */
function vDriverView() {
  /* Truck picker (D116), not driver — one tab per truck (Fleet's sort_order),
     linked to the same entity the Scheduler and the real Google Sheets driver
     tabs use. Used to be keyed by DB.drivers: an unassigned truck (no current
     driver) got no tab at all, and the tab count silently drifted from the
     fleet's real size. DRIVER_VIEW now holds a truck id. */
  if (!DRIVER_VIEW && DB.trucks.length) DRIVER_VIEW = DB.trucks[0].id;
  // Same CW_START/CW_DAYS window Current Week shows and push-driver-tabs
  // pushes (D139) — Driver Tabs used to iterate its own hardcoded Monday+5
  // days, unrelated to what a push would actually send; editing a "day 6"
  // slot here that a 5-day push window would never touch, or not realizing
  // a push overwrites a totally different range than what's on screen, was
  // the real risk. #cw-start/#cw-days/data-cw-step already update these
  // globals from anywhere (07-events.js) — reusing the exact same ids here
  // means the two views' controls are the same control, not a synced copy.
  var h = toolbarHtml("Driver Tabs", {
    className: "cw-toolbar",
    context: '<span class="lbl">First day drivers see</span><input type="text" inputmode="numeric" placeholder="MM/DD/YYYY" data-smartdate id="cw-start" data-last-iso="' + esc(CW_START) + '" value="' + esc(isoToMdy(CW_START)) + '">' +
      '<span class="cw-daysshown"><span class="lbl" style="margin-left:6px">Days shown</span><span class="fb-fs" aria-label="Days shown">' +
        '<button class="fb-fs-b" data-cw-step="-1" title="Show one fewer day"' + (CW_DAYS <= 1 ? " disabled" : "") + '>&minus;</button>' +
        '<input class="fb-fs-inp" type="text" inputmode="numeric" id="cw-days" value="' + CW_DAYS + '" title="Days shown (1–14)">' +
        '<button class="fb-fs-b" data-cw-step="1" title="Show one more day"' + (CW_DAYS >= 14 ? " disabled" : "") + '>+</button>' +
      "</span></span>",
    primary: '<button class="btn pri" id="push-driver-tabs">' + icon("sync") + 'Update Google Schedule</button>'
  });
  h += '<div style="flex:1;min-height:0;overflow:auto;padding:10px 14px 14px">';
  h += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">' +
    DB.trucks.map(function (t) {
      return '<button class="btn sm' + (t.id === DRIVER_VIEW ? " pri" : "") + '" data-dvpick="' + t.id + '">' +
        esc(t.driver_name || "— unassigned —") + '<span style="opacity:.6"> · ' + esc(t.number) + " " + esc(t.eq || "") + "</span></button>";
    }).join("") + "</div>";
  var dvTruck = truckById(DRIVER_VIEW);
  // Column order matches the real pushed sheet's B:I letters exactly
  // (D185): Date/Load/Notes/PO-PU#/Delivery#/Store Maps/Pickup/Drop.
  h += '<div class="dv" style="grid-template-columns:78px 1.6fr 1.3fr 84px 84px 64px 64px 64px">' +
    '<div class="hd">Date</div><div class="hd">' + esc((dvTruck && dvTruck.driver_name) || "Load") + '</div>' +
    '<div class="hd">Notes</div><div class="hd">PO / PU #</div><div class="hd">Delivery #</div>' +
    '<div class="hd">Store Maps</div><div class="hd">Pickup</div><div class="hd">Drop</div>';
  if (!dvTruck) return h + "</div></div>";
  var dates = currentWeekDates();
  // Every slot renders now, not just occupied ones (D137) — an empty slot is
  // still a real drop target (data-key, same cellKey the Scheduler/Current
  // Week use), so a chip can be dragged in from Staging here too.
  for (var i = 0; i < dates.length; i++) {
    var day = dates[i], ds = iso(day);
    for (var s = 1; s <= 3; s++) {
      var key = cellKey(dvTruck.id, ds, s);
      var dateCell = s === 1 ? '<div class="n" style="font-weight:600">' + DOW[day.getUTCDay()] + " " + ds.slice(5) + "</div>"
        : '<div class="n"></div>';
      h += dateCell + dvSlotCellsHtml(key);
    }
  }
  h += "</div></div>";
  return h;
}
/* External Orders (D33) — full parity with the legacy External Order
   Tracker's columns: Order #, Load #, Broker/Customer, PU/PO, Delivery #,
   Notes/Appointment info, Pickup Address, Delivery Address. Two ways in:
   drop a rate con (auto-detected) or "+ New Order" and type it by hand —
   every column here is inline-editable either way. Pickup/Delivery Address
   dropdown from the Pick/Drop List (D33, `DB.locations`, not tied to a
   party). No whole-row click-to-open (unlike before) — inline `<select>`s
   need real clicks of their own, so opening the drawer is now an explicit
   "Open" action instead of fighting event bubbling. */
/* D86: real lifecycle stages for the leftmost Stage column, replacing the old
   ad-hoc on-board/staged pills. Computed, not stored — mirrors how "on board"
   already worked via placement(); orders.stage (the order_stage enum) is left
   alone except for the existing cancelled<->ordered "No delivery" toggle.
   "Billed" reads the real orders.billed_at (the Billing page's own biller-
   queue toggle, D62/api_bill_order) — not a guess, the actual field Billing
   already uses to mean "left the queue".
   Internal: No delivery > Delivered > Scheduled > Staging (default).
   External: Billed > Delivered > Scheduled > Staging (default). */
function stagePill(o, on) {
  var label = "Staging", cls = "staging";
  if (o.stage === "cancelled") { label = "Cancelled"; cls = "bad"; }
  else if (o.kind === "external" && o.billed_at) { label = "Billed"; cls = "billed"; }
  else if (o.delivered_at) { label = "Delivered"; cls = "on"; }
  else if (on) { label = "Scheduled"; cls = "mid"; }
  // Outside-carrier is a second axis (D115), so preserve it as a small marker
  // inside the fixed status segment instead of adding another segment that
  // would move Copy/Stage or widen the joined control.
  var carrier = carrierMap()[o.id]
    ? '<span class="tracker-carrier" title="Brokered to an outside carrier">C</span>'
    : "";
  return '<span class="tracker-state ' + cls + '"><span>' + label + "</span>" + carrier + "</span>";
}
/* The "Stage →" action only makes sense while an order is still in the
   default Staging bucket — hide it once scheduled/delivered/billed/
   cancelled or already sitting in the STAGED rail. */
function canStageOrder(o, on) {
  if (o.stage === "cancelled") return false;
  if (o.kind === "external" && o.billed_at) return false;
  if (o.delivered_at || on) return false;
  return STAGED.indexOf(o.id) < 0;
}
function canCancelOrder(o) {
  return o.stage !== "cancelled" && !o.delivered_at && !o.billed_at;
}
function canDeleteOrder(o) { return !o.delivered_at && !o.billed_at; }
function trackerOpenTh() {
  return '<th class="tracker-open-col"><span class="tracker-open-head" role="img" aria-label="Open order panel" title="Open order panel">' +
    icon("orderPanel") + "</span></th>";
}
function trackerOpenTd(o) {
  return '<td class="tracker-open-col"><button class="tracker-open" data-open="' + o.id +
    '" title="Open order panel" aria-label="Open order panel">' + icon("orderPanel") + "</button></td>";
}
/* Positive workflow actions live in the fixed joined control beside the
   dedicated Open column (D211). Cancel/Delete used to have their own
   far-right per-row buttons (destructiveOrderControls) plus a drawer-level
   Cancel (schedBar); both were retired in favor of the numbered-gutter
   multi-select's bulk Cancel/Delete (D159) — select one row and it's a
   single-order cancel/delete same as before, just through the toolbar
   instead of a per-row button. */
function stageControls(o, on, includeCopy) {
  var h = stagePill(o, on);
  if (includeCopy) h += '<button class="tracker-action tracker-copy" data-copy-order="' + o.id + '" title="' +
    (o.is_transfer ? "Same department and route, a fresh instance to fill in" :
      (o.kind === "internal" ? "Same customer and details, a fresh order to number" : "Same pick/drop, new rate from the broker")) +
    '">' + icon("copy") + "Copy</button>";
  // Stage/Restore owns the final segment so it can fold away without leaving
  // a reserved slot. Status and Copy never shift when that end segment goes.
  if (canStageOrder(o, on)) h += '<button class="tracker-action tracker-stage" data-stage="' + o.id + '">Stage &rarr;</button>';
  if (o.stage === "cancelled") h += '<button class="tracker-action tracker-stage" data-restore-order="' + o.id + '">Restore</button>';
  return '<div class="stage-actions">' + h + '</div>';
}
/* Keep the live external workflow above billed history, independent of dates.
   Within each bucket, Solomon order numbers are newest-first. A rate con can
   create an order before Solomon assigns its number, so numberless live rows
   stay at the very top where they cannot be overlooked. */
function externalOrderCompare(a, b) {
  var billed = Number(!!a.billed_at) - Number(!!b.billed_at);
  if (billed) return billed;

  var an = String(a.solomon_order_no || "").trim();
  var bn = String(b.solomon_order_no || "").trim();
  if (!an && bn) return a.billed_at ? 1 : -1;
  if (an && !bn) return b.billed_at ? -1 : 1;
  return bn.localeCompare(an, undefined, { numeric: true, sensitivity: "base" });
}
/* Collapsed "already handled" section on an order tracker (D232) — Nate:
   billed External Orders / delivered Internal Freight rows are done, he
   doesn't need them on screen day to day, only when he's actually looking
   for one ("once i search it i'll find it" — this only hides table rows,
   it never filters `orders()`/global search/drawer-open-by-id, so nothing
   about finding a specific order changes). Closed by default each render,
   in-memory only like GRIDSORT — no localStorage. Mirrors the
   History panel's day-header disclosure exactly (13-history.js, D135): one
   ▸ arrow that rotates via CSS on `[aria-expanded="true"]`, not a swapped
   glyph, same class-naming formula under a tracker-scoped prefix. */
var TRACKER_COLLAPSED_OPEN = {};
function trackerCollapseToggleRow(key, label, count, colspan) {
  var open = !!TRACKER_COLLAPSED_OPEN[key];
  return '<tr class="tracker-collapse-row"><td colspan="' + colspan + '">' +
    '<button class="tracker-collapse-hd" data-tracker-collapse="' + esc(key) + '" aria-expanded="' + open + '">' +
    '<span><span class="tracker-collapse-arrow">&#9656;</span>' + esc(label) + '</span>' +
    '<span class="tracker-collapse-ct">' + count + '</span></button></td></tr>';
}
/* Paged rendering inside an expanded collapse group (D235) — Nate: "it lags
   the app when i scroll on the delivered or billed orders in the order
   trackers." External's Billed group alone is 1,000+ real rows; rendering
   all of them into the DOM the moment the group opens is the same class of
   problem D222 already fixed for the Scheduler (too many live DOM nodes =
   janky scroll/paint, independent of any actual re-render on scroll) — the
   fix here is the same idea at flat-list scale: render a bounded page,
   with a "Show more" row to pull in another page on demand, instead of
   paying for the whole group up front. Collapsing the group again clears
   the shown-count back to one page, so reopening it later doesn't
   silently show a stale, unbounded amount. */
var TRACKER_COLLAPSED_SHOWN = {};
var TRACKER_COLLAPSE_PAGE = 150;
function trackerCollapseMoreRow(key, shown, total, colspan) {
  var remaining = total - shown;
  if (remaining <= 0) return "";
  var next = Math.min(remaining, TRACKER_COLLAPSE_PAGE);
  return '<tr class="tracker-collapse-more-row"><td colspan="' + colspan + '">' +
    '<button class="tracker-collapse-more" data-tracker-collapse-more="' + esc(key) + '">Show ' + next +
    ' more (' + remaining + ' left)</button></td></tr>';
}
/* Renders up to a page of `rows` (continuing the numbered gutter from
   `startIndex`) via `rowFn`, followed by a Show-more row if there's more
   than one page — the one place this paging logic lives, called from each
   tracker's collapsed-group branch. */
function trackerCollapsedRowsHtml(key, rows, startIndex, rowFn, colspan) {
  var shown = Math.min(TRACKER_COLLAPSED_SHOWN[key] || TRACKER_COLLAPSE_PAGE, rows.length);
  var h = "";
  for (var i = 0; i < shown; i++) h += rowFn(rows[i], startIndex + i);
  return h + trackerCollapseMoreRow(key, shown, rows.length, colspan);
}
/* One External Orders row. `i` is the numbered-gutter row number — callers
   keep it continuous across the live/billed split so the gutter still
   reads as one sequence when the Billed group is expanded. */
function extOrderRowHtml(o, i, pm) {
  var nd = docsFor(o.id).length, on = pm[o.id], customRoute = o.route_mode === "custom";
  var routeStops = customRoute ? orderStops(o.id) : [];
  var firstPick = routeStops.filter(function (s) { return s.stop_type === "pickup"; })[0];
  var drops = routeStops.filter(function (s) { return s.stop_type === "delivery"; });
  var lastDrop = drops.length ? drops[drops.length - 1] : null;
  return '<tr data-roworder="' + o.id + '">' +
    trackerSelTd("ext", o.id, i + 1) +
    trackerOpenTd(o) +
    '<td class="order-actions-col"><div class="cell">' + stageControls(o, on, true) + "</div></td>" +
    '<td><div class="cell"><input class="cell-i n" data-oedit="' + o.id + '" data-field="solomon_order_no" value="' +
      esc(o.solomon_order_no || "") + '"></div></td>' +
    '<td><div class="cell"><input class="cell-i n" data-oedit="' + o.id + '" data-field="broker_load_no" value="' +
      esc(o.broker_load_no || "") + '"></div></td>' +
    '<td><div class="cell" style="padding:0">' +
      partyCombo(o.id, "broker_party_id", o.broker_party_id, "Search brokers") + "</div></td>" +
    '<td><div class="cell">' + (customRoute ? '<span class="n">' + esc((firstPick && firstPick.reference_number) || "") + '</span>' :
      '<input class="cell-i n" data-oedit="' + o.id + '" data-field="po_number" value="' + esc(o.po_number || "") + '">') + '</div></td>' +
    '<td><div class="cell">' + (customRoute ? '<span class="n">' + esc((lastDrop && lastDrop.reference_number) || "") + '</span>' :
      '<input class="cell-i n" data-oedit="' + o.id + '" data-field="delivery_number" value="' + esc(o.delivery_number || "") + '">') + '</div></td>' +
    '<td><div class="cell"><input class="cell-i" data-oedit="' + o.id + '" data-field="notes" value="' +
      esc(o.notes || "") + '"></div></td>' +
    '<td><div class="cell" style="text-align:center"><input type="checkbox" data-oedit="' + o.id +
      '" data-field="tarp"' + (o.tarp ? " checked" : "") + '></div></td>' +
    '<td><div class="cell">' + (customRoute ? '<button class="route-cell" data-route-edit="' + o.id + '">' +
      esc(routeStopLabel(firstPick)) + '<small>' + esc(routeCompactLabel(o)) + '</small></button>' :
      locCombo(o.id, "pickup_location_id", o.pickup_location_id, null)) + "</div></td>" +
    '<td><div class="cell">' + (customRoute ? '<button class="route-cell" data-route-edit="' + o.id + '">' +
      esc(routeStopLabel(lastDrop)) + '<small>Open full route</small></button>' :
      locCombo(o.id, "delivery_location_id", o.delivery_location_id, null)) + "</div></td>" +
    dateOeditCell(o.id, "ordered_at", o.ordered_at && String(o.ordered_at).slice(0, 10)) +
    dateOeditCell(o.id, "delivered_at", o.delivered_at && String(o.delivered_at).slice(0, 10)) +
    '<td><div class="cell n">' + nd + "</div></td></tr>";
}
var EXT_TRACKER_COLS = 15;  // keep in sync with vOrders' <thead> — colspan for the Billed toggle row
function vOrders(kind) {
  var pm = placement();
  var rows = orders().filter(function (o) {
    return o.kind === "external" && !o.is_transfer && !isHistorical(o) && externalOrderInYear(o, YEAR);
  }).sort(externalOrderCompare);
  var liveRows = rows.filter(function (o) { return !o.billed_at; });
  var billedRows = rows.filter(function (o) { return o.billed_at; });
  var h = toolbarHtml("External Orders", {
    className: "orders-toolbar", context: yearPicker(),
    secondary: ordersToolbarExtras() + trackerBulkButtonsHtml("ext"),
    primary: '<button class="btn pri sm orders-primary-btn" id="new-order">+ New Order</button>'
  });
  h += '<div class="drop" id="rc-drop" style="margin-bottom:10px"><b>Drop a rate con here</b></div>';
  h += '<div class="grid-wrap tracker-scroll"><table class="data order-tracker external-tracker" style="width:1948px"><thead><tr>' +
    trackerSelTh("ext") +
    trackerOpenTh() +
    '<th class="order-actions-col" style="width:220px">Status / Stage</th>' +
    '<th style="width:120px">Order #</th><th style="width:96px">Load #</th>' +
    '<th style="width:190px">Broker/Customer</th><th style="width:100px">PU/PO</th>' +
    '<th style="width:100px">Delivery #</th><th style="width:200px">Notes / Appointment info</th>' +
    '<th style="width:56px">Tarp</th>' +
    '<th style="width:180px">Pickup Address</th><th style="width:180px">Drop Address</th>' +
    '<th style="width:112px">Ordered</th><th style="width:112px">Delivered</th>' +
    "<th style=\"width:64px\">Docs</th>" +
    "</tr></thead><tbody>";
  liveRows.forEach(function (o, i) { h += extOrderRowHtml(o, i, pm); });
  if (billedRows.length) {
    h += trackerCollapseToggleRow("ext-billed", "Billed", billedRows.length, EXT_TRACKER_COLS);
    if (TRACKER_COLLAPSED_OPEN["ext-billed"])
      h += trackerCollapsedRowsHtml("ext-billed", billedRows, liveRows.length,
        function (o, i) { return extOrderRowHtml(o, i, pm); }, EXT_TRACKER_COLS);
  }
  return h + "</tbody></table></div>";
}
/* Internal Order Tracker (D30/D31/D217) — month-grouped, matching the legacy
   sheet's JAN–JUL / OFF SZN blocks. Bag Order numbers are generated from the
   current workspace pattern and remain type-overable. External numbers are
   entered by hand when the order is built in Solomon (D21).
   Customer here is a dropdown against Bagger Customers since every internal
   order matches one. */
/* Order-tracker Ordered/Delivered date cell (D152) — every date field in
   the app is a smart date input now, not just Reports/Current Week.
   Saves through the existing generic data-oedit change handler
   (07-events.js), which already knows to read data-last-iso for a
   smart-date field instead of .value. */
function dateOeditCell(oid, field, isoVal, disabled) {
  return '<td><div class="cell"><input class="cell-i n" type="text" inputmode="numeric" placeholder="MM/DD/YYYY"' +
    ' data-smartdate data-oedit="' + oid + '" data-field="' + field + '" data-last-iso="' + esc(isoVal || "") +
    '" value="' + esc(isoToMdy(isoVal)) + '"' + (disabled ? " disabled" : "") + "></div></td>";
}
/* Truck display on Bag Orders/Internal Freight (D239) — plain read-only
   text, not another data-oedit field: it's sourced from orders.truck_id,
   stamped by "Sync Delivery Dates" from whichever load the order last
   scheduled onto, so a manual override here would misrepresent which
   truck actually ran it. Sits directly before Miles per Nate's ask
   ("keep miles and $ next to each other but we need truck"). */
function truckCell(o) {
  return '<td><div class="cell n">' + esc(o.truck_number || "") + "</div></td>";
}
/* Miles / Transfer-$ cells on Internal Orders (D48) — live on the order
   itself (D103), editable the moment the order exists, no staging required.
   Miles pre-fill from Motive once a load exists; an "adj" badge + reset (↺)
   appear once typed over. Both save via api_freight by order id. */
function milesCell(o) {
  return '<td data-frcell="1"><div class="cell freight-cell">' +
    '<input class="cell-i n" type="number" step="0.1" data-frorder="' + o.id + '" data-frfield="miles" value="' +
      (o.miles == null ? "" : o.miles) + '">' +
    (o.miles_adjusted
      ? '<span class="pill mid" title="Typed over">adj</span>' +
        '<button class="btn sm" data-frreset="' + o.id + '" title="Reset to Motive miles">&#8635;</button>'
      : (o.motive_miles != null ? '<span class="pill on" title="From Motive ELD">ELD</span>' : "")) +
    "</div></td>";
}
function freightCell(o) {
  return '<td data-frcell="1"><div class="cell freight-cell"><input class="cell-i n" data-frorder="' + o.id +
    '" data-frfield="freight_amount" value="' + (o.internal_freight_amount == null ? "" : o.internal_freight_amount) +
    '"></div></td>';
}
/* Swaps just one Miles/Transfer-$ <td> in place after a save (D186) — a
   full reload() there used to scroll the whole tracker back to the top
   every time (Nate, live: typing a mileage number reset the view back to
   the front of the table), the same class of bug D84/D122/D128 fixed for
   other order-tracker/drawer fields. Returns false if the cell isn't
   currently on screen (a different month/year is showing). */
function repaintFreightCell(oid, field) {
  var o = order(oid); if (!o) return false;
  var inp = document.querySelector('input[data-frorder="' + CSS.escape(oid) + '"][data-frfield="' + field + '"]');
  var td = inp && inp.closest("td");
  if (!td) return false;
  td.outerHTML = field === "miles" ? milesCell(o) : freightCell(o);
  return true;
}
/* Bag Orders' order # is type-overable (D156), same as External's
   solomon_order_no — so the grid must live-resort as a number is edited
   (Nate: "auto sort by the order number so its always sorted and live
   updated as i edit order numbers"). A full render() on every blur would
   rebuild the row the user just tabbed INTO and break tab-through (the same
   D84 bug fixed for the broker/customer combos) — so this moves just the
   one <tr> DOM node to its new sorted position instead of rebuilding the
   table. If the edited number no longer belongs in the currently viewed
   year, there's no lightweight repositioning possible — fall back to a
   full render(). Newest-to-oldest, same numeric compare as
   externalOrderCompare (D233 dropped the monthly breakout — flat,
   year-scoped, delivered orders collapsed the same way as External's
   Billed group). A number edit never itself changes delivered_at, so the
   row stays within whichever bucket (live/delivered) it was already in —
   reposition only within that bucket, anchored on the collapse toggle row
   (if the row is moving to the end of the live bucket) or the tbody's own
   end otherwise. If the row isn't in the DOM at all (its bucket is
   currently collapsed), there's nothing to reposition — no-op. */
function bagOrderCompare(a, b) {
  var an = String(a.solomon_order_no || "").trim();
  var bn = String(b.solomon_order_no || "").trim();
  if (!an && bn) return -1;
  if (an && !bn) return 1;
  return bn.localeCompare(an, undefined, { numeric: true, sensitivity: "base" });
}
function resortInternalTrackerRow(oid) {
  var tbody = document.querySelector("table.internal-tracker tbody");
  if (!tbody) return;
  var tr = tbody.querySelector('tr[data-roworder="' + oid + '"]');
  var o = order(oid);
  if (!tr || !o) return;
  var yy = String(YEAR).slice(2);
  if (o.kind !== "internal" || !internalOrderInYear(o, yy)) { render(); return; }
  var bucket = orders().filter(function (x) {
    return x.kind === "internal" && internalOrderInYear(x, yy) && !!x.delivered_at === !!o.delivered_at;
  }).sort(bagOrderCompare);
  var idx = bucket.indexOf(o);
  var hasNextInBucket = idx >= 0 && idx + 1 < bucket.length;
  var nextInBucket = hasNextInBucket ? tbody.querySelector('tr[data-roworder="' + bucket[idx + 1].id + '"]') : null;
  // A real next bucket-mate exists but isn't rendered (D235 paging — it's
  // past the currently shown page of a collapsed group) — no reliable local
  // anchor to reposition against, fall back to a full render() rather than
  // guessing a spot.
  if (hasNextInBucket && !nextInBucket) { render(); return; }
  var anchor = nextInBucket || (!o.delivered_at ? tbody.querySelector(".tracker-collapse-row") : null);
  if (anchor) tbody.insertBefore(tr, anchor); else tbody.appendChild(tr);
  // The numbered gutter (D159) is just a positional index, not a stable id —
  // renumber it after the move so it doesn't go stale until a real render().
  [].forEach.call(tbody.querySelectorAll(".rowgut"), function (td, i) { td.textContent = i + 1; });
}
/* One Bag Orders row (D233, same split as ext/xfer — extOrderRowHtml /
   xferOrderRowHtml just above). */
function bagOrderRowHtml(o, i, pm) {
  var dead = o.stage === "cancelled";
  var loc = o.customer_party_id ? locFor(o.customer_party_id) : null;
  // EAST is is_umatilla (D36), not a timing_window value (D82).
  var winKey = null;
  if (loc) {
    if (loc.timing_window === "early") winKey = loc.is_umatilla ? "earlyE" : "early";
    else if (loc.timing_window) winKey = loc.is_umatilla ? "anytimeE" : "anytime";
    else if (loc.is_umatilla) winKey = "anytimeE";
  }
  var win = winKey ? WIN[winKey] : null;
  var on = pm[o.id];
  return '<tr class="' + (dead ? "row-dead" : "") + '" data-roworder="' + o.id + '">' +
    trackerSelTd("int", o.id, i + 1) +
    trackerOpenTd(o) +
    '<td class="order-actions-col"><div class="cell">' + stageControls(o, on, true) + "</div></td>" +
    '<td><div class="cell"><input class="cell-i n" data-oedit="' + o.id + '" data-field="solomon_order_no" value="' +
      esc(o.solomon_order_no || "") + '"' + (dead ? " disabled" : "") + '></div></td>' +
    '<td><div class="cell"><input class="cell-i n" type="number" min="0" data-oedit="' + o.id +
      '" data-field="pallet_count" value="' + (o.pallet_count == null ? "" : o.pallet_count) + '"' +
      (dead ? " disabled" : "") + "></div></td>" +
    '<td><div class="cell" style="padding:0">' +
      partyCombo(o.id, "customer_party_id", o.customer_party_id, "Search customers", dead) + "</div></td>" +
    '<td><div class="cell">' + (win ? '<span class="flag w" style="--fc:' + win.c + '">' + esc(win.t) +
      "</span>" : "") + "</div></td>" +
    dateOeditCell(o.id, "ordered_at", o.ordered_at && String(o.ordered_at).slice(0, 10), dead) +
    dateOeditCell(o.id, "delivered_at", o.delivered_at && String(o.delivered_at).slice(0, 10), dead) +
    '<td><div class="cell"><input class="cell-i" data-oedit="' + o.id + '" data-field="notes" value="' +
      esc(o.notes || "") + '"' + (dead ? " disabled" : "") + "></div></td>" +
    truckCell(o) + milesCell(o) + freightCell(o) + "</tr>";
}
var INT_TRACKER_COLS = 13;  // keep in sync with vInternal's <thead> — colspan for the Delivered toggle row
function vInternal() {
  var pm = placement();
  var yy = String(YEAR).slice(2);
  var rows = orders().filter(function (o) {
    return o.kind === "internal" && internalOrderInYear(o, yy);
  }).sort(bagOrderCompare);
  var liveRows = rows.filter(function (o) { return !o.delivered_at; });
  var deliveredRows = rows.filter(function (o) { return o.delivered_at; });

  var h = toolbarHtml("Bag Orders", {
    className: "orders-toolbar", context: yearPicker(),
    secondary: ordersToolbarExtras() + trackerBulkButtonsHtml("int"),
    primary: '<button class="btn pri sm orders-primary-btn" id="int-bulk">Add Orders</button>'
  });

  h += '<div class="grid-wrap tracker-scroll"><table class="data order-tracker internal-tracker" style="width:1606px"><thead><tr>' +
    trackerSelTh("int") +
    trackerOpenTh() +
    '<th class="order-actions-col" style="width:220px">Status / Stage</th>' +
    '<th style="width:130px">Order #</th><th style="width:64px">PAL</th>' +
    '<th style="width:220px">' + esc(fieldLabel("bagger", "name", "Customer")) + '</th>' +
    '<th style="width:100px">' + esc(fieldLabel("bagger", "category_id", "Time Window")) + '</th>' +
    '<th style="width:112px">Ordered</th><th style="width:112px">Delivered</th>' +
    '<th style="width:240px">Notes</th><th style="width:80px">Truck</th><th style="width:150px">Miles</th>' +
    '<th style="width:100px">Transfer $</th></tr></thead><tbody>';

  liveRows.forEach(function (o, i) { h += bagOrderRowHtml(o, i, pm); });
  if (deliveredRows.length) {
    h += trackerCollapseToggleRow("int-delivered", "Delivered", deliveredRows.length, INT_TRACKER_COLS);
    if (TRACKER_COLLAPSED_OPEN["int-delivered"])
      h += trackerCollapsedRowsHtml("int-delivered", deliveredRows, liveRows.length,
        function (o, i) { return bagOrderRowHtml(o, i, pm); }, INT_TRACKER_COLS);
  }
  h += "</tbody></table></div>";
  h += '<button class="btn sm" id="int-add" style="margin-top:8px">+ Add one</button>';
  return h;
}
/* Internal Freight tracker (D127) — dept-to-dept mileage/$ transfers with no
   customer at all (e.g. "Bag Plant to Umatilla Yard"). Stays kind='external'
   under the hood (is_transfer=true) so scheduling/chip placement need no
   changes, but is its own tracker: no broker/PO/pickup-drop/documents
   fields, just a department, a route note, and the same actual-miles + $
   transfer figure Bag Orders already have (milesCell/freightCell, D103).
   Flat and date-sorted like External Orders — no month-block reservation,
   since transfers are never Solomon-numbered (never invoiced). */
/* One Internal Freight row (D232, split out of vInternalFreight the same
   way extOrderRowHtml was — see that comment for `i`). */
function xferOrderRowHtml(o, i) {
  var on = placement()[o.id];
  return '<tr data-roworder="' + o.id + '">' +
    trackerSelTd("xfer", o.id, i + 1) +
    trackerOpenTd(o) +
    '<td class="order-actions-col"><div class="cell">' + stageControls(o, on, true) + "</div></td>" +
    '<td><div class="cell"><input class="cell-i" data-oedit="' + o.id + '" data-field="notes" value="' +
      esc(o.notes || "") + '"></div></td>' +
    '<td><div class="cell"><select class="cell-i" data-oedit="' + o.id + '" data-field="transfer_department_id">' +
      '<option value="">— pick department —</option>' +
      departmentsForPicker(o.transfer_department_id).map(function (dpt) {
        return '<option value="' + dpt.id + '"' + (dpt.id === o.transfer_department_id ? " selected" : "") + ">" +
          esc(dpt.name) + "</option>";
      }).join("") + "</select></div></td>" +
    dateOeditCell(o.id, "ordered_at", o.ordered_at && String(o.ordered_at).slice(0, 10)) +
    dateOeditCell(o.id, "delivered_at", o.delivered_at && String(o.delivered_at).slice(0, 10)) +
    truckCell(o) + milesCell(o) + freightCell(o) + "</tr>";
}
var XFER_TRACKER_COLS = 10;  // keep in sync with vInternalFreight's <thead> — colspan for the Delivered toggle row
function vInternalFreight() {
  /* Transfers are never treated as "2025 historical" (D221 continued,
     2026-09-12) — that read-only-history concept is for the old bag/external
     import backlog; this tracker always shows a transfer under its real
     delivered-date year via the ordinary Year picker, no separate season
     concept (Nate: the year picker already does that job). */
  var rows = orders().filter(function (o) {
    return o.is_transfer && externalOrderInYear(o, YEAR);
  }).sort(function (a, b) { return String(b.ordered_at || "").localeCompare(String(a.ordered_at || "")); });
  // Transfers are never billed (no solomon #, no customer/broker, ever —
  // orders_transfer_shape) so "handled" here reads delivered_at instead of
  // billed_at, unlike External Orders' Billed group (Nate: "same with
  // internal freight if its delivered collapse it").
  var liveRows = rows.filter(function (o) { return !o.delivered_at; });
  var deliveredRows = rows.filter(function (o) { return o.delivered_at; });
  var depts = departmentsForPicker(null);
  var h = toolbarHtml("Internal Freight", {
    className: "orders-toolbar", context: yearPicker(),
    secondary: ordersToolbarExtras() + trackerBulkButtonsHtml("xfer"),
    primary: '<button class="btn pri sm orders-primary-btn" id="xfer-bulk">Add Orders</button>'
  });
  h += '<div class="grid-wrap tracker-scroll"><table class="data order-tracker" style="width:1460px"><thead><tr>' +
    trackerSelTh("xfer") +
    trackerOpenTh() +
    '<th class="order-actions-col" style="width:220px">Status / Stage</th>' +
    '<th style="width:300px">Load Info</th>' +
    '<th style="width:200px">Department</th>' +
    '<th style="width:112px">Ordered</th><th style="width:112px">Delivered</th>' +
    '<th style="width:80px">Truck</th><th style="width:150px">Miles</th><th style="width:100px">Transfer $</th></tr></thead><tbody>';
  liveRows.forEach(function (o, i) { h += xferOrderRowHtml(o, i); });
  if (deliveredRows.length) {
    h += trackerCollapseToggleRow("xfer-delivered", "Delivered", deliveredRows.length, XFER_TRACKER_COLS);
    if (TRACKER_COLLAPSED_OPEN["xfer-delivered"])
      h += trackerCollapsedRowsHtml("xfer-delivered", deliveredRows, liveRows.length,
        function (o, i) { return xferOrderRowHtml(o, i); }, XFER_TRACKER_COLS);
  }
  h += "</tbody></table></div>";
  h += '<button class="btn sm" id="xfer-add" style="margin-top:8px">+ Add one</button>';
  if (!depts.length)
    h += '<div class="note-bar" style="margin-top:8px">No departments yet — add one from Database → Departments.</div>';
  return h;
}
function vBilling() {
  var h = toolbarHtml("Billing", {
    secondary: '<button class="btn" id="bill-dl-sel">Download Selected (' + GROUP.length + ")</button>",
    primary: '<button class="btn pri" id="bill-done-sel">Mark Done</button>'
  });
  // Everything below the toolbar shares one outer .grid-wrap (D256) so it
  // fills the space below the now-real toolbar header and scrolls as one
  // region, same as every other section — the drop zones/unmatched table/
  // invoice pool/billing queue keep stacking and scrolling together exactly
  // as they did inside the old .pad, just not inset. The two inner
  // `.grid-wrap`s below (unmatched table, billing queue table) aren't flex
  // items of anything here — this outer one isn't display:flex — so they
  // keep behaving exactly as before (horizontal scroll only).
  h += '<div class="grid-wrap">';
  h += '<div class="drop" id="batch-drop" style="margin-bottom:10px"><b>Drop a Rexius invoice batch here</b></div>';
  h += '<div class="drop" id="loose-drop" style="margin-bottom:10px"><b>Drop a POD or loose document here</b></div>';

  /* Unmatched documents queue (Phase 4) — anything the D7 matcher couldn't
     place. Attach each to an order by hand. */
  var unmatched = DB.documents.filter(function (d) {
    return d.matched_by === "unmatched" && !d.order_id && !d.load_id && !d.load_stop_id;
  });
  if (unmatched.length) {
    var exts = orders().filter(function (o) { return isExt(o) && !o.is_transfer && !isHistorical(o); });
    h += '<div class="sec-h">Unmatched documents — ' + unmatched.length + "</div>" +
      '<div class="grid-wrap billing-unmatched-scroll"><table class="data" style="width:100%;min-width:780px;margin-bottom:12px"><thead><tr>' +
      '<th style="width:90px">Type</th><th style="width:280px">File</th><th>Attach to order</th>' +
      '<th style="width:132px"></th></tr></thead><tbody>';
    unmatched.forEach(function (d) {
      h += "<tr><td><div class=\"cell\"><span class=\"pill\">" + esc((d.doc_type || "other").replace("_", " ")) +
        '</span></div></td>' +
        '<td><div class="cell"><a href="#" data-filepath="' + esc(d.storage_path) + '" data-filemode="open">' +
        esc(d.original_filename || "(file)") + "</a></div></td>" +
        '<td><div class="cell"><select class="cell-i" data-attach-doc="' + d.id + '">' +
        '<option value="">— pick an order —</option>' +
        exts.map(function (o) {
          return '<option value="' + o.id + '">' +
            esc((o.solomon_order_no || o.broker_load_no || "no #") + " · " + buildChip(o).title) + "</option>";
        }).join("") + "</select></div></td>" +
        '<td><div class="cell" style="display:flex;gap:4px"><a class="btn sm" href="#" data-filepath="' + esc(d.storage_path) +
        '" data-filemode="open">Open</a>' +
        '<button class="btn sm bad" data-delete-doc="' + d.id + '">Delete</button></div></td></tr>';
    });
    h += "</tbody></table></div>";
  } else {
    h += '<div class="sec-h">Unmatched documents — 0</div>' +
      emptyStateHtml("Nothing unmatched right now");
  }
  if (POOL.length) {
    h += '<div class="sec-h">Unassigned invoices — ' + POOL.filter(function (p) { return !p.used; }).length +
      " of " + POOL.length + '</div><div class="pool" style="margin-bottom:12px">';
    POOL.forEach(function (p, i) {
      h += '<div class="pill-inv' + (p.used ? " used" : "") + '" draggable="' + (!p.used) +
        '" data-pool="' + i + '">' + (p.scanning ? '<span class="spin"></span>' : "") +
        "<span>" + esc(p.label) + "</span>" +
        (p.invoiceNum ? '<span class="num">#' + esc(p.invoiceNum) + "</span>" : "") + "</div>";
    });
    h += "</div>";
  }
  var queue = orders().filter(function (o) { return isExt(o) && !o.is_transfer && !o.billed_at && !isHistorical(o); });
  h += '<div class="sec-h">Billing queue — ' + queue.length + "</div>";
  h += '<div class="grid-wrap"><table class="data" style="min-width:1040px"><thead><tr>' +
    '<th style="width:44px"></th><th style="width:140px">Order #</th><th style="width:220px">Customer / Broker</th>' +
    '<th style="width:80px">POD</th><th style="width:80px">Invoice</th><th style="width:110px">Status</th>' +
    '<th style="width:270px"></th></tr></thead><tbody>';
  queue.forEach(function (o) {
    var have = {}; docsFor(o.id).forEach(function (d) { have[d.doc_type] = 1; });
    function tick(t) { return have[t] ? '<span class="pill on">Yes</span>' : '<span class="pill bad">No</span>'; }
    var ready = have.pod && have.invoice;
    h += '<tr class="bill-row" data-bill="' + o.id + '" data-roworder="' + o.id + '">' +
      '<td><div class="cell"><input type="checkbox" data-group="' + o.id + '"' +
        (GROUP.indexOf(o.id) >= 0 ? " checked" : "") + "></div></td>" +
      '<td><div class="cell n">' + esc(o.solomon_order_no || "—") + "</div></td>" +
      '<td><div class="cell" style="font-weight:600">' + esc(buildChip(o).title) + "</div></td>" +
      '<td><div class="cell">' + tick("pod") + "</div></td>" +
      '<td><div class="cell">' + tick("invoice") + "</div></td>" +
      '<td><div class="cell">' + (ready ? '<span class="pill on">Ready</span>' : '<span class="pill mid">Waiting</span>') + "</div></td>" +
      '<td><div class="cell" style="display:flex;gap:4px">' +
        '<button class="btn sm" data-bill-dl="' + o.id + '"' + (ready ? "" : " disabled") + ">Download</button>" +
        '<button class="btn sm" data-bill-done="' + o.id + '">Mark Complete</button>' +
      "</div></td></tr>";
  });
  h += "</tbody></table></div>";
  h += "</div>";
  return h;
}
/* ── Metadata-driven Database grids (D85) ─────────────────────────────────────
   The four built-in databases are now described by `entities`/`fields` metadata
   and rendered by ONE generic renderer, so columns can be renamed/reordered/
   resized/retyped and conditional-formatted like a spreadsheet — while keeping
   their real backing tables and special cells (designation, equipment, driver,
   color). Custom columns still ride the grid_columns machinery (customTh/Td). */
function entityBySlug(slug) { return (DB.entities || []).filter(function (e) { return e.slug === slug; })[0]; }
function entityById(id) { return (DB.entities || []).filter(function (e) { return e.id === id; })[0]; }
/* Custom entities (D85 Phase 2) have no slug — addressed as "custom:<id>" in
   SUB/data-sub, same convention as sheets' "sheet:<id>". */
function entityByKey(key) {
  if (!key) return null;
  return key.indexOf("custom:") === 0 ? entityById(key.slice(7)) : entityBySlug(key);
}
function entityKey(ent) { return ent.slug || ("custom:" + ent.id); }
/* External Customers keeps the legacy grid key "external" for custom-column
   and row-selection APIs, but its stable metadata slug is "brokers". */
function entityForGrid(key) { return entityByKey(key === "external" ? "brokers" : key); }
function fieldBySlugKey(slug, key) {
  var ent = entityBySlug(slug);
  if (!ent) return null;
  return (DB.fields || []).filter(function (x) { return x.entity_id === ent.id && x.key === key; })[0] || null;
}
/* D85 Phase 3: lets UI outside the Database grid (drawer, etc.) show a field's
   current admin-set label instead of a hardcoded string, so a rename in
   Database → <entity> propagates everywhere that field is shown. Falls back
   to the literal if the entity/field isn't in metadata (defensive — can't
   blank a label). */
function fieldLabel(slug, key, fallback) {
  var f = fieldBySlugKey(slug, key);
  return f ? f.label : fallback;
}
function fieldsVisible(ent) {
  return (DB.fields || []).filter(function (f) { return f.entity_id === ent.id && !f.hidden; })
    .sort(function (a, b) { return a.sort_order - b.sort_order; });
}
/* The custom-column / selection "grid" key (external ≠ its slug 'brokers'). */
function gridKey(slug) { return slug === "brokers" ? "external" : slug; }
/* The three reusable directories archive rather than delete (D191/D192).
   Which half is visible is browser/session-local; the timestamps themselves
   are shared database state returned by bootstrap. */
var ARCHIVE_DATABASE_VIEW = { bagger: false, external: false, departments: false };
var ARCHIVE_DATABASE_CONFIG = {
  bagger: { singular: "Bagger Customer", plural: "customers", field: "customer_archived_at" },
  external: { singular: "External Customer", plural: "customers", field: "broker_archived_at" },
  departments: { singular: "Internal Freight department", plural: "departments", field: "archived_at" }
};
function archiveConfigForGrid(grid) { return ARCHIVE_DATABASE_CONFIG[grid] || null; }
function archiveViewForGrid(grid) { return !!ARCHIVE_DATABASE_VIEW[grid]; }
function databaseRowIsArchived(grid, id) {
  if (grid === "bagger" || grid === "external") {
    var p = party(id), cfg = archiveConfigForGrid(grid);
    return !!(p && p[cfg.field]);
  }
  if (grid === "departments") {
    var dpt = departmentById(id);
    return !!(dpt && dpt.archived_at);
  }
  return false;
}
/* Per-record context: for each backing table, the {id,obj} of this row. Bagger
   joins a party to its location; fleet's color/driver live on the truck row. */
function builtinRows(slug) {
  if (slug === "bagger") return DB.parties.filter(function (p) {
    return p.is_customer && (!!p.customer_archived_at === archiveViewForGrid("bagger"));
  })
    .map(function (p) { var l = locFor(p.id) || {}; return { parties: { id: p.id, obj: p }, locations: { id: l.id, obj: l } }; });
  if (slug === "brokers") return DB.parties.filter(function (p) {
    return p.is_broker && (!!p.broker_archived_at === archiveViewForGrid("external"));
  })
    .map(function (p) { return { parties: { id: p.id, obj: p } }; });
  if (slug === "pickdrop") return DB.locations.map(function (l) { return { locations: { id: l.id, obj: l } }; });
  if (slug === "fleet") return DB.trucks.map(function (t) { return { trucks: { id: t.id, obj: t } }; });
  if (slug === "departments") return DB.departments.filter(function (dpt) {
    return !!dpt.archived_at === archiveViewForGrid("departments");
  }).map(function (dpt) { return { departments: { id: dpt.id, obj: dpt } }; });
  return [];
}
/* Rows for a custom entity (D85 Phase 2) — generic `records`, sorted by
   sort_order, one per row context (no real backing table). */
function recordRows(entId) {
  return (DB.records || []).filter(function (r) { return r.entity_id === entId; })
    .sort(function (a, b) { return a.sort_order - b.sort_order; })
    .map(function (r) { return { records: { id: r.id, obj: r } }; });
}
/* A field cell backed by a custom entity's record jsonb (storage='json'),
   keyed by the field's stable id so a rename never orphans data. Mirrors
   customTd's type dispatch (text/number/date/select/checkbox). */
function jsonCell(f, ctx) {
  var rec = ctx.records;
  if (!rec) return '<td><div class="cell" style="color:var(--ink-3)">—</div></td>';
  var val = (rec.obj.data || {})[f.id], a = 'data-recfield="' + rec.id + "|" + f.id + '"';
  if (f.type === "select") {
    return '<td><div class="cell"><select class="cell-i" ' + a + '><option value=""></option>' +
      (f.options || []).map(function (o) {
        return "<option" + (String(val) === String(o) ? " selected" : "") + ">" + esc(o) + "</option>";
      }).join("") + "</select></div></td>";
  }
  if (f.type === "checkbox")
    return '<td><div class="cell"><input type="checkbox" ' + a + (val === "true" ? " checked" : "") + "></div></td>";
  var ty = f.type === "number" ? "number" : f.type === "date" ? "date" : "text";
  return '<td><div class="cell"><input class="cell-i" type="' + ty + '" ' + a +
    ' value="' + esc(val == null ? "" : val) + '"></div></td>';
}
function fieldTh(f, grid) {
  // Right-click for conditional formatting / hide / delete (D85 Phase 2) —
  // no inline menu button, keeps headers clean.
  return '<th draggable="true" data-colgrid="' + grid + '" data-colref="field:' + f.id + '" data-fieldid="' + f.id + '"' +
    (f.width ? ' style="width:' + f.width + 'px;white-space:nowrap"' : ' style="white-space:nowrap"') +
    ' title="Drag to reorder · Right-click for options">' + esc(f.label) + '<span class="col-resize"></span></th>';
}
/* Per-column conditional formatting (D85 Phase 1 remaining item #2). `fields.
   conditional_format` is [{op,value,color}]; the first matching rule wins, top
   to bottom. A manual cell fmt.fill (gridFmtOf) always wins over this — same
   precedence as fmt.fill > category color elsewhere (CLAUDE.md). */
function matchCondRule(r, val) {
  var v = val == null ? "" : String(val), rv = r.value == null ? "" : String(r.value);
  switch (r.op) {
    case "eq": return v.toLowerCase() === rv.toLowerCase();
    case "neq": return v.toLowerCase() !== rv.toLowerCase();
    case "contains": return rv !== "" && v.toLowerCase().indexOf(rv.toLowerCase()) >= 0;
    case "empty": return v === "";
    case "not_empty": return v !== "";
    case "gt": return v !== "" && rv !== "" && parseFloat(v) > parseFloat(rv);
    case "lt": return v !== "" && rv !== "" && parseFloat(v) < parseFloat(rv);
    default: return false;
  }
}
function condFmtColor(f, val) {
  var rules = f.conditional_format || [];
  for (var i = 0; i < rules.length; i++) if (matchCondRule(rules[i], val)) return rules[i].color;
  return null;
}
/* Designation color is now the Bagger Designation column's conditional-format
   rule. This one source drives both the Database cell and Dispatch chip. */
function designationRuleColor(categoryId) {
  var cat = categoryId ? catById(categoryId) : null;
  if (!cat) return "";
  var field = fieldBySlugKey("bagger", "category_id");
  var color = field ? condFmtColor(field, cat.name) : null;
  if (!color) color = CATCOLOR[categoryId]; // defensive during an unmigrated bootstrap
  return color && String(color).charAt(0) === "#" ? color : "";
}
/* One cell for a field in a record context — dispatches on the field's `ui`
   special-renderer, else a generic editable cell writing to its real column. */
function fieldCell(f, ctx) {
  if (f.ui === "designation") return designationSelect(ctx.locations ? ctx.locations.obj : null, true);
  if (f.ui === "equipment") { var t = ctx.trucks.obj; return '<td><div class="cell"><input class="cell-i" list="eqtypes" data-rowtable="trucks" data-rowid="' + ctx.trucks.id + '" data-rowfield="equipment_type" value="' + esc(t.eq || "") + '"></div></td>'; }
  if (f.ui === "truckdriver") { var t2 = ctx.trucks.obj; return '<td><div class="cell"><input class="cell-i" data-truckdriver="' + ctx.trucks.id + '" value="' + esc(t2.driver_name || "") + '"></div></td>'; }
  if (f.ui === "color") {
    // Fleet's driver color lives on `drivers`, reached through the truck's
    // CURRENT driver_id — the row context has no `ctx.drivers` slot, so this
    // one stays a special case instead of resolving through plain storage.
    if (f.storage === "column:drivers.color") {
      var t3 = ctx.trucks.obj;
      if (!t3.driver_id) return '<td><div class="cell" style="color:var(--ink-3)">—</div></td>';
      var col = (t3.driver_color && String(t3.driver_color).charAt(0) === "#") ? t3.driver_color : "#888888";
      // A color chip that opens the toolbar's Sheets-style picker (D85), like the
      // internal designation cells — not a raw <input type=color>.
      return '<td><div class="cell" style="padding:0"><button class="colorchip" data-colorchip="' + t3.driver_id +
        '" style="background:' + col + ';color:' + textOn(col) + '">' + esc(col) + "</button></div></td>";
    }
    // Generic column-backed color field (D127 follow-up #2: per-department
    // Internal Freight chip color) — same Sheets-style picker, keyed by
    // table|id|field instead of Fleet's driver-id indirection, since the
    // color lives directly on the row here.
    var gparts = f.storage.indexOf("column:") === 0 ? f.storage.slice(7).split(".") : null;
    var gslot = gparts ? ctx[gparts[0]] : null;
    if (!gslot) return '<td><div class="cell" style="color:var(--ink-3)">—</div></td>';
    var gval = gslot.obj[gparts[1]];
    var gcol = (gval && String(gval).charAt(0) === "#") ? gval : "#888888";
    return '<td><div class="cell" style="padding:0"><button class="colorchip" data-colorchip-generic="' +
      gparts[0] + "|" + gslot.id + "|" + gparts[1] + '" style="background:' + gcol + ';color:' + textOn(gcol) +
      '">' + esc(gcol) + "</button></div></td>";
  }
  if (f.storage === "json") return jsonCell(f, ctx);
  var parts = f.storage.indexOf("column:") === 0 ? f.storage.slice(7).split(".") : null;
  if (!parts) return '<td><div class="cell" style="color:var(--ink-3)">—</div></td>';
  var slot = ctx[parts[0]], id = slot ? slot.id : null, val = (slot && slot.obj) ? slot.obj[parts[1]] : null;
  // A generic built-in field turned into a managed dropdown (D144) — options
  // Nate defines himself via the field's right-click menu, not a hardcoded
  // enum. Distinct from the `ui:'designation'` select above, which is its
  // own always-a-dropdown system tied to `categories`.
  if (f.type === "select") return selectFieldCell(parts[0], id, parts[1], val, f.options || []);
  return dcell(parts[0], id, parts[1], val, f.bold, condFmtColor(f, val));
}
/* A generic column-backed cell as a <select> instead of free-typed text —
   same td/data-table/data-id/data-field shape dcell() uses (so marquee
   select, copy/paste, and column sort all keep working on it unmodified).
   The <select> itself rides data-rowtable/data-rowid/data-rowfield — the
   existing generic "save one row field to /api/row" change handler
   (07-events.js, already used by Fleet's equipment picker and the
   designation select) — not a new save path. The row's current value is
   always offered even if it's since fallen off the configured option list
   (an old free-typed value, or an option since renamed/removed) —
   converting a field to a dropdown must never silently hide what's
   already there. */
function selectFieldCell(table, id, field, val, options) {
  if (!id) return '<td><div class="cell" style="color:var(--ink-3)">—</div></td>';
  var opts = options.slice();
  if (val && opts.indexOf(val) < 0) opts.push(val);
  return '<td data-key="' + table + "-" + id + "-" + field + '" data-table="' + table +
    '" data-id="' + id + '" data-field="' + field + '"><div class="cell" style="padding:0">' +
    '<select class="cell-i" data-rowtable="' + table + '" data-rowid="' + id + '" data-rowfield="' + field +
    '"><option value=""' + (!val ? " selected" : "") + ">—</option>" +
    opts.map(function (o) {
      return '<option value="' + esc(o) + '"' + (o === val ? " selected" : "") + ">" + esc(o) + "</option>";
    }).join("") + "</select></div></td>";
}
/* The same raw value fieldCell() would render, but as a comparable primitive
   instead of HTML — used to sort a grid by any visible field (Nate's ask),
   including the special `ui` renderers that don't ride plain column storage. */
function fieldRawValue(f, ctx) {
  if (f.customColumn) {
    var customSlot = ctx[f.backingTable];
    return customSlot && customSlot.obj ? (customSlot.obj.custom || {})[f.customKey] : "";
  }
  if (f.ui === "designation") {
    var loc = ctx.locations ? ctx.locations.obj : null;
    var cat = loc && loc.category_id ? catById(loc.category_id) : null;
    return cat ? cat.name : "";
  }
  if (f.ui === "truckdriver") return (ctx.trucks && ctx.trucks.obj.driver_name) || "";
  if (f.ui === "color") {
    if (f.storage === "column:drivers.color") return (ctx.trucks && ctx.trucks.obj.driver_color) || "";
    var rparts = f.storage.indexOf("column:") === 0 ? f.storage.slice(7).split(".") : null;
    var rslot = rparts ? ctx[rparts[0]] : null;
    return (rslot && rslot.obj[rparts[1]]) || "";
  }
  if (f.ui === "equipment") return (ctx.trucks && ctx.trucks.obj.eq) || "";
  if (f.storage === "json") { var rec = ctx.records; return rec ? (rec.obj.data || {})[f.id] : ""; }
  var parts = f.storage.indexOf("column:") === 0 ? f.storage.slice(7).split(".") : null;
  if (!parts) return "";
  var slot = ctx[parts[0]];
  return (slot && slot.obj) ? slot.obj[parts[1]] : "";
}
function sortableFields(ent, gk) {
  var out = fieldsVisible(ent).slice();
  if (ent.kind !== "custom") gridCols(gk).forEach(function (c) {
    out.push({ id: "gridcol:" + c.id, label: c.label, type: c.type,
      customColumn: true, customKey: c.key, backingTable: ent.backing_table });
  });
  return out;
}
function compareGridValues(va, vb) {
  if (typeof va === "number" && typeof vb === "number") return va - vb;
  return String(va == null ? "" : va).localeCompare(String(vb == null ? "" : vb), undefined,
    { numeric: true, sensitivity: "base" });
}
function sortRowsBy(rows, field, dir) {
  return rows.map(function (row, index) { return { row: row, index: index }; })
    .sort(function (a, b) {
      var cmp = compareGridValues(fieldRawValue(field, a.row), fieldRawValue(field, b.row));
      return (dir === "desc" ? -cmp : cmp) || a.index - b.index;
    }).map(function (item) { return item.row; });
}
function rowIdForEntity(ctx, ent) {
  var slot = ctx[ent.kind === "custom" ? "records" : ent.backing_table];
  return slot && slot.id;
}
function storedOrderRows(rows, gk, ent) {
  var order = {}, found = false;
  (DB.grid_row_orders || []).forEach(function (r) {
    if (r.grid === gk) { order[r.row_id] = r.sort_order; found = true; }
  });
  if (!found) return rows;
  return rows.map(function (row, index) { return { row: row, index: index }; })
    .sort(function (a, b) {
      var ai = order[rowIdForEntity(a.row, ent)], bi = order[rowIdForEntity(b.row, ent)];
      if (ai == null && bi == null) return a.index - b.index;
      if (ai == null) return 1;
      if (bi == null) return -1;
      return ai - bi || a.index - b.index;
    }).map(function (item) { return item.row; });
}
function sortRows(rows, flds, gk) {
  var s = GRIDSORT[gk], f = s && flds.filter(function (x) { return x.id === s.fieldId; })[0];
  if (!f) return rows;
  return sortRowsBy(rows, f, s.dir);
}
function databaseColumns(ent, gk) {
  var cols = fieldsVisible(ent).map(function (f) {
    return { kind: "field", id: f.id, sort_order: f.sort_order, width: f.width || 120, obj: f };
  });
  if (ent.kind !== "custom") gridCols(gk).forEach(function (c) {
    cols.push({ kind: "custom", id: c.id, sort_order: c.sort_order, width: c.width || 140, obj: c });
  });
  return cols.sort(function (a, b) {
    return a.sort_order - b.sort_order || (a.kind === "field" ? -1 : 1);
  });
}
function vBuiltin(ent) {
  var custom = ent.kind === "custom", slug = ent.slug;
  var gk = custom ? entityKey(ent) : gridKey(slug), flds = fieldsVisible(ent);
  var sortFlds = sortableFields(ent, gk);
  var cols = databaseColumns(ent, gk);
  var baseRows = custom ? recordRows(ent.id) : builtinRows(slug);
  var rows = sortRows(storedOrderRows(baseRows, gk, ent), sortFlds, gk);
  var addBtn = custom ? '<button class="btn pri" data-addrow="' + gk + '">+ Row</button>' :
    { bagger: '<button class="btn pri" data-addcust="bagger">+ Add Customer</button>',
      brokers: '<button class="btn pri" data-addcust="external">+ Add Customer</button>',
      pickdrop: '<button class="btn pri" id="add-pickdrop">+ Add Location</button>',
      fleet: '<button class="btn pri" id="add-truck">+ Add Truck</button>',
      departments: '<button class="btn pri" id="add-department">+ Add Department</button>' }[slug];
  // Fixed layout (via .gridfixed) so column drag-resize is pixel-precise; table
  // width is the exact sum of column widths so a column grows the table, not its
  // neighbours (D85). Custom-column widths default to 140. Custom entities
  // don't ride the legacy grid_columns system — their fields ARE `fields`.
  var tblW = 44 + cols.reduce(function (s, c) { return s + c.width; }, 0) + 38;
  var srt = GRIDSORT[gk], srtFld = srt && sortFlds.filter(function (f) { return f.id === srt.fieldId; })[0];
  var sortLabel = srtFld ? "View: " + srtFld.label + (srt.dir === "desc" ? " ↓" : " ↑") : "Sort & Order";
  var selectedRows = (ROWSEL[gk] || []).length;
  var rowAction;
  var archiveViewButton = "";
  var archiveCfg = archiveConfigForGrid(gk), archivedView = archiveViewForGrid(gk);
  if (archiveCfg) {
    var backing = gk === "departments" ? DB.departments : DB.parties.filter(function (p) {
      return gk === "bagger" ? p.is_customer : p.is_broker;
    });
    var archiveCount = backing.filter(function (row) { return !!row[archiveCfg.field]; }).length;
    var activeCount = backing.length - archiveCount;
    archiveViewButton = '<button class="btn" data-archiveview="' + gk + '|' +
      (archivedView ? "active" : "archived") + '">' +
      (archivedView ? "Show Active (" + activeCount + ")" : "Show Archived (" + archiveCount + ")") +
      "</button>";
    rowAction = '<button class="btn" data-archiverows="' + gk + '" data-archive-mode="' +
      (archivedView ? "restore" : "archive") + '"' + (selectedRows ? "" : " disabled") + ">" +
      (archivedView ? "Restore Selected" : "Archive Selected") +
      (selectedRows ? " (" + selectedRows + ")" : "") + "</button>";
  } else {
    rowAction = '<button class="btn bad" data-delrows="' + gk + '"' + (selectedRows ? "" : " disabled") + ">" +
      (selectedRows ? "Delete Selected (" + selectedRows + ")" : "Delete Selected") + "</button>";
  }
  // Sort's highlight when a custom sort is active is a status indicator, not
  // a call to action — .active (outline, not fill) so it never competes with
  // the one real primary button (D172's "exactly one .btn.pri" contract).
  var h = toolbarHtml(ent.name, {
    secondary: '<button class="btn' + (srtFld ? " active" : "") + '" data-sortbtn="' + gk + '">' + esc(sortLabel) + "</button>" +
      archiveViewButton + rowAction,
    primary: addBtn
  });
  if (slug === "fleet") {
    var eqTypes = [];
    DB.trucks.forEach(function (t) { if (t.eq && eqTypes.indexOf(t.eq) < 0) eqTypes.push(t.eq); });
    ["F", "BT", "CV"].forEach(function (x) { if (eqTypes.indexOf(x) < 0) eqTypes.push(x); });
    h += '<datalist id="eqtypes">' + eqTypes.map(function (x) { return '<option value="' + esc(x) + '">'; }).join("") + "</datalist>";
  }
  h += '<div class="grid-wrap"><table class="data gridfixed" style="width:' + tblW + 'px"><thead><tr>' + selTh(gk) +
    cols.map(function (c) { return c.kind === "field" ? fieldTh(c.obj, gk) : customThCol(c.obj, gk); }).join("") +
    '<th class="col-plus-h" data-addcol="' + gk + '" title="Add ' + (custom ? "field" : "column") + '">+</th></tr></thead><tbody>';
  rows.forEach(function (ctx, i) {
    var base = custom ? ctx.records : (ctx[ent.backing_table] || {});
    h += '<tr' + (ent.backing_table ? ' data-histrow="' + ent.backing_table + "|" + base.id + '"' : "") + ">" +
      selTd(gk, base.id, i + 1) +
      cols.map(function (c) {
        return c.kind === "field" ? fieldCell(c.obj, ctx) :
          customTdCol(c.obj, ent.backing_table, base.id, base.obj && base.obj.custom);
      }).join("") + '<td class="col-plus-cell"></td></tr>';
  });
  h += "</tbody></table>";
  if (!rows.length) h += emptyStateHtml(
    archiveCfg && archivedView ? "No archived " + archiveCfg.plural : "No rows yet");
  return h + "</div>";
}
function vDatabase(which) {
  if (which && which.indexOf("sheet:") === 0) return vSheet(which.slice(6));
  var ent = entityByKey(which);
  return ent ? vBuiltin(ent) : "";
}
/* Shared fmt → inline styles for a formatted cell (scheduler/sheet/grid). `bold`
   is the structural bold (e.g. name columns), kept unless fmt overrides it. */
function fmtStyles(fmt, bold) {
  fmt = fmt || {};
  var td = "", cell = "";
  if (fmt.fill && fmt.fill.charAt(0) === "#") td += "background-color:" + fmt.fill + ";";
  cell += cellBorderCss({ fmt: fmt });
  if (fmt.text && fmt.text.charAt(0) === "#") cell += "color:" + fmt.text + ";";
  else if (fmt.fill && fmt.fill.charAt(0) === "#") cell += "color:" + textOn(fmt.fill) + ";";
  if (fmt.bold || bold) cell += "font-weight:" + (fmt.bold ? "700" : "600") + ";";
  if (fmt.italic) cell += "font-style:italic;";
  if (fmt.size) { var _fs = parseInt(fmt.size, 10); if (_fs > 0) cell += "font-size:" + _fs + "px;"; }
  if (fmt.font) cell += "font-family:" + fmt.font + ";";
  return { td: td, cell: cell };
}
function dcell(table, id, field, val, bold, condColor) {
  if (!id) return '<td><div class="cell" style="color:var(--ink-3)">—</div></td>';
  var fmt = gridFmtOf(table, id, field);
  if (condColor && !(fmt && fmt.fill)) { fmt = Object.assign({}, fmt, { fill: condColor }); }
  var st = fmtStyles(fmt, bold);
  return '<td data-key="' + table + "-" + id + "-" + field + '" data-table="' + table +
    '" data-id="' + id + '" data-field="' + field + '"' + (bold ? ' data-bold="1"' : "") +
    (st.td ? ' style="' + st.td + '"' : "") + '><div class="cell"' +
    (st.cell ? ' style="' + st.cell + '"' : "") + ">" + cellDisplayHtml(val) + "</div></td>";
}
/* In-place repaint of one built-in grid cell after a format change (D76). */
function repaintGridCell(table, id, field) {
  var td = document.querySelector('td[data-table="' + table + '"][data-id="' + id + '"][data-field="' + field + '"]');
  if (!td) return;
  var st = fmtStyles(gridFmtOf(table, id, field), td.dataset.bold === "1");
  td.style.cssText = st.td;
  var cell = td.querySelector(".cell");
  if (cell) { var txt = cell.textContent; cell.style.cssText = st.cell; cell.innerHTML = cellDisplayHtml(txt); }
}
/* A Bagger Customer's designation cell (D72) — a dropdown of the legend
   categories, tinted with the chosen color so the row shows the chip color it
   drives. Persists via the generic /api/row change handler (data-row*). */
function designationSelect(l, gridMode) {
  if (!l || !l.id) return '<td><div class="cell" style="color:var(--ink-3)">—</div></td>';
  var cur = l.category_id || "";
  var col = designationRuleColor(cur);
  var opts = '<option value="">—</option>' + (DB.categories || []).map(function (c) {
    return '<option value="' + c.id + '"' + (c.id === cur ? " selected" : "") + ">" + esc(c.name) + "</option>";
  }).join("");
  var st = "width:100%;border:0;" + (col ? "background:" + col + ";color:" + textOn(col) + ";" : "");
  // Same td/data-table/data-id/data-field shape selectFieldCell() uses
  // (D144/D145) — this predates that convention (D72) and was never
  // retrofitted, which meant it sat outside the generic marquee/select
  // system entirely: Tab from this select fell through to the browser's
  // native tab order instead of the app's own cell-to-cell navigation
  // (Nate, live — "two selected cells," Tab only ever cycling through
  // dropdowns). Adding the attributes joins it to the same system Fork/
  // equipment already use successfully. Gated by `gridMode` — the drawer's
  // customer-info table (03-drawer-billing.js) reuses this same renderer
  // outside any real grid, and mousedown's generic td[data-key] handler
  // isn't scoped to an actual grid ancestor, so an ungated data-key there
  // would let a drawer click paint a stray .sel ring with nothing to
  // navigate to (keyboard shortcuts are separately blocked by DRAWER_OID,
  // but the visual ring isn't).
  var gridAttrs = gridMode ? ' data-key="locations-' + l.id + '-category_id" data-table="locations" data-id="' +
    l.id + '" data-field="category_id"' : "";
  return '<td' + gridAttrs + '><div class="cell" style="padding:0">' +
    '<select class="cell-i" data-rowtable="locations" data-rowid="' + l.id +
    '" data-rowfield="category_id" style="' + st + '">' + opts + "</select></div></td>";
}
/* One sheet cell (D74/D75). Keeps the Database-grid attrs (data-table/id/field)
   so editing/selection work unchanged, PLUS data-sheet/r/c so the toolbar can
   target it for per-cell formatting, and renders its fmt (fill/text/bold/italic/
   size/border) like the scheduler. */
function sheetCellStyles(fmt) {
  fmt = fmt || {};
  var td = "", cell = "";
  if (fmt.fill && fmt.fill.charAt(0) === "#") td += "background-color:" + fmt.fill + ";";
  cell += cellBorderCss({ fmt: fmt });
  if (fmt.text && fmt.text.charAt(0) === "#") cell += "color:" + fmt.text + ";";
  else if (fmt.fill && fmt.fill.charAt(0) === "#") cell += "color:" + textOn(fmt.fill) + ";";
  if (fmt.bold) cell += "font-weight:700;";
  if (fmt.italic) cell += "font-style:italic;";
  if (fmt.size) { var _fs = parseInt(fmt.size, 10); if (_fs > 0) cell += "font-size:" + _fs + "px;"; }
  if (fmt.font) cell += "font-family:" + fmt.font + ";";
  return { td: td, cell: cell };
}
function sheetCellHtml(sid, r, c, cell) {
  var val = cell ? cell.value : "", st = sheetCellStyles(cell && cell.fmt);
  return '<td data-key="sheet-' + sid + "-" + r + "|" + c + '" data-table="sheet" data-id="' + sid +
    '" data-field="' + r + "|" + c + '" data-sheet="' + sid + '" data-r="' + r + '" data-c="' + c + '"' +
    (st.td ? ' style="' + st.td + '"' : "") + '><div class="cell"' + (st.cell ? ' style="' + st.cell + '"' : "") +
    ">" + cellDisplayHtml(val) + "</div></td>";
}
/* In-place repaint of one sheet cell so multi-cell formatting keeps the
   selection (replacing the <td> would drop .sel/.selrange and stale SELSET). */
function repaintSheetCell(sid, r, c) {
  var td = document.querySelector('td[data-sheet="' + sid + '"][data-r="' + r + '"][data-c="' + c + '"]');
  if (!td) return;
  var sc = (SHEETCELLS[sid] || {})[r + "|" + c] || { value: null, fmt: {} };
  var st = sheetCellStyles(sc.fmt);
  td.style.background = ""; td.style.cssText = st.td;
  var cell = td.querySelector(".cell");
  if (cell) { cell.style.cssText = st.cell; cell.innerHTML = cellDisplayHtml(sc.value); }
}
/* A custom spreadsheet sheet (D74) — a blank grid the user grows at will. Cells
   reuse the Database grid machinery (data-key/table/id/field), so selection,
   arrow-key navigation, and type-to-edit all work for free; saves route through
   gridCellSet's `table==="sheet"` branch. */
function vSheet(id) {
  var sh = sheetById(id);
  if (!sh) return '<div class="card"><p>Sheet not found.</p></div>';
  var cells = SHEETCELLS[id] || {};
  var h = '<div class="toolbar" style="border:0;background:none;padding:0 0 8px;align-items:center">' +
    '<span class="lbl">Double-click the tab to rename, right-click for more</span></div>';
  h += '<div class="grid-wrap"><table class="data sheet" style="min-width:' + (44 + sh.n_cols * 96 + 32) +
    'px"><thead><tr><th class="sheet-corner"></th>';
  for (var c = 0; c < sh.n_cols; c++) h += '<th class="sheet-colh">' + colLetter(c) + "</th>";
  h += '<th class="sheet-plus" data-sheet-addcol="' + id + '" title="Add column">+</th>';
  h += "</tr></thead><tbody>";
  for (var r = 0; r < sh.n_rows; r++) {
    h += '<tr><td class="sheet-rowh">' + (r + 1) + "</td>";
    for (var cc = 0; cc < sh.n_cols; cc++) {
      var cell = cells[r + "|" + cc];
      h += sheetCellHtml(id, r, cc, cell);
    }
    h += '<td class="sheet-plusgap"></td></tr>';
  }
  h += '<tr><td class="sheet-plus" data-sheet-addrow="' + id + '" title="Add row">+</td>' +
    '<td colspan="' + (sh.n_cols + 1) + '"></td></tr>';
  return h + "</tbody></table></div>";
}
function dateRange() {
  return '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">' +
    '<label style="font-size:var(--fs-body-sm);color:var(--ink-2)">From</label>' +
    '<input type="text" inputmode="numeric" placeholder="MM/DD/YYYY" data-smartdate data-repfrom class="cell-i" style="width:150px;border:1px solid var(--rule);border-radius:6px">' +
    '<label style="font-size:var(--fs-body-sm);color:var(--ink-2)">To</label>' +
    '<input type="text" inputmode="numeric" placeholder="MM/DD/YYYY" data-smartdate data-repto class="cell-i" style="width:150px;border:1px solid var(--rule);border-radius:6px">' +
    "</div>";
}
function vReports() {
  /* Trimmed to the two Nate uses today (D40); the rest of the REPORTS dict
     stays server-side, ready to re-surface here as they come up. Any card
     with dates:true gets a From/To range read generically on export. */
  var reps = [
    { k: "freight", t: "Internal freight transfer", dates: true,
      d: "$ total per truck + department for the date range — Bag Orders (dept 07) and Internal Freight transfers together, delivered/closed loads only. Use the full data dump below for a weekly/per-order pivot." },
    { k: "mileage", t: "Mileage: internal vs external, by customer/department", dates: true,
      d: "Total miles for the period, split three ways: Bag Orders by customer, Internal Freight transfers by department, true external as one total. Flags orders with no mileage entered yet." },
    { k: "customers", t: "Export all Bagger Customers", dates: false,
      d: "Every bagger customer with address, timing window, designation, forklift, miles, and contact." },
    { k: "brokers", t: "Export all External / freight customers", dates: false,
      d: "Every external (broker) customer with Rexius #, AP billing email, phone, and notes." },
    { k: "fleet", t: "Export Fleet info", dates: false,
      d: "Every truck with its equipment type, active status, and current driver." }
  ];
  var h = '<div class="card" style="margin-bottom:14px"><h3>Export entire app</h3>' +
    '<p>Every order with its load, truck, driver, customer/broker contact info, full pickup/delivery addresses, dates, status, documents on file, both money paths (external revenue, internal freight), and any day note on its date — everything, for pivot tables.</p>' + dateRange() +
    '<button class="btn" data-report="dump">Export CSV</button></div>';
  h += '<div class="rep">' + reps.map(function (r) {
      return '<div class="card"><h3>' + esc(r.t) + "</h3><p>" + esc(r.d) + "</p>" +
        (r.dates ? dateRange() : "") +
        '<button class="btn" data-report="' + r.k + '">Export CSV</button></div>';
    }).join("") + "</div>";
  return h;
}
/* ═══ 05-settings-nav-search ═══ */
/* ── Settings (D54) ──────────────────────────────────────────────────────── */
var CUSTOM_ACCENT_OPEN = false;
function vSettings(sub) {
  var h = '<div class="settings-head"><div><h2>Settings</h2><p>Personalize this workspace and manage your account.</p></div></div>';
  if (sub === "shortcuts") return '<div class="settings-shell">' + h + settingsShortcuts() + "</div>";
  if (sub === "timecalc") return '<div class="settings-shell">' + h + settingsTimeCalc() + "</div>";
  if (sub === "admin") return '<div class="settings-shell">' + h + settingsAdmin() + "</div>";
  return '<div class="settings-shell">' + h + settingsAppearance() + "</div>";
}
function prefBtn(key, val, label) {
  return '<button class="setting-choice' + (PREFS[key] === val ? " on" : "") + '" data-setpref="' + key +
    '" data-val="' + esc(val) + '">' + esc(label) + "</button>";
}
/* Scheduler row height / truck-column width (D175) — Nate: "id like it to
   be customizable like cell height and width in the scheduler... i do need
   the default height slightly adjusted cause right now its cutting load
   chips off... inside the settings it pops up a window so you can see
   what ur editing as u click it." The +/- steppers reuse the exact
   .fb-fs/.fb-fs-b/.fb-fs-inp component from the font-size control (D174
   made these three finally look identical — Nate: "i like that ui the
   best"). The preview below isn't a mocked-up image — it's the real
   .grid/.slotrow/.chip markup and CSS, sized by the same --row-h/--col-w
   custom properties the actual Scheduler reads, so a click on +/- (which
   calls applyPrefs() through setPref()) resizes this preview live, for
   free, with no preview-specific logic. Two sample chips (one plain, one
   filled/colored, both with a full who/meta/flags/note stack) show
   exactly the content that was getting cut off at the old 72px default. */
function schedulerSizingHtml() {
  var chip1 =
    '<div class="chip" style="--edge:#2F5D8C" draggable="false">' +
      '<div class="who">SAMPLE CUSTOMER CO</div>' +
      '<div class="meta"><span>24 PAL · Sample Order</span></div>' +
      '<div class="flags"><span class="flag">EARLY</span><span class="flag">FORKLIFT</span></div>' +
      '<div class="note">&#9873; Call ahead before delivery</div>' +
    "</div>";
  var chip2 =
    '<div class="chip filled" style="--edge:#3F7D3A;background:#3F7D3A;color:#fff" draggable="false">' +
      '<div class="who">SAMPLE FLOWERS INC</div>' +
      '<div class="meta"><span>18 PAL · Sample Order</span></div>' +
      '<div class="flags"><span class="flag">ANYTIME</span></div>' +
      '<div class="dnote">&#9998; Dock 3, ask for Mike</div>' +
    "</div>";
  return '<section class="set-card set-wide"><div class="set-title"><div><div class="set-h">Scheduler sizing</div>' +
    '<p>Set the working size directly. Comfortable spacing is now the permanent baseline.</p></div>' +
    '<button class="btn sm" data-schedsize-reset="1">Reset size</button></div>' +
    '<div class="set-row">' +
    '<label class="setting-field"><span>Row height</span><span class="fb-fs" aria-label="Row height">' +
      '<button class="fb-fs-b" data-schedsize-step="rowHeight|-4" title="Shorter rows">&minus;</button>' +
      '<input class="fb-fs-inp" id="pref-rowh-inp" type="text" inputmode="numeric" value="' + PREFS.rowHeight + '" title="Row height, px (56–160)">' +
      '<button class="fb-fs-b" data-schedsize-step="rowHeight|4" title="Taller rows">+</button></span></label>' +
    '<label class="setting-field"><span>Column width</span><span class="fb-fs" aria-label="Column width">' +
      '<button class="fb-fs-b" data-schedsize-step="colWidth|-10" title="Narrower columns">&minus;</button>' +
      '<input class="fb-fs-inp" id="pref-colw-inp" type="text" inputmode="numeric" value="' + PREFS.colWidth + '" title="Truck column width, px (100–320)">' +
      '<button class="fb-fs-b" data-schedsize-step="colWidth|10" title="Wider columns">+</button></span></label>' +
    "</div>" +
    '<div class="sched-preview"><table class="grid"><tbody><tr class="slotrow">' +
    '<td style="width:var(--col-w,150px)"><div class="cell">' + chip1 + "</div></td>" +
    '<td style="width:var(--col-w,150px)"><div class="cell">' + chip2 + "</div></td>" +
    "</tr></tbody></table></div></section>";
}
function settingsAppearance() {
  var fontName = (FONTS.filter(function (f) { return f[0] === (PREFS.font || ""); })[0] || FONTS[0])[1];
  var h = settingsProfileHtml();
  h += '<div class="settings-grid">';
  h += '<section class="set-card set-theme"><div class="set-title"><div><div class="set-h">Theme</div>' +
    '<p>Light, dark, or match this device.</p></div></div>' +
    '<div class="setting-choices" role="group" aria-label="Theme">' + prefBtn("theme", "system", "System") +
    prefBtn("theme", "light", "Light") + prefBtn("theme", "dark", "Dark") + "</div>" +
    '<div class="theme-note">Additional themes can include their own texture and motion.</div></section>';
  h += '<section class="set-card accent-card set-accent"><div class="set-title"><div><div class="set-h">Accent</div>' +
    '<p>Choose a color.</p></div></div>' +
    '<div class="accent-palette" role="group" aria-label="Accent colors">' + accentPresetButtons(ACCENT_PRESETS) + '</div>' +
    savedAccentsHtml() +
    '<div class="accent-preview" id="accent-preview"><span class="accent-dot"></span><b>Selected accent</b>' +
      '<span id="accent-value">' + PREFS.accent + '</span></div>' +
    '<div class="custom-accent"><button class="custom-accent-toggle" data-custom-accent-toggle="1" aria-expanded="' + CUSTOM_ACCENT_OPEN +
      '"><span aria-hidden="true">' + (CUSTOM_ACCENT_OPEN ? '&#9662;' : '&#9656;') + '</span>Custom color</button>' +
      (CUSTOM_ACCENT_OPEN ? '<div class="custom-accent-body">' +
      '<div class="accent-editor"><input type="color" id="pref-accent-wheel" value="' + PREFS.accent +
        '" aria-label="Choose custom accent color"><div class="accent-values"><label for="pref-accent-hex">Hex color</label>' +
        '<input id="pref-accent-hex" class="accent-hex" value="' + PREFS.accent + '" maxlength="7" spellcheck="false"></div>' +
        '<button class="btn sm pri" data-accent-save="1">Save color</button></div>' +
      '<div class="setting-help" id="accent-status">Hard-to-read colors are blocked automatically.</div></div>' : '') + '</div></section>';
  h += '<section class="set-card set-type"><div class="set-title"><div><div class="set-h">Typography</div>' +
    '<p>Interface font.</p></div></div>' +
    '<label class="setting-field font-field"><span>Interface font</span><select id="pref-font-select">' +
      FONTS.map(function (f) { return '<option value="' + esc(f[0]) + '"' + ((PREFS.font || "") === f[0] ? " selected" : "") +
        ' style="font-family:' + (f[0] || "inherit") + '">' + esc(f[1]) + "</option>"; }).join("") +
    '</select></label><div class="font-sample" style="font-family:' + (PREFS.font || "inherit") + '">' +
      '<span>' + esc(fontName) + '</span><strong>SAMPLE CUSTOMER</strong>' +
      '<p>Sample Driver · Sample Truck · 24 PAL · Sample Order · EARLY</p></div></section>';
  h += settingsConnectionsHtml();
  h += "</div>";
  if (!LOCAL_AUTH.enabled || (DB && DB.me && DB.me.is_admin)) h += orderNumberingHtml();
  h += schedulerSizingHtml();
  h += '<div class="settings-save-note">Profile, appearance, and sizing are saved on this device. Workspace numbering applies to everyone.</div>';
  return h;
}

function orderNumberingHtml() {
  var cfg = orderNumberSettings();
  return '<section class="set-card set-wide numbering-card"><div class="set-title"><div><div class="set-h">Order numbering</div>' +
    '<p>Controls new numbers only. Existing orders are never renamed.</p></div>' +
    '<button class="btn pri" data-numbering-save="1">Save numbering</button></div>' +
    '<div class="numbering-grid">' +
      '<div class="numbering-group"><h3>Bag Orders</h3>' +
        '<label class="setting-field"><span>Format</span><input id="numbering-internal-pattern" value="' + esc(cfg.internal_pattern) + '"></label>' +
        '<label class="setting-field"><span>Department code</span><input id="numbering-internal-dept" value="' + esc(cfg.internal_department) + '" maxlength="20"></label>' +
        '<div class="number-example">Example <b id="numbering-internal-example">' + esc(orderPatternExample(cfg.internal_pattern)) + '</b></div>' +
        '<p>Used when you reserve one number or a whole block.</p></div>' +
      '<div class="numbering-group"><h3>External Orders</h3>' +
        '<label class="setting-field"><span>Format</span><input id="numbering-external-pattern" value="' + esc(cfg.external_pattern) + '"></label>' +
        '<label class="setting-field"><span>Department code</span><input id="numbering-external-dept" value="' + esc(cfg.external_department) + '" maxlength="20"></label>' +
        '<div class="number-example">Example <b id="numbering-external-example">' + esc(orderPatternExample(cfg.external_pattern)) + '</b></div>' +
        '<p>External numbers are still typed in; this sets the current example and reporting code.</p></div>' +
    '</div><div class="setting-help numbering-help">Use {MM}, {YY}, or {YYYY} for dates. Put {####} wherever the sequence belongs; Bag Orders need one sequence block for bulk reservations. Other characters stay as typed.</div></section>';
}
function accentPresetButtons(colors) {
  return colors.map(function (p) {
    var on = normalizeHex(p[0]) === normalizeHex(PREFS.accent);
    return '<button class="accent-swatch' + (on ? ' on' : '') + '" data-accent-pick="' + p[0] +
      '" title="' + p[0] + '" aria-label="Use accent ' + p[0] +
      '" aria-pressed="' + on + '" style="--swatch:' + p[0] + '"></button>';
  }).join("");
}
function savedAccentsHtml() {
  if (!SAVED_ACCENTS.length) return "";
  return '<div class="saved-accents"><div class="accent-section-label">Saved colors</div><div class="saved-accent-list">' +
    SAVED_ACCENTS.map(function (hex) {
      var on = normalizeHex(hex) === normalizeHex(PREFS.accent);
      return '<span class="saved-accent"><button class="accent-swatch mini' + (on ? ' on' : '') +
        '" data-accent-pick="' + hex + '" aria-label="Use saved color ' + hex + '" aria-pressed="' + on +
        '" style="--swatch:' + hex + '"></button><button class="saved-accent-remove" data-accent-forget="' + hex +
        '" aria-label="Remove saved color ' + hex + '" title="Remove saved color">&times;</button></span>';
    }).join("") + '</div></div>';
}
function settingsShortcuts() {
  var h = '<div class="settings-section-title"><div><div class="set-h">Keyboard shortcuts</div><p>Change the key for any action below.</p></div></div>' +
    '<div class="note-bar">Shortcuts never fire ' +
    'while you are typing in a field. Click <b>Record</b>, press the shortcut you want, or press Escape to cancel. ' +
    "If a combo is already assigned, it moves to the new action.</div>";
  h += '<div class="set-card" style="padding:6px 8px"><table class="sc-table"><tbody>';
  SHORTCUTS.forEach(function (s) {
    var rec = RECORDING === s.id;
    h += "<tr><td class=\"sc-lb\">" + esc(s.label) + "</td>" +
      '<td class="sc-key"><span class="kbd">' + (rec ? "press keys..." : esc(keyLabel(KEYMAP[s.id]))) + "</span></td>" +
      '<td class="sc-act"><button class="btn sm' + (rec ? " pri" : "") + '" data-screc="' + s.id + '">' +
      (rec ? "Cancel" : "Record") + "</button>" +
      '<button class="btn sm" data-screset="' + s.id + '">Reset</button></td></tr>';
  });
  h += "</tbody></table></div>";
  h += '<div class="set-row"><button class="btn" data-scresetall="1">Reset All To Defaults</button></div>';
  return h;
}
function settingsProfileHtml() {
  var h = '<section class="set-card profile-card set-wide"><div class="settings-avatar">' + esc(initials(profileName)) +
    '</div><div class="profile-copy"><div class="set-h">Your profile</div><h3>' + esc(profileName) +
    '</h3><p>Your display name sets the initials shown in the header.</p></div>' +
    '<div class="profile-edit"><label class="setting-field"><span>Display name</span>' +
    '<input id="profile-name-input" value="' + esc(profileName) + '" autocomplete="name"></label>' +
    '<button class="btn pri" data-profile="savename">Save profile</button></div></section>';
  return h;
}
function settingsConnectionsHtml() {
  // TODO(AUTH): everyone signs in with ONE shared Supabase account for now
  // (see supabase-api.js). Per-person accounts are a follow-up phase.
  var authUser = dashboardAuth.user();
  var h = '<section class="set-card set-account"><div class="set-title"><div><div class="set-h">Account</div>' +
    '<p>Sign-in and access for this workspace.</p></div></div>' +
    '<div class="connection-row"><div><span class="status-dot on"></span><b>' +
    esc((authUser && authUser.email) || "Shared login") + '</b><small>Shared team login · per-person accounts not set up yet</small></div>' +
    '<button class="btn sm" data-profile="signout">Sign out</button></div>';
  h += "</section>";
  return h;
}
/* ── Access (D125) — manage restricted users' per-section access + the
   Scheduler date-range hard boundary. Only reachable by an admin (gated by
   settingsSubsFor()/canView above); the roster/grants aren't part of the
   normal bootstrap payload, so this section lazy-fetches once and re-renders
   when it lands, same idea as any other async panel. */
var ADMIN_ROSTER = null;
/* Which restricted-user rows are expanded (D259) — every grant checkbox
   toggle clears ADMIN_ROSTER and calls render(), which rebuilds the
   <details class="admin-row"> markup from scratch; without tracking this
   separately every row snapped shut after a single click, found live
   granting Test3 two permissions in a row. Same in-memory-object pattern
   as HISTORY_OPEN_DAYS/TRACKER_COLLAPSED_OPEN — session-only, not
   persisted. Kept in sync by the native `toggle` event (07-events.js),
   not just this file's own open-attribute write, so manually collapsing a
   row also survives the next unrelated re-render. */
var ADMIN_OPEN = {};
function grantableSubs() {
  var list = [];
  NAV.forEach(function (s) {
    subsOf(s.k).forEach(function (sub) { list.push({ section: s.k, sub: sub.k, label: s.t + " — " + sub.t }); });
  });
  SETTINGS_SUBS.forEach(function (sub) { list.push({ section: "settings", sub: sub.k, label: "Settings — " + sub.t }); });
  return list;
}
function settingsAdmin() {
  if (!ADMIN_ROSTER) {
    api("admin/users").then(function (j) {
      ADMIN_ROSTER = j.users || [];
      if (SEC === "settings" && SUB === "admin") render();
    }).catch(function (e) { toast(e.message, true); });
    return '<div class="empty">Loading roster…</div>';
  }
  var subs = grantableSubs();
  var h = '<section class="set-card admin-intro"><div class="set-title"><div><div class="set-h">Dashboard access</div>' +
    '<h3>People and permissions</h3><p>This is where administrators let other accounts see and interact with the dashboard. New accounts begin with a read-only Scheduler; grant only the pages and edit rights they need.</p>' +
    '</div><span class="admin-count">' + ADMIN_ROSTER.filter(function (u) { return !u.is_admin; }).length +
    ' restricted</span></div><div class="setting-help">Scheduler access defaults to 3 weeks back and 1 week forward until you set a custom range.</div>' +
    // TODO(AUTH): the hosted app signs everyone in with one shared login, so
    // nothing below is enforced yet. Remove this notice when per-person
    // Supabase accounts are mapped to these rows.
    '<div class="setting-help"><b>Not enforced yet.</b> Everyone currently signs in with the shared team login and has full access. These settings take effect once individual accounts are set up.</div></section>';
  var restricted = ADMIN_ROSTER.filter(function (u) { return !u.is_admin; });
  restricted.forEach(function (u) {
    var byKey = {};
    u.grants.forEach(function (g) { byKey[g.section + "|" + g.sub] = g.can_edit; });
    var viewCt = 0, editCt = 0;
    subs.forEach(function (s) {
      var k = s.section + "|" + s.sub;
      if (k in byKey) { viewCt++; if (byKey[k]) editCt++; }
    });
    var hasCustomWindow = !!(u.view_start || u.view_end);
    h += '<details class="admin-row" data-admin-row="' + u.id + '"' + (ADMIN_OPEN[u.id] ? " open" : "") +
      '><summary><span class="admin-avatar">' + esc(initials(u.username)) + '</span>' +
      '<span class="admin-row-name">' + esc(u.username) + "</span>" +
      '<span class="admin-row-sum">' + viewCt + " view · " + editCt + " edit · " +
      (hasCustomWindow ? "custom range" : "default range") + "</span>" +
      '<button class="btn sm bad" data-admin-user-del="' + u.id + '" title="Delete user">Delete</button>' +
      "</summary>";
    h += '<table class="sc-table admin-grid"><thead><tr><th></th><th>View</th><th>Edit</th></tr></thead><tbody>';
    subs.forEach(function (s) {
      var key = s.section + "|" + s.sub, viewOn = key in byKey, editOn = viewOn && byKey[key];
      h += "<tr><td class=\"sc-lb\">" + esc(s.label) + '</td>' +
        '<td class="sc-act"><input type="checkbox" data-admin-view="' + u.id + "|" + s.section + "|" + s.sub +
        '"' + (viewOn ? " checked" : "") + "></td>" +
        '<td class="sc-act"><input type="checkbox" data-admin-edit="' + u.id + "|" + s.section + "|" + s.sub +
        '"' + (editOn ? " checked" : "") + "></td></tr>";
    });
    h += "</tbody></table>";
    var wStart = u.view_start || u.default_view_start || "", wEnd = u.view_end || u.default_view_end || "";
    h += '<div class="admin-window"><span class="lbl">Scheduler date range</span><div class="admin-window-fields">' +
      '<input type="text" inputmode="numeric" aria-label="Scheduler start date" placeholder="MM/DD/YYYY" data-smartdate data-admin-window="' + u.id +
      '|start" data-last-iso="' + wStart + '" value="' + esc(isoToMdy(wStart)) + '"> to ' +
      '<input type="text" inputmode="numeric" aria-label="Scheduler end date" placeholder="MM/DD/YYYY" data-smartdate data-admin-window="' + u.id +
      '|end" data-last-iso="' + wEnd + '" value="' + esc(isoToMdy(wEnd)) + '"> ' +
      '<button class="btn sm" data-admin-window-save="' + u.id + '">Save Range</button> ' +
      (hasCustomWindow
        ? '<button class="btn sm" data-admin-window-clear="' + u.id + '">Reset To Default</button>'
        : "") + "</div></div>";
    h += "</details>";
  });
  if (!restricted.length)
    h += '<div class="empty">No restricted accounts yet — one is created the first time someone signs in.</div>';
  return h;
}
/* Time card calculator — replaced the Help & FAQ settings tab (moved to the
   profile menu as a popup instead, Nate: settings bar should hold this).

   D258 rebuild (Nate: modeled on redcort.com's free timecard calculator —
   "blank the first one is am second one is pm but u can switch it... easy
   to type into... single digits in minutes it goes to 08... in hours it
   just accepts it as the hour time"). Redcort's own hour/minute fields are
   two plain text inputs per time (not a native <input type="time">, which
   forces a browser-chrome picker and hides the "type single digits" flow
   entirely) plus a separate AM/PM toggle — matched here with `.tc-hh`/
   `.tc-mm` text inputs and a `.tc-ampm` button. Minutes zero-pad to 2
   digits on blur (`tcPadMinute`); hours do NOT — a typed "8" stays "8", it
   IS the 12-hour hour, only the AM/PM toggle decides which half of the
   military day it lands in (`tcMinutesOf`). Start defaults AM, End
   defaults PM, both independently click-to-toggle — same default redcort
   uses, confirmed live against the real page before building this.

   D258 also built a "look up from Motive" section here (date/truck/driver
   picker calling a new /api/motive/day-detail for odometer + on-duty-window
   lookup) — verified working live, then deliberately pulled at Nate's
   explicit ask: "i should manually find it if i need to find their time
   cards, and also if im training someone on this job i do not want them
   to rely on that for driver pay just a bad deal." Don't reintroduce an
   automated Motive-driven fill for this calculator — pay figures stay a
   manual lookup by design, not an oversight. */
function timeFieldHtml(id, label, defaultAmPm) {
  return '<label class="mf tc-field"><span>' + esc(label) + '</span><div class="tc-time">' +
    '<input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" class="tc-hh" id="tc-' + id +
    '-hh" placeholder="--" autocomplete="off" aria-label="' + esc(label) + ' hour">' +
    '<span class="tc-colon">:</span>' +
    '<input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" class="tc-mm" id="tc-' + id +
    '-mm" placeholder="--" autocomplete="off" aria-label="' + esc(label) + ' minute">' +
    '<button type="button" class="btn sm tc-ampm" id="tc-' + id + '-ampm" data-tc-ampm="' + id + '">' +
    defaultAmPm + "</button></div></label>";
}
function settingsTimeCalc() {
  return '<div class="set-card"><div class="set-h">Time card calculator</div>' +
    '<p style="font-size:var(--fs-body-sm);color:var(--ink-2);margin-bottom:10px">Enter a start and end time — get their ' +
    "military (24-hour) equivalents and the total hours between them. Start defaults to AM and End to PM; click either " +
    "to switch it.</p>" +
    '<div class="set-row">' + timeFieldHtml("start", "Start time", "AM") + timeFieldHtml("end", "End time", "PM") + "</div>" +
    '<div id="tc-out">' + timeCalcOutHtml() + "</div></div>";
}
/* hh/mm text inputs, not a real <input type="time"> (see block comment
   above) — typed content needs its own digit filtering, since a text input
   accepts anything. */
function tcSanitizeDigits(el) { el.value = el.value.replace(/[^0-9]/g, "").slice(0, 2); }
function tcPadMinute(el) { if (el.value.length === 1) el.value = "0" + el.value; }
function tcClampHour(el) {
  if (!el.value) return;
  var n = Math.max(1, Math.min(12, parseInt(el.value, 10) || 1));
  el.value = String(n);
}
function tcClampMinute(el) {
  if (!el.value) return;
  var n = Math.max(0, Math.min(59, parseInt(el.value, 10) || 0));
  el.value = String(n);
  tcPadMinute(el);
}
/* Returns minutes-since-midnight (military) for one of the two time
   fields, or null while it's incomplete — h stays 1-12 as typed (not
   zero-padded, D258), the AM/PM button's own text is the only thing that
   decides which 12-hour half it lands in. */
function tcMinutesOf(id) {
  var hh = document.getElementById("tc-" + id + "-hh"), mm = document.getElementById("tc-" + id + "-mm"),
    ap = document.getElementById("tc-" + id + "-ampm");
  if (!hh || !mm || !ap || !hh.value || !mm.value) return null;
  var h = parseInt(hh.value, 10), m = parseInt(mm.value, 10);
  if (isNaN(h) || isNaN(m) || h < 1 || h > 12 || m < 0 || m > 59) return null;
  return (h % 12) * 60 + m + (ap.textContent === "PM" ? 12 * 60 : 0);
}
function militaryFromMinutes(mins) {
  var h = Math.floor(mins / 60) % 24, m = mins % 60;
  return String(h).padStart(2, "0") + String(m).padStart(2, "0");
}
function timeCalcOutHtml() {
  var sm = tcMinutesOf("start"), em = tcMinutesOf("end");
  if (sm == null || em == null) return "";
  var total = em - sm; var overnight = total < 0; if (overnight) total += 24 * 60;
  var hrs = Math.floor(total / 60), mins = total % 60;
  var dec = (total / 60).toFixed(2).replace(/\.?0+$/, "");
  return '<div class="set-row"><span class="lbl">Start · military</span><b>' + militaryFromMinutes(sm) + "</b></div>" +
    '<div class="set-row"><span class="lbl">End · military</span><b>' + militaryFromMinutes(em) + "</b></div>" +
    '<div class="set-row"><span class="lbl">Total hours</span><b>' + hrs + "h " + mins + "m (" + dec + " hrs)</b></div>" +
    (overnight ? '<div class="note-bar">End is before start — counted as crossing midnight.</div>' : "");
}
function renderTimeCalc() { var out = document.getElementById("tc-out"); if (out) out.innerHTML = timeCalcOutHtml(); }
function settingsHelp() {
  var faqs = [
    ["Scheduler",
      "Scroll through the calendar or enter a date in the header to jump to it. <b>Today</b> returns to the current date. " +
      "Click an empty cell to add a note, drag an order card to schedule or move it, and click a card to open the order. " +
      "Current Week and Driver Tabs show the same schedule in field-ready layouts."],
    ["The three order lists",
      "<b>Bag Orders</b> tracks the bagger’s customer orders. <b>Internal Freight</b> tracks department-to-department " +
      "moves and their mileage/transfer charge; these are not customer invoices. <b>External Orders</b> tracks broker " +
      "work, routes, documents, and billing. Bare reserved Bag Order rows and cancelled orders are not included in the active count."],
    ["Order numbers",
      "Use <b>Add Orders</b> in Bag Orders to reserve a sequential block for a month, year, starting number, and quantity. " +
      "<b>+ Add one</b> reserves the next number in the selected month. Administrators can change both order-number formats " +
      "and reporting department codes under <b>Settings → General</b>. A format change applies only to new numbers; historical numbers stay unchanged."],
    ["External routes and rate confirmations",
      "Create a blank External Order or drop a rate confirmation into the drop area. A normal order has one pickup and one " +
      "delivery; open the route editor when an order needs additional stops. External order numbers remain editable and can be entered when available."],
    ["Documents and billing",
      "Attach rate confirmations, PODs, and invoices from an order. <b>View</b> opens a document in the app and <b>Download</b> " +
      "saves a copy. Loose files are matched when the app finds a reliable order or load number; anything unresolved stays in " +
      "Billing for manual attachment. Billing downloads the merged package once the needed paperwork is attached."],
    ["Database tables",
      "Edit a cell directly. Use the numbered gutter to select one or several rows, then use the table action for archive or delete. " +
      "The header <b>+</b> adds a field, and Manage Columns controls field order and visibility. Archived directory records remain on historical orders."],
    ["Mileage, delivery dates, and rates",
      "<b>Sync Mileage</b> fills available truck mileage from Motive. If an internal rate is set, blank internal freight charges " +
      "are calculated in that same run; existing charges are not overwritten. <b>Sync Delivery Dates</b> copies completed schedule dates back to orders."],
    ["Settings, shortcuts, and access",
      "General contains profile, theme, accent, font, account, order numbering, and Scheduler sizing. Shortcuts can be " +
      "re-recorded, and <b>Add shortcut</b> gives an action an additional key combination. Administrators use Access to control " +
      "which pages another account can view or edit and the Scheduler date range it may load."],
    ["Undo and administrative history",
      "Undo and Redo cover changes made in the current session. Administrators can open History for the shared audit trail and " +
      "review a reversible change before restoring it. External actions such as sending data to another service remain recorded but are not reversed remotely."],
    ["Reports",
      "Choose a date range in Reports, then export the order report for analysis in Excel. Internal Freight has its own transfer report. " +
      "Exports use stored order fields and department codes; they do not depend on the visible order-number pattern."]
  ];
  return faqs.map(function (f) {
    return '<div class="set-card"><div class="set-h">' + f[0] + '</div>' +
      '<p style="font-size:var(--fs-body);color:var(--ink-2);line-height:1.55">' + f[1] + "</p></div>";
  }).join("");
}

/* ── Nav ─────────────────────────────────────────────────────────────────── */
var NAV = [
  { k: "dispatch", t: "Dispatch", subs: [{ k: "sched", t: "Scheduler" }, { k: "cw", t: "Current Week" },
      { k: "driver", t: "Driver Tabs" }] },
  { k: "orders", t: "Orders", subs: [{ k: "int", t: "Bag Orders" }, { k: "xfer", t: "Internal Freight" },
      { k: "ext", t: "External Orders" }] },
  { k: "billing", t: "Billing", subs: [{ k: "bill", t: "Invoices & Packages" }] },
  { k: "reports", t: "Reports", subs: [{ k: "rep", t: "Export & Reports" }] },
  { k: "database", t: "Database", subs: [{ k: "bagger", t: "Bagger Customers" }, { k: "brokers", t: "External Customers" },
      { k: "pickdrop", t: "Pick/Drop List" }, { k: "fleet", t: "Fleet" }] }
];
/* Settings (D54) is reached from the header gear, not the main nav, so it lives
   outside NAV — subsOf resolves its tabs specially. Gated like every other
   section under local auth (D125) — a restricted user with no "settings"
   grants sees no Settings tabs at all, only the always-available Sign Out. */
var SETTINGS_SUBS = [{ k: "appearance", t: "General" }, { k: "shortcuts", t: "Shortcuts" },
  { k: "timecalc", t: "Time Calc" }];
function settingsSubsFor() {
  var subs = SETTINGS_SUBS;
  if (DB && DB.me && DB.me.is_admin) subs = subs.concat([{ k: "admin", t: "Access" }]);
  return subs;
}
function subsOf(s) {
  var subs;
  if (s === "settings") {
    subs = settingsSubsFor();
  } else {
    subs = [];
    for (var i = 0; i < NAV.length; i++) if (NAV[i].k === s) subs = NAV[i].subs;
    if (s === "database") {
      /* Built-in databases come from the entities metadata now (renamable +
         reorderable, D85); custom sheets (D74) follow. */
      var ents = (DB.entities || []).slice().sort(function (a, b) { return a.sort_order - b.sort_order; });
      // Custom entities (D85 Phase 2) have no slug — addressed as "custom:<id>",
      // same convention as "sheet:<id>" (entityByKey resolves both).
      if (ents.length) subs = ents.map(function (e) { return { k: e.slug || ("custom:" + e.id), t: e.name }; });
      subs = subs.concat((DB.sheets || []).map(function (sh) { return { k: "sheet:" + sh.id, t: sh.name }; }));
    }
  }
  return subs.filter(function (sub) { return canView(s, sub.k); });
}
var RAIL_ON = { sched: 1, int: 1, xfer: 1, ext: 1, cw: 1, driver: 1 };

function renderRail() {
  var list = STAGED.filter(function (id) {
    if (!Q) return true;
    var o = order(id); if (!o) return false;
    var c = buildChip(o);
    return (c.title + " " + c.line).toLowerCase().indexOf(Q.toLowerCase()) >= 0;
  });
  $("#rail").innerHTML = list.length ? list.map(function (id) {
    var o = order(id); return o ? chipHtml(o, true, 'data-from="STAGE"') : "";
  }).join("") : emptyStateHtml(Q ? "No matches for “" + Q + "”" : "Nothing staged");
  $("#stage-ct").textContent = STAGED.length;
}
/* Reorder within the Staging rail by drag (D197, Nate: "id also like to be
   able to re order the loads in the staging area by clicking and dragging
   them") — STAGED is a plain client array (never persisted, D51), so this
   is just an array splice + repaint, no server round trip. Same insert-
   position convention as reorderGridRow (04-views.js): splice out the
   dragged id, then splice it in at the target's original index — while a
   live filter (Q) is active, the target's index in the full STAGED array
   still resolves correctly since both ids are looked up by identity, not
   by their filtered-list position. */
function reorderStagedRow(draggedId, targetId) {
  if (draggedId === targetId) return;
  var from = STAGED.indexOf(draggedId), to = STAGED.indexOf(targetId);
  if (from < 0 || to < 0) return;
  var moved = STAGED.splice(from, 1)[0];
  STAGED.splice(to, 0, moved);
  renderRail();
}
/* D170/D205: persisted $/mile rate + minimum charge, at the far right of the
   global formatting toolbar on Orders pages. Nate: "why dont we have an adjustable rate thing... that
   changes the rate calc... only changes what it calculates that run not
   what it was previously." Blur saves to the server (DB.internal_freight_rate
   is the bootstrap-loaded current value); it's applied to every internal-
   flavored order (Bag Orders + Internal Freight transfers) that has miles
   but no charge yet automatically whenever Sync mileage runs — never touches
   an order that already has one, and there's no separate manual button
   (Nate: "i dont want the calc freight button to exist"). Collapsed behind
   a bare arrow, not a button pill (Nate: "i just want the arrow") — points
   left closed, right open (Nate's explicit direction, not the usual
   disclosure-triangle convention — and per D201, plain angle brackets now,
   not the triangle glyph: "i dont like the little triangle thing"). */
function internalFreightRateHtml() {
  var cfg = DB.internal_freight_rate || { rate_per_mile: 0, minimum_charge: 0 };
  var action = (IFR_OPEN ? "Hide" : "Show") + " internal rate settings";
  var toggle = '<button class="ifr-arrow" id="ifr-toggle" title="' +
    action + '" aria-label="' + action + '">' + (IFR_OPEN ? "&gt;" : "&lt;") + "</button>";
  if (!IFR_OPEN) return toggle;
  return toggle +
    '<span class="lbl" style="margin:0 4px 0 6px">Internal rate $/mi</span>' +
    '<input type="number" step="0.01" min="0" id="ifr-rate" class="rate-inp" placeholder="0.00" value="' +
      (cfg.rate_per_mile ? esc(String(cfg.rate_per_mile)) : "") + '" title="Internal freight rate per mile">' +
    '<span class="lbl" style="margin:0 4px">Min $</span>' +
    '<input type="number" step="0.01" min="0" id="ifr-min" class="rate-inp" placeholder="0.00" value="' +
      (cfg.minimum_charge ? esc(String(cfg.minimum_charge)) : "") + '" title="Minimum internal freight charge — 0 means no minimum, always miles × rate">';
}
/* The IFR rate arrow + Sync mileage/Sync delivery dates buttons used to live
   embedded in the retired .subs tab bar (D200 removed it — Nate: "the order
   section... those tabs actually have buttons and functionality so we need
   to move that somewhere that fits the ui"). Sync actions apply across all
   three order kinds (D154), so each order tracker's own toolbar carries them
   as a `secondary` block, ahead of that tracker's own bulk-action buttons.
   D205 moved Internal Rate into the global formatting toolbar's far-right
   edge on Orders pages, leaving this page toolbar focused on sync/actions.
   #motive-sync/#sync-btn remain click-delegated by id (07-events.js). */
function ordersToolbarExtras() {
  return '<button class="btn sm" id="motive-sync">' + icon("sync") + 'Sync Mileage</button>' +
    '<button class="btn sm" id="sync-btn">' + icon("calendar") + 'Sync Delivery Dates</button>';
}
function render() {
  reindexLookups(); CELLS = cellContents(); buildOffDays(); buildDayNotes(); buildCatColor(); buildSheetCells(); buildGridFmt(); renderFmtBar();
  // #main's innerHTML is about to be replaced — the shared loc-suggest
  // portal (D228 follow-up) lives outside it and would otherwise survive
  // pointing at a now-detached SUGGEST_INPUT, a stale panel with nothing
  // real left to pick.
  var openSuggest = document.getElementById("loc-suggest-portal");
  if (openSuggest) openSuggest.style.display = "none";
  // A live permission change (an admin revoking a grant the user is actively
  // viewing) shouldn't leave the page stuck on a now-hidden section (D125).
  if (!canView(SEC, SUB)) { SEC = "dispatch"; SUB = "sched"; SEL = null; }
  $("#conn").textContent = "";
  // The persistent top-level .sections/.subs bars are retired (D200). The
  // sidebar owns section navigation. Database and Settings use in-page tabs.
  renderSideNav();

  var main = $("#main");
  // The scheduler node is cached and re-inserted rather than rebuilt (below),
  // but a detached-and-reattached scrollable element loses its scrollTop in
  // most browsers — save it before main.innerHTML clears schedNode out of
  // the DOM, or switching away from Scheduler and back silently dumps the
  // view back to the top of its rolling window (D141).
  if (schedNode && schedNode.parentNode === main) schedScrollTop = schedNode.scrollTop;
  main.innerHTML = ""; applyZoom();
  if (SEC === "database") main.insertAdjacentHTML("beforeend", databaseTabsHtml());
  if (SEC === "settings") main.insertAdjacentHTML("beforeend", settingsTabsHtml());
  var railOn = !!RAIL_ON[SUB];
  $("#bodywrap").classList.toggle("norail", !railOn);
  $("#rail-wrap").style.display = railOn ? "flex" : "none";

  if (SUB === "sched") {
    main.insertAdjacentHTML("beforeend", vScheduler());
    if (!schedNode) schedNode = buildScheduler();
    main.appendChild(schedNode);
    /* On a fresh build, land the viewport on today once it's in the DOM (D53).
       Reusing the cached node instead just restores wherever it was (D141). */
    if (schedNeedsScroll) {
      schedNeedsScroll = false;
      requestAnimationFrame(function () {
        var el = document.getElementById("row-" + TODAY);
        if (el) el.scrollIntoView({ block: "center" });
      });
    } else {
      requestAnimationFrame(function () { schedNode.scrollTop = schedScrollTop; });
    }
  } else if (SUB === "cw" || SUB === "driver" || SUB === "int" || SUB === "xfer" || SUB === "ext" ||
             SUB === "bill" || SEC === "database") {
    // Inserted straight into #main, not wrapped in a .pad (D137/D140,
    // extended to the three Orders trackers D237, and to Billing/Database
    // D256) — identical to how vScheduler()'s own toolbar+grid-wrap pair
    // are appended, so every list-style section now shares the same
    // header: zero-padding edge-to-edge width, real toolbar background
    // (no more `plain:true` for Billing/Database), and `.grid-wrap{flex:1}`
    // (already generic, not `.pad`-scoped) fills all remaining height
    // instead of sitting inset inside `.pad`'s own padding. Nate: "we do
    // need to create this header system for the database and billing
    // sections to match the app." Billing's own multiple stacked sections
    // (drop zones, unmatched docs, invoice pool, billing queue) are wrapped
    // in ONE `.grid-wrap` by `vBilling()` so they scroll together as a
    // single region below the fixed toolbar, same as before — just not
    // inset. Database's `.pad.grid-pad` hack (D93) is retired outright:
    // it was hand-rolling the exact same flex-fill-and-scroll behavior
    // `main`/`.grid-wrap` already provide generically, just with padding.
    main.insertAdjacentHTML("beforeend", SUB === "cw" ? vCurrentWeek() : SUB === "driver" ? vDriverView() :
      SUB === "int" ? vInternal() : SUB === "xfer" ? vInternalFreight() : SUB === "ext" ? vOrders("external") :
      SUB === "bill" ? vBilling() : vDatabase(SUB));
  } else {
    var html = SUB === "rep" ? vReports() : vSettings(SUB);
    var pad = document.createElement("div");
    pad.className = "pad";
    pad.innerHTML = html;
    main.appendChild(pad);
  }
  if (SEC === "database" || SEC === "settings") {
    requestAnimationFrame(function () {
      var activeDbTab = document.querySelector("#database-tabs .sub-tab[aria-selected=true],#settings-tabs .sub-tab[aria-selected=true]");
      if (activeDbTab) activeDbTab.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }
  if (railOn) renderRail();
  applyEditLockUI();
}
/* Gray out (not hide, D126) "add"-style controls for a view-only grant —
   a single generic pass over the current section's DOM instead of threading
   a canEdit check into every individual button template. Structural buttons
   (+ new database/sheet) stay admin-only regardless of any edit grant,
   matching the server's API_PERMISSIONS defaults (D125). */
function applyEditLockUI() {
  var locked = !canEdit(SEC, SUB);
  $$("#new-order,#xfer-add,#xfer-bulk,#new-ratecon,#rc-drop,#int-bulk,#int-add,#add-pickdrop,#add-truck,#add-department," +
     "[data-addcust],[data-addcol],[data-addrow]").forEach(function (el) {
    el.classList.toggle("locked-view", locked);
    if ("disabled" in el) el.disabled = locked;
  });
  $$("[data-archiverows]").forEach(function (el) {
    el.classList.toggle("locked-view", locked);
    el.disabled = locked || !(ROWSEL[el.dataset.archiverows] || []).length;
  });
  var structLocked = !(DB && DB.me && DB.me.is_admin) && !!(DB && DB.me);
  $$("[data-adddb],[data-addsheet]").forEach(function (el) {
    el.classList.toggle("locked-view", structLocked);
  });
}
function reload() { return api("bootstrap").then(function (d) {
  DB = d; schedNode = null; render();
  if (typeof refreshDrawerChipPreview === "function") refreshDrawerChipPreview();
  // Keep the durable History panel current with whatever just changed —
  // reload() already runs after essentially every mutation in the app, so
  // this is "live" without any polling/websocket infrastructure (D134).
  if (typeof historyPanelOpen === "function" && historyPanelOpen()) loadHistoryPanel();
}); }

/* ── Global search (D44) — type anything, it scrapes the already-loaded DB and
   jumps you to the match: an order opens its drawer, everything else navigates
   to the Database tab where it lives. Arrow keys + Enter, or click. */
/* ── Flexible date search (D55) ──────────────────────────────────────────────
   Type a date in the search bar to jump the rolling calendar there, in almost
   any format: "march 2025", "mar 15 2025", "03/04/25", "3-4-2025", ISO. */
var MONTHNAMES = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
function normYear(s) { var n = parseInt(s, 10); return n < 100 ? 2000 + n : n; }
function mkDateObj(y, mo, d, monthLevel) {
  var dt = new Date(Date.UTC(y, mo, d));
  return { ds: iso(dt), monthLevel: !!monthLevel, y: dt.getUTCFullYear(), mo: dt.getUTCMonth() };
}
function parseDateQuery(q) {
  q = (q || "").trim().toLowerCase();
  if (!q) return null;
  var m;
  if ((m = q.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)) && +m[2] >= 1 && +m[2] <= 12)
    return mkDateObj(+m[1], +m[2] - 1, +m[3], false);
  if ((m = q.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/)) &&
      +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31)
    return mkDateObj(m[3] != null ? normYear(m[3]) : +TODAY.slice(0, 4), +m[1] - 1, +m[2], false);
  var monIdx = null, tokens = q.split(/[\s,]+/);
  for (var i = 0; i < tokens.length; i++) if (MONTHNAMES.hasOwnProperty(tokens[i])) { monIdx = MONTHNAMES[tokens[i]]; break; }
  if (monIdx != null) {
    var nums = (q.match(/\d{1,4}/g) || []).map(Number), day = null, year = null;
    nums.forEach(function (n) { if (n >= 1000) year = n; else if (n > 31) year = normYear(String(n)); else if (day == null) day = n; });
    if (year == null) year = +TODAY.slice(0, 4);
    return day == null ? mkDateObj(year, monIdx, 1, true) : mkDateObj(year, monIdx, day, false);
  }
  return null;
}
function monthLabel(dq) { var n = MON[dq.mo]; return n.charAt(0) + n.slice(1).toLowerCase() + " " + dq.y; }
function prettyDate(ds) {
  return new Date(ds + "T00:00:00Z").toLocaleDateString(undefined,
    { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
/* Orders sitting on a given date on the board (any truck, any slot). */
function loadsOnDate(ds) {
  var seen = {}, res = [];
  for (var k in CELLS) if (k.indexOf("|" + ds + "|") >= 0) {
    var v = CELLS[k];
    if (v && v.oid && !seen[v.oid]) { seen[v.oid] = 1; var o = order(v.oid); if (o) res.push(o); }
  }
  return res;
}
function gotoDate(ds, oid) {
  SEC = "dispatch"; SUB = "sched"; SEL = null; render(); jumpTo(ds);
  if (oid) openOrder(oid);
}

var GS_RESULTS = [], GS_SEL = -1;
function searchResults(qraw) {
  var q = (qraw || "").trim().toLowerCase();
  var out = [];
  /* Date jump first — the top hit for a date-shaped query (D55). */
  var dq = parseDateQuery(q);
  if (dq && dq.monthLevel) {
    out.push({ type: "Date", label: "Go to " + monthLabel(dq), sub: "Scheduler",
      run: function () { gotoDate(dq.ds); } });
  } else if (dq) {
    out.push({ type: "Date", label: "Go to " + prettyDate(dq.ds), sub: "Scheduler",
      run: function () { gotoDate(dq.ds); } });
    loadsOnDate(dq.ds).forEach(function (o) {
      out.push({ type: "Load", label: buildChip(o).title + " · " + prettyDate(dq.ds),
        sub: o.solomon_order_no || o.broker_load_no || "",
        run: function () { gotoDate(dq.ds, o.id); } });
    });
  }
  if (q.length < 2) return out.slice(0, 14);
  function has() { for (var i = 0; i < arguments.length; i++) {
    var v = arguments[i]; if (v != null && String(v).toLowerCase().indexOf(q) >= 0) return true; } return false; }
  DB.orders.forEach(function (o) {
    var cust = o.customer_party_id && party(o.customer_party_id), brok = o.broker_party_id && party(o.broker_party_id);
    if (has(o.solomon_order_no, o.broker_load_no, o.po_number, o.delivery_number, o.notes,
            cust && cust.name, brok && brok.name)) {
      out.push({ type: o.kind === "internal" ? "Internal" : "Order",
        label: (o.solomon_order_no || o.broker_load_no || "no #") + " · " + buildChip(o).title,
        sub: [o.po_number && "PO " + o.po_number, o.broker_load_no && "load " + o.broker_load_no,
              o.delivery_number && "del " + o.delivery_number].filter(Boolean).join(" · "),
        run: function () { openOrder(o.id); } });
    }
  });
  DB.parties.forEach(function (p) {
    var isCust = p.is_customer && !p.customer_archived_at;
    var isBroker = p.is_broker && !p.broker_archived_at;
    if (!isCust && !isBroker && !p.is_carrier) return;
    if (has(p.name, p.ap_email, p.manager_name, p.rexius_customer_no, p.notes)) {
      out.push({ type: isCust ? "Customer" : isBroker ? "Broker" : "Carrier", label: p.name,
        sub: p.rexius_customer_no ? "Rexius #" + p.rexius_customer_no : (p.ap_email || p.manager_name || ""),
        run: function () { SEC = "database"; SUB = isCust ? "bagger" : "brokers"; SEL = null; render(); } });
    }
  });
  DB.locations.forEach(function (l) {
    var owner = l.party_id ? party(l.party_id) : null;
    if (owner && owner.is_customer && owner.customer_archived_at) return;
    if (has(l.name, l.city, l.address)) {
      out.push({ type: "Location", label: l.name, sub: [l.city, l.state].filter(Boolean).join(", "),
        run: function () { SEC = "database"; SUB = l.party_id ? "bagger" : "pickdrop"; SEL = null; render(); } });
    }
  });
  DB.drivers.forEach(function (d) {
    if (has(d.full_name)) out.push({ type: "Driver", label: d.full_name, sub: "",
      run: function () { SEC = "database"; SUB = "fleet"; SEL = null; render(); } });
  });
  DB.trucks.forEach(function (t) {
    if (has(t.number)) out.push({ type: "Truck", label: "Truck " + t.number, sub: t.eq || "",
      run: function () { SEC = "database"; SUB = "fleet"; SEL = null; render(); } });
  });
  return out.slice(0, 14);
}
function paintSearch() {
  var panel = $("#gsearch-results");
  if (!GS_RESULTS.length) { panel.style.display = "none"; panel.innerHTML = ""; return; }
  panel.innerHTML = GS_RESULTS.map(function (r, i) {
    return '<div class="gs-opt' + (i === GS_SEL ? " on" : "") + '" data-gsi="' + i + '">' +
      '<span class="gs-ty">' + esc(r.type) + "</span>" +
      '<span class="gs-lb">' + esc(r.label) + "</span>" +
      (r.sub ? '<span class="gs-sb">' + esc(r.sub) + "</span>" : "") + "</div>";
  }).join("");
  panel.style.display = "block";
}
function renderSearch() { GS_RESULTS = searchResults($("#gsearch").value); GS_SEL = GS_RESULTS.length ? 0 : -1; paintSearch(); }
function gsActivate(i) {
  var r = GS_RESULTS[i]; if (!r) return;
  $("#gsearch-results").style.display = "none"; $("#gsearch").value = ""; GS_RESULTS = []; GS_SEL = -1;
  r.run();
}
/* ═══ 06-modals-grids ═══ */
/* ── Modal + Add-customer popup (D46) ────────────────────────────────────── */
function openModal(html) {
  var m = $("#modal");
  if (!m) { m = document.createElement("div"); m.id = "modal"; document.body.appendChild(m); }
  delete m.dataset.keyConfirming; m.classList.remove("route-modal", "wide-modal");
  m.innerHTML = '<div class="modal-card">' + html + "</div>";
  m.classList.add("on"); $("#scrim").classList.add("on");
}
function captureRouteDraft() {
  if (!ROUTE_DRAFT) return;
  $$("#modal [data-route-index]").forEach(function (row) {
    var s = ROUTE_DRAFT.stops[+row.dataset.routeIndex]; if (!s) return;
    var get = function (key) { var el = row.querySelector('[data-route-field="' + key + '"]'); return el; };
    s.stop_type = get("stop_type").value;
    s.location_id = get("location_id").value || null;
    s.reference_number = get("reference_number").value.trim();
    s.scheduled_at = get("scheduled_at").value || null;
    s.appointment_required = get("appointment_required").checked;
    s.pallet_count = get("pallet_count").value;
    s.notes = get("notes").value.trim();
  });
}
function routeEditorModal(oid, suppliedStops) {
  var o = order(oid); if (!o) return;
  if ((o.delivered_at || o.billed_at) && !suppliedStops) {
    var lockedStops = orderStops(oid);
    if (!lockedStops.length) lockedStops = [
      { sequence: 1, stop_type: "pickup", location_id: o.pickup_location_id, reference_number: o.po_number },
      { sequence: 2, stop_type: "delivery", location_id: o.delivery_location_id, reference_number: o.delivery_number }
    ];
    openModal('<div class="modal-hd"><h2>Route · ' + esc(o.solomon_order_no || o.broker_load_no || "order") + '</h2></div>' +
      '<div class="modal-body"><div class="note-bar">Delivered and billed routes are read-only to protect history.</div>' +
      '<div class="route-summary">' + lockedStops.map(function (s, i) {
        return '<span><strong>' + (s.sequence || i + 1) + ' ' + (s.stop_type === "pickup" ? "PICK" : "DROP") + '</strong> ' +
          esc(routeStopLabel(s)) + (s.reference_number ? ' · ' + esc(s.reference_number) : '') + '</span>';
      }).join("") + '</div></div><div class="modal-ft"><button class="btn" id="modal-cancel">Close</button></div>');
    $("#modal").classList.add("route-modal"); return;
  }
  if (!suppliedStops) {
    var current = o.route_mode === "custom" ? orderStops(oid) : [
      { stop_type: "pickup", location_id: o.pickup_location_id, reference_number: o.po_number },
      { stop_type: "delivery", location_id: o.delivery_location_id, reference_number: o.delivery_number }
    ];
    ROUTE_DRAFT = { orderId: oid, stops: current.map(function (s) { return Object.assign({}, s); }) };
  }
  var locations = (DB.locations || []).slice().sort(function (a, b) {
    return String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
  });
  function locationOptions(selected) {
    return '<option value="">— choose from Pick/Drop List —</option>' + locations.map(function (l) {
      var label = [l.name, l.address, l.city, l.state].filter(Boolean).join(" · ");
      return '<option value="' + l.id + '"' + (l.id === selected ? " selected" : "") + '>' + esc(label) + '</option>';
    }).join("");
  }
  var cards = ROUTE_DRAFT.stops.map(function (s, i) {
    var dt = s.scheduled_at ? String(s.scheduled_at).slice(0, 16) : "";
    return '<section class="route-stop" data-route-index="' + i + '">' +
      '<div class="route-stop-head"><span class="route-grip" draggable="true" title="Drag to reorder">⋮⋮</span>' +
      '<b>Stop ' + (i + 1) + '</b><span style="flex:1"></span>' +
      '<button class="btn sm bad" data-route-remove="' + i + '"' + (ROUTE_DRAFT.stops.length <= 2 ? " disabled" : "") + '>Remove</button></div>' +
      '<div class="route-fields"><label class="mf"><span>Type</span><select data-route-field="stop_type">' +
        '<option value="pickup"' + (s.stop_type === "pickup" ? " selected" : "") + '>Pickup</option>' +
        '<option value="delivery"' + (s.stop_type === "delivery" ? " selected" : "") + '>Delivery</option></select></label>' +
      '<label class="mf route-location"><span>Location</span><select data-route-field="location_id">' +
        locationOptions(s.location_id) + '</select></label>' +
      '<label class="mf"><span>PU/PO or Delivery #</span><input data-route-field="reference_number" value="' + esc(s.reference_number || "") + '"></label>' +
      '<label class="mf"><span>Appointment</span><input type="datetime-local" data-route-field="scheduled_at" value="' + esc(dt) + '"></label>' +
      '<label class="mf"><span>Pallets</span><input type="number" min="0" data-route-field="pallet_count" value="' + esc(s.pallet_count == null ? "" : s.pallet_count) + '"></label>' +
      '<label class="mf route-notes"><span>Stop notes</span><input data-route-field="notes" value="' + esc(s.notes || "") + '"></label>' +
      '<label class="mf chk"><input type="checkbox" data-route-field="appointment_required"' + (s.appointment_required ? " checked" : "") + '> <span>Appointment required</span></label>' +
      '</div></section>';
  }).join("");
  openModal('<div class="modal-hd"><h2>Full route · ' + esc(o.solomon_order_no || o.broker_load_no || "new order") + '</h2></div>' +
    '<div class="modal-body route-editor"><p class="route-help">Normal orders stay one pickup and one delivery. Add stops only for the exception.</p>' +
    cards + '<div class="route-add"><button class="btn" data-route-add="pickup">+ Pickup</button>' +
    '<button class="btn" data-route-add="delivery">+ Delivery</button></div></div>' +
    '<div class="modal-ft">' + (o.route_mode === "custom" && ROUTE_DRAFT.stops.length === 2 &&
      ROUTE_DRAFT.stops[0].stop_type === "pickup" && ROUTE_DRAFT.stops[1].stop_type === "delivery"
      ? '<button class="btn" id="route-simple" style="margin-right:auto">Return To Simple Route</button>' : '') +
      '<button class="btn" id="modal-cancel">Cancel</button><button class="btn pri" id="route-save">Save Route</button></div>');
  $("#modal").classList.add("route-modal");
  $$('[data-route-add]').forEach(function (b) { b.addEventListener("click", function () {
    captureRouteDraft(); ROUTE_DRAFT.stops.push({ stop_type: b.dataset.routeAdd, location_id: null,
      reference_number: "", scheduled_at: null, appointment_required: false, pallet_count: "", notes: "" });
    routeEditorModal(oid, ROUTE_DRAFT.stops);
  }); });
  $$('[data-route-remove]').forEach(function (b) { b.addEventListener("click", function () {
    captureRouteDraft(); ROUTE_DRAFT.stops.splice(+b.dataset.routeRemove, 1); routeEditorModal(oid, ROUTE_DRAFT.stops);
  }); });
  $$("#modal .route-grip").forEach(function (grip) {
    grip.addEventListener("dragstart", function () { ROUTE_DRAG = +grip.closest("[data-route-index]").dataset.routeIndex; });
  });
  $$("#modal .route-stop").forEach(function (card) {
    card.addEventListener("dragover", function (e) { if (ROUTE_DRAG != null) { e.preventDefault(); card.classList.add("over"); } });
    card.addEventListener("dragleave", function () { card.classList.remove("over"); });
    card.addEventListener("drop", function (e) {
      e.preventDefault(); card.classList.remove("over"); captureRouteDraft();
      var to = +card.dataset.routeIndex, moved = ROUTE_DRAFT.stops.splice(ROUTE_DRAG, 1)[0];
      ROUTE_DRAFT.stops.splice(to, 0, moved); ROUTE_DRAG = null; routeEditorModal(oid, ROUTE_DRAFT.stops);
    });
  });
  function saveRoute(mode) {
    captureRouteDraft();
    var save = function () {
      api("order/route", { order_id: oid, stops: ROUTE_DRAFT.stops, route_mode: mode }).then(function () {
        ROUTE_DRAFT = null; closeModal(); return reload();
      }).then(function () { openOrder(oid); toast(mode === "simple" ? "Returned to simple route" : "Route saved"); })
        .catch(function (err) {
          toast(err.message, true);
          if (!document.querySelector("#modal.on .route-editor")) routeEditorModal(oid, ROUTE_DRAFT.stops);
        });
    };
    if (placement()[oid]) confirmModal("This order is already scheduled. Save the route and update the scheduled truck run too?", save, "Update route");
    else save();
  }
  $("#route-save").addEventListener("click", function () { saveRoute("custom"); });
  var simpleBtn = $("#route-simple"); if (simpleBtn) simpleBtn.addEventListener("click", function () { saveRoute("simple"); });
}
function closeModal() { var m = $("#modal"); if (m) m.classList.remove("on"); $("#scrim").classList.remove("on"); }
/* Database sorting deliberately has two modes: a browser-only view sort and a
   saved default row order. The latter is explicit because it changes what
   everyone sees when they open this database. */
function databaseSortModal(grid) {
  var ent = entityForGrid(grid); if (!ent) return;
  var fields = sortableFields(ent, grid), cur = GRIDSORT[grid];
  if (!fields.length) { toast("Add a column before sorting", true); return; }
  var selected = (cur && fields.some(function (f) { return f.id === cur.fieldId; })) ? cur.fieldId : fields[0].id;
  var opts = fields.map(function (f) {
    return '<option value="' + esc(f.id) + '"' + (f.id === selected ? " selected" : "") + '>' + esc(f.label) + '</option>';
  }).join("");
  openModal('<div class="modal-hd"><h2>Sort rows</h2></div>' +
    '<div class="modal-body sort-dialog">' +
      '<label class="mf"><span>Column</span><select id="sort-field">' + opts + '</select></label>' +
      '<section><b>Sort this view</b><p>Temporary. Only changes what you see in this browser.</p>' +
        '<div class="sort-actions"><button class="btn" data-sort-view="asc">A → Z</button>' +
        '<button class="btn" data-sort-view="desc">Z → A</button>' +
        '<button class="btn" id="sort-clear"' + (cur ? "" : " disabled") + '>Clear</button></div></section>' +
      '<section><b>Save as row order</b><p>Reorders this database for everyone. New rows will follow the saved rows.</p>' +
        '<div class="sort-actions"><button class="btn pri" data-sort-save="asc">Save A → Z</button>' +
        '<button class="btn pri" data-sort-save="desc">Save Z → A</button></div></section>' +
    '</div><div class="modal-ft"><button class="btn" id="modal-cancel">Close</button></div>');
  $$('[data-sort-view]').forEach(function (b) { b.addEventListener("click", function () {
    GRIDSORT[grid] = { fieldId: $("#sort-field").value, dir: b.dataset.sortView };
    closeModal(); render();
  }); });
  var clear = $("#sort-clear"); if (clear) clear.addEventListener("click", function () {
    delete GRIDSORT[grid]; closeModal(); render();
  });
  $$('[data-sort-save]').forEach(function (b) { b.addEventListener("click", function () {
    var fieldId = $("#sort-field").value, dir = b.dataset.sortSave;
    var field = fields.filter(function (f) { return f.id === fieldId; })[0];
    var rows = storedOrderRows(ent.kind === "custom" ? recordRows(ent.id) : builtinRows(ent.slug), grid, ent);
    var ids = sortRowsBy(rows, field, dir).map(function (row) { return rowIdForEntity(row, ent); });
    confirmModal('Save “' + field.label + '” ' + (dir === "asc" ? 'A → Z' : 'Z → A') +
      ' as the default row order for this database?', function () {
        api("grid/row/reorder", { grid: grid, row_ids: ids,
          archived_view: archiveViewForGrid(grid) }).then(function () {
          delete GRIDSORT[grid]; toast("Saved row order"); return reload();
        }).catch(function (err) { toast(err.message, true); });
      }, "Save row order");
  }); });
}
/* Day note popup (D230) — a dispatcher-only note pinned to a calendar date,
   opened from the scheduler's date-header right-click menu (openDayMenu,
   09-color.js). Never reaches driver tabs or Sheets; only place it leaves
   the app is the "Export entire app" full data dump, matched to whichever
   order lands on the same date (docs/decisions.md D230/D245). */
function dayNoteModal(ds) {
  var existing = dayNote(ds);
  openModal('<div class="modal-hd"><h2>Day note · ' + esc(ds) + '</h2></div>' +
    '<div class="modal-body"><p class="modal-note">Dispatcher-only — never shown to drivers or pushed to Sheets. Included in the full "Export entire app" data export.</p>' +
    '<label class="mf"><span>Note</span><textarea id="daynote-text" rows="4">' + esc(existing ? existing.text : "") + '</textarea></label></div>' +
    '<div class="modal-ft">' +
    (existing ? '<button class="btn bad" id="daynote-clear" style="margin-right:auto">Delete note</button>' : "") +
    '<button class="btn" id="modal-cancel">Cancel</button>' +
    '<button class="btn pri" id="daynote-save">Save</button></div>');
  function submit(text) {
    api("day-note", { note_date: ds, text: text }).then(function () {
      closeModal(); return reload();
    }).then(function () { toast(text.trim() ? "Day note saved" : "Day note cleared"); })
      .catch(function (err) { toast(err.message, true); });
  }
  $("#daynote-save").addEventListener("click", function () { submit($("#daynote-text").value); });
  var clearBtn = $("#daynote-clear");
  if (clearBtn) clearBtn.addEventListener("click", function () { submit(""); });
}
/* In-app confirm dialog (D77) — replaces the browser's confirm() so destructive
   actions get a styled modal. onYes runs after the user confirms. */
function confirmModal(message, onYes, confirmLabel) {
  openModal('<div class="modal-hd"><h2>Are you sure?</h2></div>' +
    '<div class="modal-body"><p style="line-height:1.5;margin:0">' + esc(message) + "</p></div>" +
    '<div class="modal-ft"><span style="flex:1"></span>' +
    '<button class="btn" id="modal-cancel">Cancel</button>' +
    '<button class="btn bad" id="modal-confirm">' + esc(confirmLabel || "Delete") + "</button></div>");
  var btn = $("#modal-confirm");
  if (btn) btn.addEventListener("click", function () { closeModal(); onYes(); });
}
/* Return/Enter accepts whatever a popup's one obvious action is (D194,
   Nate: "make sure that hitting enter or return on all the popup windows
   accepts whatever changes are being made") — a genuine confirmation
   dialog's Yes/Delete/Restore/Revert button by id, or, when none of those
   exist, an add/edit popup's single `.btn.pri` (every one of these popups
   follows the "exactly one primary action" toolbar contract, D171, so
   there's never more than one candidate — except the sort/reorder modal's
   Save A→Z / Save Z→A pair, which stays ambiguous on purpose: with two
   equally "primary" choices, Enter picking one would be a guess, so it
   does nothing there, same as before). Textareas keep Enter for
   themselves (multi-line editing, e.g. the day-note popup, D230) —
   Cmd/Ctrl+Enter still submits from inside one (see the listener right
   below this). Guards key-repeat while an async action closes the
   modal. */
document.addEventListener("keydown", function (e) {
  if (e.key !== "Enter" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.target && e.target.tagName === "TEXTAREA") return;
  var modal = document.querySelector("#modal.on"); if (!modal) return;
  if (modal.dataset.keyConfirming) return;
  var yes = modal.querySelector("#modal-confirm,#confirm-del,#confirm-customer-archive,#history-confirm");
  if (!yes) {
    var primaries = modal.querySelectorAll(".modal-ft .btn.pri");
    if (primaries.length === 1) yes = primaries[0];
  }
  if (!yes || yes.disabled) return;
  e.preventDefault(); e.stopPropagation();
  modal.dataset.keyConfirming = "1"; yes.click();
}, true);
/* Cmd/Ctrl+Enter submits from inside a textarea (D230 follow-up) — plain
   Enter is reserved there for a real newline (see above), but a popup's
   one obvious action should still be reachable without leaving the field.
   Same primary-button resolution as the plain-Enter handler. */
document.addEventListener("keydown", function (e) {
  if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
  if (!e.target || e.target.tagName !== "TEXTAREA") return;
  var modal = document.querySelector("#modal.on"); if (!modal || modal.dataset.keyConfirming) return;
  var yes = modal.querySelector(".modal-ft .btn.pri"); if (!yes || yes.disabled) return;
  e.preventDefault(); e.stopPropagation();
  modal.dataset.keyConfirming = "1"; yes.click();
}, true);
/* Escape exits every popup (D230, Nate: "ensure all popup windows submit
   with enter or return, and exit with escape, thats app wide") — clicks
   the same #modal-cancel/Close button a real click would (every popup has
   exactly one, same D171 contract the Enter handler above relies on), so
   any popup-specific cleanup already wired to that button's click handler
   still runs. Falls back to a bare closeModal() for the rare popup with no
   such button. The in-app document viewer (#viewer) isn't part of the
   #modal system but is the same kind of dismissible overlay, so it gets
   the same treatment. Capture phase + an open-modal/viewer guard so this
   never fires while an ordinary grid Escape (cell/range/row deselect,
   D196) or the drawer's own Escape-to-close (both further down this file)
   would otherwise run instead. */
document.addEventListener("keydown", function (e) {
  if (e.key !== "Escape") return;
  var modal = document.querySelector("#modal.on");
  if (modal) {
    e.preventDefault(); e.stopPropagation();
    var cancel = modal.querySelector("#modal-cancel");
    if (cancel) cancel.click(); else closeModal();
    return;
  }
  var viewer = document.querySelector("#viewer.on");
  if (viewer) { e.preventDefault(); e.stopPropagation(); closeViewer(); }
}, true);
/* Help & FAQ — a profile-menu popup, not a settings tab (its old slot there
   now holds the time card calculator). Reuses settingsHelp()'s same card
   content, just inside a wide modal instead of a nav sub. */
function helpFaqModal() {
  openModal('<div class="modal-hd"><h2>Help &amp; FAQ</h2></div>' +
    '<div class="modal-body">' + settingsHelp() + '</div>' +
    '<div class="modal-ft"><span style="flex:1"></span><button class="btn" id="modal-cancel">Close</button></div>');
  $("#modal").classList.add("wide-modal");
}

/* In-app document viewer (D51) — preview a PDF or image inline instead of
   downloading. Content-Type comes from the server by extension. */
function openViewer(path, name) {
  var v0 = $("#viewer");
  if (!v0) { v0 = document.createElement("div"); v0.id = "viewer"; document.body.appendChild(v0); }
  v0.innerHTML = '<div class="viewer-card"><div class="viewer-hd"><span class="nm">' + esc(name || path) + "</span>" +
    '<button class="btn sm" id="viewer-close">Close</button></div><div class="viewer-body"><div class="empty">Loading…</div></div></div>';
  v0.classList.add("on");
  // Private Storage: the file is only reachable through a short-lived signed URL.
  storedFileUrl(path).then(function (url) { renderViewer(path, name, url); })
    .catch(function (e) { closeViewer(); toast(e.message, true); });
}
function renderViewer(path, name, url) {
  var ext = String(name || path).split(".").pop().toLowerCase();
  var inner = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"].indexOf(ext) >= 0
    ? '<img src="' + url + '" alt="' + esc(name || "") + '">'
    : '<iframe src="' + url + '" title="' + esc(name || "") + '"></iframe>';
  var v = $("#viewer");
  if (!v) { v = document.createElement("div"); v.id = "viewer"; document.body.appendChild(v); }
  v.innerHTML = '<div class="viewer-card"><div class="viewer-hd"><span class="nm">' + esc(name || path) + "</span>" +
    '<a class="btn sm" href="' + url + '" target="_blank" rel="noopener">Open In Tab</a>' +
    '<button class="btn sm" id="viewer-close">Close</button></div>' +
    '<div class="viewer-body">' + inner + "</div></div>";
  v.classList.add("on");
}
function closeViewer() { var v = $("#viewer"); if (v) v.classList.remove("on"); }
function mfield(name, label, type, opts) {
  opts = opts || {};
  var inp;
  if (type === "select")
    inp = '<select data-cf="' + name + '">' + (opts.options || []).map(function (o) {
      return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + "</option>"; }).join("") + "</select>";
  else if (type === "checkbox") inp = '<input type="checkbox" data-cf="' + name + '">';
  else inp = '<input data-cf="' + name + '" type="' + (type || "text") + '" placeholder="' + esc(opts.placeholder || "") +
    '" value="' + esc(opts.value || "") + '">';
  return '<label class="mf' + (type === "checkbox" ? " chk" : "") + '"><span>' + esc(label) + "</span>" + inp + "</label>";
}
/* Custom columns (grid_columns, D47) feed the Add-row popup (D85 Phase 1
   remaining item #1) — a new row can be filled in fully at creation instead of
   forcing a second pass in the grid. Reuses mfield(); a select column's
   options are plain strings so map each to a [value,label] pair. */
function customFieldsHtml(grid) {
  var cols = gridCols(grid);
  if (!cols.length) return "";
  return '<p style="font-size:var(--fs-label);color:var(--ink-2);margin:6px 0 0;border-top:1px solid var(--rule);padding-top:8px">Custom fields</p>' + cols.map(function (c) {
    var type = ["number", "date", "select", "checkbox"].indexOf(c.type) >= 0 ? c.type : "text";
    var opts = type === "select" ? { options: [["", "—"]].concat((c.options || []).map(function (o) { return [o, o]; })) } : {};
    return mfield(c.key, c.label, type, opts);
  }).join("");
}
/* After the base row is created, write any filled-in custom-column values
   (skips blanks — same "empty removes the key" rule as an inline edit). */
function saveCustomFields(grid, table, id, cd) {
  var calls = gridCols(grid).map(function (c) {
    var v = cd[c.key];
    if (v === undefined || v === "" || v === false) return null;
    return api("row/custom", { table: table, id: id, key: c.key, value: c.type === "checkbox" ? "true" : v });
  }).filter(Boolean);
  return Promise.all(calls);
}
function addCustomerModal(kind) {
  var ext = kind === "external", grid = ext ? "external" : "bagger";
  var body = mfield("name", "Name", "text");
  if (ext) {
    body += mfield("rexius_customer_no", "Rexius Customer #", "text") +
      mfield("ap_email", "AP email", "text") + mfield("phone", "Phone", "text") +
      mfield("manager_name", "Contact", "text") + mfield("notes", "Notes", "text");
  } else {
    var timeOptions = [["", "—"]].concat((DB.categories || []).filter(function (c) { return !c.is_off; })
      .map(function (c) { return [c.id, c.name]; }));
    body += mfield("address", fieldLabel("bagger", "address", "Address"), "text") +
      mfield("city", fieldLabel("bagger", "city", "City"), "text") + mfield("state", "State", "text") +
      mfield("category_id", fieldLabel("bagger", "category_id", "Time Window"), "select", { options: timeOptions }) +
      mfield("forklift", fieldLabel("bagger", "forklift", "Forklift"), "text") +
      mfield("standard_miles", fieldLabel("bagger", "standard_miles", "Miles"), "text") +
      mfield("miles_from_umatilla", fieldLabel("bagger", "miles_from_umatilla", "Umatilla Miles"), "text") +
      mfield("phone", fieldLabel("bagger", "phone", "Phone"), "text") +
      mfield("manager_name", fieldLabel("bagger", "manager_name", "Manager"), "text") +
      mfield("notes", fieldLabel("bagger", "notes", "Notes"), "text");
  }
  body += customFieldsHtml(grid);
  openModal('<div class="modal-hd"><h2>' + (ext ? "Add external customer / broker" : "Add bagger customer") +
    "</h2></div><div class=\"modal-body\">" + body + "</div>" +
    '<div class="modal-ft"><button class="btn" id="modal-cancel">Cancel</button>' +
    '<button class="btn pri" id="modal-save" data-custkind="' + kind + '">Add Customer</button></div>');
}

/* Pick/Drop List "Add location" popup (mirrors addCustomerModal) — replaces the
   old inline top-bar inputs so adding a location is a fill-out window like
   Add customer. Fields match the pickdrop grid columns.

   `prefillName` seeds Company name from whatever was already typed into a
   loccombo's search box — used when this opens from a drawer's Pickup/Drop
   or the tracker's own combo instead of the Pick/Drop List's own toolbar
   (Nate: "i need to be able to add locations to my pick and drop list
   right then and there" — a real name/address/phone form on the spot,
   not the old comma-split "+Create" that only ever guessed name/city/state
   from the typed text). `target`, when given, is `{oid, field}` — after the
   location is created, `#modal-save-loc`'s handler also assigns it straight
   onto that order/field, so confirming the popup finishes the pick too. */
function addLocationModal(prefillName, target) {
  MODAL_LOC_TARGET = target || null;
  var body = mfield("name", "Company name", "text", { value: prefillName || "" }) +
    mfield("address", "Address", "text") +
    mfield("city", "City", "text") + mfield("state", "State", "text") +
    mfield("phone", "Phone", "text") +
    mfield("appointment_note", "Appointment / dock hours", "text") +
    mfield("notes", "Notes", "text") + customFieldsHtml("pickdrop");
  openModal('<div class="modal-hd"><h2>Add pick/drop location</h2></div>' +
    '<div class="modal-body">' + body + "</div>" +
    '<div class="modal-ft"><button class="btn" id="modal-cancel">Cancel</button>' +
    '<button class="btn pri" id="modal-save-loc">Add Location</button></div>');
}

/* Add-truck popup (D57) — a fill-out window like the other Database grids,
   replacing the inline toolbar inputs. */
function addTruckModal() {
  var body = mfield("number", "Truck #", "text") +
    mfield("eq", "Type", "text") +
    mfield("driver_name", "Driver", "text") +
    customFieldsHtml("fleet");
  openModal('<div class="modal-hd"><h2>Add truck</h2></div><div class="modal-body">' + body + "</div>" +
    '<div class="modal-ft"><button class="btn" id="modal-cancel">Cancel</button>' +
    '<button class="btn pri" id="modal-save-truck">Add Truck</button></div>');
}

/* Add-department popup (D127 follow-up) — a fill-out window like the other
   Database grids, not the bare inline blank row a generic '+ Row' leaves. */
function addDepartmentModal() {
  var body = mfield("name", "Department", "text") + customFieldsHtml("departments");
  openModal('<div class="modal-hd"><h2>Add department</h2></div><div class="modal-body">' + body + "</div>" +
    '<div class="modal-ft"><button class="btn" id="modal-cancel">Cancel</button>' +
    '<button class="btn pri" id="modal-save-dept">Add Department</button></div>');
}

/* Bulk internal-order reservation (D51, D156, D217) — pick a month + year + a
   starting number + count and reserve a sequential block using the current
   workspace pattern. Order numbers are type-overable now (D156), so
   this is also how Nate bulk-imports a range that doesn't continue from
   whatever's already reserved (off-season manual entry, importing a block
   from elsewhere). "Starting #" prefills to the next free number in that
   MMYY block — the old default — but is a plain editable field. */
function bulkInternalModal() {
  var MONTHS = [["01", "January"], ["02", "February"], ["03", "March"], ["04", "April"],
    ["05", "May"], ["06", "June"], ["07", "July"], ["08", "August"], ["09", "September"],
    ["10", "October"], ["11", "November"], ["12", "December"]];
  var thisMonth = TODAY.slice(5, 7), thisYear = String(YEAR);
  var monthOpts = MONTHS.map(function (m) {
    return '<option value="' + m[0] + '"' + (m[0] === thisMonth ? " selected" : "") + ">" + m[1] + "</option>";
  }).join("");
  var start = nextInternalOrderStart(thisMonth, thisYear);
  var example = formatOrderNumber(orderNumberSettings().internal_pattern, thisMonth, thisYear, start);
  // D233: a start/end range (Nate: "order number start and order number
  // end and it inputs them all in there") reads more naturally against a
  // real Solomon range than a count — the save handler (07-events.js)
  // turns it back into the same {count, start} the endpoint always took.
  var body = '<label class="mf"><span>Month</span><select data-cf="month">' + monthOpts + "</select></label>" +
    '<label class="mf"><span>Year</span><input data-cf="year" type="text" value="' + thisYear + '"></label>' +
    '<label class="mf"><span>Starting #</span><input data-cf="start" type="text" value="' + start + '"></label>' +
    '<label class="mf"><span>Ending #</span><input data-cf="end" type="text" value=""></label>';
  openModal('<div class="modal-hd"><h2>Reserve internal order numbers</h2></div>' +
    '<div class="modal-body"><p style="font-size:var(--fs-body-sm);color:var(--ink-2);margin:0 0 4px">' +
    "Creates a blank, sequential number for every position in the range, beginning with <b>" + esc(example) +
    "</b>. You can tab through them or type over an individual number later.</p>" + body + "</div>" +
    '<div class="modal-ft"><button class="btn" id="modal-cancel">Cancel</button>' +
    '<button class="btn pri" id="int-save-bulk">Reserve Numbers</button></div>');
}

/* Bulk internal-freight add (D158) — Internal Freight transfers have no
   order number to reserve (never Solomon-numbered, never invoiced), so the
   top "+ Add order" button just asks how many blank rows to create at once
   (Nate: "insert 10 or 12 or whatever"). The bottom "+ Add one" quick-add
   (07-events.js) skips this modal entirely and opens the new row's drawer
   right away, same one-at-a-time pattern as Bag Orders' own bottom button. */
function bulkTransferModal() {
  var body = mfield("count", "How many orders", "text");
  openModal('<div class="modal-hd"><h2>Add internal freight orders</h2></div>' +
    '<div class="modal-body"><p style="font-size:var(--fs-body-sm);color:var(--ink-2);margin:0 0 4px">' +
    "Creates that many blank orders to fill in from the tracker.</p>" + body + "</div>" +
    '<div class="modal-ft"><button class="btn" id="modal-cancel">Cancel</button>' +
    '<button class="btn pri" id="xfer-save-bulk">Add Orders</button></div>');
}

/* ── Custom columns / spreadsheet freedom on Database grids (D47) ─────────── */
function gridCols(grid) {
  return (DB.grid_columns || []).filter(function (c) { return c.grid === grid; })
    .sort(function (a, b) { return a.sort_order - b.sort_order; });
}
/* One legacy JSON custom-column header/cell. vBuiltin interleaves these with
   metadata fields in a single draggable spreadsheet order (D96). */
function customThCol(c, grid) {
  return '<th draggable="true" data-colgrid="' + grid + '" data-colref="custom:' + c.id +
    '" data-customcol="' + c.id + '" style="width:' + (c.width || 140) +
    'px;white-space:nowrap" title="Drag to reorder · Right-click for options">' + esc(c.label) + "</th>";
}
function customTdCol(c, table, id, custom) {
  custom = custom || {};
  var v = custom[c.key], a = 'data-cust="' + table + "|" + id + "|" + c.key + '"';
  if (c.type === "select") {
    return '<td><div class="cell"><select class="cell-i" ' + a + '><option value=""></option>' +
      (c.options || []).map(function (o) {
        return "<option" + (String(v) === String(o) ? " selected" : "") + ">" + esc(o) + "</option>";
      }).join("") + "</select></div></td>";
  }
  if (c.type === "checkbox")
    return '<td><div class="cell"><input type="checkbox" ' + a + (v === "true" ? " checked" : "") + "></div></td>";
  var ty = c.type === "number" ? "number" : c.type === "date" ? "date" : "text";
  return '<td><div class="cell"><input class="cell-i" type="' + ty + '" ' + a +
    ' value="' + esc(v == null ? "" : v) + '"></div></td>';
}
/* Excel-style numbered row gutter (D50). The header cell is a select-all/clear
   toggle; each row cell shows its 1-based number and selects on click
   (plain = just this row, ⌘/Ctrl = toggle, Shift = range from the anchor). */
function selTh(grid) {
  return '<th class="rowgut-h" data-selall="' + grid + '" title="Select all / clear">#</th>';
}
function selTd(grid, id, n) {
  var on = (ROWSEL[grid] || []).indexOf(id) >= 0;
  // Row drag-reorder (Nate's ask) — available across every Database grid. The drag
  // target is a small inner grip, NOT the whole numbered cell — an always-
  // draggable td across 270+ rows made the browser hesitate disambiguating
  // scroll-vs-drag-start anywhere in that column, which read as scroll lag.
  // Drag-reorder is meaningless (and confusing to reindex) while a view Sort
  // is active — same reason Airtable/Sheets disable manual drag under a sort.
  if (!GRIDSORT[grid]) {
    return '<td class="rowgut rowdrag' + (on ? " on" : "") + '" data-gridrowid="' + id + '" data-grid="' + grid + '" data-rowsel="' + grid + "|" + id +
      '" title="Click to select · Shift or ⌘ for multiple">' +
      '<span class="rowgrip" draggable="true" data-gridrowid="' + id + '" data-grid="' + grid + '" title="Drag to reorder">&#8942;&#8942;</span>' +
      n + "</td>";
  }
  return '<td class="rowgut' + (on ? " on" : "") + '" data-rowsel="' + grid + "|" + id +
    '" title="Click to select · Shift or ⌘ for multiple">' + n + "</td>";
}
/* Apply the current ROWSEL[grid] to the DOM without a re-render. Shared by
   Database grids (data-delrows) and order trackers (data-orderdelrows /
   data-ordercancelrows, D159) — same selection engine, different bulk
   action buttons wired to it. */
function paintRowSel(grid, scope) {
  var tds = (scope || document).querySelectorAll('[data-rowsel^="' + grid + '|"]');
  [].forEach.call(tds, function (x) {
    var xid = x.dataset.rowsel.split("|")[1], on = (ROWSEL[grid] || []).indexOf(xid) >= 0;
    x.classList.toggle("on", on);
    var tr = x.closest("tr"); if (tr) tr.classList.toggle("rowsel", on);
  });
  var count = (ROWSEL[grid] || []).length;
  var del = document.querySelector('[data-delrows="' + grid + '"]');
  if (del) { del.disabled = !count; del.textContent = count ? "Delete Selected (" + count + ")" : "Delete Selected"; }
  var archive = document.querySelector('[data-archiverows="' + grid + '"]');
  if (archive) {
    var restore = archive.dataset.archiveMode === "restore";
    archive.disabled = !count || !canEdit(SEC, SUB);
    archive.textContent = (restore ? "Restore Selected" : "Archive Selected") +
      (count ? " (" + count + ")" : "");
  }
  var odel = document.querySelector('[data-orderdelrows="' + grid + '"]');
  if (odel) { odel.disabled = !count; odel.textContent = count ? "Delete Selected (" + count + ")" : "Delete Selected"; }
  var ocan = document.querySelector('[data-ordercancelrows="' + grid + '"]');
  if (ocan) { ocan.disabled = !count; ocan.textContent = count ? "Cancel Selected (" + count + ")" : "Cancel Selected"; }
}
/* Order-tracker numbered gutter (D159) — same interaction/state as the
   Database grids' selTh/selTd (D50: click to select, Shift for a range,
   ⌘/Ctrl to toggle one, header cell selects/clears all) but without the
   row-drag-reorder grip, which is meaningless here (trackers have their own
   real sort — order number, or date — not a manual grid_row_orders). */
function trackerSelTh(grid) {
  return '<th class="rowgut-h" data-selall="' + grid + '" title="Select all / clear">#</th>';
}
function trackerSelTd(grid, id, n) {
  var on = (ROWSEL[grid] || []).indexOf(id) >= 0;
  return '<td class="rowgut' + (on ? " on" : "") + '" data-rowsel="' + grid + "|" + id +
    '" title="Click to select · Shift or ⌘ for multiple">' + n + "</td>";
}
/* Bulk Cancel/Delete buttons for an order tracker toolbar (D159) — replaced
   the old per-row Cancel/Delete buttons (destructiveOrderControls,
   04-views.js) and the drawer's own Cancel button (schedBar,
   03-drawer-billing.js), both retired as redundant now that selecting one
   or more rows here does the same job. Uses the exact same eligibility
   guards those used (canCancelOrder/canDeleteOrder) and the same
   confirmModal pattern; wiring is in 07-events.js. */
function trackerBulkButtonsHtml(grid) {
  var n = (ROWSEL[grid] || []).length;
  return '<button class="btn bad sm" data-ordercancelrows="' + grid + '"' + (n ? "" : " disabled") + ">" +
      (n ? "Cancel Selected (" + n + ")" : "Cancel Selected") + "</button>" +
    '<button class="btn bad sm" data-orderdelrows="' + grid + '"' + (n ? "" : " disabled") + ">" +
      (n ? "Delete Selected (" + n + ")" : "Delete Selected") + "</button>";
}
function handleRowSel(td, e) {
  var parts = td.dataset.rowsel.split("|"), grid = parts[0], id = parts[1];
  var table = td.closest("table");
  var ids = [].map.call(table.querySelectorAll('[data-rowsel^="' + grid + '|"]'),
    function (x) { return x.dataset.rowsel.split("|")[1]; });
  var sel = (ROWSEL[grid] || []).slice();
  if (e.shiftKey && ROWSEL_ANCHOR[grid] && ids.indexOf(ROWSEL_ANCHOR[grid]) >= 0) {
    var a = ids.indexOf(ROWSEL_ANCHOR[grid]), b = ids.indexOf(id);
    sel = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
  } else if (e.metaKey || e.ctrlKey) {
    var i = sel.indexOf(id);
    if (i >= 0) sel.splice(i, 1); else sel.push(id);
    ROWSEL_ANCHOR[grid] = id;
  } else {
    if (sel.length === 1 && sel[0] === id) {
      sel = []; ROWSEL_ANCHOR[grid] = null;
    } else {
      sel = [id]; ROWSEL_ANCHOR[grid] = id;
    }
  }
  ROWSEL[grid] = sel;
  paintRowSel(grid, table);
}
/* Click-and-drag gutter range select (D193) — mousedown/mousemove/mouseup
   wiring lives in 07-events.js; this is just the range math + state, shared
   by every `[data-rowsel]` gutter (Database grids and all three order
   trackers). A plain click (no drag) is untouched — it still goes through
   handleRowSel above. */
function rowSelStartDrag(td) {
  var parts = td.dataset.rowsel.split("|"), grid = parts[0], id = parts[1];
  var table = td.closest("table");
  var ids = [].map.call(table.querySelectorAll('[data-rowsel^="' + grid + '|"]'),
    function (x) { return x.dataset.rowsel.split("|")[1]; });
  ROWDRAG = { grid: grid, table: table, ids: ids, startId: id };
  ROWDRAG_MOVED = false;
}
function rowSelDragTo(td) {
  if (!ROWDRAG) return;
  var parts = td.dataset.rowsel.split("|"), grid = parts[0], id = parts[1];
  if (grid !== ROWDRAG.grid || id === ROWDRAG.startId) return;
  ROWDRAG_MOVED = true;
  var a = ROWDRAG.ids.indexOf(ROWDRAG.startId), b = ROWDRAG.ids.indexOf(id);
  if (a < 0 || b < 0) return;
  ROWSEL[ROWDRAG.grid] = ROWDRAG.ids.slice(Math.min(a, b), Math.max(a, b) + 1);
  ROWSEL_ANCHOR[ROWDRAG.grid] = ROWDRAG.startId;
  paintRowSel(ROWDRAG.grid, ROWDRAG.table);
}
function rowSelEndDrag() {
  var moved = ROWDRAG_MOVED;
  ROWDRAG = null; ROWDRAG_MOVED = false;
  return moved;
}
function columnModal(grid, col) {
  var TYPES = [["text", "Text"], ["number", "Number"], ["date", "Date"], ["select", "Dropdown"], ["checkbox", "Checkbox"]];
  var body = mfield("label", "Column name", "text") +
    '<label class="mf"><span>Type</span><select data-cf="type">' +
    TYPES.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + "</option>"; }).join("") + "</select></label>" +
    mfield("options", "Dropdown options (comma-separated)", "text");
  openModal('<div class="modal-hd"><h2>' + (col ? "Edit column" : "Add column") + "</h2></div>" +
    '<div class="modal-body">' + body + "</div>" +
    '<div class="modal-ft">' + (col ? '<button class="btn bad" id="col-delete" data-colid="' + col.id + '">Delete</button>' : "") +
    '<span style="flex:1"></span><button class="btn" id="modal-cancel">Cancel</button>' +
    '<button class="btn pri" id="col-save" data-grid="' + grid + '"' + (col ? ' data-colid="' + col.id + '"' : "") +
    ">" + (col ? "Save" : "Add Column") + "</button></div>");
  if (col) {
    $("#modal [data-cf=label]").value = col.label;
    $("#modal [data-cf=type]").value = col.type;
    $("#modal [data-cf=options]").value = (col.options || []).join(", ");
  }
}

/* ── Custom databases (D85 Phase 2) ─────────────────────────────────────────
   A custom entity has no backing SQL table — its columns ARE `fields` (not
   the legacy grid_columns custom-column system the 4 builtins still ride),
   so it gets its own "+ Field" modal instead of columnModal. */
function customFieldModal(entityId) {
  var TYPES = [["text", "Text"], ["number", "Number"], ["date", "Date"], ["select", "Dropdown"], ["checkbox", "Checkbox"]];
  var body = mfield("label", "Field name", "text") +
    '<label class="mf"><span>Type</span><select data-cf="type">' +
    TYPES.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + "</option>"; }).join("") + "</select></label>" +
    mfield("options", "Dropdown options (comma-separated)", "text");
  openModal('<div class="modal-hd"><h2>Add field</h2></div>' +
    '<div class="modal-body">' + body + "</div>" +
    '<div class="modal-ft"><span style="flex:1"></span><button class="btn" id="modal-cancel">Cancel</button>' +
    '<button class="btn pri" id="field-save" data-entityid="' + entityId + '">Add Field</button></div>');
}
/* "+ New database" popup (next to the sheets "+ New sheet"). On save, jumps
   straight into the new database like "+ New sheet" does. */
function newDatabaseModal() {
  var body = mfield("name", "Database name", "text");
  openModal('<div class="modal-hd"><h2>New database</h2></div>' +
    '<div class="modal-body">' + body + "</div>" +
    '<div class="modal-ft"><button class="btn" id="modal-cancel">Cancel</button>' +
    '<button class="btn pri" id="db-save">Create Database</button></div>');
}

/* ── Manage columns: hide/show + reorder (D85 Phase 1 remaining item #3) ───
   Metadata fields only (built-in typed columns), not the custom grid_columns —
   those already reorder via sort_order on Add/Edit. Up/down instead of drag,
   to keep this a plain list the click delegator can drive. */
function colmgrRowsHtml(entId) {
  var flds = (DB.fields || []).filter(function (f) { return f.entity_id === entId; })
    .sort(function (a, b) { return a.sort_order - b.sort_order; });
  return flds.map(function (f, i) {
    return '<div class="colmgr-row">' +
      '<label class="mf chk" style="flex:1;margin:0"><input type="checkbox" data-colvis="' + f.id + '"' +
        (!f.hidden ? " checked" : "") + '><span>' + esc(f.label) + "</span></label>" +
      '<button class="btn sm" data-colup="' + f.id + '"' + (i === 0 ? " disabled" : "") + ' title="Move up">&uarr;</button>' +
      '<button class="btn sm" data-coldown="' + f.id + '"' + (i === flds.length - 1 ? " disabled" : "") + ' title="Move down">&darr;</button>' +
    "</div>";
  }).join("");
}
function manageColumnsModal(key) {
  var ent = entityForGrid(key);
  if (!ent) return;
  openModal('<div class="modal-hd"><h2>Manage columns</h2></div>' +
    '<div class="modal-body" id="colmgr-body" data-colmgr="' + ent.id + '">' + colmgrRowsHtml(ent.id) + "</div>" +
    '<div class="modal-ft"><span style="flex:1"></span><button class="btn" id="modal-cancel">Done</button></div>');
}
/* Re-renders the column list in place after a hide/reorder so the modal stays
   open — reload()/render() never touch #modal (separate node). */
function refreshColMgr() {
  var host = document.getElementById("colmgr-body");
  if (host) host.innerHTML = colmgrRowsHtml(host.dataset.colmgr);
}

/* ── Per-column conditional formatting (D85 Phase 1 remaining item #2) ─────
   fields.conditional_format = [{op,value,color}], first match wins. Add/
   delete rows are handled locally on the modal node (structural, not worth
   routing through the global delegator); Save reads the DOM at click time,
   same pattern as columnModal's col-save. */
var CONDFMT_OPS = [["eq", "equals"], ["neq", "is not"], ["contains", "contains"],
  ["gt", "is greater than"], ["lt", "is less than"], ["empty", "is empty"], ["not_empty", "is not empty"]];
function condRuleRowHtml(r) {
  r = r || { op: "eq", value: "", color: "#ffe08a" };
  var needsVal = r.op !== "empty" && r.op !== "not_empty";
  return '<div class="colmgr-row" data-rule="1">' +
    '<select class="cell-i" data-ruleop style="width:140px">' +
    CONDFMT_OPS.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === r.op ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") +
    "</select>" +
    '<input class="cell-i" data-ruleval style="width:110px"' + (needsVal ? "" : " disabled") +
    ' value="' + esc(r.value || "") + '">' +
    '<input type="color" class="legcolor" data-rulecolor value="' + esc(colorBase(r.color || "#ffe08a")) + '">' +
    '<input type="text" class="hex-text" data-ruletext value="' + esc(colorBase(r.color || "#ffe08a")) +
      '" maxlength="7" placeholder="#rrggbb" spellcheck="false">' +
    '<label class="rule-opacity">Opacity <input type="range" min="10" max="100" data-ruleopacity value="' + colorOpacity(r.color || "#ffe08a") + '"><output data-ruleopacityvalue>' + colorOpacity(r.color || "#ffe08a") + '%</output></label>' +
    '<button class="btn sm bad" data-ruledel title="Remove rule">&times;</button>' +
  "</div>";
}
function condFmtFieldModal(field) {
  var rules = field.conditional_format || [];
  var body = '<p style="font-size:var(--fs-label);color:var(--ink-2);margin:0 0 6px">First matching rule wins, top to bottom. A manually colored cell always overrides.</p>' +
    '<div id="condfmt-rules">' + rules.map(condRuleRowHtml).join("") + "</div>" +
    '<button class="btn sm" id="condfmt-addrule" style="margin-top:6px">+ Add rule</button>';
  openModal('<div class="modal-hd"><h2>Conditional formatting — ' + esc(field.label) + "</h2></div>" +
    '<div class="modal-body">' + body + "</div>" +
    '<div class="modal-ft"><button class="btn" id="modal-cancel">Cancel</button>' +
    '<span style="flex:1"></span><button class="btn pri" id="condfmt-save" data-fieldid="' + field.id + '">Save</button></div>');
  $("#modal").classList.add("wide-modal");
  var host = $("#condfmt-rules");
  host.addEventListener("click", function (e) {
    var del = e.target.closest("[data-ruledel]");
    if (del) del.closest("[data-rule]").remove();
  });
  host.addEventListener("change", function (e) {
    if (!e.target.matches("[data-ruleop]")) return;
    var row = e.target.closest("[data-rule]"), val = row.querySelector("[data-ruleval]");
    val.disabled = (e.target.value === "empty" || e.target.value === "not_empty");
  });
  host.addEventListener("input", function (e) {
    if (e.target.matches("[data-ruleopacity]")) {
      e.target.closest("[data-rule]").querySelector("[data-ruleopacityvalue]").value = e.target.value + "%";
    } else if (e.target.matches("[data-rulecolor]")) {
      e.target.closest("[data-rule]").querySelector("[data-ruletext]").value = e.target.value;
    } else if (e.target.matches("[data-ruletext]")) {
      var hx = normalizeHex(e.target.value);
      if (hx) e.target.closest("[data-rule]").querySelector("[data-rulecolor]").value = hx;
    }
  });
  $("#condfmt-addrule").addEventListener("click", function () {
    var wrap = document.createElement("div");
    wrap.innerHTML = condRuleRowHtml(null);
    host.appendChild(wrap.firstChild);
  });
}

/* ── Managed dropdown options on a built-in field (D144, D145) ────────────────
   Nate: "i do want the forklift thing to be a dropdown menu i just have no
   way to edit or control that yet." fields.type/options already existed in
   the metadata schema (mirrors the custom-column select type, D85) but
   nothing let a built-in field (Fork, or any other free-typed one) actually
   become one, or let Nate manage the option list afterward. First cut used
   one comma-separated input, matching columnModal/customFieldModal's custom-
   column convention — Nate's follow-up: "each option needs to be its own
   thing it cant be mushed in one line... make it a fill outable entity."
   Rebuilt as one row per option (add/remove), same repeatable-row pattern
   condRuleRowHtml already established for conditional-format rules — not a
   new UI convention, the existing one for "a field needs a managed list."
   An empty list reverts the field to plain `type:'text'`, so this one
   control both makes and unmakes a dropdown. */
/* data-optorig is the value this row started with (blank for a freshly
   added row) — the save handler diffs it against the row's current value
   to tell "renamed this option" from "added a new one" (D146: a rename
   needs every existing row holding the old text migrated to the new text;
   a brand-new option obviously has nothing to migrate). */
function fieldOptionRowHtml(value) {
  return '<div class="colmgr-row" data-optrow="1">' +
    '<input class="cell-i" data-optval data-optorig="' + esc(value || "") + '" style="flex:1" value="' +
      esc(value || "") + '" placeholder="Option">' +
    '<button class="btn sm bad" data-optdel title="Remove option">&times;</button></div>';
}
function fieldOptionsModal(field) {
  var opts = field.options || [];
  var body = '<p style="font-size:var(--fs-label);color:var(--ink-2);margin:0 0 6px">' +
      'One option per row. Remove them all to make this a plain free-typed field again.</p>' +
    '<div id="field-options-rows">' + (opts.length ? opts.map(fieldOptionRowHtml).join("") : fieldOptionRowHtml("")) + "</div>" +
    '<button class="btn sm" id="field-options-addrow" style="margin-top:6px">+ Add option</button>';
  openModal('<div class="modal-hd"><h2>Dropdown options — ' + esc(field.label) + "</h2></div>" +
    '<div class="modal-body">' + body + "</div>" +
    '<div class="modal-ft"><button class="btn" id="modal-cancel">Cancel</button>' +
    '<span style="flex:1"></span><button class="btn pri" id="field-options-save" data-fieldid="' + field.id + '">Save</button></div>');
  var foHost = $("#field-options-rows");
  foHost.addEventListener("click", function (e) {
    var del = e.target.closest("[data-optdel]");
    if (del) del.closest("[data-optrow]").remove();
  });
  $("#field-options-addrow").addEventListener("click", function () {
    var wrap = document.createElement("div");
    wrap.innerHTML = fieldOptionRowHtml("");
    foHost.appendChild(wrap.firstChild);
    foHost.lastElementChild.querySelector("input").focus();
  });
}

/* ── Spreadsheet cell behaviour ──────────────────────────────────────────── */
function selectCell(td) {
  if (SEL) SEL.classList.remove("sel");
  SEL = td; td.classList.add("sel");
  renderFmtBar();
  if (typeof applyPendingFormat === "function") applyPendingFormat();
  if (typeof positionFillHandle === "function") positionFillHandle();
}
function startEdit(td, seed) {
  if (!canEdit(SEC, SUB)) { toast("View-only — you can't edit here.", true); return; }
  if (EDITING) commitEdit();
  EDITING = { td: td };
  td.classList.add("editing");
  var cellState = CELLS[td.dataset.key] || {};
  var cellO = cellState.oid ? order(cellState.oid) : null;
  var cur = td.dataset.field ? td.querySelector(".cell").textContent :
    cellO ? (cellO.driver_note || "") : (cellState.text || "");
  var ta = document.createElement("textarea");
  ta.className = "cell-input";
  ta.value = seed !== undefined ? seed : cur;
  td.appendChild(ta); ta.focus();
  if (seed === undefined) ta.select(); else ta.setSelectionRange(ta.value.length, ta.value.length);
}
function commitEdit() {
  if (!EDITING) return;
  var td = EDITING.td, ta = td.querySelector(".cell-input"), val = ta ? ta.value.trim() : "";
  if (ta) ta.remove();
  td.classList.remove("editing"); EDITING = null;
  if (td.dataset.field) {
    var prevG = td.querySelector(".cell").textContent;
    if (val === prevG) return;
    td.querySelector(".cell").innerHTML = cellDisplayHtml(val);
    var table = td.dataset.table, id = td.dataset.id, field = td.dataset.field;
    gridCellSet(table, id, field, val).then(function () {
      histPush("edit " + field,
        function () { return gridCellSet(table, id, field, prevG); },
        function () { return gridCellSet(table, id, field, val); });
    }).catch(function (e) { toast(e.message, true); });
  } else {
    var key = td.dataset.key;
    var cur = CELLS[key];
    if (cur && cur.oid) {
      // Editing over a placed load writes the order's driver tab note (D140)
      // — the chip and its order placement are otherwise untouched.
      var editOid = cur.oid, editO = order(editOid);
      var prevN = (editO && editO.driver_note) || "";
      if (val === prevN) return;
      driverNoteSet(editOid, key, val).then(function () {
        histPush("edit driver tab note",
          function () { return driverNoteSet(editOid, key, prevN); },
          function () { return driverNoteSet(editOid, key, val); });
      }).catch(function (e) { toast(e.message, true); });
      return;
    }
    var prevT = cur && cur.text != null ? cur.text : "";
    if (val === prevT) return;
    scheduleNote(key, val).then(function () {
      histPush("edit note",
        function () { return scheduleNote(key, prevT); },
        function () { return scheduleNote(key, val); });
    }).catch(function (e) { toast(e.message, true); });
  }
}
function cancelEdit() {
  if (!EDITING) return;
  var ta = EDITING.td.querySelector(".cell-input"); if (ta) ta.remove();
  EDITING.td.classList.remove("editing"); EDITING = null;
}
/* Plain scrollIntoView({inline/block:"nearest"}) doesn't know a sticky
   column/header can visually overlap the cell it just decided was already
   "in view" (found live: arrowing right off the last truck wraps to the
   next row's first truck — Wayne here — and scrollIntoView leaves it
   sitting under the sticky `td.rowhd` date column, cut off at less than
   its normal width, instead of actually scrolling left). Re-checks against
   the real sticky-left (`td.rowhd`, Scheduler/Current Week) and sticky-top
   (`thead`, every grid) bounds via actual measured rects and nudges
   `scrollLeft`/`scrollTop` to clear them — a no-op wherever a grid has
   neither. */
function revealCell(td) {
  td.scrollIntoView({ block: "nearest", inline: "nearest" });
  var container = td.closest(".grid-wrap"); if (!container) return;
  var tr = td.closest("tr");
  var stickyLeft = tr && tr.querySelector("td.rowhd");
  var stickyTop = container.querySelector("thead");
  var cRect = container.getBoundingClientRect(), tRect = td.getBoundingClientRect();
  var leftBound = cRect.left + (stickyLeft ? stickyLeft.getBoundingClientRect().width : 0);
  var topBound = cRect.top + (stickyTop ? stickyTop.getBoundingClientRect().height : 0);
  if (tRect.left < leftBound) container.scrollLeft -= (leftBound - tRect.left);
  else if (tRect.right > cRect.right) container.scrollLeft += (tRect.right - cRect.right);
  if (tRect.top < topBound) container.scrollTop -= (topBound - tRect.top);
  else if (tRect.bottom > cRect.bottom) container.scrollTop += (tRect.bottom - cRect.bottom);
}
function move(dr, dc) {
  if (!SEL) return;
  var tr = SEL.closest("tr"), tbl = SEL.closest("table");
  var cells = [].slice.call(tr.querySelectorAll("td[data-key]")), ci = cells.indexOf(SEL);
  if (dc) {
    var t = cells[ci + dc];
    if (t) { selectCell(t); revealCell(t); return; }
    dr = dc > 0 ? 1 : -1; ci = dc > 0 ? -1 : 99;
  }
  if (dr) {
    var rows = [].slice.call(tbl.querySelectorAll("tr")), ri = rows.indexOf(tr);
    for (var i = ri + dr; i >= 0 && i < rows.length; i += dr) {
      var rc = rows[i].querySelectorAll("td[data-key]");
      if (!rc.length) continue;
      var idx = ci === -1 ? 0 : ci === 99 ? rc.length - 1 : Math.min(ci, rc.length - 1);
      selectCell(rc[idx]); revealCell(rc[idx]);
      return;
    }
  }
}
document.addEventListener("mousedown", function (e) {
  var td = e.target.closest("td[data-key]");
  if (!td) { if (EDITING && !e.target.closest(".cell-input")) commitEdit(); return; }
  if (EDITING && EDITING.td !== td) commitEdit();
  if (e.target.closest(".chip")) return;
  selectCell(td);
});
document.addEventListener("dblclick", function (e) {
  var td = e.target.closest("td[data-key]"); if (td) startEdit(td);
});
/* Build a clear op for one selected cell (or null if it's already empty). Returns
   { do, undo } so a whole selection clears as ONE undo step (D83). Handles grid/
   sheet cells (data-field), placed loads (unschedule to staging), and note cells. */
function clearCellOp(td) {
  if (!td || !td.dataset) return null;
  if (td.dataset.field) {
    var cell = td.querySelector(".cell"), prev = cell ? cell.textContent : "";
    if (prev === "") return null;
    var table = td.dataset.table, id = td.dataset.id, field = td.dataset.field;
    return { do: function () { return gridCellSet(table, id, field, "").then(function (row) { if (cell) cell.innerHTML = cellDisplayHtml(""); return row; }); },
             undo: function () { return gridCellSet(table, id, field, prev).then(function (row) { if (cell) cell.innerHTML = cellDisplayHtml(prev); return row; }); } };
  }
  var k = td.dataset.key, cur = CELLS[k];
  if (cur && cur.oid) { var oid = cur.oid;
    return { do: function () { return moveLoad(oid, k, "STAGE"); },
             undo: function () { return moveLoad(oid, "STAGE", k); } }; }
  if (cur && cur.text != null && cur.text !== "") { var t = cur.text;
    return { do: function () { return scheduleNote(k, ""); },
             undo: function () { return scheduleNote(k, t); } }; }
  return null;
}
/* The value a fill-handle drag (D118) copies out of its source cell — same
   two value shapes clearCellOp reads (a data-field grid cell's text, or a
   scheduler/Current-Week note's text). A placed load has no value shape here;
   fillSourceTd() (10-select.js) already refuses to source a drag from one. */
function fillValueOf(td) {
  if (td.dataset.field) { var c = td.querySelector(".cell"); return c ? c.textContent : ""; }
  var cv = CELLS[td.dataset.key];
  return (cv && cv.text != null) ? cv.text : "";
}
/* Build a fill op for one target cell (or null if it already holds that
   value) — same { do, undo } shape as clearCellOp, so a whole drag commits as
   ONE undo step. Unlike clearCellOp's field branch, this updates the visible
   cell text itself rather than relying on a later re-render, since a fill
   drag should look correct the instant it lands. Never overwrites a placed
   load chip — targets are already pre-filtered, this is a second guard. */
function fillCellOp(td, val) {
  if (!td || !td.dataset) return null;
  if (td.dataset.field) {
    var cell = td.querySelector(".cell"), prev = cell ? cell.textContent : "";
    if (prev === val) return null;
    var table = td.dataset.table, id = td.dataset.id, field = td.dataset.field;
    // DOM text updates AFTER the server confirms, not before — a fill/paste
    // spanning a numeric or constrained column (e.g. standard_miles,
    // forklift's NF/forklift/spyder check) 500s server-side since this
    // generic value-cell system has no field-type awareness. Mutating the
    // cell text first left the screen showing a value the DB had actually
    // rejected. See commitCellOps for how a mixed-success batch is handled.
    return { do: function () { return gridCellSet(table, id, field, val).then(function (row) { if (cell) cell.innerHTML = cellDisplayHtml(val); return row; }); },
             undo: function () { return gridCellSet(table, id, field, prev).then(function (row) { if (cell) cell.innerHTML = cellDisplayHtml(prev); return row; }); } };
  }
  var k = td.dataset.key, cur = CELLS[k];
  if (cur && cur.oid) return null;
  var prevT = cur && cur.text != null ? cur.text : "";
  if (prevT === val) return null;
  return { do: function () { return scheduleNote(k, val); },
           undo: function () { return scheduleNote(k, prevT); } };
}
/* Commit a batch of fill/paste ops (D118/D120) tolerating partial failure —
   a mixed-type selection means some cells can genuinely reject the pasted
   value server-side while others accept it fine. Promise.all's all-or-
   nothing behavior meant ONE rejected cell silently dropped the undo record
   for every cell that DID succeed, leaving real, already-committed changes
   with no way back. Only the successful ops go into histPush; failures are
   reported but not retried. */
function commitCellOps(ops, verb, pastVerb) {
  if (!ops.length) return;
  if (!canEdit(SEC, SUB)) { toast("View-only — you can't edit here.", true); return; }
  Promise.allSettled(ops.map(function (o) { return o.do().then(function () { return o; }); }))
    .then(function (results) {
      var okOps = [], failed = 0;
      results.forEach(function (r) { if (r.status === "fulfilled") okOps.push(r.value); else failed++; });
      var n = okOps.length, plural = n === 1 ? "" : "s";
      if (okOps.length) {
        histPush(verb + " " + n + " cell" + plural,
          function () { return Promise.all(okOps.map(function (o) { return o.undo(); })); },
          function () { return Promise.all(okOps.map(function (o) { return o.do(); })); });
      }
      if (failed) {
        toast(failed + " cell" + (failed > 1 ? "s" : "") + " couldn't take that value" +
          (n ? " — the other " + n + " went through and can be undone" : ""), true);
      } else {
        toast(pastVerb + " " + n + " cell" + plural);
      }
    });
}
/* Delete the current selection — the whole marquee if there is one, else the
   single selected cell. One undoable step; empties are skipped (D83). */
function deleteSelection() {
  if (!canEdit(SEC, SUB)) { toast("View-only — you can't edit here.", true); return; }
  var els = (typeof SELSET !== "undefined" && SELSET.length) ? SELSET.slice() : (SEL ? [SEL] : []);
  var ops = els.map(clearCellOp).filter(Boolean);
  if (!ops.length) return;
  function execute() {
    Promise.all(ops.map(function (o) { return o.do(); })).then(function () {
      histPush("clear " + ops.length + " cell" + (ops.length > 1 ? "s" : ""),
        function () { return Promise.all(ops.map(function (o) { return o.undo(); })); },
        function () { return Promise.all(ops.map(function (o) { return o.do(); })); });
    }).catch(function (e) { toast(e.message, true); });
  }
  var cut = histCutoff();
  var historicalLoads = els.some(function (td) {
    var k = td && td.dataset && td.dataset.key, cv = k && CELLS[k];
    return !!(cv && cv.oid && scheduleDateOf(k) < cut);
  });
  if (historicalLoads) confirmModal("This removes a load from a past day and changes schedule history. Continue?", execute, "Change history");
  else execute();
}
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && DRAWER_OID && !EDITING) { closeDrawer(); return; }
  if (EDITING) {
    if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
    else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitEdit(); move(1, 0); }
    else if (e.key === "Tab") { e.preventDefault(); commitEdit(); move(0, e.shiftKey ? -1 : 1); }
    return;
  }
  if (DRAWER_OID) return;
  // A Database/sheet grid's dropdown and combo cells (select.cell-i/
  // input.cell-i, D144/D160) are real, always-live form controls sitting
  // directly inside a normal td[data-key] — unlike a plain text cell, which
  // only gets a native <textarea> during startEdit(). Left to the blanket
  // guard below, Tab on one of those falls through to the browser's native
  // tab order, which only ever visits focusable elements: it skips every
  // plain cell and jumps straight to the next focusable .cell-i (usually
  // another dropdown), while SEL/.sel stays frozen on the old cell — two
  // cells end up looking selected at once, and repeated Tabs just cycle
  // through dropdowns instead of the whole row (Nate, live). Keep Tab
  // driving the same SEL-based move() every other cell uses; blur() just
  // clears the stray native focus ring, SEL already points at this td from
  // the mousedown that focused it. Real non-grid inputs (modals, drawer
  // fields, search) aren't inside a td[data-key] and fall through to the
  // blanket guard below untouched.
  if (e.key === "Tab" && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") &&
      e.target.closest("td[data-key]")) {
    e.preventDefault(); e.target.blur(); move(0, e.shiftKey ? -1 : 1); return;
  }
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  // Delete/Backspace must work over a multi-cell marquee (SELSET), not just a
  // single selected cell — checked here, before the SEL-only guard below.
  // deleteSelection() itself always handled SELSET ("clears the whole
  // marquee if there is one, else SEL", D83) but this listener required SEL
  // to even reach the switch, so a real shift-click/marquee range's Delete
  // silently no-opped — caught live testing D119 (single-cell delete worked,
  // a selected range didn't).
  var hasGridSel = SEL || (typeof SELSET !== "undefined" && SELSET.length);
  if ((e.key === "Delete" || e.key === "Backspace") && hasGridSel) {
    e.preventDefault(); deleteSelection(); return;
  }
  // Copy/paste (D120) — same SEL-or-SELSET reach as Delete above, not just a
  // single cell. Only over a grid selection, so real text copy/paste (e.g.
  // inside an input elsewhere) is never touched — EDITING already returned
  // above, and the INPUT/SELECT check above that covers everything else.
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c" && hasGridSel) {
    e.preventDefault(); copySelection(); return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v" && hasGridSel) {
    e.preventDefault(); pasteSelection(); return;
  }
  if (e.key === "Escape") {
    // Deselect whatever's selected (D196, Nate: "id like to make it to
    // where hitting escape deselects the selection") — the marquee/single-
    // cell selection (SEL/SELSET, via the existing clearMulti()) and every
    // grid's numbered-gutter row selection (ROWSEL), which clearMulti()
    // doesn't touch since it's a separate selection concept (D159). Cheap
    // DOM-only patches either way — no render().
    if (typeof clearCopyHighlight === "function") clearCopyHighlight();
    clearMulti();
    Object.keys(ROWSEL).forEach(function (g) {
      if ((ROWSEL[g] || []).length) { ROWSEL[g] = []; paintRowSel(g, document); }
    });
    return;
  }
  if (!SEL) return;
  switch (e.key) {
    case "ArrowUp": e.preventDefault(); move(-1, 0); break;
    case "ArrowDown": e.preventDefault(); move(1, 0); break;
    case "ArrowLeft": e.preventDefault(); move(0, -1); break;
    case "ArrowRight": e.preventDefault(); move(0, 1); break;
    case "Tab": e.preventDefault(); move(0, e.shiftKey ? -1 : 1); break;
    case "Enter": case "F2": e.preventDefault(); startEdit(SEL); break;
    default:
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); startEdit(SEL, e.key); }
  }
});

/* ── Rate con → order ────────────────────────────────────────────────────── */
function ingestRateCon(file) {
  toast("Reading rate con…");
  return fileB64(file).then(function (b64) {
    return pdfText(b64).then(function (text) {
      var thin = text.replace(/\s/g, "").length < 40;
      var ocrUsed = false;
      var textReady = !thin ? Promise.resolve(text) : ocrPdf(b64, function (n, total) {
        toast("OCR page " + n + " of " + total + "…");
      }).then(function (ocrText) {
        if (ocrText.replace(/\s/g, "").length >= 20) { ocrUsed = true; return ocrText; }
        return text; // OCR found nothing usable — fall through to filename matching
      });
      return textReady.then(function (finalText) {
        var p = parseRateCon(finalText, file.name);
        var scanned = finalText.replace(/\s/g, "").length < 40;
        return api("order/ingest", {
          kind: "external", broker_name: p.broker, broker_load_no: p.load_no,
          solomon_order_no: p.solomon, po_number: p.po, filename: file.name,
          notes: p.rate ? "Rate con rate: $" + p.rate.toFixed(2) : ""
        }).then(function (o) {
          return api("document", {
            order_id: o.id, doc_type: "rate_con", filename: file.name, b64: b64,
            extracted_fields: p, matched_by: scanned ? "filename" : "document_text"
          }).then(function () { return { o: o, p: p, scanned: scanned, ocrUsed: ocrUsed }; });
        });
      });
    });
  }).then(function (r) {
    // Fill in a genuinely BLANK pickup/delivery from what the rate con
    // extracted, adding it to the Pick/Drop List along the way — never
    // touches a field the order already has real data in.
    return Promise.all([
      !r.o.pickup_location_id ? resolveStopToLocationId(r.p.pickup) : Promise.resolve(null),
      !r.o.delivery_location_id ? resolveStopToLocationId(r.p.delivery) : Promise.resolve(null)
    ]).then(function (ids) {
      var body = {};
      if (ids[0]) body.pickup_location_id = ids[0];
      if (ids[1]) body.delivery_location_id = ids[1];
      return Object.keys(body).length ? api("order/update", Object.assign({ id: r.o.id }, body)) : null;
    }).then(function () { return r; });
  }).then(function (r) {
    return reload().then(function () {
      openOrder(r.o.id);
      if (r.o._match && r.o._match !== "created") {
        toast("Matched to existing order " + (r.o.solomon_order_no || r.o.broker_load_no || "") +
          " (" + r.o._match.replace("_", " ") + ") — rate con attached.");
      } else {
        var multiDetected = (r.p.stops || []).filter(function (s) { return s.stop_type === "pickup"; }).length > 1 ||
          (r.p.stops || []).filter(function (s) { return s.stop_type === "delivery"; }).length > 1;
        toast(multiDetected ? "Possible multi-stop route detected — use Edit full route to review it."
          : r.ocrUsed
          ? "OCR read the scanned rate con (" + (r.p.source.join(", ") || "check the fields") + ")"
          : r.scanned
            ? "Scanned rate con — OCR found nothing usable, matched on filename. Check the fields."
            : "Order created from rate con (" + (r.p.source.join(", ") || "nothing matched") + ")");
      }
    });
  }).catch(function (e) { toast("Rate con failed: " + e.message, true); });
}

/* A loose document (POD, BOL, single invoice, etc.) — extract just enough to
   match it to an existing order (D7), else it lands in the unmatched queue
   (Phase 4). Unlike a rate con, this never creates an order. */
function guessDocType(name) {
  var n = (name || "").toLowerCase();
  if (/\b(pod|bol|delivery)\b/.test(n)) return "pod";
  if (/\b(inv|invoice)\b/.test(n)) return "invoice";
  if (/\brate|ratecon|rate.?con\b/.test(n)) return "rate_con";
  return "other";
}
function ingestLoose(file) {
  toast("Reading document…");
  return fileB64(file).then(function (b64) {
    return pdfText(b64).then(function (text) {
      var p = parseRateCon(text, file.name); // reuse extraction just for the match keys
      return api("document", {
        doc_type: guessDocType(file.name), filename: file.name, b64: b64,
        extracted_fields: { solomon: p.solomon, load_no: p.load_no }
      });
    });
  }).then(function (doc) {
    return reload().then(function () {
      if (doc.order_id) { openOrder(doc.order_id); toast("Matched to an order (" + (doc.matched_by || "") + ")"); }
      else { render(); toast("No match — parked in the unmatched queue below.", true); }
    });
  }).catch(function (e) { toast("Document failed: " + e.message, true); });
}

/* ── Invoice batch split — ported from legacy :2341 ──────────────────────── */
function ingestBatch(file) {
  toast("Splitting batch…");
  return file.arrayBuffer().then(function (buf) {
    return PDFLib.PDFDocument.load(buf).then(function (pdf) {
      var total = pdf.getPageCount();
      if (total % 2 !== 0) throw new Error("Batch has " + total + " pages — expected an even number (2 per invoice).");
      var count = total / 2, offset = POOL.length, jobs = [];
      for (var i = 0; i < count; i++) {
        jobs.push((function (idx) {
          return PDFLib.PDFDocument.create().then(function (doc) {
            return doc.copyPages(pdf, [idx * 2]).then(function (pgs) {
              doc.addPage(pgs[0]);
              return doc.save().then(function (bytes) {
                return { b64: b64FromBytes(bytes), label: "Invoice " + (offset + idx + 1),
                         invoiceNum: null, scanning: true, used: false };
              });
            });
          });
        })(i));
      }
      return Promise.all(jobs).then(function (pills) {
        POOL = POOL.concat(pills); render();
        toast("Split into " + count + " invoice" + (count !== 1 ? "s" : "") + " — drag each onto an order.");
        pills.forEach(function (pill) {
          extractInvoiceInfo(pill.b64).then(function (info) {
            pill.scanning = false;
            pill.invoiceNum = info.invoiceNum || null;
            pill.solomon = info.solomon || null;
            if (pill.solomon) pill.label = pill.solomon;
            else if (pill.invoiceNum) pill.label = "#" + pill.invoiceNum;
            render();
          }).catch(function () { pill.scanning = false; render(); });
        });
      });
    });
  }).catch(function (e) { toast("Split failed: " + e.message, true); });
}
function assignInvoice(poolIdx, orderId) {
  var p = POOL[poolIdx]; if (!p || p.used) return;
  api("document", { order_id: orderId, doc_type: "invoice",
                    filename: (p.invoiceNum ? "Invoice_" + p.invoiceNum : p.label) + ".pdf",
                    b64: p.b64, extracted_fields: { invoiceNum: p.invoiceNum, solomon: p.solomon },
                    matched_by: p.solomon ? "solomon_order_no" : "manual" })
    .then(function () { p.used = true; return reload(); })
    .then(function () { toast("Invoice attached"); })
    .catch(function (e) { toast(e.message, true); });
}
/* Group merge — ported from legacy :3090, including the multi-broker guard. */
function groupMerge() {
  if (GROUP.length < 2) { toast("Tick at least two orders to group.", true); return; }
  var os = GROUP.map(order).filter(Boolean);
  var keys = {};
  os.forEach(function (o) { keys[normBroker(buildChip(o).title)] = 1; });
  if (Object.keys(keys).length > 1) {
    toast("Those orders are for different customers — a grouped package can only go to one. Group one at a time.", true);
    return;
  }
  var all = [];
  os.forEach(function (o) { packageDocs(o.id).forEach(function (d) { all.push(d); }); });
  if (!all.length) { toast("No documents to merge.", true); return; }
  toast("Merging " + all.length + " documents from " + os.length + " orders…");
  Promise.all(all.map(fetchDocB64)).then(mergePdfs).then(function (m) {
    var nm = normBroker(buildChip(os[0]).title).replace(/\s+/g, "") || "Group";
    saveBlob(nm + "_grouped_" + os.length + "orders.pdf", bytesFromB64(m));
    toast("Grouped package downloaded — " + os.length + " orders, " + all.length + " documents");
  }).catch(function (e) { toast("Group merge failed: " + e.message, true); });
}
/* ═══ 07-events ═══ */
/* ── Events ──────────────────────────────────────────────────────────────── */
/* Inline-rename an element's text with an input; onSave(newValue) fires on a
   real change (D75/D85). Shared by sheet tabs, database tabs, and column
   headers. `onCancel` (default: the global render()) restores the host on
   Escape or a no-change blur. */
function inlineRename(host, current, onSave, onCancel) {
  onCancel = onCancel || render;
  var inp = document.createElement("input");
  inp.className = "sub-rename"; inp.value = current;
  host.textContent = ""; host.appendChild(inp); inp.focus(); inp.select();
  var done = false;
  function commit(save) {
    if (done) return; done = true;
    var v = inp.value.trim();
    if (save && v && v !== current) onSave(v); else onCancel();
  }
  inp.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") { ev.preventDefault(); commit(true); }
    else if (ev.key === "Escape") { ev.preventDefault(); commit(false); }
    ev.stopPropagation();
  });
  inp.addEventListener("blur", function () { commit(true); });
  inp.addEventListener("click", function (ev) { ev.stopPropagation(); });
}
/* One-click order creation, shared by their tracker toolbar buttons
   (#int-add/#xfer-add below) and the "New bag order"/"New internal freight
   order" keyboard shortcuts (D231, runShortcut in 01-core.js) — same logic
   either way, so a shortcut behaves exactly like clicking the button on
   that tracker's own toolbar. External's equivalent ("New external order",
   #new-order) stays inline where it's only ever one call site. */
function addBagOrderNumber() {
  // The monthly breakout is gone (D233) — Bag Orders is a flat, year-scoped
  // list now, so a quick "+ Add one" just reserves the next number for
  // today's real-world month under whichever year the picker is on (same
  // YEAR-picker-scoped behavior the old month-group version already had).
  return api("internal-order", { month: TODAY.slice(5, 7) + String(YEAR) })
    .then(reload).then(function () { toast("Order number reserved"); })
    .catch(function (err) { toast(err.message, true); });
}
function addTransferOrder() {
  return api("order/transfer", {}).then(function (r) {
    var o = r.orders[0];
    return reload().then(function () { openOrder(o.id); toast("New transfer — fill it in"); });
  }).catch(function (err) { toast(err.message, true); });
}
/* Double-click to rename: sheet tabs (D75), built-in database tabs (entities),
   and Database column headers (fields) — the last two via the metadata core
   (D85). Database tabs returned in-page in D202. */
document.addEventListener("dblclick", function (e) {
  var sheetTab = e.target.closest('.sub-tab[data-sub^="sheet:"]');
  if (sheetTab) {
    var sid = sheetTab.dataset.sub.slice(6), sh = sheetById(sid); if (!sh) return;
    e.preventDefault();
    inlineRename(sheetTab, sh.name, function (v) { api("sheet", { id: sid, name: v }).then(reload).catch(function (err) { toast(err.message, true); }); });
    return;
  }
  var dbTab = e.target.closest(".sub-tab[data-sub]");
  if (dbTab && SEC === "database" && entityByKey(dbTab.dataset.sub)) {
    var ent = entityByKey(dbTab.dataset.sub);
    e.preventDefault();
    inlineRename(dbTab, ent.name, function (v) { ent.name = v; render(); api("entity/update", { id: ent.id, name: v }).catch(function (err) { toast(err.message, true); }); });
    return;
  }
  var th = e.target.closest("th[data-fieldid]");
  if (th) {
    var fld = (DB.fields || []).filter(function (f) { return f.id === th.dataset.fieldid; })[0]; if (!fld) return;
    e.preventDefault();
    inlineRename(th, fld.label, function (v) {
      var old = fld.label;
      fieldMetaSet(fld.id, { label: v }).then(function () {
        histPush("rename column",
          function () { return fieldMetaSet(fld.id, { label: old }); },
          function () { return fieldMetaSet(fld.id, { label: v }); });
      }).catch(function (err) { toast(err.message, true); });
    });
    return;
  }
});
/* Fleet color chip → the toolbar's Sheets color picker (D85), writing drivers.color. */
document.addEventListener("click", function (e) {
  var chip = e.target.closest("[data-colorchip]"); if (!chip) return;
  var driverId = chip.dataset.colorchip, r = chip.getBoundingClientRect();
  var current = "#888888";
  DB.trucks.forEach(function (t) { if (t.driver_id === driverId && t.driver_color) current = t.driver_color; });
  openSheetsPicker(r.left, r.bottom + 4, function (hex) {
    var col = hex || "#888888";
    api("row", { table: "drivers", id: driverId, values: { color: col } }).then(function () {
      DB.trucks.forEach(function (t) { if (t.driver_id === driverId) t.driver_color = col; });
      render();
    }).catch(function (err) { toast(err.message, true); });
  }, current, true);
});
/* Generic column-backed color chip (D127 follow-up #2) — same picker as
   Fleet's driver color, keyed by table|id|field instead of a driver-id
   indirection. Today just Internal Freight's per-department chip color. */
document.addEventListener("click", function (e) {
  var gchip = e.target.closest("[data-colorchip-generic]"); if (!gchip) return;
  var gparts = gchip.dataset.colorchipGeneric.split("|"), gtable = gparts[0], gid = gparts[1], gfield = gparts[2];
  var gr = gchip.getBoundingClientRect(), gcurrent = gchip.textContent.trim() || "#888888";
  openSheetsPicker(gr.left, gr.bottom + 4, function (hex) {
    var gcol = hex || "#888888";
    var gvals = {}; gvals[gfield] = gcol;
    api("row", { table: gtable, id: gid, values: gvals }).then(function (row) {
      patchLocalRow(gtable, gid, row); render();
    }).catch(function (err) { toast(err.message, true); });
  }, gcurrent, true);
});
/* Drag a column-header border to resize it — Database grids are spreadsheets (D85).
   Writes the new width to the field metadata (persists). */
document.addEventListener("pointerdown", function (e) {
  var handle = e.target.closest(".col-resize"); if (!handle) return;
  var th = handle.closest("th[data-fieldid]"); if (!th) return;
  e.preventDefault(); e.stopPropagation();
  var fld = (DB.fields || []).filter(function (f) { return f.id === th.dataset.fieldid; })[0];
  var tbl = th.closest("table");
  var startX = e.clientX, oldW = fld && fld.width || Math.round(th.getBoundingClientRect().width);
  var startW = th.getBoundingClientRect().width, tblW = tbl ? tbl.getBoundingClientRect().width : 0, w = startW;
  document.body.style.cursor = "col-resize";
  function mv(ev) {
    var d = ev.clientX - startX; w = Math.max(48, Math.round(startW + d));
    th.style.width = w + "px";
    if (tbl) tbl.style.width = Math.round(tblW + (w - startW)) + "px";   // grow the table, not the neighbours
  }
  function up() {
    document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up);
    document.body.style.cursor = "";
    if (Math.round(oldW) === w) { render(); return; }
    fieldMetaSet(th.dataset.fieldid, { width: w }).then(function () {
      histPush("resize column",
        function () { return fieldMetaSet(th.dataset.fieldid, { width: oldW }); },
        function () { return fieldMetaSet(th.dataset.fieldid, { width: w }); });
    }).catch(function (err) { toast(err.message, true); });
  }
  document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up);
});
/* Click-and-drag numbered-gutter range select (D193, Nate: "i cant drag and
   select mroe than one order in the orders tab i need that fixed"). Only a
   plain (no-modifier) mousedown arms it — Shift/Cmd/Ctrl+click keep going
   through the existing click-only handleRowSel path untouched. Skips the
   Database grid's row-reorder grip (.rowgrip, a separate HTML5 drag) so the
   two mousedown-driven gestures on that same gutter cell don't collide. */
document.addEventListener("mousedown", function (e) {
  var td = e.target.closest && e.target.closest("[data-rowsel]");
  if (!td || e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey) return;
  if (e.target.closest(".rowgrip")) return;
  rowSelStartDrag(td);
});
document.addEventListener("mousemove", function (e) {
  if (!ROWDRAG) return;
  if (e.buttons !== 1) { rowSelEndDrag(); return; }
  var td = e.target.closest && e.target.closest("[data-rowsel]");
  if (td) rowSelDragTo(td);
});
document.addEventListener("mouseup", function () {
  if (ROWDRAG) ROWSEL_SUPPRESS_CLICK = rowSelEndDrag();
});
document.addEventListener("click", function (e) {
  /* In-app document viewer (D51): open on a View button, close on the button
     or backdrop. */
  var vw = e.target.closest("[data-viewpath]");
  if (vw) { openViewer(vw.dataset.viewpath, vw.dataset.viewname); return; }
  if (e.target.id === "viewer" || e.target.id === "viewer-close") { closeViewer(); return; }
  /* Modal backdrop click closes it. #modal now sits above #scrim (D46 z-index
     bug: the scrim covered the card and ate every click), so clicking the dim
     area around the card lands on #modal itself, not the scrim. */
  if (e.target.id === "modal") { closeModal(); return; }
  /* A chip click opens the drawer, from anywhere it appears — Scheduler,
     Current Week, Driver Tabs, or the staging rail (D137 follow-up: every
     view onto a load is now click-to-edit-consistent, not just the two
     that happen to share literal chip markup). A real drag-and-drop never
     fires a click for the dragged element (standard HTML5 D&D behavior),
     so this doesn't fight click-to-drag. Explicitly `.dv-cell[data-oid]`,
     not a bare `[data-oid]` — the drawer's own carrier-name/location-combo
     inputs also carry data-oid, and a generic match would re-open the
     drawer that's already open around them while typing. */
  var chip = e.target.closest(".chip[data-oid]") || e.target.closest(".dv-cell[data-oid]");
  if (chip) { openOrder(chip.dataset.oid); return; }
  /* Mileage/transfer cells are controls, including their empty padding. Clicking
     anywhere in one focuses its input instead of treating it as a row-open. */
  var freightCell = e.target.closest("[data-frcell]");
  if (freightCell) {
    var freightInput = freightCell.querySelector("input[data-frorder]");
    if (freightInput && e.target !== freightInput && !e.target.closest("button")) freightInput.focus();
    if (!e.target.closest("button")) return;
  }
  /* Non-tracker order rows retain D43 whole-row open. The three editable order
     trackers now have a dedicated Open column (D211), so their cells do exactly
     one job: edit/select, or run their explicit workflow button. */
  var rowo = e.target.closest("[data-roworder]");
  if (rowo && !rowo.closest("table.order-tracker") &&
      !e.target.closest("input,select,button,a,textarea,option,label,.loccombo,[data-frcell],[data-rowsel]")) {
    openOrder(rowo.dataset.roworder); return;
  }
  /* Excel-style row gutter selection (D50) — handled before the generic
     delegator so it never falls through to cell editing. If a drag-select
     (D193, below) just ran across this same click, its range is already
     right — skip the plain-click logic instead of collapsing it back to a
     single row. */
  var gut = e.target.closest("[data-rowsel]");
  if (gut) {
    e.preventDefault();
    if (ROWSEL_SUPPRESS_CLICK) { ROWSEL_SUPPRESS_CLICK = false; return; }
    handleRowSel(gut, e);
    return;
  }
  var dbcol = e.target.closest("th[data-colref]");
  if (dbcol && !e.target.closest(".col-resize")) { toggleDatabaseColumn(dbcol); return; }
  var dvp = e.target.closest("[data-dvpick]");
  if (dvp) { DRIVER_VIEW = dvp.dataset.dvpick; render(); return; }
  var sp = e.target.closest("[data-setpref]");
  if (sp) { setPref(sp.dataset.setpref, sp.dataset.val); render(); return; }
  var sall = e.target.closest("[data-selall]");
  if (sall) {
    e.preventDefault();
    var g = sall.dataset.selall, table = sall.closest("table");
    var allIds = [].map.call(table.querySelectorAll('[data-rowsel^="' + g + '|"]'),
      function (x) { return x.dataset.rowsel.split("|")[1]; });
    var cur = ROWSEL[g] || [];
    ROWSEL[g] = cur.length === allIds.length ? [] : allIds;
    paintRowSel(g, table); return;
  }
  var t = e.target.closest("[data-sec],[data-sub],[data-stage],[data-report],[data-open],[data-pkgrow],[data-route-edit]," +
    "[data-pkg],[data-nodelivery],[data-restore-order],[data-tracker-collapse],[data-tracker-collapse-more]," +
    "[data-copy-order],[data-addcust],[data-addcol]," +
    "[data-addrow],[data-delrows],[data-archiverows],[data-archiveview],[data-orderdelrows],[data-ordercancelrows],[data-delete-doc],[data-frreset],[data-catadd],[data-catdel],[data-sortbtn]," +
    "[data-addsheet],[data-sheet-addrow],[data-sheet-addcol],[data-sheet-rename]," +
    "[data-managecols],[data-colup],[data-coldown],[data-adddb]," +
    "#theme,#sync-btn,#jump-btn,#today-jump,#logo-home,#add-truck," +
    "#add-pickdrop,#add-department,#new-order,#xfer-add,#xfer-bulk,#xfer-save-bulk,#dw-close,#group-btn,#scrim,#nav-scrim,#int-add,#int-bulk,#int-save-bulk,#push-driver-tabs," +
    "#modal-cancel,#modal-save,#modal-save-loc,#modal-save-dept,#modal-save-truck,#col-save,#col-delete,#condfmt-save,#field-save,#field-options-save,#db-save,#motive-sync,#confirm-del,#confirm-customer-archive,#ifr-toggle," +
    "#profile-btn,[data-profile],[data-setpref],[data-showsched],[data-screc],[data-screset],[data-scresetall]," +
    "[data-cw-step],[data-schedsize-step],[data-schedsize-reset],[data-accent-pick],[data-accent-save],[data-accent-forget],[data-custom-accent-toggle],[data-numbering-save]," +
    "#navtoggle,[data-navto],[data-navsec],[data-navcycle],[data-bill-done],[data-bill-dl],[data-reopen-bill]," +
    "#bill-dl-sel,#bill-done-sel,[data-admin-window-save],[data-admin-window-clear],[data-admin-user-del]," +
    "[data-tc-ampm]");
  if (!t) return;
  if (t.id === "scrim") { closeDrawer(); closeModal(); return; }
  if (t.id === "nav-scrim") { closeMobileNav(); return; }
  if (t.dataset.routeEdit) { routeEditorModal(t.dataset.routeEdit); return; }
  if (t.id === "dw-close") { closeDrawer(); return; }
  if (t.dataset.cwStep) {
    CW_DAYS = Math.max(1, Math.min(14, CW_DAYS + parseInt(t.dataset.cwStep, 10)));
    localStorage.setItem("cwDaysRolling", String(CW_DAYS)); render(); return;
  }
  if (t.dataset.schedsizeStep) {
    // "rowHeight|-4" / "colWidth|10" — key and step packed into one
    // attribute since these are the only two sizing prefs (D175).
    var ssParts = t.dataset.schedsizeStep.split("|"), ssKey = ssParts[0], ssStep = parseInt(ssParts[1], 10);
    var ssBounds = ssKey === "rowHeight" ? [56, 160] : [100, 320];
    setPref(ssKey, clampInt(PREFS[ssKey] + ssStep, ssBounds[0], ssBounds[1], PREFS[ssKey]));
    render();
    return;
  }
  if (t.dataset.showsched) {
    /* Jump from the order drawer to its spot on the Scheduler (D55). */
    var sds = t.dataset.schedds; closeDrawer();
    SEC = "dispatch"; SUB = "sched"; SEL = null; render(); jumpTo(sds); return;
  }
  if (t.dataset.addcust) { addCustomerModal(t.dataset.addcust); return; }
  if (t.dataset.archiveview) {
    var archiveViewParts = t.dataset.archiveview.split("|"), archiveViewGrid = archiveViewParts[0];
    ARCHIVE_DATABASE_VIEW[archiveViewGrid] = archiveViewParts[1] === "archived";
    ROWSEL[archiveViewGrid] = []; ROWSEL_ANCHOR[archiveViewGrid] = null;
    delete GRIDSORT[archiveViewGrid];
    render(); return;
  }
  if (t.dataset.addcol) {
    var acEnt = entityForGrid(t.dataset.addcol);
    if (acEnt && acEnt.kind === "custom") customFieldModal(acEnt.id);
    else columnModal(t.dataset.addcol, null);
    return;
  }
  if (t.dataset.adddb) { newDatabaseModal(); return; }
  if (t.dataset.sortbtn) {
    databaseSortModal(t.dataset.sortbtn);
    return;
  }
  /* Custom Database sheets (D74). The + just opens a fresh sheet — rename it by
     double-clicking its tab (D75). */
  if (t.dataset.addsheet) {
    api("sheet", { name: "Sheet " + ((DB.sheets || []).length + 1) }).then(function (sh) {
      return reload().then(function () { SEC = "database"; SUB = "sheet:" + sh.id; render(); });
    }).catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.dataset.sheetAddrow) {
    var sr = sheetById(t.dataset.sheetAddrow);
    if (sr) api("sheet", { id: sr.id, n_rows: sr.n_rows + 1 }).then(reload).catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.dataset.sheetAddcol) {
    var sc2 = sheetById(t.dataset.sheetAddcol);
    if (sc2) api("sheet", { id: sc2.id, n_cols: sc2.n_cols + 1 }).then(reload).catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.dataset.sheetRename) {
    var srn = sheetById(t.dataset.sheetRename);
    if (srn) { var nn = prompt("Rename sheet:", srn.name); if (nn && nn.trim())
      api("sheet", { id: srn.id, name: nn.trim() }).then(reload).catch(function (err) { toast(err.message, true); }); }
    return;
  }
  if (t.dataset.catdel) {
    var dc = catById(t.dataset.catdel);
    if (dc) confirmModal('Delete designation "' + dc.name + '"? Chips using it fall back to no color.', function () {
      api("category", { id: dc.id, delete: true }).then(reload).catch(function (err) { toast(err.message, true); });
    }, "Delete designation");
    return;
  }
  if (t.dataset.managecols) { manageColumnsModal(t.dataset.managecols); return; }
  if (t.dataset.colup || t.dataset.coldown) {
    var mvId = t.dataset.colup || t.dataset.coldown, dir = t.dataset.colup ? -1 : 1;
    var mvF = (DB.fields || []).filter(function (f) { return f.id === mvId; })[0];
    if (!mvF) return;
    var sibs = (DB.fields || []).filter(function (f) { return f.entity_id === mvF.entity_id; })
      .sort(function (a, b) { return a.sort_order - b.sort_order; });
    var si = sibs.indexOf(mvF), sj = si + dir;
    if (sj < 0 || sj >= sibs.length) return;
    var other = sibs[sj], so1 = mvF.sort_order, so2 = other.sort_order;
    mvF.sort_order = so2; other.sort_order = so1;
    refreshColMgr(); render();
    Promise.all([
      api("field/update", { id: mvF.id, sort_order: so2 }),
      api("field/update", { id: other.id, sort_order: so1 })
    ]).catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.id === "condfmt-save") {
    var ruleRows = [].slice.call(document.querySelectorAll("#condfmt-rules [data-rule]"));
    var rules = ruleRows.map(function (row) {
      return { op: row.querySelector("[data-ruleop]").value,
               value: row.querySelector("[data-ruleval]").value,
               color: colorWithOpacity(row.querySelector("[data-rulecolor]").value,
                 row.querySelector("[data-ruleopacity]").value) };
    });
    var cfFieldId = t.dataset.fieldid, cfF = (DB.fields || []).filter(function (f) { return f.id === cfFieldId; })[0];
    var oldRules = JSON.parse(JSON.stringify(cfF && cfF.conditional_format || []));
    fieldMetaSet(cfFieldId, { conditional_format: rules }).then(function () {
      closeModal();
      histPush("edit conditional formatting",
        function () { return fieldMetaSet(cfFieldId, { conditional_format: oldRules }); },
        function () { return fieldMetaSet(cfFieldId, { conditional_format: rules }); });
    })
      .catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.id === "field-options-save") {
    var foFieldId = t.dataset.fieldid;
    var foInputs = [].slice.call(document.querySelectorAll("#field-options-rows [data-optval]"));
    var foOpts = foInputs.map(function (i) { return i.value.trim(); }).filter(Boolean);
    // A rename is an existing row whose text changed in place — a fresh
    // "+ Add option" row has no data-optorig, so it never qualifies (D146).
    var foRenames = foInputs.map(function (i) {
      return { from: i.dataset.optorig || "", to: i.value.trim() };
    }).filter(function (r) { return r.from && r.to && r.from !== r.to; });
    var foF = (DB.fields || []).filter(function (f) { return f.id === foFieldId; })[0];
    var foOldType = foF && foF.type, foOldOpts = JSON.parse(JSON.stringify((foF && foF.options) || []));
    var foNewType = foOpts.length ? "select" : "text";
    function applyRenames(list) {
      return Promise.all(list.map(function (r) {
        return api("field/rename-option", { id: foFieldId, from: r.from, to: r.to });
      }));
    }
    fieldMetaSet(foFieldId, { type: foNewType, options: foOpts })
      .then(function () { return applyRenames(foRenames); })
      .then(function () {
        closeModal();
        if (foRenames.length) reload();
        histPush("edit dropdown options",
          function () {
            return fieldMetaSet(foFieldId, { type: foOldType, options: foOldOpts })
              .then(function () { return applyRenames(foRenames.map(function (r) { return { from: r.to, to: r.from }; })); })
              .then(function () { if (foRenames.length) reload(); });
          },
          function () {
            return fieldMetaSet(foFieldId, { type: foNewType, options: foOpts })
              .then(function () { return applyRenames(foRenames); })
              .then(function () { if (foRenames.length) reload(); });
          });
      }).catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.dataset.addrow) {
    var arEnt = entityByKey(t.dataset.addrow);
    var arCall = (arEnt && arEnt.kind === "custom") ? api("record", { entity_id: arEnt.id })
      : api("grid/row", { grid: t.dataset.addrow });
    arCall.then(reload).catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.dataset.delrows) {
    var g = t.dataset.delrows, ids = (ROWSEL[g] || []).slice();
    if (!ids.length) { toast("Select rows first — click the numbers on the left", true); return; }
    /* Confirm before destroying data (Nate's ask, D50). */
    openModal('<div class="modal-hd"><h2>Delete ' + ids.length + ' row' + (ids.length > 1 ? "s" : "") +
      '?</h2></div><div class="modal-body"><p style="font-size:var(--fs-body);color:var(--ink-2)">' +
      "This can&rsquo;t be undone. Rows still referenced elsewhere (e.g. a customer on an order) are kept and reported.</p></div>" +
      '<div class="modal-ft"><button class="btn" id="modal-cancel">Cancel</button>' +
      '<button class="btn bad" id="confirm-del" data-delgrid="' + g + '">Delete ' + ids.length + "</button></div>");
    return;
  }
  if (t.dataset.archiverows) {
    var ag = t.dataset.archiverows, aids = (ROWSEL[ag] || []).slice(), archiveCfg = archiveConfigForGrid(ag);
    if (!aids.length) { toast("Select rows first — click the numbers on the left", true); return; }
    var restoring = t.dataset.archiveMode === "restore";
    var archiveNoun = aids.length === 1 ? archiveCfg.singular : archiveCfg.plural;
    openModal('<div class="modal-hd"><h2>' + (restoring ? "Restore" : "Archive") + " " + aids.length +
      " " + archiveNoun + '?</h2></div><div class="modal-body"><p style="font-size:var(--fs-body);color:var(--ink-2)">' +
      (restoring ? "They will return to the active database and new order pickers." :
        "They will leave the active database and new order pickers. Existing orders, documents, and reports stay intact.") +
      '</p></div><div class="modal-ft"><button class="btn" id="modal-cancel">Cancel</button>' +
      '<button class="btn" id="confirm-customer-archive" data-archive-grid="' + ag + '" data-archive-mode="' +
      (restoring ? "restore" : "archive") + '">' + (restoring ? "Restore " : "Archive ") + aids.length + "</button></div>");
    return;
  }
  /* Bulk Cancel/Delete for the order trackers (D159) — same numbered-gutter
     selection as the Database grids (ROWSEL), but routed through the real
     guarded order endpoints instead of a generic row delete, and filtered
     through the exact same eligibility checks the single-row Cancel/Delete
     buttons already use (canCancelOrder/canDeleteOrder) so a locked order
     (delivered/billed) in the selection is silently skipped, not errored. */
  if (t.dataset.orderdelrows) {
    var odg = t.dataset.orderdelrows, odSel = (ROWSEL[odg] || []).slice();
    var odIds = odSel.filter(function (id) { var o = order(id); return o && canDeleteOrder(o); });
    var odSkipped = odSel.length - odIds.length;
    if (!odSel.length) { toast("Select rows first — click the numbers on the left", true); return; }
    if (!odIds.length) { toast("Selected orders are locked (delivered/billed) and can't be deleted", true); return; }
    confirmModal("Permanently delete " + odIds.length + " order" + (odIds.length > 1 ? "s" : "") +
      "? Scheduler placement and attached documents are also deleted. This cannot be undone." +
      (odSkipped ? " (" + odSkipped + " selected order" + (odSkipped > 1 ? "s are" : " is") + " locked and will be skipped.)" : ""),
      function () {
        Promise.all(odIds.map(function (id) {
          return api("order/delete", { id: id }).catch(function (err) { toast(err.message, true); });
        })).then(function () {
          STAGED = STAGED.filter(function (id) { return odIds.indexOf(id) < 0; });
          if (DRAWER_OID && odIds.indexOf(DRAWER_OID) >= 0) closeDrawer();
          ROWSEL[odg] = [];
          return reload();
        }).then(function () { toast(odIds.length + " order" + (odIds.length > 1 ? "s" : "") + " deleted"); });
      }, "Delete " + odIds.length);
    return;
  }
  if (t.dataset.ordercancelrows) {
    var ocg = t.dataset.ordercancelrows, ocSel = (ROWSEL[ocg] || []).slice();
    var ocIds = ocSel.filter(function (id) { var o = order(id); return o && canCancelOrder(o); });
    var ocSkipped = ocSel.length - ocIds.length;
    if (!ocSel.length) { toast("Select rows first — click the numbers on the left", true); return; }
    if (!ocIds.length) { toast("Selected orders can't be cancelled (already cancelled, delivered, or billed)", true); return; }
    confirmModal("Cancel " + ocIds.length + " order" + (ocIds.length > 1 ? "s" : "") + "? You can restore them later." +
      (ocSkipped ? " (" + ocSkipped + " selected order" + (ocSkipped > 1 ? "s" : "") + " can't be cancelled and will be skipped.)" : ""),
      function () {
        Promise.all(ocIds.map(function (id) {
          return api("order/cancel", { id: id, cancelled: true }).catch(function (err) { toast(err.message, true); });
        })).then(function () {
          STAGED = STAGED.filter(function (id) { return ocIds.indexOf(id) < 0; });
          ROWSEL[ocg] = [];
          return reload();
        }).then(function () { toast(ocIds.length + " order" + (ocIds.length > 1 ? "s" : "") + " cancelled"); });
      }, "Cancel " + ocIds.length);
    return;
  }
  if (t.dataset.deleteDoc) {
    var doc = (DB.documents || []).filter(function (d) { return d.id === t.dataset.deleteDoc; })[0];
    if (!doc) return;
    confirmModal('Permanently delete unmatched document "' + (doc.original_filename || "file") + '"? This cannot be undone.', function () {
      api("document/delete", { id: doc.id }).then(reload).then(function () { toast("Document deleted"); })
        .catch(function (err) { toast(err.message, true); });
    }, "Delete document");
    return;
  }
  if (t.id === "confirm-del") {
    var dg = t.dataset.delgrid, dids = (ROWSEL[dg] || []).slice();
    var dgEnt = entityForGrid(dg), dgCustom = dgEnt && dgEnt.kind === "custom";
    Promise.all(dids.map(function (id) {
      return (dgCustom ? api("record/delete", { id: id }) : api("grid/row/delete", { grid: dg, id: id }))
        .catch(function (err) { toast(err.message, true); });
    })).then(function () { ROWSEL[dg] = []; closeModal(); return reload(); });
    return;
  }
  if (t.id === "confirm-customer-archive") {
    var restoringRows = t.dataset.archiveMode === "restore";
    var archiveGrid = t.dataset.archiveGrid, archiveIds = (ROWSEL[archiveGrid] || []).slice();
    t.disabled = true;
    Promise.all(archiveIds.map(function (id) {
      return api("database/archive", { grid: archiveGrid, id: id, archived: !restoringRows });
    })).then(function () {
      ROWSEL[archiveGrid] = []; ROWSEL_ANCHOR[archiveGrid] = null;
      closeModal();
      return reload();
    }).then(function () {
      var cfg = archiveConfigForGrid(archiveGrid);
      toast((restoringRows ? "Restored " : "Archived ") + archiveIds.length + " " +
        (archiveIds.length === 1 ? cfg.singular : cfg.plural));
    }).catch(function (err) { t.disabled = false; toast(err.message, true); });
    return;
  }
  if (t.id === "col-save") {
    var label = ($("#modal [data-cf=label]").value || "").trim();
    if (!label) { toast("Column name is required", true); return; }
    var body = { label: label, type: $("#modal [data-cf=type]").value,
      options: ($("#modal [data-cf=options]").value || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean) };
    var call;
    if (t.dataset.colid) { body.id = t.dataset.colid; call = api("grid/column/update", body); }
    else { body.grid = t.dataset.grid; call = api("grid/column", body); }
    call.then(reload).then(function () { closeModal(); }).catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.id === "col-delete") {
    api("grid/column/delete", { id: t.dataset.colid }).then(reload).then(function () { closeModal(); })
      .catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.id === "field-save") {
    var flabel = ($("#modal [data-cf=label]").value || "").trim();
    if (!flabel) { toast("Field name is required", true); return; }
    api("field", { entity_id: t.dataset.entityid, label: flabel, type: $("#modal [data-cf=type]").value,
      options: ($("#modal [data-cf=options]").value || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean) })
      .then(reload).then(function () { closeModal(); }).catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.id === "db-save") {
    var dbName = ($("#modal [data-cf=name]").value || "").trim();
    if (!dbName) { toast("Database name is required", true); return; }
    api("entity", { name: dbName }).then(function (ent) {
      return reload().then(function () { SEC = "database"; SUB = entityKey(ent); render(); closeModal(); });
    }).catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.id === "modal-cancel") { closeModal(); return; }
  if (t.id === "modal-save") {
    var cd = { kind: t.dataset.custkind };
    [].forEach.call(document.querySelectorAll("#modal [data-cf]"), function (f) {
      cd[f.dataset.cf] = f.type === "checkbox" ? f.checked : f.value;
    });
    if (!cd.name || !cd.name.trim()) { toast("Name is required", true); return; }
    var custGrid = t.dataset.custkind === "external" ? "external" : "bagger";
    api("customer", cd).then(function (party) { return saveCustomFields(custGrid, "parties", party.id, cd); })
      .then(reload).then(function () { closeModal(); toast("Customer added"); })
      .catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.id === "modal-save-loc") {
    var ld = {};
    [].forEach.call(document.querySelectorAll("#modal [data-cf]"), function (f) {
      ld[f.dataset.cf] = f.type === "checkbox" ? f.checked : f.value;
    });
    if (!ld.name || !ld.name.trim()) { toast("Company name is required", true); return; }
    var locTarget = MODAL_LOC_TARGET; MODAL_LOC_TARGET = null;
    api("location", ld).then(function (loc) {
      return saveCustomFields("pickdrop", "locations", loc.id, ld).then(function () {
        // Opened from a drawer/tracker combo's "+Create" — finish the pick
        // too, so confirming this popup is the whole action (Nate: "add
        // locations to my pick and drop list right then and there").
        if (!locTarget) return null;
        var body = { id: locTarget.oid }; body[locTarget.field] = loc.id;
        return api("order/update", body);
      });
    }).then(reload).then(function () { closeModal(); toast(locTarget ? "Location added and set" : "Location added"); })
      .catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.id === "modal-save-dept") {
    var dd = {};
    [].forEach.call(document.querySelectorAll("#modal [data-cf]"), function (f) {
      dd[f.dataset.cf] = f.type === "checkbox" ? f.checked : f.value;
    });
    if (!dd.name || !dd.name.trim()) { toast("Department name is required", true); return; }
    api("department", dd).then(function (dept) { return saveCustomFields("departments", "departments", dept.id, dd); })
      .then(reload).then(function () { closeModal(); toast("Department added"); })
      .catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.dataset.sec) { SEC = t.dataset.sec; SUB = subsOf(SEC)[0].k; SEL = null; render(); return; }
  /* Re-rendering #subs on every click replaces the tab node, which stops the
     browser from ever firing dblclick (the two clicks land on different nodes).
     Clicking the already-active tab is a no-op, so double-click-to-rename works
     on the current sheet tab (D77). */
  if (t.dataset.sub) {
    if (SUB === t.dataset.sub) return;
    // Re-fetch the roster every time the Admin tab is (re)entered (D126) —
    // otherwise a user who signed in for the first time after the cache was
    // populated wouldn't show up until an unrelated cache-busting event.
    if (t.dataset.sub === "admin") ADMIN_ROSTER = null;
    SUB = t.dataset.sub; SEL = null; render(); return;
  }
  if (t.dataset.open) { openOrder(t.dataset.open); return; }
  if (t.dataset.pkgrow) { doPackage(t.dataset.pkgrow, "merged"); return; }
  if (t.dataset.pkg) { if (DRAWER_OID) doPackage(DRAWER_OID, t.dataset.pkg); return; }
  if (t.dataset.billDone) { billDone(t.dataset.billDone); return; }
  if (t.dataset.billDl) {
    doPackage(t.dataset.billDl, "merged").then(function () { return billOrder(t.dataset.billDl); })
      .then(reload).catch(function (err) { toast(err.message || "Download failed", true); });
    return;
  }
  if (t.id === "bill-dl-sel") { billBatch("dl"); return; }
  if (t.id === "bill-done-sel") { billBatchDone(); return; }
  if (t.dataset.reopenBill) {
    var roid = t.dataset.reopenBill;
    billOrder(roid, false).then(reload).then(function () {
      toast("Reopened for billing");
      histPush("reopen billing",
        function () { return billOrder(roid, true).then(reload); },
        function () { return billOrder(roid, false).then(reload); });
    }).catch(function (e) { toast(e.message, true); });
    return;
  }
  if (t.dataset.stage) {
    e.stopPropagation();
    // Client-only (STAGED is never persisted server-side, D51) — a full
    // render() here used to rebuild the whole tracker and reset its .pad
    // scroll to the top on every single click (D195, Nate: "if i hit stage
    // on a load it brings me back to the top of the page"). Just remove
    // each newly-staged row's own Stage button and refresh the (separate,
    // self-contained) Staging rail instead.
    //
    // Bulk (Nate: "bulk select and hit stage on one of the selections and
    // have it stage all of them") — if this row is part of the tracker's
    // current numbered-gutter selection, stage every selected order that's
    // still eligible, not just the one clicked; an ineligible row in the
    // selection (already staged/scheduled/delivered/etc.) is silently
    // skipped, same convention as the bulk Cancel/Delete buttons.
    var stageOid = t.dataset.stage;
    var stageTr = t.closest("tr");
    var stageGut = stageTr && stageTr.querySelector("[data-rowsel]");
    var stageGrid = stageGut ? stageGut.dataset.rowsel.split("|")[0] : null;
    var stageSel = stageGrid ? (ROWSEL[stageGrid] || []) : [];
    var stageTargets = stageSel.indexOf(stageOid) >= 0 ? stageSel.slice() : [stageOid];
    var pm = placement(), stagedCount = 0;
    stageTargets.forEach(function (id) {
      var o = order(id);
      if (!o || !canStageOrder(o, pm[id]) || STAGED.indexOf(id) >= 0) return;
      STAGED.push(id); stagedCount++;
      var btn = document.querySelector('[data-stage="' + id + '"]');
      if (btn) {
        // D211: Stage is the joined control's final segment. Fold its width to
        // zero before removal so the control closes inward instead of popping
        // away and leaving an apparent empty slot.
        btn.disabled = true;
        btn.classList.add("folding");
        (function (foldingBtn) {
          setTimeout(function () { if (foldingBtn.parentNode) foldingBtn.remove(); }, 170);
        })(btn);
      }
    });
    if (stageGrid && stageSel.length) { ROWSEL[stageGrid] = []; paintRowSel(stageGrid, document); }
    renderRail();
    if (stagedCount > 1) toast(stagedCount + " orders staged");
    return;
  }
  if (t.dataset.restoreOrder) {
    e.stopPropagation();
    var restoreId = t.dataset.restoreOrder, keepRestoreDrawer = DRAWER_OID === restoreId;
    api("order/cancel", { id: restoreId, cancelled: false }).then(reload).then(function () {
      if (keepRestoreDrawer) openOrder(restoreId);
      toast("Order restored");
    }).catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.dataset.report) {
    var url = "report/" + t.dataset.report, suffix = "", qp = [];
    /* Any report card can carry From/To date pickers — read them from the
       clicked button's own card (D40). */
    var card = t.closest && t.closest(".card");
    var fi = card && card.querySelector("[data-repfrom]");
    var ti = card && card.querySelector("[data-repto]");
    // The smart-date inputs (D151) keep .value as the pretty MM/DD/YYYY
    // display always — the real ISO lives in data-last-iso.
    var fiIso = fi && fi.dataset.lastIso, tiIso = ti && ti.dataset.lastIso;
    if (fiIso) { qp.push("from=" + fiIso); suffix = "_" + fiIso; }
    if (tiIso) { qp.push("to=" + tiIso); suffix += "_" + tiIso; }
    if (qp.length) url += "?" + qp.join("&");
    api(url).then(function (j) {
      // _csv() (server.py) returns a bare "" for zero matching rows — not
      // even a header line — so this was the only reliable signal (D260,
      // found live: exporting Internal Freight Transfer with a date range
      // that matched nothing silently saved a real, totally empty 0-byte
      // file to Downloads while still toasting "Exported ..." as if it had
      // worked). Report it instead of writing/announcing an empty file.
      if (!j.csv) { toast("No data for that range", true); return; }
      var fn = "dept12_" + t.dataset.report + suffix + ".csv";
      saveBlob(fn, new TextEncoder().encode(j.csv), "text/csv");
      toast("Exported " + fn);
    }).catch(function (e) { toast(e.message, true); });
    return;
  }
  if (t.id === "navtoggle") { toggleSideNav(); return; }
  if (t.dataset.navcycle) { cycleNavSub(parseInt(t.dataset.navcycle, 10)); return; }
  if (t.dataset.navsec) { toggleNavSection(t.dataset.navsec); return; }
  if (t.dataset.navto) {
    var nv = t.dataset.navto.split("|");
    SEC = nv[0]; SUB = nv[1]; SEL = null; MOBILE_NAV_OPEN = false; render(); return;
  }
  if (t.id === "profile-btn") { openProfileMenu(); return; }
  if (t.dataset.profile === "help") { closeProfileMenu(); helpFaqModal(); return; }
  if (t.dataset.profile === "signout") {
    closeProfileMenu();
    dashboardAuth.signOut().then(function () { location.reload(); })
      .catch(function (e) { toast(e.message, true); });
    return;
  }
  if (t.dataset.profile === "savename") {
    var nm = ($("#profile-name-input").value || "").trim();
    if (!nm) { toast("Enter a name", true); return; }
    profileName = nm; localStorage.setItem("profile_name", nm); renderProfile(); render();
    toast("Profile name saved"); return;
  }
  if (t.dataset.accentPick) {
    setAccentPref(t.dataset.accentPick); CUSTOM_ACCENT_OPEN = false; render(); return;
  }
  if (t.dataset.customAccentToggle) {
    CUSTOM_ACCENT_OPEN = !CUSTOM_ACCENT_OPEN; render(); return;
  }
  if (t.dataset.accentSave) {
    if (accentIsPreset(PREFS.accent)) { toast("That color is already in the palette"); return; }
    if (SAVED_ACCENTS.some(function (hex) { return normalizeHex(hex) === normalizeHex(PREFS.accent); })) { toast("Color already saved"); return; }
    if (!saveAccent(PREFS.accent)) { toast("Choose a readable color first", true); return; }
    render(); toast("Color saved"); return;
  }
  if (t.dataset.accentForget) {
    forgetAccent(t.dataset.accentForget); render(); toast("Saved color removed"); return;
  }
  if (t.dataset.schedsizeReset) {
    setPref("rowHeight", 84); setPref("colWidth", 150); render(); toast("Scheduler size reset"); return;
  }
  if (t.dataset.numberingSave) {
    var numberingBody = {
      internal_pattern: ($("#numbering-internal-pattern").value || "").trim(),
      internal_department: ($("#numbering-internal-dept").value || "").trim(),
      external_pattern: ($("#numbering-external-pattern").value || "").trim(),
      external_department: ($("#numbering-external-dept").value || "").trim()
    };
    api("admin/order-number-settings", numberingBody).then(function (saved) {
      DB.order_number_settings = saved; render(); toast("Order numbering saved");
    }).catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.dataset.adminWindowSave || t.dataset.adminWindowClear) {
    var wUid = t.dataset.adminWindowSave || t.dataset.adminWindowClear;
    var wBody = { user_id: wUid };
    if (t.dataset.adminWindowSave) {
      wBody.view_start = ($('[data-admin-window="' + wUid + '|start"]').dataset.lastIso) || null;
      wBody.view_end = ($('[data-admin-window="' + wUid + '|end"]').dataset.lastIso) || null;
    } else {
      wBody.view_start = null; wBody.view_end = null;
    }
    api("admin/view-window", wBody).then(function () { ADMIN_ROSTER = null; render(); toast("Range saved"); })
      .catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.dataset.adminUserDel) {
    e.preventDefault(); // the button sits inside <summary> — don't also toggle the details open/closed
    var delUid = t.dataset.adminUserDel;
    var delUser = ADMIN_ROSTER && ADMIN_ROSTER.filter(function (u) { return u.id === delUid; })[0];
    confirmModal("Delete " + (delUser ? esc(delUser.username) : "this user") +
      "? They lose all access immediately and would need to sign in again to get a fresh account.", function () {
      api("admin/user/delete", { user_id: delUid }).then(function () { ADMIN_ROSTER = null; render(); toast("User deleted"); })
        .catch(function (err) { toast(err.message, true); });
    }, "Delete");
    return;
  }
  if (t.dataset.screc) { RECORDING = RECORDING === t.dataset.screc ? null : t.dataset.screc; render(); return; }
  if (t.dataset.screset) {
    var sc = SHORTCUTS.filter(function (x) { return x.id === t.dataset.screset; })[0];
    if (sc) { KEYMAP[sc.id] = sc.def; saveKeymap(); render(); }
    return;
  }
  if (t.dataset.scresetall) {
    BASE_SHORTCUTS.forEach(function (x) { KEYMAP[x.id] = x.def; }); saveKeymap(); render();
    toast("Shortcuts reset to defaults"); return;
  }
  if (t.id === "sync-btn") {
    api("sync-delivery-dates", {}).then(function (r) { toast("Synced " + r.synced + " delivery date(s)"); return reload(); });
    return;
  }
  if (t.id === "motive-sync") {
    toast("Pulling mileage from Motive…");
    api("motive/sync-miles", {}).then(function (r) {
      var msg = r.filled + " day(s) filled from Motive" +
        (r.unmatched && r.unmatched.length ? " · no data for truck " + r.unmatched.join(", ") : "");
      // D170: newly-synced miles feed straight into the rate calc, same run —
      // Nate: "it should auto run the freight when you hit sync mileage."
      // Skipped quietly (not an error) when no rate is set yet.
      var rate = DB.internal_freight_rate && DB.internal_freight_rate.rate_per_mile;
      var calc = rate ? api("internal-freight-rate/calculate", {}) : Promise.resolve(null);
      return calc.then(function (cr) {
        toast((r.message || msg) + (cr ? " · " + cr.filled + " freight charge(s) calculated" : ""));
        return reload();
      });
    }).catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.dataset.tcAmpm) {
    t.textContent = t.textContent === "AM" ? "PM" : "AM"; renderTimeCalc(); return;
  }
  if (t.id === "ifr-toggle") {
    IFR_OPEN = !IFR_OPEN; localStorage.setItem("ifrOpen", IFR_OPEN ? "1" : "0"); render();
    return;
  }
  if (t.dataset.frreset) {
    var frOid = t.dataset.frreset;
    api("freight", { order_id: frOid, reset_miles: true }).then(function (row) {
      var o = order(frOid); if (o && row) for (var k in row) o[k] = row[k];
      repaintFreightCell(frOid, "miles");
    }).catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.id === "push-driver-tabs") {
    var pushBody = { start_date: CW_START, days: CW_DAYS };
    api("sheets/push-driver-tabs", pushBody).then(function (preview) {
      var msg = "Replace Current Week and each driver tab with " + preview.days + " visible days, " +
        prettyDate(preview.week_start) + " through " + prettyDate(preview.week_end) +
        "? Each day will use three rows and older visible days will be cleared.";
      confirmModal(msg, function () {
        api("sheets/push-driver-tabs", { start_date: CW_START, days: CW_DAYS, confirm: true })
          .then(function (r) {
            // The push sets loads.pushed_at server-side, which flips external
            // chips over to the truck's driver-color fill (pushColorFor,
            // D85 Phase 2) — without a reload() here the Scheduler/Current
            // Week/Driver Tabs views keep showing the pre-push color until
            // some unrelated action happens to trigger one (caught live,
            // Nate: pushed a chip, ran it, no visual change).
            return reload().then(function () {
              toast("Google schedule updated · Current Week + " + r.pushed.length + " driver tab(s)");
            });
          })
          .catch(function (err) { toast(err.message, true); });
      }, "Update Google schedule");
    })
      .catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.id === "jump-btn") { jumpTo($("#jump").dataset.lastIso || ""); return; }
  if (t.id === "today-jump") { jumpTo(TODAY); return; }
  if (t.id === "logo-home") { runShortcut("today"); return; }
  if (t.id === "new-order") {
    api("order", { kind: "external" }).then(function (o) {
      return reload().then(function () { openOrder(o.id); toast("New order — fill it in"); });
    }).catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.id === "xfer-add") { addTransferOrder(); return; }
  if (t.id === "xfer-bulk") { bulkTransferModal(); return; }
  if (t.id === "xfer-save-bulk") {
    var xn = parseInt($('#modal [data-cf="count"]').value, 10);
    if (!xn || xn < 1) { toast("Enter how many orders to add", true); return; }
    api("order/transfer", { count: xn }).then(function (r) {
      closeModal();
      return reload().then(function () { toast(r.created + " orders added"); });
    }).catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.id === "group-btn") { groupMerge(); return; }
  if (t.id === "add-truck") { addTruckModal(); return; }
  if (t.id === "modal-save-truck") {
    var trd = {};
    [].forEach.call(document.querySelectorAll("#modal [data-cf]"), function (f) {
      trd[f.dataset.cf] = f.type === "checkbox" ? f.checked : f.value;
    });
    if (!trd.number || !trd.number.trim()) { toast("Truck # is required", true); return; }
    var newTruckId;
    api("truck", { number: trd.number.trim(), eq: (trd.eq || "").trim() || "F" }).then(function (truck) {
      newTruckId = truck.id;
      if (trd.driver_name && trd.driver_name.trim())
        return api("truck/driver", { truck_id: truck.id, driver_name: trd.driver_name.trim() });
    }).then(function () { return saveCustomFields("fleet", "trucks", newTruckId, trd); })
      .then(reload).then(function () { closeModal(); toast("Truck added — Scheduler rebuilt"); })
      .catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.id === "add-pickdrop") { addLocationModal(); return; }
  if (t.id === "add-department") { addDepartmentModal(); return; }
  if (t.id === "int-bulk") { bulkInternalModal(); return; }
  if (t.id === "int-save-bulk") {
    // D233: bulk reserve now takes an inclusive number range (Nate: "order
    // number start and order number end and it inputs them all in there")
    // instead of a count — same /api/internal-order call either way, just
    // computed from the range here instead of typed directly.
    var bm = $('#modal [data-cf="month"]').value;
    var by = ($('#modal [data-cf="year"]').value || "").trim() || TODAY.slice(0, 4);
    var bs = parseInt($('#modal [data-cf="start"]').value, 10);
    var be = parseInt($('#modal [data-cf="end"]').value, 10);
    if (!/^\d{4}$/.test(by)) { toast("Enter a four-digit year", true); return; }
    if (!bs || bs < 1) { toast("Enter a starting number", true); return; }
    if (!be || be < bs) { toast("Enter an ending number at or after the starting number", true); return; }
    api("internal-order", { month: bm + by, count: be - bs + 1, start: bs }).then(function (r) {
      if (availableYears().indexOf(+by) >= 0) YEAR = +by;  // jump to the year we just filled
      closeModal();
      return reload().then(function () {
        toast(r.created + " numbers reserved (" + r.first + "…" + r.last + ")");
      });
    }).catch(function (e) { toast(e.message, true); });
    return;
  }
  if (t.dataset.trackerCollapse) {
    var tck = t.dataset.trackerCollapse;
    TRACKER_COLLAPSED_OPEN[tck] = !TRACKER_COLLAPSED_OPEN[tck];
    // Collapsing again resets how many rows would show next time (D235) —
    // reopening a group always starts back at one page, not wherever
    // "Show more" had grown it to.
    if (!TRACKER_COLLAPSED_OPEN[tck]) delete TRACKER_COLLAPSED_SHOWN[tck];
    render(); return;
  }
  if (t.dataset.trackerCollapseMore) {
    var tcm = t.dataset.trackerCollapseMore;
    TRACKER_COLLAPSED_SHOWN[tcm] = (TRACKER_COLLAPSED_SHOWN[tcm] || TRACKER_COLLAPSE_PAGE) + TRACKER_COLLAPSE_PAGE;
    render(); return;
  }
  if (t.id === "int-add") { addBagOrderNumber(); return; }
  if (t.dataset.nodelivery) {
    var io = order(t.dataset.nodelivery), nextStage = io.stage === "cancelled" ? "ordered" : "cancelled";
    api("order/update", { id: t.dataset.nodelivery, stage: nextStage })
      .then(reload).catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.dataset.copyOrder) {
    api("order/copy", { order_id: t.dataset.copyOrder }).then(function (o) {
      return reload().then(function () {
        openOrder(o.id);
        toast(o.is_transfer ? "Copied — fill in miles and the transfer $." :
          (o.kind === "internal" ? "Copied — fill in the new order #." :
            "Copied — fill in the new load # and order # when the rate comes in."));
      });
    }).catch(function (err) { toast(err.message, true); });
    return;
  }
});
document.addEventListener("change", function (e) {
  /* Internal Freight drawer's department picker (D127) — instant chip-
     preview update the moment a department is picked, same as text fields
     already get live via the input listener below. The actual save still
     waits for blur (its own dedicated data-transferdept handler) — this is
     preview-only, no network call, so it can't race that save's rebuild. */
  if (e.target.dataset && e.target.dataset.transferdept && DRAWER_OID) {
    var tO = order(e.target.dataset.transferdept);
    if (tO) {
      var tDept = departmentById(e.target.value);
      tO.transfer_department_id = e.target.value || null;
      tO.transfer_department_name = tDept ? tDept.name : null;
      refreshDrawerChipPreview(); refreshDrawerTitle(e.target.dataset.transferdept);
    }
  }
  if (e.target.dataset && e.target.dataset.group) {
    // GROUP is shared between Database's row-merge checkboxes (#group-btn)
    // and Billing's queue checkboxes (#bill-dl-sel) — only one of those
    // buttons exists on screen at a time, so each lookup is guarded (D260,
    // found live: checking a Billing row threw "Cannot set properties of
    // null" on the unguarded #group-btn lookup, which also meant "Download
    // Selected (N)" never updated its own count since the throw happened
    // before anything else in this handler could run).
    var id = e.target.dataset.group, i = GROUP.indexOf(id);
    if (e.target.checked && i < 0) GROUP.push(id); else if (!e.target.checked && i >= 0) GROUP.splice(i, 1);
    var groupBtn = $("#group-btn"); if (groupBtn) groupBtn.textContent = "Group merge (" + GROUP.length + ")";
    var dlSelBtn = $("#bill-dl-sel"); if (dlSelBtn) dlSelBtn.textContent = "Download Selected (" + GROUP.length + ")";
  }
  if (e.target.id === "dv-pick") { DRIVER_VIEW = e.target.value; render(); }
  if (e.target.dataset && e.target.dataset.adminView) {
    // Unchecking View revokes the grant entirely (Edit can't survive without
    // it); checking View with no prior grant creates a view-only one.
    var avp = e.target.dataset.adminView.split("|");
    var avBody = { user_id: avp[0], section: avp[1], sub: avp[2] };
    if (e.target.checked) avBody.can_edit = false; else avBody.revoke = true;
    api("admin/grants", avBody).then(function () { ADMIN_ROSTER = null; render(); })
      .catch(function (err) { toast(err.message, true); });
  }
  if (e.target.dataset && e.target.dataset.adminEdit) {
    // Checking Edit upserts the grant (implicitly turns View on too, since
    // there's now a row); unchecking Edit downgrades to view-only, it
    // doesn't revoke — View stays on.
    var aep = e.target.dataset.adminEdit.split("|");
    api("admin/grants", { user_id: aep[0], section: aep[1], sub: aep[2], can_edit: e.target.checked })
      .then(function () { ADMIN_ROSTER = null; render(); })
      .catch(function (err) { toast(err.message, true); });
  }
  if (e.target.id === "year-pick") {
    if (e.target.value === "__add__") { addNextYear(); return; }
    YEAR = +e.target.value; schedNode = null; render(); return;
  }
  if (e.target.dataset && e.target.dataset.oedit) {
    var ov = {}, ofield = e.target.dataset.field, oo = order(e.target.dataset.oedit);
    // Smart-date fields (D152) keep .value as the pretty MM/DD/YYYY display
    // always — the real ISO lives in data-last-iso.
    var onext = e.target.type === "checkbox" ? e.target.checked :
      e.target.dataset.smartdate !== undefined ? (e.target.dataset.lastIso || "") : e.target.value;
    var oprev = oo ? oo[ofield] : null;
    ov.id = e.target.dataset.oedit; ov[ofield] = onext;
    api("order/update", ov).then(function (row) {
      // Update the local model in place instead of reload() — a full re-render on
      // every field blur destroyed the input you were tabbing INTO, so tab-through
      // was broken (D84). The typed value already shows; the model stays in sync.
      var o = order(ov.id); if (o && row) { for (var rk in row) o[rk] = row[rk]; }
      applyOrderFkDenorm(o, ofield, onext);
      // Repaint just the STAGED rail (its own DOM subtree, untouched by the
      // tracker grid) so a chip already visible there picks up the new name
      // right away — not a full render(), which would rebuild the very
      // <select> being tabbed through and break tab-through (D84).
      renderRail();
      // Bag Orders is auto-sorted by order # (D156) — reposition the row's
      // <tr> in place rather than a full render(), same tab-through concern.
      if (ofield === "solomon_order_no" && o && o.kind === "internal") resortInternalTrackerRow(ov.id);
      histPush("edit " + ofield,
        function () { return orderFieldSet(ov.id, ofield, oprev); },
        function () { return orderFieldSet(ov.id, ofield, onext); });
    }).catch(function (err) { toast(err.message, true); });
  }
  if (e.target.dataset && e.target.dataset.assignTruck) {
    api("assign-truck", { truck_id: e.target.dataset.assignTruck, driver_id: e.target.value || null })
      .then(reload).catch(function (err) { toast(err.message, true); });
  }
  /* Unmatched-document queue: attach a doc to the chosen order (Phase 4). */
  if (e.target.dataset && e.target.dataset.attachDoc && e.target.value) {
    api("document/attach", { id: e.target.dataset.attachDoc, order_id: e.target.value })
      .then(reload).then(function () { toast("Document attached"); })
      .catch(function (err) { toast(err.message, true); });
  }
  /* Fleet equipment <select> and driver color picker (D39) — post the one
     changed field to /api/row, same validation path as spreadsheet cells. */
  if (e.target.dataset && e.target.dataset.rowtable) {
    var rowfield = e.target.dataset.rowfield, sel = e.target;
    var rowArr = { parties: DB.parties, locations: DB.locations, trucks: DB.trucks, drivers: DB.drivers,
                   departments: DB.departments }[sel.dataset.rowtable] || [];
    var rowObj = rowArr.filter(function (x) { return x.id === sel.dataset.rowid; })[0];
    var rowPrev = rowObj ? rowObj[rowfield] : null, rowNext = sel.value;
    var rv = {}; rv[rowfield] = sel.value;
    api("row", { table: sel.dataset.rowtable, id: sel.dataset.rowid, values: rv })
      .then(function (row) {
        patchLocalRow(sel.dataset.rowtable, sel.dataset.rowid, row);
        // designationSelect() tints its own background with the chosen category's
        // color (D72) — repaint just that, since we skip the full re-render (D87).
        if (rowfield === "category_id") {
          var col = designationRuleColor(sel.value);
          sel.style.background = col; sel.style.color = col ? textOn(col) : "";
          refreshDrawerChipPreview();
        }
        histPush("edit " + rowfield,
          function () { return gridCellSet(sel.dataset.rowtable, sel.dataset.rowid, rowfield, rowPrev).then(render); },
          function () { return gridCellSet(sel.dataset.rowtable, sel.dataset.rowid, rowfield, rowNext).then(render); });
      }).catch(function (err) { toast(err.message, true); });
  }
  /* Custom dropdown/checkbox cells (D47) save to the row's JSONB. */
  if (e.target.dataset && e.target.dataset.cust) {
    if (e.target.tagName === "INPUT" && e.target.type !== "checkbox") return;
    var cp = e.target.dataset.cust.split("|");
    var cv = e.target.type === "checkbox" ? (e.target.checked ? "true" : "") : e.target.value;
    var ca = { parties: DB.parties, locations: DB.locations, trucks: DB.trucks,
               departments: DB.departments }[cp[0]] || [];
    var co = ca.filter(function (x) { return x.id === cp[1]; })[0], cpv = co && co.custom ? co.custom[cp[2]] : "";
    customValueSet(cp[0], cp[1], cp[2], cv).then(function () {
      histPush("edit custom field",
        function () { return customValueSet(cp[0], cp[1], cp[2], cpv); },
        function () { return customValueSet(cp[0], cp[1], cp[2], cv); });
    }).catch(function (err) { toast(err.message, true); });
  }
  /* Custom-database dropdown/checkbox cells (D85 Phase 2) save to the
     record's JSONB, keyed by the field's stable id. */
  if (e.target.dataset && e.target.dataset.recfield) {
    var rp = e.target.dataset.recfield.split("|");
    var rcv = e.target.type === "checkbox" ? (e.target.checked ? "true" : "") : e.target.value;
    var rr = (DB.records || []).filter(function (x) { return x.id === rp[0]; })[0];
    var rpv = rr && rr.data ? rr.data[rp[1]] : "";
    recordValueSet(rp[0], rp[1], rcv).then(function () {
      histPush("edit record field",
        function () { return recordValueSet(rp[0], rp[1], rpv); },
        function () { return recordValueSet(rp[0], rp[1], rcv); });
    }).catch(function (err) { toast(err.message, true); });
  }
  /* Row-select checkbox (D47) — highlight the row. */
  if (e.target.dataset && e.target.dataset.rowsel) {
    var rtr = e.target.closest("tr"); if (rtr) rtr.classList.toggle("selrow", e.target.checked);
  }
  /* Manage-columns hide/show checkbox (D85 Phase 1). */
  if (e.target.dataset && e.target.dataset.colvis) {
    var cvF = (DB.fields || []).filter(function (f) { return f.id === e.target.dataset.colvis; })[0];
    var hidden = !e.target.checked;
    if (cvF) cvF.hidden = hidden;
    render();
    api("field/update", { id: e.target.dataset.colvis, hidden: hidden }).catch(function (err) { toast(err.message, true); });
  }
  if (e.target.id === "cw-days") {
    CW_DAYS = Math.max(1, Math.min(14, parseInt(e.target.value, 10) || 3));
    localStorage.setItem("cwDaysRolling", String(CW_DAYS));
    render();
  }
  if (e.target.id === "pref-rowh-inp" || e.target.id === "pref-colw-inp") {
    var ssKey2 = e.target.id === "pref-rowh-inp" ? "rowHeight" : "colWidth";
    var ssBounds2 = ssKey2 === "rowHeight" ? [56, 160] : [100, 320];
    setPref(ssKey2, clampInt(e.target.value, ssBounds2[0], ssBounds2[1], PREFS[ssKey2]));
    render();
  }
  if (e.target.id === "pref-font-select") {
    setPref("font", e.target.value); render();
  }
  if (e.target.id === "pref-accent-wheel" || e.target.id === "pref-accent-hex") {
    var accentValue = normalizeHex(e.target.value);
    if (!setAccentPref(accentValue)) {
      toast("Choose a color with more contrast", true);
      render();
    } else {
      render();
    }
  }
  if (e.target.id === "cw-start") {
    // The smart-date input (D151) keeps .value as the pretty MM/DD/YYYY
    // display always — the real ISO lives in data-last-iso.
    CW_START = e.target.dataset.lastIso || TODAY;
    localStorage.setItem("cwStart", CW_START);
    render();
  }
});
document.addEventListener("input", function (e) {
  if (e.target.id === "numbering-internal-pattern" || e.target.id === "numbering-external-pattern") {
    var internal = e.target.id === "numbering-internal-pattern";
    var out = document.getElementById(internal ? "numbering-internal-example" : "numbering-external-example");
    if (out) out.textContent = orderPatternExample(e.target.value || "");
    return;
  }
  if (e.target.classList.contains("tc-hh") || e.target.classList.contains("tc-mm")) {
    tcSanitizeDigits(e.target); renderTimeCalc();
  }
  if (e.target.id === "pref-accent-wheel" || e.target.id === "pref-accent-hex") {
    var accentValue = normalizeHex(e.target.value), safe = accentIsReadable(accentValue);
    var status = document.getElementById("accent-status");
    if (status) {
      status.textContent = safe ? "Readable in light and dark mode." : "That color is too close to a light or dark background.";
      status.classList.toggle("bad", !safe);
    }
    if (safe) {
      setAccentPref(accentValue);
      var wheel = document.getElementById("pref-accent-wheel");
      var hex = document.getElementById("pref-accent-hex");
      var value = document.getElementById("accent-value");
      if (wheel && e.target !== wheel) wheel.value = accentValue;
      if (hex && e.target !== hex) hex.value = accentValue;
      if (value) value.textContent = accentValue;
    }
  }
});
$("#q").addEventListener("input", function (e) { Q = e.target.value; renderRail(); });
$("#gsearch").addEventListener("input", renderSearch);
$("#gsearch").addEventListener("keydown", function (e) {
  if (!GS_RESULTS.length) { if (e.key === "Escape") $("#gsearch").blur(); return; }
  if (e.key === "ArrowDown") { GS_SEL = (GS_SEL + 1) % GS_RESULTS.length; paintSearch(); e.preventDefault(); }
  else if (e.key === "ArrowUp") { GS_SEL = (GS_SEL - 1 + GS_RESULTS.length) % GS_RESULTS.length; paintSearch(); e.preventDefault(); }
  else if (e.key === "Enter") { gsActivate(GS_SEL); e.preventDefault(); }
  else if (e.key === "Escape") { $("#gsearch-results").style.display = "none"; }
});
$("#file-ratecon").addEventListener("change", function () { if (this.files[0]) ingestRateCon(this.files[0]); this.value = ""; });
$("#file-batch").addEventListener("change", function () { if (this.files[0]) ingestBatch(this.files[0]); this.value = ""; });
$("#file-loose").addEventListener("change", function () { if (this.files[0]) ingestLoose(this.files[0]); this.value = ""; });
$("#file-doc").addEventListener("change", function () {
  var oid = DRAWER_OID, files = [].slice.call(this.files); this.value = "";
  if (!oid || !files.length) return;
  var targetOrder = order(oid);
  Promise.all(files.map(function (f) {
    return fileB64(f).then(function (b64) {
      // Anchor the short abbreviations on word boundaries so "inv" doesn't match
      // "Inventory" and "rc" doesn't match "Search"/"March" (D82).
      var t = /pod|bol|signed/i.test(f.name) ? "pod" :
              /delivery.?receipt|driver.?receipt|unsigned.?receipt/i.test(f.name) ? "delivery_receipt" :
              /invoice|\binv\b/i.test(f.name) ? "invoice" :
              /ratecon|\brate\b|\brc\b/i.test(f.name) ? "rate_con" :
              targetOrder && targetOrder.kind === "internal" ? "delivery_receipt" : "other";
      return api("document", { order_id: oid, doc_type: t, filename: f.name, b64: b64, matched_by: "manual" });
    });
  })).then(reload).then(function () { openOrder(oid); toast(files.length + " document(s) attached"); })
    .catch(function (e2) { toast(e2.message, true); });
});
document.addEventListener("blur", function (e) {
  var i = e.target.closest && e.target.closest("[data-of]");
  if (!i || !DRAWER_OID) return;
  // Smart-date fields (D152) keep .value as the pretty MM/DD/YYYY display
  // always — the real ISO lives in data-last-iso.
  var isSmart = i.dataset.smartdate !== undefined;
  var next = isSmart ? (i.dataset.lastIso || "") : i.value;
  var prev = isSmart ? (i.dataset.undoPrevIso || "") : (i.dataset.undoPrev == null ? "" : i.dataset.undoPrev);
  var field = i.dataset.of;
  var saveOid = DRAWER_OID, v = {}; v.id = saveOid; v[field] = next;
  if (String(prev) === String(next)) return;
  if (i.dataset.of.charAt(0) === "_") return;             // future Motive fields
  queueDrawerSave(function () { return api("order/update", v); }).then(reload).then(function () {
    refreshOrderDrawerAfterSave(saveOid);
    histPush("edit " + field,
      function () { return orderFieldSet(saveOid, field, prev); },
      function () { return orderFieldSet(saveOid, field, next); });
  })
    .catch(function (err) { toast(err.message, true); });
}, true);
/* Per-load freight fields (D38) save to the load, not the order. */
document.addEventListener("blur", function (e) {
  var i = e.target.closest && e.target.closest("[data-fr]");
  if (!i || !DRAWER_OID) return;
  var saveOid = DRAWER_OID, v = { order_id: saveOid }; v[i.dataset.fr] = i.value;
  var prev = i.dataset.undoPrev == null ? "" : i.dataset.undoPrev, next = i.value, field = i.dataset.fr;
  if (String(prev) === String(next)) return;
  queueDrawerSave(function () { return api("freight", v); }).then(reload).then(function () {
    refreshOrderDrawerAfterSave(saveOid);
    histPush("edit " + (field === "freight_amount" ? "transfer cost" : field),
      function () { return freightValueSet(saveOid, field, prev); },
      function () { return freightValueSet(saveOid, field, next); });
  })
    .catch(function (err) { toast(err.message, true); });
}, true);
/* Outside-carrier drawer fields (D122) — name/cost autosave on blur like any
   other drawer field. Cost is refused (client-side and by the server) until
   a carrier name exists, since carrier_cost requires carrier_party_id
   (loads_carrier_cost_only) — the reason the old drop-time modal existed at
   all is now just this one guarded field, not the whole placement.

   A cost save sends the sibling name input's LIVE value along with it, not
   just carrier_cost — tabbing straight from name to cost and blurring both
   fast enough can otherwise beat the name save's round trip back into
   carrierMap()'s cache, so a stale-cache check here would wrongly reject a
   name that was, in fact, already typed (found live). */
document.addEventListener("blur", function (e) {
  var i = e.target.closest && e.target.closest("[data-carrier]");
  if (!i || !DRAWER_OID) return;
  var field = i.dataset.carrier, oid = i.dataset.oid;
  var prev = i.dataset.undoPrev == null ? "" : i.dataset.undoPrev, next = i.value.trim();
  if (String(prev) === String(next)) return;
  var body = { order_id: oid };
  if (field === "name") {
    body.carrier_name = next;
  } else {
    if (next !== "" && (isNaN(parseFloat(next)) || parseFloat(next) < 0)) {
      toast("Enter a valid cost", true); i.value = prev; return;
    }
    var nameInput = i.closest(".fields").querySelector('[data-carrier="name"]');
    var liveName = nameInput ? nameInput.value.trim() : "";
    if (liveName) body.carrier_name = liveName;
    else if (next !== "" && !(carrierMap()[oid] || {}).carrierId) {
      toast("Enter a carrier name first", true); i.value = prev; return;
    }
    body.carrier_cost = next;
  }
  queueDrawerSave(function () { return api("load/carrier", body).then(reload); }).then(function () {
    if (DRAWER_OID === oid) refreshCarrierSummary(oid);
    histPush("edit carrier " + field,
      function () { return carrierFieldSet(oid, field, prev); },
      function () { return carrierFieldSet(oid, field, next); });
  }).catch(function (err) { toast(err.message, true); i.value = prev; });
}, true);
/* Internal Freight department picker (D127) — its own save path so a fast
   department → route-note fill-out can't have the generic data-of full
   rebuild tear the note field out from under a mid-keystroke user (see the
   comment on the <select> in openTransferOrder). */
document.addEventListener("blur", function (e) {
  var i = e.target.closest && e.target.closest("[data-transferdept]");
  if (!i || !DRAWER_OID) return;
  var oid = i.dataset.transferdept;
  var prev = i.dataset.undoPrev == null ? "" : i.dataset.undoPrev, next = i.value;
  if (String(prev) === String(next)) return;
  queueDrawerSave(function () { return api("order/update", { id: oid, transfer_department_id: next }); })
    .then(function (row) {
      var o = order(oid); if (o && row) for (var k in row) o[k] = row[k];
      render(); refreshDrawerChipPreview(); refreshDrawerTitle(oid);
      histPush("edit department",
        function () { return orderFieldSet(oid, "transfer_department_id", prev); },
        function () { return orderFieldSet(oid, "transfer_department_id", next); });
    })
    .catch(function (err) { toast(err.message, true); });
}, true);
/* Fleet driver name (D45) — free-text; on blur, set the truck's current driver
   by name (creates the driver if new, or unassigns when cleared). */
document.addEventListener("blur", function (e) {
  var i = e.target.closest && e.target.closest("[data-truckdriver]");
  if (!i) return;
  api("truck/driver", { truck_id: i.dataset.truckdriver, driver_name: i.value })
    .then(reload).catch(function (err) { toast(err.message, true); });
}, true);
/* Internal freight rate/minimum (D170) — persisted server-side, not a
   per-device pref, since it's a real business figure. Saves on blur; the
   separate "Calc freight $" button is what actually applies it. */
document.addEventListener("blur", function (e) {
  if (e.target.id !== "ifr-rate" && e.target.id !== "ifr-min") return;
  var rateEl = document.getElementById("ifr-rate"), minEl = document.getElementById("ifr-min");
  if (!rateEl || !minEl) return;
  api("internal-freight-rate", { rate_per_mile: rateEl.value, minimum_charge: minEl.value })
    .then(function (r) { DB.internal_freight_rate = r; })
    .catch(function (err) { toast(err.message, true); });
}, true);
/* Internal Orders miles / transfer-$ cells (D48) save to the load via
   api_freight, keyed by the row's order id. */
document.addEventListener("blur", function (e) {
  var i = e.target.closest && e.target.closest("[data-frorder]");
  if (!i) return;
  var oid = i.dataset.frorder, field = i.dataset.frfield;
  var prev = i.dataset.undoPrev == null ? "" : i.dataset.undoPrev, next = i.value;
  if (String(prev) === String(next)) return;
  freightValueSet(oid, field, next).then(function () {
    histPush("edit " + (field === "freight_amount" ? "transfer cost" : field),
      function () { return freightValueSet(oid, field, prev); },
      function () { return freightValueSet(oid, field, next); });
  }).catch(function (err) { toast(err.message, true); });
}, true);
/* Custom text/number/date cells (D47) save to the row's JSONB on blur. */
document.addEventListener("blur", function (e) {
  var i = e.target.closest && e.target.closest("input[data-cust]");
  if (!i || i.type === "checkbox") return;
  var p = i.dataset.cust.split("|");
  var prev = i.dataset.undoPrev == null ? "" : i.dataset.undoPrev, next = i.value;
  if (String(prev) === String(next)) return;
  customValueSet(p[0], p[1], p[2], next).then(function () {
    histPush("edit custom field",
      function () { return customValueSet(p[0], p[1], p[2], prev); },
      function () { return customValueSet(p[0], p[1], p[2], next); });
  }).catch(function (err) { toast(err.message, true); });
}, true);
/* Driver Tabs' Notes column (D137, retargeted D140) — over a placed order,
   edits its driver_note (same field/save path the Scheduler/Current Week
   chip note-editor uses, driverNoteSet); over a bare/empty slot, still the
   plain schedule_notes text (scheduleNote) — an unrelated, order-less
   concept. */
document.addEventListener("blur", function (e) {
  var ta = e.target.closest && e.target.closest(".dv-note");
  if (!ta) return;
  var key = ta.dataset.notekey, oid = ta.dataset.oid, next = ta.value.trim();
  if (oid) {
    var o = order(oid); if (!o) return;
    var prev = o.driver_note || "";
    if (prev === next) return;
    driverNoteSet(oid, key, next).then(function () {
      histPush("edit driver tab note",
        function () { return driverNoteSet(oid, key, prev); },
        function () { return driverNoteSet(oid, key, next); });
    }).catch(function (err) { toast(err.message, true); ta.value = prev; });
    return;
  }
  var cur = CELLS[key], prev = (cur && cur.text) || "";
  if (prev === next) return;
  scheduleNote(key, next).then(function () {
    histPush("edit note",
      function () { return scheduleNote(key, prev); },
      function () { return scheduleNote(key, next); });
  }).catch(function (err) { toast(err.message, true); ta.value = prev; });
}, true);
/* Driver Tabs' PO/PU# and Delivery# columns (D185) — same blur-to-save
   pattern as the Notes column above, via the lightweight orderPoDeliverySet
   (no repaint needed, neither field shows on any chip). */
document.addEventListener("blur", function (e) {
  var inp = e.target.closest && e.target.closest(".dv-field-inp");
  if (!inp) return;
  var oid = inp.dataset.oid, field = inp.dataset.dvfield, next = inp.value.trim();
  var o = order(oid); if (!o) return;
  var prev = o[field] || "";
  if (prev === next) return;
  orderPoDeliverySet(oid, field, next).then(function () {
    histPush("edit " + field,
      function () { return orderPoDeliverySet(oid, field, prev); },
      function () { return orderPoDeliverySet(oid, field, next); });
  }).catch(function (err) { toast(err.message, true); inp.value = prev; });
}, true);
/* Time card calculator (D258) — hour clamps 1-12 (no zero-pad, per Nate's
   ask), minute clamps 0-59 and zero-pads to 2 digits, both on blur so
   mid-typing values aren't fought. */
document.addEventListener("blur", function (e) {
  if (e.target.classList && e.target.classList.contains("tc-hh")) { tcClampHour(e.target); renderTimeCalc(); }
  else if (e.target.classList && e.target.classList.contains("tc-mm")) { tcClampMinute(e.target); renderTimeCalc(); }
}, true);
/* Admin Access row disclosure (D259) — keeps ADMIN_OPEN in sync with the
   native <details> element's own open/close state (a plain click on
   <summary> toggles it without any JS of ours running), so a grant
   checkbox's own render() a moment later renders it back open instead of
   snapping shut. "toggle" doesn't bubble, so this has to be capture-phase
   on document, same reason "blur" listeners in this file are. */
document.addEventListener("toggle", function (e) {
  var row = e.target.closest && e.target.closest("[data-admin-row]");
  if (row) ADMIN_OPEN[row.dataset.adminRow] = row.open;
}, true);
/* Pickup/Delivery type-ahead (D42): filter as you type / on focus. */
document.addEventListener("input", function (e) {
  /* Drawer edits repaint the real chip preview while Nate types; persistence
     still happens on blur through the existing API path. */
  var orderInput = e.target.closest && e.target.closest("[data-of]");
  if (orderInput && DRAWER_OID) {
    var previewOrder = order(DRAWER_OID);
    if (previewOrder) {
      previewOrder[orderInput.dataset.of] = orderInput.value;
      refreshDrawerChipPreview();
    }
  }
  var inp = e.target.closest && e.target.closest("[data-loccombo]");
  if (inp) { inp.removeAttribute("data-locid"); renderLocSuggest(inp); }
  var pinp = e.target.closest && e.target.closest("[data-partycombo]");
  if (pinp) { pinp.removeAttribute("data-partyid"); renderPartySuggest(pinp); }
}, true);
document.addEventListener("focus", function (e) {
  var inp = e.target.closest && e.target.closest("[data-loccombo]");
  if (inp && inp.value.trim()) renderLocSuggest(inp, true);
  var pinp = e.target.closest && e.target.closest("[data-partycombo]");
  if (pinp && pinp.value.trim()) renderPartySuggest(pinp, true);
  var undoInput = e.target.closest && e.target.closest("[data-of],[data-fr],[data-frorder],input[data-cust],[data-carrier],[data-transferdept]");
  if (undoInput) {
    undoInput.dataset.undoPrev = undoInput.value;
    // Smart-date fields (D152) need the pre-edit ISO too, not just the
    // display text, for the save payload and the undo/redo closures.
    if (undoInput.dataset.smartdate !== undefined) undoInput.dataset.undoPrevIso = undoInput.dataset.lastIso || "";
  }
}, true);
/* Arrow/Enter/Tab navigation for a location/party combo's open suggestion
   panel (D150, Nate: "if ur typing in customers etc [up/down should]
   scroll lists... if a user is in the middle of an autofill and they hit
   tab the menu should close with the best match being the selection").
   Up/Down move the highlighted .on option; Enter activates it the same as
   a click; Tab activates it too but WITHOUT preventDefault, so focus still
   advances to the next field exactly like a normal Tab — the pick just
   rides along first. renderLocSuggest/renderPartySuggest already mark the
   first (best) match .on as soon as the panel has any results, so Tab
   always has something to commit even if the user never touched an arrow
   key. */
function activateLocOpt(opt) {
  if (!opt) return;
  if (opt.dataset.partypick) handlePartyPick(opt);
  else handleLocPick(opt);
}
document.addEventListener("keydown", function (e) {
  var inp = e.target.closest && e.target.closest("[data-loccombo],[data-partycombo]");
  if (!inp) return;
  var panel = locSuggestPanel();
  if (panel.style.display === "none") return;
  var opts = [].slice.call(panel.querySelectorAll(".loc-opt"));
  if (!opts.length) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    var idx = opts.findIndex(function (o) { return o.classList.contains("on"); });
    idx = e.key === "ArrowDown" ? (idx + 1) % opts.length : (idx - 1 + opts.length) % opts.length;
    opts.forEach(function (o, i) { o.classList.toggle("on", i === idx); });
    opts[idx].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    e.preventDefault();
    activateLocOpt(panel.querySelector(".loc-opt.on") || opts[0]);
  } else if (e.key === "Tab") {
    activateLocOpt(panel.querySelector(".loc-opt.on") || opts[0]);
  }
});
document.addEventListener("click", function (e) {
  var opt = e.target.closest && e.target.closest("[data-locpick],[data-loccreate]");
  if (opt) { handleLocPick(opt); return; }
  var popt = e.target.closest && e.target.closest("[data-partypick]");
  if (popt) { handlePartyPick(popt); return; }
  if (!(e.target.closest && e.target.closest(".loccombo")))
    [].forEach.call(document.querySelectorAll(".loc-suggest"), function (p) { p.style.display = "none"; });
  var gopt = e.target.closest && e.target.closest("[data-gsi]");
  if (gopt) { gsActivate(+gopt.dataset.gsi); return; }
  if (!(e.target.closest && e.target.closest("#gsearch,#gsearch-results")))
    $("#gsearch-results").style.display = "none";
  if (!(e.target.closest && e.target.closest("#profile-menu,#profile-btn"))) closeProfileMenu();
});
/* ═══ 08-undo ═══ */
/* ── Undo / redo (D63/D96) — app-wide, up to 50 actions each way. Each undoable
   action registers a pair of promise-returning closures: `undo` reverses it,
   `redo` re-applies it. Both go through the same server-backed primitives the
   original action used, so the DB stays the source of truth — the stack never
   holds "phantom" state that Postgres doesn't know about. A new action clears
   the redo stack (linear history, same as an editor). Cmd/Ctrl-Z / -Shift-Z. */
var HIST = { undo: [], redo: [], LIMIT: 50, busy: false };
function histPush(label, undoFn, redoFn) {
  HIST.undo.push({ label: label, undo: undoFn, redo: redoFn });
  if (HIST.undo.length > HIST.LIMIT) HIST.undo.shift();
  HIST.redo = [];
}
function histRun(verb) {
  if (HIST.busy) return;
  var from = verb === "undo" ? HIST.undo : HIST.redo;
  var e = from.pop();
  if (!e) { toast("Nothing to " + verb); return; }
  HIST.busy = true;
  Promise.resolve().then(verb === "undo" ? e.undo : e.redo).then(function () {
    /* Resolve the destination after the async mutation. `histPush` deliberately
       replaces the redo array, so retaining an old array reference here could
       make a successfully redone action disappear from the live stack. */
    var to = verb === "undo" ? HIST.redo : HIST.undo;
    to.push(e); if (to.length > HIST.LIMIT) to.shift();
    toast((verb === "undo" ? "Undid" : "Redid") + ": " + e.label);
  }).catch(function (err) {
    from = verb === "undo" ? HIST.undo : HIST.redo;
    from.push(e); toast("Can't " + verb + ": " + (err && err.message || err), true);
  }).then(function () { HIST.busy = false; });
}
function histUndo() { histRun("undo"); }
function histRedo() { histRun("redo"); }

function scheduleDateOf(place) {
  return place && place !== "STAGE" ? String(place).split("|")[1] : "";
}
/* Grace period (Nate: a truck breakdown/no-schedule-access til the next day
   shouldn't trigger a "changes history" confirm) — only a genuinely stale
   edit, more than HIST_GRACE_DAYS behind today, prompts. */
var HIST_GRACE_DAYS = 4;
function histCutoff() { return iso(addDays(new Date(TODAY + "T00:00:00Z"), -HIST_GRACE_DAYS)); }
function historicalMoveMessage(from, to) {
  var fd = scheduleDateOf(from), td = scheduleDateOf(to), cut = histCutoff();
  if ((!fd || fd >= cut) && (!td || td >= cut)) return "";
  if (fd && fd < cut && td && td < cut) return "This changes a load inside schedule history. Continue?";
  if (td && td < cut) return "This moves a load into a past day and changes schedule history. Continue?";
  return "This moves a load out of a past day and changes schedule history. Continue?";
}
/* User-initiated historical moves are gated here. Undo/redo calls moveLoad
   directly, so reversing one confirmed action stays predictable. */
function confirmHistoricalMove(from, to, action) {
  var msg = historicalMoveMessage(from, to);
  if (!msg) { action(); return; }
  confirmModal(msg, action, "Change history");
}

/* Server-backed mutation primitives. Both the user action and its undo/redo
   call these, so a reversal is literally the forward op with old/new swapped. */
function moveLoad(oid, from, to) {
  // `from`/`to` are a cell key ("truck|date|slot") or "STAGE". Always
  // Scheduler mechanics regardless of the caller (drag, paste, undo replay),
  // so this checks the dispatch/sched grant directly rather than trusting
  // whatever section happens to be ambient (D125).
  if (!canEdit("dispatch", "sched")) return Promise.reject(new Error("View-only — you can't move loads here."));
  // Refuses to land on a cell that already holds a different real load —
  // protects undo from clobbering a slot the user filled after the original
  // move. A text-only cell (no .oid, D250) isn't "occupied" this way — the
  // server's own place-an-order path already replaces a plain note when a
  // load lands on it (api_schedule), so the client just needs to stop
  // blocking the drop from reaching that path at all.
  if (to !== "STAGE" && CELLS[to] && CELLS[to].oid && CELLS[to].oid !== oid)
    return Promise.reject(new Error("that slot is occupied"));
  var op;
  if (to === "STAGE") {
    op = api("unschedule", { order_id: oid }).then(function () {
      if (from && from !== "STAGE") { delete CELLS[from]; repaintCell(from); }
      if (STAGED.indexOf(oid) < 0) STAGED.push(oid);
    });
  } else {
    var p = to.split("|");
    // Outside-carrier lane (D115/D122): drops straight into place with no
    // name/cost required — those are filled in later from a collapsible
    // drawer section, not a blocking modal at drop time.
    var placeCall = p[0] === CARRIER_TID
      ? api("load/carrier", { order_id: oid, date: p[1], slot: +p[2] })
      : api("schedule", { truck_id: p[0], date: p[1], slot: +p[2], order_id: oid });
    op = placeCall.then(function () {
      if (from === "STAGE") STAGED = STAGED.filter(function (x) { return x !== oid; });
      else if (from && from !== "STAGE") { delete CELLS[from]; repaintCell(from); }
      CELLS[to] = { oid: oid }; repaintCell(to);
    });
  }
  return op.then(function () {
    renderRail(); DB.loads = null; return api("bootstrap").then(function (d) { DB = d; });
  });
}
function scheduleNote(key, text) {
  var p = key.split("|");
  var body = { truck_id: p[0], date: p[1], slot: +p[2], action: text === "" ? "clear" : "note" };
  if (text) body.body = text;
  return api("schedule", body).then(function () {
    // Preserve any pre-applied formatting/color on the cell (D80/D82) — the server
    // keeps the fmt row when clearing content, so the local model must too:
    // clearing text keeps fmt/category (Sheets parity), dropping the entry only
    // when the cell is truly bare.
    var prev = CELLS[key] || {};
    var keepFmt = (prev.fmt && Object.keys(prev.fmt).length) || prev.catId;
    if (text) CELLS[key] = { text: text, fmt: prev.fmt, cat: prev.cat, catId: prev.catId };
    else if (keepFmt) CELLS[key] = { text: "", fmt: prev.fmt, cat: prev.cat, catId: prev.catId };
    else delete CELLS[key];
    repaintCell(key);
  });
}
/* The driver tab note (D140) lives on the ORDER (driver_note), not the load —
   so unlike scheduleNote this writes through /api/order/update, then
   repaints just the chip(s) showing it via the existing repaintCell (D140
   extended it to also patch Driver Tabs' un-nested chip markup) instead of
   a full render(). A full render() here would race a user tabbing between
   Driver Tabs' many note boxes, the same class of bug a drawer field's
   full rebuild used to hit (D122/D128). */
function driverNoteSet(oid, key, note) {
  return api("order/update", { id: oid, driver_note: note }).then(function (row) {
    var o = order(oid); if (o && row) o.driver_note = row.driver_note;
    repaintCell(key);
    refreshDrawerChipPreview();
  });
}
/* Driver Tabs' PO/PU# and Delivery# columns (D185) — same two order fields
   the pushed sheet's E/F columns read, edited here the same lightweight
   way driverNoteSet edits driver_note: patch the in-memory order and stop,
   no repaint. Unlike driver_note, neither field appears on any chip
   anywhere in the dashboard (D178 moved them off the chip entirely), so
   there's nothing visual to refresh — and skipping repaintDvSlot()
   specifically avoids swapping out the very row a user might be
   tab-through-editing (the same class of bug D122/D128 fixed for drawer
   fields). */
function orderPoDeliverySet(oid, field, value) {
  var body = { id: oid }; body[field] = value;
  return api("order/update", body).then(function (row) {
    var o = order(oid); if (o && row) o[field] = row[field];
  });
}
/* Patches an in-memory row in place instead of a full reload() (D87) — the
   four real-table entities Database grids edit directly. Custom/json-storage
   fields and the four builtins' `custom` jsonb go through separate endpoints
   that already skip reload (see 07-events.js data-cust handler). */
function patchLocalRow(table, id, row) {
  var arr = { parties: DB.parties, locations: DB.locations, trucks: DB.trucks, drivers: DB.drivers,
              departments: DB.departments }[table];
  var obj = arr && arr.filter(function (x) { return x.id === id; })[0];
  if (obj && row) { for (var k in row) obj[k] = row[k]; }
  return obj;
}
function gridCellSet(table, id, field, value) {
  if (table === "sheet") {                    // custom spreadsheet cell (D74): field is "r|c"
    var rc = field.split("|");
    return api("sheet/cell", { sheet_id: id, r: +rc[0], c: +rc[1], value: value }).then(reload);
  }
  var vals = {}; vals[field] = value;
  // Update the local row in place instead of reload() (D84/D87 pattern) — a full
  // bootstrap refetch + whole-grid rebuild on every single cell commit made a
  // 300-row Database grid unscrollable (scroll position reset every edit, D87).
  return api("row", { table: table, id: id, values: vals }).then(function (row) { patchLocalRow(table, id, row); });
}
function orderFieldSet(oid, field, value) {
  var body = { id: oid }; body[field] = value;
  return api("order/update", body).then(function (row) {
    var o = order(oid); if (o && row) for (var k in row) o[k] = row[k];
    applyOrderFkDenorm(o, field, value);
    render(); refreshDrawerChipPreview();
  });
}
function customValueSet(table, id, key, value) {
  return api("row/custom", { table: table, id: id, key: key, value: value }).then(function (row) {
    var obj = patchLocalRow(table, id, row);
    if (obj) { obj.custom = obj.custom || {}; if (value == null || value === "") delete obj.custom[key]; else obj.custom[key] = String(value); }
    render();
  });
}
function recordValueSet(id, fieldId, value) {
  return api("record/update", { id: id, field_id: fieldId, value: value }).then(function () {
    var rec = (DB.records || []).filter(function (r) { return r.id === id; })[0];
    if (rec) { rec.data = rec.data || {}; if (value == null || value === "") delete rec.data[fieldId]; else rec.data[fieldId] = String(value); }
    render();
  });
}
function freightValueSet(oid, field, value) {
  var body = { order_id: oid }; body[field] = value;
  return api("freight", body).then(function (row) {
    var o = order(oid); if (o && row) for (var k in row) o[k] = row[k];
    // Typing miles can also auto-fill the $ amount server-side now (D187),
    // so repaint both cells regardless of which one was actually edited —
    // repaintFreightCell no-ops harmlessly if a cell isn't on screen.
    repaintFreightCell(oid, "miles");
    repaintFreightCell(oid, "freight_amount");
  });
}
/* Outside-carrier drawer fields (D122) — "name" or "cost", edited from the
   collapsible section that only shows once an order is on the carrier lane.
   No date/slot in the body, so the server takes the partial-edit branch
   instead of re-placing the load. */
function carrierFieldSet(oid, field, value) {
  var body = { order_id: oid };
  if (field === "name") body.carrier_name = value;
  else body.carrier_cost = value;
  return api("load/carrier", body).then(reload);
}
function fieldMetaSet(id, patch) {
  return api("field/update", Object.assign({ id: id }, patch)).then(function (row) {
    var f = (DB.fields || []).filter(function (x) { return x.id === id; })[0];
    if (f && row) for (var k in row) f[k] = row[k];
    render();
  });
}
/* ═══ 09-color ═══ */
/* ── Scheduler coloring: categories, right-click menu, copy/paste (D66) ─────
   The board behaves like a spreadsheet — color a cell/chip from a managed
   named palette, mark a truck off, copy/paste a chip. Multi-cell range select
   builds on the single-cell selection already here. */
function categories() { return DB.categories || []; }
function catById(id) { for (var i = 0; i < categories().length; i++) if (categories()[i].id === id) return categories()[i]; return null; }

/* Set (or clear) a cell's category color. Works for a load chip or an empty/
   text cell; records undo (D63). */
function setCellColor(key, catId) {
  var p = key.split("|"), cv = CELLS[key] || null;
  var prev = cv ? (cv.catId || "") : "";
  if (prev === (catId || "")) return Promise.resolve();
  return api("cell/color", { truck_id: p[0], date: p[1], slot: +p[2], category_id: catId || null }).then(function () {
    var c = catId ? catById(catId) : null, color = c ? c.color : "";
    var e = CELLS[key];
    if (e) { e.cat = color; e.catId = catId || "";
             // Don't drop a cell that still carries manual formatting (D82).
             if (!e.oid && !catId && !(e.text || "").trim() && !(e.fmt && Object.keys(e.fmt).length)) delete CELLS[key]; }
    else if (catId) CELLS[key] = { text: "", cat: color, catId: catId };
    repaintCell(key);
  });
}
/* Toggle a truck off for a day; records undo. */
function setTruckOff(truckId, ds, on, note) {
  return api("truck/off", { truck_id: truckId, off_date: ds, on: on, note: note || "Off" }).then(function () {
    if (on) OFFDAYS[truckId + "|" + ds] = note || "Off"; else delete OFFDAYS[truckId + "|" + ds];
    // repaint that truck's cells for the day (all slots)
    var n = Math.max(3, DAYSLOT[ds] || 0);
    for (var s = 1; s <= n; s++) repaintCell(cellKey(truckId, ds, s));
  });
}
/* The distinct truck+day pairs covered by a set of cell keys — a marquee can
   span multiple slot rows on the same truck-day (collapse those to one
   toggle) and/or multiple trucks/days (toggle each). */
function truckOffPairsFor(keys) {
  var seen = {}, pairs = [];
  keys.forEach(function (k) {
    var p = k.split("|"), id = p[0] + "|" + p[1];
    if (seen[id]) return;
    seen[id] = true;
    pairs.push({ truckId: p[0], ds: p[1] });
  });
  return pairs;
}
function setTruckOffMany(pairs, on) {
  return Promise.all(pairs.map(function (p) { return setTruckOff(p.truckId, p.ds, on); }));
}
/* Mark/clear truck-off across whichever cells are selected, or just the
   right-clicked cell's own truck+day if nothing is selected (Nate: "it
   should mark the truck off for the day or for the selected cells whichever
   i have selected, if i dont have it selected its the day im right clicking
   in"). The clicked cell's current off state decides the direction applied
   to the whole set, matching how colorCells (D66) used to apply one action
   uniformly across a selection. */
function truckOffToggleCells(keys, truckId, ds) {
  var on = !OFFDAYS[truckId + "|" + ds];
  var pairs = truckOffPairsFor(keys);
  setTruckOffMany(pairs, on).then(function () {
    var label = (on ? "mark" : "clear") + " truck off" + (pairs.length > 1 ? " (" + pairs.length + ")" : "");
    histPush(label,
      function () { return setTruckOffMany(pairs, !on); },
      function () { return setTruckOffMany(pairs, on); });
  }).catch(function (e) { toast(e.message, true); });
}

/* Copy/paste one chip between cells (D66). Stores the source order id. */
var CELLCLIP = null;
function copyCell(key) {
  var cv = CELLS[key];
  if (cv && cv.oid) { CELLCLIP = { oid: cv.oid, catId: cv.catId || "" }; toast("Chip copied"); }
  else { CELLCLIP = null; toast("Nothing to copy here", true); }
}
function pasteCell(key) {
  if (!CELLCLIP) { toast("Nothing copied", true); return; }
  if (CELLS[key]) { toast("That cell is occupied", true); return; }
  var oid = CELLCLIP.oid;
  // Paste = place a copy of the order onto the target cell. Reuses the same
  // order (a repeat placement); use External Orders' Copy for a brand-new order.
  var from = null;
  confirmHistoricalMove("STAGE", key, function () {
    moveLoad(oid, from, key).then(function () {
      histPush("paste chip", function () { return moveLoad(oid, key, "STAGE"); },
        function () { return moveLoad(oid, "STAGE", key); });
    }).catch(function (e) { toast(e.message, true); });
  });
}

/* Copy/paste a generic column-backed color-chip value (D127 follow-up #3) —
   right-click a color chip to copy its hex, right-click another to paste it,
   or select several rows first (the existing numbered-gutter row selector,
   ROWSEL) and paste to all of them at once. Today just Internal Freight's
   per-department color; any future generic ui:'color' field gets this free. */
var COLORCLIP = null;
function rowArrFor(table) {
  return { parties: DB.parties, locations: DB.locations, trucks: DB.trucks, drivers: DB.drivers,
           departments: DB.departments }[table] || [];
}
function copyChipColor(hex) {
  COLORCLIP = hex && hex.charAt(0) === "#" ? hex : null;
  toast(COLORCLIP ? "Color copied" : "Nothing to copy here", !COLORCLIP);
}
function pasteChipColor(table, id, field) {
  if (!COLORCLIP) { toast("Nothing copied", true); return; }
  var obj = rowArrFor(table).filter(function (x) { return x.id === id; })[0];
  var prev = obj ? obj[field] : null, next = COLORCLIP;
  if (prev === next) return;
  gridCellSet(table, id, field, next).then(render).then(function () {
    histPush("paste color",
      function () { return gridCellSet(table, id, field, prev).then(render); },
      function () { return gridCellSet(table, id, field, next).then(render); });
  }).catch(function (err) { toast(err.message, true); });
}
function pasteChipColorToSelected(table, field, gk) {
  if (!COLORCLIP) { toast("Nothing copied", true); return; }
  var ids = (ROWSEL[gk] || []).slice();
  if (!ids.length) { toast("Select some rows first", true); return; }
  var arr = rowArrFor(table), next = COLORCLIP;
  var before = ids.map(function (id) {
    var obj = arr.filter(function (x) { return x.id === id; })[0];
    return { id: id, val: obj ? obj[field] : null };
  });
  function apply(vals) {
    return Promise.allSettled(vals.map(function (x) { return gridCellSet(table, x.id, field, x.val); }));
  }
  apply(ids.map(function (id) { return { id: id, val: next }; })).then(function () {
    render();
    toast("Pasted color to " + ids.length + " row" + (ids.length > 1 ? "s" : ""));
    histPush("paste color to " + ids.length + " row" + (ids.length > 1 ? "s" : ""),
      function () { return apply(before).then(render); },
      function () { return apply(ids.map(function (id) { return { id: id, val: next }; })).then(render); });
  });
}

var PALETTE_ON = false;
/* Which toolbar popover is open ("fill"/"text"/"border"/"font"), so its
   own button can toggle it shut instead of the capture-mousedown closing then the
   click reopening it (D80). */
var PALETTE_KIND = null;
function closePalette() { var e = $("#palette"); if (e) e.remove(); PALETTE_ON = false; PALETTE_KIND = null; closeCtxMenu(); }
/* If the named popover is already open, close it and report handled (toggle off). */
function togglePalette(kind) { if (PALETTE_KIND === kind) { closePalette(); return true; } return false; }

/* Right-click context menu on a scheduler cell (D66). "Set color…" was
   dropped (D219, Nate: "set color can go away cause i can paint bucket
   color in if i want" — the toolbar's Fill button already covers it).
   "Mark/Clear truck off" now applies to the current multi-selection when
   the clicked cell is part of one, else just that cell's own day. */
function closeCtxMenu() { var m = $("#ctxmenu"); if (m) m.remove(); }
function openCtxMenu(x, y, key) {
  closeCtxMenu();
  var cv = CELLS[key], p = key.split("|"), truckId = p[0], ds = p[1];
  var isOff = !!OFFDAYS[truckId + "|" + ds], hasChip = !!(cv && cv.oid);
  var items = [
    { a: "off", t: isOff ? "Clear truck off" : "Mark truck off" }
  ];
  if (hasChip) items.push({ a: "open", t: "Open order" }, { a: "copy", t: "Copy chip" }, { a: "clear", t: "Clear cell" });
  else items.push({ a: "paste", t: "Paste chip" });
  var m = document.createElement("div");
  m.id = "ctxmenu"; m.className = "ctxmenu";
  m.innerHTML = items.map(function (it) { return '<button data-a="' + it.a + '">' + it.t + "</button>"; }).join("");
  document.body.appendChild(m);
  var r = m.getBoundingClientRect();
  m.style.left = Math.min(x, window.innerWidth - r.width - 8) + "px";
  m.style.top = Math.min(y, window.innerHeight - r.height - 8) + "px";
  m.addEventListener("click", function (e) {
    var b = e.target.closest("[data-a]"); if (!b) return;
    var a = b.getAttribute("data-a");
    closeCtxMenu();
    if (a === "off") truckOffToggleCells(selectedKeys(key), truckId, ds);
    else if (a === "open" && cv && cv.oid) openOrder(cv.oid);
    else if (a === "copy") copyCell(key);
    else if (a === "paste") pasteCell(key);
    else if (a === "clear") clearCellKey(key);
  });
}
/* The keys a color/action applies to: the multi-selection if the acted-on cell
   is part of it, else just that cell (D66). */
var MULTISEL = [];        // selected scheduler cell KEYS (for color/format actions)
var SELSET = [];          // selected cell ELEMENTS (any grid — drives the highlight)
function selectedKeys(key) {
  if (MULTISEL.length && MULTISEL.indexOf(key) >= 0) return MULTISEL.slice();
  return [key];
}
/* Paint the given cell elements as the selection, and keep MULTISEL (scheduler
   keys) in sync so color/format still target the right cells. */
function setSel(tds) {
  [].forEach.call(document.querySelectorAll("td.selrange"), function (td) {
    td.classList.remove("selrange"); td.classList.remove("colrange");
  });
  [].forEach.call(document.querySelectorAll("th.colsel"), function (th) { th.classList.remove("colsel"); });
  if (typeof COLSEL !== "undefined") COLSEL = null;
  SELSET = tds || [];
  if (SELSET.length && SEL) { SEL.classList.remove("sel"); SEL = null; }
  SELSET.forEach(function (td) { td.classList.add("selrange"); });
  MULTISEL = SELSET.filter(function (td) { return td.dataset.key; }).map(function (td) { return td.dataset.key; });
  if (typeof positionFillHandle === "function") positionFillHandle();
}
function clearMulti() {
  setSel([]);
  if (SEL) { SEL.classList.remove("sel"); SEL = null; }
  if (typeof SEL_ANCHOR !== "undefined") SEL_ANCHOR = null;
  if (typeof positionFillHandle === "function") positionFillHandle();
}
function clearCellKey(key) {
  var cv = CELLS[key]; if (!cv) return;
  if (cv.oid) {
    var oid = cv.oid;
    confirmHistoricalMove(key, "STAGE", function () {
      moveLoad(oid, key, "STAGE").then(function () {
        histPush("clear cell", function () { return moveLoad(oid, "STAGE", key); },
          function () { return moveLoad(oid, key, "STAGE"); });
      }).catch(function (e) { toast(e.message, true); });
    });
  } else if (cv.text != null) {
    var t = cv.text;
    scheduleNote(key, "").then(function () {
      histPush("clear cell", function () { return scheduleNote(key, t); },
        function () { return scheduleNote(key, ""); });
    });
  }
}
/* Day rows are display structure, but still participate in universal history.
   Removing the bottom extra row compacts each truck into its first open slot;
   a load with no opening is safely returned to Staging. */
function dayBaseRows(ds) {
  var dow = new Date(ds + "T00:00:00Z").getUTCDay(), weekend = dow === 0 || dow === 6;
  return weekend && !WEEKEND_ON[ds] && !(DAYSLOT[ds] || 0) ? 1 : 3;
}
function showDayRows(ds, count) {
  var base = dayBaseRows(ds);
  if (count > base) DAYADD[ds] = count; else delete DAYADD[ds];
  schedNode = null; render();
  requestAnimationFrame(function () {
    var el = document.getElementById("row-" + ds); if (el) el.scrollIntoView({ block: "center" });
  });
  return Promise.resolve();
}
function addDayRow(ds) {
  if (ds < TODAY) { toast("Past-day rows are locked", true); return; }
  var rowhd = (schedNode && schedNode.querySelector("#row-" + ds)) || document.querySelector("#row-" + ds);
  if (!rowhd) return;
  var before = rowhd.rowSpan || 1, after = before + 1;
  showDayRows(ds, after).then(function () {
    histPush("add scheduler row", function () { return showDayRows(ds, before); },
      function () { return showDayRows(ds, after); });
  });
}
function cloneCellState(cv) {
  return cv ? { text: cv.text || "", catId: cv.catId || "", fmt: JSON.parse(JSON.stringify(cv.fmt || {})) } : null;
}
function clearNoteState(key) {
  return scheduleNote(key, "").then(function () { return setCellColor(key, ""); })
    .then(function () { return fmtSetFull({ kind: "sched", key: key }, {}); });
}
function putNoteState(key, state) {
  return scheduleNote(key, state.text || "").then(function () { return setCellColor(key, state.catId || ""); })
    .then(function () { return fmtSetFull({ kind: "sched", key: key }, state.fmt || {}); });
}
function serial(list, fn) {
  return list.reduce(function (p, x) { return p.then(function () { return fn(x); }); }, Promise.resolve());
}
function applyRemovedRow(plans, forward) {
  return serial(forward ? plans : plans.slice().reverse(), function (p) {
    if (p.oid) return forward ? moveLoad(p.oid, p.from, p.to) : moveLoad(p.oid, p.to, p.from);
    if (forward) return clearNoteState(p.from).then(function () { return p.to === "STAGE" ? null : putNoteState(p.to, p.state); });
    return (p.to === "STAGE" ? Promise.resolve() : clearNoteState(p.to)).then(function () { return putNoteState(p.from, p.state); });
  });
}
function removeDayRow(ds) {
  if (ds < TODAY) { toast("Past-day rows are locked", true); return; }
  var rowhd = (schedNode && schedNode.querySelector("#row-" + ds)) || document.querySelector("#row-" + ds);
  if (!rowhd) return;
  var shown = rowhd.rowSpan || 1, base = dayBaseRows(ds);
  if (shown <= base) { toast("No extra row to remove", true); return; }
  var plans = [];
  DB.trucks.forEach(function (t) {
    var from = cellKey(t.id, ds, shown), cv = CELLS[from]; if (!cv) return;
    var to = "STAGE";
    for (var s = 1; s < shown; s++) {
      var candidate = cellKey(t.id, ds, s);
      if (!CELLS[candidate]) { to = candidate; break; }
    }
    plans.push(cv.oid ? { oid: cv.oid, from: from, to: to } : { from: from, to: to, state: cloneCellState(cv) });
  });
  function execute() {
    applyRemovedRow(plans, true).then(reload).then(function () { return showDayRows(ds, shown - 1); }).then(function () {
      histPush("remove scheduler row", function () {
        return showDayRows(ds, shown).then(function () { return applyRemovedRow(plans, false); }).then(reload);
      }, function () {
        return applyRemovedRow(plans, true).then(reload).then(function () { return showDayRows(ds, shown - 1); });
      });
      toast(plans.length ? "Row removed; its contents were shifted up or staged" : "Row removed");
    }).catch(function (e) { toast(e.message, true); });
  }
  if (plans.length) confirmModal("Remove the bottom row? Its contents will shift into open cells; loads with no open cell move to Staging. Undo restores the row.", execute, "Remove row");
  else execute();
}
function openDayMenu(x, y, rowhd) {
  closeCtxMenu();
  var ds = (rowhd.id || "").replace("row-", ""); if (!ds) return;
  var m = document.createElement("div"); m.id = "ctxmenu"; m.className = "ctxmenu";
  var shown = rowhd.rowSpan || 1;
  var dow = new Date(ds + "T00:00:00Z").getUTCDay(), weekend = dow === 0 || dow === 6;
  var weekendOpen = weekend && (WEEKEND_ON[ds] || (DAYSLOT[ds] || 0) > 0);
  var base = weekend && !weekendOpen ? 1 : 3;
  var past = ds < TODAY, removable = shown > base;
  var hasNote = !!dayNote(ds);
  m.innerHTML = (weekend ? '<button data-weekend-toggle="' + ds + '"' + (past ? " disabled" : "") + '>' +
      (WEEKEND_ON[ds] ? "Collapse weekend" : "Activate weekend") + '</button>' : "") +
    '<button data-day-add="' + ds + '"' + (past ? " disabled" : "") + '>Add row to this day</button>' +
    '<button data-day-remove="' + ds + '"' + (removable && !past ? "" : " disabled") + '>Remove row</button>' +
    '<button data-day-note="' + ds + '">' + (hasNote ? "Edit day note…" : "Add day note…") + '</button>';
  document.body.appendChild(m);
  var r = m.getBoundingClientRect();
  m.style.left = Math.min(x, window.innerWidth - r.width - 8) + "px";
  m.style.top = Math.min(y, window.innerHeight - r.height - 8) + "px";
  m.addEventListener("click", function (e) {
    var add = e.target.closest("[data-day-add]"), remove = e.target.closest("[data-day-remove]");
    var toggle = e.target.closest("[data-weekend-toggle]"), note = e.target.closest("[data-day-note]");
    if (!add && !remove && !toggle && !note) return;
    e.preventDefault(); e.stopPropagation(); closeCtxMenu();
    if (toggle) {
      var tds = toggle.dataset.weekendToggle;
      if (WEEKEND_ON[tds]) delete WEEKEND_ON[tds]; else WEEKEND_ON[tds] = true;
      localStorage.setItem("weekendActive", JSON.stringify(WEEKEND_ON));
      schedNode = null; render(); requestAnimationFrame(function () {
        var el = document.getElementById("row-" + tds); if (el) el.scrollIntoView({ block: "center" });
      });
    } else if (add) addDayRow(add.dataset.dayAdd);
    else if (note) dayNoteModal(note.dataset.dayNote);
    else if (!remove.disabled) removeDayRow(remove.dataset.dayRemove);
  });
}
/* Generic right-click menu (D85 Phase 2) — Database field/column headers and
   sheet/database tabs. Distinct from openCtxMenu (scheduler cells, keyed by
   cell key) since these act on metadata rows, not schedule cells. Items are
   [{label, danger, run}]; run() fires on click, menu closes first. */
function openMenu(x, y, items) {
  closeCtxMenu(); closePalette();
  var m = document.createElement("div"); m.id = "ctxmenu"; m.className = "ctxmenu";
  m.innerHTML = items.map(function (it, i) {
    return '<button data-mi="' + i + '"' + (it.danger ? ' class="bad"' : "") + ">" + esc(it.label) + "</button>";
  }).join("");
  document.body.appendChild(m);
  var r = m.getBoundingClientRect();
  m.style.left = Math.min(x, window.innerWidth - r.width - 8) + "px";
  m.style.top = Math.min(y, window.innerHeight - r.height - 8) + "px";
  m.addEventListener("click", function (e) {
    var b = e.target.closest("[data-mi]"); if (!b) return;
    closeCtxMenu(); items[+b.dataset.mi].run();
  });
}
document.addEventListener("contextmenu", function (e) {
  /* Generic color-chip copy/paste (D127 follow-up #3) — right-click to copy
     one chip's hex, right-click another to paste it, or select several rows
     first (numbered gutter) and paste to all of them at once. */
  var cchip = e.target.closest && e.target.closest("[data-colorchip-generic]");
  if (cchip) {
    e.preventDefault();
    var cparts = cchip.dataset.colorchipGeneric.split("|"), ctable = cparts[0], cid = cparts[1], cfield = cparts[2];
    // The chip's displayed text falls back to "#888888" when no color is
    // actually set (fieldCell) — that's a visual placeholder, not a real
    // stored value, so Copy must read the row's real data, not the DOM text
    // (copying the placeholder pasted a literal #888888 as if it were a
    // genuine color, caught live testing).
    var cobj = rowArrFor(ctable).filter(function (x) { return x.id === cid; })[0];
    var curHex = cobj ? cobj[cfield] : null, gk2 = ctable, selCount = (ROWSEL[gk2] || []).length;
    var citems = [];
    if (curHex) citems.push({ label: "Copy color", run: function () { copyChipColor(curHex); } });
    if (COLORCLIP) citems.push({ label: "Paste color here", run: function () { pasteChipColor(ctable, cid, cfield); } });
    if (COLORCLIP && selCount >= 1)
      citems.push({ label: "Paste color to " + selCount + " selected", run: function () { pasteChipColorToSelected(ctable, cfield, gk2); } });
    openMenu(e.clientX, e.clientY, citems);
    return;
  }
  var rh = e.target.closest && e.target.closest("td.rowhd");
  if (rh && rh.id) { e.preventDefault(); openDayMenu(e.clientX, e.clientY, rh); return; }

  /* Database field header (builtin or custom, D85) — conditional formatting,
     hide, and (custom fields only) delete. Replaces the old inline ⋮ button. */
  var fth = e.target.closest && e.target.closest("th[data-fieldid]");
  if (fth) {
    e.preventDefault();
    var fld = (DB.fields || []).filter(function (f) { return f.id === fth.dataset.fieldid; })[0];
    if (!fld) return;
    var fitems = [
      { label: "Conditional formatting…", run: function () { condFmtFieldModal(fld); } }
    ];
    // Only a plain generic column-backed field can become a managed dropdown
    // (D144) — the special `ui` handlers (designation/equipment/truckdriver/
    // color) are already their own dropdown-equivalent systems, custom
    // (json-storage) fields get Type+options through their own add-field
    // modal, and a locked field can't be retyped server-side anyway.
    if (!fld.ui && fld.storage !== "json" && !fld.locked)
      fitems.push({ label: "Dropdown options…", run: function () { fieldOptionsModal(fld); } });
    if (fld.storage === "json") fitems.push({ label: "Delete field", danger: true, run: function () {
      confirmModal('Delete field "' + fld.label + '"? Its data is lost.', function () {
        api("field/delete", { id: fld.id }).then(reload).catch(function (err) { toast(err.message, true); });
      }, "Delete field");
    } });
    openMenu(e.clientX, e.clientY, fitems);
    return;
  }
  /* Legacy custom-column header (the 4 builtins' grid_columns, D47). */
  var cth = e.target.closest && e.target.closest("th[data-customcol]");
  if (cth) {
    e.preventDefault();
    var col = (DB.grid_columns || []).filter(function (c) { return c.id === cth.dataset.customcol; })[0];
    if (!col) return;
    openMenu(e.clientX, e.clientY, [
      { label: "Edit column…", run: function () { columnModal(col.grid, col); } },
      { label: "Delete column", danger: true, run: function () {
        confirmModal('Delete column "' + col.label + '"? Its data is lost.', function () {
          api("grid/column/delete", { id: col.id }).then(reload).catch(function (err) { toast(err.message, true); });
        }, "Delete column");
      } }
    ]);
    return;
  }
  /* Custom Database sheet tab (D74) — rename/delete. */
  var sheetTab = e.target.closest && e.target.closest('.sub-tab[data-sub^="sheet:"]');
  if (sheetTab) {
    e.preventDefault();
    var sid = sheetTab.dataset.sub.slice(6), sh = sheetById(sid); if (!sh) return;
    openMenu(e.clientX, e.clientY, [
      { label: "Rename sheet…", run: function () {
        inlineRename(sheetTab, sh.name, function (v) {
          api("sheet", { id: sid, name: v }).then(reload).catch(function (err) { toast(err.message, true); });
        });
      } },
      { label: "Delete sheet", danger: true, run: function () {
        confirmModal('Delete sheet "' + sh.name + '" and all its cells? This cannot be undone.', function () {
          api("sheet", { id: sid, delete: true }).then(function () {
            return reload().then(function () { SEC = "database"; SUB = "bagger"; render(); });
          }).catch(function (err) { toast(err.message, true); });
        }, "Delete sheet");
      } }
    ]);
    return;
  }
  /* Custom database tab (D85 Phase 2) — delete (rename stays on dblclick). */
  var dbTab = e.target.closest && e.target.closest(".sub-tab[data-sub]");
  if (dbTab && SEC === "database") {
    var ent = entityByKey(dbTab.dataset.sub);
    if (ent && ent.kind === "custom") {
      e.preventDefault();
      openMenu(e.clientX, e.clientY, [{ label: "Delete database", danger: true, run: function () {
        confirmModal('Delete database "' + ent.name + '" and all its rows? This cannot be undone.', function () {
          api("entity/delete", { id: ent.id }).then(function () {
            return reload().then(function () { SUB = subsOf("database")[0].k; render(); });
          }).catch(function (err) { toast(err.message, true); });
        }, "Delete database");
      } }]);
      return;
    }
  }

  var td = e.target.closest && e.target.closest("td[data-key]:not([data-field])");
  if (!td) return;
  e.preventDefault();
  openCtxMenu(e.clientX, e.clientY, td.dataset.key);
});
/* pointerdown, not mousedown (D259 fix) — found live: clicking a Scheduler
   cell to dismiss an open #ctxmenu/#palette silently failed to close either
   one, because selStart's own pointerdown handler (10-select.js) calls
   e.preventDefault() for every ordinary cell click (D83, to make single-
   cell pointer-based selection work), and per the Pointer Events spec that
   suppresses the compatibility "mousedown" event this listener used to key
   off — so the click landed, selection moved, but the stale menu/palette
   stayed on screen. pointerdown always fires regardless of any later
   preventDefault(), and registering here (09-color.js, alphabetically
   before 10-select.js) still runs this closer before selStart's own
   handler — same ordering trick D254's note-border-drag already relies on. */
document.addEventListener("pointerdown", function (e) {
  // A toolbar palette-opener owns its toggle — don't close here on its mousedown,
  // or the following click would just reopen it (D80).
  var opener = e.target.closest && e.target.closest('.fmtbar [data-fb="fill"],.fmtbar [data-fb="text"],.fmtbar [data-fb="border"],.fmtbar [data-fb="font"]');
  if (PALETTE_ON && !opener && !(e.target.closest && e.target.closest("#palette"))) closePalette();
  if (!(e.target.closest && e.target.closest("#ctxmenu"))) closeCtxMenu();
}, true);
/* ═══ 10-select ═══ */
/* ── Multi-cell selection (D66/D68/D70/D71) — spreadsheet-style, two ways so it's
   solid on a trackpad: click-drag a marquee, OR click one cell then shift-click
   another to select the whole rectangle (no dragging needed). A chip still drags
   to move a load, so selection only starts on the cell background.

   D70: NO pointer capture. setPointerCapture on a plain <div> is buggy in Safari
   (and some Chrome builds) — captured pointermove events don't bubble back to the
   document listener. Without capture, pointermove fires on the element under the
   cursor and bubbles to document in every browser. A `selectstart` guard blocks
   Safari's native text-selection during a drag.

   D71: the highlight is styled with var(--focus) (D172 split this off the
   personalizable var(--brand) so a selection ring reads the same regardless
   of accent choice) — it was long broken because the CSS referenced a
   nonexistent var(--accent), so selection worked but painted nothing.
   Confirm the paint, not just the logic. */
var MARQ = null, SEL_ANCHOR = null, COLSEL = null;
function toggleDatabaseColumn(th) {
  var key = th.dataset.colgrid + "|" + th.dataset.colref;
  if (COLSEL === key) { clearMulti(); return; }
  var tr = th.parentNode, idx = [].indexOf.call(tr.children, th), table = th.closest("table");
  var cells = [].map.call(table.tBodies[0].rows, function (row) { return row.children[idx]; })
    .filter(function (td) { return td && !td.classList.contains("col-plus-cell"); });
  setSel(cells); cells.forEach(function (td) { td.classList.add("colrange"); });
  th.classList.add("colsel"); COLSEL = key;
}
function killMarquee() { [].forEach.call(document.querySelectorAll(".marquee"), function (b) { b.remove(); }); }
/* Selectable cells inside a grid: scheduler/Current-Week (td[data-key]) and the
   Database grids (td[data-field]) — so selection works app-wide (D68). */
function gridSelCells(wrap) {
  return wrap ? [].slice.call(wrap.querySelectorAll("td[data-key],td[data-field]")) : [];
}
function boxTds(wrap, x1, y1, x2, y2) {
  var lox = Math.min(x1, x2), hix = Math.max(x1, x2), loy = Math.min(y1, y2), hiy = Math.max(y1, y2);
  return gridSelCells(wrap).filter(function (td) {
    var r = td.getBoundingClientRect();
    return r.right >= lox && r.left <= hix && r.bottom >= loy && r.top <= hiy;
  });
}
function rectTds(wrap, a, b) {
  var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
  return boxTds(wrap, Math.min(ra.left, rb.left), Math.min(ra.top, rb.top), Math.max(ra.right, rb.right), Math.max(ra.bottom, rb.bottom));
}
/* Pointer-based marquee — one code path for mouse, trackpad, and touch. No
   pointer capture (see header); document-level move/up listeners catch the drag
   because events bubble up from whatever cell the cursor is over. */
function selStart(e) {
  if (e.button !== 0 && e.pointerType === "mouse") return;
  // The formatting UI acts ON the selection — clicking it must NOT clear it.
  if (e.target.closest("#palette,#ctxmenu,#drawer,.fmtbar,header")) return;
  if (e.target.closest(".col-resize")) return;   // column resize owns this drag (D85)
  if (e.target.closest("#fillhandle")) return;   // fill-handle drag owns this (D118)
  if (e.target.closest("th[data-colref],.col-plus-h")) return; // header click/drag owns this
  // A chip drag or any other control click means the user moved on — drop the
  // marquee so the next format doesn't hit stale cells (D82).
  if (e.target.closest(".chip")) { clearMulti(); return; }   // chip drag wins
  // Truck column header drag (D87) — same reasoning as chips: this pointerdown's
  // preventDefault() below would otherwise swallow the native HTML5 dragstart
  // AND start a cell marquee under the header, which is what made column drag
  // look like "it selects the cell underneath it" (Nate).
  if (e.target.closest("th.trkcol")) return;
  if (e.target.closest("input,textarea,select,button,a,.cell-input,[data-rowsel]")) { clearMulti(); return; }
  var wrap = e.target.closest(".grid-wrap");
  if (!wrap || !gridSelCells(wrap).length) { clearMulti(); return; }
  var td = e.target.closest("td[data-key],td[data-field]");
  if (e.shiftKey && SEL_ANCHOR && wrap.contains(SEL_ANCHOR)) {   // shift-click = rectangle
    e.preventDefault();
    setSel(rectTds(wrap, SEL_ANCHOR, td || SEL_ANCHOR));
    MARQ = null; return;
  }
  if (!td) { clearMulti(); return; }
  if (td) {
    // The preventDefault below suppresses the compatibility `mousedown`, so the
    // old mousedown→selectCell path never fired on a real click — single-cell
    // selection was dead (D83). Select here instead, committing any open edit
    // first (mirrors the mousedown handler in 06).
    if (td === SEL && !e.shiftKey) {
      e.preventDefault(); clearMulti(); MARQ = null; return; // same cell toggles off
    }
    if (typeof EDITING !== "undefined" && EDITING && EDITING.td !== td) commitEdit();
    SEL_ANCHOR = td;
    selectCell(td);
  }
  e.preventDefault();                                // stops native text-select / drag
  MARQ = { x0: e.clientX, y0: e.clientY, wrap: wrap, moved: false, box: null, lastX: e.clientX, lastY: e.clientY,
           scrollTimer: setInterval(marqueeAutoScrollTick, 16) };
}
function selMove(e) {
  if (!MARQ) return;
  MARQ.lastX = e.clientX; MARQ.lastY = e.clientY;
  if (!MARQ.moved && Math.abs(e.clientX - MARQ.x0) + Math.abs(e.clientY - MARQ.y0) < 4) return;
  MARQ.moved = true; e.preventDefault();
  drawMarquee(e.clientX, e.clientY);
  setSel(boxTds(MARQ.wrap, MARQ.x0, MARQ.y0, e.clientX, e.clientY));
}
function drawMarquee(x1, y1) {
  if (!MARQ.box) { killMarquee(); MARQ.box = document.createElement("div"); MARQ.box.className = "marquee"; document.body.appendChild(MARQ.box); }
  var x = Math.min(x1, MARQ.x0), y = Math.min(y1, MARQ.y0),
      w = Math.abs(x1 - MARQ.x0), h = Math.abs(y1 - MARQ.y0);
  MARQ.box.style.cssText = "position:fixed;left:" + x + "px;top:" + y + "px;width:" + w + "px;height:" + h + "px";
}
/* Drag near the edge of a scroll container and it keeps scrolling (Nate's
   ask, both for a marquee select and, further down, the fill handle) — a
   plain pointermove-driven drag never fires again once the cursor stops
   moving, so an ordinary drag-to-the-edge just sits there instead of
   revealing more rows the way Excel/Sheets does. Shared by both drags:
   nudges wrap.scrollTop toward whichever edge (x,y) is within GRID_SCROLL
   _EDGE of, returns whether it actually scrolled. A setInterval-driven
   caller, not requestAnimationFrame — rAF callbacks are paused outright by
   the browser whenever the tab/window isn't the foreground one, which
   would silently kill auto-scroll the moment focus moved elsewhere
   mid-drag; a plain timer keeps firing regardless. Vertical only — that's
   what was asked; the same pattern extends to horizontal if needed. */
var GRID_SCROLL_EDGE = 28, GRID_SCROLL_SPEED = 14;
function edgeAutoScroll(wrap, x, y) {
  var r = wrap.getBoundingClientRect();
  if (x < r.left || x > r.right) return false;
  if (y < r.top + GRID_SCROLL_EDGE && wrap.scrollTop > 0) {
    wrap.scrollTop = Math.max(0, wrap.scrollTop - GRID_SCROLL_SPEED); return true;
  }
  if (y > r.bottom - GRID_SCROLL_EDGE && wrap.scrollTop + wrap.clientHeight < wrap.scrollHeight) {
    wrap.scrollTop = Math.min(wrap.scrollHeight - wrap.clientHeight, wrap.scrollTop + GRID_SCROLL_SPEED); return true;
  }
  return false;
}
function marqueeAutoScrollTick() {
  if (!MARQ || !MARQ.moved) return;
  if (edgeAutoScroll(MARQ.wrap, MARQ.lastX, MARQ.lastY)) {
    drawMarquee(MARQ.lastX, MARQ.lastY);
    setSel(boxTds(MARQ.wrap, MARQ.x0, MARQ.y0, MARQ.lastX, MARQ.lastY));
  }
}
function endMarquee() {
  if (!MARQ) return;
  clearInterval(MARQ.scrollTimer);
  killMarquee();
  if (!MARQ.moved) setSel([]);                       // keep the plain-click single cell
  MARQ = null;
}
/* ── Fill handle (D118) — Excel-style drag-to-fill ───────────────────────────
   V1 scope: single-cell source only (SEL, not a multi-cell marquee) — a
   selected block's tiled-pattern fill is a real Excel behavior but adds real
   complexity for a "click and fill a value" ask; easy to extend later.
   Reuses boxTds() from the marquee above, axis-constrained to the source
   cell's own row or column band so the drag only ever extends one direction
   at a time, same as Excel. Write path (fillCellOp) lives in 06 next to
   clearCellOp — same op/undo shape, one histPush per drag. */
var FILL = null;
function ensureFillHandleEl() {
  var el = document.getElementById("fillhandle");
  if (!el) { el = document.createElement("div"); el.id = "fillhandle"; document.body.appendChild(el); }
  return el;
}
function fillSourceTd() {
  if (!SEL || !SEL.dataset || !SEL.isConnected) return null;
  if (SEL.dataset.key) { var cv = CELLS[SEL.dataset.key]; if (cv && cv.oid) return null; }  // no fill over a load chip
  return SEL;
}
function positionFillHandle() {
  var el = ensureFillHandleEl(), td = fillSourceTd();
  if (!td) { el.style.display = "none"; return; }
  var r = td.getBoundingClientRect();
  el.style.left = (r.right - 4) + "px";
  el.style.top = (r.bottom - 4) + "px";
  el.style.display = "block";
}
function fillHandleDown(e) {
  var td = fillSourceTd(); if (!td) return;
  var wrap = td.closest(".grid-wrap"); if (!wrap) return;
  e.preventDefault(); e.stopPropagation();
  FILL = { source: td, wrap: wrap, targets: [], lastX: e.clientX, lastY: e.clientY,
           scrollTimer: setInterval(fillAutoScrollTick, 16) };
}
/* Highlight paints directly on the real target <td>s (a .fill-target class),
   not a separately-drawn overlay rectangle — that was the actual complaint:
   a floating div positioned by its own pixel math can drift out of alignment
   with the real cell borders/gaps, so the preview didn't visibly track what
   was really about to fill. Binding the highlight to the cells themselves
   makes misalignment impossible, same reasoning as the marquee's .selrange. */
function paintFillTargets(next) {
  var nextSet = next;
  FILL.targets.forEach(function (td) { if (nextSet.indexOf(td) < 0) td.classList.remove("fill-target"); });
  nextSet.forEach(function (td) { if (td !== FILL.source) td.classList.add("fill-target"); });
  FILL.targets = nextSet;
}
/* The actual box-and-paint math, factored out of the pointermove handler so
   the auto-scroll timer below can re-run it against the last known pointer
   position after a scroll shifts FILL.source (and every other cell)
   underneath it — same reasoning as the marquee's tick reusing boxTds. */
function fillHandleUpdate(x, y) {
  var r = FILL.source.getBoundingClientRect();
  var cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
  var vertical = Math.abs(y - cy) >= Math.abs(x - cx);
  var box = vertical
    ? { l: r.left, t: Math.min(r.top, y), rr: r.right, b: Math.max(r.bottom, y) }
    : { l: Math.min(r.left, x), t: r.top, rr: Math.max(r.right, x), b: r.bottom };
  // Inset every side 1px — boxTds' overlap test is inclusive (>=/<=), so a
  // box edge sitting exactly on a shared grid line also matches whatever
  // cell touches that same pixel from the other side. That happens on BOTH
  // axes here: the perpendicular one (source cell's own left/right, or
  // top/bottom, sits exactly on the next column's or row's edge) and the
  // fixed end of the drag axis (the source's own un-dragged edge sits
  // exactly on the cell before it). Caught live: dragging straight down one
  // column still filled the column next to it, and the row above the
  // source. The dragged (moving) edge tolerates the same inset fine — the
  // cursor is essentially never exactly on a boundary pixel mid-drag.
  box.l += 1; box.t += 1; box.rr -= 1; box.b -= 1;
  paintFillTargets(boxTds(FILL.wrap, box.l, box.t, box.rr, box.b));
}
function fillHandleMove(e) {
  if (!FILL) return;
  e.preventDefault();
  FILL.lastX = e.clientX; FILL.lastY = e.clientY;
  fillHandleUpdate(e.clientX, e.clientY);
}
function fillAutoScrollTick() {
  if (!FILL) return;
  if (edgeAutoScroll(FILL.wrap, FILL.lastX, FILL.lastY)) fillHandleUpdate(FILL.lastX, FILL.lastY);
}
/* Window losing focus mid-drag cancels, same as the marquee's blur handler
   — an interrupted drag shouldn't silently commit whatever happened to be
   highlighted at that moment. */
function cancelFillHandle() {
  if (!FILL) return;
  clearInterval(FILL.scrollTimer);
  FILL.targets.forEach(function (td) { td.classList.remove("fill-target"); });
  FILL = null;
}
function fillHandleUp() {
  if (!FILL) return;
  clearInterval(FILL.scrollTimer);
  var source = FILL.source, targets = FILL.targets.slice();
  targets.forEach(function (td) { td.classList.remove("fill-target"); });
  FILL = null;
  if (!targets.length) return;
  var val = fillValueOf(source);
  var ops = targets.map(function (td) { return fillCellOp(td, val); }).filter(Boolean);
  commitCellOps(ops, "fill", "Filled");
}
document.addEventListener("pointerdown", function (e) { if (e.target.closest("#fillhandle")) fillHandleDown(e); });
document.addEventListener("pointermove", fillHandleMove);
document.addEventListener("pointerup", fillHandleUp);
document.addEventListener("pointercancel", fillHandleUp);
document.addEventListener("scroll", positionFillHandle, true);

/* ── Note border-drag (D254) — Excel-style "grab the selection's edge to
   move it," scoped to a plain text schedule_notes cell (Nate: "on those
   text notes id like to be able to move them if i click and drag from the
   borders of the selection but leave the drag and fill dot on there and
   functionality alone"). Registered BEFORE selStart below so it can claim
   the pointerdown first — same document-target, so only
   stopImmediatePropagation (not stopPropagation) actually keeps selStart
   from also processing it. Only the cell the SELECTION is already on
   counts (matching the fill handle's own "already selected" precondition,
   D118) — grabbing near some OTHER cell's edge is just normal
   marquee/selection, not a move. Moves text only, same scope choice D250
   made for the drag-a-chip-onto-a-note case: the destination keeps
   whatever fmt it already had (scheduleNote's upsert only ever touches
   `body`) and the source clears via the same scheduleNote(key,"") call
   D82's "clearing keeps fmt" behavior already uses elsewhere — no attempt
   to also carry fmt/category across, consistent rather than a special case. */
var NOTEDRAG = null;
var NOTE_BORDER_PX = 6;
function noteDragSourceTd(e) {
  if (!SEL || SEL.dataset.key == null) return null;
  var cv = CELLS[SEL.dataset.key];
  if (!cv || cv.oid || !cv.text) return null;              // real text note only, never a load or blank cell
  if (e.target.closest("td[data-key]") !== SEL) return null; // only the selection's own border
  var r = SEL.getBoundingClientRect();
  var nearEdge = e.clientX - r.left <= NOTE_BORDER_PX || r.right - e.clientX <= NOTE_BORDER_PX ||
    e.clientY - r.top <= NOTE_BORDER_PX || r.bottom - e.clientY <= NOTE_BORDER_PX;
  return nearEdge ? SEL : null;
}
function noteDragUpdate(x, y) {
  var el = document.elementFromPoint(x, y);
  var td = el && el.closest("td[data-key]");
  if (NOTEDRAG.target && NOTEDRAG.target !== td) NOTEDRAG.target.classList.remove("note-drop-target");
  if (td && td !== NOTEDRAG.source && !cellHasLoad(td.dataset.key)) {
    td.classList.add("note-drop-target"); NOTEDRAG.target = td;
  } else {
    NOTEDRAG.target = null;
  }
}
function noteDragAutoScrollTick() {
  if (!NOTEDRAG) return;
  if (edgeAutoScroll(NOTEDRAG.wrap, NOTEDRAG.lastX, NOTEDRAG.lastY)) noteDragUpdate(NOTEDRAG.lastX, NOTEDRAG.lastY);
}
function noteDragStart(e, td) {
  var wrap = td.closest(".grid-wrap"); if (!wrap) return;
  e.preventDefault(); e.stopImmediatePropagation();
  NOTEDRAG = { source: td, key: td.dataset.key, text: CELLS[td.dataset.key].text, wrap: wrap,
               target: null, lastX: e.clientX, lastY: e.clientY,
               scrollTimer: setInterval(noteDragAutoScrollTick, 16) };
  td.classList.add("note-dragging");
}
function noteDragMove(e) {
  if (!NOTEDRAG) return;
  e.preventDefault();
  NOTEDRAG.lastX = e.clientX; NOTEDRAG.lastY = e.clientY;
  noteDragUpdate(e.clientX, e.clientY);
}
function noteDragEnd() {
  if (!NOTEDRAG) return;
  clearInterval(NOTEDRAG.scrollTimer);
  NOTEDRAG.source.classList.remove("note-dragging");
  if (NOTEDRAG.target) NOTEDRAG.target.classList.remove("note-drop-target");
  var fromKey = NOTEDRAG.key, toKey = NOTEDRAG.target && NOTEDRAG.target.dataset.key, text = NOTEDRAG.text;
  NOTEDRAG = null;
  if (!toKey || toKey === fromKey) return;
  confirmHistoricalMove(fromKey, toKey, function () {
    scheduleNote(toKey, text).then(function () { return scheduleNote(fromKey, ""); }).then(function () {
      histPush("move note",
        function () { return scheduleNote(fromKey, text).then(function () { return scheduleNote(toKey, ""); }); },
        function () { return scheduleNote(toKey, text).then(function () { return scheduleNote(fromKey, ""); }); });
    }).catch(function (err) { toast(err.message, true); });
  });
}
document.addEventListener("pointerdown", function (e) {
  if (e.target.closest("#fillhandle")) return; // fill handle owns this (checked first, above)
  var td = noteDragSourceTd(e);
  if (td) noteDragStart(e, td);
});
document.addEventListener("pointermove", noteDragMove);
document.addEventListener("pointerup", noteDragEnd);
document.addEventListener("pointercancel", noteDragEnd);

/* Pointer events drive it (unifies mouse/trackpad/touch); a parallel `mousedown`
   is NOT added so the two never fight. */
document.addEventListener("pointerdown", selStart);
document.addEventListener("pointermove", selMove);
document.addEventListener("pointerup", endMarquee);
document.addEventListener("pointercancel", endMarquee);
/* Safari fires selectstart even after pointerdown.preventDefault(); kill it while
   a marquee drag is live so no page text gets highlighted. */
document.addEventListener("selectstart", function (e) { if (MARQ && MARQ.moved) e.preventDefault(); });
window.addEventListener("blur", endMarquee);
window.addEventListener("blur", cancelFillHandle);

/* ── Copy/paste (D120) — Sheets-style, app-wide, same value model as the fill
   handle (D118): copy captures the current selection as a rectangular value
   grid by real visual row/col position (not selection order); paste tiles
   that grid across whatever is currently selected, repeating the pattern
   when the paste target is a different size — exactly what Nate asked for
   ("paste over multiple cells, whatever you select"), same as real Sheets. */
var VALCLIP = null;        // { grid: [[val,...],...], h, w }
var COPY_SRC = [];         // cells currently painted as "just copied" (.copy-marquee)
function selectionCells() {
  if (typeof SELSET !== "undefined" && SELSET.length) return SELSET.slice();
  return SEL ? [SEL] : [];
}
/* Group cells into a 2D grid by visual row (top) then column (left) —
   rounded to whole pixels so subpixel layout noise can't split one real row
   or column into two. Works for any rectangular selection: a single cell, a
   marquee block, or a whole-row/whole-column selection. */
function gridShape(tds) {
  var rowTops = [], colLefts = [];
  tds.forEach(function (td) {
    var r = td.getBoundingClientRect(), top = Math.round(r.top), left = Math.round(r.left);
    if (rowTops.indexOf(top) < 0) rowTops.push(top);
    if (colLefts.indexOf(left) < 0) colLefts.push(left);
  });
  rowTops.sort(function (a, b) { return a - b; });
  colLefts.sort(function (a, b) { return a - b; });
  var grid = rowTops.map(function () { return new Array(colLefts.length).fill(null); });
  tds.forEach(function (td) {
    var r = td.getBoundingClientRect();
    var ri = rowTops.indexOf(Math.round(r.top)), ci = colLefts.indexOf(Math.round(r.left));
    grid[ri][ci] = td;
  });
  return { grid: grid, h: rowTops.length, w: colLefts.length };
}
function clearCopyHighlight() {
  COPY_SRC.forEach(function (td) { td.classList.remove("copy-marquee"); });
  COPY_SRC = [];
}
function copySelection() {
  var cells = selectionCells().filter(function (td) {
    var cv = td.dataset.key && CELLS[td.dataset.key];
    return !(cv && cv.oid);   // a load chip has no plain "value" to copy (fill-handle rule, D118)
  });
  if (!cells.length) { toast("Nothing to copy here", true); return; }
  var shape = gridShape(cells);
  VALCLIP = { h: shape.h, w: shape.w,
    grid: shape.grid.map(function (row) { return row.map(function (td) { return td ? fillValueOf(td) : ""; }); }) };
  clearCopyHighlight();
  COPY_SRC = cells;
  cells.forEach(function (td) { td.classList.add("copy-marquee"); });
  toast(cells.length === 1 ? "Cell copied" : "Range copied");
}
function pasteSelection() {
  if (!VALCLIP) { toast("Nothing copied", true); return; }
  var cells = selectionCells();
  if (!cells.length) { toast("Select where to paste", true); return; }
  var shape = gridShape(cells);
  var ops = [];
  for (var r = 0; r < shape.h; r++) {
    for (var c = 0; c < shape.w; c++) {
      var td = shape.grid[r][c]; if (!td) continue;
      var op = fillCellOp(td, VALCLIP.grid[r % VALCLIP.h][c % VALCLIP.w]);
      if (op) ops.push(op);
    }
  }
  clearCopyHighlight();   // Sheets consumes the marching-ants highlight on paste
  commitCellOps(ops, "paste", "Pasted");
}

/* ── Smart date-range inputs (D151) ───────────────────────────────────────
   Nate: "all the date ranges that you can type into should be seamless i
   can type 08/22/2026 or... 8 tab 22 tab 2026... make it easier to work
   with tabs and slashes being the same thing inside the dates." A native
   <input type=date> has no JS-visible way to move its own internal
   segment cursor, so "/" (or a mid-date Tab) can never act as a segment
   advance inside one — there is no browser API for it. These specific
   range fields (Reports From/To, Current Week/Driver Tabs' "First day
   drivers see") are plain `type=text` with a `data-smartdate` marker
   instead; this module owns all typing/backspace/paste inside them and
   is the only thing that writes their `.value`. `.value` is ALWAYS the
   committed ISO date ("" while genuinely empty) — never the mid-typing
   MM/DD/YYYY buffer — so every existing reader elsewhere in the app
   keeps working unmodified; the visible text during editing is cosmetic
   only, restored to the real value on blur if nothing usable was typed.

   Segments: month, day, year — index 0/1/2. "/" always advances one
   segment (never leaves the field). Digits fill the active segment and
   auto-advance once it's full (2 digits for month/day, 4 for year) —
   typing "08222026" straight through works with no separators at all.
   Tab is context-sensitive: on the month segment it just advances to day
   (typing a bare month isn't a usable date yet); from day or year
   onward it COMMITS immediately — inferring the year from the field's
   last real value, or today's year if it never had one — and does NOT
   preventDefault, so focus actually leaves exactly like a normal Tab.
   That's the whole "8 tab 22 [tab away] and it just goes" flow. */
var SMARTDATE = new WeakMap();  // el -> { seg: ["","",""], cur: 0, fresh, touched, justAdvanced, opened }
var SMARTDATE_MAX = [2, 2, 4];
function smartDateState(el) {
  var s = SMARTDATE.get(el);
  if (!s) {
    s = { seg: ["", "", ""], cur: 0, fresh: true, touched: false, justAdvanced: false, opened: [true, true, true] };
    SMARTDATE.set(el, s);
  }
  return s;
}
function smartDateDisplay(s) {
  var parts = [s.seg[0], s.seg[1], s.seg[2]];
  while (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  return parts.join("/");
}
function smartDateRender(el, s) { el.value = smartDateDisplay(s); }
function smartDateReset(el) {
  var s = smartDateState(el);
  s.seg = ["", "", ""]; s.cur = 0; s.fresh = false; s.justAdvanced = false; s.opened = [true, true, true];
  return s;
}
/* Feed one run of digits through the same fill/auto-advance logic a real
   keystroke uses — shared by typing and paste so both behave identically.
   Tracks whether the LAST digit auto-advanced the segment, so an explicit
   "/" immediately after (e.g. the middle slash in "08/20/2026", typed
   right after "08" already auto-advanced past month) can tell "the user
   is confirming a boundary that already happened" from "the user wants
   to skip the rest of this segment" and not double-advance past day.

   `opened` (D226 follow-up) tracks which segments still hold a REAL
   pre-edit value the click handler preserved, vs. one that's already been
   started fresh this session. A segment reached by auto-advance (filling
   month rolls into day), "/", or a Tab-driven cur move is only cleared the
   first time a digit actually lands in it — not eagerly on arrival — so a
   user who clicks the day, types it, and stops never touches the untouched
   year at all. Without this, that first digit APPENDED onto the old value
   (e.g. day "14"→"20" rolls into a year that's still "2026", and one more
   keystroke made it "20265"), which either overflowed into nonsense or, on
   commit, failed length validation and silently fell back to the stale
   year — Nate's "if I go to type the day... takes the year away." */
function smartDateFeed(el, digits) {
  var s = smartDateState(el);
  s.touched = true;
  for (var i = 0; i < digits.length; i++) {
    if (s.cur > 2) break;
    if (!s.opened[s.cur]) { s.seg[s.cur] = ""; s.opened[s.cur] = true; }
    s.seg[s.cur] += digits[i];
    s.justAdvanced = false;
    if (s.seg[s.cur].length >= SMARTDATE_MAX[s.cur] && s.cur < 2) { s.cur++; s.justAdvanced = true; }
  }
  smartDateRender(el, s);
}
/* Commit reads the tracked segments directly (mm/dd/yyyy), never the
   joined display text — a flat "how many digits total" guess can't tell
   a single-digit month from a two-digit one once a year is also typed
   (07202026, is that 07/20/26 or a garbled 7/2/2026?), but the segments
   already know which digits went where as they were typed, so there's
   nothing to guess. Clears to blank (not left stale) if what's typed
   doesn't add up to a real date, fires 'change' so existing listeners
   elsewhere fire exactly as they would for a real type=date input. */
function smartDateCommit(el) {
  var s = smartDateState(el);
  var m = parseInt(s.seg[0], 10), d = parseInt(s.seg[1], 10), iso = "";
  if (m && d && m <= 12 && d <= 31) {
    var y;
    if (s.seg[2].length === 4) y = parseInt(s.seg[2], 10);
    else if (s.seg[2].length === 2) y = 2000 + parseInt(s.seg[2], 10);
    else {
      var fb = el.dataset.lastIso, fbY = fb && /^\d{4}-\d{2}-\d{2}$/.test(fb) ? fb.slice(0, 4) : null;
      y = fbY ? parseInt(fbY, 10) : new Date().getFullYear();
    }
    iso = y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  }
  // The resting display is always MM/DD/YYYY, matching how the field looks
  // right after a fresh render — .value is cosmetic here, never read
  // directly by anything downstream. The real ISO lives in data-last-iso;
  // every reader (the #cw-start change handler, the Reports export click
  // handler) reads that instead of .value.
  el.value = isoToMdy(iso) || "";
  if (iso) el.dataset.lastIso = iso; else el.removeAttribute("data-last-iso");
  SMARTDATE.delete(el);
  // Both events, not just one — different consumers listen for different
  // ones (order-tracker/#cw-start fields save on 'change'; drawer [data-of]
  // fields save on 'blur', comparing against data-undo-prev-iso). A Tab-
  // triggered commit runs from inside a keydown handler, before the
  // browser's own focus change would fire a REAL blur — a dispatched
  // keydown never triggers native focus traversal on its own, so without
  // this the drawer's blur-driven save would just never run (caught live:
  // typing a drawer delivery date and tabbing off left Postgres untouched,
  // no /api/order/update at all). dispatchEvent is synchronous, so the
  // save handler below runs to completion (reading the still-stale
  // data-undo-prev-iso) before the sync lines after this run.
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur"));
  // NOW sync the pre-edit markers — after the listeners above already used
  // them. Left until after, the REAL blur the browser fires moments later
  // (when focus actually leaves for real) sees prev already equal to next
  // and correctly no-ops instead of firing a second, duplicate save.
  el.dataset.undoPrev = el.value; el.dataset.undoPrevIso = el.dataset.lastIso || "";
}
document.addEventListener("focus", function (e) {
  var el = e.target.closest && e.target.closest("[data-smartdate]");
  if (!el) return;
  // The rendered `data-last-iso` attribute is authoritative for the real
  // ISO value (the visible .value is always MM/DD/YYYY once rendered) —
  // only fall back to parsing .value for an element that never got one.
  if (!el.dataset.lastIso) el.dataset.lastIso = mdyToIso(el.value) || "";
  el.value = isoToMdy(el.dataset.lastIso) || el.value;
  smartDateReset(el).fresh = true;
}, true);
/* A mouse click (unlike Tab-in) is the user aiming at ONE part of an
   existing date — Nate: "let me select one part of the date without
   deleting the entire date... if i click and type it wipes it." The focus
   handler above always wipes to a blank fresh-typing state (by design,
   D151's "tab in and just type a whole new date" flow); this runs right
   after it for a real click and re-seeds the segments from the current
   value, positions `cur` at whichever segment the caret landed in, and
   blanks only THAT segment so the next digit replaces it while month/day/
   year elsewhere stay put. Skipped once the user has already typed
   something this focus session (`touched`) — clicking around mid-edit
   doesn't reposition, same as before. */
document.addEventListener("click", function (e) {
  var el = e.target.closest && e.target.closest("[data-smartdate]");
  if (!el || document.activeElement !== el) return;
  var s = smartDateState(el);
  if (s.touched) return;
  var iso = el.dataset.lastIso || "";
  s.seg = [iso.slice(5, 7), iso.slice(8, 10), iso.slice(0, 4)];
  var pos = el.selectionStart == null ? 0 : el.selectionStart;
  s.cur = pos < 3 ? 0 : pos < 6 ? 1 : 2;
  s.seg[s.cur] = "";
  // Only the clicked segment is pre-cleared — the other two hold real
  // values that must survive untouched unless the user actually types into
  // them too (smartDateFeed's `opened` check clears on that first digit).
  s.opened = [false, false, false];
  s.opened[s.cur] = true;
  s.fresh = false;
  s.justAdvanced = false;
});
document.addEventListener("blur", function (e) {
  var el = e.target.closest && e.target.closest("[data-smartdate]");
  // Only commit if the user actually edited something — a plain focus-then-
  // blur (tabbing through without typing) must never blank out a real value.
  if (el && SMARTDATE.has(el)) {
    if (SMARTDATE.get(el).touched) smartDateCommit(el);
    else { el.value = el.dataset.lastIso || ""; SMARTDATE.delete(el); }
  }
}, true);
document.addEventListener("keydown", function (e) {
  var el = e.target.closest && e.target.closest("[data-smartdate]");
  if (!el) return;
  var s = smartDateState(el);
  if (/^[0-9]$/.test(e.key)) {
    e.preventDefault();
    if (s.fresh) s = smartDateReset(el);
    smartDateFeed(el, e.key);
    return;
  }
  if (e.key === "/") {
    e.preventDefault();
    s.fresh = false; s.touched = true;
    // A full segment already auto-advanced on its last digit — this "/"
    // is just confirming that boundary, not asking for a second advance
    // past the segment that's now current (the actual bug this guards:
    // "08" auto-advances to day, then the "/" typed right after would
    // otherwise skip day entirely and land on year).
    if (s.justAdvanced) { s.justAdvanced = false; }
    else if (s.cur < 2) s.cur++;
    smartDateRender(el, s);
    return;
  }
  if (e.key === "Backspace") {
    e.preventDefault();
    s.fresh = false; s.touched = true; s.justAdvanced = false;
    if (s.seg[s.cur]) s.seg[s.cur] = s.seg[s.cur].slice(0, -1);
    else if (s.cur > 0) { s.cur--; s.seg[s.cur] = s.seg[s.cur].slice(0, -1); }
    smartDateRender(el, s);
    return;
  }
  if (e.key === "Tab") {
    if (s.cur === 0 && (s.seg[0] || s.seg[1] || s.seg[2])) {
      e.preventDefault(); s.fresh = false; s.cur = 1; smartDateRender(el, s); return;
    }
    if (s.seg[0] || s.seg[1] || s.seg[2]) smartDateCommit(el);  // else: nothing typed, let Tab just leave
    return;
  }
  if (e.key === "Escape") { el.value = isoToMdy(el.dataset.lastIso || ""); SMARTDATE.delete(el); el.blur(); }
});
document.addEventListener("paste", function (e) {
  var el = e.target.closest && e.target.closest("[data-smartdate]");
  if (!el) return;
  e.preventDefault();
  var text = (e.clipboardData || window.clipboardData).getData("text");
  var digits = text.replace(/\D/g, "");
  if (!digits) return;
  if (smartDateState(el).fresh) smartDateReset(el);
  smartDateFeed(el, digits);
});
/* ═══ 11-toolbar ═══ */
/* ── Formatting toolbar (D67) — a Sheets-style bar under the header, global but
   its color/text controls act on the Scheduler / Current Week selection. ───── */
/* The exact Google Sheets standard palette (same hex values Nate uses there). */
var SHEETS_COLORS = [
  ["#000000","#434343","#666666","#999999","#b7b7b7","#cccccc","#d9d9d9","#efefef","#f3f3f3","#ffffff"],
  ["#980000","#ff0000","#ff9900","#ffff00","#00ff00","#00ffff","#4a86e8","#0000ff","#9900ff","#ff00ff"],
  ["#e6b8af","#f4cccc","#fce5cd","#fff2cc","#d9ead3","#d0e0e3","#c9daf8","#cfe2f3","#d9d2e9","#ead1dc"],
  ["#dd7e6b","#ea9999","#f9cb9c","#ffe599","#b6d7a8","#a2c4c9","#a4c2f4","#9fc5e8","#b4a7d6","#d5a6bd"],
  ["#cc4125","#e06666","#f6b26b","#ffd966","#93c47d","#76a5af","#6d9eeb","#6fa8dc","#8e7cc3","#c27ba0"],
  ["#a61c00","#cc0000","#e69138","#f1c232","#6aa84f","#45818e","#3c78d8","#3d85c6","#674ea7","#a64d79"],
  ["#85200c","#990000","#b45f06","#bf9000","#38761d","#134f5c","#1155cc","#0b5394","#351c75","#741b47"],
  ["#5b0f00","#660000","#783f04","#7f6000","#274e13","#0c343d","#1c4587","#073763","#20124d","#4c1130"]
];
/* Sheets color picker popover: standard grid + custom hex + "no fill". */
function openSheetsPicker(x, y, onPick, initialColor, showOpacity) {
  closePalette();
  var base = colorBase(initialColor || "#ffffff"), opacity = colorOpacity(initialColor || "#ffffff");
  var el = document.createElement("div"); el.id = "palette"; el.className = "swpick";
  var grid = SHEETS_COLORS.map(function (row) {
    return '<div class="sw-row">' + row.map(function (c) {
      return '<button class="sw-cell" data-hex="' + c + '" title="' + c + '" style="background:' + c + '"></button>';
    }).join("") + "</div>";
  }).join("");
  el.innerHTML =
    '<button class="sw-none" data-hex="">&#8856; No fill</button>' +
    '<div class="sw-grid">' + grid + "</div>" +
    '<div class="sw-custom"><input type="color" id="sw-hex" value="' + base + '">' +
    '<input type="text" id="sw-hex-text" class="hex-text" value="' + base + '" maxlength="7" placeholder="#rrggbb" spellcheck="false"><span>Custom</span>' +
    (showOpacity ? '<label class="sw-opacity">Opacity <input type="range" id="sw-opacity" min="10" max="100" value="' + opacity + '"><output id="sw-opacity-value">' + opacity + '%</output></label>' : "") +
    '<button class="btn sm" id="sw-apply">Apply</button></div>';
  document.body.appendChild(el);
  var r = el.getBoundingClientRect();
  el.style.left = Math.min(x, window.innerWidth - r.width - 8) + "px";
  el.style.top = Math.min(y, window.innerHeight - r.height - 8) + "px";
  el.addEventListener("click", function (e) {
    if (e.target.id === "sw-apply") { onPick(colorWithOpacity(hexInputValue($("#sw-hex-text"), $("#sw-hex")), showOpacity ? $("#sw-opacity").value : 100)); closePalette(); return; }
    var b = e.target.closest("[data-hex]"); if (!b) return;
    var picked = b.getAttribute("data-hex");
    onPick(picked ? colorWithOpacity(picked, showOpacity ? $("#sw-opacity").value : 100) : ""); closePalette();
  });
  el.addEventListener("input", function (e) {
    if (e.target.id === "sw-opacity") $("#sw-opacity-value").value = e.target.value + "%";
    else if (e.target.id === "sw-hex") $("#sw-hex-text").value = e.target.value;
    else if (e.target.id === "sw-hex-text") { var hx = normalizeHex(e.target.value); if (hx) $("#sw-hex").value = hx; }
  });
  PALETTE_ON = true;
}
/* A 3- or 6-digit #hex, with or without the leading #, normalized to
   "#rrggbb" for <input type=color> — null if what's typed isn't a hex color
   yet (mid-edit), so callers can leave the swatch alone until it is one. */
function normalizeHex(v) {
  var s = (v || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(s)) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  return /^[0-9a-fA-F]{6}$/.test(s) ? "#" + s.toLowerCase() : null;
}
/* The color to actually apply from a swatch+text pair: whatever's typed if
   it's valid hex, else the native color input's own (always-valid) value —
   covers a stray edit left mid-typo when Apply is clicked. */
function hexInputValue(textEl, colorEl) {
  return (textEl && normalizeHex(textEl.value)) || (colorEl ? colorEl.value : "#888888");
}

/* A format target is a scheduler/Current-Week cell OR a sheet cell (D75). Read
   from the marquee selection (SELSET elements) else the single selected cell. */
/* Map each selected element to a format target (keeping the element, so border
   ops can read on-screen grid positions). */
function targetEls() {
  var els = (typeof SELSET !== "undefined" && SELSET.length) ? SELSET : (SEL ? [SEL] : []);
  var out = [];
  els.forEach(function (td) {
    var t = null;
    if (td.dataset && td.dataset.sheet) t = { kind: "sheet", sid: td.dataset.sheet, r: +td.dataset.r, c: +td.dataset.c };
    else if (td.dataset && td.dataset.field && td.dataset.table && td.dataset.table !== "sheet" && td.dataset.id)
      t = { kind: "grid", table: td.dataset.table, id: td.dataset.id, field: td.dataset.field };
    else if (td.dataset && td.dataset.key && !td.dataset.field && td.dataset.key.split("|").length === 3) t = { kind: "sched", key: td.dataset.key };
    if (t) out.push({ el: td, t: t });
  });
  return out;
}
function fmtTargets() { return targetEls().map(function (p) { return p.t; }); }
/* The live DOM node for a target descriptor — used to re-resolve a stale SELSET
   element (detached by a re-render) before border ops read its on-screen rect,
   so positional borders don't collapse onto row 0/col 0 (D82). */
function liveTargetEl(t) {
  if (t.kind === "sheet") return document.querySelector('td[data-sheet="' + t.sid + '"][data-r="' + t.r + '"][data-c="' + t.c + '"]');
  if (t.kind === "grid") return document.querySelector('td[data-table="' + t.table + '"][data-id="' + t.id + '"][data-field="' + CSS.escape(t.field) + '"]');
  var sel = 'td[data-key="' + CSS.escape(t.key) + '"]';
  return document.querySelector(sel) || (typeof schedNode !== "undefined" && schedNode && schedNode.querySelector(sel)) || null;
}
function fmtCurrentOf(t) {
  if (t.kind === "sheet") { var sc = (SHEETCELLS[t.sid] || {})[t.r + "|" + t.c]; return (sc && sc.fmt) || {}; }
  if (t.kind === "grid") return gridFmtOf(t.table, t.id, t.field);
  var cv = CELLS[t.key]; return (cv && cv.fmt) || {};
}
/* Toolbar choices are useful before a cell is selected too.  Keep the chosen
   format as a small "next selection" preset, then consume it as soon as the
   user selects a cell.  This makes the bar behave like a spreadsheet toolbar
   instead of making a color picker fail after the user has already chosen one. */
var PENDING_FMT = {};
var PENDING_BORDER = null;
var PENDING_CLEAR = false;
function firstFmt() { var t = fmtTargets(); return t.length ? fmtCurrentOf(t[0]) : PENDING_FMT; }
function queueFormat(patch, label) {
  PENDING_FMT = mergeFmt(PENDING_FMT, patch, false);
  PENDING_CLEAR = false;
  renderFmtBar();
  toast((label || "Format") + " ready — select cell(s) to apply");
}
function applyPendingFormat() {
  if (!fmtTargets().length || (!Object.keys(PENDING_FMT).length && !PENDING_BORDER && !PENDING_CLEAR)) return;
  var patch = PENDING_FMT, border = PENDING_BORDER, clear = PENDING_CLEAR;
  PENDING_FMT = {}; PENDING_BORDER = null; PENDING_CLEAR = false;
  if (clear) clearFormatting();
  if (Object.keys(patch).length) applyFormat(patch, "format");
  if (border) applyBorder(border);
}
function mergeFmt(base, patch, replace) {
  var out = replace ? {} : JSON.parse(JSON.stringify(base || {}));
  for (var k in patch) { if (patch[k] == null || patch[k] === "") delete out[k]; else out[k] = patch[k]; }
  return out;
}
/* Apply a fmt patch (or full replace, for undo) to one target; update the local
   model + repaint in place. */
function fmtApply(t, patch, replace) {
  if (t.kind === "sheet") {
    return api("sheet/cell", { sheet_id: t.sid, r: t.r, c: t.c, fmt: patch, replace: !!replace }).then(function () {
      var m = SHEETCELLS[t.sid] = SHEETCELLS[t.sid] || {};
      var sc = m[t.r + "|" + t.c] = m[t.r + "|" + t.c] || { value: null, fmt: {} };
      sc.fmt = mergeFmt(sc.fmt, patch, replace);
      if ((sc.value == null || sc.value === "") && Object.keys(sc.fmt).length === 0) delete m[t.r + "|" + t.c];
      repaintSheetCell(t.sid, t.r, t.c);
    });
  }
  if (t.kind === "grid") {
    return api("grid/cell-fmt", { table: t.table, id: t.id, field: t.field, fmt: patch, replace: !!replace }).then(function () {
      var k = t.table + "|" + t.id + "|" + t.field, nf = mergeFmt(GRIDFMT[k] || {}, patch, replace);
      if (Object.keys(nf).length === 0) delete GRIDFMT[k]; else GRIDFMT[k] = nf;
      repaintGridCell(t.table, t.id, t.field);
    });
  }
  var p = t.key.split("|");
  return api("cell/format", { truck_id: p[0], date: p[1], slot: +p[2], patch: patch, replace: !!replace }).then(function () {
    var cv = CELLS[t.key]; if (!cv) cv = CELLS[t.key] = { text: "", fmt: {} };
    cv.fmt = mergeFmt(cv.fmt, patch, replace);
    if (!cv.oid && !(cv.text || "").trim() && !cv.catId && Object.keys(cv.fmt).length === 0) delete CELLS[t.key];
    repaintCell(t.key);
  });
}
/* Replace a target's whole fmt (undo path). */
function fmtSetFull(t, fmt) { return fmtApply(t, fmt || {}, true); }
/* Merge a patch into each selected cell's fmt; one undoable step. */
function applyFormat(patch, label) {
  var ts = fmtTargets();
  if (!ts.length) { queueFormat(patch, label); return; }
  var before = ts.map(function (t) { return { t: t, fmt: JSON.parse(JSON.stringify(fmtCurrentOf(t))) }; });
  function apply1(t) { return fmtApply(t, patch, false); }
  Promise.all(ts.map(apply1)).then(function () {
    histPush(label || "format " + ts.length + " cell" + (ts.length > 1 ? "s" : ""),
      function () { return Promise.all(before.map(function (b) { return fmtSetFull(b.t, b.fmt); })); },
      function () { return Promise.all(ts.map(apply1)); });
    renderFmtBar();   // reflect the NEW state — model updates async, so refresh here not synchronously after the call (D82)
  }).catch(function (e) { toast(e.message, true); });
}

/* ── Cell borders (D73; Sheets-parity window D79) — real per-side CSS borders on
   each selected cell, with a color pencil and a line-style/thickness picker.
   Positional ops (outer/inner/horizontal/vertical/edge) resolve against the
   on-screen grid rectangle of the selection. Stored as
   fmt.border { t,b,l,r:hex, s:style, w:px }. */
var BORDER_COLOR = "#000000", BORDER_STYLE = "solid", BORDER_WIDTH = 1;
/* Line-style presets shown in the picker (thickness + dashed/dotted), Sheets-style. */
var BORDER_PRESETS = [
  ["solid", 1, "Thin"], ["solid", 2, "Medium"], ["solid", 3, "Thick"],
  ["dashed", 1, "Dashed"], ["dotted", 1, "Dotted"]];
/* Last-used fill/text color (D78) — Sheets shows a colored bar under the bucket/
   text icons and one click re-applies that color. Persisted per device. */
var LAST_FILL = localStorage.getItem("lastFill") || "#ffff00";
var LAST_TEXT = localStorage.getItem("lastText") || "#000000";
/* Group selected cells into a visual grid by their on-screen top/left, so a
   positional border op knows each cell's row/col and the selection's edges. */
function borderGrid(pairs) {
  pairs.forEach(function (p) { var r = p.el.getBoundingClientRect(); p._t = Math.round(r.top); p._l = Math.round(r.left); });
  function uniq(vals) {
    vals = vals.slice().sort(function (a, b) { return a - b; });
    var u = []; vals.forEach(function (v) { if (!u.length || Math.abs(v - u[u.length - 1]) > 3) u.push(v); }); return u;
  }
  function idx(arr, v) { for (var i = 0; i < arr.length; i++) if (Math.abs(arr[i] - v) <= 3) return i; return 0; }
  var rows = uniq(pairs.map(function (p) { return p._t; })), cols = uniq(pairs.map(function (p) { return p._l; }));
  pairs.forEach(function (p) { p._r = idx(rows, p._t); p._c = idx(cols, p._l); });
  return { rmax: rows.length - 1, cmax: cols.length - 1 };
}
function borderSides(op, p, g) {
  var s = {}, r = p._r, c = p._c;
  if (op === "all") s = { t: 1, b: 1, l: 1, r: 1 };
  else if (op === "outer") { if (r === 0) s.t = 1; if (r === g.rmax) s.b = 1; if (c === 0) s.l = 1; if (c === g.cmax) s.r = 1; }
  else if (op === "inner") { if (r < g.rmax) s.b = 1; if (c < g.cmax) s.r = 1; }
  else if (op === "horiz") { if (r < g.rmax) s.b = 1; }
  else if (op === "vert") { if (c < g.cmax) s.r = 1; }
  else if (op === "left") { if (c === 0) s.l = 1; }
  else if (op === "right") { if (c === g.cmax) s.r = 1; }
  else if (op === "top") { if (r === 0) s.t = 1; }
  else if (op === "bottom") { if (r === g.rmax) s.b = 1; }
  return s;
}
function applyBorder(op) {
  var pairs = targetEls();
  if (!pairs.length) {
    PENDING_BORDER = op;
    PENDING_CLEAR = false;
    renderFmtBar();
    toast("Borders ready — select cell(s) to apply");
    return;
  }
  // Re-point any element detached by a re-render to its live node so borderGrid
  // reads real on-screen positions (D82).
  pairs.forEach(function (p) { if (!p.el.isConnected) { var live = liveTargetEl(p.t); if (live) p.el = live; } });
  var g = borderGrid(pairs);
  var before = pairs.map(function (p) { return { t: p.t, fmt: JSON.parse(JSON.stringify(fmtCurrentOf(p.t))) }; });
  function patchFor(p) {
    if (op === "none") return fmtCurrentOf(p.t).border ? { border: null } : null;
    var cur = fmtCurrentOf(p.t).border ? JSON.parse(JSON.stringify(fmtCurrentOf(p.t).border)) : {};
    var sides = borderSides(op, p, g), added = false;
    ["t", "b", "l", "r"].forEach(function (k) { if (sides[k]) { cur[k] = BORDER_COLOR; added = true; } });
    if (!added) return null;                     // edge op that doesn't touch this cell
    cur.s = BORDER_STYLE; cur.w = BORDER_WIDTH;
    return { border: cur };
  }
  var work = pairs.map(function (p) { return { p: p, patch: patchFor(p) }; }).filter(function (x) { return x.patch; });
  if (!work.length) return;
  function apply1(x) { return fmtApply(x.p.t, x.patch, false); }
  Promise.all(work.map(apply1)).then(function () {
    histPush(op === "none" ? "clear borders" : "borders",
      function () { return Promise.all(before.map(function (b) { return fmtSetFull(b.t, b.fmt); })); },
      function () { return Promise.all(work.map(apply1)); });
  }).catch(function (e) { toast(e.message, true); });
}
/* A horizontal line preview in the given style/width (for the style picker). */
function bordLineSvg(style, w) {
  var dash = style === "dashed" ? ' stroke-dasharray="5 3"' : style === "dotted" ? ' stroke-dasharray="0.5 3.5" stroke-linecap="round"' : "";
  return '<svg width="46" height="12" viewBox="0 0 46 12" aria-hidden="true"><line x1="2" y1="6" x2="44" y2="6" stroke="currentColor" stroke-width="' + w + '"' + dash + "/></svg>";
}
function bordBtn(op, title) { return '<button class="bord-b" data-bord="' + op + '" title="' + title + '">' + bordIcon(op) + "</button>"; }
function openBorderMenu(x, y) {
  closePalette();
  var el = document.createElement("div"); el.id = "palette"; el.className = "bordmenu";
  var row1 = [["all", "All borders"], ["inner", "Inner borders"], ["horiz", "Horizontal inner"], ["vert", "Vertical inner"], ["outer", "Outer border"]];
  var row2 = [["left", "Left border"], ["top", "Top border"], ["right", "Right border"], ["bottom", "Bottom border"], ["none", "Clear borders"]];
  function row(ops) { return ops.map(function (o) { return bordBtn(o[0], o[1]); }).join(""); }
  el.innerHTML =
    '<div class="bord-body">' +
      '<div class="bord-grid">' + row(row1) + row(row2) + "</div>" +
      '<div class="bord-tools">' +
        '<label class="bord-pencil" title="Border color">' + svgIcon("pencil") +
          '<span class="bp-bar" style="background:' + BORDER_COLOR + '"></span>' +
          '<input type="color" id="bord-col" value="' + BORDER_COLOR + '"></label>' +
        '<button class="bord-stybtn" data-bordtool="style" title="Line style">' +
          '<span class="bs-prev">' + bordLineSvg(BORDER_STYLE, BORDER_WIDTH) + "</span>" + svgIcon("expand") + "</button>" +
      "</div>" +
    "</div>" +
    '<div class="bord-stylist" hidden>' + BORDER_PRESETS.map(function (p, i) {
      return '<button class="bord-sty' + (p[0] === BORDER_STYLE && p[1] === BORDER_WIDTH ? " on" : "") +
        '" data-styidx="' + i + '" title="' + p[2] + '">' + bordLineSvg(p[0], p[1]) + "</button>";
    }).join("") + "</div>";
  document.body.appendChild(el);
  var r = el.getBoundingClientRect();
  el.style.left = Math.min(x, window.innerWidth - r.width - 8) + "px";
  el.style.top = Math.min(y, window.innerHeight - r.height - 8) + "px";
  el.addEventListener("input", function (e) {
    if (e.target.id === "bord-col") { BORDER_COLOR = e.target.value; var bar = el.querySelector(".bp-bar"); if (bar) bar.style.background = BORDER_COLOR; }
  });
  el.addEventListener("click", function (e) {
    if (e.target.closest("[data-bordtool=style]")) { var lst = el.querySelector(".bord-stylist"); lst.hidden = !lst.hidden; return; }
    var sty = e.target.closest("[data-styidx]");
    if (sty) {
      var p = BORDER_PRESETS[+sty.dataset.styidx]; BORDER_STYLE = p[0]; BORDER_WIDTH = p[1];
      el.querySelector(".bord-stylist").hidden = true;
      el.querySelector(".bs-prev").innerHTML = bordLineSvg(BORDER_STYLE, BORDER_WIDTH);
      [].forEach.call(el.querySelectorAll(".bord-sty"), function (b) { b.classList.toggle("on", +b.dataset.styidx === +sty.dataset.styidx); });
      return;
    }
    if (e.target.closest(".bord-pencil")) return;   // let the color input open
    var b = e.target.closest("[data-bord]"); if (!b) return;
    applyBorder(b.dataset.bord); closePalette();
  });
  PALETTE_ON = true;
}
/* Clear all hand-applied formatting + color on the selection (Cmd/Ctrl-\). Leaves
   designation-driven colors alone (those aren't fmt). */
function clearFormatting() {
  var ts = fmtTargets();
  if (!ts.length) {
    PENDING_FMT = {}; PENDING_BORDER = null; PENDING_CLEAR = true;
    toast("Clear formatting ready — select cell(s) to apply");
    return;
  }
  var before = ts.map(function (t) { return { t: t, fmt: JSON.parse(JSON.stringify(fmtCurrentOf(t))) }; });
  if (before.every(function (b) { return Object.keys(b.fmt).length === 0; })) return;   // nothing to clear
  function clearOne(t) { return fmtSetFull(t, {}); }
  Promise.all(ts.map(clearOne)).then(function () {
    histPush("clear formatting",
      function () { return Promise.all(before.map(function (b) { return fmtSetFull(b.t, b.fmt); })); },
      function () { return Promise.all(ts.map(clearOne)); });
  }).catch(function (e) { toast(e.message, true); });
}
document.addEventListener("keydown", function (e) {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "\\" || e.code === "Backslash")) {
    if (EDITING || !fmtCanFormat()) return;
    e.preventDefault(); clearFormatting();
  }
});
/* Standard rich-text shortcuts.  When no cell is selected they arm the same
   next-selection preset as the toolbar buttons; while editing, native text
   editing retains control of Cmd/Ctrl-B and Cmd/Ctrl-I. */
document.addEventListener("keydown", function (e) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || EDITING || !fmtCanFormat()) return;
  var tag = e.target && e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable)) return;
  var key = (e.key || "").toLowerCase();
  if (key !== "b" && key !== "i") return;
  e.preventDefault();
  var current = firstFmt();
  applyFormat(key === "b" ? { bold: current.bold ? null : true } : { italic: current.italic ? null : true },
    key === "b" ? "bold" : "italic");
});

/* Zoom + print apply to the board/section. Persisted per device like every
   other PREFS-style setting (Nate, live: "zoom resets to 100 when i
   refresh") — was never saved anywhere, so a real setting silently reset
   itself on every reload. */
var ZOOM = (function () {
  var v = parseFloat(localStorage.getItem("pref_zoom"));
  return isFinite(v) ? Math.max(0.5, Math.min(2, v)) : 1;
})();
/* Zoom scales #main as a whole, but Nate doesn't want it touching each
   view's own toolbar header (Current Week's "Days shown" stepper etc.) —
   only the grid/table content below it should grow or shrink. `zoom` isn't
   a real inherited property; nesting an inverse zoom on the toolbar cancels
   the ancestor's scale for that one element (and its own layout box) while
   everything else under #main still scales normally. --zoom is read by the
   `#main .toolbar` counter-zoom rule in app.css. */
function applyZoom() {
  var m = $("#main"); if (m) m.style.zoom = ZOOM;
  document.documentElement.style.setProperty("--zoom", ZOOM);
}
function setZoom(z) {
  ZOOM = Math.max(0.5, Math.min(2, Math.round(z * 100) / 100));
  localStorage.setItem("pref_zoom", ZOOM);
  applyZoom(); renderFmtBar();
}
applyZoom();

/* Material Symbols paths (Apache-2.0) — the same family Google Sheets draws its
   toolbar from, inlined so the icons match without any external asset (D67). */
var ICONS = {
  history: "M13 3c-4.97 0-9 4.03-9 9H1l4 4 4-4H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.78-4.95-2.05l-1.42 1.42A8.96 8.96 0 0 0 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z",
  print: "M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z",
  undo: "M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z",
  redo: "M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z",
  fill: "M16.56 8.94L7.62 0 6.21 1.41l2.38 2.38-5.15 5.15c-.59.59-.59 1.54 0 2.12l5.5 5.5c.29.29.68.44 1.06.44s.77-.15 1.06-.44l5.5-5.5c.59-.58.59-1.53 0-2.12zM5.21 10L10 5.21 14.79 10H5.21z",
  text: "M11 3L5.5 17h2.25l1.12-3h6.25l1.12 3h2.25L13 3h-2zm-1.38 9L12 5.67 14.38 12H9.62z",
  bold: "M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z",
  italic: "M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z",
  border: "M3 3v18h18V3H3zm8 16H5v-6h6v6zm0-8H5V5h6v6zm8 8h-6v-6h6v6zm0-8h-6V5h6v6z",
  collapse: "M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z",
  expand: "M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z",
  condfmt: "M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z",
  pencil: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
};
function svgIcon(name) {
  return '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="' + ICONS[name] + '"/></svg>';
}
/* A little glyph per border option — a light 2×2 cell outline with the target
   side(s)/line(s) drawn thick in the current color (Sheets-style). */
function bordIcon(op) {
  var box = '<rect x="4" y="4" width="16" height="16" fill="none" stroke="var(--ink-3)" stroke-width="1"/>';
  var L = function (a, b, c, d) { return '<line x1="' + a + '" y1="' + b + '" x2="' + c + '" y2="' + d + '" stroke="currentColor" stroke-width="2.4"/>'; };
  var mid = { h: L(4, 12, 20, 12), v: L(12, 4, 12, 20), t: L(4, 4, 20, 4), b: L(4, 20, 20, 20), l: L(4, 4, 4, 20), r: L(20, 4, 20, 20) };
  var outer = mid.t + mid.b + mid.l + mid.r;
  var parts = {
    all: outer + mid.h + mid.v,
    inner: box + mid.h + mid.v,
    horiz: box + mid.h,
    vert: box + mid.v,
    outer: outer,
    left: box + mid.l, top: box + mid.t, right: box + mid.r, bottom: box + mid.b,
    none: box
  };
  return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' + parts[op] + "</svg>";
}
/* The bar itself. Format controls bite on the Scheduler / Current Week and on
   custom Database sheets (D75). */
function fmtCanFormat() {
  return (SEC === "dispatch" && (SUB === "sched" || SUB === "cw")) ||
         (SEC === "database" && (SUB.indexOf("sheet:") === 0 ||
            ["bagger", "brokers", "pickdrop", "fleet"].indexOf(SUB) >= 0));
}
/* D205: the formatting toolbar is a fixed part of the dashboard shell. Keeping
   it open removes a second disclosure state from the compact navigation, and
   the Orders-only Internal Rate control now owns its far-right edge. */
function renderFmtBar() {
  var bar = $("#fmtbar"); if (!bar) return;
  bar.classList.remove("collapsed");
  var can = fmtCanFormat(), dis = can ? "" : " disabled";
  var fs = firstFmt();
  var zooms = [50, 75, 90, 100, 125, 150, 200], zp = Math.round(ZOOM * 100);
  bar.innerHTML =
    (DB && DB.me && DB.me.is_admin
      ? '<button class="fb" data-fb="history" title="History (admin only)">' + svgIcon("history") + "</button>"
      : "") +
    '<button class="fb" data-fb="print" title="Print">' + svgIcon("print") + "</button>" +
    '<button class="fb" data-fb="undo" title="Undo (Cmd/Ctrl-Z)">' + svgIcon("undo") + "</button>" +
    '<button class="fb" data-fb="redo" title="Redo (Cmd/Ctrl-Shift-Z)">' + svgIcon("redo") + "</button>" +
    '<span class="fb-sep"></span>' +
    '<select class="fb-zoomsel" data-fb="zoomsel" title="Zoom">' +
      zooms.map(function (z) { return '<option value="' + z + '"' + (z === zp ? " selected" : "") + ">" + z + "%</option>"; }).join("") +
      (zooms.indexOf(zp) < 0 ? '<option value="' + zp + '" selected>' + zp + "%</option>" : "") +
    "</select>" +
    '<span class="fb-sep"></span>' +
    '<button class="fb fb-clr"' + dis + ' data-fb="fill" title="Fill color">' + svgIcon("fill") +
      '<span class="fb-bar" style="background:' + (fs.fill || LAST_FILL) + '"></span></button>' +
    '<button class="fb fb-clr"' + dis + ' data-fb="text" title="Text color">' + svgIcon("text") +
      '<span class="fb-bar" style="background:' + (fs.text || LAST_TEXT) + '"></span></button>' +
    '<span class="fb-sep"></span>' +
    '<button class="fb' + (fs.bold ? " on" : "") + '"' + dis + ' data-fb="bold" title="Bold (Cmd/Ctrl-B)">' + svgIcon("bold") + "</button>" +
    '<button class="fb' + (fs.italic ? " on" : "") + '"' + dis + ' data-fb="italic" title="Italic (Cmd/Ctrl-I)">' + svgIcon("italic") + "</button>" +
    '<button class="fb"' + dis + ' data-fb="border" title="Borders">' + svgIcon("border") + "</button>" +
    '<span class="fb-sep"></span>' +
    '<button class="fb-font"' + dis + ' data-fb="font" title="Font" style="font-family:' + (fs.font || "inherit") + '">' +
      '<span class="fb-font-lbl">' + esc(fontLabel(fs.font)) + "</span>" + svgIcon("expand") + "</button>" +
    '<span class="fb-fs"' + dis + '>' +
      '<button class="fb-fs-b" data-fb="fs-dec" title="Decrease font size" tabindex="-1">&minus;</button>' +
      '<input class="fb-fs-inp" data-fb="fs-inp" type="text" inputmode="numeric" value="' +
        (fs.size || 10) + '" title="Font size">' +
      '<button class="fb-fs-b" data-fb="fs-inc" title="Increase font size" tabindex="-1">+</button>' +
    "</span>" +
    '<span style="flex:1"></span>' +
    (SEC === "orders" ? '<div class="fmt-ifr">' + internalFreightRateHtml() + "</div>" : "");
}
/* Font picker (D78) — a custom popover, not a native <select>, because browsers
   ignore font-family on <option> (macOS especially). Each row previews in its own
   face, Sheets-style; the current cell's font is checked. */
function fontLabel(stack) {
  var f = FONTS.filter(function (x) { return x[0] === (stack || ""); })[0];
  return f ? f[1] : "System";
}
function openFontMenu(x, y) {
  closePalette();
  var cur = firstFmt().font || "";
  var el = document.createElement("div"); el.id = "palette"; el.className = "font-menu";
  el.innerHTML = FONTS.map(function (f) {
    return '<button class="font-opt' + (f[0] === cur ? " on" : "") + '" data-font="' + esc(f[0]) +
      '" style="font-family:' + (f[0] || "inherit") + '"><span class="fo-ck">' +
      (f[0] === cur ? "✓" : "") + "</span>" + esc(f[1]) + "</button>";
  }).join("");
  document.body.appendChild(el);
  var r = el.getBoundingClientRect();
  el.style.left = Math.min(x, window.innerWidth - r.width - 8) + "px";
  el.style.top = Math.min(y, window.innerHeight - r.height - 8) + "px";
  el.addEventListener("click", function (e) {
    var b = e.target.closest("[data-font]"); if (!b) return;
    applyFormat({ font: b.dataset.font || null }, "font"); closePalette();
  });
  PALETTE_ON = true;
}
$("#fmtbar") && $("#fmtbar").addEventListener("click", function (e) {
  var b = e.target.closest("[data-fb]"); if (!b) return;
  var a = b.dataset.fb;
  if (a === "history") { if (typeof toggleHistoryPanel === "function") toggleHistoryPanel(); return; }
  if (a === "print") { window.print(); return; }
  if (a === "undo") { histUndo(); return; }
  if (a === "redo") { histRedo(); return; }
  if (!fmtCanFormat()) return;
  if (a === "fill") { if (togglePalette("fill")) return; var r = b.getBoundingClientRect(); openSheetsPicker(r.left, r.bottom + 4, function (hex) { if (hex) { LAST_FILL = hex; localStorage.setItem("lastFill", hex); } applyFormat({ fill: hex || null }, "fill"); }); PALETTE_KIND = "fill"; return; }
  if (a === "text") { if (togglePalette("text")) return; var r2 = b.getBoundingClientRect(); openSheetsPicker(r2.left, r2.bottom + 4, function (hex) { if (hex) { LAST_TEXT = hex; localStorage.setItem("lastText", hex); } applyFormat({ text: hex || null }, "text color"); }); PALETTE_KIND = "text"; return; }
  if (a === "border") { if (togglePalette("border")) return; var r3 = b.getBoundingClientRect(); openBorderMenu(r3.left, r3.bottom + 4); PALETTE_KIND = "border"; return; }
  if (a === "font") { if (togglePalette("font")) return; var rf = b.getBoundingClientRect(); openFontMenu(rf.left, rf.bottom + 4); PALETTE_KIND = "font"; return; }
  if (a === "fs-dec" || a === "fs-inc") {
    // Step from the input's shown value, not firstFmt() — the model updates
    // async, so reading it made rapid clicks jump by 1–2 (D80). The input is the
    // synchronous source of truth between clicks.
    var inp = $(".fb-fs-inp");
    var cur = inp && inp.value !== "" ? (parseInt(inp.value, 10) || 10) : (+firstFmt().size || 10);
    var nv = a === "fs-inc" ? cur + 1 : Math.max(1, cur - 1);
    if (inp) inp.value = nv;
    applyFormat({ size: nv }, "font size"); return;
  }
  if (a === "bold") { applyFormat({ bold: firstFmt().bold ? null : true }, "bold"); }
  else if (a === "italic") { applyFormat({ italic: firstFmt().italic ? null : true }, "italic"); }
});
$("#fmtbar") && $("#fmtbar").addEventListener("change", function (e) {
  var z = e.target.closest('[data-fb="zoomsel"]');
  if (z) { setZoom((+z.value || 100) / 100); return; }
  if (!fmtCanFormat()) return;
  var fi = e.target.closest('[data-fb="fs-inp"]');
  if (fi) { var n = parseInt(fi.value, 10); applyFormat({ size: (n && n > 0) ? n : null }, "font size"); return; }
});
$("#fmtbar") && $("#fmtbar").addEventListener("keydown", function (e) {
  var fi = e.target.closest('[data-fb="fs-inp"]');
  if (fi && e.key === "Enter") { e.preventDefault(); fi.blur(); }
});

/* Drag & drop */
/* Shared drop actions (D61) — used by both mouse HTML5 DnD and touch drag.
   Each records an undo/redo pair (D63). */
function dropLoadOnCell(oid, from, td) {
  var to = td.dataset.key, back = from || "STAGE";
  // Outside-carrier lane (D115/D122) drops the same as any truck cell —
  // moveLoad routes to /api/load/carrier internally; name/cost are filled in
  // later from the drawer's collapsible section, not a blocking modal here.
  // Dropping onto a text-only cell (D250, no confirm/alert — Nate: "we don't
  // need any errors or alerts associated with it") silently replaces the
  // note — api_schedule's place-an-order path already deletes any
  // schedule_notes row at the destination, so this is really just the client
  // getting out of the way. Undo needs the note's own text back (moveLoad's
  // undo alone only ever puts the LOAD back where it came from) — captured
  // before the drop since CELLS[to] is about to be overwritten. Nothing to
  // restore for fmt/category: the forward action loses those the same way
  // it already does when placing over an empty formatted cell, so undo
  // restores exactly what changed (the text), not more than the drop itself
  // preserved.
  var priorNote = (CELLS[to] && !CELLS[to].oid && CELLS[to].text) || "";
  confirmHistoricalMove(back, to, function () {
    moveLoad(oid, from, to).then(function () {
      histPush("move load",
        function () {
          return moveLoad(oid, to, back).then(function () {
            if (priorNote) return scheduleNote(to, priorNote);
          });
        },
        function () { return moveLoad(oid, back, to); });
    }).catch(function (err) { toast(err.message, true); });
  });
}
function dropLoadOnRail(oid, from) {
  confirmHistoricalMove(from, "STAGE", function () {
    moveLoad(oid, from, "STAGE").then(function () {
      histPush("unschedule load",
        function () { return moveLoad(oid, "STAGE", from); },
        function () { return moveLoad(oid, from, "STAGE"); });
    }).catch(function (err) { toast(err.message, true); });
  });
}
document.addEventListener("dragstart", function (e) {
  // Broadened from .chip[draggable=true] (D137) — Driver Tabs' occupied
  // slots (.dv-cell) are draggable-out the same way without being real
  // chips (different, denser text layout); this still matches every real
  // chip too, since chipHtml() always sets data-oid on drag-enabled chips.
  var c = e.target.closest("[draggable=true][data-oid]");
  if (c) { DRAG = { kind: "load", oid: c.dataset.oid, from: c.dataset.from }; c.classList.add("dragging");
           e.dataTransfer.effectAllowed = "move"; return; }
  var p = e.target.closest("[data-pool]");
  if (p && p.getAttribute("draggable") === "true") {
    DRAG = { kind: "invoice", idx: +p.dataset.pool }; e.dataTransfer.effectAllowed = "copy"; return;
  }
  var th = e.target.closest("th.trkcol[draggable=true]");
  if (th) { DRAG = { kind: "truckcol", truckId: th.dataset.truckid }; th.classList.add("dragging");
            e.dataTransfer.effectAllowed = "move"; return; }
  var dbth = e.target.closest("th[data-colref][draggable=true]");
  if (dbth && !e.target.closest(".col-resize")) {
    DRAG = { kind: "dbcol", grid: dbth.dataset.colgrid, ref: dbth.dataset.colref };
    dbth.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; return;
  }
  var grip = e.target.closest(".rowgrip[draggable=true]");
  if (grip) { DRAG = { kind: "dbrow", grid: grip.dataset.grid, rowId: grip.dataset.gridrowid };
              grip.closest("td.rowdrag").classList.add("dragging");
              e.dataTransfer.effectAllowed = "move"; }
});
document.addEventListener("dragend", function () {
  $$(".dragging").forEach(function (n) { n.classList.remove("dragging"); });
  $$(".over").forEach(function (n) { n.classList.remove("over"); });
  DRAG = null;
});
document.addEventListener("dragover", function (e) {
  if (DRAG && DRAG.kind === "load") {
    // Reordering within the rail itself (D197) — a chip dragged from and
    // back onto Staging, over another chip there, not the Scheduler/etc.
    // Checked before the generic #rail case below, which deliberately
    // excludes a STAGE-origin drag (moving into staging you're already in
    // is a no-op) — this is the one STAGE-origin case that isn't a no-op.
    if (DRAG.from === "STAGE") {
      var overChip = e.target.closest("#rail .chip[data-oid]");
      if (overChip && overChip.dataset.oid !== DRAG.oid) { e.preventDefault(); overChip.classList.add("over"); return; }
    }
    // [data-key], not td[data-key] (D137) — Driver Tabs' slots are plain
    // divs, not table cells, but use the same cellKey data-key convention.
    // A text-only cell (no real load, D250) is a valid drop target — only a
    // real placed load blocks the drop.
    var td = e.target.closest("[data-key]:not([data-field])"), rail = e.target.closest("#rail");
    if (td && !cellHasLoad(td.dataset.key)) { e.preventDefault(); td.classList.add("over"); }
    else if (rail && DRAG.from !== "STAGE") { e.preventDefault(); rail.classList.add("over"); }
    return;
  }
  if (DRAG && DRAG.kind === "invoice") {
    var row = e.target.closest("[data-bill]");
    if (row) { e.preventDefault(); row.classList.add("over"); }
    return;
  }
  if (DRAG && DRAG.kind === "truckcol") {
    var th = e.target.closest("th.trkcol:not(.carriercol)");
    if (th && th.dataset.truckid !== DRAG.truckId) { e.preventDefault(); th.classList.add("over"); }
    return;
  }
  if (DRAG && DRAG.kind === "dbcol") {
    var dbth = e.target.closest("th[data-colref]");
    if (dbth && dbth.dataset.colgrid === DRAG.grid && dbth.dataset.colref !== DRAG.ref) {
      e.preventDefault(); dbth.classList.add("over");
    }
    return;
  }
  if (DRAG && DRAG.kind === "dbrow") {
    var rg = e.target.closest("td.rowdrag");
    if (rg && rg.dataset.grid === DRAG.grid && rg.dataset.gridrowid !== DRAG.rowId) { e.preventDefault(); rg.classList.add("over"); }
    return;
  }
  if (!DRAG && e.dataTransfer.types.indexOf("Files") >= 0) {
    var z = e.target.closest("#rc-drop,#batch-drop,#dw-drop,#loose-drop");
    if (z) { e.preventDefault(); z.classList.add("over"); }
  }
});
document.addEventListener("dragleave", function (e) {
  var n = e.target.closest("[data-key],#rail,#rail .chip[data-oid],[data-bill],th.trkcol,th[data-colref],td.rowdrag,#rc-drop,#batch-drop,#dw-drop,#loose-drop");
  if (n) n.classList.remove("over");
});
document.addEventListener("drop", function (e) {
  var files = e.dataTransfer && e.dataTransfer.files;
  var zone = e.target.closest("#rc-drop,#batch-drop,#dw-drop,#loose-drop");
  if (zone && files && files.length) {
    e.preventDefault(); zone.classList.remove("over");
    if (zone.id === "rc-drop") ingestRateCon(files[0]);
    else if (zone.id === "batch-drop") ingestBatch(files[0]);
    else if (zone.id === "loose-drop") ingestLoose(files[0]);
    else { $("#file-doc").files = files; $("#file-doc").dispatchEvent(new Event("change")); }
    return;
  }
  if (!DRAG) return;
  if (DRAG.kind === "invoice") {
    var row = e.target.closest("[data-bill]");
    if (row) { e.preventDefault(); row.classList.remove("over"); assignInvoice(DRAG.idx, row.dataset.bill); }
    DRAG = null; return;
  }
  if (DRAG.kind === "truckcol") {
    var th = e.target.closest("th.trkcol:not(.carriercol)");
    if (th) { e.preventDefault(); th.classList.remove("over"); reorderTrucks(DRAG.truckId, th.dataset.truckid); }
    DRAG = null; return;
  }
  if (DRAG.kind === "dbcol") {
    var dbth = e.target.closest("th[data-colref]");
    if (dbth && dbth.dataset.colgrid === DRAG.grid) {
      e.preventDefault(); dbth.classList.remove("over");
      reorderDatabaseColumns(DRAG.grid, DRAG.ref, dbth.dataset.colref);
    }
    DRAG = null; return;
  }
  if (DRAG.kind === "dbrow") {
    var rg = e.target.closest("td.rowdrag");
    if (rg && rg.dataset.grid === DRAG.grid) {
      e.preventDefault(); rg.classList.remove("over"); reorderGridRow(DRAG.grid, DRAG.rowId, rg.dataset.gridrowid);
    }
    DRAG = null; return;
  }
  if (DRAG.kind === "load" && DRAG.from === "STAGE") {
    var overChip = e.target.closest("#rail .chip[data-oid]");
    if (overChip && overChip.dataset.oid !== DRAG.oid) {
      e.preventDefault(); overChip.classList.remove("over");
      reorderStagedRow(DRAG.oid, overChip.dataset.oid);
      DRAG = null; return;
    }
  }
  var td = e.target.closest("[data-key]:not([data-field])"), rail = e.target.closest("#rail");
  if (td && !cellHasLoad(td.dataset.key)) {
    e.preventDefault(); td.classList.remove("over");
    dropLoadOnCell(DRAG.oid, DRAG.from, td);
    DRAG = null; return;
  }
  if (rail && DRAG.from && DRAG.from !== "STAGE") {
    e.preventDefault(); rail.classList.remove("over");
    dropLoadOnRail(DRAG.oid, DRAG.from);
    DRAG = null;
  }
});
/* ═══ 12-touch-boot ═══ */
/* ── Touch drag (D61) — hold-and-drag a chip like the Google Sheets app.
   A short long-press starts the drag (a quick swipe scrolls instead); a floating
   ghost follows the finger; drop onto an empty cell or the staging rail. Reuses
   the same drop actions as mouse DnD. */
var TOUCHDRAG = null;
document.addEventListener("touchstart", function (e) {
  if (e.touches.length !== 1) return;
  var chip = e.target.closest("[draggable=true][data-oid]");  // broadened D137, see 11-toolbar.js dragstart
  if (!chip) return;
  var t = e.touches[0];
  TOUCHDRAG = { oid: chip.dataset.oid, from: chip.dataset.from, chip: chip,
    x0: t.clientX, y0: t.clientY, started: false, target: null, clone: null, timer: null };
  TOUCHDRAG.timer = setTimeout(function () {
    if (TOUCHDRAG) startTouchDrag(TOUCHDRAG.x0, TOUCHDRAG.y0);
  }, 200);
}, { passive: true });
function startTouchDrag(x, y) {
  var chip = TOUCHDRAG.chip, r = chip.getBoundingClientRect();
  TOUCHDRAG.started = true;
  DRAG = { kind: "load", oid: TOUCHDRAG.oid, from: TOUCHDRAG.from };
  chip.classList.add("dragging");
  var clone = chip.cloneNode(true);
  clone.className += " touch-ghost";
  clone.style.width = r.width + "px";
  TOUCHDRAG.offX = Math.min(r.width / 2, x - r.left); TOUCHDRAG.offY = y - r.top;
  clone.style.left = (x - TOUCHDRAG.offX) + "px"; clone.style.top = (y - TOUCHDRAG.offY) + "px";
  document.body.appendChild(clone); TOUCHDRAG.clone = clone;
  if (navigator.vibrate) try { navigator.vibrate(12); } catch (err) {}
}
document.addEventListener("touchmove", function (e) {
  if (!TOUCHDRAG) return;
  var t = e.touches[0];
  if (!TOUCHDRAG.started) {
    if (Math.abs(t.clientX - TOUCHDRAG.x0) > 8 || Math.abs(t.clientY - TOUCHDRAG.y0) > 8) {
      clearTimeout(TOUCHDRAG.timer); TOUCHDRAG = null;  // it's a scroll
    }
    return;
  }
  e.preventDefault();  // block scroll while dragging
  TOUCHDRAG.clone.style.left = (t.clientX - TOUCHDRAG.offX) + "px";
  TOUCHDRAG.clone.style.top = (t.clientY - TOUCHDRAG.offY) + "px";
  TOUCHDRAG.clone.style.display = "none";
  var el = document.elementFromPoint(t.clientX, t.clientY);
  TOUCHDRAG.clone.style.display = "";
  $$(".over").forEach(function (n) { n.classList.remove("over"); });
  var td = el && el.closest("[data-key]:not([data-field])");  // broadened D137, see 11-toolbar.js dragover
  var rail = el && el.closest("#rail");
  // A text-only cell (no real load, D250) is a valid drop target too.
  if (td && !cellHasLoad(td.dataset.key)) { td.classList.add("over"); TOUCHDRAG.target = { td: td }; }
  else if (rail && TOUCHDRAG.from !== "STAGE") { rail.classList.add("over"); TOUCHDRAG.target = { rail: 1 }; }
  else TOUCHDRAG.target = null;
}, { passive: false });
document.addEventListener("touchend", function (e) {
  if (!TOUCHDRAG) return;
  clearTimeout(TOUCHDRAG.timer);
  if (TOUCHDRAG.started) {
    e.preventDefault();  // suppress the synthetic click so the drawer doesn't open
    if (TOUCHDRAG.clone) TOUCHDRAG.clone.remove();
    TOUCHDRAG.chip.classList.remove("dragging");
    $$(".over").forEach(function (n) { n.classList.remove("over"); });
    var tgt = TOUCHDRAG.target;
    if (tgt && tgt.td) dropLoadOnCell(TOUCHDRAG.oid, TOUCHDRAG.from, tgt.td);
    else if (tgt && tgt.rail && TOUCHDRAG.from && TOUCHDRAG.from !== "STAGE") dropLoadOnRail(TOUCHDRAG.oid, TOUCHDRAG.from);
    DRAG = null;
  }
  TOUCHDRAG = null;
}, { passive: false });
/* D208: Escape closes the mobile navigation drawer without affecting the
   desktop rail's persisted collapsed/expanded preference. */
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && mobileNavMode() && MOBILE_NAV_OPEN) closeMobileNav();
});
document.addEventListener("click", function (e) {
  var z = e.target.closest("#rc-drop,#batch-drop,#dw-drop,#loose-drop");
  if (!z) return;
  if (z.id === "rc-drop") $("#file-ratecon").click();
  else if (z.id === "batch-drop") $("#file-batch").click();
  else if (z.id === "loose-drop") $("#file-loose").click();
  else $("#file-doc").click();
});

/* Resizable staging rail (D44) — drag its left edge; width persists. */
(function () {
  var saved = parseInt(localStorage.getItem("railW"), 10);
  if (saved) document.documentElement.style.setProperty("--rail-w", Math.max(120, Math.min(640, saved)) + "px");
  var h = $("#rail-resize"), dragging = false;
  h.addEventListener("mousedown", function (e) { dragging = true; h.classList.add("dragging");
    document.body.style.userSelect = "none"; e.preventDefault(); });
  document.addEventListener("mousemove", function (e) {
    if (!dragging) return;
    var w = Math.max(120, Math.min(640, window.innerWidth - e.clientX));
    document.documentElement.style.setProperty("--rail-w", w + "px");
  });
  document.addEventListener("mouseup", function () {
    if (!dragging) return; dragging = false; h.classList.remove("dragging"); document.body.style.userSelect = "";
    localStorage.setItem("railW", parseInt(getComputedStyle(document.documentElement).getPropertyValue("--rail-w"), 10) || 276);
  });
})();

/* Resizable sidebar nav (D201) — drag its right edge; width persists
   separately for the expanded and collapsed states (a collapsed icon rail
   and an expanded labeled list want very different widths), mirroring the
   Staging rail's own --rail-w pattern (D44) above. Nate: "make it slightly
   wider so that in collapse mode it fits the text or let me drag it to
   whatever width i want" — collapsed defaults wider than a bare icon strip
   (96px, not 64px) specifically so a wrapped label like "Internal Freight"
   in the accordion has room to breathe. D205's plain 16px cycle glyphs let
   users drag the icon rail as far left as 44px without clipping the controls.
   applyNavWidth() is called on boot and again from toggleSideNav()
   (01-core.js) so switching states immediately shows that state's own
   saved width instead of carrying over the other state's. */
var NAV_W_EXP = Math.max(160, Math.min(360, parseInt(localStorage.getItem("navW"), 10) || 200));
var NAV_W_COL = Math.max(44, Math.min(200, parseInt(localStorage.getItem("navCW"), 10) || 96));
function applyNavWidth() {
  document.body.style.setProperty("--nav-w", (NAV_COLLAPSED ? NAV_W_COL : NAV_W_EXP) + "px");
}
(function () {
  applyNavWidth();
  var h = $("#sidenav-resize"), dragging = false;
  h.addEventListener("mousedown", function (e) { dragging = true; h.classList.add("dragging");
    document.body.style.userSelect = "none"; e.preventDefault(); });
  document.addEventListener("mousemove", function (e) {
    if (!dragging) return;
    var min = NAV_COLLAPSED ? 44 : 160, max = NAV_COLLAPSED ? 200 : 360;
    var w = Math.max(min, Math.min(max, e.clientX));
    if (NAV_COLLAPSED) NAV_W_COL = w; else NAV_W_EXP = w;
    document.body.style.setProperty("--nav-w", w + "px");
  });
  document.addEventListener("mouseup", function () {
    if (!dragging) return; dragging = false; h.classList.remove("dragging"); document.body.style.userSelect = "";
    localStorage.setItem(NAV_COLLAPSED ? "navCW" : "navW", NAV_COLLAPSED ? NAV_W_COL : NAV_W_EXP);
  });
})();

/* Collapsible staging rail (D199) — a dedicated header icon, left of the
   "Staging" label (Nate rejected D197's header button and D198's arrow-
   in-the-resize-handle in turn; this is the third, settled design: "a <>
   icon or something that lives on the staging area at the top to the
   left of 'staging' header"). Independent of the resize width above —
   collapsing never touches --rail-w, so whatever width was saved is
   exactly what comes back on expand.
   D201 replaced the static "<>" glyph with a single directional arrow,
   app-wide rule (Nate: "it should be > or < depending on the nav state...
   whichever direction the toggle takes the nav is the one that should be
   displayed"). The rail sits on the right edge, so collapsing shrinks it
   rightward (">" — collapse moves that way) and expanding grows it back
   out to the left ("<" — expand moves that way). D205 removes the button
   box: this is now the same small plain-glyph treatment as the nav cycler. */
(function () {
  var collapsed = localStorage.getItem("railCollapsed") === "1";
  var btn = $("#rail-toggle");
  function apply() {
    $("#bodywrap").classList.toggle("rail-collapsed", collapsed);
    btn.title = collapsed ? "Show staging" : "Hide staging";
    btn.setAttribute("aria-label", btn.title);
    btn.textContent = collapsed ? "<" : ">";
  }
  apply();
  btn.addEventListener("click", function () {
    collapsed = !collapsed;
    document.body.classList.add("shell-animating");
    clearTimeout(btn._motionTimer);
    btn._motionTimer = setTimeout(function () { document.body.classList.remove("shell-animating"); }, 260);
    localStorage.setItem("railCollapsed", collapsed ? "1" : "0");
    apply();
  });
})();

/* ── Boot ────────────────────────────────────────────────────────────────── */
function bootDashboard() {
  document.body.classList.remove("pre-auth");  // undo renderLoginGate()'s hide; render() sets the real rail state
  return dashboardAuth.initialize().then(function (authState) {
    if (authState && authState.redirecting) return null;
    var user = dashboardAuth.user();
    if (user) {
      var meta = user.user_metadata || {};
      profileName = meta.full_name || meta.name || user.email || profileName;
      renderProfile();
    }
    if (LOCAL_AUTH.enabled && LOCAL_AUTH.user) {
      profileName = LOCAL_AUTH.user.username;
      renderProfile();
    }
    return reload();
  }).then(function (loaded) {
    if (loaded === null) return;
    DRIVER_VIEW = DB.trucks.length ? DB.trucks[0].id : null;
    setTimeout(function () { if (SUB === "sched") jumpTo(TODAY); }, 80);
  }).catch(function (e) {
    $("#conn").textContent = "offline";
    $("#main").innerHTML = '<div class="empty"><b>Cannot reach the server.</b><br>' + esc(e.message) +
      "<br><br>Check the Supabase URL/key in <span class=\"kbd\">config.js</span> and your connection.</div>";
  });
}
// A gate in front of the normal boot (D125) — only ever shows when the
// server's local-auth flag is on and no session cookie is present yet.
// Off (the default), localAuthCheck() reports {enabled:false} and this is a
// no-op straight into the existing boot path.
localAuthCheck().then(function (la) {
  if (la.enabled && !la.user) { renderLoginGate(); return; }
  return bootDashboard();
});
/* ═══ 13-history ═══ */
/* ── Durable admin history (D131/D133/D134/D135) ────────────────────────────
   The server enforces admin access too; this client gate keeps the control
   completely absent for restricted users. The whole point (Nate, D135):
   a way to undo a mistake that persists after the session/tab that made it
   is long gone — not the fast in-memory 50-action stack (D96), which dies
   on reload. No bulk "restore to a point": that mode was cut (D132) as the
   fragile, rarely-needed path. Lives as a persistent left column (not an
   overlay) so it can stay open across navigation until the admin closes
   it — clicking a chip jumps to and flashes whatever it touched without
   the panel fighting the destination for screen space.

   Every revert appends a brand-new immutable audit_events row (D131's
   append-only design, on purpose — the log must never look like it was
   edited). Left as one chip per event, toggling Revert/Redo back and forth
   on the same record would visibly stack "Reverted: Reverted: Reverted: …"
   forever (D134 — confirmed live, Nate hit it repeatedly clicking Redo).
   historyGroupedEvents collapses each revert/redo CHAIN — linked by
   reverts_event_id/reverted_by_event_id — into the one chip a person
   actually wants: the original action's plain label, one button whose
   label reflects the chain's current net state (even hops back to the
   original data = active; odd = reverted), targeting whichever event is
   currently the chain's tip. The full chain still exists in Postgres for
   audit purposes; only the display collapses. Chains with nothing left to
   act on (not reversible, no real change, already at the tip of nothing)
   are dropped entirely — "days with edits u can reverse and thats that."
   historyDayGroups then buckets the survivors by the local calendar day
   the ORIGINAL edit happened on (not whenever it was last toggled) and
   collapses each day behind a header; the newest day opens by default. */
var HISTORY_EVENTS = [];
var HISTORY_HAS_MORE = false;

function historyAdmin() { return !!(DB && DB.me && DB.me.is_admin); }
function historyDate(value) {
  if (!value) return "";
  var d = new Date(value);
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " · " +
    d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function historyFieldName(s) { return String(s || "").replace(/_/g, " "); }
function historyValue(v) {
  if (v == null || v === "") return "empty";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
/* Click-to-navigate: jump to and flash whatever a change touched, the way
   Sheets' version history takes you to the edited cell. Looked up against
   the CURRENT live row (DB.orders/loads/notes/etc, already in memory from
   bootstrap) rather than the change's own before/after — those are pruned
   to just the changed fields (D131), so e.g. a load's truck_id/scheduled_date
   usually isn't in the diff at all unless the move itself was the edit. If
   the row's gone (deleted since), there's nothing to jump to. The panel
   itself is never closed by a jump — it stays open until the admin closes it. */
function historyDbGridSlug(table, row) {
  if (table === "parties") return row.is_customer ? "bagger" : "brokers";
  if (table === "locations") return row.party_id ? "bagger" : "pickdrop";
  if (table === "departments") return "departments";
  return "fleet";           // trucks, drivers
}
function historyFlashEl(el) {
  if (!el) return;
  el.scrollIntoView({ block: "center" });
  el.classList.add("hist-flash");
  setTimeout(function () { el.classList.remove("hist-flash"); }, 1400);
}
function historyJumpTarget(table, id) {
  if (!id) return null;
  if (table === "orders") {
    if (!order(id)) return null;
    return function () { openOrder(id); };
  }
  if (table === "loads" || table === "schedule_notes") {
    var arr = table === "loads" ? DB.loads : DB.notes;
    var row = (arr || []).filter(function (x) { return x.id === id; })[0];
    if (!row || !row.truck_id) return null;
    var ds = String(row.scheduled_date).slice(0, 10), key = cellKey(row.truck_id, ds, row.slot);
    return function () {
      SEC = "dispatch"; SUB = "sched"; SEL = null; render(); jumpTo(ds);
      historyFlashEl(document.querySelector('[data-key="' + CSS.escape(key) + '"]'));
    };
  }
  var dbArrays = { parties: DB.parties, locations: DB.locations, trucks: DB.trucks,
                   drivers: DB.drivers, departments: DB.departments };
  if (dbArrays[table]) {
    var dbRow = (dbArrays[table] || []).filter(function (x) { return x.id === id; })[0];
    if (!dbRow) return null;
    var slug = historyDbGridSlug(table, dbRow);
    return function () {
      var grid = gridKey(slug);
      if (archiveConfigForGrid(grid)) {
        if (grid === "bagger" && table === "locations") {
          var owner = party(dbRow.party_id);
          ARCHIVE_DATABASE_VIEW[grid] = !!(owner && owner.customer_archived_at);
        } else {
          ARCHIVE_DATABASE_VIEW[grid] = databaseRowIsArchived(grid, id);
        }
        ROWSEL[grid] = [];
      }
      SEC = "database"; SUB = slug; SEL = null; render();
      historyFlashEl(document.querySelector('[data-histrow="' + table + "|" + id + '"]'));
    };
  }
  return null;
}
/* First changed row in an event's own diff that resolves to a real place to
   go — almost every event is a single mutation, so this is "the" destination. */
function historyEventJump(e) {
  var changes = (e && e.changes) || [];
  for (var i = 0; i < changes.length; i++) {
    var c = changes[i], id = c.primary_key && c.primary_key.id;
    if (c.operation === "DELETE") continue;
    var go = historyJumpTarget(c.table_name, id);
    if (go) return go;
  }
  return null;
}
/* Collapse each revert/redo chain into one entry: { root, tip, depth, canAct }.
   root = the original action (reverts_event_id null). tip = whichever link
   in the chain is current (found first, since events arrive newest-first —
   the newest member of any chain IS its tip). depth = hops from root to
   tip; even = chain is back to root's data state, odd = currently reverted.
   Only chains with something to actually revert/redo survive — Nate: "days
   with edits u can reverse and thats that" (D135). */
function historyGroupedEvents(events) {
  var byId = {}; events.forEach(function (e) { byId[e.id] = e; });
  var seen = {}, out = [];
  events.forEach(function (e) {
    var root = e, depth = 0;
    while (root.reverts_event_id && byId[root.reverts_event_id]) {
      root = byId[root.reverts_event_id]; depth++;
    }
    if (seen[root.id]) return;
    seen[root.id] = true;
    var canAct = !!(root.reversible && e.change_count && !e.reverted_by_event_id);
    if (!canAct) return;
    out.push({ root: root, tip: e, depth: depth, canAct: canAct });
  });
  return out;
}
/* Local calendar day the chain's original edit happened on — undo lives
   with when the mistake was made, not whenever it was last toggled. */
function historyDayKey(value) {
  var d = new Date(value);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function historyDayLabel(key) {
  var parts = key.split("-").map(Number);
  var d = new Date(parts[0], parts[1] - 1, parts[2]);
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var diff = Math.round((today - d) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
function historyDayGroups(groups) {
  var byDay = {}, order = [];
  groups.forEach(function (g) {
    var key = historyDayKey(g.root.occurred_at);
    if (!byDay[key]) { byDay[key] = []; order.push(key); }
    byDay[key].push(g);
  });
  return order.map(function (key) { return { key: key, groups: byDay[key] }; });
}
var HISTORY_OPEN_DAYS = {};
function historyChangeHtml(c) {
  var line;
  if (c.operation === "UPDATE") {
    line = (c.changed_fields || []).map(function (f) {
      return historyFieldName(f) + ": " + historyValue(c.before_data && c.before_data[f]) +
        " → " + historyValue(c.after_data && c.after_data[f]);
    }).join(" · ");
  } else {
    line = c.operation === "INSERT" ? "Created record" : "Deleted record";
  }
  return '<div class="history-change"><b>' + esc(c.table_name) + " · " + esc(c.operation.toLowerCase()) +
    '</b><span>' + esc(line) + "</span></div>";
}
function historyGroupHtml(g) {
  var root = g.root, tip = g.tip, reverted = g.depth % 2 === 1, canAct = g.canAct;
  var state = "", cls = "";
  if (reverted) { state = '<span class="history-status">reverted</span>'; cls = " superseded"; }
  else if (root.external_effect) state = '<span class="history-status warn">external</span>';
  var jump = historyEventJump(root);
  return '<article class="history-event' + cls + (jump ? " jumpable" : "") + '"' +
    (jump ? ' data-history-jump="' + root.id + '" title="Go there"' : "") + '>' +
    '<div class="history-event-main">' +
    '<div><div class="history-label">' + esc(root.label) + state + '</div><div class="history-meta">' +
      esc(root.actor_name) + (root.section ? " · " + esc(root.section + (root.sub ? " / " + root.sub : "")) : "") +
      " · " + root.change_count + " change" + (root.change_count === 1 ? "" : "s") + '</div></div>' +
    '<div class="history-when">' + esc(historyDate(tip.occurred_at)) + "</div></div>" +
    (canAct ? '<div class="history-actions"><button class="btn sm" data-history-revert="' + tip.id + '">' +
      (reverted ? "Redo" : "Revert action") + '</button></div>' : "") +
    (root.changes && root.changes.length
      ? '<div class="history-changes">' + root.changes.map(historyChangeHtml).join("") + "</div>"
      : "") + "</article>";
}
function historyDayHtml(day) {
  var open = !!HISTORY_OPEN_DAYS[day.key], n = day.groups.length;
  return '<div class="history-day">' +
    '<button class="history-day-hd" data-history-day="' + esc(day.key) + '" aria-expanded="' + open + '">' +
    '<span><span class="history-day-arrow">▸</span>' + esc(historyDayLabel(day.key)) + '</span><span class="history-day-ct">' +
    n + " edit" + (n === 1 ? "" : "s") + "</span></button>" +
    (open ? '<div class="history-day-body">' + day.groups.map(historyGroupHtml).join("") + "</div>" : "") +
    "</div>";
}
function renderHistoryPanel() {
  var body = $("#history-body"); if (!body) return;
  var days = historyDayGroups(historyGroupedEvents(HISTORY_EVENTS));
  // First render after a (re)load: default the most recent day open so the
  // panel isn't a wall of collapsed headers on first look.
  if (days.length && !Object.keys(HISTORY_OPEN_DAYS).length) HISTORY_OPEN_DAYS[days[0].key] = true;
  body.innerHTML = days.length ? days.map(historyDayHtml).join("") :
    '<div class="history-empty">No reversible edits yet.</div>';
  if (HISTORY_HAS_MORE) body.insertAdjacentHTML("beforeend",
    '<button class="btn" data-history-more style="margin:2px auto 8px">Load Older History</button>');
}
function loadHistoryPanel(append) {
  var body = $("#history-body");
  if (body && !append) body.innerHTML = '<div class="history-loading">Loading history…</div>';
  var before = append && HISTORY_EVENTS.length ? "&before=" + HISTORY_EVENTS[HISTORY_EVENTS.length - 1].sequence : "";
  return api("history?limit=100" + before).then(function (j) {
    HISTORY_EVENTS = append ? HISTORY_EVENTS.concat(j.events || []) : (j.events || []);
    HISTORY_HAS_MORE = !!j.has_more; renderHistoryPanel();
  }).catch(function (e) {
    if (body) body.innerHTML = '<div class="history-empty">' + esc(e.message) + "</div>";
  });
}
function historyPanelOpen() {
  var panel = $("#history-panel");
  return !!(panel && panel.classList.contains("on"));
}
function openHistoryPanel() {
  if (!historyAdmin()) return;
  var panel = $("#history-panel"); if (!panel) return;
  panel.classList.add("on"); panel.setAttribute("aria-hidden", "false");
  document.body.classList.add("shell-animating");
  var bw = $("#bodywrap"); if (bw) bw.classList.add("history-on");
  setTimeout(function () { document.body.classList.remove("shell-animating"); }, 260);
  loadHistoryPanel();
}
function closeHistoryPanel() {
  var panel = $("#history-panel"); if (!panel) return;
  panel.classList.remove("on"); panel.setAttribute("aria-hidden", "true");
  document.body.classList.add("shell-animating");
  var bw = $("#bodywrap"); if (bw) bw.classList.remove("history-on");
  setTimeout(function () { document.body.classList.remove("shell-animating"); }, 260);
}
function toggleHistoryPanel() {
  if (historyPanelOpen()) closeHistoryPanel(); else openHistoryPanel();
}
function openHistoryRevertPreview(eventId) {
  api("history/preview", { event_id: eventId }).then(function (p) {
    var target = p.target || {};
    var isRedo = !!target.reverts_event_id, verb = isRedo ? "Redo" : "Revert action";
    var warning = "";
    if ((p.irreversible || []).length) warning += '<div class="history-warning"><b>External effect remains.</b> ' +
      "This action sent an email, Google Sheets push, or other external effect that the database cannot take back.</div>";
    openModal('<div class="modal-hd"><h2>' + (isRedo ? "Redo this action?" : "Revert this action?") + '</h2></div>' +
      '<div class="modal-body">' +
      '<p style="font-size:var(--fs-body-sm);color:var(--ink-2);line-height:1.5;margin:0">' +
      "This action will be reversed without intentionally changing unrelated later work.</p>" + warning +
      '<div class="history-preview"><div class="history-preview-row"><b>' + esc(target.label || "") + '</b><span>' +
      esc((target.actor_name || "") + " · " + historyDate(target.occurred_at)) + '</span><span>' +
      p.change_count + " database change" + (p.change_count === 1 ? "" : "s") + " will be reversed</span></div></div>" +
      "</div>" +
      '<div class="modal-ft"><button class="btn" id="modal-cancel">Cancel</button><span style="flex:1"></span>' +
      '<button class="btn bad" id="history-confirm"' + (p.can_apply ? "" : " disabled") + ">" + verb + "</button></div>");
    var confirm = $("#history-confirm");
    if (confirm && p.can_apply) confirm.addEventListener("click", function () {
      confirm.disabled = true; confirm.textContent = isRedo ? "Redoing…" : "Reverting…";
      api("history/revert", { event_id: eventId, baseline_sequence: p.baseline_sequence }).then(function (r) {
        closeModal();
        return reload().then(function () {
          toast((isRedo ? "Redone" : "Reverted action") + " · " + r.change_count + " change" + (r.change_count === 1 ? "" : "s"));
        });
      }).catch(function (e) {
        confirm.disabled = false; confirm.textContent = verb;
        toast(e.message, true);
      });
    });
  }).catch(function (e) { toast(e.message, true); });
}

$("#history-close") && $("#history-close").addEventListener("click", closeHistoryPanel);
$("#history-panel") && $("#history-panel").addEventListener("click", function (e) {
  var rev = e.target.closest("[data-history-revert]");
  var more = e.target.closest("[data-history-more]");
  var day = e.target.closest("[data-history-day]");
  var chip = day ? null : e.target.closest("[data-history-jump]");
  if (rev) openHistoryRevertPreview(rev.dataset.historyRevert);
  else if (day) { HISTORY_OPEN_DAYS[day.dataset.historyDay] = !HISTORY_OPEN_DAYS[day.dataset.historyDay]; renderHistoryPanel(); }
  else if (more) { more.disabled = true; more.textContent = "Loading…"; loadHistoryPanel(true); }
  else if (chip) {
    var root = HISTORY_EVENTS.filter(function (x) { return x.id === chip.dataset.historyJump; })[0];
    var go = root && historyEventJump(root);
    if (go) go();
  }
});
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && historyPanelOpen()) closeHistoryPanel();
});
})();

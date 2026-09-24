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
function api(path, body) {
  return dashboardAuth.fetch("/api/" + path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(function (r) { return r.json(); }).then(function (j) {
    if (j && j.error) throw new Error(j.error);
    return j;
  });
}
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
  var accountLine = LOCAL_AUTH.enabled && DB && DB.me
    ? ((DB.me.is_admin ? "Administrator" : "Restricted access") + " · local account")
    : (dashboardAuth.config.enabled ? "Microsoft account" : "This device");
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

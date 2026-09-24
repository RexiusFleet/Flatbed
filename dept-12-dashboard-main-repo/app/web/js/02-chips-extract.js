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
    var base = location.origin + "/vendor/"; // must be absolute — the worker's own base URL is a blob:, so relative paths don't resolve
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

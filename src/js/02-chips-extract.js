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
/* An edit shows on the chips the moment the save comes back: the saved row goes into the page's copy of the order, the names that
   come from other tables are recomputed, and every chip for that order (Scheduler, Current Week, Driver Tabs, the drawer preview)
   is repainted. The full reload that still follows only catches what the server derives. */
function patchOrderLocal(oid, row) {
  var o = order(oid); if (!o) return null;
  if (row && lastPushMs()) {
    var edited = PUB_ORDER_FIELDS.some(function (f) { return f in row && String(o[f] == null ? "" : o[f]) !== String(row[f] == null ? "" : row[f]); }) ||
      (o.is_transfer && "notes" in row && String(o.notes || "") !== String(row.notes || ""));
    if (edited) PUB.dirty[oid] = true;
  }
  if (row) {
    for (var k in row) o[k] = row[k];
    ["customer_party_id", "broker_party_id", "transfer_department_id"].forEach(function (f) { if (f in row) applyOrderFkDenorm(o, f, row[f]); });
  }
  Object.keys(CELLS || {}).forEach(function (key) { if (CELLS[key] && CELLS[key].oid === oid) repaintCell(key); });
  if (DRAWER_OID === oid && typeof refreshDrawerChipPreview === "function") refreshDrawerChipPreview();
  return o;
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
/* Names are kept in full; the app shows the first name. Two active drivers with the same first name get a last initial (Matt S.). */
function dFirst(full) {
  var parts = String(full || "").trim().split(/\s+/); if (!parts[0]) return "";
  var first = parts[0].toLowerCase(), same = (DB.drivers || []).filter(function (d) { return d.active !== false && String(d.full_name || "").trim().split(/\s+/)[0].toLowerCase() === first; });
  if (same.length > 1 && parts.length > 1) return parts[0] + " " + parts[parts.length - 1].charAt(0).toUpperCase() + ".";
  return parts[0];
}
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
function docsFor(oid) {
  // Driver scans are in DB.documents too; they're shown through DRIVER scans below
  // so "Bill with" decides which load they count for.
  return DB.documents.filter(function (d) { return d.order_id === oid && !DRIVER_SCAN_IDS[d.id]; })
    .concat(PROTO_SCANS.filter(function (d) { return d.order_id === oid; }));
}
/* Driver activity from Supabase (api_driver_activity): notes, POD/BOL scans and
   when each truck last opened Current Week / its own tab. Refreshed every minute
   while the dashboard is open. A scan always stays on file on the load it was
   scanned on; "Bill with" says which load it bills with (or none). */
var PROTO_SCANS = [], PROTO_SCAN_RECS = [];
var DRIVER_NOTES = {}, DRIVER_VIEWS = {}, DRIVER_SCAN_IDS = {}, LAST_PUBLISH_MS = 0, DRIVER_SIG = "";
// Which load a driver scan bills with: the load it was scanned on unless
// dispatch moved it (bill_order_id) or took it out of billing (null).
function scanBillOrder(r) { return r.bill_order_id === undefined ? r.order_id : r.bill_order_id; }
function loadDriverActivity() {
  if (typeof api !== "function" || !DB || !DB.orders) return Promise.resolve();
  return api("driver/activity").then(function (res) {
    var notes = res.notes || [], scans = res.scans || [], views = res.views || [];
    var sig = [notes.length, notes[0] && notes[0].created_at, scans.length,
      scans.map(function (x) { return x.id + ":" + x.bill_decided + ":" + x.bill_order_id; }).join(",")].join("|");
    DRIVER_NOTES = {};
    notes.forEach(function (n) {
      (DRIVER_NOTES[n.order_id] = DRIVER_NOTES[n.order_id] || []).push(
        { id: n.id, at: n.created_at, driver: n.driver_name, truck: n.truck_number, text: n.body });
    });
    DRIVER_VIEWS = {};
    views.forEach(function (v) {
      var r = DRIVER_VIEWS[String(v.truck_number)] = DRIVER_VIEWS[String(v.truck_number)] || {};
      if (v.driver_name) r.name = v.driver_name;
      r[v.kind] = v.viewed_at;
    });
    LAST_PUBLISH_MS = res.last_publish ? Date.parse(res.last_publish) || 0 : 0;
    DRIVER_SCAN_IDS = {};
    scans.forEach(function (x) { DRIVER_SCAN_IDS[x.id] = true; });
    ACT_ITEMS = notes.map(function (n) {
      return { id: n.id, k: "note", at: n.created_at, driver: n.driver_name, truck: n.truck_number, oid: n.order_id, text: n.body };
    }).concat(scans.filter(function (x) { return x.order_id; }).map(function (x) {
      return { id: x.id, k: "scan", at: x.created_at, driver: x.driver, truck: x.truck, oid: x.order_id, pages: x.pages || 1 };
    })).sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    (res.read || []).forEach(function (id) { ACT_READ[id] = true; });
    PROTO_SCAN_RECS = scans.filter(function (x) { return x.order_id; }).map(function (x) {
      return { id: x.id, order_id: x.order_id, at: x.created_at, pages: x.pages || 1, driver: x.driver, truck: x.truck,
               storage_path: "driver-scan:" + x.storage_path,
               bill_order_id: x.bill_decided ? x.bill_order_id : undefined };
    });
    // A scan the driver named keeps that name ("Signed BOL Walmart.pdf", carried in the stored file's name); the rest are "<order #> scan1", "scan2" ... in the order they came in.
    var scanSeq = {};
    PROTO_SCAN_RECS.slice().sort(function (a, b) { return a.at < b.at ? -1 : 1; }).forEach(function (r) {
      var m = /\/\d+__([^/]+)\.pdf$/.exec(String(r.storage_path || ""));
      if (m) { r.name = m[1].replace(/_/g, " ") + ".pdf"; return; }
      var o = order(r.order_id), n = scanSeq[r.order_id] = (scanSeq[r.order_id] || 0) + 1;
      r.name = ((o && (o.rexius_order_no || o.broker_load_no)) || "Scan") + " scan" + n + ".pdf";
    });
    PROTO_SCANS = PROTO_SCAN_RECS.filter(function (r) { return scanBillOrder(r); }).map(function (r) {
      return { id: "scan-" + r.id, order_id: scanBillOrder(r), doc_type: "pod", created_at: r.at, proto: true,
        storage_path: r.storage_path, matched_by: "driver_scan",
        original_filename: r.name };
    });
    try { repaintSeen(); } catch (e) { /* header not drawn yet */ }
    if (sig === DRIVER_SIG) return;
    var first = DRIVER_SIG === "";
    DRIVER_SIG = sig;
    var typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (DRAWER_OID && !typing) {
      var nEl = $("#dw-drvnotes"), sEl = $("#dw-drvscans");
      if (nEl) nEl.outerHTML = driverNotesHtml(DRAWER_OID);
      if (sEl) sEl.outerHTML = driverScansHtml(DRAWER_OID);
    }
    if (!first && !typing) { try { render(); } catch (e) { /* mid-load */ } }
  }).catch(function () { /* offline or not signed in yet: try again next minute */ });
}
// Every 15 seconds while the dashboard is in front, and right away when you come back to it.
var ACT_BUSY = false;
function actPoll() { if (document.hidden || ACT_BUSY) return; ACT_BUSY = true; loadDriverActivity().then(function () { ACT_BUSY = false; }, function () { ACT_BUSY = false; }); }
setInterval(actPoll, 15000);

/* ── Live updates (two dispatchers on one dashboard) ─────────────────────────────────────────────────────
   Every few seconds the dashboard asks Supabase what changed since its last fetch (the same History-log call a normal save uses).
   If someone else changed something, it redraws from the merged copy, but only when you are not in the middle of something
   (typing, a drag, a popup): a waiting update is applied the moment you are idle. The order open in the side window is refreshed
   too, or closed if someone deleted it. */
var LIVE = { busy: false, pending: false, ids: {}, drag: false, ms: 4000 };
var RELOADING = 0;
document.addEventListener("dragstart", function () { LIVE.drag = true; }, true);
document.addEventListener("dragend", function () { LIVE.drag = false; }, true);
document.addEventListener("drop", function () { setTimeout(function () { LIVE.drag = false; }, 0); }, true);
function liveBusy() {
  var a = document.activeElement;
  // A text box with something typed in it that isn't saved yet is off limits; one you only clicked into is not.
  if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== "checkbox" && a.type !== "radio" && a.type !== "button" && a.type !== "submit" &&
      (a.value !== a.defaultValue || a.classList.contains("cell-input"))) return true;
  if (a && a.isContentEditable) return true;
  if (LIVE.drag) return true;
  if (typeof EDITING !== "undefined" && EDITING) return true;
  if ((typeof MARQ !== "undefined" && MARQ) || (typeof FILL !== "undefined" && FILL) || (typeof NOTEDRAG !== "undefined" && NOTEDRAG) ||
      (typeof ROWDRAG !== "undefined" && ROWDRAG) || (typeof BDRAG !== "undefined" && BDRAG)) return true;
  var m = document.getElementById("modal"); if (m && m.classList.contains("on")) return true;
  if (typeof PN_OPEN !== "undefined" && PN_OPEN) return true;
  return false;
}
function liveApply() {
  var ids = LIVE.ids; LIVE.pending = false; LIVE.ids = {};
  AUTOSTAGE_OFF = true;          // other people's new orders are not staged on this screen
  return reload().then(function () {
    if (!DRAWER_OID) return;
    if (!order(DRAWER_OID)) { closeDrawer(); toast("That order was deleted by someone else", true); return; }
    if (ids[DRAWER_OID] || ids.__all) openOrder(DRAWER_OID);
  });
}
function livePoll() {
  if (LIVE.busy || document.hidden || typeof DB === "undefined" || !DB || !DB.orders) return;
  if (API_WRITES.open || RELOADING) return;      // one of your own saves is still going: let it finish and redraw first
  LIVE.busy = true;
  var seq = API_WRITES.seq;
  api("bootstrap/poll").then(function (r) {
    if (r && r.changed) { LIVE.pending = true; if (r.all) LIVE.ids.__all = true; (r.orders || []).forEach(function (id) { LIVE.ids[id] = true; }); }
    // If you saved something while this check was running, your own redraw owns the screen; the next check applies the rest.
    if (seq !== API_WRITES.seq || API_WRITES.open || RELOADING) return;
    if (LIVE.pending && !liveBusy()) return liveApply();
  }).catch(function () { /* offline or signed out: try again next time */ }).then(function () { LIVE.busy = false; });
}
setInterval(livePoll, LIVE.ms);
document.addEventListener("visibilitychange", function () { if (!document.hidden) livePoll(); });
window.addEventListener("focus", livePoll);

document.addEventListener("visibilitychange", actPoll);
window.addEventListener("focus", actPoll);
/* Driver scans section in the order drawer. A scan always stays on file on
   the load it was scanned on; dispatch picks whether it bills, and with
   which load (a BOL scanned on the wrong load, paperwork you don't bill). */
function orderLabel(o) { return (o.rexius_order_no || o.broker_load_no || "no #") + " · " + buildChip(o).title; }
function driverScansHtml(oid) {
  var recs = PROTO_SCAN_RECS.filter(function (r) { return r.order_id === oid || scanBillOrder(r) === oid; });
  var h = '<div id="dw-drvscans"><div class="sec-h">Driver scans — ' + recs.length + "</div>";
  if (!recs.length) return h + '<p class="drvnote-empty">No POD / BOL scans from the driver yet.</p></div>';
  var choices = orders().filter(function (o) { return isExt(o) && !o.is_transfer && !o.billed_date && !isHistorical(o); });
  return h + '<div class="drvnote-list">' + recs.map(function (r) {
    var d = new Date(r.at), bill = scanBillOrder(r), here = r.order_id === oid, src = order(r.order_id);
    var opts = [["", "Not for billing (keep on file)"]], seen = {};
    [r.order_id, bill].concat(choices.map(function (o) { return o.id; })).forEach(function (id) {
      var o = id && order(id); if (!o || seen[id]) return; seen[id] = 1;
      opts.push([id, (id === r.order_id ? "Scanned on · " : "") + orderLabel(o)]);
    });
    var status = !bill ? "Not used for billing" : bill === oid ? (here ? "Billing with this load" : "Moved here from " + (src ? orderLabel(src) : "another load"))
      : "Billing with " + (order(bill) ? orderLabel(order(bill)) : "another load");
    return '<div class="drvnote dscan"><div class="drvnote-hd"><b>' + esc(r.driver || "Driver") + "</b><span>" +
      esc(d.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" }) + " " +
        d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + " · " + r.pages + " page" + (r.pages > 1 ? "s" : "")) + "</span></div>" +
      '<div class="dscan-row"><span class="dscan-st' + (bill ? "" : " off") + '">' + esc(status) + "</span>" +
      '<button class="btn sm" data-viewpath="' + esc(r.storage_path) + '" data-viewname="POD scan">View</button></div>' +
      '<label class="dscan-bill">Bill with <select data-scan-bill="' + esc(r.id) + '">' + opts.map(function (op) {
        return '<option value="' + esc(op[0]) + '"' + ((op[0] || null) === (bill || null) ? " selected" : "") + ">" + esc(op[1]) + "</option>";
      }).join("") + "</select></label></div>";
  }).join("") + "</div></div>";
}
document.addEventListener("change", function (e) {
  var sel = e.target.closest && e.target.closest("[data-scan-bill]");
  if (!sel) return;
  var id = sel.getAttribute("data-scan-bill"), val = sel.value || null;
  api("driver/scan-bill", { id: id, bill_order_id: val }).then(function () {
    toast(val ? "Scan will bill with " + orderLabel(order(val)) : "Scan kept on file, not billed");
    DRIVER_SIG = "x"; return loadDriverActivity();
  }).catch(function (err) { toast(err.message, true); });
});
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

/* Appointments are plain text now: whatever is typed under a pick or drop goes to the driver tab as typed.
   A normal (one pick, one drop) order keeps them on the order (pick_appt_text / drop_appt_text); stops of a
   multi-stop route keep theirs in the stop's own note. */
var APPT_TEXT = { pick: "pick_appt_text", drop: "drop_appt_text" };
function apptGet(oid, which) {
  var o = order(oid); if (!o) return "";
  var t = o[APPT_TEXT[which]];
  return t ? String(t) : "";
}
function apptSet(oid, which, text) {
  var body = { id: oid }; body[APPT_TEXT[which]] = text || "";
  return api("order/update", body).then(function (row) {
    patchOrderLocal(oid, row);
    return row;
  });
}
// Any appointment on this load, on the order or on one of its stops.
function apptHas(oid) {
  var o = order(oid);
  if (apptGet(oid, "pick") || apptGet(oid, "drop")) return true;
  return !!(o && o.route_mode === "custom" && orderStops(oid).some(function (s) { return s.notes; }));
}
/* Little notepad for the note line on external chips. */
var NOTEPAD_ICON = '<svg class="notepad" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 2h9v12h-9zM6 5.5h4M6 8h4M6 10.5h2.5"/></svg> ';
/* ── Chip construction — built, never stored ─────────────────────────────── */
function buildChip(o) {
  var flags = [], notes = [], pnote = "", win = "anytime", title, line, route, nums;
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
    nums = (o.broker_load_no || "no load #") + " / " + (o.rexius_order_no || "no order #");
    line = route + " · " + nums;
    if (o.tarp) flags.push("TARP");
    if (o.backhaul) flags.push("BACKHAUL");   // dispatcher-only: never published to drivers or the bag plant
    pnote = o.notes || "";   // the private note: boxed on the chip so it can't be missed
  } else {
    title = o.customer_name || "(no customer)";
    line = (o.pallet_count ? o.pallet_count + " PAL · " : "") + (o.rexius_order_no || "no order #");
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
    pnote = o.notes || ""; // this dispatch's own private note, from the drawer — D34
  }
  return { title: title, line: line, route: route, nums: nums, win: win, flags: flags, pnote: pnote,
           note: notes.join(" · "), needsNumber: !o.rexius_order_no && !o.is_transfer };
}
/* A small PDF badge on a load chip when the order has paperwork the driver can open. Nothing shows until it has been published. */
function paperBadge(o) {
  if (PUB.dirty[o.id] || !lastPushMs()) return "";
  var n = DB.documents.filter(function (d) { return d.order_id === o.id && !DRIVER_SCAN_IDS[d.id] && d.extracted_fields && d.extracted_fields.driver_visible === true; }).length;
  if (!n) return "";
  return '<span class="paper-ind" title="The driver can open this paperwork from the load.">' + icon("pdf") + (n > 1 ? n : "") + "</span>";
}
function chipHtml(o, drag, extra, catColor, fmt, pushColor, pushed) {
  if (pushed && PUB.dirty[o.id]) pushed = false;   // changed since the last publish: back to the plain look until it is published again
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
  /* External loads only (Nate): before a load is pushed to the drivers the
     chip is plain — white with a thick edge in its color. Once pushed, it
     takes a soft tint of the truck's driver color, edge unchanged. Text stays
     the normal ink either way. Bag (07-) orders and Internal Freight keep the
     original solid fill. */
  var plainExt = isExt(o) && !o.is_transfer;
  var filled = !plainExt && !!fill;
  var tinted = plainExt && !!fill && !!pushed;
  var edge = fill || w.c;
  var textc = (fmt.text && fmt.text.charAt(0) === "#") ? fmt.text : (filled ? textOn(fill) : "");
  var ws = "";
  if (textc) ws += "color:" + textc + ";";
  if (fmt.bold) ws += "font-weight:800;";
  if (fmt.italic) ws += "font-style:italic;";
  if (fmt.size) { var _fs = parseInt(fmt.size, 10); if (_fs > 0) ws += "font-size:" + _fs + "px;"; }
  var bg = filled ? ";background:" + fill + (textc ? ";color:" + textc : "")
         : tinted ? ";background:color-mix(in srgb," + fill + " 17%,var(--panel))" : "";
  var chipTitle = [ch.title, ch.line].concat(ch.flags || []).concat(ch.pnote ? [ch.pnote] : []).concat(ch.note ? [ch.note] : [])
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
        '<span class="nowrap">' + esc(o.rexius_order_no || "no order #") + "</span></div>"
    : (isExt(o) && !o.is_transfer)
    ? '<div class="meta meta-2line meta-route"><span class="route-line">' + esc(ch.route) + "</span>" +
        '<span class="numln"><i>Load #:</i> <b class="nowrap">' + esc(o.broker_load_no || "none") + "</b></span>" +
        '<span class="numln"><i>Rexius Order:</i> <b class="nowrap">' + esc(o.rexius_order_no || "none") + "</b></span></div>"
    : '<div class="meta"><span>' + esc(ch.line) + "</span></div>";
  var hasAppt = plainExt && apptHas(o.id);
  return '<div class="chip' + (filled ? " filled" : "") + (plainExt ? " xchip" : "") + (o.is_transfer ? " xfer" : "") + (tinted ? " tinted" : "") + (hasAppt ? " has-appt" : "") + '" style="--edge:' + edge + bg + '" draggable="' + (drag ? "true" : "false") +
    '" data-oid="' + o.id + '" title="' + esc(chipTitle) + '" ' + (extra || "") + ">" +
    (hasAppt ? '<span class="appt-ind" title="This load has an appointment">APPT</span>' : "") + paperBadge(o) +
    '<div class="who"' + (ws ? ' style="' + ws + '"' : "") + ">" + esc(ch.title) + "</div>" +
    metaHtml +
    (f ? '<div class="flags">' + f + "</div>" : "") +
    (ch.pnote ? '<div class="note pnote" title="Private note: only you see this">' + NOTEPAD_ICON + esc(ch.pnote) + "</div>" : "") +
    (ch.note ? '<div class="note">' + NOTEPAD_ICON + esc(ch.note) + "</div>" : "") +
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

/* ── PDF libraries, loaded on first use ───────────────────────────────────
   pdf.js (read PDFs), Tesseract (OCR) and pdf-lib (write/merge PDFs) are about
   900 KB together, so the page doesn't load them at startup: the first feature
   that needs one calls loadVendor(...).then(...). Each file loads once; a
   failed load can be retried by the next use. */
var VENDOR = {
  pdfjs:  { src: "vendor/pdf.min.js",       global: "pdfjsLib" },
  tess:   { src: "vendor/tesseract.min.js", global: "Tesseract" },
  pdflib: { src: "vendor/pdf-lib.min.js",   global: "PDFLib" }
}, VENDOR_LOADING = {};
function loadVendor() {
  return Promise.all(Array.prototype.map.call(arguments, function (name) {
    var v = VENDOR[name];
    if (window[v.global]) return Promise.resolve();
    return VENDOR_LOADING[name] || (VENDOR_LOADING[name] = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = v.src;
      s.onload = function () {
        if (name === "pdfjs") pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
        res();
      };
      s.onerror = function () { delete VENDOR_LOADING[name]; s.remove(); rej(new Error("Couldn't load " + v.src)); };
      document.head.appendChild(s);
    }));
  }));
}

/* ── PDF extraction — ported from legacy/invoicing-local ─────────────────── */
function pdfText(b64) {
  return loadVendor("pdfjs").then(function () {
    return pdfjsLib.getDocument({ data: bytesFromB64(b64) }).promise;
  }).then(function (pdf) {
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
var OCR_WORKER = null, OCR_WARMED = false;
function getOcrWorker() {
  if (!OCR_WORKER) {
    OCR_WORKER = loadVendor("tess").then(function () {
      var base = new URL("vendor/", location.href).href; // must be absolute — the worker's own base URL is a blob:, so relative paths don't resolve. Relative to the page so a sub-path static host works.
      return Tesseract.createWorker("eng", 1, {
        workerPath: base + "worker.min.js",
        corePath: base + "tesseract-core.wasm.js",
        langPath: base.slice(0, -1),
        gzip: true
      });
    });
    OCR_WORKER.catch(function () { OCR_WORKER = null; });   // let the next use try again
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
function ocrPdf(b64, onProgress, opts) {
  opts = opts || {};
  return loadVendor("pdfjs").then(function () {
    return pdfjsLib.getDocument({ data: bytesFromB64(b64) }).promise;
  }).then(function (pdf) {
    return getOcrWorker().then(function (worker) {
      var last = opts.maxPages ? Math.min(pdf.numPages, opts.maxPages) : pdf.numPages;
      var pages = []; for (var i = 1; i <= last; i++) pages.push(i);
      var finished = false;
      return pages.reduce(function (chain, n) {
        return chain.then(function (acc) {
          if (finished) return acc;
          if (onProgress) onProgress(n, last);
          return pdfPageImage(pdf, n).then(function (dataUrl) {
            return worker.recognize(dataUrl).then(function (r) {
              var all = acc + "\n" + (r.data.text || "");
              if (opts.enough && opts.enough(all)) finished = true;   // everything we need is already on the pages read
              return all;
            });
          });
        });
      }, Promise.resolve(""));
    });
  }).catch(function (e) { console.error("OCR failed", e); return ""; });
}

/* normBroker — legacy/invoicing-local/index.html:1500 */
var STRIP_WORDS = /\b(INC|LLC|CO|CORP|LTD|INCORPORATED|COMPANY|COMPANIES|INDUSTRIES|INDUSTRY|TRANSPORTATION|TRANSPORT|LOGISTICS|LOGISTIC|FREIGHT|TRUCKING|TRUCK|SERVICES|SERVICE|GROUP|INTERNATIONAL|INTL|SUPPLY|ENTERPRISES|ENTERPRISE|BROKER|BROKERS|BROKERAGE|CARRIER|CARRIERS|DISTRIBUTION|WAREHOUSING|HOLDINGS)\b/g;
function normBroker(s) {
  return (s || "").toUpperCase().replace(/\+\+.*$/, "").replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\b\d+\b/g, " ").replace(STRIP_WORDS, " ").replace(/\s+/g, " ").trim();
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
var SOLOMON = /\d{2}-\d{4}-\d{4}/;              /* legacy tms Code.js:517, :876 */

/* parseRateCon — reads a rate con (OCR text, a PDF text layer, or a pasted email) with the reader in
   ratecon-parser.js, which knows each broker's layout, and returns the shape the rest of the app uses.
     broker / broker_id   the matched customer or broker (only when it matches one on file)
     load_no, solomon, po, rate
     pickup, delivery     { name, address, city, state, zip, appt, conf }, conf "ok" or "check"
     rc                   the reader's full answer: .family, .conf (per field), .missing, .stops */
function parseRateCon(text, filename) {
  var RC = window.Dept12RateCon;
  var rc = RC.parse(text, { filename: filename, brokers: brokerList().map(function (b) { return b.name; }) });
  var f = rc.fields;
  var out = { broker: "", load_no: f.load_no || "", solomon: f.rexius_order_no || "", po: f.po || "",
              rate: f.rate == null ? null : f.rate, source: [], rc: rc, family: rc.family };
  if (f.broker) {
    var exact = brokerList().filter(function (b) { return b.name === f.broker; })[0];
    var hit = exact ? { broker: exact } : findBroker(f.broker);
    if (hit && hit.broker) { out.broker = hit.broker.name; out.broker_id = hit.broker.id; out.broker_conf = exact ? rc.conf.broker : "check"; }
    else out.broker_guess = f.broker;
  }
  function shape(s) { return s ? { name: s.name, address: s.address, city: s.city, state: s.state, zip: s.zip, appt: s.appt, conf: s.conf } : null; }
  out.pickup = shape(rc.pickup); out.delivery = shape(rc.delivery);
  out.stops = rc.stops.map(function (s) { var x = shape(s); x.stop_type = s.type; return x; });
  if (out.load_no) out.source.push("load #");
  if (out.po) out.source.push("PO");
  if (out.rate != null) out.source.push("rate");
  if (out.broker) out.source.push("broker");
  if (out.pickup) out.source.push("pickup");
  if (out.delivery) out.source.push("delivery");
  return out;
}

/* Reading a scanned Rexius invoice. Reading the whole page as one block misses the small boxes: on 428 real scans
   the full-page read found the invoice number 72% of the time and the Rexius order number almost never (the table
   cell is shaded and the number prints with no dashes). The form is the same every time, so read just the two boxes
   that matter, each on its own: the top right (invoice date, invoice no., customer no.) and the order table (order no.).
   Tested on those 428 scans: invoice number 99%, order number 99%, and every order number matched the delivery
   receipt in the same file. Smaller pictures also make it faster than reading the whole page. */
var INVOICE_BANDS = {
  head:  { box: [0.60, 0.0, 1.0, 0.22],    zoom: 2 },     // invoice date, invoice no., customer no.
  table: { box: [0.0, 0.295, 1.0, 0.37],   zoom: 2 },     // the order table: Rexius order no.
  row:   { box: [0.0, 0.312, 1.0, 0.352],  zoom: 3 },     // its one data row: customer order no. (the broker's load #), truck, terms
  sold:  { box: [0.0, 0.18, 1.0, 0.30],    zoom: 2 }      // Sold To / Shipped To: names and street addresses
};
function loadImageEl(src) {
  return new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = src; });
}
function readInvoiceBands(b64) {
  return loadVendor("pdfjs").then(function () {
    return pdfjsLib.getDocument({ data: bytesFromB64(b64) }).promise;
  }).then(function (pdf) {
    return pdfPageImage(pdf, 1);
  }).then(loadImageEl).then(function (img) {
    return getOcrWorker().then(function (worker) {
      function crop(band) {
        var b = band.box, z = band.zoom, w = img.width, h = img.height, x = Math.floor(w * b[0]), y = Math.floor(h * b[1]),
            cw = Math.floor(w * (b[2] - b[0])), ch = Math.floor(h * (b[3] - b[1]));
        var c = document.createElement("canvas"); c.width = cw * z; c.height = ch * z;
        c.getContext("2d").drawImage(img, x, y, cw, ch, 0, 0, cw * z, ch * z);
        return c.toDataURL("image/png");
      }
      var out = {}, chain = worker.setParameters({ tessedit_pageseg_mode: "11" });   // sparse text: finds numbers floating in boxes
      Object.keys(INVOICE_BANDS).forEach(function (k) {
        chain = chain.then(function () { return worker.recognize(crop(INVOICE_BANDS[k])); }).then(function (r) { out[k] = r.data.text || ""; });
      });
      return chain.then(function () { return worker.setParameters({ tessedit_pageseg_mode: "3" }); }).then(function () { return out; });
    });
  }).then(function (o) {
    if (!o) return null;
    var inv = (o.head.match(/\b\d{6}\b/g) || []).filter(function (x) { return x.indexOf("1200") !== 0; })[0] || null;
    var ordRe = /\b(12)(\d{2})(\d{2})(\d{4})\b/g;
    var on = ((o.table + "\n" + o.row).match(ordRe) || []).filter(function (x) { var m = +x.slice(2, 4); return m >= 1 && m <= 12; })[0];
    var solomon = on ? on.slice(0, 2) + "-" + on.slice(2, 6) + "-" + on.slice(6) : null;
    // customer order no. (the broker's load #): whatever else in the table row looks like a number or code
    var toks = (o.row + "\n" + o.table).split(/\n+/).map(function (x) { return x.replace(/[^A-Za-z0-9\-]/g, "").toUpperCase(); })
      .filter(function (x) { return x.length >= 4 && /\d/.test(x) && !/^12\d{8}$/.test(x) && !/^00\d{2}$/.test(x); });
    var keys = o.sold.split(/\n/).map(afStreetKey).filter(Boolean);
    return { invoiceNum: inv, solomon: solomon,
      text: o.head + "\n" + o.table + "\n" + o.row + (solomon ? "\n " + solomon + " " : ""),
      feat: { rowToks: toks, soldKeys: keys, soldText: o.sold.toLowerCase().replace(/[^a-z0-9 ]+/g, " ") } };
  }).catch(function (e) { console.error("Invoice band read failed", e); return null; });
}
/* Who an invoice could belong to. Scores every load still waiting to bill against what was read off the invoice:
   the Rexius order # (certain), the broker's load #, PO or delivery # in the order table, the delivery street (from the
   load's own route or its rate con), and the Bill To name. Tested on 194 real invoices against their own rate cons: a best
   score of 5 or more with a 3-point lead picked the right load 102 times and the wrong one twice; the rest were
   repeat lanes (same broker, same drop) that only a load # tells apart. So a match from this is a suggestion to confirm,
   never attached on its own. */
function invoiceCandidates(info) {
  var f = info.feat || {}, toks = f.rowToks || [], keys = f.soldKeys || [], soldText = f.soldText || "", out = [];
  function compact(v) { return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
  queueOrders().forEach(function (o) {
    var sc = 0, why = [];
    if (info.solomon && o.rexius_order_no === info.solomon) { sc += 20; why.push("Order # " + info.solomon); }
    var ids = [["Load #", o.broker_load_no], ["PO #", o.po_number], ["Delivery #", o.delivery_number]];
    for (var i = 0; i < ids.length && !why.some(function (w) { return /#/.test(w) && w !== "Order # " + info.solomon; }); i++) {
      var k = compact(ids[i][1]);
      if (k.length >= 4 && toks.some(function (t) { t = compact(t); return t === k || (k.length >= 5 && t.indexOf(k) >= 0); })) { sc += 6; why.push(ids[i][0] + " " + ids[i][1]); }
    }
    var addrs = [], loc = o.delivery_location_id ? locById(o.delivery_location_id) : null;
    if (loc && loc.address) addrs.push(loc.address);
    docsFor(o.id).forEach(function (d) { var ef = d.doc_type === "rate_con" && d.extracted_fields; if (ef && ef.delivery && ef.delivery.address) addrs.push(ef.delivery.address); });
    if (addrs.some(function (a) { var key = afStreetKey(a); return key && keys.indexOf(key) >= 0; })) { sc += 3; why.push("Delivery address"); }
    var title = buildChip(o).title, words = normBroker(title).toLowerCase().match(/[a-z]{4,}/g) || [];
    if (words.some(function (w) { return soldText.indexOf(w) >= 0; })) { sc += 2; why.push("Bill To " + title); }
    if (loc && loc.city && soldText.indexOf(String(loc.city).toLowerCase()) >= 0) sc += 1;
    if (sc >= 3) out.push({ order_id: o.id, score: sc, why: why });
  });
  out.sort(function (a, b) { return b.score - a.score; });
  return out;
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
  return loadVendor("pdfjs").then(function () {
    return pdfjsLib.getDocument({ data: bytesFromB64(b64) }).promise;
  }).then(function (pdf) {
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
          return readInvoiceBands(b64).then(function (bands) {
            if (bands && (bands.invoiceNum || bands.solomon)) return { invoiceNum: bands.invoiceNum, solomon: bands.solomon, text: bands.text, feat: bands.feat };
            return ocrPdf(b64);
          }).then(function (ocrText) {
            if (ocrText && typeof ocrText === "object") return ocrText;
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
  return loadVendor("pdflib").then(function () {
    return PDFLib.PDFDocument.create();
  }).then(function (out) {
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

/* ═══ 04-views ═══ */
/* ── Views ───────────────────────────────────────────────────────────────── */
/* Truck is the Scheduler column's identity (D32); driver is the current
   occupant, shown secondary and tinted with their color if set. */
// The column header takes the driver's color (a tint with a thick line along the bottom), see .has-dc in app.css.
// A saved driver color can carry see-through (8 digit hex); the header line and tint use the solid color.
function dcSolid(c) { c = String(c || ""); return /^#[0-9a-f]{8}$/i.test(c) ? c.slice(0, 7) : c; }
function dcClass(t) { return t.driver_color ? " has-dc" : ""; }
function dcStyle(t) { return t.driver_color ? "--dc:" + esc(dcSolid(t.driver_color)) + ";" : ""; }
function truckColHeader(t) {
  var dc = t.driver_color ? ' style="--dc:' + esc(t.driver_color) + '"' : "";
  return '<span class="drv"' + dc + '>' + esc(dFirst(t.driver_name) || "— unassigned —") + "</span>" +
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
/* OFF day: the truck's cells are red-striped (td.offday) and one bold "OFF"
   sits in the middle slot of that day, centered — the same OFF on every
   screen (Scheduler, Current Week, the drivers' and bag plant pages). */
function offLabelFor(key) {
  var p = key.split("|"), ds = p[1], slot = +p[2];
  if (!OFFDAYS[p[0] + "|" + ds]) return "";
  var n = Math.max(3, DAYSLOT[ds] || 0, DAYADD[ds] || 0);
  return slot === Math.ceil(n / 2) ? '<div class="off-label">OFF</div>' : "";
}
function cellInner(key) {
  var v = CELLS[key];
  if (!v) return offLabelFor(key);
  if (v.oid) { var o = order(v.oid); if (o) return chipHtml(o, true, 'data-from="' + key + '"', v.cat, v.fmt, pushColorFor(o, v), !!v.pushedAt); }
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
    if (needsHistory(iso(prev)) && !HISTORY_FETCH) ensureHistory().then(function (got) { if (got) applyHistory(); });
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
    h += '<th class="trkcol' + dcClass(t) + '" draggable="true" data-truckid="' + t.id + '" style="' + dcStyle(t) + 'width:var(--col-w,150px)">' +
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
  wrap.addEventListener("scroll", schedStatsOnScroll);
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
/* Older history — 2025 spreadsheet loads/orders and Scheduler notes from
   before DB.history_cutoff (~90 days back) — isn't part of the first load, to
   keep it fast. supabase-api.js fetches it the first time someone scrolls,
   jumps or searches back that far; after that it's loaded like everything
   else for the rest of the session. */
var HISTORY_FETCH = null;
function needsHistory(ds) { return !!(DB && DB.history_cutoff && ds && ds < DB.history_cutoff); }
function ensureHistory() {
  if (!DB || !DB.history_cutoff || !window.dept12LoadHistory) return Promise.resolve(false);
  // Already have the older dates: nothing to load, so no "Loading…" message
  // (it used to pop up again on every redraw of an older week).
  if (window.dept12HistoryLoaded && window.dept12HistoryLoaded()) return Promise.resolve(false);
  if (!HISTORY_FETCH) {
    toast("Loading earlier dates…");
    HISTORY_FETCH = window.dept12LoadHistory()
      .then(function (got) { return got ? api("bootstrap").then(function (d) { DB = d; return true; }) : false; })
      .catch(function (err) { toast(err.message, true); return false; })
      .then(function (got) { HISTORY_FETCH = null; return got; });
  }
  return HISTORY_FETCH;
}
/* The date of the first day row visible at the top of the Scheduler. */
function schedTopDate() {
  if (!schedNode) return null;
  var top = schedNode.getBoundingClientRect().top, rows = schedNode.querySelectorAll(".rowhd");
  for (var i = 0; i < rows.length; i++) if (rows[i].getBoundingClientRect().bottom > top + 40) return rows[i].id.slice(4);
  return null;
}
/* Pick up history that just arrived: rebuild the Scheduler in place (same
   months, same day at the top) if it's showing, else just refresh lookups. */
function applyHistory() {
  if (SUB === "sched" && schedNode && schedNode.parentNode) {
    var anchor = schedTopDate();
    schedNode = null; render();
    requestAnimationFrame(function () {
      var el = anchor && document.getElementById("row-" + anchor);
      if (el) el.scrollIntoView({ block: "start" });
    });
  } else {
    reindexLookups(); CELLS = cellContents(); buildOffDays(); buildDayNotes(); buildCatColor();
    schedNode = null;
  }
}
function jumpTo(ds) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) return;
  if (needsHistory(ds)) {
    // Fetch the older history first, then rebuild the board around that day.
    ensureHistory().then(function (got) { if (got) { schedNode = null; SCHED_WIN = null; jumpTo(ds); } });
    return;
  }
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
/* Driver read receipts (PROTOTYPE) — when each driver last looked at
   Current Week and at their own tab on the Flatbed Schedule page (driver/),
   measured against the last Publish Schedule. Read from Supabase
   (driver_views), refreshed every minute. */
function driverViews() { return DRIVER_VIEWS; }
function lastPushMs() {
  var ms = LAST_PUBLISH_MS || 0;
  (DB.loads || []).forEach(function (l) { var t = l.pushed_at ? Date.parse(l.pushed_at) : 0; if (t > ms) ms = t; });
  return ms;
}
function seenWhen(ms) {
  var d = new Date(ms), t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? t : d.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" }) + " " + t;
}
// {cls, txt} for one driver + one view ("cw" or "own"): seen since the last
// push, only before it, or never.
function seenState(truck, kind, push) {
  var v = driverViews()[String(truck.number)] || {}, at = v[kind] ? Date.parse(v[kind]) : 0;
  if (!at) return { cls: "none", txt: "Not opened" };
  if (push && at < push) return { cls: "stale", txt: "Old · " + seenWhen(at) };
  return { cls: "ok", txt: "Seen " + seenWhen(at) };
}
/* Driver activity menu — the person icon at the far right of the header, on every page.
   Badge = driver notes and scans not yet looked at. The list says who did what and a click opens
   that order; the table under it says who has seen the schedule. The menu stays open until the icon
   is clicked again, so it is still there (behind the order drawer) after an order is closed.
   Read marks live in Supabase (driver_activity_reads); until that SQL is run they are kept in this browser. */
var ACT_ITEMS = [], ACT_READ = {}, ACT_OPEN = false, ACT_FILTER = "all", ACT_ANIM = false;
try { JSON.parse(localStorage.getItem("actRead") || "[]").forEach(function (id) { ACT_READ[id] = true; }); } catch (e) { /* no storage */ }
function actUnread() { return ACT_ITEMS.filter(function (x) { return !ACT_READ[x.id] && order(x.oid); }); }
function actMarkRead(ids) {
  ids = ids.filter(function (id) { return !ACT_READ[id]; });
  if (!ids.length) return;
  ids.forEach(function (id) { ACT_READ[id] = true; });
  try { localStorage.setItem("actRead", JSON.stringify(Object.keys(ACT_READ).slice(-500))); } catch (e) { /* no storage */ }
  api("driver/read", { ids: ids }).catch(function () { /* SQL not run yet: the browser copy still holds */ });
  repaintSeen();
}
function actRowHtml(x) {
  var o = order(x.oid); if (!o) return "";
  var ch = buildChip(o), un = !ACT_READ[x.id];
  var who = '<b>' + esc(x.driver || "A driver") + "</b>" + (x.truck ? ' <span class="trk">' + esc(x.truck) + "</span>" : "");
  return '<div class="act-row' + (un ? " un" : "") + '" data-act="' + x.id + '" tabindex="0"><span class="act-dot"></span><div>' +
    '<div class="act-t">' + who + (x.k === "note" ? " added a note to " : " scanned " + x.pages + " page" + (x.pages > 1 ? "s" : "") + " for ") +
    "order <b>" + esc(o.rexius_order_no || "(no order #)") + "</b></div>" +
    '<div class="act-m">' + esc(ch.title) + " · " + esc(seenWhen(Date.parse(x.at))) + "</div>" +
    (x.k === "note" ? '<div class="act-q">' + esc(x.text) + "</div>" : "") + "</div></div>";
}
function seenHtml() {
  var push = lastPushMs(), drivers = DB.trucks.filter(function (t) { return t.driver_name; });
  var un = actUnread(), n = un.length;
  var h = '<span class="seen-wrap" id="seen-wrap"><button class="hbtn act-btn" id="seen-btn" aria-expanded="' + ACT_OPEN +
    '" aria-label="Driver activity' + (n ? ", " + n + " unread" : "") + '" title="Driver activity">' + icon("person") +
    (n ? '<span class="act-badge">' + (n > 99 ? "99+" : n) + "</span>" : "") + "</button>";
  if (ACT_OPEN) {
    var rows = ACT_ITEMS.filter(function (x) { return (ACT_FILTER === "all" || x.k === ACT_FILTER) && order(x.oid); }).slice(0, 40);
    h += '<div class="seen-pop act-pop' + (ACT_ANIM ? " pop-in" : "") + '" role="dialog" aria-label="Driver activity">' +
      '<div class="act-hd"><b>Driver activity</b><button class="btn sm" id="act-all"' + (n ? "" : " disabled") + ">Mark All Read</button></div>" +
      '<div class="act-filters">' + [["all", "All"], ["note", "Notes"], ["scan", "Scans"]].map(function (f) {
        return '<button class="btn sm' + (ACT_FILTER === f[0] ? " active" : "") + '" data-actf="' + f[0] + '">' + f[1] + "</button>";
      }).join("") + "</div>" +
      '<div class="act-list">' + (rows.length ? rows.map(actRowHtml).join("") : emptyStateHtml("No driver notes or scans yet.")) + "</div>" +
      '<div class="seen-grid"><span class="lbl">Driver</span><span class="lbl">Current Week</span><span class="lbl">Their Tab</span>' +
      drivers.map(function (t) {
        var a = seenState(t, "cw", push), b = seenState(t, "own", push);
        return "<b>" + esc(dFirst(t.driver_name)) + '<span class="trk"> ' + esc(t.number) + "</span></b>" +
          '<span class="seen-st ' + a.cls + '">' + esc(a.txt) + '</span><span class="seen-st ' + b.cls + '">' + esc(b.txt) + "</span>";
      }).join("") + "</div>" +
      '<div class="seen-ft">Click an item to open its order. It is marked read when you open it.</div></div>';
  }
  return h + "</span>";
}
// The icon lives at the far right of the app header on every page.
function syncHeaderSeen() {
  var host = $("#hdr-seen");
  if (!host) { var r = $(".hdr-right"); if (!r) return; host = document.createElement("span"); host.id = "hdr-seen"; r.appendChild(host); }
  host.innerHTML = seenHtml();
  pubPaint(); pubRefresh();
}
/* Publish indicator, left of the driver icon: when the schedule was last published and how many
   schedule edits (loads placed or moved, truck days off, notes, driver-visible order fields) came after it.
   Counted from the edit history; Publish Schedule itself does not count as a change. */
var PUB = { n: null, at: 0, base: -1, busy: false, dirty: {} };
var PUB_ORDER_FIELDS = ["pickup_location_id", "delivery_location_id", "pallet_count", "driver_note", "po_number", "delivery_number", "route_mode",
  "pick_appt_text", "drop_appt_text", "pick_appt_date", "pick_appt_from", "pick_appt_to", "drop_appt_date", "drop_appt_from", "drop_appt_to",
  "customer_party_id", "broker_party_id", "rexius_order_no", "broker_load_no", "tarp"];
// An order edit counts when it touches something drivers see. A transfer's "Load info" (notes) is published; other orders' private notes are not.
function pubOrderEdit(c) {
  var f = c.changed_fields || [];
  if (f.some(function (x) { return PUB_ORDER_FIELDS.indexOf(x) >= 0; })) return true;
  if (f.indexOf("notes") >= 0) { var o = order((c.primary_key || {}).id); return !!(o && o.is_transfer); }
  return false;
}
// Paperwork switched on / off for the driver (Show To Driver): the order id when this change flips the switch on a document.
function pubDocFlip(c) {
  var b = c.before_data || {}, a = c.after_data || {};
  var on = function (r) { return !!(r && r.extracted_fields && r.extracted_fields.driver_visible === true); };
  if (on(a) === on(b)) return null;
  // The log keeps only the changed columns, so the order comes from the document itself.
  var id = (c.primary_key || {}).id, doc = id ? (DB.documents || []).filter(function (x) { return x.id === id; })[0] : null;
  return a.order_id || b.order_id || (doc && doc.order_id) || null;
}
function pubCounts(ev, since) {
  if (!ev || new Date(ev.occurred_at).getTime() <= since + 8000) return false;
  return (ev.changes || []).some(function (c) {
    var f = c.changed_fields || [], t = c.table_name;
    if (t === "loads") return f.some(function (x) { return x !== "pushed_at" && x !== "updated_at"; });
    if (t === "load_orders" || t === "load_stops" || t === "schedule_notes" || t === "truck_off_days") return true;
    if (t === "trucks") return f.indexOf("driver_id") >= 0;
    if (t === "orders") return pubOrderEdit(c);
    if (t === "documents") return !!pubDocFlip(c);
    return false;
  });
}
// Which orders an event changed (for the chips that need publishing again).
function pubOrderIds(ev, since) {
  var ids = [];
  if (!ev || new Date(ev.occurred_at).getTime() <= since + 8000) return ids;
  (ev.changes || []).forEach(function (c) {
    var f = c.changed_fields || [], t = c.table_name, pk = c.primary_key || {};
    if (t === "orders") { if (pubOrderEdit(c)) ids.push(pk.id); }
    else if (t === "load_orders") ids.push(pk.order_id);
    else if (t === "loads") {
      if (!f.some(function (x) { return x !== "pushed_at" && x !== "updated_at"; })) return;
      (DB.loads || []).filter(function (l) { return l.id === pk.id; }).forEach(function (l) { (l.order_ids || []).forEach(function (id) { ids.push(id); }); });
    } else if (t === "documents") {
      var did = pubDocFlip(c); if (did) ids.push(did);
    } else if (t === "load_stops" || t === "order_stops") {
      var d = c.after_data || c.before_data || {}; if (d.order_id) ids.push(d.order_id);
    }
  });
  return ids.filter(Boolean);
}
// Orders edited since the last publish: their external chips drop back to the unpublished look (white, colored edge) until you publish again.
function pubSetDirty(nd) {
  var changed = [];
  Object.keys(nd).forEach(function (id) { if (!PUB.dirty[id]) changed.push(id); });
  Object.keys(PUB.dirty).forEach(function (id) { if (!nd[id]) changed.push(id); });
  PUB.dirty = nd;
  if (changed.length) pubRepaintChips(changed);
}
function pubRepaintChips(oids) {
  var want = {}; oids.forEach(function (id) { want[id] = true; });
  Object.keys(CELLS || {}).forEach(function (key) { var v = CELLS[key]; if (v && v.oid && want[v.oid]) repaintCell(key); });
}
function pubRefresh(force) {
  var base = lastPushMs();
  if (PUB.busy || (!force && PUB.base === base && Date.now() - PUB.at < 6000)) return;
  if (!base) { PUB.base = base; PUB.n = null; pubPaint(); return; }
  PUB.busy = true;
  api("history?limit=100", {}).then(function (r) {
    var evs = (r && r.events) || [], n = evs.filter(function (e) { return pubCounts(e, base); }).length;
    var nd = {}; evs.forEach(function (e) { pubOrderIds(e, base).forEach(function (id) { nd[id] = true; }); });
    pubSetDirty(nd);
    var oldest = evs.length ? new Date(evs[evs.length - 1].occurred_at).getTime() : 0;
    PUB.n = n; PUB.more = !!(r && r.has_more) && oldest > base;
  }, function () {}).then(function () { PUB.busy = false; PUB.at = Date.now(); PUB.base = base; pubPaint(); });
}
function pubPaint() {
  var r = $(".hdr-right"); if (!r) return;
  var el = $("#hdr-pub");
  if (!el) { el = document.createElement("span"); el.id = "hdr-pub"; el.className = "hdr-pub"; r.insertBefore(el, $("#hdr-seen") || null); }
  var base = lastPushMs();
  el.title = base ? "Schedule last published " + new Date(base).toLocaleString() : "The schedule has not been published yet";
  var ch = PUB.n == null ? "" : PUB.n ? '<b class="pub-n">' + PUB.n + (PUB.more ? "+" : "") + " change" + (PUB.n === 1 && !PUB.more ? "" : "s") + "</b>" : '<span class="pub-ok">Up to date</span>';
  el.innerHTML = 'Published <span class="pub-when">' + (base ? esc(seenWhen(base)) : "never") + "</span>" + (ch ? " · " + ch : "");
  el.classList.toggle("stale", !!PUB.n || !base);
}
function repaintSeen() {
  var w = $("#seen-wrap"); if (!w) return;
  var l = w.querySelector(".act-list"), top = l ? l.scrollTop : 0;
  w.outerHTML = seenHtml();
  l = $("#seen-wrap .act-list"); if (l && top) l.scrollTop = top;
}
document.addEventListener("click", function (e) {
  if (e.target.closest("#seen-btn")) {
    var apop = ACT_OPEN && document.querySelector(".act-pop");
    if (apop) { apop.classList.add("closing"); setTimeout(function () { ACT_OPEN = false; repaintSeen(); }, 130); return; }
    ACT_OPEN = !ACT_OPEN; ACT_ANIM = ACT_OPEN; repaintSeen(); ACT_ANIM = false; return;
  }
  if (!e.target.closest(".act-pop")) return;
  var f = e.target.closest("[data-actf]");
  if (f) { ACT_FILTER = f.getAttribute("data-actf"); repaintSeen(); return; }
  if (e.target.closest("#act-all")) { actMarkRead(actUnread().map(function (x) { return x.id; })); return; }
  var r = e.target.closest("[data-act]");
  if (r) {
    var id = r.getAttribute("data-act"), it = ACT_ITEMS.filter(function (x) { return x.id === id; })[0];
    if (!it || !order(it.oid)) return;
    actMarkRead([id]);
    openOrder(it.oid);
    var t = it.k === "note" ? $("#dw-drvnotes") : $("#dw-drvscans");
    if (t && t.scrollIntoView) t.scrollIntoView({ block: "start" });
  }
});
/* Scheduler bar: the numbers pinned on Reports, for the year of whatever day is at the top of the board, behind a Numbers toggle.
   The Internal Rate box lives on the main toolbar (all pages). */
var SCHED_STAT = { day: TODAY, motYear: "" }, SCHED_RATES_OPEN = (function () { try { return localStorage.getItem("schedRatesOpen") !== "0"; } catch (e) { return true; } })();
function schedTopDay() {
  var w = document.getElementById("sched-wrap"); if (!w) return SCHED_STAT.day;
  var r = w.getBoundingClientRect(), el = document.elementFromPoint(r.left + 40, r.top + 110), tr = el && el.closest && el.closest("tr");
  while (tr && !/^row-\d{4}-/.test(tr.id)) tr = tr.previousElementSibling;
  return tr ? tr.id.slice(4) : SCHED_STAT.day;
}
function ssItem(label, value, sub, cls) {
  return '<div class="ss' + (cls ? " " + cls : "") + '"><span class="lbl">' + esc(label) + '</span><span class="ss-v">' + value + (sub ? " <small>" + sub + "</small>" : "") + "</span></div>";
}
/* ── Pinned numbers (Scheduler bar) ───────────────────────────────────────
   What shows on the bar is chosen on Reports: the pin on a dashboard card or tile adds it, the same pin removes it.
   Up to SB_MAX at once. The list is saved with the saved reports (a row named "__scheduler_bar"), so every device shows the same bar;
   this device keeps a copy as a fallback. A pinned saved report is "r:<id>" (single number only); there are no built-in numbers. */
var IFR_OPEN = (function () { try { return localStorage.getItem("ifrOpen") !== "0"; } catch (e) { return true; } })();
var SB_MAX = 4, SB_DEFAULT = [], SB_SAVE = Promise.resolve();
function sbPinRow() { return (REP.saved || []).filter(function (r) { return r.name === "__scheduler_bar"; })[0] || null; }
function sbPins() {
  var r = sbPinRow();
  if (r && r.config && Array.isArray(r.config.pins)) return r.config.pins;
  try { var l = JSON.parse(localStorage.getItem("sbPins") || "null"); if (Array.isArray(l)) return l; } catch (e) {}
  return SB_DEFAULT.slice();
}
function rptTileKey(t) { return "r:" + t.id; }
function sbTile(k) { return rptTiles().filter(function (t) { return rptTileKey(t) === k; })[0] || null; }
function sbLabel(k) { var t = sbTile(k); return t ? t.name : null; }
function sbSetPins(pins) {
  try { localStorage.setItem("sbPins", JSON.stringify(pins)); } catch (e) {}
  var row = sbPinRow();
  if (row) row.config = { pins: pins }; else REP.saved = (REP.saved || []).concat([{ id: null, name: "__scheduler_bar", config: { pins: pins } }]);
  SB_SAVE = SB_SAVE.then(function () {
    var r = sbPinRow(), latest = r && r.config && r.config.pins ? r.config.pins : pins;
    var idp = r && r.id ? Promise.resolve(r.id) : api("saved-report/list", {}).then(function (rows) {
      var f = (rows || []).filter(function (x) { return x.name === "__scheduler_bar"; })[0]; return f ? f.id : null; });
    return idp.then(function (id) {
      var body = { name: "__scheduler_bar", config: { pins: latest } };
      if (id) body.id = id;
      return api("saved-report", body).then(function (res) { var rr = sbPinRow(); if (rr && res && res.id) rr.id = res.id; });
    });
  }).catch(function () {});
}
// Ready once the report data is in (there are no built-in numbers any more, only pinned reports).
function sbCalc() { return REP.data ? {} : null; }
function sbValue(k, calc, from, to) {
  if (!calc) return "…";
  if (calc[k] != null) return calc[k];
  var t = sbTile(k); if (!t) return "—";
  var cfg = rptCfgCopy(t.cfg); cfg.per = "custom"; cfg.from = from; cfg.to = to;
  var tv = rptTotalVal(cfg, rptRun(cfg));
  return tv.v ? rptValFmt(tv.v, tv.x) + (tv.v.f === "days_to_deliver" && tv.x != null ? " days" : "") : "—";
}
function sbPinIcon() {
  return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';
}
function sbPinBtn(key) {
  var on = sbPins().indexOf(key) >= 0;
  return '<span class="rpt-pin' + (on ? " on" : "") + '" role="button" tabindex="0" aria-pressed="' + on + '" data-sbpin="' + esc(key) + '" title="' +
    (on ? "On the Scheduler bar. Click to remove" : "Show on the Scheduler bar") + '">' + sbPinIcon() + "</span>";
}
function schedStatsHtml() {
  var year = SCHED_STAT.day.slice(0, 4), from = year + "-01-01", to = year + "-12-31", calc = sbCalc(from, to);
  var pins = sbPins().filter(sbLabel).slice(0, SB_MAX);
  return '<span class="sched-statwrap' + (SCHED_RATES_OPEN ? "" : " closed") + '" id="sched-statwrap">' +
    '<span class="ss-rates"><span class="ss-grp">' + (pins.length ? pins.map(function (k) { return ssItem(sbLabel(k), sbValue(k, calc, from, to)); }).join("") :
      '<span class="ss-none">Pin numbers from Reports</span>') + "</span></span>" +
    '<button class="rail-toggle-icon" id="ss-toggle" aria-expanded="' + SCHED_RATES_OPEN + '" title="' + (SCHED_RATES_OPEN ? "Hide" : "Show") + ' pinned numbers" aria-label="Pinned numbers">' +
    (SCHED_RATES_OPEN ? "&gt;" : "&lt;") + "</button></span>";
}
function schedStatsPaint() {
  var el = document.getElementById("sched-stats"); if (!el) return;
  rptSavedLoad();
  if (!REP.data && !REP.loading && !REP.err) rptDataLoad();
  else if (REP.stale && !REP.loading) rptDataLoad();
  var year = SCHED_STAT.day.slice(0, 4);
  if (SCHED_STAT.motYear !== year) { SCHED_STAT.motYear = year; motLoad(year + "-01-01", year + "-12-31").then(schedStatsPaint, function () {}); }
  el.innerHTML = schedStatsHtml();
}
var schedStatRaf = 0;
function schedStatsOnScroll() {
  if (schedStatRaf) return;
  schedStatRaf = requestAnimationFrame(function () {
    schedStatRaf = 0;
    var d = schedTopDay();
    if (d !== SCHED_STAT.day && d.slice(0, 4) !== SCHED_STAT.day.slice(0, 4)) { SCHED_STAT.day = d; schedStatsPaint(); }
    else SCHED_STAT.day = d;
  });
}
function vScheduler() {
  return toolbarHtml("Scheduler", {
    className: "home-base-bar sched-bar",
    context: '<input type="text" inputmode="numeric" placeholder="MM/DD/YYYY" data-smartdate id="jump" data-last-iso="' + TODAY +
      '" value="' + esc(isoToMdy(TODAY)) + '">' +
      '<button class="btn" id="jump-btn">Go</button><button class="btn" id="today-jump">Today</button>',
    secondary: '<div class="sched-stats" id="sched-stats">' + schedStatsHtml() + "</div>"
  });
}
/* Current Week — an editable window onto the Scheduler (D56, was read-only D28).
   It shows the next CW_DAYS from this Monday with the *same* data-key cells as
   the board, so typing, drag/drop, and chip-clicks all work and write straight
   through to the same data — edit here or on the Scheduler, both stay in sync.
   This is the slice that mirrors to the driver-facing sheet (legacy Code.js:774
   updateDriverTabs). */
/* The banner on the drivers' page and on the bag plant page: two boxes on this bar, up to 40 characters each, empty = nothing shows. No Save button: leaving
   a box (or Enter) sends it. The pages pick it up when they refresh (the bag plant checks every 2 minutes). */
var TICKER = null;
function tickerBoxesHtml() {
  var t = TICKER || { drivers: "", bagger: "" };
  return '<span class="cw-ticks"><input class="cw-tick" data-tick="drivers" maxlength="40" value="' + esc(t.drivers) + '" placeholder="Drivers page banner (40 max)" aria-label="Banner on the drivers\' page">' +
    '<input class="cw-tick" data-tick="bagger" maxlength="40" value="' + esc(t.bagger) + '" placeholder="Bag plant banner (40 max)" aria-label="Banner on the bag plant page"></span>';
}
function tickerLoadBoxes() {
  if (TICKER) return;
  api("ticker/get", {}).then(function (t) {
    TICKER = { drivers: (t && t.drivers) || "", bagger: (t && t.bagger) || "" };
    [].forEach.call(document.querySelectorAll("[data-tick]"), function (i) { if (document.activeElement !== i) i.value = TICKER[i.dataset.tick] || ""; });
  }, function () { /* the banner SQL has not been run yet: the boxes stay empty */ });
}
document.addEventListener("change", function (e) {
  var i = e.target.closest && e.target.closest("[data-tick]"); if (!i) return;
  var v = i.value.trim().slice(0, 40); i.value = v;
  var body = {}; body[i.dataset.tick] = v;
  api("ticker", body).then(function (t) {
    TICKER = { drivers: (t && t.drivers) || "", bagger: (t && t.bagger) || "" };
    toast(v ? "Banner set. The page shows it the next time it refreshes." : "Banner cleared.");
  }).catch(function (err) { toast(err.message, true); });
});
function vCurrentWeek() {
  setTimeout(tickerLoadBoxes, 0);
  var h = toolbarHtml("Current Week", {
    className: "cw-toolbar",
    context: tickerBoxesHtml()
  });
  var dates = currentWeekDates();
  // A truck with no driver assigned is not shown here (assign a driver to put it back).
  var cwTrucks = DB.trucks.filter(function (t) { return t.driver_id; });
  h += '<div class="grid-wrap"><table class="grid" style="width:' +
    (88 + cwTrucks.length * PREFS.colWidth) + 'px"><thead><tr><th class="corner"><span class="lbl">Date</span></th>';
  cwTrucks.forEach(function (t) {
    h += '<th class="' + dcClass(t).trim() + '" style="' + dcStyle(t) + 'width:var(--col-w,150px)">' + truckColHeader(t) + "</th>";
  });
  h += "</tr></thead><tbody>";
  for (var i = 0; i < dates.length; i++) {
    var day = dates[i], ds = iso(day), dow = day.getUTCDay(), isWeekend = dow === 0 || dow === 6;
    var slots = Math.max(3, DAYSLOT[ds] || 0);
    for (var s = 1; s <= slots; s++) {
      h += '<tr class="' + (ds === TODAY ? "today " : "") + (isWeekend ? "weekend-active " : "") + 'slotrow">';
      if (s === 1) h += '<td class="rowhd" rowspan="' + slots + '"><span class="dwk">' + DOW[dow] +
        '</span><br><span class="dnum">' + ds.slice(8) + "</span></td>";
      cwTrucks.forEach(function (t) {
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
/* Driver Tabs mirrors what a driver sees on the Flatbed Schedule page
   (driver/driver.js): same columns, same load chip text, same scan button
   spot. Keep the two in step when either changes. The Dispatch Notes, PO/PU #
   and Delivery # boxes stay editable here; everything else is read-only. */
var DV_LEGEND = { "early|false": "#D9EAD3", "anytime|false": "#FFF2CC", "early|true": "#F1C232", "anytime|true": "#783F04" };
function dvLighten(hex) {
  var x = String(hex || "").replace(/^#+/, "");
  if (x.length === 8) x = x.slice(0, 6);
  if (x.length !== 6) return null;
  return "#" + [0, 2, 4].map(function (i) {
    var v = parseInt(x.slice(i, i + 2), 16);
    return Math.round(v + (255 - v) * 0.78).toString(16).toUpperCase().padStart(2, "0");
  }).join("");
}
function dvPlace(l) {
  return l ? [l.name, l.address, [l.city, l.state].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
}
/* The chip text and fill a driver gets for one slot. */
function dvChip(o, v, truck, day) {
  if (!o) return { html: v && v.text ? esc(v.text) : "", color: v && v.fmt && v.fmt.fill || (v && v.cat) || null };
  if (o.is_transfer) {
    var dept = departmentById(o.transfer_department_id);
    return { html: esc([o.notes, o.driver_note].filter(Boolean).join("\n") || "(no load info)"),
             color: dept && dept.color && dept.color.charAt(0) === "#" ? dept.color : null };
  }
  if (isExt(o)) {
    var tag = function (t) { return t ? ' <span class="appt">APPT ' + esc(t) + "</span>" : ""; };
    var lines = ["<b>Broker/Customer:</b> " + esc(o.broker_name || "—")];
    var cs = o.route_mode === "custom" ? orderStops(o.id) : null;
    if (cs && cs.length) {
      var nPick = cs.filter(function (s) { return s.stop_type === "pickup"; }).length, nDrop = cs.length - nPick, cp = 0, cd = 0;
      cs.forEach(function (s) {
        var isP = s.stop_type === "pickup", n = isP ? ++cp : ++cd, tot = isP ? nPick : nDrop;
        lines.push("", "<b>" + (isP ? "PICK" : "DROP") + (tot > 1 ? " " + n : "") + ":</b> " + esc(dvPlace(locById(s.location_id))) + tag(s.notes));
      });
    } else {
      lines.push("", "<b>PICK:</b> " + esc(dvPlace(locById(o.pickup_location_id))) + tag(apptGet(o.id, "pick")),
        "", "<b>DROP:</b> " + esc(dvPlace(locById(o.delivery_location_id))) + tag(apptGet(o.id, "drop")));
    }
    return { html: lines.join("\n"),
      color: truck && truck.driver_color ? dvLighten(truck.driver_color) : null };
  }
  var loc = o.customer_party_id ? locFor(o.customer_party_id) : null;
  var citystate = loc ? [loc.city, loc.state].filter(Boolean).join(" ") : "";
  var info = (citystate + (loc && loc.forklift ? " - " + loc.forklift : "")).trim();
  var orderLine = (o.rexius_order_no || "(no order #)") + (o.pallet_count ? " - " + o.pallet_count + " PAL" : "");
  var text = [o.customer_name || "(no customer)", info, orderLine].filter(Boolean).join("\n");
  var flags = [];
  var fk = String((loc && loc.forklift) || "").trim().toLowerCase();
  if (fk) flags.push(fk === "nf" || fk === "none" || fk === "no" || fk === "no forklift" ? "NO FORKLIFT" : fk.indexOf("spyder") >= 0 ? "SPYDER" : "FORKLIFT");
  var flagHtml = flags.length ? '<div class="flags" style="margin-top:6px">' + flags.map(function (x) { return '<span class="flag">' + esc(x) + "</span>"; }).join("") + "</div>" : "";
  return { html: esc(text).replace(/(\b07-\d{4}-\d{4}\b)/g, "<b>$1</b>") + flagHtml,
    color: loc ? (DV_LEGEND[(loc.timing_window || "") + "|" + !!loc.is_umatilla] || null) : null };
}
/* What the driver has put on a load, read-only (drivers add these on their page). */
function dvDriverNotesHtml(oid) {
  var list = (DRIVER_NOTES[oid] || []).slice().sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  return list.map(function (n) {
    var d = new Date(n.at);
    return '<div class="drv-note-item"><span>' + esc(d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })) + "</span>" + esc(n.text) + "</div>";
  }).join("");
}
function dvScanStatusHtml(oid) {
  var rec = PROTO_SCAN_RECS.filter(function (r) { return r.order_id === oid; })[0];
  if (!rec) return "";
  var d = new Date(rec.at);
  return '<span class="drv-scanned"><span><b>Scanned</b> · ' + rec.pages + " page" + (rec.pages > 1 ? "s" : "") + " · " +
    esc(d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })) + '</span></span>' +
    '<button class="btn sm" data-viewpath="' + esc(rec.storage_path) + '" data-viewname="POD scan">View PDF</button>';
}
/* Store map (bag orders): the picture saved on the customer's location. Same
   button and full-screen viewer a driver gets. Picture links only. */
function dvStoreMapUrl(o) {
  var loc = o && !isExt(o) && o.customer_party_id ? locFor(o.customer_party_id) : null;
  var u = loc && loc.map_url || "";
  return /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(u) ? u : "";
}
function dvStoreMapBtn(o) {
  return !o.is_transfer && dvStoreMapUrl(o) ? '<button class="btn sm" data-smap-dv="' + o.id + '">Store Map</button>' : "";
}
function closeDvStoreMap() {
  var el = document.querySelector(".smap");
  if (el) { el.remove(); document.body.style.overflow = ""; }
}
document.addEventListener("click", function (e) {
  var b = e.target.closest && e.target.closest("[data-smap-dv]");
  if (b) {
    e.stopPropagation();
    var o = order(b.getAttribute("data-smap-dv")), url = o && dvStoreMapUrl(o);
    if (!url || document.querySelector(".smap")) return;
    var el = document.createElement("div");
    el.className = "smap"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Store map");
    el.innerHTML = '<div class="smap-top"><button class="btn" data-smap-close>Close</button>' +
      '<div class="smap-title"><b>' + esc(o.customer_name || "Store") + "</b><span>Store map</span></div>" +
      '<a class="btn" href="' + esc(url) + '" target="_blank" rel="noopener">Open Full Size</a></div>' +
      '<div class="smap-body"><img src="' + esc(url) + '" alt="Store map for ' + esc(o.customer_name || "this store") + '"></div>';
    document.body.appendChild(el);
    document.body.style.overflow = "hidden";
    return;
  }
  if (e.target.closest && e.target.closest("[data-smap-close]")) { e.stopPropagation(); closeDvStoreMap(); }
}, true);
document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDvStoreMap(); });
function dvNum(o, val) {
  return '<div class="dv-cell dv-num mono" data-oid="' + o.id + '" title="Open this load to edit">' + esc(val || "") + "</div>";
}
function dvSlotCellsHtml(key) {
  var v = CELLS[key], o = v && v.oid ? order(v.oid) : null, truck = truckById(key.split("|")[0]);
  var ch = dvChip(o, v, truck, key.split("|")[1]);
  var chipBody = ch.html ? '<div class="load-txt' + (ch.color ? "" : " unfilled") + '"' +
    (ch.color ? ' style="background:' + esc(ch.color) + ";color:" + textOn(ch.color) + '"' : "") + ">" + ch.html +
    (o && !o.is_transfer ? '<div class="chip-scan">' + dvStoreMapBtn(o) + '<button class="btn sm dv-dead" tabindex="-1" title="Drivers use this on their own page">Scan POD / BOL</button>' +
      dvScanStatusHtml(o.id) + "</div>" : "") + "</div>" : "";
  if (!o) {
    // A typed or empty slot is edited right in the chip cell (click it), the
    // same text the Scheduler and Current Week edit.
    return '<div class="dv-cell dv-typed" data-key="' + key + '" title="Click to write a note">' + chipBody + "</div>" +
      "<div></div><div></div><div></div><div></div><div></div><div></div>";
  }
  var driverNoteInput = '<textarea class="dv-note" data-notekey="' + key + '" data-oid="' + o.id +
    '" placeholder="Note">' + esc(o.driver_note || "") + "</textarea>";
  var cn = !isExt(o) && o.customer_party_id ? (locFor(o.customer_party_id) || {}).notes || "" : "";
  var dnotes = dvDriverNotesHtml(o.id);
  return '<div class="dv-cell" data-key="' + key + '" draggable="true" data-oid="' + o.id + '" data-from="' + key +
    '" style="cursor:grab">' + chipBody + "</div>" +
    // The numbers come from the load itself: click one to open the load's side
    // window, where they're edited (and reach drivers on the next push).
    dvNum(o, o.rexius_order_no) +
    '<div class="dv-cell">' + driverNoteInput + (cn ? '<div class="dv-cust-note">' + esc(cn) + "</div>" : "") + "</div>" +
    dvNum(o, isExt(o) ? o.po_number : "") +
    dvNum(o, isExt(o) ? o.delivery_number : "") +
    dvNum(o, isExt(o) ? o.broker_load_no : "") +
    '<div class="dv-cell">' + (o.is_transfer ? "" : '<button class="btn sm dv-dead" tabindex="-1" title="Drivers use this on their own page">Add Note</button>') + dnotes + "</div>";
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
    context: ""
  });
  h += '<div style="flex:1;min-height:0;overflow:auto;padding:10px 14px 14px">';
  // The same big tabs a driver sees on their page, one per truck.
  h += '<div class="driver-app dv-tabs-wrap"><nav class="db-tabs" role="tablist" aria-label="Driver tabs">' +
    DB.trucks.map(function (t) {
      return '<button class="sub-tab" role="tab" data-dvpick="' + t.id + '" aria-selected="' + (t.id === DRIVER_VIEW) + '">' +
        esc(dFirst(t.driver_name) || "Unassigned") + '<span class="trk">' + esc(t.number) + "</span></button>";
    }).join("") + "</nav></div>";
  var dvTruck = truckById(DRIVER_VIEW);
  // The same columns, in the same order, as a driver's own tab.
  h += '<div class="driver-app dv-embed"><div class="dv">' +
    '<div class="hd">' + esc((dvTruck && dFirst(dvTruck.driver_name)) || "Load") + '</div><div class="hd">Rexius Order #</div>' +
    '<div class="hd">Dispatch Notes</div><div class="hd">PO / PU #</div><div class="hd">Delivery #</div>' +
    '<div class="hd">Load #</div><div class="hd">Driver Notes</div>';
  if (!dvTruck) return h + "</div></div></div>";
  var dates = currentWeekDates();
  // Every slot renders (an empty slot is still a drop target), with a day bar
  // between days exactly like the driver's page.
  for (var i = 0; i < dates.length; i++) {
    var day = dates[i], ds = iso(day);
    h += '<div class="day-bar' + (ds === TODAY ? " today" : "") + '" id="d-' + ds + '"><span class="dwk">' + DOW[day.getUTCDay()] +
      '</span><span class="dnum">' + (+ds.slice(5, 7)) + "/" + (+ds.slice(8, 10)) + "</span>" + (ds === TODAY ? '<span class="today-tag">Today</span>' : "") + "</div>";
    if (OFFDAYS[dvTruck.id + "|" + ds]) { h += '<div class="off-cell off-hatch"><div class="off-label">OFF</div></div>'; continue; }
    for (var s = 1; s <= 3; s++) h += dvSlotCellsHtml(cellKey(dvTruck.id, ds, s));
  }
  h += "</div></div></div>";
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
   "Billed" reads the real orders.billed_date (the Billing page's own biller-
   queue toggle, D62/api_bill_order) — not a guess, the actual field Billing
   already uses to mean "left the queue".
   Internal: No delivery > Delivered > Scheduled > Staging (default).
   External: Billed > Delivered > Scheduled > Staging (default). */
function stagePill(o, on) {
  var label = "Staging", cls = "staging";
  if (o.stage === "cancelled") { label = "Cancelled"; cls = "bad"; }
  else if (o.kind === "external" && o.billed_date) { label = "Billed"; cls = "billed"; }
  else if (o.delivery_date) { label = "Delivered"; cls = "on"; }
  else if (on) { label = "Scheduled"; cls = "mid"; }
  return '<span class="tracker-state ' + cls + '"><span>' + label + "</span></span>";
}
/* The "Stage →" action only makes sense while an order is still in the
   default Staging bucket — hide it once scheduled/delivered/billed/
   cancelled or already sitting in the STAGED rail. */
function canStageOrder(o, on) {
  if (o.stage === "cancelled") return false;
  if (o.kind === "external" && o.billed_date) return false;
  if (o.delivery_date || on) return false;
  return STAGED.indexOf(o.id) < 0;
}
function canCancelOrder(o) {
  return o.stage !== "cancelled" && !o.delivery_date && !o.billed_date;
}
/* What can be deleted: internal freight, always. A bag order, unless it has an order number and is delivered.
   An external order, unless it is billed. Those that cannot be deleted stay on file under Delivered / Billed. */
function canDeleteOrder(o) {
  if (o.is_transfer) return true;
  if (o.kind === "internal") return !(o.rexius_order_no && o.delivery_date);
  return !o.billed_date;
}
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
  var billed = Number(!!a.billed_date) - Number(!!b.billed_date);
  if (billed) return billed;

  var an = String(a.rexius_order_no || "").trim();
  var bn = String(b.rexius_order_no || "").trim();
  if (!an && bn) return a.billed_date ? 1 : -1;
  if (an && !bn) return b.billed_date ? -1 : 1;
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
/* Click a column name to sort the Delivered / Billed list under it. The live rows above keep their
   own order. In-memory only, like GRIDSORT. One click sorts ascending, a second flips it, and
   clicking a sorted column a third time puts the list back to its normal order. */
var TSORT = {};   // { "ext-billed": {key, dir} }
var TSORT_GROUP = { ext: "ext-billed", int: "int-delivered", xfer: "xfer-delivered" };
function tsortTh(grid, key, label, width, cls) {
  var s = TSORT[TSORT_GROUP[grid]], on = s && s.key === key;
  return '<th class="tsortable' + (cls ? " " + cls : "") + '" style="width:' + width + 'px" data-tsort="' + grid + "|" + key +
    '" title="Sort the ' + (grid === "ext" ? "Billed" : "Delivered") + ' list by this column"' +
    (on ? ' aria-sort="' + (s.dir > 0 ? "ascending" : "descending") + '"' : "") + ">" + label +
    (on ? '<span class="tsort-arrow">' + (s.dir > 0 ? "&#9650;" : "&#9660;") + "</span>" : "") + "</th>";
}
function tsortValue(o, key) {
  var loc = function (id) { var l = id ? locById(id) : null; return l ? l.name || "" : ""; };
  switch (key) {
    case "order": return o.rexius_order_no || "";
    case "load": return o.broker_load_no || "";
    case "broker": return o.broker_name || (o.broker_party_id && party(o.broker_party_id) ? party(o.broker_party_id).name : "") || "";
    case "po": return o.po_number || "";
    case "delnum": return o.delivery_number || "";
    case "rate": return o.external_rate == null || o.external_rate === "" ? null : Number(o.external_rate);
    case "notes": return o.notes || "";
    case "tarp": return o.tarp ? 1 : 0;
    case "backhaul": return o.backhaul ? 1 : 0;
    case "pickup": return loc(o.pickup_location_id);
    case "drop": return loc(o.delivery_location_id);
    case "ordered": return String(o.order_date || "").slice(0, 10);
    case "delivered": return String(o.delivery_date || "").slice(0, 10);
    case "docs": return docsFor(o.id).length;
    case "pal": return o.pallet_count == null ? null : +o.pallet_count;
    case "customer": return o.customer_name || (o.customer_party_id && party(o.customer_party_id) ? party(o.customer_party_id).name : "") || "";
    case "window": var l = o.customer_party_id ? locFor(o.customer_party_id) : null; return l ? (l.timing_window || "") + (l.is_umatilla ? "E" : "") : "";
    case "truck": return o.truck_number || "";
    case "miles": return o.miles == null ? null : +o.miles;
    case "freight": return o.internal_freight_amount == null ? null : +o.internal_freight_amount;
    case "dept": return o.transfer_department_name || "";
  }
  return "";
}
function tsortRows(group, rows) {
  var s = TSORT[group]; if (!s) return rows;
  return rows.slice().sort(function (a, b) {
    var x = tsortValue(a, s.key), y = tsortValue(b, s.key);
    if (x === null || x === "") { if (y === null || y === "") return 0; return 1; }   // blanks always last
    if (y === null || y === "") return -1;
    var c = typeof x === "number" && typeof y === "number" ? x - y
      : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" });
    return c * s.dir;
  });
}

/* Opening or closing a tracker group: the arrow turns and the rows fade, instead of the table snapping. */
function motionCollapse(btn, key, wasOpen) {
  var after = function (b) {
    var out = [], tr = b && b.closest("tr"), n = tr && tr.nextElementSibling;
    while (n && !n.classList.contains("tracker-collapse-row")) { out.push(n); n = n.nextElementSibling; }
    return out;
  };
  if (wasOpen) {
    btn.setAttribute("aria-expanded", "false");
    var rs = after(btn); rs.slice(0, 40).forEach(function (r) { r.classList.add("row-out"); });
    setTimeout(render, rs.length ? 140 : 0);
    return;
  }
  render();
  var nb = document.querySelector('[data-tracker-collapse="' + key + '"]');
  if (!nb) return;
  nb.setAttribute("aria-expanded", "false");
  after(nb).slice(0, 40).forEach(function (r, i) { r.style.animationDelay = Math.min(i, 10) * 14 + "ms"; r.classList.add("row-in"); });
  requestAnimationFrame(function () { requestAnimationFrame(function () { nb.setAttribute("aria-expanded", "true"); }); });
}
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
    '<td><div class="cell"><input class="cell-i n" data-oedit="' + o.id + '" data-field="rexius_order_no" value="' +
      esc(o.rexius_order_no || "") + '"></div></td>' +
    '<td><div class="cell"><input class="cell-i n" data-oedit="' + o.id + '" data-field="broker_load_no" value="' +
      esc(o.broker_load_no || "") + '"></div></td>' +
    '<td><div class="cell" style="padding:0">' +
      partyCombo(o.id, "broker_party_id", o.broker_party_id, "Search brokers") + "</div></td>" +
    '<td><div class="cell">' + (customRoute ? '<span class="n">' + esc((firstPick && firstPick.reference_number) || "") + '</span>' :
      '<input class="cell-i n" data-oedit="' + o.id + '" data-field="po_number" value="' + esc(o.po_number || "") + '">') + '</div></td>' +
    '<td><div class="cell">' + (customRoute ? '<span class="n">' + esc((lastDrop && lastDrop.reference_number) || "") + '</span>' :
      '<input class="cell-i n" data-oedit="' + o.id + '" data-field="delivery_number" value="' + esc(o.delivery_number || "") + '">') + '</div></td>' +
    '<td><div class="cell">' + rateInputHtml(o, "cell-i n") + '</div></td>' +
    '<td><div class="cell"><input class="cell-i" data-oedit="' + o.id + '" data-field="notes" value="' +
      esc(o.notes || "") + '"></div></td>' +
    '<td><div class="cell" style="text-align:center"><input type="checkbox" data-oedit="' + o.id +
      '" data-field="tarp"' + (o.tarp ? " checked" : "") + '></div></td>' +
    '<td><div class="cell" style="text-align:center"><input type="checkbox" data-oedit="' + o.id +
      '" data-field="backhaul"' + (o.backhaul ? " checked" : "") + '></div></td>' +
    '<td><div class="cell">' + (customRoute ? '<button class="route-cell" data-route-edit="' + o.id + '">' +
      esc(routeStopLabel(firstPick)) + '<small>' + esc(routeCompactLabel(o)) + '</small></button>' :
      locCombo(o.id, "pickup_location_id", o.pickup_location_id, null)) + "</div></td>" +
    '<td><div class="cell">' + (customRoute ? '<button class="route-cell" data-route-edit="' + o.id + '">' +
      esc(routeStopLabel(lastDrop)) + '<small>Open full route</small></button>' :
      locCombo(o.id, "delivery_location_id", o.delivery_location_id, null)) + "</div></td>" +
    dateOeditCell(o.id, "order_date", o.order_date && String(o.order_date).slice(0, 10)) +
    dateOeditCell(o.id, "delivery_date", o.delivery_date && String(o.delivery_date).slice(0, 10)) +
    '<td><div class="cell n">' + nd + "</div></td></tr>";
}
var EXT_TRACKER_COLS = 17;  // keep in sync with vOrders' <thead> — colspan for the Billed toggle row
function vOrders(kind) {
  var pm = placement();
  var rows = orders().filter(function (o) {
    return o.kind === "external" && !o.is_transfer && !isHistorical(o) && externalOrderInYear(o, YEAR);
  }).sort(externalOrderCompare);
  var liveRows = rows.filter(function (o) { return !o.billed_date; });
  var billedRows = rows.filter(function (o) { return o.billed_date; });
  if (!OCR_WORKER && !OCR_WARMED) {   // load the PDF reader and OCR engine now so the first rate con doesn't wait for them
    OCR_WARMED = true;
    setTimeout(function () { loadVendor("pdfjs").catch(function () {}); getOcrWorker().catch(function () {}); }, 1500);
  }
  var h = toolbarHtml("External Orders", {
    className: "orders-toolbar", context: yearPicker(),
    secondary: ordersToolbarExtras() + trackerBulkButtonsHtml("ext"),
    primary: '<button class="btn pri sm orders-primary-btn" id="new-order">+ New Order</button>'
  });
  h += '<div class="drop" id="rc-drop" style="margin-bottom:10px"><b>Drop a rate con here</b> or click to upload or paste</div>';
  h += '<div class="grid-wrap tracker-scroll"><table class="data order-tracker external-tracker" style="width:2132px"><thead><tr>' +
    trackerSelTh("ext") +
    trackerOpenTh() +
    '<th class="order-actions-col" style="width:220px">Status / Stage</th>' +
    tsortTh("ext", "order", "Order #", 120) + tsortTh("ext", "load", "Load #", 96) +
    tsortTh("ext", "broker", "Broker/Customer", 190) + tsortTh("ext", "po", "PU/PO", 100) +
    tsortTh("ext", "delnum", "Delivery #", 100) + tsortTh("ext", "rate", "Rate", 100) + tsortTh("ext", "notes", "Private notes", 200) +
    tsortTh("ext", "tarp", "Tarp", 56) + tsortTh("ext", "backhaul", "Backhaul", 84) +
    tsortTh("ext", "pickup", "Pickup Address", 180) + tsortTh("ext", "drop", "Drop Address", 180) +
    tsortTh("ext", "ordered", "Ordered", 112) + tsortTh("ext", "delivered", "Delivered", 112) +
    tsortTh("ext", "docs", "Docs", 64) +
    "</tr></thead><tbody>";
  liveRows.forEach(function (o, i) { h += extOrderRowHtml(o, i, pm); });
  if (billedRows.length) {
    h += trackerCollapseToggleRow("ext-billed", "Billed", billedRows.length, EXT_TRACKER_COLS);
    if (TRACKER_COLLAPSED_OPEN["ext-billed"])
      h += trackerCollapsedRowsHtml("ext-billed", tsortRows("ext-billed", billedRows), liveRows.length,
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
   rexius_order_no — so the grid must live-resort as a number is edited
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
   Billed group). A number edit never itself changes delivery_date, so the
   row stays within whichever bucket (live/delivered) it was already in —
   reposition only within that bucket, anchored on the collapse toggle row
   (if the row is moving to the end of the live bucket) or the tbody's own
   end otherwise. If the row isn't in the DOM at all (its bucket is
   currently collapsed), there's nothing to reposition — no-op. */
function bagOrderCompare(a, b) {
  var an = String(a.rexius_order_no || "").trim();
  var bn = String(b.rexius_order_no || "").trim();
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
    return x.kind === "internal" && internalOrderInYear(x, yy) && !!x.delivery_date === !!o.delivery_date;
  }).sort(bagOrderCompare);
  var idx = bucket.indexOf(o);
  var hasNextInBucket = idx >= 0 && idx + 1 < bucket.length;
  var nextInBucket = hasNextInBucket ? tbody.querySelector('tr[data-roworder="' + bucket[idx + 1].id + '"]') : null;
  // A real next bucket-mate exists but isn't rendered (D235 paging — it's
  // past the currently shown page of a collapsed group) — no reliable local
  // anchor to reposition against, fall back to a full render() rather than
  // guessing a spot.
  if (hasNextInBucket && !nextInBucket) { render(); return; }
  var anchor = nextInBucket || (!o.delivery_date ? tbody.querySelector(".tracker-collapse-row") : null);
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
    '<td><div class="cell"><input class="cell-i n" data-oedit="' + o.id + '" data-field="rexius_order_no" value="' +
      esc(o.rexius_order_no || "") + '"' + (dead ? " disabled" : "") + '></div></td>' +
    '<td><div class="cell"><input class="cell-i n" type="number" min="0" data-oedit="' + o.id +
      '" data-field="pallet_count" value="' + (o.pallet_count == null ? "" : o.pallet_count) + '"' +
      (dead ? " disabled" : "") + "></div></td>" +
    '<td><div class="cell" style="padding:0">' +
      partyCombo(o.id, "customer_party_id", o.customer_party_id, "Search customers", dead) + "</div></td>" +
    '<td><div class="cell">' + (win ? '<span class="flag w" style="--fc:' + win.c + '">' + esc(win.t) +
      "</span>" : "") + "</div></td>" +
    dateOeditCell(o.id, "order_date", o.order_date && String(o.order_date).slice(0, 10), dead) +
    dateOeditCell(o.id, "delivery_date", o.delivery_date && String(o.delivery_date).slice(0, 10), dead) +
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
  var liveRows = rows.filter(function (o) { return !o.delivery_date; });
  var deliveredRows = rows.filter(function (o) { return o.delivery_date; });

  var h = toolbarHtml("Bag Orders", {
    className: "orders-toolbar", context: yearPicker(),
    secondary: ordersToolbarExtras() + '<button class="btn sm" id="int-add" title="Reserve the next order number in the selected month">Add One Order</button>' + trackerBulkButtonsHtml("int"),
    primary: '<button class="btn pri sm orders-primary-btn" id="int-bulk">Add Orders</button>'
  });

  h += '<div class="grid-wrap tracker-scroll"><table class="data order-tracker internal-tracker" style="width:1606px"><thead><tr>' +
    trackerSelTh("int") +
    trackerOpenTh() +
    '<th class="order-actions-col" style="width:220px">Status / Stage</th>' +
    tsortTh("int", "order", "Order #", 130) + tsortTh("int", "pal", "PAL", 64) +
    tsortTh("int", "customer", esc(fieldLabel("bagger", "name", "Customer")), 220) +
    tsortTh("int", "window", esc(fieldLabel("bagger", "category_id", "Time Window")), 100) +
    tsortTh("int", "ordered", "Ordered", 112) + tsortTh("int", "delivered", "Delivered", 112) +
    tsortTh("int", "notes", "Notes", 240) + tsortTh("int", "truck", "Truck", 80) + tsortTh("int", "miles", "Miles", 150) +
    tsortTh("int", "freight", "Transfer $", 100) + '</tr></thead><tbody>';

  liveRows.forEach(function (o, i) { h += bagOrderRowHtml(o, i, pm); });
  if (deliveredRows.length) {
    h += trackerCollapseToggleRow("int-delivered", "Delivered", deliveredRows.length, INT_TRACKER_COLS);
    if (TRACKER_COLLAPSED_OPEN["int-delivered"])
      h += trackerCollapsedRowsHtml("int-delivered", tsortRows("int-delivered", deliveredRows), liveRows.length,
        function (o, i) { return bagOrderRowHtml(o, i, pm); }, INT_TRACKER_COLS);
  }
  h += "</tbody></table></div>";
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
    dateOeditCell(o.id, "order_date", o.order_date && String(o.order_date).slice(0, 10)) +
    dateOeditCell(o.id, "delivery_date", o.delivery_date && String(o.delivery_date).slice(0, 10)) +
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
  }).sort(function (a, b) { return String(b.order_date || "").localeCompare(String(a.order_date || "")); });
  // Transfers are never billed (no solomon #, no customer/broker, ever —
  // orders_transfer_shape) so "handled" here reads delivery_date instead of
  // billed_date, unlike External Orders' Billed group (Nate: "same with
  // internal freight if its delivered collapse it").
  var liveRows = rows.filter(function (o) { return !o.delivery_date; });
  var deliveredRows = rows.filter(function (o) { return o.delivery_date; });
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
    tsortTh("xfer", "notes", "Load Info", 300) + tsortTh("xfer", "dept", "Department", 200) +
    tsortTh("xfer", "ordered", "Ordered", 112) + tsortTh("xfer", "delivered", "Delivered", 112) +
    tsortTh("xfer", "truck", "Truck", 80) + tsortTh("xfer", "miles", "Miles", 150) +
    tsortTh("xfer", "freight", "Transfer $", 100) + '</tr></thead><tbody>';
  liveRows.forEach(function (o, i) { h += xferOrderRowHtml(o, i); });
  if (deliveredRows.length) {
    h += trackerCollapseToggleRow("xfer-delivered", "Delivered", deliveredRows.length, XFER_TRACKER_COLS);
    if (TRACKER_COLLAPSED_OPEN["xfer-delivered"])
      h += trackerCollapsedRowsHtml("xfer-delivered", tsortRows("xfer-delivered", deliveredRows), liveRows.length,
        function (o, i) { return xferOrderRowHtml(o, i); }, XFER_TRACKER_COLS);
  }
  h += "</tbody></table></div>";
  h += '<button class="btn sm" id="xfer-add" style="margin-top:8px">+ Add one</button>';
  if (!depts.length)
    h += '<div class="note-bar" style="margin-top:8px">No departments yet — add one from Database → Departments.</div>';
  return h;
}
/* Billing: documents on the left that still need a load, loads waiting to bill on the right. An invoice that fits a load
   comes with a suggestion to confirm; anything else can be dragged onto the right load, or picked from the list. */
function billDocCardHtml(d, exts) {
  var ef = d.extracted_fields || {}, type = (d.doc_type || "other").replace("_", " ");
  var sug = (ef.suggested || []).filter(function (c) { var o = order(c.order_id); return o && !o.billed_date; });
  var title = d.doc_type === "invoice" && ef.invoiceNum ? "Invoice #" + ef.invoiceNum : (d.original_filename || "(file)");
  var h = '<div class="bill-doc" draggable="true" data-dragdoc="' + d.id + '" title="Drag onto a load in the Billing Queue">' +
    '<div class="bill-doc-hd"><span class="pill">' + esc(type) + "</span><b>" + esc(title) + "</b>" +
    '<span class="bill-doc-acts"><a class="btn sm" href="#" data-filepath="' + esc(d.storage_path) + '" data-filename="' + esc(d.original_filename || "") + '" data-filemode="open">Open</a>' +
    '<button class="btn sm bad" data-delete-doc="' + d.id + '">Delete</button></span></div>';
  if (sug.length) {
    var top = sug[0], o = order(top.order_id), strong = top.score >= 9;
    h += '<div class="bill-sug"><span class="af ' + (strong ? "af-ok" : "af-check") + '">' + (strong ? "Likely" : "Possible") + "</span>" +
      "<b>" + esc(orderLabel(o)) + "</b>" + (top.why.length ? '<span class="bill-why">' + esc(top.why.join(" · ")) + "</span>" : "") +
      '<button class="btn sm" data-confirm-doc="' + d.id + "|" + o.id + '">Confirm</button></div>';
    sug.slice(1).forEach(function (c) {
      var o2 = order(c.order_id);
      h += '<div class="bill-sug alt"><span class="bill-why">Or</span><b>' + esc(orderLabel(o2)) + "</b>" +
        (c.why.length ? '<span class="bill-why">' + esc(c.why.join(" · ")) + "</span>" : "") +
        '<button class="btn sm" data-confirm-doc="' + d.id + "|" + o2.id + '">Use This</button></div>';
    });
  } else if (d.doc_type === "invoice") {
    h += '<div class="bill-sug none"><span class="bill-why">' + (ef.read_order_no ? "Order # " + esc(ef.read_order_no) + " is not on any load. " : "") + "No load fits yet. Drag it onto one, or pick below.</span></div>";
  }
  h += '<select class="cell-i" data-attach-doc="' + d.id + '"><option value="">Attach to a load…</option>' +
    exts.map(function (o) { return '<option value="' + o.id + '">' + esc(orderLabel(o)) + "</option>"; }).join("") + "</select></div>";
  return h;
}
// The RC / POD / INV dashes: filled when that paperwork is on file. Same in the Billing queue and the order side window.
function paperworkBars(have) {
  return [["rate_con", "RC"], ["pod", "POD"], ["invoice", "INV"]].map(function (t) {
    return '<span class="' + (have[t[0]] ? "y" : "") + '" title="' + (have[t[0]] ? "On file" : "Missing") + '"><em>' + t[1] + "</em><b></b></span>";
  }).join("");
}
function vBilling() {
  var queue = orders().filter(function (o) { return isExt(o) && !o.is_transfer && !o.billed_date && o.stage !== "cancelled" && !isHistorical(o); });
  var haveOf = function (o) { var have = {}; docsFor(o.id).forEach(function (d) { have[d.doc_type] = d; }); return have; };
  var readyN = queue.filter(function (o) { var hv = haveOf(o); return hv.pod && hv.invoice; }).length;
  var shown = queue;   // always everything: no filter
  var h = toolbarHtml("Billing", {
    secondary: '<button class="btn sm" id="bill-done-sel" title="Mark every ticked load billed">Mark Billed (' + GROUP.length + ")</button>" +
      '<button class="btn sm" id="bill-dl-sel">Download Selected (' + GROUP.length + ")</button>",
    primary: '<button class="btn pri sm" id="bill-combine-sel">Combine Into One PDF (' + GROUP.length + ")</button>"
  });
  h += '<div class="grid-wrap bill-page">';
  h += '<div class="bill-drops"><div class="drop" id="batch-drop"><b>Drop a Rexius invoice batch here</b> or click to choose</div>' +
    '<div class="drop" id="loose-drop"><b>Drop a POD or loose document here</b> or click to choose</div></div>';
  if (BATCH_REVIEW) h += '<div class="bill-progress"><span class="spin" aria-hidden="true"></span>Reading invoice ' + Math.min(BATCH_REVIEW.done + 1, BATCH_REVIEW.total) + " of " + BATCH_REVIEW.total + " from " + esc(BATCH_REVIEW.name) + "</div>";

  var unmatched = DB.documents.filter(function (d) {
    return d.matched_by === "unmatched" && !d.order_id && !d.load_id && !d.load_stop_id;
  });
  var exts = orders().filter(function (o) { return isExt(o) && !o.is_transfer && !isHistorical(o); });
  var tm = '<section class="bill-col"><div class="sec-h">To Match <span class="ct">' + unmatched.length + "</span></div>";
  tm += unmatched.length ? '<div class="bill-docs">' + unmatched.map(function (d) { return billDocCardHtml(d, exts); }).join("") + "</div>"
    : emptyStateHtml("Nothing unmatched right now");
  tm += "</section>";
  h += '<div class="bill-board"><section class="bill-col"><div class="sec-h">Billing Queue <span class="ct">' + queue.length + "</span>" +
    (readyN ? '<span class="bill-ready">' + readyN + " ready</span>" : "") + "</div>";
  h += '<div class="grid-wrap"><table class="data order-tracker billing-tracker"><thead><tr>' +
    '<th style="width:36px"></th>' + trackerOpenTh() +
    '<th style="width:128px">Order #</th><th style="width:210px">Customer / Broker</th><th style="width:138px">Paperwork</th>' +
    '<th style="width:170px">Invoice #</th><th style="width:196px"></th></tr></thead><tbody>';
  shown.forEach(function (o) {
    var have = haveOf(o), ready = have.pod && have.invoice;
    var bars = paperworkBars(have);
    var inv = have.invoice, ief = inv && inv.extracted_fields || {};
    var invCell = !inv ? "—" :
      (ief.invoiceNum ? "#" + esc(ief.invoiceNum) : "On file") +
      (inv.matched_by && inv.matched_by !== "manual" ? '<span class="auto-tag" title="Matched by the invoice reader">Auto</span>' : "") +
      '<button class="bill-x" data-unmatch-doc="' + inv.id + '" title="Not this load: send the invoice back to To Match" aria-label="Unmatch invoice">&times;</button>';
    h += '<tr class="bill-row ' + (ready ? "bill-ready" : "bill-wait") + '" data-bill="' + o.id + '" data-roworder="' + o.id + '">' +
      '<td><div class="cell"><input type="checkbox" data-group="' + o.id + '"' + (GROUP.indexOf(o.id) >= 0 ? " checked" : "") + "></div></td>" +
      trackerOpenTd(o) +
      '<td><div class="cell n">' + esc(o.rexius_order_no || "—") + "</div></td>" +
      '<td><div class="cell" style="font-weight:600">' + esc(buildChip(o).title) + "</div></td>" +
      '<td><div class="cell"><div class="bill-pw" role="img" aria-label="' + (ready ? "POD and invoice on file" : "Paperwork missing") + '">' + bars + "</div></div></td>" +
      '<td><div class="cell bill-invcell n">' + invCell + "</div></td>" +
      '<td><div class="cell" style="display:flex;gap:4px"><button class="btn sm" data-bill-dl="' + o.id + '"' + (packageDocs(o.id).length ? "" : " disabled") + ">Download</button>" +
      '<button class="btn sm" data-bill-done="' + o.id + '">Mark Billed</button></div></td></tr>';
  });
  h += "</tbody></table></div></section>" + tm + "</div></div>";
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
/* Database header click sorts (temporary, this browser only, same as the order trackers); right-click
   has "Select column". The Sort button's dialog still has "Save as row order" for everyone. */
function dbSortFieldId(colref) {
  var p = String(colref).split(":");
  return p[0] === "custom" ? "gridcol:" + p[1] : p[1];
}
function dbSortArrow(grid, colref) {
  var s = GRIDSORT[grid];
  return s && s.fieldId === dbSortFieldId(colref)
    ? '<span class="tsort-arrow">' + (s.dir === "asc" ? "&#9650;" : "&#9660;") + "</span>" : "";
}
function dbSortAttr(grid, colref) {
  var s = GRIDSORT[grid];
  return s && s.fieldId === dbSortFieldId(colref) ? ' aria-sort="' + (s.dir === "asc" ? "ascending" : "descending") + '"' : "";
}
function fieldTh(f, grid) {
  // Right-click for conditional formatting / hide / delete (D85 Phase 2) —
  // no inline menu button, keeps headers clean.
  return '<th draggable="true" data-colgrid="' + grid + '" data-colref="field:' + f.id + '" data-fieldid="' + f.id + '"' +
    (f.width ? ' style="width:' + f.width + 'px;white-space:nowrap"' : ' style="white-space:nowrap"') +
    dbSortAttr(grid, "field:" + f.id) +
    ' title="Click to sort · Right-click to select the column or for options · Drag to reorder">' + esc(f.label) +
    dbSortArrow(grid, "field:" + f.id) + '<span class="col-resize"></span></th>';
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
/* Employee numbers (drivers.employee_no). Not part of the normal bootstrap: read on demand through api_driver_employee_nos and
   kept in EMP.by {driver_id: number}. EMP.ok is false when that SQL has not been run yet (the column then says so). */
var EMP = { by: {}, phone: {}, at: 0, loading: false, ok: null, err: "", pending: false };
function empEnsure() {
  if (EMP.loading || EMP.ok === false || (EMP.at && Date.now() - EMP.at < 60000)) return;
  EMP.loading = true;
  api("driver/employee-nos").then(function (list) {
    EMP.by = {}; EMP.phone = {};
    (list || []).forEach(function (r) { if (r.employee_no) EMP.by[r.driver_id] = r.employee_no; if (r.phone) EMP.phone[r.driver_id] = r.phone; });
    EMP.ok = true; EMP.at = Date.now();
  }, function (e) { EMP.ok = false; EMP.err = e.message || ""; }).then(function () {
    EMP.loading = false;
    if (SEC === "database") render();       // render() itself waits while a number is being typed (empBusy)
  });
}
// kind "no" = the employee number box, "phone" = the phone box. Both belong to the driver, not the truck.
function empInput(driverId, kind) {
  if (EMP.ok === false) return '<span style="color:var(--ink-3)" title="Run the employee numbers SQL first">not set up</span>';
  var phone = kind === "phone", val = (phone ? EMP.phone : EMP.by)[driverId] || "";
  return '<input class="cell-i n" ' + (phone ? "data-empphone" : "data-empno") + '="' + esc(driverId) + '" data-was="' + esc(val) + '" placeholder="' + (phone ? "Phone" : "Employee #") +
    '" value="' + esc(val) + '" autocomplete="off"' + (phone ? ' inputmode="tel"' : "") + ">";
}
// A number or phone box is being typed in (focused, or holding text that is not saved yet): a redraw would wipe it, so render() waits.
function empBusy() {
  var ae = document.activeElement;
  if (ae && ae.dataset && (ae.dataset.empno != null || ae.dataset.empphone != null || ae.dataset.sparename != null || ae.dataset.truckdriver != null)) return true;
  return [].some.call(document.querySelectorAll("input[data-empno],input[data-empphone]"), function (i) { return i.value.trim() !== (i.dataset.was || ""); });
}
// Drivers with no truck right now (a spare driver) have no row in Fleet, so they get a small list of their own under it.
function spareDriversHtml() {
  empEnsure();
  var list = (DB.drivers || []).filter(function (d) { return d.active !== false && !d.truck; });
  if (!list.length || EMP.ok === false) return "";
  var open = (DB.trucks || []).filter(function (t) { return !t.driver_id; });
  return '<div class="fleet-spare"><h3>Drivers without a truck</h3>' +
    '<div class="row hdr"><span>Full Name</span><span>Employee #</span><span>Phone</span><span>Truck</span><span></span></div>' +
    list.map(function (d) {
      return '<div class="row"><input data-sparename="' + esc(d.id) + '" value="' + esc(d.full_name) + '" aria-label="Full name"><div>' + empInput(d.id, "no") + "</div><div>" + empInput(d.id, "phone") + "</div>" +
        '<select data-sparetruck="' + esc(d.id) + '" data-name="' + esc(d.full_name) + '" aria-label="Put on a truck"><option value="">No truck</option>' +
        open.map(function (t) { return '<option value="' + esc(t.id) + '">Truck ' + esc(t.number) + "</option>"; }).join("") + "</select>" +
        '<span class="btns"><button class="btn sm" type="button" data-driveractive="' + esc(d.id) + '" data-to="0" data-name="' + esc(d.full_name) + '">Make Inactive</button>' +
        '<button class="btn del sm" type="button" data-deldriver="' + esc(d.id) + '" data-name="' + esc(d.full_name) + '">Delete</button></span></div>';
    }).join("") + "</div>";
}
/* Former drivers: Active = false. They drop out of the normal load, so this list reads them separately. Their orders and Scheduler history stay on file; they
   can no longer open the driver page (the employee number check only finds active drivers). "Last day" is when their last truck assignment ended. */
var FORMER = { list: null, loading: false };
function formerEnsure() {
  if (FORMER.list || FORMER.loading) return;
  FORMER.loading = true;
  api("driver/former").then(function (l) { FORMER.list = l || []; }, function () { FORMER.list = []; }).then(function () {
    FORMER.loading = false; if (SEC === "database") render();
  });
}
function formerDriversHtml() {
  formerEnsure();
  if (!FORMER.list || !FORMER.list.length) return "";
  return '<div class="fleet-spare fleet-former"><h3>Former drivers</h3>' +
    '<div class="row hdr"><span>Full Name</span><span>Employee #</span><span>Phone</span><span>Last Day</span><span></span></div>' +
    FORMER.list.map(function (d) {
      return '<div class="row"><b>' + esc(d.full_name) + "</b><span>" + esc(d.employee_no || "—") + "</span><span>" + esc(d.phone || "—") + "</span>" +
        "<span>" + (d.last_day ? esc(prettyDate(String(d.last_day).slice(0, 10))) + (d.truck_id && truckById(d.truck_id) ? " · Truck " + esc(truckById(d.truck_id).number) : "") : "—") + "</span>" +
        '<span class="btns"><button class="btn sm" type="button" data-driveractive="' + esc(d.id) + '" data-to="1" data-name="' + esc(d.full_name) + '">Reinstate</button>' +
        '<button class="btn del sm" type="button" data-deldriver="' + esc(d.id) + '" data-name="' + esc(d.full_name) + '">Delete</button></span></div>';
    }).join("") + "</div>";
}
document.addEventListener("click", function (e) {
  var b = e.target.closest && e.target.closest("[data-driveractive]"); if (!b) return;
  var id = b.getAttribute("data-driveractive"), on = b.getAttribute("data-to") === "1", nm = b.getAttribute("data-name") || "This driver";
  var set = function (v) { return api("row", { table: "drivers", id: id, values: { active: v } }).then(function () { FORMER.list = null; EMP.at = 0; }).then(reload); };
  var go = function () {
    set(on).then(function () {
      toast(nm + (on ? " is back as a driver" : " is now a former driver"));
      histPush(on ? "reinstate driver" : "make driver inactive", function () { return set(!on); }, function () { return set(on); });
    }).catch(function (err) { toast(err.message, true); });
  };
  if (on) go(); else confirmModal("Make " + nm + " a former driver? Their orders and history stay, and they can no longer open the driver page. You can reinstate them any time.", go, "Make Inactive");
});
/* Spare driver rows: the name box renames the driver (one undo step); the Truck box puts them on an open truck. */
document.addEventListener("blur", function (e) {
  var i = e.target.closest && e.target.closest("[data-sparename]"); if (!i) return;
  var id = i.dataset.sparename, prev = i.defaultValue || "", next = i.value.trim();
  if (next === prev.trim()) { i.value = prev; return; }
  if (!next) { i.value = prev; toast("A driver needs a name", true); return; }
  var rename = function (n) { return api("row", { table: "drivers", id: id, values: { full_name: n } }); };
  rename(next).then(reload).then(function () {
    histPush("rename driver", function () { return rename(prev.trim()).then(reload); }, function () { return rename(next).then(reload); });
  }).catch(function (err) { i.value = prev; toast(err.message, true); });
}, true);
document.addEventListener("change", function (e) {
  var s = e.target.closest && e.target.closest("select[data-sparetruck]"); if (!s || !s.value) return;
  var tid = s.value, nm = s.dataset.name, truck = truckById(tid);
  api("truck/driver", { truck_id: tid, driver_name: nm }).then(reload).then(function () {
    toast(nm + " is on truck " + (truck ? truck.number : ""));
    histPush("put driver on truck",
      function () { return api("truck/driver", { truck_id: tid, driver_name: "" }).then(reload); },
      function () { return api("truck/driver", { truck_id: tid, driver_name: nm }).then(reload); });
  }).catch(function (err) { s.value = ""; toast(err.message, true); });
});
/* Delete a driver (the Drivers without a truck list). A driver who has never been on a Scheduler load goes completely; one who has can't be deleted without
   breaking the schedule history, so the answer offers Make Inactive, which hides them everywhere. */
document.addEventListener("click", function (e) {
  var b = e.target.closest && e.target.closest("[data-deldriver]"); if (!b) return;
  var id = b.getAttribute("data-deldriver"), nm = b.getAttribute("data-name") || "this driver";
  confirmModal("Delete " + nm + "? Their employee number, phone and truck history go with them. This can't be undone.", function () {
    api("driver/delete", { driver_id: id }).then(function () { FORMER.list = null; EMP.at = 0; }).then(reload).then(function () { toast(nm + " deleted"); }).catch(function (err) {
      var msg = (err && err.message) || "Couldn't delete.";
      if (/inactive instead/i.test(msg)) {
        setTimeout(function () {
          confirmModal(msg + " Make " + nm + " inactive?", function () {
            api("row", { table: "drivers", id: id, values: { active: false } }).then(function () { FORMER.list = null; }).then(reload).then(function () { toast(nm + " is now a former driver"); })
              .catch(function (e2) { toast(e2.message, true); });
          }, "Make Inactive");
        }, 0);
      } else toast(msg, true);
    });
  }, "Delete Driver");
});
/* One cell for a field in a record context — dispatches on the field's `ui`
   special-renderer, else a generic editable cell writing to its real column. */
function fieldCell(f, ctx) {
  if (f.ui === "designation") return designationSelect(ctx.locations ? ctx.locations.obj : null, true);
  if (f.ui === "equipment") { var t = ctx.trucks.obj; return '<td><div class="cell"><input class="cell-i" list="eqtypes" data-rowtable="trucks" data-rowid="' + ctx.trucks.id + '" data-rowfield="equipment_type" value="' + esc(t.eq || "") + '"></div></td>'; }
  if (f.ui === "employeeno") {
    // The number belongs to the DRIVER (reached through the truck's current driver), so a truck change never moves it.
    var t5 = ctx.trucks.obj; empEnsure();
    if (!t5.driver_id) return '<td><div class="cell" style="color:var(--ink-3)">—</div></td>';
    return '<td><div class="cell">' + empInput(t5.driver_id, "no") + "</div></td>";
  }
  if (f.ui === "driverphone") {
    var t6 = ctx.trucks.obj; empEnsure();
    if (!t6.driver_id) return '<td><div class="cell" style="color:var(--ink-3)">—</div></td>';
    return '<td><div class="cell">' + empInput(t6.driver_id, "phone") + "</div></td>";
  }
  if (f.ui === "truckdriver") { var t2 = ctx.trucks.obj; return '<td><div class="cell"><input class="cell-i" list="fleetdrivers" data-truckdriver="' + ctx.trucks.id + '" value="' + esc(t2.driver_name || "") + '"></div></td>'; }
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
  if (f.ui === "employeeno") return (ctx.trucks && EMP.by[ctx.trucks.obj.driver_id]) || "";
  if (f.ui === "driverphone") return (ctx.trucks && EMP.phone[ctx.trucks.obj.driver_id]) || "";
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
  var placed = [], loose = [];
  rows.forEach(function (row) { (order[rowIdForEntity(row, ent)] == null ? loose : placed).push(row); });
  placed = placed.map(function (row, index) { return { row: row, index: index }; })
    .sort(function (a, b) { return order[rowIdForEntity(a.row, ent)] - order[rowIdForEntity(b.row, ent)] || a.index - b.index; })
    .map(function (item) { return item.row; });
  if (!loose.length || placed.length < 2) return placed.concat(loose);
  /* Rows with no saved position (a customer you just added) used to land at the bottom. If the saved order is a sort of one
     column (A to Z on Name, say), each new row goes where that sort puts it; a hand-dragged order has no rule, so they stay last. */
  var rule = savedOrderRule(placed, ent, gk);
  if (!rule) return placed.concat(loose);
  sortRowsBy(loose, rule.field, rule.dir).forEach(function (row) {
    var v = fieldRawValue(rule.field, row), at = placed.length;
    for (var i = 0; i < placed.length; i++) {
      var cmp = compareGridValues(v, fieldRawValue(rule.field, placed[i]));
      if ((rule.dir === "desc" ? -cmp : cmp) < 0) { at = i; break; }
    }
    placed.splice(at, 0, row);
  });
  return placed;
}
/* Which column (and direction) the saved row order is sorted by, if any. Checked in column order, so Name wins when several fit. */
function savedOrderRule(placed, ent, gk) {
  var flds = sortableFields(ent, gk);
  for (var fi = 0; fi < flds.length; fi++) {
    var vals = placed.map(function (r) { return fieldRawValue(flds[fi], r); });
    if (vals.every(function (v) { return v == null || v === ""; })) continue;
    var asc = true, desc = true;
    for (var i = 1; i < vals.length && (asc || desc); i++) {
      var c = compareGridValues(vals[i - 1], vals[i]);
      if (c > 0) asc = false;
      if (c < 0) desc = false;
    }
    if (asc || desc) return { field: flds[fi], dir: asc ? "asc" : "desc" };
  }
  return null;
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
      fleet: '<button class="btn" id="add-driver">+ Add Driver</button><button class="btn pri" id="add-truck">+ Add Truck</button>',
      departments: '<button class="btn pri" id="add-department">+ Add Department</button>' }[slug];
  // Fixed layout (via .gridfixed) so column drag-resize is pixel-precise; table
  // width is the exact sum of column widths so a column grows the table, not its
  // neighbours (D85). Custom-column widths default to 140. Custom entities
  // don't ride the legacy grid_columns system — their fields ARE `fields`.
  var tblW = 44 + cols.reduce(function (s, c) { return s + c.width; }, 0) + 38;
  var srt = GRIDSORT[gk], srtFld = srt && sortFlds.filter(function (f) { return f.id === srt.fieldId; })[0];
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
      (selectedRows ? " (" + selectedRows + ")" : "") + "</button>" +
      (archivedView ? '<button class="btn del" data-delarchived="' + gk + '"' + (selectedRows ? "" : " disabled") + ">" +
        (selectedRows ? "Delete Selected (" + selectedRows + ")" : "Delete Selected") + "</button>" : "");
  } else {
    rowAction = '<button class="btn del" data-delrows="' + gk + '"' + (selectedRows ? "" : " disabled") + ">" +
      (selectedRows ? "Delete Selected (" + selectedRows + ")" : "Delete Selected") + "</button>";
  }
  // Sort's highlight when a custom sort is active is a status indicator, not
  // a call to action — .active (outline, not fill) so it never competes with
  // the one real primary button (D172's "exactly one .btn.pri" contract).
  var h = toolbarHtml(ent.name, {
    secondary: (srtFld ? '<button class="btn active" data-sortsave="' + gk + '" title="Make this the saved row order for everyone">Save Order</button>' +
        '<button class="btn" data-sortclear="' + gk + '" title="Back to the normal order">Clear Sort</button>' : "") +
      archiveViewButton + rowAction,
    primary: addBtn
  });
  if (slug === "fleet") {
    var eqTypes = [];
    DB.trucks.forEach(function (t) { if (t.eq && eqTypes.indexOf(t.eq) < 0) eqTypes.push(t.eq); });
    ["F", "BT", "CV"].forEach(function (x) { if (eqTypes.indexOf(x) < 0) eqTypes.push(x); });
    h += '<datalist id="fleetdrivers">' + (DB.drivers || []).filter(function (d) { return d.active !== false; }).map(function (d) { return '<option value="' + esc(d.full_name) + '">'; }).join("") + "</datalist>";
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
  if (slug === "fleet") h += spareDriversHtml() + formerDriversHtml();
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
/* ── Reports: live dashboard + pivot builder ───────────────────────────────
   The data is the same table "Export Everything" downloads: one row per order with ~70 raw columns
   (route "report-rows" -> api_report 'dump'), plus a few calculated columns added here
   (order_type, party, delivered_month, days_to_deliver, internal_miles, revenue).
   Every pinned tile is a saved pivot: rows (group by), an optional columns field, values
   (count / sum / avg / min / max / ratio), filters and a period. The data is fetched when Reports opens
   and again whenever the app reloads its own data (reload() calls rptOnReload), so the tiles are live.
   Revenue: bag orders and internal freight use internal_freight_amount; external uses the invoice
   amount on its load (external_revenue_share). The backhaul tile waits for the backhaul checkbox. */
var REP = { tab: "dash", per: "3m", from: "", to: "", saved: null, noSql: false, win: null, data: null, numeric: {}, dataAt: null, loading: false, stale: false, err: "" };
try { var _rp = localStorage.getItem("dept12RepPer"); if (_rp === "month" || _rp === "3m" || _rp === "ytd") REP.per = _rp; } catch (e) {}
var RPT_AGG = { count: "Count", countd: "Count distinct", sum: "Sum", avg: "Average", min: "Min", max: "Max", ratio: "Ratio" };
var RPT_OPS = { eq: "is", ne: "is not", contains: "contains", gt: ">", gte: ">=", lt: "<", lte: "<=", blank: "is blank", notblank: "is not blank" };
var RPT_PER = [["all", "All time"], ["dash", "Dashboard period"], ["month", "This Month"], ["3m", "Last 3 Months"], ["ytd", "Year to Date"], ["custom", "Custom"]];
var RPT_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Reports saved while the old column names were still in use: point them at the new names.
var RPT_OLD_NAMES = { solomon_order_no: "rexius_order_no", ordered_at: "order_date", released_at: "release_date", delivered_at: "delivery_date", billed_at: "billed_date" };
function rptFixName(f) { return RPT_OLD_NAMES[f] || f; }
function rptFixCfg(c) {
  (c.rows || []).forEach(function (f, i) { c.rows[i] = rptFixName(f); });
  if (c.cols) c.cols = rptFixName(c.cols);
  (c.vals || []).forEach(function (v) { if (v.f) v.f = rptFixName(v.f); if (v.f2) v.f2 = rptFixName(v.f2); });
  (c.filters || []).forEach(function (f) { if (f.f) f.f = rptFixName(f.f); });
  if (c.dateF) c.dateF = rptFixName(c.dateF);
  return c;
}
var RPT_DERIVED = { order_type: 0, party: 0, delivered_month: 0, days_to_deliver: 1, internal_miles: 1, revenue: 1 };
var RPT_NOT_CANCELLED = { f: "stage", op: "ne", v: "cancelled" };
function rptIso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function rptRange(per, from, to) {
  var t = new Date(TODAY + "T12:00:00"), s;
  if (per === "all") return { from: "0000-01-01", to: "9999-12-31" };
  if (per === "month") s = new Date(t.getFullYear(), t.getMonth(), 1);
  else if (per === "ytd") s = new Date(t.getFullYear(), 0, 1);
  else if (per === "custom" && from && to) return { from: from, to: to };
  else s = new Date(t.getFullYear(), t.getMonth() - 3, t.getDate() + 1);
  return { from: rptIso(s), to: TODAY };
}
function rptDashRange() { return rptRange(REP.per, REP.from, REP.to); }
function rptNum(v) { if (v === null || v === undefined || v === "") return null; var n = Number(v); return isNaN(n) ? null : n; }
function rptMoney(n) { return (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString(); }
function rptIsMoney(f) { return /amount|revenue|cost|rate$/.test(f || "") && !/miles/.test(f || ""); }
function rptEnrich(r) {
  var internal = r.kind === "internal" || r.is_transfer === true || r.is_transfer === "true";
  var xfer = r.is_transfer === true || r.is_transfer === "true";
  r.order_type = xfer ? "Internal Freight" : r.kind === "internal" ? "Bag Order" : "External";
  r.party = xfer ? "(internal freight)" : r.kind === "internal" ? (r.customer || "(no customer)") : (r.broker || r.customer || "(no broker)");
  r.delivered_month = r.delivery_date ? String(r.delivery_date).slice(0, 7) : null;
  var a = r.order_date && Date.parse(String(r.order_date).slice(0, 10) + "T12:00:00"), b = r.delivery_date && Date.parse(String(r.delivery_date).slice(0, 10) + "T12:00:00");
  var dd = a && b ? Math.round((b - a) / 86400000) : null;
  r.days_to_deliver = dd != null && dd >= 0 ? dd : null;
  var mi = rptNum(r.order_miles != null ? r.order_miles : r.miles);
  r.internal_miles = internal ? (rptNum(r.miles) || 0) : 0;
  var rate = rptNum(r.external_rate);   // the order's own rate once it exists, else the invoice amount on its load
  r.revenue = internal ? (rptNum(r.internal_freight_amount) || 0) : (rate != null ? rate : (rptNum(r.external_revenue_share) || 0));
  return r;
}
function rptDataLoad() {
  if (REP.loading) { REP.again = true; return; }
  REP.loading = true; REP.stale = false; REP.err = "";
  api("report-rows", {}).then(function (j) {
    var rows = (j && j.rows) || [], num = {};
    (j && j.numeric_columns || []).forEach(function (c) { num[c] = 1; });
    Object.keys(RPT_DERIVED).forEach(function (k) { if (RPT_DERIVED[k]) num[k] = 1; });
    REP.data = rows.map(rptEnrich); REP.numeric = num; REP.dataAt = new Date();
    REP.fields = REP.data.length ? Object.keys(REP.data[0]).sort() : Object.keys(RPT_DERIVED);
  }, function (err) { REP.err = err.message || String(err); })
    .then(function () { REP.loading = false; if (REP.again) { REP.again = false; rptDataLoad(); return; }
      if (SEC === "reports") { if (REP.win) rptWinUpdate(); render(); } else if (SUB === "sched") schedStatsPaint(); });
}
function rptOnReload() { if (SEC === "reports" && (REP.data || REP.loading)) rptDataLoad(); else REP.stale = true; }
function rptSavedLoad() {
  if (REP.saved !== null || REP.savedLoading) return;
  REP.savedLoading = true;
  api("saved-report/list", {}).then(function (rows) { REP.saved = rows || []; REP.noSql = false; }, function () { REP.saved = []; REP.noSql = true; })
    .then(function () { REP.savedLoading = false; if (SEC === "reports") render(); else if (SUB === "sched") schedStatsPaint(); });
}
/* --- pivot engine --- */
function rptUpgrade(c) {
  if (c && c.v === 2) return rptFixCfg(c);
  c = c || {};
  var byMap = { cust: "party", month: "delivered_month", truck: "truck_number", type: "order_type", dept: "pivot_department" };
  var vm = { loads: { agg: "count", f: "" }, miles: { agg: "sum", f: "internal_miles" }, rev: { agg: "sum", f: "revenue" }, rpm: { agg: "ratio", f: "revenue", f2: "internal_miles" }, days: { agg: "avg", f: "days_to_deliver" } };
  var f = [RPT_NOT_CANCELLED];
  if (c.type) f.push({ f: "order_type", op: "eq", v: c.type });
  var vals = (c.m || ["loads"]).map(function (m) { return vm[m]; }).filter(Boolean);
  return { v: 2, rows: [byMap[c.by] || "party"], vals: vals.length ? vals : [vm.loads], big: Math.max(0, vals.length - 1), filters: f, per: "dash", dateF: "delivery_date", bars: !!c.bars };
}
function rptCfgCopy(c) { return JSON.parse(JSON.stringify(c)); }
function rptPass(r, flt) {
  var v = r[flt.f], num = REP.numeric[flt.f];
  if (flt.op === "blank") return v === null || v === undefined || v === "";
  if (flt.op === "notblank") return !(v === null || v === undefined || v === "");
  if (v === null || v === undefined) v = "";
  var q = flt.v == null ? "" : String(flt.v);
  if (flt.op === "contains") return String(v).toLowerCase().indexOf(q.toLowerCase()) >= 0;
  if (flt.op === "eq" || flt.op === "ne") {
    var same = num && q !== "" && rptNum(v) != null ? rptNum(v) === Number(q) : String(v).toLowerCase() === q.toLowerCase();
    return flt.op === "eq" ? same : !same;
  }
  var a, b;
  if (num && rptNum(q) != null) { a = rptNum(v); b = Number(q); if (a === null) return false; } else { a = String(v); b = q; if (a === "") return false; }
  return flt.op === "gt" ? a > b : flt.op === "gte" ? a >= b : flt.op === "lt" ? a < b : a <= b;
}
function rptFiltered(cfg) {
  var per = cfg.per || "all"; if (per === "dash") per = REP.per;
  var range = per === "custom" && cfg.per !== "dash" ? { from: cfg.from, to: cfg.to } : rptRange(per, REP.from, REP.to);
  if (cfg.per === "dash") range = rptDashRange();
  var df = cfg.dateF || "delivery_date", flts = (cfg.filters || []).filter(function (f) { return f.f && RPT_OPS[f.op]; });
  return (REP.data || []).filter(function (r) {
    if (cfg.per !== "all") { var d = r[df] ? String(r[df]).slice(0, 10) : ""; if (!d || d < range.from || d > range.to) return false; }
    for (var i = 0; i < flts.length; i++) if (!rptPass(r, flts[i])) return false;
    return true;
  });
}
function rptAggVal(list, v) {
  var f = v.f, vals;
  if (v.agg === "count") return list.length;
  if (v.agg === "countd") { var seen = {}; list.forEach(function (r) { var x = r[f]; if (x !== null && x !== undefined && x !== "") seen[x] = 1; }); return Object.keys(seen).length; }
  if (v.agg === "ratio") {
    var n = 0, d = 0; list.forEach(function (r) { n += rptNum(r[f]) || 0; d += rptNum(r[v.f2]) || 0; }); return d ? n / d : null;
  }
  vals = list.map(function (r) { return REP.numeric[f] ? rptNum(r[f]) : r[f]; }).filter(function (x) { return x !== null && x !== undefined && x !== ""; });
  if (!vals.length) return v.agg === "sum" ? 0 : null;
  if (v.agg === "sum") return vals.reduce(function (a, b) { return a + (Number(b) || 0); }, 0);
  if (v.agg === "avg") return vals.reduce(function (a, b) { return a + (Number(b) || 0); }, 0) / vals.length;
  return vals.reduce(function (a, b) { return v.agg === "min" ? (b < a ? b : a) : (b > a ? b : a); });
}
function rptValLabel(v) {
  if (v.agg === "count") return "Count";
  return RPT_AGG[v.agg] + " " + (v.agg === "ratio" ? v.f + " / " + v.f2 : v.f);
}
function rptValFmt(v, x) {
  if (x === null || x === undefined) return "—";
  if (typeof x === "string") return x;
  if (v.agg === "count" || v.agg === "countd") return Math.round(x).toLocaleString();
  var money = rptIsMoney(v.f) && !(v.agg === "ratio" && rptIsMoney(v.f2));
  if (v.agg === "ratio") return (rptIsMoney(v.f) ? "$" : "") + x.toFixed(2);
  if (money) return v.agg === "avg" ? "$" + x.toFixed(2) : rptMoney(x);
  return Number.isInteger(x) ? x.toLocaleString() : (Math.round(x * 100) / 100).toLocaleString();
}
function rptRun(cfg) {
  var list = rptFiltered(cfg), rf = (cfg.rows || []).filter(Boolean), cf = cfg.cols || "", vals = cfg.vals || [];
  var g = {}, cks = {};
  list.forEach(function (r) {
    var rk = rf.map(function (f) { var x = r[f]; return x === null || x === undefined || x === "" ? "(blank)" : String(x); });
    var key = rk.join("\u0001"), ck = cf ? (r[cf] === null || r[cf] === undefined || r[cf] === "" ? "(blank)" : String(r[cf])) : "";
    var row = g[key] = g[key] || { labels: rk, cells: {}, all: [] };
    (row.cells[ck] = row.cells[ck] || []).push(r); row.all.push(r); cks[ck] = 1;
  });
  var cols = Object.keys(cks).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); }).slice(0, 40);
  var rows = Object.keys(g).map(function (k) { return g[k]; });
  rows.forEach(function (row) {
    row.cellV = {}; cols.forEach(function (c) { row.cellV[c] = row.cells[c] ? vals.map(function (v) { return rptAggVal(row.cells[c], v); }) : vals.map(function () { return null; }); });
    row.totV = vals.map(function (v) { return rptAggVal(row.all, v); });
  });
  var totV = vals.map(function (v) { return rptAggVal(list, v); });
  var colTot = {}; cols.forEach(function (c) { var l = list.filter(function (r) { return (cf ? (r[cf] === null || r[cf] === undefined || r[cf] === "" ? "(blank)" : String(r[cf])) : "") === c; }); colTot[c] = vals.map(function (v) { return rptAggVal(l, v); }); });
  return { rows: rows, cols: cols, rf: rf, cf: cf, vals: vals, totV: totV, colTot: colTot, count: list.length };
}
/* flat display columns for the result table (also used for CSV + sorting) */
function rptDisplay(res) {
  var dc = [];
  res.vals.forEach(function () {});
  if (res.cf) {
    res.cols.forEach(function (c) { res.vals.forEach(function (v, vi) { dc.push({ head: c + (res.vals.length > 1 ? " · " + rptValLabel(v) : ""), v: v, get: function (row) { return row.cellV[c][vi]; }, tot: res.colTot[c][vi] }); }); });
    res.vals.forEach(function (v, vi) { dc.push({ head: "Total" + (res.vals.length > 1 ? " · " + rptValLabel(v) : ""), v: v, tot: res.totV[vi], strong: 1, get: function (row) { return row.totV[vi]; } }); });
  } else res.vals.forEach(function (v, vi) { dc.push({ head: rptValLabel(v), v: v, get: function (row) { return row.totV[vi]; }, tot: res.totV[vi] }); });
  return dc;
}
function rptTotalVal(cfg, res) { var i = Math.min(cfg.big == null ? res.vals.length - 1 : cfg.big, res.vals.length - 1); return { v: res.vals[i], x: res.totV[i] }; }
function rptPeriodStrip() {
  var r = rptDashRange();
  return '<div class="rpt-perbar"><span class="lbl">Period</span><span class="rpt-seg" role="group" aria-label="Period">' + [["month", "This Month"], ["3m", "Last 3 Months"], ["ytd", "Year to Date"], ["custom", "Custom"]].map(function (x) {
    return '<button class="' + (REP.per === x[0] ? "on" : "") + '" data-rptper="' + x[0] + '">' + x[1] + "</button>"; }).join("") + "</span>" +
    '<input type="text" inputmode="numeric" placeholder="MM/DD/YYYY" data-smartdate data-rptdfrom class="rpt-date" data-last-iso="' + r.from + '" value="' + esc(isoToMdy(r.from)) + '">' +
    '<span class="lbl">to</span>' +
    '<input type="text" inputmode="numeric" placeholder="MM/DD/YYYY" data-smartdate data-rptdto class="rpt-date" data-last-iso="' + r.to + '" value="' + esc(isoToMdy(r.to)) + '">' +
    '<span class="rpt-live">' + esc(rptUpdatedText()) + "</span></div>";
}
function rptTiles() { return ((REP.saved || []).filter(function (r) { return String(r.name).indexOf("__") !== 0; }).map(function (r) { var c = rptUpgrade(r.config || {});
  return { id: r.id, name: r.name, cfg: c, tag: (c.rows && c.rows.length ? "grouped by " + c.rows.join(", ") : "totals") }; })); }
function rptUpdatedText() {
  if (REP.loading) return "Updating…";
  if (REP.err) return "Couldn't load the data: " + REP.err;
  return REP.dataAt ? "Live · updated " + REP.dataAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
}
function rptDashHtml() {
  if (!REP.data) return '<div class="empty">' + (REP.err ? esc(REP.err) + ' <button class="btn" data-rptrefresh="1">Try Again</button>' : "Loading the report data…") + "</div>";
  // Only the reports you build and save show here: no built-in cards or tiles.
  var h = '<div class="rpt-cards">';
  rptTiles().forEach(function (t, i) {
    var res = rptRun(t.cfg), tv = rptTotalVal(t.cfg, res);
    var v = tv.v ? rptValFmt(tv.v, tv.x) + (tv.v.f === "days_to_deliver" && tv.x != null ? " days" : "") : "—";
    h += '<button class="rpt-tile mine" data-rpttile="' + i + '"><span class="go">Open &rarr;</span>' + sbPinBtn(rptTileKey(t)) + '<div class="lbl">' + esc(t.name) +
      '</div><div class="rpt-big sm">' + v + '</div><div class="rpt-sub">' + esc(t.tag) + "</div></button>";
  });
  h += "</div>";
  if (!rptTiles().length) h += '<div class="empty">No reports yet. Click + New Report to build one, then pin it to the Scheduler bar if you want it there.</div>';
  return h;
}
/* ── Reports → Motive tab: truck-days from Motive, read only ───────────────
   A cross-check for timecards and mileage: which trucks ran, odometer start and end, first on / last off, hours,
   and where the day's miles went (Bag orders, Internal freight, External). Nothing on this tab edits an order. */
function motWeekRange() { if (!MOT.day) MOT.day = motYesterday(); var mon = motMonday(MOT.day); return { from: mon, to: motAddDays(mon, 6) }; }
function motTabEnsure() {
  if (!MOT.day) MOT.day = motYesterday();
  var r = motWeekRange(), key = r.from;
  if (MOT.loadedWeek === key || MOT.loading) return;
  MOT.loading = true; MOT.err = "";
  // mark the week as tried even when the load fails, or the redraw below would ask again forever (the tab shook); Pull / Refresh retries
  motLoad(r.from, r.to).then(function () { MOT.loadedWeek = key; }, function (e) { MOT.loadedWeek = key; MOT.err = "Couldn't read the saved Motive days: " + (e.message || String(e)); })
    .then(function () { MOT.loading = false; if (SEC === "reports" && REP.tab === "motive") render(); });
}
function motTrucks() {
  var list = (DB.trucks || []).filter(function (t) { return t.active !== false; }).map(function (t) { return String(t.number); });
  Object.keys(MOT.rows).forEach(function (k) { var t = k.split("|")[0]; if (list.indexOf(t) < 0) list.push(t); });
  return list;
}
function motBarHtml(b) {
  var t = b.total || 0; if (!t) return "";
  var seg = [["b", b.bag], ["i", b.intf], ["x", b.ext || 0]].map(function (s) { return '<b class="' + s[0] + '" style="width:' + (Math.max(0, s[1]) / t * 100) + '%"></b>'; }).join("");
  return '<div class="mot-bar" title="Bag ' + Math.round(b.bag) + " · Internal " + Math.round(b.intf) + " · External " + Math.round(b.ext || 0) + '">' + seg + "</div>";
}
function motDayStateText(day) {
  if (day > motYesterday()) return "Today isn't finished yet";
  return MOT.pulled[day] ? "" : "Not pulled yet";
}
function vMotiveTab() {
  motTabEnsure();
  var day = MOT.day, h = "";
  if (MOT.err) h += '<div class="note-bar">' + esc(MOT.err) + "</div>";
  if (MOT.view === "week") return h + motWeekHtml();
  var trucks = motTrucks(), tot = 0, bag = 0, intf = 0, ext = 0, ran = 0;
  trucks.forEach(function (t) { var b = motBuckets(t, day); if (b.total != null) { ran++; tot += b.total; bag += b.bag; intf += b.intf; ext += b.ext || 0; } });
  var state = motDayStateText(day);
  h += '<div class="mot-tiles">' +
    '<div class="mot-tile"><i>Fleet miles</i><b>' + Math.round(tot).toLocaleString() + "</b><small>" + (state ? esc(state) : ran + " truck" + (ran === 1 ? "" : "s") + " ran") + "</small></div>" +
    '<div class="mot-tile"><i class="b">Bag orders</i><b>' + Math.round(bag).toLocaleString() + "</b></div>" +
    '<div class="mot-tile"><i class="i">Internal freight</i><b>' + Math.round(intf).toLocaleString() + "</b></div>" +
    '<div class="mot-tile"><i class="x">External</i><b>' + Math.round(ext).toLocaleString() + "</b><small>everything else the trucks ran</small></div></div>";
  h += '<div class="grid-wrap mot-wrap"><table class="data mot-table"><thead><tr><th style="width:80px">Truck</th><th style="width:150px">Driver</th><th class="n" style="width:100px">Start odo</th><th class="n" style="width:100px">End odo</th>' +
    '<th class="n" style="width:80px">Miles</th><th style="width:96px">First on</th><th style="width:96px">Last off</th><th class="n" style="width:70px">Hours</th><th>Bag / Internal / External</th></tr></thead><tbody>';
  trucks.forEach(function (t) {
    var r = motRow(t, day), b = motBuckets(t, day);
    if (!r) { h += '<tr data-motpick="' + esc(t) + '"><td><b>' + esc(t) + "</b></td><td>" + esc(motTruckDriver(t)) + '</td><td colspan="7" class="mute">' + esc(state || "Did not run") + "</td></tr>"; return; }
    h += '<tr data-motpick="' + esc(t) + '" class="' + (MOT.pick === t ? "sel" : "") + '"><td><b>' + esc(t) + "</b></td><td>" + esc(r.drivers || motTruckDriver(t)) + '</td>' +
      '<td class="n">' + (r.start_odo != null ? Number(r.start_odo).toLocaleString() : "—") + '</td><td class="n">' + (r.end_odo != null ? Number(r.end_odo).toLocaleString() : "—") + '</td>' +
      '<td class="n"><b>' + Math.round(Number(r.miles) * 10) / 10 + "</b></td><td>" + motFmtTime(r.first_on) + "</td><td>" + motFmtTime(r.last_off) + '</td><td class="n">' + (r.hours != null ? r.hours : "—") + "</td>" +
      "<td>" + motBarHtml(b) + (b.over ? '<span class="mot-over">Over by ' + Math.round(b.over * 10) / 10 + "</span>" : "") + "</td></tr>";
  });
  h += '</tbody></table></div><div class="mot-legend"><span class="b">Bag orders</span><span class="i">Internal freight</span><span class="x">External (the rest of the truck\'s miles)</span></div>';
  if (MOT.pick) {
    var b2 = motBuckets(MOT.pick, day), r2 = motRow(MOT.pick, day);
    h += '<div class="mot-det"><h3>' + esc(MOT.pick) + " · " + esc(fmtLongDay(day)) + (r2 ? " · " + Math.round(Number(r2.miles) * 10) / 10 + " mi" : "") + "</h3>";
    var ords = motOrdersFor(MOT.pick, day);
    if (!ords.length) h += '<div class="mot-ev mute">No orders on this truck that day.</div>';
    ords.forEach(function (o) {
      var internal = motIsInternal(o), tag = !internal ? "External" : o.is_transfer ? "Internal freight" : "Bag order", cls = !internal ? "x" : o.is_transfer ? "i" : "b", lab = syncOrderLabel(o);
      h += '<div class="mot-ev"><span class="mot-tag ' + cls + '">' + tag + "</span><span>" + esc(lab[0] + (lab[1] ? " · " + lab[1] : "")) + '</span><span class="n">' +
        (internal ? (motNum(o.miles) != null ? motNum(o.miles) + " mi" : "no miles yet") : (motNum(o.external_rate) != null ? "$" + motNum(o.external_rate).toLocaleString() : "no rate")) + "</span></div>";
    });
    if (b2.total != null) h += '<div class="mot-ev tot"><span class="mot-tag x">External</span><span>The rest of the truck\'s miles</span><span class="n">' + Math.round(b2.ext * 10) / 10 + " mi</span></div>";
    h += "</div>";
  } else h += '<div class="rpt-foot">Click a truck to see its orders for the day.</div>';
  return h;
}
function motWeekHtml() {
  var r = motWeekRange(), days = motDaysBetween(r.from, r.to), trucks = motTrucks(), fleet = 0;
  var h = '<div class="mot-wk"><div class="rpt-foot">Miles per truck per day from Motive. Click a day to open it.</div><table class="data mot-grid"><thead><tr><th>Truck</th>' +
    days.map(function (d) { return '<th class="n">' + esc(fmtLongDay(d)) + "</th>"; }).join("") + '<th class="n">Week</th></tr></thead><tbody>';
  trucks.forEach(function (t) {
    var sum = 0;
    h += "<tr><td><b>" + esc(t) + "</b> <span class=\"mute\">" + esc(motTruckDriver(t)) + "</span></td>" + days.map(function (d) {
      var row = motRow(t, d), m = row ? motNum(row.miles) : null; if (m) sum += m;
      var a = m ? Math.min(0.55, m / 700) : 0;
      return '<td class="n" data-motday="' + d + '"' + (m ? ' style="background:color-mix(in srgb,var(--brand) ' + Math.round(a * 100) + '%,transparent)"' : "") + ">" + (m ? Math.round(m) : '<span class="mute">—</span>') + "</td>";
    }).join("") + '<td class="n"><b>' + Math.round(sum).toLocaleString() + "</b></td></tr>";
    fleet += sum;
  });
  return h + '</tbody><tfoot><tr><td><b>Fleet</b></td><td colspan="7" class="mute">Week total, all trucks</td><td class="n"><b>' + Math.round(fleet).toLocaleString() + "</b></td></tr></tfoot></table></div>";
}
function motTabContext() {
  if (!MOT.day) MOT.day = motYesterday();
  var r = motWeekRange(), label = MOT.view === "week" ? fmtLongDay(r.from) + " – " + fmtLongDay(r.to) : fmtLongDay(MOT.day);
  return '<button class="btn sm mot-dt" data-mot="cal" aria-haspopup="dialog" aria-expanded="' + !!MOT.calOpen + '">' + esc(label) + ' <span class="mot-caret">&#9662;</span></button>';
}
// Every truck-day ever saved, with all the data we hold and where the miles went, as one CSV.
function motDownloadAll() {
  busyStart("Reading every saved Motive day…");
  motLoad("2000-01-01", "2100-12-31").then(function () {
    var keys = Object.keys(MOT.rows).sort(function (a, b) { var x = a.split("|"), y = b.split("|"); return x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : x[0].localeCompare(y[0]); });
    var when = function (iso) { if (!iso) return ""; var d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString("en-US", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); };
    var out = [["Date", "Truck", "Drivers", "Start odometer", "End odometer", "Miles", "First on", "Last off", "Hours", "Bag order miles", "Internal freight miles", "External miles", "Typed miles over Motive total", "Saved from Motive at"]];
    keys.forEach(function (k) {
      var r = MOT.rows[k], b = motBuckets(r.truck_number, String(r.day).slice(0, 10));
      out.push([String(r.day).slice(0, 10), r.truck_number, r.drivers || motTruckDriver(r.truck_number), r.start_odo, r.end_odo, r.miles, when(r.first_on), when(r.last_off), r.hours,
        Math.round(b.bag * 10) / 10, Math.round(b.intf * 10) / 10, b.ext == null ? "" : Math.round(b.ext * 10) / 10, b.over ? Math.round(b.over * 10) / 10 : "", when(r.pulled_at)]);
    });
    var csv = out.map(function (row) { return row.map(function (c) { c = c == null ? "" : String(c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(","); }).join("\n") + "\n";
    saveBlob("motive-all-days-" + TODAY + ".csv", new TextEncoder().encode(csv), "text/csv");
    busyEnd(); toast("Downloaded " + keys.length + " truck-days from " + (keys.length ? String(MOT.rows[keys[0]].day).slice(0, 10) : "—") + " to " + (keys.length ? String(MOT.rows[keys[keys.length - 1]].day).slice(0, 10) : "—"));
  }).catch(function (e) { busyEnd(); toast("Couldn't read the saved days: " + e.message, true); });
}
// Pull whatever is missing in view; when nothing is missing on a single finished day, pull that day again (Motive sometimes corrects a day).
function motPullVisible() {
  var r = MOT.view === "week" ? motWeekRange() : { from: MOT.day, to: MOT.day }, days = motMissing(r.from, r.to), again = false;
  if (!days.length && MOT.view === "day" && MOT.day <= motYesterday()) { days = [MOT.day]; again = true; }
  if (!days.length) { toast(MOT.view === "week" ? "Everything in view is already saved." : "That day isn't finished yet.", MOT.view !== "week"); return; }
  busyStart("Pulling from Motive…"); MOT.shopLast = 0;
  motPull(days).then(function (n) { busyEnd(); toast((again ? "Refreshed " : "Saved ") + n + " truck-day" + (n === 1 ? "" : "s") + " from Motive" + (MOT.shopLast ? " · gave " + MOT.shopLast + " shop trip" + (MOT.shopLast === 1 ? "" : "s") + " to the shop drivers" : "")); MOT.calKey = ""; render(); },
    function (e) { busyEnd(); toast("Motive: " + e.message, true); });
}

/* The date button opens a month calendar: a green bar under a day means it is saved, amber means a finished day not pulled yet. */
function motMonthStart(iso) { return iso.slice(0, 8) + "01"; }
function motCalHtml() {
  var m0 = MOT.calMonth || motMonthStart(MOT.day), y = +m0.slice(0, 4), mo = +m0.slice(5, 7) - 1, first = new Date(y, mo, 1), pad = (first.getDay() + 6) % 7, n = new Date(y, mo + 1, 0).getDate();
  var h = '<div class="mot-cal-hd"><button class="mot-cal-nav" data-motcal="-1" aria-label="Previous month">&lsaquo;</button><b>' +
    esc(first.toLocaleDateString([], { month: "long", year: "numeric" })) + '</b><button class="mot-cal-nav" data-motcal="1" aria-label="Next month">&rsaquo;</button></div><div class="mot-cal-grid">' +
    "MTWTFSS".split("").map(function (x) { return "<i>" + x + "</i>"; }).join("");
  for (var p = 0; p < pad; p++) h += "<span></span>";
  var last = motYesterday();
  for (var d = 1; d <= n; d++) {
    var iso = rptIso(new Date(y, mo, d)), cls = (iso === MOT.day ? "on " : "") + (MOT.pulled[iso] ? "has " : iso <= last ? "miss " : "dim ");
    h += '<button class="' + cls + '" data-motday-pick="' + iso + '">' + d + "<em></em></button>";
  }
  return h + '</div><div class="mot-cal-lg"><span class="g">Saved</span><span class="a">Not pulled yet</span></div>' +
    '<div class="mot-cal-ft"><button class="btn sm" data-motcal-view="' + (MOT.view === "week" ? "day" : "week") + '">' + (MOT.view === "week" ? "Show One Day" : "Show The Week") + '</button>' +
    '<button class="btn sm" data-motcal-yday="1">Yesterday</button></div>';
}
function motCalClose() { MOT.calOpen = false; var el = document.getElementById("mot-cal"); if (el) { el.classList.add("closing"); setTimeout(function () { if (el.classList.contains("closing")) el.remove(); }, 130); } var b = document.querySelector(".mot-dt"); if (b) b.setAttribute("aria-expanded", "false"); }
function motCalPaint() {
  var el = document.getElementById("mot-cal"), btn = document.querySelector(".mot-dt");
  if (!btn) { motCalClose(); return; }
  if (el && el.classList.contains("closing")) { el.remove(); el = null; }
  if (!el) { el = document.createElement("div"); el.id = "mot-cal"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Pick a day"); document.body.appendChild(el); }
  el.innerHTML = motCalHtml();
  var r = btn.getBoundingClientRect(); el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 308)) + "px"; el.style.top = (r.bottom + 6) + "px";
  btn.setAttribute("aria-expanded", "true");
}
function motCalOpen() {
  MOT.calOpen = true; MOT.calMonth = motMonthStart(MOT.day); motCalPaint(); motCalLoadMonth();
}
function motCalLoadMonth() {
  var m0 = MOT.calMonth, y = +m0.slice(0, 4), mo = +m0.slice(5, 7) - 1, to = rptIso(new Date(y, mo + 1, 0));
  motLoad(m0, to).then(function () { if (MOT.calOpen) motCalPaint(); }, function () {});
}
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && MOT.calOpen) motCalClose();
}, true);
document.addEventListener("mousedown", function (e) {
  if (!MOT.calOpen) return;
  if (!(e.target.closest && (e.target.closest("#mot-cal") || e.target.closest(".mot-dt")))) motCalClose();
});
document.addEventListener("click", function (e) {
  var b = e.target.closest && e.target.closest("[data-mot]");
  if (b) {
    var k = b.dataset.mot;
    if (k === "cal") { MOT.calOpen ? motCalClose() : motCalOpen(); return; }
    if (k === "pull") { MOT.loadedWeek = ""; motPullVisible(); return; }
    if (k === "all") { motDownloadAll(); return; }
    return;
  }
  var nav = e.target.closest && e.target.closest("[data-motcal]");
  if (nav) { var m0 = MOT.calMonth, d = new Date(+m0.slice(0, 4), +m0.slice(5, 7) - 1 + (+nav.dataset.motcal), 1); MOT.calMonth = rptIso(d); motCalPaint(); motCalLoadMonth(); return; }
  var pk = e.target.closest && e.target.closest("[data-motday-pick]");
  if (pk) { MOT.day = pk.dataset.motdayPick; MOT.pick = null; motCalClose(); render(); return; }
  var vw = e.target.closest && e.target.closest("[data-motcal-view]");
  if (vw) { MOT.view = vw.dataset.motcalView; MOT.pick = null; motCalClose(); render(); return; }
  if (e.target.closest && e.target.closest("[data-motcal-yday]")) { MOT.day = motYesterday(); MOT.pick = null; motCalClose(); render(); return; }
  var d2 = e.target.closest && e.target.closest("[data-motday]"); if (d2) { MOT.day = d2.dataset.motday; MOT.view = "day"; MOT.pick = null; render(); return; }
  var p2 = e.target.closest && e.target.closest("[data-motpick]"); if (p2) { MOT.pick = MOT.pick === p2.dataset.motpick ? null : p2.dataset.motpick; render(); }
});

/* ── Dashboard: total miles and external RPM, from Motive's totals ───────── */
// Per period: Motive's miles split Bag / Internal / External, external revenue, and RPM (revenue / ALL external bucket miles, deadhead included).
function motRollup(range) {
  var out = { total: 0, bag: 0, intf: 0, ext: 0, rev: 0, days: 0, brokers: {}, noLoadMiles: 0 };
  Object.keys(MOT.rows).forEach(function (k) {
    var p = k.split("|"), day = p[1]; if (day < range.from || day > range.to) return;
    var b = motBuckets(p[0], day); if (b.total == null) return;
    out.days++; out.total += b.total; out.bag += b.bag; out.intf += b.intf; out.ext += b.ext || 0;
    var eo = b.extOrders.filter(function (o) { return motNum(o.external_rate) != null; });
    if (!b.extOrders.length) { out.noLoadMiles += b.ext || 0; return; }
    var share = (b.ext || 0) / b.extOrders.length;
    b.extOrders.forEach(function (o) {
      var rate = motNum(o.external_rate) || 0, who = o.broker_name || o.customer_name || "(no broker)", x = out.brokers[who] = out.brokers[who] || { loads: 0, rev: 0, miles: 0 };
      x.loads++; x.rev += rate; x.miles += share; out.rev += rate;
    });
  });
  return out;
}
var MOT_DASH = { key: "", loading: false };
function motDashEnsure(range) {
  var key = range.from + "|" + range.to;
  if (MOT_DASH.key === key || MOT_DASH.loading) return;
  MOT_DASH.loading = true;
  motLoad(range.from, range.to).then(function () { MOT_DASH.key = key; }, function () { MOT_DASH.key = key; })
    .then(function () { MOT_DASH.loading = false; if (SEC === "reports" && REP.tab === "dash") render(); });
}
function motDashCards(range) {
  motDashEnsure(range);
  var r = motRollup(range);
  if (!r.days) return { miles: null, rpm: "" };
  var rpm = r.ext > 0 && r.rev > 0 ? r.rev / r.ext : null;
  return { roll: r, miles: '<div class="rpt-card"><div class="lbl">Total mileage</div><div class="rpt-big">' + Math.round(r.total).toLocaleString() + '</div><div class="rpt-sub">' +
      Math.round(r.bag).toLocaleString() + " bag · " + Math.round(r.intf).toLocaleString() + " internal · " + Math.round(r.ext).toLocaleString() + " external (Motive)</div></div>",
    rpm: '<div class="rpt-card"><div class="lbl">External RPM</div><div class="rpt-big">' + (rpm ? "$" + rpm.toFixed(2) : "—") + '</div><div class="rpt-sub">$' + Math.round(r.rev).toLocaleString() + " over " + Math.round(r.ext).toLocaleString() + " external miles, deadhead included</div></div>" };
}
function motBrokerTable(r) {
  var list = Object.keys(r.brokers).map(function (k) { var x = r.brokers[k]; return { who: k, loads: x.loads, rev: x.rev, miles: x.miles, rpm: x.miles ? x.rev / x.miles : null }; }).sort(function (a, b) { return b.rev - a.rev; });
  if (!list.length) return "";
  return '<div class="rpt-card rpt-months"><div class="lbl">External RPM by customer</div><table><thead><tr><th></th><th>Loads</th><th>Revenue</th><th>External miles</th><th>RPM</th></tr></thead><tbody>' +
    list.map(function (x) { return "<tr><td>" + esc(x.who) + "</td><td>" + x.loads + "</td><td>" + rptMoney(x.rev) + "</td><td>" + Math.round(x.miles).toLocaleString() + "</td><td>" + (x.rpm ? "$" + x.rpm.toFixed(2) : "—") + "</td></tr>"; }).join("") +
    '</tbody></table><div class="rpt-foot">Each day\'s external miles are shared evenly between that day\'s external loads. ' +
    (r.noLoadMiles ? Math.round(r.noLoadMiles).toLocaleString() + " external miles were on days with no external load (shop, fuel, empty miles) and count in the total above." : "") + "</div></div>";
}
function vReports() {
  rptSavedLoad();
  if (!REP.data && !REP.loading && !REP.err) rptDataLoad(); else if (REP.stale && !REP.loading) rptDataLoad();
  var mot = REP.tab === "motive", trf = REP.tab === "transfer";
  // the same bar as Orders and Current Week (compact buttons, one primary on the right), then everything else scrolls below it
  var h = toolbarHtml("Reports", trf ? {
    className: "orders-toolbar rpt-toolbar", context: "",
    secondary: '<button class="btn sm" data-trf="csv" title="The transfer below, one line per order, as a CSV">Download CSV</button>',
    primary: '<button class="btn pri sm" data-trf="mark">Mark Transfer Done</button>'
  } : mot ? {
    className: "orders-toolbar rpt-toolbar", context: motTabContext(),
    secondary: '<button class="btn sm" data-mot="all" title="Every truck-day saved from Motive, all the data, as one CSV">Download All Motive</button>',
    primary: '<button class="btn pri sm" data-mot="pull">Pull From Motive</button>'
  } : {
    className: "orders-toolbar rpt-toolbar", context: "",
    secondary: '<button class="btn sm" data-rptrefresh="1">Refresh Data</button><button class="btn sm" data-report="dump">Export Everything</button>',
    primary: '<button class="btn pri sm" id="rpt-new">+ New Report</button>'
  });
  h += '<div class="grid-wrap rpt-page"><div class="rpt-tabs" role="tablist"><button class="' + (REP.tab === "dash" ? "on" : "") + '" data-rpttab="dash" role="tab">Dashboard</button>' +
    '<button class="' + (mot ? "on" : "") + '" data-rpttab="motive" role="tab">Motive</button>' +
    '<button class="' + (trf ? "on" : "") + '" data-rpttab="transfer" role="tab">Transfer</button></div>';
  if (!mot && !trf) h += rptPeriodStrip();
  if (REP.noSql && !mot && !trf) h += '<div class="note-bar">Saved reports are not set up in the database yet, so nothing can be saved yet. Run the saved reports SQL first.</div>';
  return h + (trf ? vTransferTab() : mot ? vMotiveTab() : rptDashHtml()) + "</div>";
}
/* ── Reports → Transfer: billing the internal transfers ───────────────────
   Every delivered bag and internal freight order carries a dollar amount (miles × the Internal Rate). Roughly once a week
   (sometimes mid-week) all departments are transferred together. This tab lists what is due since the last transfer, by
   department and truck, up to a chosen delivery date; Mark Transfer Done saves it as one batch with your batch number, and
   those orders drop off the list for good. Undo removes a batch and its orders become due again. */
var TRF = { loaded: false, loading: false, err: "", batches: [], done: {}, amt: {}, adj: {}, from: "", through: "", fold: {}, open: {}, lines: {} };
function trfLoad() {
  if (TRF.loading) return; TRF.loading = true;
  api("transfer/list", {}).then(function (r) {
    TRF.batches = (r && r.batches) || []; TRF.done = {}; ((r && r.done) || []).forEach(function (id) { TRF.done[id] = 1; }); TRF.err = "";
    // What each transferred order was sent for, and what has been adjusted since (so a later change to the cost can be seen).
    TRF.amt = {}; ((r && r.amounts) || []).forEach(function (x) { TRF.amt[x.id] = { amount: Number(x.amount) || 0, batch_no: x.batch_no }; });
    TRF.adj = {}; ((r && r.adjusted) || []).forEach(function (x) { TRF.adj[x.id] = Number(x.diff) || 0; });
  }, function (e) { TRF.err = /function|schema|relation|does not exist/i.test(e.message) ? "Transfers are not set up in the database yet. Run the transfers SQL first." : e.message; })
    .then(function () { TRF.loaded = true; TRF.loading = false; if (SEC === "reports" && REP.tab === "transfer") render(); });
}
function trfDay(ts) { return rptIso(new Date(ts)); }   // the local calendar day a timestamp falls on
function trfDept(v) { v = String(v == null ? "" : v).trim(); return !v ? "(no department)" : /^\d+$/.test(v) ? "Dept " + v : v; }
function trfMoney(n) { return "$" + (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
/* What is due: delivered, not cancelled, bag or internal freight, not in a batch yet, delivered inside the From and Through dates (no From = everything not transferred yet).
   Also, for orders ALREADY transferred: if the cost has changed since (or the order was cancelled), the difference is flagged, and it goes out as an adjustment (plus or
   minus) in the next transfer when the order's delivery date is inside the same dates. "late" lists orders that were delivered on or before the last transfer's last day but
   were not in it (no cost then): they are in the total, and flagged so it doesn't come as a surprise. */
function trfDue() {
  var thru = TRF.through || motYesterday(), last = TRF.batches[0], lastThru = last ? String(last.through_date).slice(0, 10) : "";
  var out = { lines: [], missing: [], late: [], changes: [], adjust: [], depts: {}, total: 0, miles: 0, from: "" };
  var inRange = function (d) { return !!d && d <= thru && !(TRF.from && d < TRF.from); };
  var bump = function (dep, trk, amt, mi, adj) {
    var D = out.depts[dep] = out.depts[dep] || { orders: 0, adj: 0, miles: 0, amount: 0, trucks: {} };
    D.miles += mi; D.amount += amt; if (adj) D.adj++; else D.orders++;
    var T = D.trucks[trk] = D.trucks[trk] || { orders: 0, adj: 0, miles: 0, amount: 0 };
    T.miles += mi; T.amount += amt; if (adj) T.adj++; else T.orders++;
  };
  (REP.data || []).forEach(function (r) {
    if (r.order_type !== "Bag Order" && r.order_type !== "Internal Freight") return;
    var d = r.delivery_date ? String(r.delivery_date).slice(0, 10) : "", id = r.order_id, dep = trfDept(r.pivot_department), trk = r.truck_number || "(no truck)", mi = rptNum(r.miles) || 0;
    var no = r.rexius_order_no || r.broker_load_no || "";
    if (id && TRF.done[id]) {
      var rec = TRF.amt[id]; if (!rec) return;
      var was = rec.amount + (TRF.adj[id] || 0), cur = r.stage === "cancelled" ? 0 : (rptNum(r.internal_freight_amount) || 0);
      if (Math.abs(cur - was) < 0.005) return;
      var A = { order_id: id, no: no, department: dep, truck_number: trk, delivery_date: d, miles: mi, from_amount: was, to_amount: cur, diff: Math.round((cur - was) * 100) / 100, batch_no: rec.batch_no, inRange: inRange(d) };
      out.changes.push(A);
      if (A.inRange) { out.adjust.push(A); out.total += A.diff; if (!out.from || d < out.from) out.from = d; bump(dep, trk, A.diff, 0, true); }
      return;
    }
    if (r.stage === "cancelled" || !inRange(d)) return;
    var amt = rptNum(r.internal_freight_amount);
    if (!(amt > 0)) { out.missing.push({ truck: trk, no: no }); return; }
    var L = { order_id: id, no: no, department: dep, truck_number: trk, delivery_date: d, miles: mi, amount: amt };
    out.lines.push(L); out.total += amt; out.miles += mi; if (!out.from || d < out.from) out.from = d;
    if (lastThru && d <= lastThru) out.late.push(L);
    bump(dep, trk, amt, mi, false);
  });
  return out;
}
function trfSigned(n) { return (n < 0 ? "\u2212" : "+") + trfMoney(Math.abs(n)); }
// The flags above the table: changes made after a transfer, and orders that were missed by the last one.
function trfFlagsHtml(due) {
  var h = "", thead = function (cols) { return "<thead><tr>" + cols.map(function (c, i) { return "<th>" + c + "</th>"; }).join("") + "</tr></thead>"; };
  if (due.changes.length) {
    var net = 0; due.changes.forEach(function (c) { net += c.diff; });
    h += '<div class="trf-flag-h"><span class="lbl">Changed after it was transferred</span><span class="trf-flag-sub">' + due.changes.length + " order" + (due.changes.length === 1 ? "" : "s") + " · net " + trfSigned(net) +
      (due.adjust.length < due.changes.length ? " · the greyed ones are outside the dates below" : "") + "</span></div>" +
      '<div class="rpt-card trf-card trf-flags"><table class="trf-tbl">' + thead(["Order", "Department / truck", "Was", "Now", "Change"]) + "<tbody>" +
      due.changes.map(function (c) {
        return '<tr class="' + (c.inRange ? "" : "trf-out") + '"><td>' + esc(c.no || "—") + (c.batch_no ? ' <span class="trf-bn">batch ' + esc(c.batch_no) + "</span>" : "") + "</td><td>" + esc(c.department) + " · Truck " + esc(c.truck_number) + "</td><td>" + trfMoney(c.from_amount) + "</td><td>" + trfMoney(c.to_amount) + "</td><td><b>" + trfSigned(c.diff) + "</b></td></tr>";
      }).join("") + "</tbody></table></div>";
  }
  if (due.late.length) {
    var lt = 0; due.late.forEach(function (l) { lt += l.amount; });
    h += '<div class="trf-flag-h"><span class="lbl">Added after the last transfer</span><span class="trf-flag-sub">' + due.late.length + " order" + (due.late.length === 1 ? "" : "s") + " · " + trfMoney(lt) + " · delivered before the last transfer ended but not in it; they are in the total below</span></div>" +
      '<div class="rpt-card trf-card trf-flags"><table class="trf-tbl">' + thead(["Order", "Department / truck", "Delivered", "Amount"]) + "<tbody>" +
      due.late.map(function (l) { return "<tr><td>" + esc(l.no || "—") + "</td><td>" + esc(l.department) + " · Truck " + esc(l.truck_number) + "</td><td>" + esc(isoToMdy(l.delivery_date)) + "</td><td>" + trfMoney(l.amount) + "</td></tr>"; }).join("") + "</tbody></table></div>";
  }
  return h;
}
function trfAgo(iso) {
  var n = Math.round((new Date(TODAY + "T12:00:00") - new Date(String(iso).slice(0, 10) + "T12:00:00")) / 864e5);
  return n <= 0 ? "today" : n === 1 ? "yesterday" : n + " days ago";
}
function vTransferTab() {
  if (!TRF.loaded && !TRF.loading) trfLoad();
  if (!TRF.through) TRF.through = motYesterday();
  if (TRF.err) return '<div class="note-bar">' + esc(TRF.err) + "</div>";
  if (!REP.data || !TRF.loaded) return '<div class="empty">Loading…</div>';
  var due = trfDue(), last = TRF.batches[0], days = last ? Math.round((new Date(TODAY + "T12:00:00") - new Date(trfDay(last.done_at) + "T12:00:00")) / 864e5) : null;
  var late = days == null || days >= 7, nOrd = due.lines.length, nAdj = due.adjust.length, any = nOrd || nAdj;
  var h = '<div class="trf-status"><div class="trf-state"><span class="trf-dot' + (any && late ? " due" : any ? " soon" : "") + '"></span><div>' +
    '<div class="trf-big">' + (last ? "Last transfer " + esc(new Date(last.done_at).toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" })) + " · " + trfAgo(trfDay(last.done_at)) + (last.batch_no ? " · batch " + esc(last.batch_no) : "") : "No transfer done yet") + "</div>" +
    '<div class="trf-sub">' + (any ? trfMoney(due.total) + " across " + nOrd + " order" + (nOrd === 1 ? "" : "s") + (nAdj ? " and " + nAdj + " adjustment" + (nAdj === 1 ? "" : "s") : "") + " is due" + (late ? ". It has been a week or more." : ".") : "Nothing is due " + (TRF.from ? "from " + esc(isoToMdy(TRF.from)) + " " : "") + "through " + esc(isoToMdy(TRF.through)) + ".") + "</div></div></div>" +
    // The dates sit in their own fixed block, so they stay put whatever the text beside them says.
    '<div class="trf-range"><span class="lbl">From</span>' +
    '<input type="text" inputmode="numeric" placeholder="Earliest" data-smartdate data-trffrom class="rpt-date" data-last-iso="' + TRF.from + '" value="' + esc(TRF.from ? isoToMdy(TRF.from) : "") + '" title="Leave empty to include everything not transferred yet">' +
    '<span class="lbl">Through</span><span class="rpt-seg" role="group" aria-label="Through">' +
    [[motYesterday(), "Yesterday"], [TODAY, "Today"]].map(function (x) { return '<button class="' + (TRF.through === x[0] ? "on" : "") + '" data-trfthru="' + x[0] + '">' + x[1] + "</button>"; }).join("") + "</span>" +
    '<input type="text" inputmode="numeric" placeholder="MM/DD/YYYY" data-smartdate data-trfdate class="rpt-date" data-last-iso="' + TRF.through + '" value="' + esc(isoToMdy(TRF.through)) + '"></div></div>';
  h += trfFlagsHtml(due);
  h += '<div class="rpt-card trf-card"><table class="trf-tbl"><thead><tr><th>Department / truck</th><th>Orders</th><th>Miles</th><th>Amount</th></tr></thead><tbody>';
  var deps = Object.keys(due.depts).sort(), cnt = function (x) { return x.orders + (x.adj ? " + " + x.adj + " adj" : ""); };
  deps.forEach(function (d) {
    var D = due.depts[d], closed = !!TRF.fold[d];
    h += '<tr class="trf-dep' + (closed ? "" : " open") + '" data-trffold="' + esc(d) + '"><td><i>&#9656;</i>' + esc(d) + "</td><td>" + cnt(D) + "</td><td>" + Math.round(D.miles).toLocaleString() + "</td><td>" + trfMoney(D.amount) + "</td></tr>";
    if (!closed) Object.keys(D.trucks).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); }).forEach(function (t) {
      var T = D.trucks[t]; h += '<tr class="trf-trk"><td>Truck ' + esc(t) + "</td><td>" + cnt(T) + "</td><td>" + Math.round(T.miles).toLocaleString() + "</td><td>" + trfMoney(T.amount) + "</td></tr>"; });
  });
  h += deps.length ? '<tr class="trf-tot"><td>Total to transfer</td><td>' + cnt({ orders: nOrd, adj: nAdj }) + "</td><td>" + Math.round(due.miles).toLocaleString() + "</td><td>" + trfMoney(due.total) + "</td></tr>" :
    '<tr><td colspan="4" class="trf-none">Nothing to transfer ' + (TRF.from ? "from " + esc(isoToMdy(TRF.from)) + " " : "") + "through " + esc(isoToMdy(TRF.through)) + ".</td></tr>";
  h += "</tbody></table></div>";
  h += '<div class="trf-h"><span class="lbl">Done</span></div><div class="rpt-card trf-card"><table class="trf-tbl trf-hist"><thead><tr><th>Done</th><th>Batch</th><th>Covers</th><th>Orders</th><th>Amount</th><th></th></tr></thead><tbody>';
  if (!TRF.batches.length) h += '<tr><td colspan="6" class="trf-none">No transfers yet.</td></tr>';
  TRF.batches.forEach(function (b) {
    var open = !!TRF.open[b.id];
    h += '<tr class="trf-b' + (open ? " open" : "") + '" data-trfopen="' + b.id + '"><td><i>&#9656;</i>' + esc(isoToMdy(trfDay(b.done_at))) + "</td><td>" + esc(b.batch_no || "—") + "</td><td>" +
      esc((b.from_date ? isoToMdy(String(b.from_date).slice(0, 10)) + " – " : "through ") + isoToMdy(String(b.through_date).slice(0, 10))) + "</td><td>" + b.order_count + "</td><td>" + trfMoney(b.total) +
      '</td><td class="act"><button class="btn sm" data-trfundo="' + b.id + '">Undo</button></td></tr>';
    if (open) {
      var ls = TRF.lines[b.id];
      h += '<tr class="trf-detail"><td colspan="6">' + (!ls ? "Loading…" : trfBatchDetail(ls)) + "</td></tr>";
    }
  });
  return h + "</tbody></table></div>";
}
function trfBatchDetail(ls) {
  var D = {}; ls.forEach(function (l) { var d = D[l.department || "(no department)"] = D[l.department || "(no department)"] || {}, t = d[l.truck_number || "(no truck)"] = d[l.truck_number || "(no truck)"] || { n: 0, mi: 0, amt: 0 }; if (!l.adjustment) { t.n++; t.mi += +l.miles || 0; } else t.adj = (t.adj || 0) + 1; t.amt += +l.amount || 0; });
  return '<table class="trf-mini"><tbody>' + Object.keys(D).sort().map(function (d) {
    var tot = 0; Object.keys(D[d]).forEach(function (t) { tot += D[d][t].amt; });
    return '<tr class="trf-md"><td>' + esc(d) + "</td><td></td><td></td><td>" + trfMoney(tot) + "</td></tr>" + Object.keys(D[d]).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); }).map(function (t) {
      var x = D[d][t]; return '<tr><td>Truck ' + esc(t) + "</td><td>" + x.n + (x.adj ? " + " + x.adj + " adj" : "") + "</td><td>" + Math.round(x.mi).toLocaleString() + "</td><td>" + trfMoney(x.amt) + "</td></tr>"; }).join(""); }).join("") + "</tbody></table>";
}
function trfMarkModal() {
  var due = trfDue();
  if (!due.lines.length && !due.adjust.length) { toast("Nothing is due " + (TRF.from ? "from " + isoToMdy(TRF.from) + " " : "") + "through " + isoToMdy(TRF.through), true); return; }
  var deps = Object.keys(due.depts).sort();
  openModal('<div class="modal-hd"><h2>Mark transfer done</h2></div><div class="modal-body">' +
    '<p class="trf-sum">' + trfMoney(due.total) + " across " + due.lines.length + " order" + (due.lines.length === 1 ? "" : "s") + (due.adjust.length ? " and " + due.adjust.length + " adjustment" + (due.adjust.length === 1 ? "" : "s") + " (cost changes made after an earlier transfer)" : "") + ", delivered " + esc(isoToMdy(due.from)) + " through " + esc(isoToMdy(TRF.through)) + ".</p>" +
    '<table class="trf-mini">' + deps.map(function (d) { return "<tr><td>" + esc(d) + "</td><td>" + Object.keys(due.depts[d].trucks).length + " truck" + (Object.keys(due.depts[d].trucks).length === 1 ? "" : "s") + "</td><td>" + trfMoney(due.depts[d].amount) + "</td></tr>"; }).join("") + "</table>" +
    '<label class="setting-field" style="margin-top:14px"><span>Batch number</span><input type="text" id="trf-batch" placeholder="e.g. the journal entry or batch number" autocomplete="off"></label></div>' +
    '<div class="modal-ft"><span style="flex:1"></span><button class="btn" id="modal-cancel">Cancel</button><button class="btn pri" id="trf-confirm">Mark Done</button></div>');
  var inp = $("#trf-batch"); if (inp) inp.focus();
  var go = function () {
    var btn = $("#trf-confirm"); if (btn.disabled) return; btn.disabled = true;
    api("transfer/create", { batch_no: ($("#trf-batch").value || "").trim(), through_date: TRF.through, from_date: due.from, lines: due.lines, adjustments: due.adjust })
      .then(function (b) { closeModal(); toast("Transfer marked done · " + trfMoney(b.total)); TRF.loaded = false; TRF.lines = {}; trfLoad(); })
      .catch(function (err) { btn.disabled = false; toast(err.message, true); });
  };
  $("#trf-confirm").addEventListener("click", go);
  if (inp) inp.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
}
function trfCsv() {
  var due = trfDue(), q = function (v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  var rows = due.lines.map(function (l) { return { department: l.department, truck: l.truck_number, date: l.delivery_date, miles: l.miles, amount: l.amount, kind: "Order" }; })
    .concat(due.adjust.map(function (a) { return { department: a.department, truck: a.truck_number, date: a.delivery_date, miles: 0, amount: a.diff, kind: "Adjustment: order " + a.no + " was " + a.from_amount.toFixed(2) + ", now " + a.to_amount.toFixed(2) }; }));
  var lines = ["Department,Truck,Delivery date,Miles,Amount,Kind"].concat(rows.sort(function (a, b) { return (a.department + a.truck + a.date).localeCompare(b.department + b.truck + b.date, undefined, { numeric: true }); })
    .map(function (l) { return [l.department, l.truck, l.date, l.miles, l.amount.toFixed(2), l.kind].map(q).join(","); }));
  saveBlob("dept12_transfer_through_" + TRF.through + ".csv", new TextEncoder().encode(lines.join("\n") + "\n"), "text/csv"); toast("Exported the transfer");
}
document.addEventListener("click", function (e) {
  var b = e.target.closest && e.target.closest("[data-trf]");
  if (b) { if (b.dataset.trf === "mark") trfMarkModal(); else if (b.dataset.trf === "csv") trfCsv(); return; }
  var th = e.target.closest && e.target.closest("[data-trfthru]"); if (th) { TRF.through = th.dataset.trfthru; render(); return; }
  var f = e.target.closest && e.target.closest("[data-trffold]"); if (f) { TRF.fold[f.dataset.trffold] = !TRF.fold[f.dataset.trffold]; render(); return; }
  var u = e.target.closest && e.target.closest("[data-trfundo]");
  if (u) { var id = u.dataset.trfundo; confirmModal("Undo this transfer? Its orders become due again.", function () {
    api("transfer/delete", { id: id }).then(function () { TRF.loaded = false; TRF.lines = {}; trfLoad(); toast("Transfer undone"); }).catch(function (err) { toast(err.message, true); });
  }, "Undo Transfer"); return; }
  var o = e.target.closest && e.target.closest("[data-trfopen]");
  if (o) {
    var bid = o.dataset.trfopen; TRF.open[bid] = !TRF.open[bid];
    if (TRF.open[bid] && !TRF.lines[bid]) api("transfer/lines", { batch_id: bid }).then(function (ls) { TRF.lines[bid] = ls || []; render(); }, function () { TRF.lines[bid] = []; render(); });
    render();
  }
});
document.addEventListener("change", function (e) {
  if (e.target.matches && e.target.matches("[data-trfdate]") && e.target.dataset.lastIso) { TRF.through = e.target.dataset.lastIso; render(); }
  else if (e.target.matches && e.target.matches("[data-trffrom]")) { TRF.from = e.target.dataset.lastIso || ""; render(); }
});
/* --- the pivot window --- */
function rptFieldOpts() {
  var f = (REP.fields || []).slice(); Object.keys(RPT_DERIVED).forEach(function (k) { if (f.indexOf(k) < 0) f.push(k); });
  return f.sort().map(function (k) { return '<option value="' + esc(k) + '"' + (k in RPT_DERIVED ? ' label="calculated"' : "") + "></option>"; }).join("");
}
function rptFieldOk(f) { return !f || (REP.fields || []).indexOf(f) >= 0 || (f in RPT_DERIVED); }
function rptWinOpen(tile) {
  var c = tile ? rptFixCfg(rptCfgCopy(tile.cfg)) : { v: 2, rows: ["party"], cols: "", vals: [{ agg: "count", f: "" }, { agg: "sum", f: "revenue" }], big: 1, filters: [RPT_NOT_CANCELLED], per: "dash", dateF: "delivery_date" };
  if (!c.vals || !c.vals.length) c.vals = [{ agg: "count", f: "" }];
  if (!c.dateF) c.dateF = "delivery_date"; if (!c.per) c.per = "dash";
  if (c.per === "custom" && (!c.from || !c.to)) { var r0 = rptDashRange(); c.from = r0.from; c.to = r0.to; }
  REP.win = { id: tile && tile.id || null, name: tile ? tile.name : "New report", cfg: c, sortCol: null, dir: -1, drill: null };
  var pinKey = REP.win.id ? "r:" + REP.win.id : "";
  openModal('<div class="modal-hd rpt-hd"><input class="rpt-name" id="rpt-name" value="' + esc(REP.win.name) + '"' + "" + '>' +
    (pinKey ? rptPinSwitch(pinKey) : '<span class="rpt-tog off" title="Save the report first, then you can pin it">Save to pin on the Scheduler bar</span>') +
    '<button class="btn sm" id="rpt-csv">Export CSV</button></div>' +
    '<div class="modal-body rpt-win"><datalist id="rpt-fields">' + rptFieldOpts() + '</datalist><div id="rpt-out"></div><div id="rpt-ctlbox"></div></div>' +
    '<div class="modal-ft">' + (REP.win.id ? '<button class="btn bad" id="rpt-del">Delete Report</button>' : "") + '<span style="flex:1"></span>' +
    (REP.win.id ? '<button class="btn" id="rpt-saveas">Save As New</button><button class="btn pri" id="rpt-save">Save Changes</button>' : '<button class="btn pri" id="rpt-save">Save Report</button>') +
    '<button class="btn" id="modal-cancel">Close</button></div>');
  $("#modal").classList.add("wide-modal", "rpt-modal");
  rptWinControls(); rptWinUpdate();
}
function rptNice(f) { return String(f == null ? "" : f).replace(/_/g, " "); }
function rptPinSwitch(key) {
  var on = sbPins().indexOf(key) >= 0;
  return '<button class="rpt-tog' + (on ? " on" : "") + '" role="switch" aria-checked="' + on + '" data-sbpin="' + esc(key) + '"><i></i>Show on Scheduler bar</button>';
}
function rptFldSel(attr, val, ph, i) {
  var opts = (REP.fields || []).slice(); Object.keys(RPT_DERIVED).forEach(function (k) { if (opts.indexOf(k) < 0) opts.push(k); }); opts.sort();
  if (val && opts.indexOf(val) < 0) opts.unshift(val);
  return '<select class="rpt-sel rpt-fsel" ' + attr + (i != null ? ' data-i="' + i + '"' : "") + '><option value="">' + esc(ph || "Choose…") + "</option>" +
    opts.map(function (o) { return '<option value="' + esc(o) + '"' + (o === val ? " selected" : "") + ">" + esc(rptNice(o)) + (o in RPT_DERIVED ? " (calculated)" : "") + "</option>"; }).join("") + "</select>";
}
/* A search box that is also a drop-down: click it to see every column, type to narrow the list. kind: rows, cols or vals. */
function rptAllFields() { var f = (REP.fields || []).slice(); Object.keys(RPT_DERIVED).forEach(function (k) { if (f.indexOf(k) < 0) f.push(k); }); return f.sort(); }
function rptComboHtml(kind, ph) {
  return '<div class="rpt-combo"><input class="rpt-fin rpt-find" type="text" autocomplete="off" spellcheck="false" data-rptcombo="' + kind + '" placeholder="' + esc(ph) + '"><div class="rpt-menu" hidden></div></div>';
}
function rptMenuFill(inp) {
  var kind = inp.dataset.rptcombo, q = inp.value.trim().toLowerCase().replace(/ /g, "_"), menu = inp.nextElementSibling, c = REP.win.cfg;
  var list = rptAllFields().filter(function (k) { return !q || k.indexOf(q) >= 0; });
  menu.innerHTML = list.length ? list.map(function (k) {
    var on = kind === "rows" ? (c.rows || []).indexOf(k) >= 0 : kind === "cols" ? c.cols === k : false;
    return '<button type="button" class="rpt-opt' + (on ? " on" : "") + '" data-rptpick="' + esc(k) + '" data-kind="' + kind + '">' + esc(rptNice(k)) +
      '<span>' + (REP.numeric[k] || RPT_DERIVED[k] === 1 ? "number" : k in RPT_DERIVED ? "calculated" : "text / date") + "</span></button>"; }).join("") : '<div class="rpt-opt-none">No column matches.</div>';
  menu.hidden = false;
}
function rptMenuPick(k, kind) {
  var c = REP.win.cfg;
  if (kind === "rows") { if (c.rows.indexOf(k) < 0) c.rows.push(k); }
  else if (kind === "cols") c.cols = k;
  else c.vals.push(REP.numeric[k] || RPT_DERIVED[k] === 1 ? { agg: "sum", f: k } : { agg: "countd", f: k });
  REP.win.drill = null; rptWinControls(); rptWinUpdate();
}
document.addEventListener("focusin", function (e) { if (e.target.dataset && e.target.dataset.rptcombo) rptMenuFill(e.target); });
document.addEventListener("input", function (e) { if (e.target.dataset && e.target.dataset.rptcombo) rptMenuFill(e.target); });
document.addEventListener("mousedown", function (e) {
  var o = e.target.closest && e.target.closest("[data-rptpick]");
  if (o) { e.preventDefault(); rptMenuPick(o.dataset.rptpick, o.dataset.kind); return; }
  if (e.target.closest && e.target.closest(".rpt-combo")) return;
  document.querySelectorAll(".rpt-menu").forEach(function (m) { m.hidden = true; });
});
document.addEventListener("keydown", function (e) {
  if (!e.target.dataset || !e.target.dataset.rptcombo) return;
  if (e.key === "Escape") { e.stopPropagation(); e.target.nextElementSibling.hidden = true; }
  else if (e.key === "Enter") { var first = e.target.nextElementSibling.querySelector("[data-rptpick]"); if (first) { e.preventDefault(); rptMenuPick(first.dataset.rptpick, first.dataset.kind); } }
}, true);
/* Report builder side panel. Three tabs: Rows & Columns, Time Period, Filter. Rows = what the report is grouped by; Columns = the numbers worked out for each row. */
var RPT_ATTR_SUGGEST = ["party", "order_type", "delivered_month", "stage", "pivot_department", "truck_number", "customer", "broker"];
var RPT_MEAS_SUGGEST = [["Count", "count", ""], ["Sum revenue", "sum", "revenue"], ["Sum internal miles", "sum", "internal_miles"], ["Average days to deliver", "avg", "days_to_deliver"], ["Ratio revenue / internal miles", "ratio", "revenue", "internal_miles"]];
function rptWinControls() {
  var c = REP.win.cfg, h = "", tab = REP.win.tab || "add", ok = function (k) { return rptFieldOk(k); };
  // Rows
  var attrs = RPT_ATTR_SUGGEST.filter(function (k) { return ok(k) && (c.rows || []).indexOf(k) < 0; });
  var hRows = '<div class="rpt-sec"><div class="rpt-t">Rows</div><div class="rpt-chips">' + (c.rows || []).map(function (f, i) {
    return '<span class="rpt-chip">' + esc(rptNice(f)) + ' <button data-rptdo="rowdel" data-i="' + i + '" title="Remove">&times;</button></span>'; }).join("") +
    ((c.rows || []).length ? "" : '<span class="rpt-note">No rows yet: the report is one total.</span>') + "</div>" +
    rptComboHtml("rows", "Add a row: click for every column, or type to search") +
    (attrs.length ? '<div class="rpt-chips rpt-sugs">' + attrs.map(function (k) { return '<button type="button" class="rpt-sug attr" data-rptdo="addattr" data-f="' + esc(k) + '">+ ' + esc(rptNice(k)) + "</button>"; }).join("") + "</div>" : "") + "</div>";
  // Columns (the pivot's "across" field) and Values (the numbers worked out for each row)
  var hSplit = '<div class="rpt-sec"><div class="rpt-t">Columns</div><div class="rpt-chips">' + (c.cols ? '<span class="rpt-chip">' + esc(rptNice(c.cols)) + ' <button data-rptdo="coldel" title="Remove">&times;</button></span>' :
    '<span class="rpt-note">None: each value is its own column.</span>') + "</div>" + rptComboHtml("cols", "Add a column: click for every column, or type to search") + "</div>";
  var hVals = '<div class="rpt-sec"><div class="rpt-t">Values</div><div>' + c.vals.map(function (v, i) {
    return '<div class="rpt-line"><select class="rpt-sel" data-rptin="vagg" data-i="' + i + '">' + Object.keys(RPT_AGG).map(function (a) { return '<option value="' + a + '"' + (v.agg === a ? " selected" : "") + ">" + RPT_AGG[a] + "</option>"; }).join("") + "</select>" +
      (v.agg === "count" ? "" : rptFldSel('data-rptin="vf"', v.f, "column", i) + (v.agg === "ratio" ? '<span class="rpt-note">&divide;</span>' + rptFldSel('data-rptin="vf2"', v.f2, "column", i) : "")) +
      (c.vals.length > 1 ? ' <button class="rpt-x" data-rptdo="valdel" data-i="' + i + '" title="Remove">&times;</button>' : "") + "</div>"; }).join("") + "</div>" +
    rptComboHtml("vals", "Add a value: click for every column, or type to search") +
    '<div class="rpt-chips rpt-sugs">' + RPT_MEAS_SUGGEST.filter(function (m) { return !m[2] || (ok(m[2]) && (!m[3] || ok(m[3]))); }).map(function (m) {
      return '<button type="button" class="rpt-sug meas" data-rptdo="addmeas" data-m="' + RPT_MEAS_SUGGEST.indexOf(m) + '">+ ' + esc(m[0]) + "</button>"; }).join("") + "</div></div>";
  // Filter
  var hFil = '<div class="rpt-sec"><div class="rpt-t">Only include</div><div>' + (c.filters || []).map(function (f, i) {
    return '<div class="rpt-line">' + rptFldSel('data-rptin="ff"', f.f, "column", i) + '<select class="rpt-sel" data-rptin="fop" data-i="' + i + '">' + Object.keys(RPT_OPS).map(function (o) { return '<option value="' + o + '"' + (f.op === o ? " selected" : "") + ">" + RPT_OPS[o] + "</option>"; }).join("") + "</select>" +
      (f.op === "blank" || f.op === "notblank" ? "" : '<input class="rpt-fin" data-rptin="fv" data-i="' + i + '" value="' + esc(f.v == null ? "" : f.v) + '" placeholder="value">') +
      ' <button class="rpt-x" data-rptdo="fdel" data-i="' + i + '" title="Remove">&times;</button></div>'; }).join("") +
    '<button class="rpt-add" data-rptdo="fadd">+ Add</button></div></div>';
  // Time period
  var hPer = '<div class="rpt-sec"><div class="rpt-t">Time period</div><div class="rpt-line"><select class="rpt-sel" data-rptin="per">' + RPT_PER.map(function (x) { return '<option value="' + x[0] + '"' + (c.per === x[0] ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") + "</select>" +
    (c.per === "all" ? "" : '<span class="rpt-note">by</span>' + rptFldSel('data-rptin="datef"', c.dateF, "date column")) + "</div>" +
    (c.per === "custom" ? '<div class="rpt-line"><input type="text" inputmode="numeric" data-smartdate data-rptwfrom class="rpt-date" data-last-iso="' + c.from + '" value="' + esc(isoToMdy(c.from)) + '"><span class="rpt-note">to</span><input type="text" inputmode="numeric" data-smartdate data-rptwto class="rpt-date" data-last-iso="' + c.to + '" value="' + esc(isoToMdy(c.to)) + '"></div>' : "") +
    '<label class="rpt-chk"><input type="checkbox" data-rptin="bars"' + (c.bars ? " checked" : "") + "> Show bars</label></div>";
  var tabs = [["add", "Rows & Columns"], ["period", "Time Period"], ["filter", "Filter"]];
  h = '<div class="rpt-ptabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" class="' + (tab === t[0] ? "on" : "") + '" aria-selected="' + (tab === t[0]) + '" data-rptptab="' + t[0] + '">' + t[1] + "</button>"; }).join("") + "</div>";
  h += tab === "add" ? hRows + hSplit + hVals : tab === "filter" ? hFil : hPer;
  $("#rpt-ctlbox").innerHTML = h;
}
function rptWinRun() {
  var w = REP.win, res = rptRun(w.cfg), dc = rptDisplay(res), rows = res.rows.slice();
  if (w.sortCol != null && w.sortCol >= 0 && dc[w.sortCol]) rows.sort(function (a, b) { var x = dc[w.sortCol].get(a), y = dc[w.sortCol].get(b); return ((x == null ? -Infinity : x) > (y == null ? -Infinity : y) ? 1 : -1) * w.dir; });
  else if (w.sortCol === -1) rows.sort(function (a, b) { return a.labels.join(" ").localeCompare(b.labels.join(" "), undefined, { numeric: true }) * w.dir; });
  else if (dc.length) rows.sort(function (a, b) { var i = Math.min(w.cfg.big == null ? dc.length - 1 : w.cfg.big, dc.length - 1); var k = res.cf ? dc.length - res.vals.length + Math.min(i, res.vals.length - 1) : i; var x = dc[k].get(a), y = dc[k].get(b); return (y == null ? -Infinity : y) - (x == null ? -Infinity : x); });
  return { res: res, dc: dc, rows: rows };
}
function rptWinUpdate() {
  var w = REP.win, out = $("#rpt-out"); if (!w || !out) return;
  if (!REP.data) { out.innerHTML = '<div class="empty">Loading the report data…</div>'; return; }
  var d = rptWinRun(), res = d.res, dc = d.dc, c = w.cfg;
  if (!res.vals.length) { out.innerHTML = '<div class="empty">Add at least one value.</div>'; return; }
  var arrow = function (i) { return w.sortCol === i ? (w.dir > 0 ? " &#9650;" : " &#9660;") : ""; };
  var bigCol = dc.length - 1, mx = 0;
  d.rows.forEach(function (r) { var x = dc[bigCol].get(r); if (x != null && x > mx) mx = x; });
  var h = '<div class="rpt-meta">' + res.count.toLocaleString() + " orders · " + d.rows.length.toLocaleString() + " rows" + (res.cols.length >= 40 ? " · first 40 columns" : "") + '</div><div class="grid-wrap rpt-tbl"><table class="data"><thead><tr>' +
    (res.rf.length ? res.rf.map(function (f, i) { return '<th data-rptsort="-1">' + esc(rptNice(f)) + (i === 0 ? arrow(-1) : "") + "</th>"; }).join("") : "<th>All orders</th>") +
    dc.map(function (x, i) { return '<th class="r" data-rptsort="' + i + '">' + esc(rptNice(x.head)) + arrow(i) + "</th>"; }).join("") + "</tr></thead><tbody>";
  d.rows.slice(0, 500).forEach(function (r, ri) {
    h += '<tr class="rpt-row">' + (res.rf.length ? r.labels.map(function (l) { return '<td data-rptcell="' + ri + '|-1">' + esc(l) + "</td>"; }).join("") : '<td data-rptcell="' + ri + '|-1">All</td>') +
      dc.map(function (x, i) { var v = x.get(r), bar = c.bars && i === bigCol && mx > 0 && v != null && v > 0 ? '<span class="rpt-bar" style="width:' + Math.max(2, Math.round(v / mx * 80)) + 'px"></span>' : "";
        return '<td class="r n' + (x.strong ? " strong" : "") + '" data-rptcell="' + ri + "|" + i + '">' + bar + rptValFmt(x.v, v) + "</td>"; }).join("") + "</tr>"; });
  if (!d.rows.length) h += '<tr><td colspan="' + (Math.max(1, res.rf.length) + dc.length) + '" class="rpt-none">No orders match.</td></tr>';
  h += '<tr class="rpt-tot"><td colspan="' + Math.max(1, res.rf.length) + '">Total</td>' + dc.map(function (x) { return '<td class="r n">' + rptValFmt(x.v, x.tot) + "</td>"; }).join("") + "</tr></tbody></table></div>";
  if (w.drill) {
    var dr = d.rows[w.drill.ri], list = dr ? (w.drill.ci >= 0 && res.cf ? (dr.cells[res.cols[Math.floor(w.drill.ci / res.vals.length)]] || []) : dr.all) : [];
    h += '<div class="rpt-drill"><div class="lbl">' + list.length + " order" + (list.length === 1 ? "" : "s") + " in this cell" + (list.length > 40 ? " (first 40)" : "") + "</div>" +
      list.slice(0, 40).map(function (o) { var k = o.rexius_order_no || o.broker_load_no || "(no #)", has = rptFindOrder(o);
        return '<button class="rpt-ord" ' + (has ? 'data-rptopen="' + has.id + '"' : "disabled") + "><b>" + esc(k) + "</b><span>" + esc(o.party) + "</span><span>" + esc(o.delivery_date ? isoToMdy(String(o.delivery_date).slice(0, 10)) : "") + "</span><span>" +
          (o.internal_miles ? Math.round(o.internal_miles) + " mi" : "") + "</span><span>" + (o.revenue ? rptMoney(o.revenue) : "") + "</span></button>"; }).join("") + "</div>";
  }
  out.innerHTML = h;
}
function rptFindOrder(r) {
  if (r.order_id) return order(r.order_id);
  var no = r.rexius_order_no, ld = r.broker_load_no, found = null;
  orders().some(function (o) { if ((no && o.rexius_order_no === no) || (!no && ld && o.broker_load_no === ld)) { found = o; return true; } return false; });
  return found;
}
function rptWinCsv() {
  var d = rptWinRun(), res = d.res, w = REP.win;
  var q = function (v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  var raw = function (v, x) { return x == null ? "" : typeof x === "number" ? (v.agg === "count" || v.agg === "countd" ? Math.round(x) : Math.round(x * 10000) / 10000) : x; };
  var lines = [(res.rf.length ? res.rf : ["All orders"]).concat(d.dc.map(function (x) { return x.head; })).map(q).join(",")];
  d.rows.forEach(function (r) { lines.push((res.rf.length ? r.labels : ["All"]).concat(d.dc.map(function (x) { return raw(x.v, x.get(r)); })).map(q).join(",")); });
  lines.push(["Total"].concat(res.rf.slice(1).map(function () { return ""; })).concat(d.dc.map(function (x) { return raw(x.v, x.tot); })).map(q).join(","));
  var fn = "dept12_" + (($("#rpt-name").value || "report").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "report") + "_" + TODAY + ".csv";
  saveBlob(fn, new TextEncoder().encode(lines.join("\n") + "\n"), "text/csv"); toast("Exported " + fn);
}
function rptWinSave(asNew) {
  var w = REP.win, name = ($("#rpt-name").value || "").trim();
  if (!name) { toast("Give the report a name", true); return; }
  if (!w.cfg.vals.length) { toast("Add at least one value", true); return; }
  var body = { name: name, config: w.cfg };
  if (w.id && !asNew) body.id = w.id;
  api("saved-report", body).then(function () { REP.saved = null; REP.noSql = false; closeModal(); REP.win = null; toast("Saved to the Dashboard"); render(); })
    .catch(function (err) { toast(/function|schema|relation|does not exist/i.test(err.message) ? "Saved reports are not set up yet. Run the saved reports SQL first." : err.message, true); });
}
function rptWinChange(el) {
  var w = REP.win, c = w.cfg, i = el.dataset.i != null ? +el.dataset.i : -1, k = el.dataset.rptin, v = el.value, redo = false;
  if (/^(rowadd|cols|vf|vf2|ff|datef)$/.test(k) && v && !rptFieldOk(v.trim())) { toast("No column called “" + v + "”. Pick one from the list.", true); el.value = ""; return; }
  v = (v || "").trim();
  if (k === "rowadd") { if (v && c.rows.indexOf(v) < 0) c.rows.push(v); redo = true; }
  else if (k === "cols") c.cols = v;
  else if (k === "vagg") { c.vals[i].agg = v; if (v === "count") { c.vals[i].f = ""; } redo = true; }
  else if (k === "vf") c.vals[i].f = v;
  else if (k === "vf2") c.vals[i].f2 = v;
  else if (k === "ff") c.filters[i].f = v;
  else if (k === "fop") { c.filters[i].op = v; redo = true; }
  else if (k === "fv") c.filters[i].v = v;
  else if (k === "datef") c.dateF = v || "delivery_date";
  else if (k === "bars") c.bars = el.checked;
  else if (k === "per") { c.per = v; if (v === "custom") { var r = rptDashRange(); c.from = c.from || r.from; c.to = c.to || r.to; } redo = true; }
  if (c.cols && !rptFieldOk(c.cols)) c.cols = "";
  w.drill = null; if (redo) rptWinControls(); rptWinUpdate();
}
document.addEventListener("change", function (e) {
  var el = e.target;
  if (el.id === "rpt-per") { REP.per = el.value; if (el.value !== "custom") { REP.from = ""; REP.to = ""; try { localStorage.setItem("dept12RepPer", el.value); } catch (e2) {} } render(); return; }
  if (el.matches && el.matches("[data-rptdfrom],[data-rptdto]")) {
    var f = $("[data-rptdfrom]"), t = $("[data-rptdto]");
    if (f.dataset.lastIso && t.dataset.lastIso) { REP.per = "custom"; REP.from = f.dataset.lastIso; REP.to = t.dataset.lastIso; render(); }
    return;
  }
  if (!REP.win || !el.closest || !el.closest(".rpt-win")) return;
  if (el.matches("[data-rptwfrom],[data-rptwto]")) { var f2 = $("#modal [data-rptwfrom]"), t2 = $("#modal [data-rptwto]"); if (f2.dataset.lastIso && t2.dataset.lastIso) { REP.win.cfg.from = f2.dataset.lastIso; REP.win.cfg.to = t2.dataset.lastIso; REP.win.cfg.per = "custom"; REP.win.drill = null; rptWinUpdate(); } return; }
  if (el.dataset.rptin) rptWinChange(el);
});

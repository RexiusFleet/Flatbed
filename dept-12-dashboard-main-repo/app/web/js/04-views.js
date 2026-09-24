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
    secondary: '<button class="btn" id="bill-dl-sel">Download Selected (' + GROUP.length + ")</button>" +
      '<button class="btn" id="bill-draft-sel">Draft Selected</button>',
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
        '<td><div class="cell"><a href="/api/file/' + encodeURI(d.storage_path) + '" target="_blank" rel="noopener">' +
        esc(d.original_filename || "(file)") + "</a></div></td>" +
        '<td><div class="cell"><select class="cell-i" data-attach-doc="' + d.id + '">' +
        '<option value="">— pick an order —</option>' +
        exts.map(function (o) {
          return '<option value="' + o.id + '">' +
            esc((o.solomon_order_no || o.broker_load_no || "no #") + " · " + buildChip(o).title) + "</option>";
        }).join("") + "</select></div></td>" +
        '<td><div class="cell" style="display:flex;gap:4px"><a class="btn sm" href="/api/file/' + encodeURI(d.storage_path) +
        '" target="_blank" rel="noopener">Open</a>' +
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
        '<button class="btn sm" data-bill-draft="' + o.id + '"' + (ready ? "" : " disabled") + ">Draft</button>" +
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

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

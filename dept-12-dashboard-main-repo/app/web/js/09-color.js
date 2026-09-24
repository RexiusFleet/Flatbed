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

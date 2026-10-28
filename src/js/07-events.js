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
    .then(function () { AUTOSTAGE_OFF = true; return reload(); }).then(function () { toast("Order number reserved"); })
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
  if (dbcol && !e.target.closest(".col-resize")) {
    var sg = dbcol.dataset.colgrid, sf = dbSortFieldId(dbcol.dataset.colref), sc = GRIDSORT[sg];
    if (!sc || sc.fieldId !== sf) GRIDSORT[sg] = { fieldId: sf, dir: "asc" };
    else if (sc.dir === "asc") sc.dir = "desc";
    else delete GRIDSORT[sg];
    render(); return;
  }
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
    "[data-pkg],[data-nodelivery],[data-restore-order],[data-tracker-collapse],[data-tracker-collapse-more],[data-tsort],[data-rpttab],[data-rpttile],[data-rptsort],[data-rptcell],[data-rptdo],[data-rptptab],[data-rptrefresh],[data-rptopen],#rpt-new,#rpt-csv,#rpt-save,#rpt-saveas,#rpt-del," +
    "[data-copy-order],[data-addcust],[data-addcol]," +
    "[data-addrow],[data-delrows],[data-archiverows],[data-delarchived],[data-archiveview],[data-orderdelrows],[data-ordercancelrows],[data-delete-doc],[data-frreset],[data-catadd],[data-catdel],[data-sortsave],[data-sortclear]," +
    "[data-addsheet],[data-sheet-addrow],[data-sheet-addcol],[data-sheet-rename]," +
    "[data-managecols],[data-colup],[data-coldown],[data-adddb]," +
    "#theme,#sync-all,#jump-btn,#today-jump,#logo-home,#add-truck,#add-driver," +
    "#add-pickdrop,#add-department,#new-order,#xfer-add,#xfer-bulk,#xfer-save-bulk,#dw-close,#group-btn,#scrim,#nav-scrim,#int-add,#int-bulk,#int-save-bulk,#push-driver-tabs," +
    "#modal-cancel,#modal-save,#modal-save-loc,#modal-save-dept,#modal-save-truck,#modal-save-driver,#col-save,#col-delete,#condfmt-save,#field-save,#field-options-save,#db-save,#confirm-del,#confirm-archive-delete,#confirm-customer-archive,#ss-toggle,#ifr-toggle,[data-sbpin],[data-rptper]," +
    "#profile-btn,[data-profile],[data-setpref],[data-showsched],[data-screc],[data-screset],[data-scresetall]," +
    "[data-cw-step],[data-schedsize-step],[data-schedsize-reset],[data-accent-pick],[data-accent-save],[data-accent-forget],[data-custom-accent-toggle],[data-numbering-save]," +
    "#navtoggle,[data-navto],[data-navsec],[data-navcycle],[data-bill-done],[data-bill-dl],[data-reopen-bill]," +
    "#bill-dl-sel,#bill-done-sel,#bill-combine-sel");
  if (!t) return;
  if (t.id === "scrim") { closeDrawer(); closeModal(); return; }
  if (t.id === "nav-scrim") { closeMobileNav(); return; }
  if (t.dataset.routeEdit) { openOrder(t.dataset.routeEdit); return; }   // the route is edited in the side window
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
  if (t.dataset.sortclear) { delete GRIDSORT[t.dataset.sortclear]; render(); return; }
  if (t.dataset.sortsave) {
    saveDatabaseOrder(t.dataset.sortsave);
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
    if (srn) {
      openModal('<div class="modal-hd"><h2>Rename Sheet</h2></div><div class="modal-body">' +
        '<label class="mf"><span>Name</span><input id="sheet-rename-in" value="' + esc(srn.name) + '"></label></div>' +
        '<div class="modal-ft"><button class="btn" id="modal-cancel">Cancel</button><button class="btn pri" id="modal-confirm">Rename</button></div>');
      var rin = $("#sheet-rename-in"); if (rin) { rin.focus(); rin.select(); }
      $("#modal-confirm").addEventListener("click", function () {
        var nn = ($("#sheet-rename-in").value || "").trim(); if (!nn) return;
        closeModal();
        api("sheet", { id: srn.id, name: nn }).then(reload).catch(function (err) { toast(err.message, true); });
      });
    }
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
      '<button class="btn del" id="confirm-del" data-delgrid="' + g + '">Delete ' + ids.length + "</button></div>");
    return;
  }
  if (t.dataset.delarchived) {
    var dag = t.dataset.delarchived, dids = (ROWSEL[dag] || []).slice(), dcfg = archiveConfigForGrid(dag);
    if (!dids.length) { toast("Select rows first — click the numbers on the left", true); return; }
    openModal('<div class="modal-hd"><h2>Delete ' + dids.length + " " + (dids.length === 1 ? dcfg.singular : dcfg.plural) +
      ' for good?</h2></div><div class="modal-body"><p style="font-size:var(--fs-body);color:var(--ink-2)">' +
      "This can&rsquo;t be undone. Anything an order, load or invoice still uses is kept in the archive and reported.</p></div>" +
      '<div class="modal-ft"><button class="btn" id="modal-cancel">Cancel</button>' +
      '<button class="btn del" id="confirm-archive-delete" data-archive-grid="' + dag + '">Delete ' + dids.length + "</button></div>");
    return;
  }
  if (t.id === "confirm-archive-delete") {
    var xg = t.dataset.archiveGrid, xids = (ROWSEL[xg] || []).slice(), failed = [];
    t.disabled = true;
    Promise.all(xids.map(function (id) {
      return api("database/delete", { grid: xg, id: id }).catch(function (err) {
        failed.push(/api_database_delete|PGRST202|Could not find the function/i.test(err.message || "") ?
          "Delete from the archive isn't switched on in the database yet (the SQL hasn't been run)." : err.message);
      });
    })).then(function () { ROWSEL[xg] = []; ROWSEL_ANCHOR[xg] = null; closeModal(); return reload(); }).then(function () {
      var okN = xids.length - failed.length;
      if (okN) toast("Deleted " + okN + (failed.length ? "; " + failed.length + " kept" : ""));
      if (failed.length) toast(failed[0], true);
    }).catch(function (err) { t.disabled = false; toast(err.message, true); });
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
      '<button class="btn pri" id="confirm-customer-archive" data-archive-grid="' + ag + '" data-archive-mode="' +
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
    if (!odIds.length) { toast("Those stay on file: billed external orders and delivered bag orders with an order number can't be deleted", true); return; }
    var odDelivered = odIds.filter(function (id) { var o = order(id); return o && o.delivery_date; }).length;
    confirmModal("Permanently delete " + odIds.length + " order" + (odIds.length > 1 ? "s" : "") +
      "? Scheduler placement and attached documents are also deleted. This cannot be undone." +
      (odDelivered ? " " + odDelivered + (odDelivered > 1 ? " of them are" : " of them is") + " already delivered." : "") +
      (odSkipped ? " (" + odSkipped + " selected order" + (odSkipped > 1 ? "s stay" : " stays") + " on file because billed external orders and delivered bag orders with an order number can't be deleted.)" : ""),
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
    var dupKey = cd.name.trim().toLowerCase().replace(/\s+/g, " ");
    var dup = (DB.parties || []).filter(function (p) { return String(p.name || "").trim().toLowerCase().replace(/\s+/g, " ") === dupKey; })[0];
    if (dup) {
      var where = dup.is_broker && dup.broker_archived_at ? "in the archived external customers" : dup.is_broker ? "in external customers" : dup.is_customer ? "in bagger customers" : "in the database";
      toast("\u201c" + dup.name + "\u201d already exists " + where + ". Open that row instead of adding it again.", true); return;
    }
    if (t.disabled) return; t.disabled = true;      // a second click while saving must not add it twice
    api("customer", cd).then(function (party) { return saveCustomFields(custGrid, "parties", party.id, cd); })
      .then(reload).then(function () { closeModal(); toast("Customer added"); })
      .catch(function (err) { t.disabled = false; toast(/parties_name|duplicate key/i.test(err.message || "") ? "A customer with that name already exists." : err.message, true); });
    return;
  }
  if (t.id === "modal-save-loc") {
    var ld = {};
    [].forEach.call(document.querySelectorAll("#modal [data-cf]"), function (f) {
      ld[f.dataset.cf] = f.type === "checkbox" ? f.checked : f.value;
    });
    if (!ld.name || !ld.name.trim()) { toast("Company name is required", true); return; }
    var locTarget = MODAL_LOC_TARGET, stopTarget = null, newLocId = null; MODAL_LOC_TARGET = null;
    // A drawer stop box ("stop:…") finishes through the route save instead.
    if (locTarget && /^stop:/.test(locTarget.field)) { stopTarget = locTarget; locTarget = null; }
    var lkey = function (v) { return String(v || "").trim().toLowerCase().replace(/\s+/g, " "); };
    var ldup = (DB.locations || []).filter(function (l) {
      return lkey(l.name) === lkey(ld.name) && lkey(l.address) === lkey(ld.address) && lkey(l.city) === lkey(ld.city) && lkey(l.state) === lkey(ld.state);
    })[0];
    if (ldup) { MODAL_LOC_TARGET = locTarget || stopTarget; toast("\u201c" + ldup.name + "\u201d is already on the Pick/Drop List with that address.", true); return; }
    if (t.disabled) return; t.disabled = true;
    api("location", ld).then(function (loc) {
      newLocId = loc.id;
      return saveCustomFields("pickdrop", "locations", loc.id, ld).then(function () {
        // Opened from a drawer/tracker combo's "+Create" — finish the pick
        // too, so confirming this popup is the whole action (Nate: "add
        // locations to my pick and drop list right then and there").
        if (!locTarget) return null;
        var body = { id: locTarget.oid }; body[locTarget.field] = loc.id;
        return api("order/update", body);
      });
    }).then(reload).then(function () {
      closeModal(); toast(locTarget || stopTarget ? "Location added and set" : "Location added");
      if (stopTarget) drawerStopPick(stopTarget.oid, stopTarget.field, newLocId);
    })
      .catch(function (err) { t.disabled = false; toast(err.message, true); });
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
    SUB = t.dataset.sub; SEL = null; render(); return;
  }
  if (t.dataset.open) { openOrder(t.dataset.open); return; }
  if (t.dataset.pkgrow) { doPackage(t.dataset.pkgrow, "merged"); return; }
  if (t.dataset.pkg) { if (DRAWER_OID) doPackage(DRAWER_OID, t.dataset.pkg); return; }
  if (t.dataset.billDone) { billDone(t.dataset.billDone); return; }
  if (t.dataset.billDl) {
    var dlId = t.dataset.billDl;
    doPackage(dlId, "merged").then(function () { askMarkBilled([dlId]); })
      .catch(function (err) { toast(err.message || "Download failed", true); });
    return;
  }
  if (t.id === "bill-dl-sel") { billBatch(); return; }
  if (t.id === "bill-done-sel") { billDoneMany(); return; }
  if (t.id === "bill-combine-sel") { groupMerge(); return; }
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
    setPref("rowHeight", 96); setPref("colWidth", 150); render(); toast("Scheduler size reset"); return;
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
  if (t.id === "sync-all") { runSyncAll(t); return; }
  if (t.dataset.rpttab) { REP.tab = t.dataset.rpttab; render(); return; }
  if (t.dataset.rptrefresh) { rptDataLoad(); render(); return; }
  if (t.dataset.rpttile) { rptWinOpen(rptTiles()[+t.dataset.rpttile]); return; }
  if (t.id === "rpt-new") { REP.tab = "dash"; rptWinOpen(null); return; }
  if (t.dataset.rptdo && REP.win) { var rc = REP.win.cfg, ri2 = +t.dataset.i, act = t.dataset.rptdo;
    if (act === "addattr") { if (rc.rows.indexOf(t.dataset.f) < 0) rc.rows.push(t.dataset.f); }
    else if (act === "addmeas") { var sm = RPT_MEAS_SUGGEST[+t.dataset.m]; rc.vals.push(sm[1] === "count" ? { agg: "count", f: "" } : sm[1] === "ratio" ? { agg: "ratio", f: sm[2], f2: sm[3] } : { agg: sm[1], f: sm[2] }); }
    else if (act === "rowdel") rc.rows.splice(ri2, 1);
    else if (act === "coldel") rc.cols = "";
    else if (act === "valadd") rc.vals.push({ agg: "sum", f: "" });
    else if (act === "valdel") rc.vals.splice(ri2, 1);
    else if (act === "fadd") { rc.filters = rc.filters || []; rc.filters.push({ f: "", op: "eq", v: "" }); }
    else if (act === "fdel") rc.filters.splice(ri2, 1);
    REP.win.drill = null; rptWinControls(); rptWinUpdate(); return; }
  if (t.dataset.rptptab && REP.win) { REP.win.tab = t.dataset.rptptab; rptWinControls(); return; }
  if (t.dataset.rptsort && REP.win) { var rw = REP.win, rs = +t.dataset.rptsort;
    if (rw.sortCol === rs) rw.dir = -rw.dir; else { rw.sortCol = rs; rw.dir = rs === -1 ? 1 : -1; } rw.drill = null; rptWinUpdate(); return; }
  if (t.dataset.rptcell && REP.win) { var pc = t.dataset.rptcell.split("|"), dd = REP.win.drill;
    REP.win.drill = dd && dd.ri === +pc[0] && dd.ci === +pc[1] ? null : { ri: +pc[0], ci: +pc[1] }; rptWinUpdate(); return; }
  if (t.dataset.rptopen) { closeModal(); REP.win = null; openOrder(t.dataset.rptopen); return; }
  if (t.id === "rpt-csv" && REP.win) { rptWinCsv(); return; }
  if (t.id === "rpt-save" && REP.win) { rptWinSave(false); return; }
  if (t.id === "rpt-saveas" && REP.win) { rptWinSave(true); return; }
  if (t.id === "rpt-del" && REP.win && REP.win.id) {
    var delId = REP.win.id;
    confirmModal("Delete this report? It comes off the Dashboard and the Scheduler bar. The orders it reads are not touched.", function () {
      api("saved-report/delete", { id: delId }).then(function () { REP.saved = null; REP.win = null; toast("Report deleted"); render(); })
        .catch(function (err) { toast(err.message, true); });
    }, "Delete Report");
    return;
  }
  if (t.dataset.rptper) {
    var rv = t.dataset.rptper; REP.per = rv;
    if (rv !== "custom") { REP.from = ""; REP.to = ""; try { localStorage.setItem("dept12RepPer", rv); } catch (x) {} }
    render(); return;
  }
  if (t.dataset.sbpin) {
    var pk = t.dataset.sbpin, pins = sbPins().slice(), pi = pins.indexOf(pk);
    if (pi >= 0) pins.splice(pi, 1);
    else { if (pins.length >= SB_MAX) { toast("The Scheduler bar holds " + SB_MAX + ". Unpin one first.", true); return; } pins.push(pk); }
    sbSetPins(pins);
    [].forEach.call(document.querySelectorAll(".rpt-tog[data-sbpin]"), function (b) { var on = pins.indexOf(b.dataset.sbpin) >= 0; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
    render();
    return;
  }
  if (t.id === "ss-toggle") {
    var sw = document.getElementById("sched-statwrap"), open = sw.classList.toggle("closed") === false;
    SCHED_RATES_OPEN = open;
    try { localStorage.setItem("schedRatesOpen", open ? "1" : "0"); } catch (x) {}
    t.setAttribute("aria-expanded", open); t.title = open ? "Hide pinned numbers" : "Show pinned numbers"; t.textContent = open ? ">" : "<";
    return;
  }
  if (t.id === "ifr-toggle") {
    var ib = document.getElementById("ifr-bar"), iopen = ib.classList.toggle("closed") === false;
    IFR_OPEN = iopen;
    try { localStorage.setItem("ifrOpen", iopen ? "1" : "0"); } catch (x) {}
    t.setAttribute("aria-expanded", iopen); t.title = (iopen ? "Hide" : "Show") + " internal rate"; t.textContent = iopen ? ">" : "<";
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
    // Publish Schedule: saves what drivers and the bag plant see.
    if (t.disabled) return;
    t.disabled = true;
    toast("Publishing the schedule…");
    api("sheets/push-driver-tabs", { start_date: CW_START, days: CW_DAYS })
      .then(function (r) {
        // The publish stamps loads.pushed_at server-side, which flips external
        // chips over to the truck's driver-color tint (pushColorFor); reload so
        // the Scheduler/Current Week/Driver Tabs show it right away.
        return reload().then(function () {
          DRIVER_SIG = "x"; loadDriverActivity(); PUB.at = 0; PUB.n = 0; PUB.dirty = {};
          toast("Schedule published · " + r.pushed.length + " driver tab(s)");
        });
      })
      .catch(function (err) { toast(err.message, true); })
      .then(function () { t.disabled = false; var b = $("#push-driver-tabs"); if (b) b.disabled = false; });
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
      closeModal(); AUTOSTAGE_OFF = true;
      return reload().then(function () { toast(r.created + " orders added"); });
    }).catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.id === "group-btn") { groupMerge(); return; }
  if (t.id === "add-truck") { addTruckModal(); return; }
  if (t.id === "add-driver") { addDriverModal(); return; }
  if (t.id === "modal-save-driver") {
    var dv = {};
    [].forEach.call(document.querySelectorAll("#modal [data-cf]"), function (f) { dv[f.dataset.cf] = f.value.trim(); });
    if (!dv.full_name) { toast("Full name is required", true); return; }
    var dup = (DB.drivers || []).filter(function (d) { return String(d.full_name || "").trim().toLowerCase() === dv.full_name.toLowerCase(); })[0];
    if (dup) { toast(dv.full_name + " is already a driver", true); return; }
    api("driver", { full_name: dv.full_name }).then(function (row) {
      var id = row && row.id, steps = Promise.resolve();
      if (id && dv.employee_no) steps = steps.then(function () { return api("driver/employee-no", { driver_id: id, employee_no: dv.employee_no }); });
      if (id && dv.phone) steps = steps.then(function () { return api("driver/phone", { driver_id: id, phone: empTidyPhone(dv.phone) }); });
      return steps;
    }).then(function () { EMP.at = 0; }).then(reload).then(function () { closeModal(); toast(dv.full_name + " added. Put them on a truck from the Truck box below."); })
      .catch(function (err) { toast(err.message, true); });
    return;
  }
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
      closeModal(); AUTOSTAGE_OFF = true;
      return reload().then(function () {
        toast(r.created + " numbers reserved (" + r.first + "…" + r.last + ")");
      });
    }).catch(function (e) { toast(e.message, true); });
    return;
  }
  if (t.dataset.tsort) {
    var tp = t.dataset.tsort.split("|"), tg = TSORT_GROUP[tp[0]], cur = TSORT[tg];
    if (!cur || cur.key !== tp[1]) TSORT[tg] = { key: tp[1], dir: 1 };
    else if (cur.dir === 1) cur.dir = -1;
    else delete TSORT[tg];
    TRACKER_COLLAPSED_OPEN[tg] = true;   // sorting a closed list opens it so the result is visible
    delete TRACKER_COLLAPSED_SHOWN[tg];
    render(); return;
  }
  if (t.dataset.trackerCollapse) {
    var tck = t.dataset.trackerCollapse;
    TRACKER_COLLAPSED_OPEN[tck] = !TRACKER_COLLAPSED_OPEN[tck];
    // Collapsing again resets how many rows would show next time (D235) —
    // reopening a group always starts back at one page, not wherever
    // "Show more" had grown it to.
    if (!TRACKER_COLLAPSED_OPEN[tck]) delete TRACKER_COLLAPSED_SHOWN[tck];
    motionCollapse(t, tck, !TRACKER_COLLAPSED_OPEN[tck]); return;
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
    var doneSelBtn = $("#bill-done-sel"); if (doneSelBtn) doneSelBtn.textContent = "Mark Billed (" + GROUP.length + ")";
    var combSelBtn = $("#bill-combine-sel"); if (combSelBtn) combSelBtn.textContent = "Combine Into One PDF (" + GROUP.length + ")";
  }
  if (e.target.id === "dv-pick") { DRIVER_VIEW = e.target.value; render(); }
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
      var o = order(ov.id); if (o && row) { for (var rk in row) o[rk] = row[rk]; patchOrderLocal(ov.id, null); }
      applyOrderFkDenorm(o, ofield, onext);
      // Repaint just the STAGED rail (its own DOM subtree, untouched by the
      // tracker grid) so a chip already visible there picks up the new name
      // right away — not a full render(), which would rebuild the very
      // <select> being tabbed through and break tab-through (D84).
      renderRail();
      // The same box can be on screen twice (the tracker row and the open side window): keep the other copy in step.
      [].forEach.call(document.querySelectorAll('[data-oedit="' + ov.id + '"][data-field="' + ofield + '"]'), function (twin) {
        if (twin === e.target || twin === document.activeElement || twin.dataset.smartdate !== undefined) return;
        if (twin.type === "checkbox") twin.checked = !!onext; else if (twin.value !== String(onext == null ? "" : onext)) twin.value = onext == null ? "" : onext;
      });
      // The chip shows several of these fields (TARP flag, order and load
      // numbers, pallets…): repaint every copy of it, and the one at the top
      // of an open side window, so a change appears right away.
      var onSched = schedValueForOrder(ov.id);
      if (onSched) repaintCell(onSched.key);
      refreshDrawerChipPreview();
      // Bag Orders is auto-sorted by order # (D156) — reposition the row's
      // <tr> in place rather than a full render(), same tab-through concern.
      if (ofield === "rexius_order_no" && o && o.kind === "internal") resortInternalTrackerRow(ov.id);
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
  if (e.target.id === "pref-mono-select") {
    setPref("monoFont", e.target.value); render();
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
// What a dropped file is, judged from its name. "" = no clue (the window asks). Anchored on word boundaries so "inv" doesn't match "Inventory" (D82).
function dropDocType(name, o) {
  return /pod|bol|signed/i.test(name) ? "pod" :
    /delivery.?receipt|driver.?receipt|unsigned.?receipt/i.test(name) ? "delivery_receipt" :
    /invoice|\binv\b/i.test(name) ? "invoice" :
    /ratecon|\brate\b|\brc\b/i.test(name) ? "rate_con" :
    o && o.kind === "internal" ? "delivery_receipt" : "";
}
// Files with no clue in their name: say what each one is. Resolves the chosen types, or null if cancelled.
function docTypeChooser(files, guesses) {
  return new Promise(function (resolve) {
    var opts = [["rate_con", "Rate Con"], ["pod", "POD / BOL"], ["invoice", "Invoice"], ["other", "Other"]];
    var rows = files.map(function (f, i) {
      return '<tr><td><div class="cell">' + esc(f.name) + '</div></td><td style="width:150px"><div class="cell"><select data-dtype="' + i + '" class="cell-i">' +
        opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === (guesses[i] || "other") ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></div></td></tr>";
    }).join("");
    openModal('<div class="modal-hd"><h2>What are these?</h2></div><div class="modal-body"><p style="margin:0 0 10px;color:var(--ink-2)">The file names don&rsquo;t say. Pick what each one is; a rate con can then be signed or read from its row.</p>' +
      '<table class="data" style="min-width:0"><tbody>' + rows + '</tbody></table></div><div class="modal-ft"><button class="btn" id="dtype-cancel" type="button">Cancel</button><span style="flex:1"></span><button class="btn pri" id="dtype-go" type="button">Attach</button></div>');
    $("#dtype-cancel").onclick = function () { closeModal(); resolve(null); };
    $("#dtype-go").onclick = function () { var out = files.map(function (f, i) { return $('#modal [data-dtype="' + i + '"]').value; }); closeModal(); resolve(out); };
  });
}
$("#file-doc").addEventListener("change", function () {
  var oid = DRAWER_OID, files = [].slice.call(this.files); this.value = "";
  if (!oid || !files.length) return;
  var targetOrder = order(oid), guesses = files.map(function (f) { return dropDocType(f.name, targetOrder); });
  (guesses.some(function (g) { return !g; }) ? docTypeChooser(files, guesses) : Promise.resolve(guesses)).then(function (types) {
    if (!types) return;
    return Promise.all(files.map(function (f, i) {
      return fileB64(f).then(function (b64) { return api("document", { order_id: oid, doc_type: types[i], filename: f.name, b64: b64, matched_by: "manual" }); });
    })).then(reload).then(function () { openOrder(oid); toast(files.length + " document(s) attached"); });
  }).catch(function (e2) { toast(e2.message, true); });
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
  queueDrawerSave(function () { return api("order/update", v); }).then(function (row) { patchOrderLocal(saveOid, row); }).then(reload).then(function () {
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
      patchOrderLocal(oid, row);
      render(); refreshDrawerChipPreview(); refreshDrawerTitle(oid);
      histPush("edit department",
        function () { return orderFieldSet(oid, "transfer_department_id", prev); },
        function () { return orderFieldSet(oid, "transfer_department_id", next); });
    })
    .catch(function (err) { toast(err.message, true); });
}, true);
/* Employee # and Phone (Fleet, and the spare-drivers list): saved when you leave the box. A refused number (already someone else's) puts the old one back.
   A ten-digit phone is tidied to (541) 555-0123; anything else is kept as typed. */
function empTidyPhone(v) {
  var d = String(v).replace(/\D/g, "");
  if (d.length === 11 && d.charAt(0) === "1") d = d.slice(1);
  return d.length === 10 && !/[a-z]/i.test(v) ? "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6) : String(v).trim();
}
document.addEventListener("blur", function (e) {
  var i = e.target.closest && e.target.closest("[data-empno],[data-empphone]");
  if (!i) return;
  var phone = i.dataset.empphone != null, id = phone ? i.dataset.empphone : i.dataset.empno, was = i.dataset.was || "";
  var now = phone ? empTidyPhone(i.value) : i.value.trim();
  var sel = phone ? '[data-empphone="' + id + '"]' : '[data-empno="' + id + '"]';
  var done = function () { if (EMP.pending && !empBusy()) { EMP.pending = false; render(); } };
  if (now === was) { i.value = was; done(); return; }
  var body = { driver_id: id }; body[phone ? "phone" : "employee_no"] = now;
  api(phone ? "driver/phone" : "driver/employee-no", body).then(function (r) {
    var saved = (r && (phone ? r.phone : r.employee_no)) || "", map = phone ? EMP.phone : EMP.by;
    if (saved) map[id] = saved; else delete map[id];
    EMP.at = Date.now();
    [].forEach.call(document.querySelectorAll(sel), function (x) { x.value = saved; x.dataset.was = saved; });
    toast(phone ? (saved ? "Phone saved" : "Phone cleared") : (saved ? "Employee # saved" : "Employee # cleared"));
    var setTo = function (v) {
      var b = { driver_id: id }; b[phone ? "phone" : "employee_no"] = v;
      return api(phone ? "driver/phone" : "driver/employee-no", b).then(function (r2) {
        var sv = (r2 && (phone ? r2.phone : r2.employee_no)) || "";
        if (sv) map[id] = sv; else delete map[id];
        EMP.at = Date.now();
        [].forEach.call(document.querySelectorAll(sel), function (x) { x.value = sv; x.dataset.was = sv; });
      });
    };
    histPush(phone ? "edit phone" : "edit employee number", function () { return setTo(was); }, function () { return setTo(saved); });
  }).catch(function (err) { i.value = was; toast(err.message, true); }).then(done);
}, true);
/* Keys in those boxes, like a sheet: Tab goes to the next box (Employee # then Phone, then the next driver; Shift+Tab goes back), Enter and the
   up/down arrows move down and up the same column, Esc puts the old value back. */
document.addEventListener("keydown", function (e) {
  var i = e.target.closest && e.target.closest("[data-empno],[data-empphone]");
  if (!i) return;
  var wrap = i.closest("#main") || document, all = [].slice.call(wrap.querySelectorAll("input[data-empno],input[data-empphone]"));
  var same = all.filter(function (x) { return (x.dataset.empno != null) === (i.dataset.empno != null); });
  var go = null;
  if (e.key === "Tab") go = all[all.indexOf(i) + (e.shiftKey ? -1 : 1)];
  else if (e.key === "Enter" || e.key === "ArrowDown") go = same[same.indexOf(i) + 1];
  else if (e.key === "ArrowUp") go = same[same.indexOf(i) - 1];
  else if (e.key === "Escape") { i.value = i.dataset.was || ""; i.blur(); return; }
  else return;
  e.preventDefault(); e.stopPropagation();
  if (go) { go.focus(); go.select(); } else i.blur();
}, true);
/* Fleet driver name (D45) — free-text; on blur:
   - unchanged: nothing happens;
   - cleared: the truck is unassigned (the driver stays, in "Drivers without a truck");
   - the name of ANOTHER existing driver: that driver is put on this truck;
   - any other new name on a truck that has a driver: that driver is RENAMED (it used to create a new driver and unassign the old one);
   - a truck with no driver: the named driver is created / assigned.
   Every case is one undo step. */
document.addEventListener("blur", function (e) {
  var i = e.target.closest && e.target.closest("[data-truckdriver]");
  if (!i) return;
  var tid = i.dataset.truckdriver, prev = i.defaultValue || "", next = i.value.trim();
  if (next === prev.trim()) { i.value = prev; return; }
  var t = truckById(tid), cur = t && t.driver_id ? t.driver_id : "";
  var low = next.toLowerCase();
  var other = next ? (DB.drivers || []).filter(function (d) { return d.id !== cur && String(d.full_name || "").trim().toLowerCase() === low; })[0] : null;
  var assign = function (name) { return api("truck/driver", { truck_id: tid, driver_name: name }); };
  var rename = function (name) { return api("row", { table: "drivers", id: cur, values: { full_name: name } }); };
  var renaming = !!(cur && next && !other);
  var doIt = renaming ? function () { return rename(next); } : function () { return assign(next); };
  var undoIt = renaming ? function () { return rename(prev.trim()); } : function () { return assign(prev.trim()); };
  doIt().then(reload).then(function () {
    histPush(renaming ? "rename driver" : "change truck driver",
      function () { return undoIt().then(reload); },
      function () { return doIt().then(reload); });
  }).catch(function (err) { i.value = prev; toast(err.message, true); });
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
/* Driver Tabs: click a typed or empty slot to write in it. Saves exactly like
   the Scheduler and Current Week do (scheduleNote), so all three windows show
   the same text. Enter saves, Escape cancels. */
document.addEventListener("click", function (e) {
  var cell = e.target.closest && e.target.closest(".dv-typed");
  if (!cell || e.target.closest("textarea, a, button")) return;
  var key = cell.dataset.key, cur = CELLS[key];
  var ta = document.createElement("textarea");
  ta.className = "dv-note dv-inline"; ta.dataset.notekey = key; ta.placeholder = "Note";
  ta.value = (cur && cur.text) || ""; ta.dataset.was = ta.value;
  cell.innerHTML = ""; cell.appendChild(ta); ta.focus();
});
document.addEventListener("keydown", function (e) {
  var ta = e.target.closest && e.target.closest(".dv-inline");
  if (!ta) return;
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ta.blur(); }
  else if (e.key === "Escape") { e.preventDefault(); ta.value = ta.dataset.was; ta.blur(); }
});
document.addEventListener("blur", function (e) {
  var ta = e.target.closest && e.target.closest(".dv-inline");
  // Unchanged: nothing is saved, so put the plain chip back ourselves.
  if (ta && ta.value.trim() === ta.dataset.was.trim()) setTimeout(function () { repaintDvSlot(ta.dataset.notekey); }, 0);
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

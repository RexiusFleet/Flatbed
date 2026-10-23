/* ═══ 06-modals-grids ═══ */
/* ── Modal + Add-customer popup (D46) ────────────────────────────────────── */
function openModal(html) {
  var m = $("#modal");
  if (!m) { m = document.createElement("div"); m.id = "modal"; document.body.appendChild(m); }
  delete m.dataset.keyConfirming; m.classList.remove("route-modal", "wide-modal", "sync-modal", "rpt-modal");
  m.innerHTML = '<div class="modal-card">' + html + "</div>";
  m.classList.add("on"); $("#scrim").classList.add("on");
}
/* ── Pickup / Drop in the side window ─────────────────────────────────────
   A small spreadsheet: one numbered row per stop. Column 1 is the number (click it to select the row, then
   press Delete), column 2 a Pick | Drop toggle, column 3 the Pick/Drop List search (name, with the full
   address under it), column 4 a free-text appointment. Every order opens with a Pick on top (locked) and a
   Drop under it; "+ Add Stop" adds a Drop row that can be flipped to a Pick. Every edit saves right away. */
var ROUTE_SEL = null;   // { oid, i }: the highlighted row
function drawerRouteStops(o) {
  if (o.route_mode === "custom") return orderStops(o.id).map(function (s) {
    return { stop_type: s.stop_type, location_id: s.location_id, reference_number: s.reference_number || "", appt: s.notes || "",
      scheduled_at: s.scheduled_at, appointment_required: s.appointment_required, pallet_count: s.pallet_count };
  });
  return [
    { stop_type: "pickup", location_id: o.pickup_location_id, reference_number: o.po_number || "", appt: o.pick_appt_text || "" },
    { stop_type: "delivery", location_id: o.delivery_location_id, reference_number: o.delivery_number || "", appt: o.drop_appt_text || "" }
  ];
}
function routeValid(stops) {
  return stops.length >= 2 && stops[0].stop_type === "pickup" && stops.some(function (s) { return s.stop_type === "delivery"; });
}
// Full address on one line: street, city, state and ZIP.
function routeAddr(l) {
  if (!l) return "";
  var cs = [l.city, l.state].filter(Boolean).join(", ");
  return [l.address, [cs, l.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}
function routeSectionHtml(o, sug, locked) {
  var oid = o.id, stops = drawerRouteStops(o), custom = o.route_mode === "custom";
  // Delivered/billed multi-stop routes are read-only (the database protects history). A normal order stays editable.
  if (locked && custom) {
    return '<div class="route-summary">' + stops.map(function (s, i) {
      var l = s.location_id ? locById(s.location_id) : null;
      return '<span><strong>' + (i + 1) + " " + (s.stop_type === "pickup" ? "PICK" : "DROP") + "</strong> " + esc(l ? l.name : "— location needed —") +
        (l && routeAddr(l) ? ", " + esc(routeAddr(l)) : "") + (s.appt ? ' · <i>' + esc(s.appt) + "</i>" : "") + "</span>"; }).join("") + "</div>";
  }
  var sel = ROUTE_SEL && ROUTE_SEL.oid === oid && ROUTE_SEL.i < stops.length ? ROUTE_SEL.i : null;
  var prefilled = !custom && ((!o.pickup_location_id && sug.pickup) || (!o.delivery_location_id && sug.delivery));
  var h = '<div class="grid-wrap route-wrap"><table class="data route-tbl"><thead><tr><th class="rowgut-h" style="width:34px">#</th>' +
    '<th style="width:104px">Type</th><th>Pick / Drop</th><th style="width:30%">Appointment</th></tr></thead><tbody>';
  stops.forEach(function (st, i) {
    var l = st.location_id ? locById(st.location_id) : null, isP = st.stop_type === "pickup", lockType = i === 0 || locked;
    var field = custom ? "stop:" + i : (i === 0 ? "pickup_location_id" : "delivery_location_id");
    var suggest = custom ? null : (i === 0 ? sug.pickup : sug.delivery);
    var canDrag = i >= 1 && !locked;
    h += '<tr class="rt-row' + (sel === i ? " rt-sel" : "") + '" data-rtrow="' + i + '"><td class="rowgut' + (sel === i ? " on" : "") + (canDrag ? " rt-drag" : "") + '" data-rtsel="' + i + '"' +
      (canDrag ? ' draggable="true" title="Click to select this row, drag to reorder"' : ' title="Click to select this row"') + ">" + (i + 1) + "</td>" +
      '<td class="rt-type"><div class="rt-seg" role="group" aria-label="Stop ' + (i + 1) + ' type">' +
        '<button type="button" class="' + (isP ? "on" : "") + '" data-routetype="' + i + '|pickup"' + (lockType ? " disabled" : "") + ">Pick</button>" +
        '<button type="button" class="' + (!isP ? "on" : "") + '" data-routetype="' + i + '|delivery"' + (lockType ? " disabled" : "") + ">Drop</button></div></td>" +
      '<td class="rt-loc">' + locCombo(oid, field, st.location_id, suggest) +
        (l && routeAddr(l) ? '<div class="rt-addr">' + esc(routeAddr(l)) + "</div>" : "") + "</td>" +
      '<td class="rt-appt"><input class="cell-i" type="text" maxlength="120" data-stopappt="' + i + '" placeholder="e.g. 10/8 7-9 AM" value="' + esc(st.appt || "") + '">' +
        "</td></tr>";
  });
  h += "</tbody></table></div>";
  if (!locked) {
    h += '<div class="rt-tools"><button class="btn sm" data-stop-add="1">+ Add Stop</button>' +
      '<span class="rt-hint">' + (sel != null ? "Row " + (sel + 1) + " selected: press Delete to remove it" : "Drag a row number to reorder, or click it and press Delete") + "</span></div>";
  } else {
    h += '<div class="note-bar" style="margin-top:7px">This order is delivered or billed, so its route is locked: no extra stops. Open an order that is not delivered yet to add stops.</div>';
  }
  if (prefilled) h += '<div class="note-bar" style="margin-top:7px">Prefilled from the rate con — confirm each or pick from the list.</div>';
  return h;
}
// Re-open the side window without losing the scroll position or where the cursor was (Tab after picking a
// location lands in that row's Appt box and stays there, with anything already typed).
function routeReopen(oid, focusSel) {
  var body = document.querySelector("#drawer .dw-body"), top = body ? body.scrollTop : 0, keep = null;
  var ae = document.activeElement;
  if (ae && ae.closest && ae.closest("#drawer")) {
    if (ae.getAttribute("data-stopappt") != null) keep = { sel: '[data-stopappt="' + ae.getAttribute("data-stopappt") + '"]', val: ae.value, pos: ae.selectionStart };
    else if (ae.getAttribute("data-loccombo") != null) {
      var m = /^stop:(\d+)$/.exec(ae.getAttribute("data-loccombo")), ri = m ? m[1] : (ae.getAttribute("data-loccombo") === "pickup_location_id" ? "0" : ae.getAttribute("data-loccombo") === "delivery_location_id" ? "1" : null);
      if (ri != null) keep = { sel: '[data-stopappt="' + ri + '"]' };   // still in the location box: carry on to this row's Appt
    }
  }
  openOrder(oid);
  var nb = document.querySelector("#drawer .dw-body"); if (nb) nb.scrollTop = top;
  var target = focusSel || (keep && keep.sel);
  if (target) {
    var el = document.querySelector(target);
    if (el) {
      el.focus({ preventScroll: true });
      if (keep && keep.val != null && !focusSel) { el.value = keep.val; try { el.setSelectionRange(keep.pos, keep.pos); } catch (x) {} }
    }
  }
}
// Save a changed list of stops right away (every edit saves). sel = the row to keep highlighted afterwards.
function routeApply(oid, stops, sel, focusSel) {
  stops[0].stop_type = "pickup";
  if (!routeValid(stops)) { toast("A route needs a Pick first and at least one Drop.", true); routeReopen(oid); return; }
  ROUTE_SEL = sel == null ? null : { oid: oid, i: sel };
  saveDrawerRoute(oid, stops, focusSel);
}
function saveDrawerRoute(oid, stops, focusSel) {
  var simple = stops.length === 2 && stops[0].stop_type === "pickup" && stops[1].stop_type === "delivery";
  var clean = stops.map(function (s) {
    return { stop_type: s.stop_type, location_id: s.location_id || null, reference_number: s.reference_number || "",
      scheduled_at: s.scheduled_at || null, appointment_required: !!s.appointment_required,
      pallet_count: s.pallet_count == null ? "" : s.pallet_count, notes: simple ? "" : (s.appt || "") };
  });
  api("order/route", { order_id: oid, stops: clean, route_mode: simple ? "simple" : "custom" })
    .then(function () { return simple ? api("order/update", { id: oid, pick_appt_text: stops[0].appt || "", drop_appt_text: stops[1].appt || "" }) : null; })
    .then(reload)
    .then(function () { routeReopen(oid, focusSel); })
    .catch(function (err) { toast(err.message, true); routeReopen(oid); });
}
// A location picked in one of the stop boxes ("stop:<index>").
function drawerStopPick(oid, field, locId) {
  var o = order(oid); if (!o) return;
  var i = +field.split(":")[1], w = drawerRouteStops(o); if (!w[i]) return;
  w[i].location_id = locId;
  routeApply(oid, w, ROUTE_SEL && ROUTE_SEL.oid === oid ? ROUTE_SEL.i : null);
}
function routeDeleteSelected() {
  var o = DRAWER_OID && order(DRAWER_OID); if (!o || !ROUTE_SEL || ROUTE_SEL.oid !== o.id) return;
  var w = drawerRouteStops(o), i = ROUTE_SEL.i;
  if (i < 1) { toast("The first row is always the Pick.", true); return; }
  if (w.length <= 2) { toast("A route needs a Pick and a Drop, so the last two rows stay.", true); return; }
  w.splice(i, 1); routeApply(o.id, w, null);
}
document.addEventListener("click", function (e) {
  if (!DRAWER_OID) return;
  var o = order(DRAWER_OID); if (!o) return;
  var g = e.target.closest && e.target.closest("[data-rtsel]");
  if (g) { var gi = +g.getAttribute("data-rtsel"); ROUTE_SEL = ROUTE_SEL && ROUTE_SEL.oid === o.id && ROUTE_SEL.i === gi ? null : { oid: o.id, i: gi }; routeReopen(o.id); return; }
  var add = e.target.closest && e.target.closest("[data-stop-add]");
  if (add) {
    var w = drawerRouteStops(o); w.push({ stop_type: "delivery", location_id: null, reference_number: "", appt: "" });
    routeApply(o.id, w, null, '[data-loccombo="stop:' + (w.length - 1) + '"]');
    return;
  }
  var ty = e.target.closest && e.target.closest("[data-routetype]");
  if (ty && !ty.disabled) {
    var pr = ty.getAttribute("data-routetype").split("|"), w2 = drawerRouteStops(o);
    if (w2[+pr[0]] && w2[+pr[0]].stop_type !== pr[1]) { w2[+pr[0]].stop_type = pr[1]; routeApply(o.id, w2, ROUTE_SEL && ROUTE_SEL.oid === o.id ? ROUTE_SEL.i : null); }
    return;
  }
});
/* Drag a row number to move that stop (never above the first Pick). */
var RT_DRAG = null;
document.addEventListener("dragstart", function (e) {
  var g = e.target.closest && e.target.closest("td.rt-drag[data-rtsel]"); if (!g || !DRAWER_OID) return;
  RT_DRAG = { oid: DRAWER_OID, i: +g.getAttribute("data-rtsel") };
  e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", "route-row"); } catch (x) {}
  g.closest("tr").classList.add("rt-dragging");
});
document.addEventListener("dragover", function (e) {
  if (!RT_DRAG) return;
  var tr = e.target.closest && e.target.closest("tr[data-rtrow]"); if (!tr || +tr.getAttribute("data-rtrow") < 1) return;
  e.preventDefault(); e.dataTransfer.dropEffect = "move";
  [].forEach.call(document.querySelectorAll(".rt-over"), function (x) { x.classList.remove("rt-over"); });
  tr.classList.add("rt-over");
});
document.addEventListener("drop", function (e) {
  if (!RT_DRAG) return;
  var tr = e.target.closest && e.target.closest("tr[data-rtrow]"), d = RT_DRAG; RT_DRAG = null;
  [].forEach.call(document.querySelectorAll(".rt-over,.rt-dragging"), function (x) { x.classList.remove("rt-over", "rt-dragging"); });
  var o = order(d.oid); if (!tr || !o || d.oid !== DRAWER_OID) return;
  var j = +tr.getAttribute("data-rtrow"), w = drawerRouteStops(o);
  if (j < 1 || j === d.i || !w[d.i]) return;
  e.preventDefault();
  var moved = w.splice(d.i, 1)[0]; w.splice(j, 0, moved);
  routeApply(d.oid, w, j);
});
document.addEventListener("dragend", function () {
  RT_DRAG = null; [].forEach.call(document.querySelectorAll(".rt-over,.rt-dragging"), function (x) { x.classList.remove("rt-over", "rt-dragging"); });
});
document.addEventListener("change", function (e) {
  if (!DRAWER_OID) return;
  var o = order(DRAWER_OID); if (!o) return;
  var ap = e.target.closest && e.target.closest("[data-stopappt]");
  if (!ap) return;
  var i = +ap.getAttribute("data-stopappt"), text = ap.value.trim();
  if (o.route_mode !== "custom") {
    apptSet(o.id, i === 0 ? "pick" : "drop", text).then(function () {
      var found = schedValueForOrder(o.id); if (found) repaintCell(found.key);
      refreshDrawerChipPreview();
    }).catch(function (err) { toast(err.message, true); });
    return;
  }
  var w4 = drawerRouteStops(o); if (!w4[i]) return; w4[i].appt = text;
  routeApply(o.id, w4, ROUTE_SEL && ROUTE_SEL.oid === o.id ? ROUTE_SEL.i : null);
});
function closeModal() { var m = $("#modal"); if (m) m.classList.remove("on"); $("#scrim").classList.remove("on"); }
/* Database sorting has two modes: clicking a column name sorts this browser's view only; Save Order
   (shown while a sort is active) makes that order the default for everyone who opens this database. */
function saveDatabaseOrder(grid) {
  var ent = entityForGrid(grid), cur = GRIDSORT[grid]; if (!ent || !cur) return;
  var field = sortableFields(ent, grid).filter(function (f) { return f.id === cur.fieldId; })[0];
  if (!field) return;
  var rows = storedOrderRows(ent.kind === "custom" ? recordRows(ent.id) : builtinRows(ent.slug), grid, ent);
  var ids = sortRowsBy(rows, field, cur.dir).map(function (row) { return rowIdForEntity(row, ent); });
  confirmModal('Save “' + field.label + '” ' + (cur.dir === "asc" ? 'A → Z' : 'Z → A') +
    ' as the default row order for this database, for everyone?', function () {
      api("grid/row/reorder", { grid: grid, row_ids: ids,
        archived_view: archiveViewForGrid(grid) }).then(function () {
        delete GRIDSORT[grid]; toast("Saved row order"); return reload();
      }).catch(function (err) { toast(err.message, true); });
    }, "Save row order");
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
    (existing ? '<button class="btn del" id="daynote-clear" style="margin-right:auto">Delete note</button>' : "") +
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
function confirmModal(message, onYes, confirmLabel, primary) {
  openModal('<div class="modal-hd"><h2>Are you sure?</h2></div>' +
    '<div class="modal-body"><p style="line-height:1.5;margin:0">' + esc(message) + "</p></div>" +
    '<div class="modal-ft"><span style="flex:1"></span>' +
    '<button class="btn" id="modal-cancel">Cancel</button>' +
    '<button class="btn ' + (primary ? "pri" : /^delete/i.test(confirmLabel || "Delete") ? "del" : "bad") + '" id="modal-confirm">' + esc(confirmLabel || "Delete") + "</button></div>");
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
  var yes = modal.querySelector("#modal-confirm,#confirm-del,#confirm-archive-delete,#confirm-customer-archive,#history-confirm");
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
/* Help & FAQ — a profile-menu popup, not a settings tab. Reuses settingsHelp()'s same card
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
/* Sorts whatever was typed into the right boxes of the Add Location form: the company name, the street
   (anything that starts with a number), the city, the state and the ZIP. It reads from the right: a 5-digit
   number is the ZIP, a state abbreviation just before it is the state, and the city is whatever follows the
   street (the street ends at its street word: St, Ave, Rd, Hwy and so on, plus a highway number). It only
   fills the boxes; everything stays editable. */
var US_STATES = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" ");
var STREET_WORD = /^(st|street|ave|avenue|av|rd|road|hwy|highway|blvd|boulevard|way|dr|drive|ln|lane|ct|court|pkwy|parkway|pl|place|cir|circle|loop|trl|trail|sq|square|ter|terrace|rte|route|fwy|freeway|expy)\.?,?$/i;
function parseLocationText(text) {
  var out = { name: "", address: "", city: "", state: "", zip: "" };
  var rest = String(text || "").replace(/\s+/g, " ").trim();
  if (!rest) return out;
  var m = /(?:^|[\s,])(\d{5})(?:-\d{4})?$/.exec(rest);
  if (m) { out.zip = m[1]; rest = rest.slice(0, m.index).replace(/[\s,]+$/, ""); }
  m = /(?:^|[\s,])([A-Za-z]{2})$/.exec(rest);
  if (m && US_STATES.indexOf(m[1].toUpperCase()) >= 0 && (out.zip || /,/.test(rest) || /\d/.test(rest) || (m[1] === m[1].toUpperCase() && /\s/.test(rest)))) {
    out.state = m[1].toUpperCase(); rest = rest.slice(0, m.index).replace(/[\s,]+$/, "");
  }
  var hasTail = !!(out.zip || out.state);
  if (/,/.test(rest)) {
    var parts = rest.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
    var ai = -1; parts.forEach(function (x, i) { if (ai < 0 && /^\d/.test(x)) ai = i; });
    if (ai >= 0) {
      out.name = parts.slice(0, ai).join(", "); out.address = parts[ai];
      var after = parts.slice(ai + 1); if (after.length) out.city = after.join(", ");
    } else if (hasTail && parts.length >= 2) { out.city = parts.pop(); out.name = parts.join(", "); }
    else out.name = parts.join(", ");
    return out;
  }
  var tok = rest.split(" "), ni = -1;
  tok.forEach(function (x, i) { if (ni < 0 && /^\d+[A-Za-z]?$/.test(x) && i + 1 < tok.length + 1) ni = i; });
  if (ni < 0) { if (hasTail && tok.length >= 2) { out.city = tok.pop(); } out.name = tok.join(" "); return out; }
  var street = tok.slice(ni), end = -1;
  for (var k = 1; k < street.length; k++) if (STREET_WORD.test(street[k])) { end = k; break; }
  // A number in the middle of a name ("Rexius Plant 3") is not an address unless a street word or a ZIP/state follows.
  if (ni > 0 && end < 0 && !hasTail) { out.name = tok.join(" "); return out; }
  out.name = tok.slice(0, ni).join(" ");
  if (end >= 0) {
    var e2 = end;
    if (street[e2 + 1] && /^(\d+|#\w+)$/.test(street[e2 + 1])) e2++;          // "Hwy 97"
    out.address = street.slice(0, e2 + 1).join(" ");
    if (street.length > e2 + 1) out.city = street.slice(e2 + 1).join(" ");
  } else out.address = street.join(" ");
  return out;
}
function addLocationModal(typedText, target) {
  MODAL_LOC_TARGET = target || null;
  var f = parseLocationText(typedText);
  var body = mfield("name", "Company name", "text", { value: f.name }) +
    mfield("address", "Address", "text", { value: f.address }) +
    mfield("city", "City", "text", { value: f.city }) + mfield("state", "State", "text", { value: f.state }) +
    mfield("postal_code", "ZIP", "text", { value: f.zip }) +
    mfield("phone", "Phone", "text") +
    mfield("appointment_note", "Appointment / dock hours", "text") +
    mfield("notes", "Notes", "text") + customFieldsHtml("pickdrop");
  openModal('<div class="modal-hd"><h2>Add pick/drop location</h2></div>' +
    '<div class="modal-body">' + body + "</div>" +
    '<div class="modal-ft"><button class="btn" id="modal-cancel">Cancel</button>' +
    '<button class="btn pri" id="modal-save-loc">Add Location</button></div>');
  // Put the cursor on the first box still empty so you can just keep typing.
  var first = ["name", "address", "city", "state", "postal_code"].filter(function (k) { return !f[k === "postal_code" ? "zip" : k]; })[0] || "name";
  setTimeout(function () { var el = document.querySelector('#modal [data-cf="' + first + '"]'); if (el) el.focus(); }, 0);
}

/* Add-truck popup (D57) — a fill-out window like the other Database grids,
   replacing the inline toolbar inputs. */
/* Drivers and trucks are added separately; a driver is then put on a truck from the truck's Driver box (or the Truck box in the spare-drivers list),
   and can be switched to another truck whenever. */
function addDriverModal() {
  var body = mfield("full_name", "Full Name", "text") + mfield("employee_no", "Employee #", "text") + mfield("phone", "Phone", "text");
  openModal('<div class="modal-hd"><h2>Add driver</h2></div><div class="modal-body">' + body + "</div>" +
    '<div class="modal-ft"><button class="btn" id="modal-cancel">Cancel</button>' +
    '<button class="btn pri" id="modal-save-driver">Add Driver</button></div>');
}
function addTruckModal() {
  var body = mfield("number", "Truck #", "text") +
    mfield("eq", "Type", "text") +
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
    'px;white-space:nowrap"' + dbSortAttr(grid, "custom:" + c.id) +
    ' title="Click to sort · Right-click to select the column or for options · Drag to reorder">' + esc(c.label) +
    dbSortArrow(grid, "custom:" + c.id) + "</th>";
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
    archive.disabled = !count;
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
    '<button class="btn del sm" data-orderdelrows="' + grid + '"' + (n ? "" : " disabled") + ">" +
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
  } else if (e.metaKey || e.ctrlKey || e.altKey) {
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
    '<div class="modal-ft">' + (col ? '<button class="btn del" id="col-delete" data-colid="' + col.id + '">Delete</button>' : "") +
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
/* How many loads already carry this customer/broker (the older ones only exist
   in memory once their dates have been loaded, so load them first). */
function renameLoadCount(partyId) {
  var count = function () {
    return (DB.orders || []).filter(function (o) { return o.broker_party_id === partyId || o.customer_party_id === partyId; }).length;
  };
  var n = count();
  if (n || !(DB && DB.history_cutoff)) return Promise.resolve(n);
  return ensureHistory().then(function () { return count(); }, function () { return count(); });
}
function commitEdit() {
  if (!EDITING) return;
  var td = EDITING.td, ta = td.querySelector(".cell-input"), val = ta ? ta.value.trim() : "";
  if (ta) ta.remove();
  td.classList.remove("editing"); EDITING = null;
  if (td.dataset.field) {
    var prevG = td.querySelector(".cell").textContent;
    if (val === prevG) return;
    var table = td.dataset.table, id = td.dataset.id, field = td.dataset.field, cellEl = td.querySelector(".cell");
    var apply = function () {
      cellEl.innerHTML = cellDisplayHtml(val);
      gridCellSet(table, id, field, val).then(function () {
        histPush("edit " + field,
          function () { return gridCellSet(table, id, field, prevG); },
          function () { return gridCellSet(table, id, field, val); });
      }).catch(function (e) { cellEl.innerHTML = cellDisplayHtml(prevG); toast(e.message, true); });
    };
    // Renaming a customer that already has loads changes those loads too:
    // ask first. A new or unused customer renames without a prompt.
    if (table === "parties" && field === "name" && val) {
      renameLoadCount(id).then(function (n) {
        if (!n) { apply(); return; }
        confirmModal("This will change the name on " + n + (n === 1 ? " previous order" : " previous orders") +
          " for “" + prevG + "”. Rename it to “" + val + "”?", apply, "Yes, Rename", true);
      });
      return;
    }
    apply();
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
/* ── Review window for a rate con or pasted load ──────────────────────────────────────────────────────────
   The reader never creates anything on its own: it opens this window with what it found (every box editable, ones it was unsure of
   outlined, ones it could not find empty), and only "Create Order" / "Fill In Order" puts it on an order. Cancel creates nothing. */
function afFindExisting(p) {
  return orders().filter(function (o) { return isExt(o) && !o.is_transfer && ((p.solomon && o.rexius_order_no === p.solomon) || (p.load_no && o.broker_load_no === p.load_no)); })[0] || null;
}
function afStopVal(p, which, k) { var s = p[which]; return s && s[k] ? s[k] : ""; }
/* The boxes of the review, shared by the small window (pasted text) and the wide window beside the PDF. */
function afFormHtml(p) {
  var conf = (p.rc && p.rc.conf) || {};
  function row(label, key, val, opts) {
    opts = opts || {};
    var low = opts.low || (val === "" || val == null ? false : conf[key] === "check");
    return "<label>" + esc(label) + '</label><div><input data-afr="' + key + '" value="' + esc(val == null ? "" : val) + '" placeholder="' + (opts.ph || "Not found") + '"' +
      (opts.list ? ' list="' + opts.list + '"' : "") + (low ? ' class="afr-check" title="The reader was not sure of this one. Check it."' : "") + ' autocomplete="off">' +
      (opts.hint ? '<div class="afr-hint" id="afr-hint-' + opts.hint + '"></div>' : "") + "</div>";
  }
  function stop(which, label) {
    var s = p[which], lowAll = s && s.conf === "check";
    return '<div class="afr-stop"><div class="sec-h">' + label + '</div><div class="afr-grid">' +
      ["name", "address", "city"].map(function (k) { return '<input data-afr="' + which + "." + k + '" value="' + esc(afStopVal(p, which, k)) + '" placeholder="' + { name: "Name", address: "Address", city: "City" }[k] + '"' + (lowAll ? ' class="afr-check"' : "") + ' autocomplete="off">'; }).join("") +
      '<div class="afr-row2"><input data-afr="' + which + '.state" value="' + esc(afStopVal(p, which, "state")) + '" placeholder="State" maxlength="2" autocomplete="off">' +
      '<input data-afr="' + which + '.zip" value="' + esc(afStopVal(p, which, "zip")) + '" placeholder="ZIP" autocomplete="off">' +
      '<input data-afr="' + which + '.appt" value="' + esc(afStopVal(p, which, "appt")) + '" placeholder="Appointment" autocomplete="off"></div></div>' +
      '<div class="afr-hint" id="afr-hint-' + which + '"></div></div>';
  }
  var brokers = brokerList().map(function (b) { return '<option value="' + esc(b.name) + '">'; }).join("");
  return '<datalist id="afr-brokers">' + brokers + "</datalist>" +
    '<div class="fields">' + row("Broker", "broker", p.broker || "", { list: "afr-brokers", hint: "broker" }) + row("Order #", "solomon", p.solomon || "", { ph: "Optional" }) +
    row("Load #", "load_no", p.load_no || "") + row("PU / PO", "po", p.po || "") +
    row("Rate", "rate", p.rate == null ? "" : "$" + Number(p.rate).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), { low: p.rate != null && (p.rate > 3000 || p.rate < 150) || (p.rate != null && conf.rate === "check") }) + "</div>" +
    stop("pickup", "Pickup") + stop("delivery", "Drop");
}
// Wires the boxes inside `root`: the hints under them, and collect() which returns the (possibly edited) values as the reader's own shape.
function afFormBind(root, p) {
  var q = function (k) { var e = root.querySelector('[data-afr="' + k + '"]'); return e ? e.value.trim() : ""; };
  function brokerHit(name) {
    var lc = String(name).toLowerCase(), exact = brokerList().filter(function (b) { return String(b.name).toLowerCase() === lc; })[0];
    if (exact) return { b: exact, how: "exact" };
    var f = name ? findBroker(name) : null; return f && f.broker ? { b: f.broker, how: "close" } : null;
  }
  function stopObj(which) {
    var s = { name: q(which + ".name"), address: q(which + ".address"), city: q(which + ".city"), state: q(which + ".state").toUpperCase(), zip: q(which + ".zip"), appt: q(which + ".appt"), conf: "ok" };
    return s.name || s.address || s.city || s.appt ? s : null;
  }
  function hints() {
    var bh = root.querySelector("#afr-hint-broker"), name = q("broker"), hit = name ? brokerHit(name) : null;
    if (bh) bh.textContent = !name ? "" : hit ? (hit.how === "exact" ? "Existing customer" : "Closest match: " + hit.b.name + ". It will be used.") : "A new customer will be added";
    ["pickup", "delivery"].forEach(function (w) {
      var el = root.querySelector("#afr-hint-" + w), s = stopObj(w); if (!el) return;
      var mt = s && (s.name || s.address) ? afMatchLocation(s) : null, loc = mt && locById(mt.id);
      el.textContent = !s ? "" : mt && loc ? "On the Pick/Drop List: " + (loc.name || "") + (loc.city ? ", " + loc.city : "") : s.name && s.city ? "A new location will be added to the Pick/Drop List" : "Needs a name and a city to be added; it will be left blank";
    });
  }
  hints();
  root.oninput = function (e) { if (e.target && e.target.dataset && e.target.dataset.afr) { e.target.classList.remove("afr-check"); hints(); } };
  return { hints: hints, collect: function () {
    var out = Object.assign({}, p), name = q("broker"), hit = name ? brokerHit(name) : null;
    out.broker = hit ? hit.b.name : name; out.broker_id = hit ? hit.b.id : undefined;
    out.solomon = q("solomon"); out.load_no = q("load_no"); out.po = q("po");
    var rt = q("rate").replace(/[^0-9.]/g, ""); out.rate = rt === "" || isNaN(Number(rt)) ? null : Number(rt);
    out.pickup = stopObj("pickup"); out.delivery = stopObj("delivery");
    return out;
  } };
}
function afReview(p, source) {
  return new Promise(function (resolve) {
    var ex = afFindExisting(p);
    var h = '<div class="modal-hd"><h2>Review ' + (source === "text" ? "Pasted Load Info" : "Rate Con") + '</h2></div><div class="modal-body af-review">' +
      (ex ? '<div class="note-bar" style="margin:0 0 10px">This matches order <b>' + esc(ex.rexius_order_no || ex.broker_load_no || "") + "</b>. Only its blank boxes will be filled in; nothing already on it is changed.</div>" :
        '<p class="afr-intro">Check what was read, fix anything, then create the order. Nothing is saved until you do.</p>') +
      afFormHtml(p) +
      '</div><div class="modal-ft"><button class="btn" id="afr-cancel" type="button">Cancel</button><span style="flex:1"></span>' +
      '<button class="btn pri" id="afr-go" type="button">' + (ex ? "Fill In Order" : "Create Order") + "</button></div>";
    openModal(h); var m = $("#modal"); if (m) m.classList.add("wide-modal");
    var form = afFormBind(m, p);
    $("#afr-cancel").onclick = function () { closeModal(); resolve(null); };
    $("#afr-go").onclick = function () { var out = form.collect(); closeModal(); resolve(out); };
    setTimeout(function () { var f = $('#modal [data-afr="broker"]'); if (f) f.focus(); }, 0);
  });
}
/* ── Sign window: a rate con (or any PDF on an order) beside the boxes, with initials, date and text written into a copy ─────────
   Opens when a rate con is dragged in (instead of the small review window) and from the Sign button on a document. The PDF is on the
   left; on the right are what the reader found (for a rate con), every box editable; the tools put your initials, today's date or
   typed text wherever you click on the page. The signed copy is a new PDF (the original is never changed): drag the file chip out to
   the desktop or an email, or click it to save. Initials are set up once (typed in a script font, or drawn) and kept on this computer. */
var SGN = null, SGN_INK = "#0b1d5c";
function sgnToday() { var d = new Date(); return (d.getMonth() + 1) + "/" + d.getDate() + "/" + String(d.getFullYear()).slice(2); }
function sgnInitials() { try { return JSON.parse(localStorage.getItem("sgnInitials") || "null"); } catch (e) { return null; } }
function sgnSaveInitials(o) { try { localStorage.setItem("sgnInitials", JSON.stringify(o)); } catch (e) { /* private mode */ } }
function sgnTrim(cv) {
  var c = cv.getContext("2d"), w = cv.width, h = cv.height, d = c.getImageData(0, 0, w, h).data, x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 <= x0 || y1 <= y0) return null;
  var pad = 6, o = document.createElement("canvas"); o.width = x1 - x0 + 1 + pad * 2; o.height = y1 - y0 + 1 + pad * 2;
  o.getContext("2d").drawImage(cv, x0, y0, x1 - x0 + 1, y1 - y0 + 1, pad, pad, x1 - x0 + 1, y1 - y0 + 1);
  return { url: o.toDataURL("image/png"), w: o.width, h: o.height };
}
function sgnQ(s) { return SGN && SGN.el ? SGN.el.querySelector(s) : null; }
// opts: { kind: "intake" | "doc", bytes: Uint8Array, name, oid, doc }. Intake resolves { p, signed, scanned } or null (cancelled); doc mode resolves null when closed.
function sgnOpen(opts) {
  return new Promise(function (resolve) {
    sgnClose(true);
    var el = document.createElement("div"); el.className = "sgn"; el.id = "sgn";
    SGN = { el: el, kind: opts.kind, oid: opts.oid || null, doc: opts.doc || null, bytes: opts.bytes, name: opts.name, resolve: resolve, done: false, pdf: null, pages: [], scale: 1, fit: 1, tool: null,
      stamps: [], sel: null, words: [], parsed: null, form: null, nextId: 1, blobUrl: "", signedBytes: null, scanned: false, readDone: false, keep: true, timer: null, discard: false, reading: false, failed: "" };
    var intake = opts.kind === "intake", isRc = !!(opts.doc && opts.doc.doc_type === "rate_con");
    el.innerHTML = '<div class="sgn-hd"><div><h2>' + (intake ? "Review Rate Con" : "Sign " + esc(({ rate_con: "Rate Con", pod: "POD / BOL", invoice: "Invoice", delivery_receipt: "Delivery Receipt" })[opts.doc.doc_type] || "Document")) + '</h2><div class="sub">' + esc(opts.name) + "</div></div>" +
      '<span style="flex:1"></span><button class="btn" id="sgn-close" type="button">Close</button></div>' +
      '<div class="sgn-body"><div class="sgn-view"><div class="sgn-tools">' +
      '<button class="btn sm" data-sgntool="initials" type="button">Initials</button>' +
      '<button class="btn sm" id="sgn-setup" type="button" title="Type or draw your initials once; they are remembered on this computer">Set Up Initials</button><span class="sep"></span>' +
      '<button class="btn sm" data-sgntool="date" type="button">Date</button><button class="btn sm" data-sgntool="text" type="button">Text</button><span class="sep"></span>' +
      '<button class="btn sm" id="sgn-zout" type="button" title="Zoom out">&minus;</button><span id="sgn-zl" class="zl">100%</span><button class="btn sm" id="sgn-zin" type="button" title="Zoom in">+</button>' +
      '<span class="hint" id="sgn-hint"></span></div><div class="sgn-scroll" id="sgn-scroll"></div></div>' +
      '<div class="sgn-side"><div class="scroll" id="sgn-form"></div><div class="sgn-ft" id="sgn-ft-chip"></div><div class="sgn-ft" id="sgn-ft-btns"></div></div></div>';
    document.body.appendChild(el);
    sgnHint(); sgnFooter(); sgnChip();
    el.addEventListener("click", sgnClick); el.addEventListener("pointerdown", sgnPointer); el.addEventListener("dblclick", function (e) { var st = e.target.closest(".sgn-st"); if (st) sgnEditText(+st.dataset.id); });
    el.addEventListener("focusin", sgnFocus);
    // Keys are handled on the window itself and stop there, so the dashboard's own shortcuts behind it (Delete on a selected cell, Esc, typing into a cell) never see them.
    el.tabIndex = -1;
    el.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (!SGN) return;
      var ae = document.activeElement, typing = ae && (/INPUT|TEXTAREA|SELECT/.test(ae.tagName) || ae.isContentEditable);
      if (e.key === "Escape") { if (sgnQ("#sgn-pop")) sgnClosePop(); else if (SGN.tool) sgnArm(null); else sgnCancel(); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && SGN.sel && !typing) { sgnRemove(SGN.sel); e.preventDefault(); }
    });
    ["keyup", "keypress"].forEach(function (t) { el.addEventListener(t, function (e) { e.stopPropagation(); }); });
    setTimeout(function () { if (SGN && SGN.el === el) el.focus(); }, 0);
    var side = sgnQ("#sgn-form");
    side.innerHTML = isRc || intake ? '<p class="note"><span class="spin" style="display:inline-block;vertical-align:-2px;margin-right:6px"></span>Reading the rate con…</p>' :
      '<p class="note">Add your initials and date on the page, then save the signed copy on this order, or drag the file out. The original stays as it is.</p>' +
      '<p class="note" style="margin-top:12px">Is this a rate con you want read? <button class="btn sm" id="sgn-read" type="button">Read As Rate Con</button></p>';
    loadVendor("pdfjs").then(function () {
      loadVendor("pdflib").catch(function () {});   // ready for Save before it's clicked
      return pdfjsLib.getDocument({ data: opts.bytes.slice(0) }).promise;
    }).then(function (pdf) {
      SGN.pdf = pdf; var jobs = []; for (var i = 1; i <= pdf.numPages; i++) jobs.push(pdf.getPage(i)); return Promise.all(jobs);
    }).then(function (pgs) {
      if (!SGN) return;
      SGN.pages = pgs.map(function (pg) { return { pg: pg, vp1: pg.getViewport({ scale: 1 }) }; });
      sgnFit(); sgnPages();
      if (intake || isRc) sgnRead();
    }).catch(function (e) {
      if (!SGN) return; SGN.failed = e && e.message || "unreadable";
      sgnQ("#sgn-scroll").innerHTML = '<div class="empty" style="padding:30px;text-align:center;color:var(--ink-3)">This PDF could not be opened (' + esc(SGN.failed) + ").</div>";
      if (intake) { SGN.readDone = true; sgnShowForm({ broker: "", load_no: "", solomon: "", po: "", rate: null, pickup: null, delivery: null, rc: { conf: {} } }); }
    });
  });
}
function sgnClose(silent) {
  if (!SGN) return;
  var S = SGN; SGN = null;
  clearTimeout(S.timer); clearTimeout(S.discardT);
  if (S.blobUrl) URL.revokeObjectURL(S.blobUrl);
  if (S.el.parentNode) S.el.remove();
  if (!S.done && S.resolve) { S.done = true; S.resolve(null); }
}
function sgnCancel() {
  var S = SGN; if (!S) return;
  if (S.stamps.length && !S.discard) {
    S.discard = true; var b = sgnQ("#sgn-cancel"); if (b) b.textContent = "Discard Changes?";
    clearTimeout(S.discardT); S.discardT = setTimeout(function () { if (SGN === S) { S.discard = false; var b2 = sgnQ("#sgn-cancel"); if (b2) b2.textContent = S.kind === "intake" ? "Cancel" : "Close"; } }, 3500);
    return;
  }
  sgnClose();
}
function sgnHint() {
  var h = sgnQ("#sgn-hint"); if (!h) return;
  h.innerHTML = SGN.tool ? "Click on the page where the <b>" + (SGN.tool === "date" ? "date" : SGN.tool) + "</b> goes. Esc to cancel." : "Pick <b>Initials</b>, <b>Date</b> or <b>Text</b>, then click where it goes. Drag to move.";
}
function sgnFit() {
  var w = sgnQ("#sgn-scroll").clientWidth - 40, p = SGN.pages[0];
  SGN.fit = p ? Math.max(0.4, Math.min(1.6, w / p.vp1.width)) : 1; SGN.scale = SGN.fit; sgnQ("#sgn-zl").textContent = "100%";
}
function sgnZoom(mul) {
  var S = SGN; S.scale = Math.max(S.fit * 0.5, Math.min(S.fit * 2.5, S.scale * mul)); sgnQ("#sgn-zl").textContent = Math.round(S.scale / S.fit * 100) + "%"; sgnPages();
}
function sgnPages() {
  var S = SGN, sc = sgnQ("#sgn-scroll"); sc.innerHTML = "";
  S.pages.forEach(function (p, i) {
    var vp = p.pg.getViewport({ scale: S.scale }), box = document.createElement("div"), r = window.devicePixelRatio || 1;
    box.className = "sgn-page"; box.style.width = vp.width + "px"; box.style.height = vp.height + "px";
    var cv = document.createElement("canvas"); cv.width = Math.floor(vp.width * r); cv.height = Math.floor(vp.height * r); cv.style.width = vp.width + "px"; cv.style.height = vp.height + "px";
    var ov = document.createElement("div"); ov.className = "sgn-ov"; ov.dataset.page = i;
    box.appendChild(cv); box.appendChild(ov); sc.appendChild(box);
    p.pg.render({ canvasContext: cv.getContext("2d"), viewport: p.pg.getViewport({ scale: S.scale * r }) });
  });
  S.stamps.forEach(sgnDraw);
}
function sgnDraw(st) {
  var S = SGN, ov = S.el.querySelector('.sgn-ov[data-page="' + st.page + '"]'); if (!ov) return;
  var el = S.el.querySelector('.sgn-st[data-id="' + st.id + '"]'); if (el) el.remove();
  el = document.createElement("div"); el.className = "sgn-st" + (S.sel === st.id ? " sel" : ""); el.dataset.id = st.id;
  el.style.left = st.x * S.scale + "px"; el.style.top = st.y * S.scale + "px";
  if (st.type === "img") el.innerHTML = '<img alt="" src="' + st.dataUrl + '" style="width:' + st.w * S.scale + "px;height:" + st.h * S.scale + 'px">';
  else { el.style.fontSize = st.size * S.scale + "px"; el.textContent = st.text; }
  var x = document.createElement("span"); x.className = "x"; x.textContent = "×"; x.title = "Remove"; el.appendChild(x);
  ov.appendChild(el);
}
function sgnSelect(id) { SGN.sel = id; [].forEach.call(SGN.el.querySelectorAll(".sgn-st"), function (e) { e.classList.toggle("sel", +e.dataset.id === id); }); }
function sgnArm(tool) {
  var S = SGN; S.tool = S.tool === tool ? null : tool;
  [].forEach.call(S.el.querySelectorAll("[data-sgntool]"), function (b) { b.classList.toggle("active", b.dataset.sgntool === S.tool); });
  S.el.classList.toggle("arm", !!S.tool); sgnHint();
}
function sgnChanged() { SGN.discard = false; clearTimeout(SGN.timer); SGN.signedBytes = null; sgnChip(); SGN.timer = setTimeout(sgnRebuild, 300); }
function sgnPlace(pageIdx, cssX, cssY, keep) {
  var S = SGN, id = S.nextId++, st;
  if (S.tool === "initials") {
    var ini = sgnInitials(); if (!ini) { sgnArm(null); sgnSetup(); return; }
    var w = 70, h = Math.round(70 * ini.h / ini.w);
    st = { id: id, page: pageIdx, type: "img", dataUrl: ini.url, w: w, h: h, x: cssX / S.scale - w / 2, y: cssY / S.scale - h / 2 };
  } else st = { id: id, page: pageIdx, type: "text", text: S.tool === "date" ? sgnToday() : "Text", size: 12, x: cssX / S.scale - 2, y: cssY / S.scale - 7 };
  S.stamps.push(st); sgnDraw(st); sgnSelect(id);
  if (!keep) sgnArm(S.tool);
  if (st.type === "text" && st.text === "Text") sgnEditText(id);
  sgnChanged();
}
function sgnRemove(id) {
  var S = SGN; S.stamps = S.stamps.filter(function (s) { return s.id !== id; }); var el = S.el.querySelector('.sgn-st[data-id="' + id + '"]'); if (el) el.remove();
  if (S.sel === id) S.sel = null; sgnChanged();
}
function sgnEditText(id) {
  var S = SGN, el = S.el.querySelector('.sgn-st[data-id="' + id + '"]'), st = S.stamps.filter(function (s) { return s.id === id; })[0]; if (!el || !st || st.type !== "text") return;
  el.contentEditable = "true"; el.style.cursor = "text"; el.focus();
  var r = document.createRange(); r.selectNodeContents(el); var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  el.onblur = function () { el.contentEditable = "false"; el.style.cursor = ""; st.text = (el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild.nodeValue : "").trim() || " "; if (SGN === S) { sgnDraw(st); sgnChanged(); } };
  el.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); el.blur(); } e.stopPropagation(); };
}
function sgnPointer(e) {
  var S = SGN; if (!S) return;
  var st = e.target.closest(".sgn-st"), ov = e.target.closest(".sgn-ov");
  if (e.target.classList.contains("x")) { sgnRemove(+e.target.parentNode.dataset.id); return; }
  if (st && st.contentEditable !== "true") {
    var id = +st.dataset.id, s = S.stamps.filter(function (x) { return x.id === id; })[0]; sgnSelect(id);
    var sx = e.clientX, sy = e.clientY, ox = s.x, oy = s.y, moved = false;
    var mv = function (ev) { moved = true; s.x = ox + (ev.clientX - sx) / S.scale; s.y = oy + (ev.clientY - sy) / S.scale; st.style.left = s.x * S.scale + "px"; st.style.top = s.y * S.scale + "px"; };
    var up = function () { document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up); if (moved && SGN === S) sgnChanged(); };
    document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up); e.preventDefault(); return;
  }
  if (ov && S.tool) { var r = ov.getBoundingClientRect(); sgnPlace(+ov.dataset.page, e.clientX - r.left, e.clientY - r.top, e.shiftKey); return; }
  if (!st && ov) sgnSelect(null);
}
function sgnClick(e) {
  var S = SGN; if (!S) return;
  var t = e.target.closest("button, .sgn-chip.ready, [data-sgnmode]"); if (!t) return;
  if (t.dataset.sgntool) { if (t.dataset.sgntool === "initials" && !sgnInitials()) { sgnSetup(); return; } sgnArm(t.dataset.sgntool); return; }
  switch (t.id) {
    case "sgn-close": case "sgn-cancel": sgnCancel(); break;
    case "sgn-setup": sgnSetup(); break;
    case "sgn-zin": sgnZoom(1.2); break;
    case "sgn-zout": sgnZoom(1 / 1.2); break;
    case "sgn-read": sgnReadAsRateCon(); break;
    case "sgn-go": sgnGo(); break;
    case "sgn-fill": sgnFill(); break;
    case "sgn-save": sgnSaveCopy(); break;
  }
  if (t.classList.contains("sgn-chip") && S.blobUrl) sgnSaveFile();
}
/* The signed copy as a file chip: drag it out to the desktop or an email (Chrome and Edge), or click it to save. */
function sgnFileName() { return String(SGN.name || "document").replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]+/g, "-") + " signed.pdf"; }
function sgnChip() {
  var S = SGN; if (!S) return; var box = sgnQ("#sgn-ft-chip"); if (!box) return;
  if (!S.stamps.length) { box.innerHTML = '<span class="sgn-chip off">' + icon("pdf") + '<span class="nm">Add initials or a date to make a signed copy</span></span>'; return; }
  if (!S.blobUrl || !S.signedBytes) { box.innerHTML = '<span class="sgn-chip off">' + icon("pdf") + '<span class="nm">Writing the signed copy…</span></span>'; return; }
  box.innerHTML = '<span class="sgn-chip ready" draggable="true" id="sgn-file" title="Drag it onto your desktop or into an email. Click to save.">' + icon("pdf") + '<span class="nm">' + esc(sgnFileName()) + "</span></span>";
  var c = box.querySelector("#sgn-file");
  c.addEventListener("dragstart", function (ev) {
    if (!SGN || !SGN.blobUrl) { ev.preventDefault(); return; }
    ev.dataTransfer.effectAllowed = "copy";
    ev.dataTransfer.setData("DownloadURL", "application/pdf:" + sgnFileName().replace(/:/g, "-") + ":" + SGN.blobUrl);
    ev.dataTransfer.setData("text/plain", sgnFileName());
  });
}
function sgnSaveFile() {
  var a = document.createElement("a"); a.href = SGN.blobUrl; a.download = sgnFileName(); document.body.appendChild(a); a.click(); a.remove(); toast("Saved " + sgnFileName());
}
function sgnRebuild() {
  var S = SGN; if (!S || !S.stamps.length) return;
  sgnBuild().then(function (bytes) {
    if (SGN !== S) return; if (S.blobUrl) URL.revokeObjectURL(S.blobUrl);
    S.signedBytes = bytes; S.blobUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })); sgnChip();
  }, function (err) { if (SGN === S) { sgnQ("#sgn-ft-chip").innerHTML = '<span class="sgn-chip off">' + icon("pdf") + '<span class="nm">Couldn\'t write the PDF: ' + esc(err.message) + "</span></span>"; } });
}
function sgnWinAnsi(t) { return String(t).replace(/[^\x20-\x7e\xa0-\xff]/g, "?"); }
// Writes the stamps into a copy of the PDF. Positions go through the page's own transform, so a rotated scan still comes out upright and where it was placed.
function sgnBuild() {
  var S = SGN;
  return loadVendor("pdflib").then(function () {
    return PDFLib.PDFDocument.load(S.bytes);
  }).then(function (doc) {
    return doc.embedFont(PDFLib.StandardFonts.Helvetica).then(function (font) {
      var ink = PDFLib.rgb(0.043, 0.114, 0.361);
      return S.stamps.reduce(function (chain, st) {
        return chain.then(function () {
          var page = doc.getPage(st.page), vp = S.pages[st.page].vp1;
          var o = vp.convertToPdfPoint(st.x, st.y), rx = vp.convertToPdfPoint(st.x + 1, st.y), theta = Math.atan2(rx[1] - o[1], rx[0] - o[0]) * 180 / Math.PI;
          if (st.type === "img") {
            return doc.embedPng(st.dataUrl).then(function (img) {
              var org = vp.convertToPdfPoint(st.x, st.y + st.h);
              page.drawImage(img, { x: org[0], y: org[1], width: st.w, height: st.h, rotate: PDFLib.degrees(theta) });
            });
          }
          var base = vp.convertToPdfPoint(st.x, st.y + st.size * 0.82);
          page.drawText(sgnWinAnsi(st.text), { x: base[0], y: base[1], size: st.size, font: font, color: ink, rotate: PDFLib.degrees(theta) });
        });
      }, Promise.resolve()).then(function () { return doc.save(); });
    });
  });
}
/* My initials: typed (rendered in a script font) or drawn. */
function sgnClosePop() { var p = sgnQ("#sgn-pop"); if (p) p.remove(); }
function sgnSetup() {
  sgnClosePop(); var cur = sgnInitials(), mode = "type", pop = document.createElement("div"); pop.className = "sgn-pop"; pop.id = "sgn-pop";
  pop.innerHTML = '<h4>My initials</h4><div class="tabs"><button class="btn sm active" data-m="type" type="button">Type</button><button class="btn sm" data-m="draw" type="button">Draw</button></div>' +
    '<div id="sgn-pm-type"><input id="sgn-ini-text" maxlength="4" placeholder="NL" value="' + esc(cur && cur.text || "") + '" autocomplete="off"></div>' +
    '<div id="sgn-pm-draw" hidden><canvas class="pad" id="sgn-pad" width="660" height="220"></canvas></div>' +
    '<div class="prev"><img id="sgn-ini-prev" alt="" ' + (cur ? 'src="' + cur.url + '"' : "hidden") + '></div>' +
    '<div class="acts"><button class="btn sm" id="sgn-ini-clear" type="button">Clear</button><button class="btn sm" id="sgn-ini-cancel" type="button">Cancel</button><button class="btn sm pri" id="sgn-ini-save" type="button">Save Initials</button></div>';
  SGN.el.appendChild(pop);
  var pad = pop.querySelector("#sgn-pad"), pc = pad.getContext("2d"), made = null, drawn = false, down = false;
  pc.lineWidth = 5; pc.lineCap = "round"; pc.lineJoin = "round"; pc.strokeStyle = SGN_INK;
  function preview() {
    var cv = document.createElement("canvas"), t = pop.querySelector("#sgn-ini-text").value.trim(), res = null;
    if (mode === "type" && t) {
      cv.width = 800; cv.height = 300; var c = cv.getContext("2d"); c.fillStyle = SGN_INK;
      c.font = "italic 190px 'Snell Roundhand','Brush Script MT','Segoe Script','Lucida Handwriting',cursive"; c.textBaseline = "middle"; c.fillText(t, 20, 160); res = sgnTrim(cv); if (res) res.text = t;
    } else if (mode === "draw" && drawn) res = sgnTrim(pad);
    made = res; var im = pop.querySelector("#sgn-ini-prev"); if (res) { im.src = res.url; im.hidden = false; } else im.hidden = true;
  }
  pop.addEventListener("click", function (e) {
    var b = e.target.closest("[data-m]"); if (!b) return; mode = b.dataset.m;
    [].forEach.call(pop.querySelectorAll("[data-m]"), function (x) { x.classList.toggle("active", x === b); });
    pop.querySelector("#sgn-pm-type").hidden = mode !== "type"; pop.querySelector("#sgn-pm-draw").hidden = mode !== "draw"; preview();
  });
  pop.querySelector("#sgn-ini-text").oninput = preview;
  function pt(e) { var r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; }
  pad.onpointerdown = function (e) { down = true; try { pad.setPointerCapture(e.pointerId); } catch (x) { /* synthetic pointer */ } var p = pt(e); pc.beginPath(); pc.moveTo(p[0], p[1]); pc.lineTo(p[0] + 0.1, p[1]); pc.stroke(); drawn = true; };
  pad.onpointermove = function (e) { if (!down) return; var p = pt(e); pc.lineTo(p[0], p[1]); pc.stroke(); };
  pad.onpointerup = function () { down = false; preview(); };
  pop.querySelector("#sgn-ini-clear").onclick = function () { pc.clearRect(0, 0, pad.width, pad.height); drawn = false; pop.querySelector("#sgn-ini-text").value = ""; preview(); };
  pop.querySelector("#sgn-ini-cancel").onclick = sgnClosePop;
  pop.querySelector("#sgn-ini-save").onclick = function () { preview(); if (!made) { toast("Type or draw your initials first.", true); return; } sgnSaveInitials(made); sgnClosePop(); toast("Initials saved on this computer."); };
  preview(); var f = pop.querySelector("#sgn-ini-text"); if (f) f.focus();
}
/* Reading the rate con (OCR when it is a scan), keeping where each word sits so a box on the right can light up its spot on the left. */
function sgnRead() {
  var S = SGN; if (!S || S.reading) return Promise.resolve(); S.reading = true;
  return Promise.all(S.pages.map(function (p) { return p.pg.getTextContent(); })).then(function (tcs) {
    var text = tcs.map(function (tc) { return tc.items.map(function (i) { return i.str; }).join(" "); }).join("\n");
    if (text.replace(/\s/g, "").length >= 40) {
      S.words = tcs.map(function (tc, pi) {
        var vp = S.pages[pi].vp1;
        return tc.items.filter(function (i) { return i.str && i.str.trim(); }).map(function (i) { var tx = pdfjsLib.Util.transform(vp.transform, i.transform), h = Math.abs(tx[3]) || i.height; return { str: i.str, x: tx[4], y: tx[5] - h, w: i.width, h: h }; });
      });
      return text;
    }
    S.scanned = true;
    return getOcrWorker().then(function (w) {
      var all = "", chain = Promise.resolve();
      S.pages.slice(0, 3).forEach(function (p, pi) {
        chain = chain.then(function () {
          if (SGN !== S) return;
          var vp = p.pg.getViewport({ scale: 2.5 }), cv = document.createElement("canvas"); cv.width = vp.width; cv.height = vp.height;
          return p.pg.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise.then(function () { return w.recognize(cv); }).then(function (r) {
            all += "\n" + (r.data.text || "");
            S.words[pi] = (r.data.words || []).filter(function (x) { return x.text && x.text.trim(); }).map(function (x) { return { str: x.text, x: x.bbox.x0 / 2.5, y: x.bbox.y0 / 2.5, w: (x.bbox.x1 - x.bbox.x0) / 2.5, h: (x.bbox.y1 - x.bbox.y0) / 2.5 }; });
          });
        });
      });
      return chain.then(function () { return all; });
    });
  }).then(function (text) {
    if (SGN !== S) return;
    S.thin = String(text || "").replace(/\s/g, "").length < 40;
    S.reading = false; S.readDone = true; sgnShowForm(parseRateCon(text || "", S.name));
  }, function () { if (SGN === S) { S.reading = false; S.readDone = true; sgnShowForm(parseRateCon("", S.name)); } });
}
function sgnReadAsRateCon() {
  var S = SGN; if (!S) return; var side = sgnQ("#sgn-form");
  side.innerHTML = '<p class="note"><span class="spin" style="display:inline-block;vertical-align:-2px;margin-right:6px"></span>Reading it as a rate con…</p>'; S.asRc = true; sgnRead();
}
function sgnShowForm(p) {
  var S = SGN; if (!S) return; S.parsed = p;
  var ex = S.kind === "doc" ? order(S.oid) : afFindExisting(p), side = sgnQ("#sgn-form"); S.existing = ex;
  var note = S.kind === "doc" ? '<p class="note">This is what was read from this rate con. <b>Fill In Blank Boxes</b> puts it on the order; nothing already on the order is changed.</p>' :
    ex ? '<div class="note-bar" style="margin:0 0 10px">This matches order <b>' + esc(ex.rexius_order_no || ex.broker_load_no || "") + "</b>. Only its blank boxes will be filled in; nothing already on it is changed.</div>" :
    '<p class="note">Check what was read against the rate con on the left. Click a box and its spot on the PDF lights up. Fix anything, add your initials and date, then create the order. Nothing is saved until you do.</p>';
  side.innerHTML = note + '<div class="af-review">' + afFormHtml(p) + "</div>";
  S.form = afFormBind(side, p); sgnFooter();
}
function sgnFocus(e) {
  var S = SGN, i = e.target.closest && e.target.closest("[data-afr]"); if (!S || !i) return;
  [].forEach.call(S.el.querySelectorAll(".sgn-hit"), function (h) { h.remove(); });
  var spot = sgnFind(i.value); if (!spot) return;
  var d = document.createElement("div"); d.className = "sgn-hit"; d.style.left = (spot.x - 3) * S.scale + "px"; d.style.top = (spot.y - 3) * S.scale + "px"; d.style.width = (spot.w + 6) * S.scale + "px"; d.style.height = (spot.h + 6) * S.scale + "px";
  var ov = S.el.querySelector('.sgn-ov[data-page="' + spot.page + '"]'); if (!ov) return; ov.appendChild(d); d.scrollIntoView({ block: "center", behavior: "smooth" });
}
function sgnFind(value) {
  var S = SGN, needle = String(value || "").toLowerCase().replace(/[$,\s]/g, "");
  if (needle.length < 3) return null;
  for (var pi = 0; pi < (S.words || []).length; pi++) {
    var ws = S.words[pi] || [];
    for (var a = 0; a < ws.length; a++) {
      var acc = "", first = ws[a].str.toLowerCase().replace(/[$,\s]/g, "").length;
      for (var b = a; b < Math.min(ws.length, a + 8); b++) {
        acc += ws[b].str.toLowerCase().replace(/[$,\s]/g, "");
        var at = acc.indexOf(needle);
        if (at >= 0 && at < first) {                       // the match must start inside the first word, so no stray words come along
          var sel = ws.slice(a, b + 1), x0 = Math.min.apply(null, sel.map(function (q) { return q.x; })), y0 = Math.min.apply(null, sel.map(function (q) { return q.y; })),
            x1 = Math.max.apply(null, sel.map(function (q) { return q.x + q.w; })), y1 = Math.max.apply(null, sel.map(function (q) { return q.y + q.h; }));
          return { page: pi, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        }
        if (acc.length > needle.length + 40) break;
      }
    }
  }
  return null;
}
/* Footer: what the buttons are depends on how the window was opened. */
function sgnFooter() {
  var S = SGN; if (!S) return; var box = sgnQ("#sgn-ft-btns"); if (!box) return;
  var keep = '';
  if (S.kind === "intake") {
    box.innerHTML = '<label class="keep"><input type="checkbox" id="sgn-keep" ' + (S.keep ? "checked" : "") + '> Keep the signed copy on the order</label>' +
      '<div class="row"><button class="btn" id="sgn-cancel" type="button">Cancel</button><span style="flex:1"></span><button class="btn pri" id="sgn-go" type="button"' + (S.readDone ? "" : " disabled") + ">" + (S.existing ? "Fill In Order" : "Create Order") + "</button></div>";
    var k = box.querySelector("#sgn-keep"); if (k) k.onchange = function () { S.keep = k.checked; };
    return;
  }
  var rc = !!S.parsed;
  box.innerHTML = '<div class="row"><button class="btn" id="sgn-cancel" type="button">Close</button><span style="flex:1"></span>' +
    '<button class="btn' + (rc ? "" : " pri") + '" id="sgn-save" type="button" title="Adds the signed copy to this order\'s documents (the original stays)">Save Copy On Order</button>' +
    (rc ? '<button class="btn pri" id="sgn-fill" type="button">Fill In Blank Boxes</button>' : "") + "</div>";
}
// Intake: hand back the edited boxes and (if wanted) the signed copy; the caller creates the order and attaches the files.
function sgnGo() {
  var S = SGN; if (!S || !S.form || !S.readDone) return;
  var p2 = S.form.collect();
  var wantSigned = S.keep && S.stamps.length;
  var finish = function (bytes) { var res = { p: p2, signed: bytes || null, signedName: sgnFileName(), scanned: !!S.thin }; S.done = true; sgnClose(); S.resolve(res); };
  if (!wantSigned) { finish(null); return; }
  (S.signedBytes ? Promise.resolve(S.signedBytes) : sgnBuild()).then(finish, function (err) { toast("Couldn't write the signed PDF: " + err.message, true); });
}
function sgnFill() {
  var S = SGN; if (!S || !S.form) return; var o = order(S.oid); if (!o) { toast("That order is gone.", true); return; }
  var p2 = S.form.collect(), oid = S.oid;
  busyStart("Filling in the order…");
  afApply(o, p2).then(reload).then(function () { busyEnd(); sgnClose(); openOrder(oid); toast("Blank boxes filled in from the rate con."); })
    .catch(function (e) { busyEnd(); toast(e.message, true); });
}
function sgnSaveCopy() {
  var S = SGN; if (!S) return;
  if (!S.stamps.length) { toast("Add your initials or a date first.", true); return; }
  var oid = S.oid, d = S.doc, name = sgnFileName();
  (S.signedBytes ? Promise.resolve(S.signedBytes) : sgnBuild()).then(function (bytes) {
    busyStart("Saving the signed copy…");
    return api("document", { order_id: oid, doc_type: d.doc_type, filename: name, b64: b64FromBytes(bytes), extracted_fields: { signed: true, of_name: d.original_filename || "" }, matched_by: "manual" });
  }).then(reload).then(function () { busyEnd(); sgnClose(); openOrder(oid); toast("Signed copy saved on the order."); })
    .catch(function (e) { busyEnd(); toast(e.message || "Couldn't save the signed copy.", true); });
}
/* A document already on an order, opened to read or sign. */
function signDocument(docId) {
  var d = (DB.documents || []).filter(function (x) { return x.id === docId; })[0]; if (!d) return;
  if (!/\.pdf$/i.test(d.original_filename || "")) { toast("Only PDFs can be signed here.", true); return; }
  busyStart("Opening the document…");
  fetchStoredFile(d.storage_path).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
    busyEnd(); return sgnOpen({ kind: "doc", bytes: new Uint8Array(buf), name: d.original_filename, oid: DRAWER_OID || d.order_id, doc: d });
  }).catch(function (e) { busyEnd(); toast("Couldn't open it: " + e.message, true); });
}
/* The file chip on each document: the PDF icon and its title. Drag it onto the desktop or into an email (Chrome and Edge), or click it to save. The
   file is fetched ahead of time (it has to be on hand the moment a drag starts). */
var DOCBLOB = {};
// One line in an order's Documents list: its type, the file chip (drag it out or click to save), View, and Sign for a PDF.
function docRowHtml(d) {
  var nm = d.original_filename || "";
  return '<div class="docrow"><span class="pill">' + esc(String(d.doc_type || "other").replace("_", " ")) + "</span>" + docChipHtml(d) +
    '<button class="btn sm" data-viewpath="' + esc(d.storage_path) + '" data-viewname="' + esc(nm) + '">View</button>' +
    (/\.pdf$/i.test(nm) ? '<button class="btn sm" data-signdoc="' + esc(d.id) + '" type="button" title="Open it to add initials or a date, or to read it as a rate con">Sign</button>' : "") +
    (d.order_id && !d.proto && /\.pdf$/i.test(nm) ? '<button class="btn sm' + (docDriverOn(d) ? " active" : "") + '" data-docdriver="' + esc(d.id) + '" type="button" aria-pressed="' + docDriverOn(d) +
      '" title="' + (docDriverOn(d) ? "Drivers can open this from the load. Click to hide it." : "Let the driver open this from the load on their tab. Publish Schedule sends it.") + '">Show To Driver</button>' : "") + "</div>";
}
document.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest("[data-signdoc]"); if (b) signDocument(b.getAttribute("data-signdoc")); });
function docDriverOn(d) { return !!(d && d.extracted_fields && d.extracted_fields.driver_visible === true); }
/* "Show To Driver": the flag is kept in the document's own extracted_fields. Drivers see it after the next Publish Schedule. */
document.addEventListener("click", function (e) {
  var b = e.target.closest && e.target.closest("[data-docdriver]"); if (!b) return;
  var id = b.getAttribute("data-docdriver"), d = (DB.documents || []).filter(function (x) { return x.id === id; })[0];
  if (!d || b.disabled) return;
  var ef = Object.assign({}, d.extracted_fields || {}), on = !docDriverOn(d);
  if (on) ef.driver_visible = true; else delete ef.driver_visible;
  b.disabled = true;
  api("document/driver-visible", { id: id, extracted_fields: ef }).then(function () { return reload(); }).then(function () {
    toast(on ? "Drivers will see it after you Publish Schedule" : "Hidden from drivers after you Publish Schedule");
    histPush(on ? "show document to driver" : "hide document from driver",
      function () { return api("document/driver-visible", { id: id, extracted_fields: d.extracted_fields || {} }).then(reload); },
      function () { return api("document/driver-visible", { id: id, extracted_fields: ef }).then(reload); });
  }).catch(function (err) { b.disabled = false; toast(err.message, true); });
});
function docChipHtml(d) {
  var path = d.storage_path, ready = !!DOCBLOB[path], nm = d.original_filename || "(file)";
  return '<span class="pdfchip' + (ready ? "" : " wait") + '" draggable="true" data-docchip="' + esc(path) + '" data-filepath="' + esc(path) + '" data-filename="' + esc(nm) + '" data-filemode="download" ' +
    'title="Drag it onto your desktop or into an email. Click to save.">' + icon("pdf") + '<span class="nm">' + esc(nm) + "</span></span>";
}
function docMime(name) { var x = String(name || "").split(".").pop().toLowerCase(); return ({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", txt: "text/plain", csv: "text/csv" })[x] || "application/octet-stream"; }
function docPrefetch(path) {
  if (DOCBLOB[path]) return Promise.resolve(DOCBLOB[path]);
  if (!path || DOCBLOB[path] === 0) return Promise.resolve(null);
  DOCBLOB[path] = 0;
  return fetchStoredFile(path).then(function (r) { return r.blob(); }).then(function (b) {
    DOCBLOB[path] = URL.createObjectURL(new Blob([b], { type: docMime(path) }));
    [].forEach.call(document.querySelectorAll('[data-docchip]'), function (c) { if (c.getAttribute("data-docchip") === path) c.classList.remove("wait"); });
    return DOCBLOB[path];
  }, function () { delete DOCBLOB[path]; return null; });
}
function docPrefetchAll() { [].forEach.call(document.querySelectorAll("[data-docchip]"), function (c) { docPrefetch(c.getAttribute("data-docchip")); }); }
document.addEventListener("dragstart", function (e) {
  var c = e.target.closest && e.target.closest("[data-docchip]"); if (!c) return;
  var path = c.getAttribute("data-docchip"), url = DOCBLOB[path], name = (c.getAttribute("data-filename") || "document.pdf").replace(/:/g, "-");
  if (!url) { e.preventDefault(); docPrefetch(path); toast("Getting the file ready. Try again in a second.", false); return; }
  e.dataTransfer.effectAllowed = "copy";
  e.dataTransfer.setData("DownloadURL", docMime(name) + ":" + name + ":" + url);
  e.dataTransfer.setData("text/plain", name);
}, false);
document.addEventListener("pointerenter", function (e) { var c = e.target.closest && e.target.closest("[data-docchip]"); if (c) docPrefetch(c.getAttribute("data-docchip")); }, true);
function ingestRateCon(file) {
  var b64 = null, bytes = null;
  return file.arrayBuffer().then(function (buf) {
    bytes = new Uint8Array(buf); b64 = b64FromBytes(bytes);
    // The PDF opens beside the boxes (reading it, with OCR for a scan, happens inside the window); nothing is created until Create Order.
    return sgnOpen({ kind: "intake", bytes: bytes, name: file.name });
  }).then(function (res) {
    if (!res) return null;                              // cancelled: nothing was created
    var p2 = res.p;
    busyStart("Saving order…");
    return ingestParsed(p2, file.name).then(function (r) {
      return api("document", {
        order_id: r.o.id, doc_type: "rate_con", filename: file.name, b64: b64,
        extracted_fields: p2, matched_by: res.scanned ? "filename" : "document_text"
      }).then(function () {
        if (!res.signed) return null;
        return api("document", { order_id: r.o.id, doc_type: "rate_con", filename: res.signedName, b64: b64FromBytes(res.signed),
          extracted_fields: { signed: true, of_name: file.name }, matched_by: "manual" });
      }).then(function () { return { o: r.o, p: p2, n: r.n, scanned: res.scanned, signed: !!res.signed }; });
    });
  }).then(function (r) {
    if (!r) { busyEnd(); return; }
    return reload().then(function () {
      busyEnd();
      openOrder(r.o.id);
      if (r.o._match && r.o._match !== "created") {
        toast("Filled in order " + (r.o.rexius_order_no || r.o.broker_load_no || "") + " — rate con attached" + (r.signed ? " with your signed copy." : "."));
      } else {
        toast(r.scanned ? "Order created. The scan had little text, so check the boxes." : "Order created from the rate con" + (r.signed ? ", signed copy attached." : "."));
      }
    });
  }).catch(function (e) { busyEnd(); toast("Rate con failed: " + e.message, true); });
}
/* A spinner with a label in the header while something slow runs, so a long read never looks like it silently failed. */
function busyStart(label) {
  var b = $("#busy");
  if (!b) { var r = $(".hdr-right"); if (!r) return; b = document.createElement("span"); b.id = "busy"; b.className = "busy"; r.insertBefore(b, r.firstChild); }
  b.innerHTML = '<span class="spin" aria-hidden="true"></span><span class="busy-t">' + esc(label) + "</span>";
  b.setAttribute("role", "status"); b.style.display = "";
}
function busyEnd() { var b = $("#busy"); if (b) b.style.display = "none"; }
// Create (or match) the order for a parsed rate con / pasted load info, then fill what it can.
function ingestParsed(p, filename) {
  return api("order/ingest", {
    kind: "external", broker_name: p.broker, broker_load_no: p.load_no,
    rexius_order_no: p.solomon, po_number: p.po, filename: filename || ""
  }).then(function (o) { return afApply(o, p).then(function (r) { r.o._match = o._match; return r; }); });
}

/* ── New Order (header button) ──────────────────────────────────────────────────────────────────────
   Pick the kind, then it starts that kind's own process: External from a rate con (file or pasted text) or a blank
   order; Bag Order by its order number (opens the order if the number is already there, adds it if not); Internal
   Freight adds a new transfer. */
function bagNumberRegex() {
  var pattern = orderNumberSettings().internal_pattern || "07-{MM}{YY}-{####}";
  var esc2 = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  esc2 = esc2.replace(/\\\{MM\\\}/gi, "\\d{2}").replace(/\\\{YYYY\\\}/gi, "\\d{4}").replace(/\\\{YY\\\}/gi, "\\d{2}").replace(/\\\{(#+)\\\}/g, function (m, h) { return "\\d{" + h.length + "}"; });
  try { return new RegExp("^" + esc2 + "$", "i"); } catch (e) { return /^07-\d{4}-\d{4}$/; }
}
// "07-1026-0123", "07 1026 0123" and "0710260123" all mean the same number.
function normalizeBagNumber(raw) {
  var t = String(raw || "").trim().toUpperCase().replace(/\s+/g, "-").replace(/[–—_]/g, "-");
  if (/^\d{10}$/.test(t)) t = t.slice(0, 2) + "-" + t.slice(2, 6) + "-" + t.slice(6);
  return t;
}
function newOrderModal() {
  openModal('<div class="modal-hd"><h2>New Order</h2></div><div class="modal-body"><div class="no-grid">' +
    '<button class="no-pick" id="no-ext" type="button"><b>External Order</b><span>From a rate con, pasted text, or blank</span></button>' +
    '<button class="no-pick" id="no-bag" type="button"><b>Bag Order</b><span>Open it by order number, or add it</span></button>' +
    '<button class="no-pick" id="no-xfer" type="button"><b>Internal Freight</b><span>A one-off transfer to a department</span></button>' +
    '</div></div><div class="modal-ft"><button class="btn" id="modal-cancel">Cancel</button></div>');
}
function newExternalModal() {
  openModal('<div class="modal-hd"><h2>New External Order</h2></div><div class="modal-body"><div class="no-grid">' +
    '<button class="no-pick" id="no-ext-upload" type="button"><b>Upload a Rate Con</b><span>Reads a PDF and fills the order</span></button>' +
    '<button class="no-pick" id="no-ext-paste" type="button"><b>Paste Text</b><span>An email or any text with the load</span></button>' +
    '<button class="no-pick" id="no-ext-blank" type="button"><b>Blank Order</b><span>Start empty and fill it in</span></button>' +
    '</div></div><div class="modal-ft"><button class="btn" id="no-back" type="button">Back</button><button class="btn" id="modal-cancel">Cancel</button></div>');
}
function newBagPanel() {
  closeModal(); DRAWER_OID = null;
  setDrawerHtml('<div class="dw-hd"><div style="flex:1"><h2 id="dw-title">New Bag Order</h2><div class="sub">Enter the order number</div></div>' +
    '<button class="btn" id="dw-close">Close</button></div><div class="dw-body"><div><div class="sec-h">Order</div><div class="fields">' +
    '<label>Order #</label><input id="no-bag-num" type="text" autocomplete="off" placeholder="' +
      esc(formatOrderNumber(orderNumberSettings().internal_pattern, TODAY.slice(5, 7), String(YEAR), 1)) + '"></div></div>' +
    '<p style="font-size:var(--fs-label);color:var(--ink-3)">If this number is already on a bag order, that order opens so you can fill it in. If not, it is added.</p>' +
    '<div><button class="btn pri" id="no-bag-go" type="button">Open Or Add</button></div></div>');
  $("#drawer").classList.add("on"); $("#scrim").classList.add("on"); $("#drawer").setAttribute("aria-hidden", "false");
  setTimeout(function () { var i = $("#no-bag-num"); if (i) i.focus(); }, 60);
}
function newBagGo() {
  var inp = $("#no-bag-num"), num = normalizeBagNumber(inp ? inp.value : "");
  if (!num) { toast("Enter the order number", true); return; }
  var have = orders().filter(function (o) { return String(o.rexius_order_no || "").toUpperCase() === num; })[0];
  if (have) {
    closeModal(); openOrder(have.id);
    toast(isExt(have) || have.is_transfer ? "That number is " + (have.is_transfer ? "an internal freight" : "an external") + " order" : "Opened order " + num);
    return;
  }
  if (!bagNumberRegex().test(num)) { toast("That doesn't look like a bag order number, like " + formatOrderNumber(orderNumberSettings().internal_pattern, TODAY.slice(5, 7), String(YEAR), 1), true); return; }
  var go = $("#no-bag-go"); if (go) go.disabled = true;
  api("order/ingest", { kind: "internal", rexius_order_no: num }).then(function (o) {
    closeModal();
    return reload().then(function () { openOrder(o.id); toast("Added bag order " + num + " — fill it in"); });
  }).catch(function (err) { toast(err.message, true); if (go) go.disabled = false; });
}
document.addEventListener("click", function (e) {
  var so = e.target.closest("[data-showorder]");
  if (so) {   // jump from the side window to this order's row on its Orders page
    var soid = so.getAttribute("data-showorder"), oo = order(soid); if (!oo) return;
    closeDrawer(); SEC = "orders"; SUB = oo.is_transfer ? "xfer" : (oo.kind === "internal" ? "int" : "ext"); SEL = null; render();
    setTimeout(function () {
      var tr = document.querySelector('tr[data-roworder="' + soid + '"]');
      if (!tr) { toast("That order is in a collapsed group on this page", true); return; }
      tr.scrollIntoView({ block: "center" }); tr.classList.add("row-flash"); setTimeout(function () { tr.classList.remove("row-flash"); }, 1800);
    }, 60);
    return;
  }
  var t = e.target.closest("button"); if (!t) return;
  if (t.id === "hdr-new-order") { newOrderModal(); return; }
  if (t.id === "no-ext") { newExternalModal(); return; }
  if (t.id === "no-bag") { newBagPanel(); return; }
  if (t.id === "no-back") { newOrderModal(); return; }
  if (t.id === "no-xfer") { closeModal(); addTransferOrder(); return; }
  if (t.id === "no-ext-upload") { closeModal(); $("#file-ratecon").click(); return; }
  if (t.id === "no-ext-paste") { closeModal(); pasteLoadModal(); return; }
  if (t.id === "no-ext-blank") {
    closeModal();
    api("order", { kind: "external" }).then(function (o) {
      return reload().then(function () { openOrder(o.id); toast("New order — fill it in"); });
    }).catch(function (err) { toast(err.message, true); });
    return;
  }
  if (t.id === "no-bag-go") newBagGo();
});
document.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target && e.target.id === "no-bag-num") { e.preventDefault(); newBagGo(); } });

/* ── Billing queue: drag over rows to tick them (or untick, if the row you started on was ticked), like a spreadsheet.
   Shift-click ticks everything between the last row you clicked and this one. The checkboxes still work on their own. ── */
var BDRAG = null, BILL_LAST = null;
function billRows(tr) { return [].slice.call(tr.closest("tbody").querySelectorAll("tr.bill-row")); }
function billRowAt(rows, y) {
  if (y <= rows[0].getBoundingClientRect().top) return 0;
  for (var i = 0; i < rows.length; i++) { var r = rows[i].getBoundingClientRect(); if (y >= r.top && y <= r.bottom) return i; }
  return rows.length - 1;
}
function billSet(tr, on) {
  var cb = tr.querySelector("[data-group]"); if (!cb || cb.checked === on) return;
  cb.checked = on; cb.dispatchEvent(new Event("change", { bubbles: true }));
}
function billApply(B) {
  var cur = billRowAt(B.rows, B.lastY), lo = Math.min(B.a, cur), hi = Math.max(B.a, cur);
  B.rows.forEach(function (tr, i) { billSet(tr, i >= lo && i <= hi ? B.state : B.orig[i]); });
}
function billScroller(tr) {
  for (var el = tr.closest(".grid-wrap"); el; el = el.parentElement && el.parentElement.closest(".grid-wrap")) if (el.scrollHeight > el.clientHeight + 2) return el;
  return tr.closest(".grid-wrap");
}
document.addEventListener("pointerdown", function (e) {
  if (e.pointerType === "touch" || (e.button !== 0 && e.pointerType === "mouse")) return;
  var tr = e.target.closest && e.target.closest("tr.bill-row"); if (!tr) return;
  var rows = billRows(tr), a = rows.indexOf(tr), cb = tr.querySelector("[data-group]"); if (!cb) return;
  if (e.shiftKey && BILL_LAST != null && rows[BILL_LAST]) {   // shift-click: the whole stretch in between
    e.preventDefault();
    var lo = Math.min(BILL_LAST, a), hi = Math.max(BILL_LAST, a), st = rows[BILL_LAST].querySelector("[data-group]").checked;
    rows.forEach(function (r, i) { if (i >= lo && i <= hi) billSet(r, st); });
    return;
  }
  if (e.target.closest("button,a,select,textarea,.bill-x,[data-open],input:not([data-group])")) return;   // those keep their own clicks
  if ((e.metaKey || e.ctrlKey || e.altKey) && e.target !== cb) { e.preventDefault(); BILL_LAST = a; billSet(tr, !cb.checked); return; }   // one row at a time
  BILL_LAST = a;
  BDRAG = { rows: rows, a: a, state: !cb.checked, orig: rows.map(function (r) { return r.querySelector("[data-group]").checked; }),
    scroller: billScroller(tr), lastX: e.clientX, lastY: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, timer: 0, onCheckbox: e.target === cb };
}, true);
document.addEventListener("pointermove", function (e) {
  var B = BDRAG; if (!B) return;
  B.lastX = e.clientX; B.lastY = e.clientY;
  if (!B.moved) {
    if (Math.abs(e.clientY - B.y0) < 5) return;
    B.moved = true; document.body.classList.add("bill-dragging");
    B.timer = setInterval(function () { if (BDRAG && edgeAutoScroll(B.scroller, B.lastX, B.lastY)) billApply(B); }, 16);
  }
  e.preventDefault(); billApply(B);
}, true);
function billDragEnd() {
  var B = BDRAG; if (!B) return;
  clearInterval(B.timer); document.body.classList.remove("bill-dragging");
  BDRAG = null;
  if (B.moved) { var swallow = function (ev) { ev.stopPropagation(); ev.preventDefault(); }; document.addEventListener("click", swallow, true); setTimeout(function () { document.removeEventListener("click", swallow, true); }, 0); }
}
document.addEventListener("pointerup", billDragEnd, true);
document.addEventListener("pointercancel", billDragEnd, true);

/* Paste Load Info — most loads arrive as an email, not a PDF. Paste the email (or any text with the load on it);
   it goes through the same reader and fills an order the same way, with the same tags. */
function pasteLoadModal() {
  openModal('<div class="modal-hd"><h2>Paste Load Info</h2></div><div class="modal-body">' +
    '<p style="font-size:var(--fs-label);color:var(--ink-3);margin-bottom:8px">Paste the email or text for the load. It fills a new order, and every box it fills gets a tag so you can check it.</p>' +
    '<textarea id="paste-load-text" rows="12" style="width:100%" placeholder="Paste here"></textarea></div>' +
    '<div class="modal-ft"><button class="btn" id="modal-cancel">Cancel</button>' +
    '<button class="btn pri" id="paste-load-go">Read It</button></div>');
  setTimeout(function () { var t = $("#paste-load-text"); if (t) t.focus(); }, 0);
}
function runPasteLoad() {
  var ta = $("#paste-load-text"), text = ta ? ta.value : "";
  if (text.replace(/\s/g, "").length < 20) { toast("Paste the load info first.", true); return; }
  var p = parseRateCon(text, "");
  if (!p.load_no && !p.po && p.rate == null && !p.pickup && !p.delivery) { toast("Could not find any load info in that text.", true); return; }
  closeModal();
  afReview(p, "text").then(function (p2) {
    if (!p2) return;                                 // cancelled: nothing was created
    busyStart("Saving order…");
    return ingestParsed(p2, "").then(function (r) {
      return reload().then(function () {
        busyEnd();
        openOrder(r.o.id);
        toast(r.o._match && r.o._match !== "created" ? "Filled in order " + (r.o.rexius_order_no || r.o.broker_load_no || "") + "." : "Order created from the pasted text.");
      });
    });
  }).catch(function (e) { busyEnd(); toast("Paste failed: " + e.message, true); });
}
// Clicking the rate con box asks how: upload a file or paste text.
function rateConChooseModal() {
  openModal('<div class="modal-hd"><h2>Add a Rate Con</h2></div><div class="modal-body">' +
    '<div style="display:flex;gap:10px"><button class="btn pri" id="rc-choose-upload" style="flex:1;padding:16px 10px">Upload a File</button>' +
    '<button class="btn" id="rc-choose-paste" style="flex:1;padding:16px 10px">Paste Text</button></div>' +
    '<p style="font-size:var(--fs-label);color:var(--ink-3);margin-top:10px">Upload reads a PDF rate con. Paste reads an email or any text with the load on it. You can also drop a PDF on the box.</p></div>' +
    '<div class="modal-ft"><button class="btn" id="modal-cancel">Cancel</button></div>');
}
document.addEventListener("click", function (e) {
  if (e.target.closest("#rc-choose-upload")) { closeModal(); $("#file-ratecon").click(); return; }
  if (e.target.closest("#rc-choose-paste")) { closeModal(); pasteLoadModal(); return; }
  if (e.target.closest("#paste-load-go")) runPasteLoad();
});

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

/* ── Invoice batch (Rexius invoices printed as one PDF) ───────────────────
   Two pages per invoice; the second is the back of the paper and is dropped.
   Every invoice is saved the moment it's read (nothing waits in the browser
   to be lost on a refresh), matched to its load by what's printed on it, and
   listed in the batch review so a person can double-check or fix it. */
var BATCH_REVIEW = null;   // { name, total, done } while a batch is being read
function queueOrders() {
  return orders().filter(function (o) { return isExt(o) && !o.is_transfer && !o.billed_date && !isHistorical(o); });
}
// Which load an invoice belongs to, from its text: Rexius order # first, then
// the broker's load #, PO / PU #, Delivery #. Loads still waiting to bill win
// ties; if a number fits more than one load, leave it for a person.
function matchInvoiceText(text) {
  var T = " " + String(text || "").toUpperCase().replace(/\s+/g, " ") + " ";
  var exts = orders().filter(function (o) { return isExt(o) && !o.is_transfer && !isHistorical(o); });
  var sols = String(text || "").match(/\d{2}-\d{4}-\d{4}/g) || [];
  (String(text || "").match(/\b12(?:0[1-9]|1[0-2])\d{2}\d{4}\b/g) || []).forEach(function (x) {   // printed with no dashes on the invoice form
    var d = x.slice(0, 2) + "-" + x.slice(2, 6) + "-" + x.slice(6); if (sols.indexOf(d) < 0) sols.push(d);
  });
  function has(v) {
    v = String(v || "").trim().toUpperCase(); if (v.replace(/[^A-Z0-9]/g, "").length < 4) return false;
    return new RegExp("[^A-Z0-9]" + v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[^A-Z0-9]").test(T);
  }
  var tiers = [
    ["Rexius order #", "rexius_order_no", function (o) { return o.rexius_order_no && sols.indexOf(o.rexius_order_no) >= 0; }],
    ["Load #", "broker_load_no", function (o) { return has(o.broker_load_no); }],
    ["PO / PU #", "manual", function (o) { return has(o.po_number); }],
    ["Delivery #", "manual", function (o) { return has(o.delivery_number); }]
  ];
  for (var k = 0; k < tiers.length; k++) {
    var hits = exts.filter(tiers[k][2]); if (!hits.length) continue;
    var open = hits.filter(function (o) { return !o.billed_date; });
    var pick = open.length === 1 ? open[0] : (!open.length && hits.length === 1 ? hits[0] : null);
    if (pick) return { order: pick, how: tiers[k][0], matchedBy: tiers[k][1] };
    return { order: null, how: "More than one load has that " + tiers[k][0], ambiguous: true };
  }
  return { order: null, how: sols.length ? "No load has order # " + sols[0] : "No order, load or PO number found" };
}
function ingestBatch(file) {
  busyStart("Splitting batch…");
  return Promise.all([file.arrayBuffer(), loadVendor("pdflib")]).then(function (r) { return PDFLib.PDFDocument.load(r[0]); }).then(function (pdf) {
    var total = pdf.getPageCount(), count = Math.ceil(total / 2), tally = { auto: 0, suggested: 0, open: 0, failed: 0 };
    BATCH_REVIEW = { name: file.name, total: count, done: 0 };
    render();
    var chain = Promise.resolve();
    for (var i = 0; i < count; i++) (function (idx) {
      chain = chain.then(function () {
        busyStart("Reading invoice " + (idx + 1) + " of " + count + "…");
        return PDFLib.PDFDocument.create().then(function (doc) {
          return doc.copyPages(pdf, [idx * 2]).then(function (pgs) { doc.addPage(pgs[0]); return doc.save(); });
        }).then(function (bytes) {
          var b64 = b64FromBytes(bytes);
          return extractInvoiceInfo(b64).then(function (info) {
            // 1. an order #, load #, PO or delivery # printed on the invoice that fits exactly one load: attach it.
            // 2. otherwise score the loads; a clear best one is saved as a suggestion to confirm. Nothing is guessed silently.
            var m = matchInvoiceText(info.text || ""), cands = m.order ? [] : invoiceCandidates(info);
            var best = cands[0], second = cands[1] ? cands[1].score : 0, suggest = best && best.score >= 5 && best.score - second >= 3;
            var body = { doc_type: "invoice", filename: (info.invoiceNum ? "Invoice " + info.invoiceNum : "Invoice " + (idx + 1)) + ".pdf", b64: b64,
              extracted_fields: { invoiceNum: info.invoiceNum || null, read_order_no: info.solomon || null, match_how: m.how, batch: file.name,
                suggested: cands.slice(0, 3) } };
            if (m.order) { body.order_id = m.order.id; body.matched_by = m.matchedBy; }
            return api("document", body).then(function () {
              if (m.order) {
                tally.auto++;
                if (info.solomon && !m.order.rexius_order_no) return api("order/update", { id: m.order.id, rexius_order_no: info.solomon }).catch(function () {});
              } else if (suggest) tally.suggested++; else tally.open++;
            });
          });
        }).then(function () { BATCH_REVIEW.done++; },
          function (err) { BATCH_REVIEW.done++; tally.failed++; console.error("Invoice " + (idx + 1) + " failed", err); });
      });
    })(i);
    return chain.then(reload).then(function () {
      BATCH_REVIEW = null; busyEnd(); render();
      toast(count + " invoices read: " + tally.auto + " matched" + (tally.suggested ? ", " + tally.suggested + " suggested" : "") +
        (tally.open ? ", " + tally.open + " to match by hand" : "") + (tally.failed ? ", " + tally.failed + " failed" : "") + ".");
    });
  }).catch(function (e) { BATCH_REVIEW = null; busyEnd(); toast("Split failed: " + e.message, true); });
}
// Attach an invoice to a load (confirming a suggestion, or after a drag). If the load has no order # yet, the one read off the invoice goes on it.
function attachInvoiceDoc(docId, oid) {
  var d = (DB.documents || []).filter(function (x) { return x.id === docId; })[0], o = order(oid);
  var read = d && d.extracted_fields && d.extracted_fields.read_order_no, fill = !!(read && o && !o.rexius_order_no);
  return api("document/attach", { id: docId, order_id: oid }).then(function () {
    return fill ? api("order/update", { id: oid, rexius_order_no: read }) : null;
  }).then(reload).then(function () {
    toast("Attached to " + orderLabel(order(oid)) + (fill ? " · order # filled from the invoice" : ""));
  }).catch(function (e) { toast(e.message, true); });
}
var BILL_DRAG = null;
document.addEventListener("click", function (e) {
  var c = e.target.closest && e.target.closest("[data-confirm-doc]");
  if (c) { e.preventDefault(); var p = c.getAttribute("data-confirm-doc").split("|"); attachInvoiceDoc(p[0], p[1]); return; }
  var u = e.target.closest && e.target.closest("[data-unmatch-doc]");
  if (u) {
    e.preventDefault();
    api("document/unassign", { id: u.getAttribute("data-unmatch-doc") }).then(reload).then(function () { toast("Sent back to To Match"); }).catch(function (er) { toast(er.message, true); });
    return;
  }
});
document.addEventListener("dragstart", function (e) {
  var d = e.target.closest && e.target.closest("[data-dragdoc]");
  if (!d) return;
  BILL_DRAG = d.getAttribute("data-dragdoc");
  e.dataTransfer.setData("text/plain", "doc:" + BILL_DRAG); e.dataTransfer.effectAllowed = "move";
  d.classList.add("dragging");
});
document.addEventListener("dragover", function (e) {
  if (!BILL_DRAG) return;
  var r = e.target.closest("[data-bill]");
  if (r) { e.preventDefault(); r.classList.add("over"); }
});
document.addEventListener("drop", function (e) {
  if (!BILL_DRAG) return;
  var r = e.target.closest("[data-bill]");
  if (r) { e.preventDefault(); e.stopPropagation(); r.classList.remove("over"); var id = BILL_DRAG; BILL_DRAG = null; attachInvoiceDoc(id, r.getAttribute("data-bill")); }
}, true);
document.addEventListener("dragend", function () { BILL_DRAG = null; });
/* Group merge — ported from legacy :3090, including the multi-broker guard. */
function groupMerge() {
  if (GROUP.length < 2) { toast("Tick at least two loads for the same customer to combine.", true); return; }
  var os = GROUP.map(order).filter(Boolean);
  var keys = {};
  os.forEach(function (o) { keys[normBroker(buildChip(o).title)] = 1; });
  if (Object.keys(keys).length > 1) {
    toast("Those loads are for different customers. One combined PDF can only go to one customer.", true);
    return;
  }
  var all = [];
  os.forEach(function (o) { packageDocs(o.id).forEach(function (d) { all.push(d); }); });
  if (!all.length) { toast("No documents to merge.", true); return; }
  toast("Merging " + all.length + " documents from " + os.length + " orders…");
  Promise.all(all.map(fetchDocB64)).then(mergePdfs).then(function (m) {
    var nm = normBroker(buildChip(os[0]).title).replace(/\s+/g, "") || "Group";
    saveBlob(nm + "_" + os.length + "_loads.pdf", bytesFromB64(m));
    toast("Combined PDF downloaded · " + os.length + " loads, " + all.length + " documents");
    askMarkBilled(os.map(function (o) { return o.id; }));
  }).catch(function (e) { toast("Group merge failed: " + e.message, true); });
}

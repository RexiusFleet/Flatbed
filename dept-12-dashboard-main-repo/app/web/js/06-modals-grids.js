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
  var ext = String(name || path).split(".").pop().toLowerCase();
  var url = "/api/file/" + encodeURI(path);
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

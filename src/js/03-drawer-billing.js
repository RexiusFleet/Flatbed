/* ═══ 03-drawer-billing ═══ */
/* ── Order drawer ────────────────────────────────────────────────────────── */
var DRAWER_OID = null;
var DRAWER_SAVE = Promise.resolve();
/* Serialize drawer blur saves so a fast edit/refocus cannot let an older HTTP
   response land after the newer value. */
function queueDrawerSave(work) {
  DRAWER_SAVE = DRAWER_SAVE.catch(function () {}).then(work);
  return DRAWER_SAVE;
}
/* The most recent OTHER order this customer has, if any (D34) — shown at the
   bottom of the internal drawer so Nate can see order history without
   leaving the screen. */
function lastOrderDate(customerId, excludeId) {
  var dates = DB.orders.filter(function (o2) {
    return o2.customer_party_id === customerId && o2.id !== excludeId && o2.order_date;
  }).map(function (o2) { return String(o2.order_date).slice(0, 10); });
  if (!dates.length) return null;
  dates.sort();
  return dates[dates.length - 1];
}
/* A label+value row reusing the same data-table/data-id/data-field cell the
   Database tables already use — clicking and typing here edits the same
   underlying party/location row, no new editing mechanism needed. */
function dcellRow(label, table, id, field, val) {
  return '<tr><td style="padding:4px 8px;color:var(--ink-3);font-size:var(--fs-label);white-space:nowrap">' +
    esc(label) + "</td>" + (id
      ? '<td data-key="' + table + "-" + id + "-" + field + '" data-table="' + table + '" data-id="' + id +
        '" data-field="' + field + '"><div class="cell">' + esc(val == null ? "" : val) + "</div></td>"
      : '<td><div class="cell" style="color:var(--ink-3)">—</div></td>') + "</tr>";
}
/* Internal orders get a deliberately simpler drawer (D34): pallets and a
   note, then everything on file for the customer (from Bagger Customers),
   then when Nate last ordered from them. No Load #/PO/dates section — those
   already live in the Internal Orders table itself. */
/* Where an order sits on the board — the date of the cell it occupies, or null
   if it's not placed (D55). */
function schedValueForOrder(oid) {
  for (var k in CELLS) { var v = CELLS[k]; if (v && v.oid === oid) return { key: k, value: v }; }
  return null;
}
function schedDateForOrder(oid) {
  var found = schedValueForOrder(oid);
  return found ? found.key.split("|")[1] : null;
}
/* The exact scheduler chip, including its placement note and external pushed
   color when present. Used at the top of both order drawers. */
function drawerChipMarkup(o) {
  var found = schedValueForOrder(o.id), v = found && found.value;
  return chipHtml(o, false, "", v && v.cat,
    (v && v.fmt) || {}, pushColorFor(o, v), !!(v && v.pushedAt));
}
/* Outside-carrier section (D115/D122) — only renders once an order is
   actually sitting on the carrier lane (is_carrier, before or after it has a
   name); nothing to show/edit before that. Same section in both drawers
   since Nate wants this available for internal and external alike. A
   collapsible <details> (matching the drawer's Customer section convention)
   instead of a blocking modal at drop time — name/cost autosave on blur
   like every other drawer field. */
function carrierSectionHtml(oid) {
  var c = carrierMap()[oid]; if (!c) return "";
  var cp = c.carrierId ? party(c.carrierId) : null;
  return '<details><summary class="sec-h" id="dw-carrier-summary">Outside carrier' +
    (cp ? " — " + esc(cp.name) : "") + '</summary>' +
    '<div class="fields">' +
      '<label>Carrier name</label><input data-carrier="name" data-oid="' + oid +
        '" value="' + esc(cp ? cp.name : "") + '" placeholder="Who’s hauling it">' +
      '<label>What you paid ($)</label><input data-carrier="cost" data-oid="' + oid +
        '" value="' + esc(c.carrierCost != null ? c.carrierCost : "") + '" placeholder="0.00">' +
    "</div></details>";
}
/* Patches just the collapsible summary text after a carrier field save,
   instead of the full openOrder() rebuild every other drawer field uses —
   tabbing straight from Carrier name into Cost fast enough for a full
   drawer rebuild to land mid-keystroke would otherwise tear out the cost
   input and silently drop what was typed into it (D122). */
function refreshCarrierSummary(oid) {
  var s = $("#dw-carrier-summary"); if (!s) return;
  var c = carrierMap()[oid] || {}, cp = c.carrierId ? party(c.carrierId) : null;
  s.textContent = "Outside carrier" + (cp ? " — " + cp.name : "");
}
/* Patches just the drawer's <h2> title (any of the three drawer types all
   carry id="dw-title") after a field save — same narrow-patch pattern as
   refreshCarrierSummary, generalized from the transfer-only version (D127)
   once the same class of bug turned up on plain text fields too (see
   refreshOrderDrawerAfterSave below). */
function refreshDrawerTitle(oid) {
  var t = $("#dw-title"); if (!t || DRAWER_OID !== oid) return;
  var o = order(oid); if (!o) return;
  t.textContent = buildChip(o).title;
}
function drawerChipPreview(o) {
  return '<div><div class="sec-h">Load chip / driver-visible summary</div>' +
    '<div class="dw-chip-preview" id="dw-chip-preview">' + drawerChipMarkup(o) + "</div></div>";
}
function refreshDrawerChipPreview() {
  var host = $("#dw-chip-preview"), o = DRAWER_OID && order(DRAWER_OID);
  if (host && o) host.innerHTML = drawerChipMarkup(o);
}
/* Every drawer field's blur handler saves, then wants the drawer to reflect
   the (possibly server-recomputed, e.g. a denormalized name) fresh value.
   A full openOrder(oid) rebuild does that reliably — but if the user has
   since moved on to typing in ANOTHER drawer field, that rebuild tears the
   new field out from under them mid-keystroke and silently drops it (the
   same D122/D127 race, confirmed live on ordinary text-field pairs too:
   Notes → Miles, Miles → Transfer $, not just the transfer department
   picker). Skip the full rebuild whenever focus is still on an editable
   drawer field when the save resolves — a narrow chip/title patch is
   enough there, since the field the user is CURRENTLY in already shows
   what they typed and doesn't need touching. */
function refreshOrderDrawerAfterSave(saveOid) {
  if (DRAWER_OID !== saveOid) return;
  var ae = document.activeElement;
  var stillEditing = ae && ae.closest && ae.closest("#drawer") &&
    ae.closest("[data-of],[data-fr],[data-frorder],[data-transferdept],input[data-cust],[data-carrier]");
  if (stillEditing) { refreshDrawerChipPreview(); refreshDrawerTitle(saveOid); return; }
  openOrder(saveOid);
}
/* Drawer status strip — shares the same lifecycle pill as the order grids'
   leftmost Stage column (stagePill(), 04-views.js) so the two never drift,
   plus a jump-to-scheduler button once it's actually placed on a date.
   Cancel/Delete used to live here too; retired (D159) in favor of the
   order trackers' numbered-gutter multi-select, which covers a single
   order the same way (select one row) plus real multi-select. */
function orderPageBtn(oid) { return '<button class="btn sm" data-showorder="' + oid + '">Show On Order Page &rarr;</button>'; }
// Top row of the side window: the order's status box, Show On Scheduler (when it is on a date), Show On Order Page, and Delete on the right. No other text.
function schedBar(oid) {
  var o = order(oid); if (!o) return "";
  var ds = schedDateForOrder(oid), controls = stageControls(o, !!ds, false), canDel = canDeleteOrder(o);
  return '<div class="dw-sched">' + controls +
    (ds ? '<button class="btn sm" data-showsched="' + oid + '" data-schedds="' + ds + '">Show On Scheduler &rarr;</button>' : "") + orderPageBtn(oid) +
    '<span style="flex:1"></span><button class="btn del sm" data-delorder="' + oid + '"' + (canDel ? "" : ' disabled title="Billed external orders and delivered bag orders with an order number stay on file"') + ">Delete</button></div>";
}
/* Delete from the side window: asks first, and offers Cancel Order instead, which keeps the order on file (off the Scheduler, Staging
   and every report) so it can be restored later. */
function delOrderModal(oid) {
  var o = order(oid); if (!o) return;
  if (!canDeleteOrder(o)) { toast("That order stays on file: it can't be deleted", true); return; }
  var name = o.rexius_order_no || o.broker_load_no || buildChip(o).title || "this order", canCx = canCancelOrder(o);
  openModal('<div class="modal-hd"><h2>Delete this order?</h2></div><div class="modal-body">' +
    '<p style="line-height:1.5;margin:0 0 10px">Deleting <b>' + esc(name) + "</b> permanently removes it, its place on the Scheduler, and its documents. This cannot be undone.</p>" +
    (canCx ? '<p style="line-height:1.5;margin:0;color:var(--ink-2)">Want to keep the data? <b>Cancel the order</b> instead: it stays on file, comes off the Scheduler and Staging, is not counted in any report, and can be restored later.</p>' : "") +
    '</div><div class="modal-ft"><button class="btn" id="modal-cancel">Never Mind</button><span style="flex:1"></span>' +
    (canCx ? '<button class="btn bad" id="del-order-cx" data-oid="' + oid + '">Cancel Order</button>' : "") +
    '<button class="btn del" id="del-order-go" data-oid="' + oid + '">Delete Order</button></div>');
}
document.addEventListener("click", function (e) {
  var b = e.target.closest("[data-delorder],#del-order-cx,#del-order-go"); if (!b) return;
  if (b.hasAttribute("data-delorder")) { if (!b.disabled) delOrderModal(b.getAttribute("data-delorder")); return; }
  var oid = b.getAttribute("data-oid"); b.disabled = true;
  if (b.id === "del-order-cx") {
    api("order/cancel", { id: oid, cancelled: true }).then(function () {
      STAGED = STAGED.filter(function (x) { return x !== oid; }); closeModal(); return reload();
    }).then(function () { if (DRAWER_OID === oid) openOrder(oid); toast("Order cancelled. It stays on file."); })
      .catch(function (err) { toast(err.message, true); b.disabled = false; });
  } else {
    api("order/delete", { id: oid }).then(function () {
      STAGED = STAGED.filter(function (x) { return x !== oid; }); closeModal(); closeDrawer(); return reload();
    }).then(function () { toast("Order deleted"); })
      .catch(function (err) { toast(err.message, true); b.disabled = false; });
  }
});
function openInternalOrder(o) {
  var ch = buildChip(o), ds = docsFor(o.id);
  var have = {}; ds.forEach(function (d) { have[d.doc_type] = 1; });
  var cust = o.customer_party_id ? party(o.customer_party_id) : null;
  var loc = o.customer_party_id ? locFor(o.customer_party_id) : null;

  var h = '<div class="dw-hd"><div style="flex:1"><h2 id="dw-title">' + esc(ch.title) + "</h2>" +
    '<div class="sub">' + esc(o.rexius_order_no || "— no order # —") + "</div></div>" +
    '<button class="btn" id="dw-close">Close</button></div><div class="dw-body">';
  h += schedBar(o.id);

  /* Lead with the exact scheduler chip: this is the dispatch summary and the
     quickest way to confirm what the driver-facing workflow is carrying. */
  h += drawerChipPreview(o);
  h += carrierSectionHtml(o.id);

  /* Editable tracker fields lead the body now (Nate's ask) — the day-to-day
     dispatch fields come before the customer reference lookup, not after. */
  h += '<div><div class="sec-h">Order details</div><div class="fields">' +
    fld("pallet_count", "PAL", o.pallet_count, "") +
    fld("order_date", "Ordered", o.order_date && String(o.order_date).slice(0, 10), "", "date") +
    fld("delivery_date", "Delivered", o.delivery_date && String(o.delivery_date).slice(0, 10), "", "date") +
    fld("notes", "Private notes", o.notes, "Only you can see this") +
    "</div></div>";

  /* Two notes, every order kind (D140): Notes above is dispatcher-private,
     never pushed. Driver tab note is the one thing that reaches the
     driver's Sheets tab — same field/pattern Internal Freight transfers
     already had (D130), now universal. */
  h += '<div><div class="fields">' +
    fld("driver_note", "Dispatch Note", o.driver_note, "Note to driver") +
    "</div></div>";

  /* Freight to the bag plant (D38) — actual miles and the hand-entered
     internal charge, saved on the ORDER via /api/freight (D103) — editable as
     soon as the order exists, no staging required. Aggregated weekly per
     truck in v_freight_transfer_weekly once the order is on a load. */
  h += '<div><div class="sec-h">Mileage / transfer cost</div><div class="fields">' +
    frFld("miles", "Miles", o.miles, "") +
    frFld("freight_amount", "Transfer $", o.internal_freight_amount, "") +
    "</div></div>";

  /* Customer reference is collapsed by default (Nate's ask) — it's lookup
     detail, not something edited on every visit; a <details> keeps it one
     click away without new toggle state to track. */
  h += '<details><summary class="sec-h">Customer' + (cust ? " — " + esc(cust.name) : "") + "</summary>";
  if (cust) {
    h += '<table class="data" style="width:100%"><tbody>' +
      dcellRow(fieldLabel("bagger", "address", "Address"), "locations", loc && loc.id, "address", loc && loc.address) +
      dcellRow(fieldLabel("bagger", "city", "City"), "locations", loc && loc.id, "city", loc && loc.city) +
      '<tr><th>' + esc(fieldLabel("bagger", "category_id", "Time Window")) + '</th>' + designationSelect(loc) + '</tr>' +
      dcellRow(fieldLabel("bagger", "forklift", "Forklift"), "locations", loc && loc.id, "forklift", loc && loc.forklift) +
      dcellRow(fieldLabel("bagger", "standard_miles", "Miles"), "locations", loc && loc.id, "standard_miles", loc && loc.standard_miles) +
      dcellRow(fieldLabel("bagger", "phone", "Phone"), "parties", cust.id, "phone", cust.phone) +
      dcellRow(fieldLabel("bagger", "manager_name", "Manager"), "parties", cust.id, "manager_name", cust.manager_name) +
      dcellRow(fieldLabel("bagger", "notes", "Customer notes"), "locations", loc && loc.id, "notes", loc && loc.notes) +
      "</tbody></table>";
    var last = lastOrderDate(cust.id, o.id);
    h += '<div class="note-bar" style="margin-top:8px">Last order: ' + (last ? esc(last) : "none found") + "</div>";
  }
  h += "</details>";

  // What the driver sent in (notes, POD/BOL scans), right above Documents.
  h += driverNotesHtml(o.id) + driverScansHtml(o.id);
  h += '<div><div class="sec-h">Documents — ' + ds.length + "</div>" +
    '<div class="doclist" id="dw-docs">';
  ds.forEach(function (d) { h += docRowHtml(d); });
  h += '</div><div class="drop" id="dw-drop" style="margin-top:9px"><b>Drop documents here</b>' +
       "Delivery receipt, signed POD, invoice — stays linked to this order.</div></div>";

  h += "</div>";
  setDrawerHtml(h);
  $("#drawer").classList.add("on"); $("#scrim").classList.add("on");
  $("#drawer").setAttribute("aria-hidden", "false");
  docPrefetchAll();
}
/* ── Pickup/Delivery type-ahead combo (D42) ──────────────────────────────────
   As Nate types it autofills from the Pick/Drop List (locations); picking one
   sets the order's pickup/delivery, and a non-matching name can be created on
   the spot (never auto-created silently — his call). A dropped rate con
   pre-fills the box as a suggestion, which he confirms or overrides. */
function orderStops(oid) {
  return (DB.order_stops || []).filter(function (s) { return s.order_id === oid; })
    .sort(function (a, b) { return a.sequence - b.sequence; });
}
function routeCounts(oid) {
  var out = { pickup: 0, delivery: 0 };
  orderStops(oid).forEach(function (s) { if (out[s.stop_type] != null) out[s.stop_type]++; });
  return out;
}
function routeStopLabel(stop) {
  var loc = stop && stop.location_id ? locById(stop.location_id) : null;
  return loc ? [loc.name, loc.city, loc.state].filter(Boolean).join(", ") : "— location needed —";
}
function routeCompactLabel(o) {
  var c = routeCounts(o.id);
  return c.pickup + " pick" + (c.pickup === 1 ? "" : "s") + " · " +
    c.delivery + " drop" + (c.delivery === 1 ? "" : "s");
}
function rateConSuggest(oid) {
  var d = docsFor(oid).filter(function (x) { return x.doc_type === "rate_con" && x.extracted_fields; })[0];
  var ef = (d && d.extracted_fields) || {};
  return { pickup: ef.pickup || null, delivery: ef.delivery || null, stops: ef.stops || [] };
}

/* A rate con or pasted load is reviewed in a window first (afReview), then filled into blank boxes only. orders.autofill is also where the shared Staging list lives (_staged). */
// Street number + first street word, so "4227 W 6TH AVE" and "4227 West 6th Avenue" agree.
function afStreetKey(a) {
  var m = /^(\d{1,6})(?:-\d+)?\s+(?:(?:N|S|E|W|NE|NW|SE|SW|NORTH|SOUTH|EAST|WEST)\.?\s+)?([A-Za-z0-9]+)/i.exec(String(a || "").trim());
  return m ? m[1] + "|" + m[2].toLowerCase() : "";
}
function afNameTokens(n) {
  return String(n || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(function (w) {
    return w && !/^(inc|llc|co|corp|company|the|of|and|ltd)$/.test(w);
  });
}
// An existing Pick/Drop List entry for a parsed stop: same street address first, then same name in the same city.
function afMatchLocation(s) {
  var locs = DB.locations || [], key = afStreetKey(s.address), city = String(s.city || "").toLowerCase(), hit;
  if (key) {
    hit = locs.filter(function (l) { return afStreetKey(l.address) === key && (!city || !l.city || String(l.city).toLowerCase() === city); })[0];
    if (hit) return { id: hit.id, by: "address" };
  }
  var t = afNameTokens(s.name);
  if (!t.length) return null;
  hit = locs.filter(function (l) {
    var lt = afNameTokens(l.name); if (!lt.length) return false;
    if (city && l.city && String(l.city).toLowerCase() !== city) return false;
    var inter = t.filter(function (w) { return lt.indexOf(w) !== -1; }).length;
    return inter === t.length || inter === lt.length;
  })[0];
  return hit ? { id: hit.id, by: "name" } : null;
}
// -> { id, conf } for a parsed stop: an existing location, or a new one when the reader was sure of it; else null.
function afResolveStop(s) {
  if (!s || !(s.name || s.address)) return Promise.resolve(null);
  var m = afMatchLocation(s);
  if (m) return Promise.resolve({ id: m.id, conf: s.conf === "ok" || m.by === "address" ? "ok" : "check" });
  if (s.conf !== "ok" || !s.name || !s.city) return Promise.resolve(null);
  return api("location", { name: s.name, address: s.address || null, city: s.city, state: s.state || null, postal_code: s.zip || null })
    .then(function (loc) { return { id: loc.id, conf: "check" }; });
}
/* Fill the blank boxes of an order from a (reviewed) rate con. Boxes that already hold something are never changed. */
function afApply(o, p) {
  var body = {};
  function simple(key, val) { if (o[key] != null && o[key] !== "") return; if (val == null || val === "") return; body[key] = val; }
  simple("broker_load_no", p.load_no);
  simple("po_number", p.po);
  simple("rexius_order_no", p.solomon);
  if (!o.broker_party_id && p.broker_id) body.broker_party_id = p.broker_id;
  if ((o.external_rate == null || o.external_rate === "") && p.rate != null) {
    body.external_rate = p.rate; body.external_rate_source = "rate_con"; body.external_rate_original = p.rate;
  }
  var work = [];
  [["pickup", "pickup_location_id", "pick_appt_text"], ["delivery", "delivery_location_id", "drop_appt_text"]].forEach(function (k) {
    var stop = p[k[0]];
    if (!o[k[1]]) work.push(afResolveStop(stop).then(function (r) { if (r) body[k[1]] = r.id; }).catch(function () { /* leave it blank */ }));
    if (stop && stop.appt && !o[k[2]]) body[k[2]] = stop.appt;
  });
  return Promise.all(work).then(function () {
    return Object.keys(body).length ? api("order/update", Object.assign({ id: o.id }, body)) : null;
  }).then(function (row) { return { o: Object.assign(o, row || {}), n: {} }; });
}
function locCombo(oid, field, currentId, suggest) {
  var cur = currentId ? locById(currentId) : null;
  var val = cur ? cur.name : (suggest ? [suggest.name, suggest.city].filter(Boolean).join(", ") : "");
  return '<div class="loccombo"><input class="cell-i loc-in" data-loccombo="' + field + '" data-oid="' + oid +
    '" data-locid="' + (currentId || "") + '"' + (!currentId && val ? ' data-suggested="1"' : "") +
    ' value="' + esc(val) + '" placeholder="Search Picks and Drops" autocomplete="off"></div>';
}
/* Shared by every .loc-suggest panel (locations, parties, D149) — the first
   (best) match starts highlighted so Up/Down/Enter/Tab all have something
   to act on immediately, not just after an explicit ArrowDown. */
function markFirstLocOpt(panel) {
  var first = panel.querySelector(".loc-opt");
  if (first) first.classList.add("on");
}
/* ONE shared panel parked directly on <body>, not a child of whichever
   .loccombo is open (D228 follow-up) — a tracker grid's loccombo lives
   inside #main, and #main's own CSS `zoom` (the spreadsheet zoom control)
   turns out to make itself the containing block for any `position:fixed`
   descendant AND re-scale that descendant's offset by the zoom factor a
   second time. A panel rendered as a .loccombo child inherited that
   double-scaling and landed down-and-right of the input at any zoom other
   than 100% (found live, Nate: "the dropdown is like down and off to the
   right"). Parking it on body sidesteps the whole quirk instead of trying
   to out-math it — position math here is always plain viewport pixels,
   at every zoom level, because the panel is never inside the zoomed
   subtree. SUGGEST_INPUT (01-core.js) tracks which combo it's currently
   serving, since pick handlers can no longer find the input by walking up
   from the clicked option (the panel isn't a DOM descendant of it). */
function locSuggestPanel() {
  var p = document.getElementById("loc-suggest-portal");
  if (!p) {
    p = document.createElement("div");
    p.id = "loc-suggest-portal";
    p.className = "loc-suggest";
    p.style.display = "none";
    document.body.appendChild(p);
  }
  return p;
}
function positionLocSuggest(inp, panel) {
  var r = inp.getBoundingClientRect();
  panel.style.left = r.left + "px";
  panel.style.top = r.bottom + "px";
  panel.style.width = r.width + "px";
}
function renderLocSuggest(inp, force) {
  var panel = locSuggestPanel();
  var wasOpen = panel.style.display !== "none" && SUGGEST_INPUT === inp;
  SUGGEST_INPUT = inp;
  var qv = inp.value.trim().toLowerCase();
  /* Match against ANY field on the location, not just the name (Nate's ask) —
     address, city, state, phone, notes all count, so typing a street or town
     finds the row even when he doesn't remember the company name. */
  var matches = !qv ? [] : DB.locations.filter(function (l) {
    return [l.name, l.address, l.city, l.state, l.phone, l.notes]
      .filter(Boolean).join(" ").toLowerCase().indexOf(qv) >= 0;
  }).slice(0, 8);
  var html = matches.map(function (l) {
    var sub = routeAddr(l);
    return '<div class="loc-opt" data-locpick="' + l.id + '"><b>' + esc(l.name) + "</b>" +
      (sub ? '<span class="c">' + esc(sub) + "</span>" : "") + "</div>";
  }).join("");
  var exact = matches.some(function (l) { return (l.name || "").toLowerCase() === qv; });
  if (qv && !exact)
    html += '<div class="loc-opt create" data-loccreate="' + esc(inp.value.trim()) + '">+ Add New Location: &ldquo;' +
      esc(inp.value.trim()) + "&rdquo;</div>";
  panel.innerHTML = html;
  panel.style.display = html ? "block" : "none";
  // getBoundingClientRect() forces a synchronous layout — on a 1000+ row
  // tracker that's a real, felt cost paid on every keystroke if it runs
  // every render. The input's own on-screen position doesn't move while
  // the user types, so skip it for a same-input re-render already showing
  // — but a fresh `focus` always passes force=true (07-events.js), so
  // refocusing the same field after the page scrolled/zoomed/reflowed
  // elsewhere never leaves the panel showing a stale position (found
  // live: changing zoom while a panel from an earlier focus was still
  // open left it exactly where the old zoom had put it).
  if (html) { markFirstLocOpt(panel); if (!wasOpen || force) positionLocSuggest(inp, panel); }
}
function handleLocPick(opt) {
  var inp = SUGGEST_INPUT;
  var oid = inp.dataset.oid, field = inp.dataset.loccombo;
  locSuggestPanel().style.display = "none";
  var body = { id: oid };
  if (opt.dataset.locpick) {
    var l = locById(opt.dataset.locpick);
    inp.value = l ? l.name : ""; inp.dataset.locid = opt.dataset.locpick;
    if (/^stop:/.test(field)) { drawerStopPick(oid, field, opt.dataset.locpick); return; }
    body[field] = opt.dataset.locpick;
    api("order/update", body).then(function (row) { patchOrderLocal(oid, row); }).then(reload).then(function () { if (DRAWER_OID === oid) routeReopen(oid); }).catch(function (e) { toast(e.message, true); });
  } else {
    // A real fill-out form, not a guessed comma-split (Nate: "add locations
    // to my pick and drop list right then and there") — same popup the
    // Pick/Drop List's own "+ Add Location" uses, just pre-named and wired
    // to finish this pick once saved.
    addLocationModal(opt.dataset.loccreate, { oid: oid, field: field });
  }
}

/* Order-tracker Customer/Broker picker (D148) — Nate: "the order trackers
   dropdowns need to be more sensitive to typing... if im typing in the
   customer box 607 then the stores with 607 need to populate." Bag Orders'
   Customer and External Orders' Broker/Customer columns were both a plain
   <select> over the FULL party list (272+ rows) — a native select's
   type-to-jump only matches the START of an option's text, so typing "607"
   never found "BI-MART #607". Reuses the exact loccombo/.loc-suggest UI
   (D42) rather than building a second combo widget — same type-ahead
   panel, click-to-pick, positioned-under-input mechanics — just searching
   parties instead of locations, and no "+ Create" option (a brand-new
   customer/broker already has its own "+ Add customer" flow; a combo that
   can also silently create one is a second, easier-to-fat-finger path to
   the same duplicate-party risk locCombo's create option doesn't have to
   worry about, since a location has no separate identity to collide with). */
function partySubsetFor(field) {
  if (field === "customer_party_id") return (DB.parties || []).filter(function (p) {
    return p.is_customer && !p.customer_archived_at;
  });
  if (field === "broker_party_id") return (DB.parties || []).filter(function (p) {
    return p.is_broker && !p.broker_archived_at;
  });
  return [];
}
function partyCombo(oid, field, currentId, placeholder, disabled) {
  var cur = currentId ? party(currentId) : null;
  return '<div class="loccombo"><input class="cell-i loc-in" data-partycombo="' + field + '" data-oid="' + oid +
    '" data-partyid="' + (currentId || "") + '" value="' + esc(cur ? cur.name : "") +
    '" placeholder="' + esc(placeholder) + '" autocomplete="off"' + (disabled ? " disabled" : "") + '></div>';
}
function renderPartySuggest(inp, force) {
  var panel = locSuggestPanel();
  var wasOpen = panel.style.display !== "none" && SUGGEST_INPUT === inp;
  SUGGEST_INPUT = inp;
  var qv = inp.value.trim().toLowerCase();
  var pool = partySubsetFor(inp.dataset.partycombo);
  // Substring match anywhere, not just a leading match — "607" finding
  // "BI-MART #607" is the whole point (a native <select> only jumps to an
  // option whose text STARTS with what you type).
  var matches = !qv ? [] : pool.filter(function (p) {
    return (p.name || "").toLowerCase().indexOf(qv) >= 0;
  }).slice(0, 8);
  var html = matches.map(function (p) {
    return '<div class="loc-opt" data-partypick="' + p.id + '">' + esc(p.name) + "</div>";
  }).join("");
  panel.innerHTML = html;
  panel.style.display = html ? "block" : "none";
  if (html) { markFirstLocOpt(panel); if (!wasOpen || force) positionLocSuggest(inp, panel); }
}
function handlePartyPick(opt) {
  var inp = SUGGEST_INPUT;
  var oid = inp.dataset.oid, field = inp.dataset.partycombo;
  locSuggestPanel().style.display = "none";
  var pid = opt.dataset.partypick, p = party(pid);
  inp.value = p ? p.name : ""; inp.dataset.partyid = pid;
  var body = { id: oid }; body[field] = pid;
  api("order/update", body).then(function (row) { patchOrderLocal(oid, row); }).then(reload).catch(function (e) { toast(e.message, true); });
}

/* Internal Freight drawer (D127) — mirrors openInternalOrder's simpler shape
   (schedBar, chip preview, carrier section, mileage/transfer-$ fields) but
   swaps Customer for a Department picker and drops Documents entirely
   (transfers never get rate-con paperwork matched — no solomon/broker_load_no
   for the matching cascade to key off). */
function openTransferOrder(o) {
  var ch = buildChip(o);
  var h = '<div class="dw-hd"><div style="flex:1"><h2 id="dw-title">' + esc(ch.title) + "</h2>" +
    '<div class="sub">Internal Freight</div></div>' +
    '<button class="btn" id="dw-close">Close</button></div><div class="dw-body">';
  h += schedBar(o.id);
  h += drawerChipPreview(o);
  h += carrierSectionHtml(o.id);

  /* Department uses its own save path (data-transferdept), not the generic
     data-of full-drawer rebuild — picking a department then immediately
     typing the route note below it is the natural fill-out order for a new
     transfer, and a full rebuild landing mid-keystroke would tear the note
     input out and silently drop what was typed (same race D122 fixed for
     the carrier name→cost sequence; the generic data-of/data-fr handlers
     now guard against it too via refreshOrderDrawerAfterSave). Patches
     just the title + chip preview instead (refreshDrawerTitle). */
  h += '<div><div class="sec-h">Transfer details</div><div class="fields">' +
    '<label>Department</label><select data-transferdept="' + o.id + '">' +
    '<option value="">— pick department —</option>' +
    departmentsForPicker(o.transfer_department_id).map(function (dpt) {
      return '<option value="' + dpt.id + '"' + (dpt.id === o.transfer_department_id ? " selected" : "") + ">" +
        esc(dpt.name) + "</option>";
    }).join("") + "</select>" +
    fld("notes", "Load info", o.notes, "e.g. Bag Plant to Umatilla Yard # 23") +
    fld("order_date", "Date", o.order_date && String(o.order_date).slice(0, 10), "", "date") +
    fld("delivery_date", "Delivered", o.delivery_date && String(o.delivery_date).slice(0, 10), "", "date") +
    "</div></div>";

  /* Load info stays dispatcher-facing only (drives the chip title, never
     pushed). driver_note is the separate field that actually reaches the
     driver's Sheets tab — D130. */
  h += '<div><div class="fields">' +
    fld("driver_note", "Dispatch Note", o.driver_note, "Note to driver") +
    "</div></div>";

  h += '<div><div class="sec-h">Mileage / transfer cost</div><div class="fields">' +
    frFld("miles", "Miles", o.miles, "") +
    frFld("freight_amount", "Transfer $", o.internal_freight_amount, "") +
    "</div></div>";

  // No Documents section on transfers — driver notes/scans go last.
  h += driverNotesHtml(o.id) + driverScansHtml(o.id);
  h += "</div>";
  setDrawerHtml(h);
  $("#drawer").classList.add("on"); $("#scrim").classList.add("on");
  $("#drawer").setAttribute("aria-hidden", "false");
  docPrefetchAll();
}
function openOrder(oid) {
  DRAWER_OID = oid;
  var o = order(oid); if (!o) return;
  if (o.is_transfer) return openTransferOrder(o);
  if (!isExt(o)) return openInternalOrder(o);
  var ch = buildChip(o), ds = docsFor(oid);
  var need = ["rate_con", "pod", "invoice"];
  var have = {}; ds.forEach(function (d) { have[d.doc_type] = 1; });
  var pkgLabel = "rate con + POD/BOL + invoice";

  var h = '<div class="dw-hd"><div style="flex:1"><h2 id="dw-title">' + esc(ch.title) + "</h2>" +
    '<div class="sub">' + esc(o.rexius_order_no || "— no order # —") +
    (o.broker_load_no ? " · load " + esc(o.broker_load_no) : "") + "</div></div>" +
    '<button class="btn" id="dw-close">Close</button></div><div class="dw-body">';
  h += schedBar(oid);
  h += drawerChipPreview(o);
  h += carrierSectionHtml(oid);

  if (!o.rexius_order_no)
    h += '<div class="note-bar"><b>Needs a Rexius order number</b> — can\'t bill out without it.</div>';

  h += '<div><div class="sec-h">Order</div><div class="fields">' +
    "<label>Broker</label>" + partyCombo(oid, "broker_party_id", o.broker_party_id, "Search brokers") +
    fld("rexius_order_no", "Order #", o.rexius_order_no, externalOrderPlaceholder()) +
    fld("broker_load_no", "Load #", o.broker_load_no, "") +
    fld("po_number", "PU / PO", o.po_number, "") +
    fld("delivery_number", "Delivery #", o.delivery_number, "") +
    "<label>Rate</label>" + rateInputHtml(o, "") +
    fld("order_date", "Ordered", o.order_date && String(o.order_date).slice(0, 10), "", "date") +
    fld("delivery_date", "Delivered", o.delivery_date && String(o.delivery_date).slice(0, 10), "", "date") +
    fld("notes", "Private notes", o.notes, "Only you can see this") +
    "</div><div style=\"display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-top:8px\">" +
    "<label style=\"display:flex;align-items:center;gap:6px;font-size:var(--fs-body-sm);color:var(--ink-2)\">" +
    '<input type="checkbox" data-oedit="' + oid + '" data-field="tarp"' + (o.tarp ? " checked" : "") +
    "> Tarp load</label>" +
    "<label title=\"Only you see this. It never goes to drivers or the bag plant.\" style=\"display:flex;align-items:center;gap:6px;font-size:var(--fs-body-sm);color:var(--ink-2)\">" +
    '<input type="checkbox" data-oedit="' + oid + '" data-field="backhaul"' + (o.backhaul ? " checked" : "") +
    "> Backhaul</label></div></div>";

  /* Two notes, every order kind (D140): Notes above is dispatcher-private,
     never pushed. Driver tab note is the one thing that reaches the
     driver's Sheets tab — same field/pattern Internal Freight transfers
     already had (D130), now universal. */
  h += '<div><div class="fields">' +
    fld("driver_note", "Dispatch Note", o.driver_note, "Note to driver") +
    "</div></div>";

  /* Pickup / Delivery (D42) — type-ahead against the Pick/Drop List, pre-filled
     from the rate con when it extracted something. */
  var sug = rateConSuggest(oid);
  var routeLocked = !!(o.delivery_date || o.billed_date);
  h += '<div><div class="sec-h">Pickup / Drop</div>' + routeSectionHtml(o, sug, routeLocked) + "</div>";
  h += pnSectionHtml(o);

  // What the driver sent in (notes, POD/BOL scans), right above Documents.
  h += driverNotesHtml(o.id) + driverScansHtml(o.id);
  h += '<div><div class="sec-h">Documents — ' + ds.length + "</div>" +
    '<div class="doclist" id="dw-docs">';
  ds.forEach(function (d) { h += docRowHtml(d); });
  h += "</div>";
  var missing = need.filter(function (t) { return !have[t]; });
  if (o.route_mode === "custom") {
    var deliveryCount = routeCounts(o.id).delivery;
    h += '<div class="note-bar" style="margin-top:7px">' + deliveryCount + ' delivery stop' +
      (deliveryCount === 1 ? "" : "s") + ' — one combined POD or stop-specific PODs are both accepted.</div>';
  }
  h += '<div class="dw-pw"><span class="dw-pw-l">Paperwork</span><div class="bill-pw" role="img" aria-label="' +
    (missing.length ? "Missing " + missing.map(function (m) { return m.replace("_", " "); }).join(", ") : "Rate con, POD and invoice on file") + '">' + paperworkBars(have) + "</div></div>";
  h += '<div class="drop" id="dw-drop" style="margin-top:9px"><b>Drop documents here</b>' +
       "Anything — POD, BOL, invoice, signed paperwork. Stays linked to this order.</div></div>";

  /* Outlook drafting lives only in the Biller app now (D55) — the order drawer
     just produces the package files. */
  h += '<div><div class="sec-h">Billing package</div>' +
    '<p style="font-size:var(--fs-label);color:var(--ink-3);margin-bottom:8px">' + esc(pkgLabel) + "</p>" +
    '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
    '<button class="btn pri" data-pkg="merged">Download Merged</button>' +
    '<button class="btn" data-pkg="individual">Download Individually</button></div></div>';

  h += "</div>";
  setDrawerHtml(h);
  $("#drawer").classList.add("on"); $("#scrim").classList.add("on");
  $("#drawer").setAttribute("aria-hidden", "false");
  docPrefetchAll();
}
/* ── Filing a note to a customer or a location ────────────────────────────────────────────────────────────
   The + beside Private notes, Dispatch Note and each Note From Driver adds that text, stamped with today's date and
   this order's number, to the Notes column that already exists on the customer (external orders) or on the location
   (picks, drops, and a bag customer's "Customer notes"). Nothing new is stored: it is the same text you can edit in the
   Database. A bag customer's notes ride to the driver's tab, so a Private note can't be filed there. */
function pnKindLabel(k) { return { private: "Private note", dispatch: "Dispatch note", driver: "Note from driver" }[k] || "Note"; }
function pnTargets(o) {
  var out = [], seen = {};
  function party(id, label) {
    if (!id || seen["p" + id]) return;
    var p = DB.parties.filter(function (x) { return x.id === id; })[0]; if (!p) return;
    seen["p" + id] = 1; out.push({ table: "parties", id: id, label: label + ": " + p.name, row: p });
  }
  function loc(id, label, driverSees) {
    if (!id || seen["l" + id]) return;
    var l = locById(id); if (!l) return;
    seen["l" + id] = 1; out.push({ table: "locations", id: id, label: label + ": " + (l.name || "Location") + (l.city ? ", " + l.city : ""), row: l, driverSees: !!driverSees });
  }
  if (isExt(o)) {
    party(o.broker_party_id, "Customer notes"); party(o.customer_party_id, "Customer notes");
    loc(o.pickup_location_id, "Pick notes"); loc(o.delivery_location_id, "Drop notes");
    if (o.route_mode === "custom") orderStops(o.id).forEach(function (st) { loc(st.location_id, st.stop_type === "pickup" ? "Pick notes" : "Drop notes"); });
  } else {
    var cl = o.customer_party_id ? locFor(o.customer_party_id) : null;
    if (cl) loc(cl.id, "Customer notes", true);
    loc(o.pickup_location_id, "Pick notes"); loc(o.delivery_location_id, "Drop notes");
  }
  return out;
}
function pnLine(o, kind, text) {
  var d = new Date(), ds = (d.getMonth() + 1) + "/" + d.getDate() + "/" + String(d.getFullYear()).slice(2);
  return ds + " · from " + (o.rexius_order_no || o.broker_load_no || "an order with no number") + " · " + pnKindLabel(kind) + ": " + String(text).replace(/\s*\n+\s*/g, " ").trim();
}
var PN_OPEN = null;
function pnClose() { var p = $("#pn-pop"); if (p) p.remove(); PN_OPEN = null; }
function pnOpen(btn, text, kind) {
  pnClose();
  var o = DRAWER_OID ? order(DRAWER_OID) : null; if (!o) return;
  var targets = pnTargets(o), firstOk = -1;
  targets.forEach(function (t, i) { if (firstOk < 0 && !(kind === "private" && t.driverSees)) firstOk = i; });
  var h = '<div class="pn-pop" id="pn-pop" role="dialog" aria-label="Add this note"><div class="pn-hd">Add this note to</div>';
  if (!targets.length) h += '<p class="pn-none">This load has no customer or location to add it to yet.</p>';
  targets.forEach(function (t, i) {
    var blocked = kind === "private" && t.driverSees;
    h += '<label class="pn-opt' + (blocked ? " off" : "") + '"><input type="checkbox" data-pni="' + i + '"' + (blocked ? " disabled" : i === firstOk ? " checked" : "") + "><span>" + esc(t.label) +
      (t.driverSees ? '<small>' + (blocked ? "Drivers see this one, so a private note can't go here" : "Drivers see this one") + "</small>" : "") + "</span></label>";
  });
  h += '<div class="pn-hint">Added to the Notes column with today\'s date and this order\'s number.</div><div class="pn-ft"><button type="button" class="btn sm" data-pn-cancel>Cancel</button>' +
    (targets.length ? '<button type="button" class="btn sm pri" data-pn-go>Add Note</button>' : "") + "</div></div>";
  document.body.insertAdjacentHTML("beforeend", h);
  var p = $("#pn-pop"), r = btn.getBoundingClientRect();
  p.style.left = Math.max(8, Math.min(window.innerWidth - p.offsetWidth - 8, r.right - p.offsetWidth)) + "px";
  p.style.top = Math.max(8, Math.min(window.innerHeight - p.offsetHeight - 8, r.bottom + 6)) + "px";
  PN_OPEN = { oid: o.id, text: text, kind: kind, targets: targets };
}
function pnGo() {
  var P = PN_OPEN; if (!P) return;
  var o = order(P.oid), picked = [].slice.call(document.querySelectorAll("#pn-pop input[data-pni]:checked")).map(function (i) { return P.targets[+i.getAttribute("data-pni")]; });
  if (!picked.length) { toast("Pick where to add it", true); return; }
  var line = pnLine(o, P.kind, P.text), go = $("#pn-pop [data-pn-go]"); if (go) go.disabled = true;
  Promise.all(picked.map(function (t) {
    var cur = String(t.row.notes || "").replace(/\s+$/, "");
    return gridCellSet(t.table, t.id, "notes", cur ? cur + " | " + line : line);   // one line per cell, entries split by " | "
  })).then(function () {
    pnClose(); toast("Note added to " + picked.length + " place" + (picked.length > 1 ? "s" : ""));
    if (DRAWER_OID === P.oid) openOrder(P.oid);
  }).catch(function (err) { toast(err.message, true); if (go) go.disabled = false; });
}
// What is already written in the Notes column of this load's customer and locations, read-only here.
function pnSectionHtml(o) {
  var rows = pnTargets(o).filter(function (t) { return t.row.notes && String(t.row.notes).trim(); });
  if (!rows.length) return "";
  return '<details class="pn-file"><summary class="sec-h">Notes on file — ' + rows.length + "</summary>" + rows.map(function (t) {
    return '<div class="pn-grp"><b>' + esc(t.label) + '</b><div class="pn-txt">' + esc(String(t.row.notes).split(" | ").join("\n")) + "</div></div>";
  }).join("") + "</details>";
}
document.addEventListener("click", function (e) {
  var b = e.target.closest("[data-pnfield],[data-pndn]");
  if (b) {
    e.preventDefault();
    if (PN_OPEN && $("#pn-pop")) { pnClose(); return; }
    if (b.hasAttribute("data-pnfield")) {
      var f = b.getAttribute("data-pnfield"), inp = $('#drawer [data-of="' + f + '"]'), v = inp ? inp.value.trim() : "";
      if (v) pnOpen(b, v, f === "notes" ? "private" : "dispatch");
    } else {
      var id = b.getAttribute("data-pndn"), n = (DRIVER_NOTES[DRAWER_OID] || []).filter(function (x) { return String(x.id) === id; })[0];
      if (n) pnOpen(b, n.text, "driver");
    }
    return;
  }
  if (e.target.closest("[data-pn-go]")) { pnGo(); return; }
  if (e.target.closest("[data-pn-cancel]")) { pnClose(); return; }
  if (PN_OPEN && !e.target.closest("#pn-pop")) pnClose();
});
document.addEventListener("keydown", function (e) { if (e.key === "Escape" && PN_OPEN) pnClose(); });
document.addEventListener("input", function (e) {
  var t = e.target; if (!t.matches || !t.matches('[data-of="notes"],[data-of="driver_note"]')) return;
  var b = t.parentNode && t.parentNode.querySelector(".pn-plus"); if (b) b.disabled = !t.value.trim();
});
/* Driver notes — what a driver wrote about this load from the Flatbed
   Schedule page (driver/): a long wait, a bad site, anything dispatch
   should know. Read from Supabase (driver_notes), refreshed every minute. */
function driverNotesHtml(oid) {
  var list = (DRIVER_NOTES[oid] || []).slice().sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  var h = '<div id="dw-drvnotes"><div class="sec-h">Note From Driver — ' + list.length + "</div>";
  if (!list.length) return h + '<p class="drvnote-empty">Note from driver</p></div>';
  return h + '<div class="drvnote-list">' + list.map(function (n) {
    var d = new Date(n.at);
    var po = order(oid), plus = po && !po.is_transfer ? '<button type="button" class="pn-plus" data-pndn="' + esc(n.id) +
      '" title="Add this note to a customer or location" aria-label="Add this note to a customer or location">+</button>' : "";
    return '<div class="drvnote"><div class="drvnote-hd"><b>' + esc(n.driver || "Driver") + "</b><span>" +
      esc((n.truck ? n.truck + " · " : "") + d.toLocaleDateString([], { month: "numeric", day: "numeric" }) + " " +
      d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })) + "</span>" + plus + "</div>" + esc(n.text) + "</div>";
  }).join("") + "</div></div>";
}
/* External rate: what the broker pays for the order. Typed as dollars ("1850", "$1,850.50"); saves as typed
   (source "typed"). The rate con's own number, when it has been read, stays in external_rate_original. */
function rateText(v) {
  var n = v === null || v === undefined || v === "" ? null : Number(v);
  return n === null || isNaN(n) ? "" : "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function rateInputHtml(o, cls) {
  var orig = o.external_rate_original != null && o.external_rate_original !== "" && Number(o.external_rate_original) !== Number(o.external_rate);
  return '<input' + (cls ? ' class="' + cls + '"' : "") + ' type="text" inputmode="decimal" data-rate="' + o.id + '" placeholder="$0.00" value="' + esc(rateText(o.external_rate)) + '"' +
    (orig ? ' title="Rate con said ' + esc(rateText(o.external_rate_original)) + '"' : "") + ">";
}
document.addEventListener("change", function (e) {
  var el = e.target.closest && e.target.closest("[data-rate]"); if (!el) return;
  var oid = el.dataset.rate, o = order(oid); if (!o) return;
  var t = String(el.value || "").replace(/[$,\s]/g, ""), n = t === "" ? null : Number(t);
  if (n !== null && (isNaN(n) || n < 0)) { toast("Rate must be a dollar amount, like 1850 or $1,850.50", true); el.value = rateText(o.external_rate); return; }
  if (n !== null) n = Math.round(n * 100) / 100;
  var prev = o.external_rate === null || o.external_rate === undefined || o.external_rate === "" ? null : Number(o.external_rate);
  if (prev === n) { el.value = rateText(n); return; }
  api("order/update", { id: oid, external_rate: n === null ? "" : n, external_rate_source: n === null ? "" : "typed" }).then(function (row) {
    if (row) for (var k in row) o[k] = row[k];
    patchOrderLocal(oid, null);
    [].forEach.call(document.querySelectorAll('[data-rate="' + oid + '"]'), function (x) { x.value = rateText(o.external_rate); });
    histPush("edit rate",
      function () { return api("order/update", { id: oid, external_rate: prev === null ? "" : prev, external_rate_source: prev === null ? "" : "typed" }).then(function (r2) { if (r2) for (var k2 in r2) o[k2] = r2[k2]; render(); }); },
      function () { return api("order/update", { id: oid, external_rate: n === null ? "" : n, external_rate_source: n === null ? "" : "typed" }).then(function (r3) { if (r3) for (var k3 in r3) o[k3] = r3[k3]; render(); }); });
  }).catch(function (err) { toast(err.message, true); el.value = rateText(o.external_rate); });
});
function fld(name, label, val, ph, type) {
  // Every date field in the app is a smart date input now (D152) — same
  // typing behavior everywhere, not just Reports/Current Week.
  if (type === "date") {
    return "<label>" + esc(label) + '</label><input data-of="' + name +
      '" type="text" inputmode="numeric" data-smartdate data-last-iso="' + esc(val || "") +
      '" value="' + esc(isoToMdy(val)) + '" placeholder="MM/DD/YYYY">';
  }
  var o = DRAWER_OID ? order(DRAWER_OID) : null;
  var inp = '<input data-of="' + name + '" type="' + (type || "text") +
    '" value="' + esc(val == null ? "" : val) + '" placeholder="' + esc(ph || "") + '">';
  // Private notes and Dispatch Note get a + that files the note to the customer or a location (not on one-off transfers).
  if (o && !o.is_transfer && (name === "driver_note" || (name === "notes" && label === "Private notes")))
    inp = '<span class="fld-pn">' + inp + '<button type="button" class="pn-plus" data-pnfield="' + name + '"' + (val ? "" : " disabled") +
      ' title="Add this note to a customer or location" aria-label="Add this note to a customer or location">+</button></span>';
  return "<label>" + esc(label) + "</label>" + inp;
}
/* Like fld() but saves via /api/freight (D38/D103) instead of /api/order. */
function frFld(name, label, val, ph) {
  return "<label>" + esc(label) + '</label><input data-fr="' + name + '" type="number" step="0.1"' +
    ' value="' + esc(val == null ? "" : val) + '" placeholder="' + esc(ph || "") + '">';
}
/* Redrawing the drawer for the order already open (a save, + Add Drop, a
   Bill With change…) keeps its scroll position instead of jumping to the top. */
var DRAWER_SHOWN = null;
function setDrawerHtml(h) {
  var d = $("#drawer"), body = d.querySelector(".dw-body");
  var top = d.classList.contains("on") && DRAWER_SHOWN === DRAWER_OID && body ? body.scrollTop : 0;
  d.innerHTML = h; DRAWER_SHOWN = DRAWER_OID;
  if (top) { var nb = d.querySelector(".dw-body"); if (nb) nb.scrollTop = top; }
}
function closeDrawer() {
  $("#drawer").classList.remove("on"); $("#scrim").classList.remove("on");
  $("#drawer").setAttribute("aria-hidden", "true"); DRAWER_OID = null; DRAWER_SHOWN = null; ROUTE_SEL = null;
}
function packageDocs(oid) {
  var o = order(oid), ds = docsFor(oid);
  var wanted = isExt(o) ? ["rate_con", "pod", "invoice"] : ["pod", "invoice"];
  var out = [];
  wanted.forEach(function (t) { ds.forEach(function (d) { if (d.doc_type === t) out.push(d); }); });
  // A signed copy takes the place of the document it was made from (both stay in the Documents list).
  var replaced = {};
  out.forEach(function (d) { var ef = d.extracted_fields; if (ef && ef.signed && ef.of_name) replaced[d.doc_type + "|" + ef.of_name] = 1; });
  return out.filter(function (d) { return !replaced[d.doc_type + "|" + (d.original_filename || "")]; });
}
function fetchDocB64(d) {
  return fetchStoredFile(d.storage_path).then(function (r) { return r.arrayBuffer(); })
    .then(function (b) { return b64FromBytes(new Uint8Array(b)); });
}
function doPackage(oid, mode) {
  var o = order(oid), ds = packageDocs(oid);
  if (!ds.length) { toast("No documents attached to package.", true); return Promise.reject(new Error("no docs")); }
  var base = (buildChip(o).title || "package").replace(/[^A-Za-z0-9]+/g, "") + "_" +
             (o.rexius_order_no || o.broker_load_no || "pkg");
  if (mode === "individual") {
    ds.forEach(function (d) {
      fetchDocB64(d).then(function (b) { saveBlob(d.original_filename || (base + ".pdf"), bytesFromB64(b)); });
    });
    toast("Downloading " + ds.length + " file(s) individually");
    return Promise.resolve();
  }
  return Promise.all(ds.map(fetchDocB64)).then(mergePdfs).then(function (merged) {
    // Outlook billing drafts were removed in the Supabase port (out of
    // scope: no Microsoft Graph, no outbound email). "merged" is the only
    // packaged mode left; "individual" is handled above.
    saveBlob(base + ".pdf", bytesFromB64(merged)); toast("Merged package downloaded");
  });
}
/* Billing completion (D62) — mark an external order billed (out of the queue)
   or reopen it. */
function billOrder(oid, billed) {
  return api("order/bill", { id: oid, billed: billed !== false }).then(function () {
    var o = order(oid); if (o) o.billed_date = billed === false ? null : new Date().toISOString();
  });
}
function isFulfilled(oid) {
  var have = {}; docsFor(oid).forEach(function (d) { have[d.doc_type] = 1; });
  return !!(have.pod && have.invoice);
}
function billDone(oid) {
  if (!isFulfilled(oid)) {
    confirmModal("This load doesn't have both a POD and an invoice yet. Mark it billed anyway?", function () { markBilled(oid); }, "Mark Billed Anyway", true);
    return;
  }
  markBilled(oid);
}
/* Mark every ticked load in the Billing queue billed in one go. Loads missing a POD or invoice ask first (once for all of them). */
function billDoneMany() {
  var ids = GROUP.filter(function (id) { var o = order(id); return o && isExt(o) && !o.is_transfer && !o.billed_date; });
  if (!ids.length) { toast("Tick the loads to mark billed first", true); return; }
  var incomplete = ids.filter(function (id) { return !isFulfilled(id); }).length;
  var run = function () {
    var btn = $("#bill-done-sel"); if (btn) btn.disabled = true;
    Promise.all(ids.map(function (id) { return billOrder(id, true); })).then(function () {
      GROUP = GROUP.filter(function (id) { return ids.indexOf(id) < 0; });
      return reload();
    }).then(function () {
      toast(ids.length + " load" + (ids.length === 1 ? "" : "s") + " billed out");
      histPush("bill out " + ids.length,
        function () { return Promise.all(ids.map(function (id) { return billOrder(id, false); })).then(reload); },
        function () { return Promise.all(ids.map(function (id) { return billOrder(id, true); })).then(reload); });
    }).catch(function (e) { toast(e.message, true); reload(); });
  };
  var n = ids.length, msg = n === 1 ? "This load doesn't have both a POD and an invoice yet. Mark it billed anyway?"
    : incomplete === n ? "None of the " + n + " selected loads has both a POD and an invoice yet. Mark all " + n + " billed anyway?"
    : incomplete + " of the " + n + " selected loads " + (incomplete === 1 ? "doesn't" : "don't") + " have both a POD and an invoice yet. Mark all " + n + " billed anyway?";
  if (incomplete) confirmModal(msg, run, "Mark Billed Anyway", true);
  else run();
}
function markBilled(oid) {
  billOrder(oid, true).then(reload).then(function () {
    toast("Billed out");
    histPush("bill out",
      function () { return billOrder(oid, false).then(reload); },
      function () { return billOrder(oid, true).then(reload); });
  }).catch(function (e) { toast(e.message, true); });
}
/* After a download: offer to mark those loads billed in one go, so a
   package you already have doesn't need a second trip to Mark Billed. */
function askMarkBilled(ids) {
  ids = ids.filter(function (id) { var o = order(id); return o && isExt(o) && !o.billed_date; });
  if (!ids.length) return;
  var one = ids.length === 1, o1 = order(ids[0]);
  openModal('<div class="modal-hd"><h2>Mark ' + (one ? "This Load" : ids.length + " Loads") + " Billed?</h2></div>" +
    '<div class="modal-body"><p style="line-height:1.5;margin:0">' +
    (one ? esc(orderLabel(o1)) + " downloaded." : ids.length + " packages downloaded.") +
    " Mark " + (one ? "it" : "them") + " billed to take " + (one ? "it" : "them") + " out of the queue?</p></div>" +
    '<div class="modal-ft"><button class="btn" id="modal-cancel">Not Yet</button>' +
    '<button class="btn pri" id="modal-confirm">Mark Billed</button></div>');
  $("#modal-confirm").addEventListener("click", function () {
    closeModal();
    Promise.all(ids.map(function (id) { return billOrder(id, true); })).then(function () { GROUP = []; return reload(); })
      .then(function () {
        toast((one ? "1 load" : ids.length + " loads") + " marked billed");
        histPush("bill out",
          function () { return Promise.all(ids.map(function (id) { return billOrder(id, false); })).then(reload); },
          function () { return Promise.all(ids.map(function (id) { return billOrder(id, true); })).then(reload); });
      }).catch(function (e) { toast(e.message, true); });
  });
}
/* Download Selected: each ticked load's merged package, one file per load.
   Downloading never marks anything billed — that's Mark Billed. */
function billBatch() {
  var ids = GROUP.filter(function (id) { var o = order(id); return o && isExt(o) && packageDocs(id).length; });
  if (!ids.length) { toast("Tick loads that have documents first.", true); return; }
  var chain = Promise.resolve();
  ids.forEach(function (id) { chain = chain.then(function () { return doPackage(id, "merged"); }); });
  chain.then(function () { toast(ids.length + " package" + (ids.length > 1 ? "s" : "") + " downloaded"); askMarkBilled(ids); })
    .catch(function (e) { toast(e.message || "Download failed", true); });
}

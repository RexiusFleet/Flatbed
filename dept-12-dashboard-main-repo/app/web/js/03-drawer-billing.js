/* ── Order drawer ────────────────────────────────────────────────────────── */
var DRAWER_OID = null;
var DRAWER_SAVE = Promise.resolve();
/* Serialize drawer blur saves so a fast edit/refocus cannot let an older HTTP
   response land after the newer value. */
function queueDrawerSave(work) {
  // Gated by the OPEN ORDER's own kind (D125), not the ambient SEC/SUB — a
  // drawer opened from the Scheduler still edits order data, so it's the
  // Orders grant that governs it, independent of how it was reached.
  var o = DRAWER_OID && order(DRAWER_OID);
  var sub = o && o.is_transfer ? "xfer" : o && o.kind === "internal" ? "int" : "ext";
  if (o && !canEdit("orders", sub)) {
    toast("View-only — you can't edit this order.", true);
    return Promise.reject(new Error("View-only"));
  }
  DRAWER_SAVE = DRAWER_SAVE.catch(function () {}).then(work);
  return DRAWER_SAVE;
}
/* The most recent OTHER order this customer has, if any (D34) — shown at the
   bottom of the internal drawer so Nate can see order history without
   leaving the screen. */
function lastOrderDate(customerId, excludeId) {
  var dates = DB.orders.filter(function (o2) {
    return o2.customer_party_id === customerId && o2.id !== excludeId && o2.ordered_at;
  }).map(function (o2) { return String(o2.ordered_at).slice(0, 10); });
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
    (v && v.fmt) || {}, pushColorFor(o, v));
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
function schedBar(oid) {
  var o = order(oid); if (!o) return "";
  var ds = schedDateForOrder(oid);
  var controls = stageControls(o, !!ds, false);
  if (ds) return '<div class="dw-sched">' + controls +
    '<span style="font-size:var(--fs-label);color:var(--ink-3);margin-left:2px">' + esc(prettyDate(ds)) + "</span>" +
    '<button class="btn sm" data-showsched="' + oid + '" data-schedds="' + ds + '">Show On Scheduler &rarr;</button>' +
    "</div>";
  if (STAGED.indexOf(oid) >= 0) return '<div class="dw-sched">' + controls +
    '<span style="font-size:var(--fs-label);color:var(--ink-3)">In the staging rail — not on the board yet.</span></div>';
  return '<div class="dw-sched">' + controls + "</div>";
}
function openInternalOrder(o) {
  var ch = buildChip(o), ds = docsFor(o.id);
  var have = {}; ds.forEach(function (d) { have[d.doc_type] = 1; });
  var cust = o.customer_party_id ? party(o.customer_party_id) : null;
  var loc = o.customer_party_id ? locFor(o.customer_party_id) : null;

  var h = '<div class="dw-hd"><div style="flex:1"><h2 id="dw-title">' + esc(ch.title) + "</h2>" +
    '<div class="sub">' + esc(o.solomon_order_no || "— no order # —") + "</div></div>" +
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
    fld("ordered_at", "Ordered", o.ordered_at && String(o.ordered_at).slice(0, 10), "", "date") +
    fld("delivered_at", "Delivered", o.delivered_at && String(o.delivered_at).slice(0, 10), "", "date") +
    fld("notes", "Notes", o.notes, "") +
    "</div></div>";

  /* Two notes, every order kind (D140): Notes above is dispatcher-private,
     never pushed. Driver tab note is the one thing that reaches the
     driver's Sheets tab — same field/pattern Internal Freight transfers
     already had (D130), now universal. */
  h += '<div><div class="sec-h">Driver tab note</div><div class="fields">' +
    fld("driver_note", "Notes", o.driver_note, "What the driver should see when this pushes") +
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

  h += '<div><div class="sec-h">Documents — ' + ds.length + "</div>" +
    '<div class="doclist" id="dw-docs">';
  ds.forEach(function (d) {
    h += '<div class="docrow"><span class="pill">' + esc(d.doc_type.replace("_", " ")) + "</span>" +
      '<span class="nm">' + esc(d.original_filename || "") + "</span>" +
      '<button class="btn sm" data-viewpath="' + esc(d.storage_path) + '" data-viewname="' +
        esc(d.original_filename || "") + '">View</button>' +
      '<a class="btn sm" href="/api/file/' + encodeURI(d.storage_path) + '" download="' +
        esc(d.original_filename || "") + '">Download</a></div>';
  });
  h += '</div><div class="drop" id="dw-drop" style="margin-top:9px"><b>Drop documents here</b>' +
       "Delivery receipt, signed POD, invoice — stays linked to this order.</div></div>";

  h += "</div>";
  $("#drawer").innerHTML = h;
  $("#drawer").classList.add("on"); $("#scrim").classList.add("on");
  $("#drawer").setAttribute("aria-hidden", "false");
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
/* A dropped rate con used to only ever SUGGEST pickup/delivery text — Nate
   always had to confirm or manually "+Create" it (rate cons vary wildly and
   scanned ones are OCR-noisy, so nothing auto-applied). Nate: "be able to add
   locations to picks and drops based on the rate con dropping" — the main
   workflow being dropping a rate con in means that friction is gone now: an
   extracted stop that doesn't already exist in the Pick/Drop List becomes a
   real location outright, matched by exact (case-insensitive) name first so
   re-ingesting the same shipper/consignee doesn't pile up duplicates. This
   only touches the ADDRESS BOOK, never an order's own pickup/delivery pick —
   ingestRateCon still only fills that in when the field was blank. */
function resolveStopToLocationId(stop) {
  if (!stop || !stop.name) return Promise.resolve(null);
  var qn = stop.name.trim().toLowerCase();
  var existing = (DB.locations || []).filter(function (l) { return (l.name || "").trim().toLowerCase() === qn; })[0];
  if (existing) return Promise.resolve(existing.id);
  return api("location", { name: stop.name, city: stop.city || null, state: stop.state || null })
    .then(function (loc) { return loc.id; });
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
    var sub = [l.address, [l.city, l.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
    return '<div class="loc-opt" data-locpick="' + l.id + '">' + esc(l.name) +
      (sub ? ' <span class="c">' + esc(sub) + "</span>" : "") + "</div>";
  }).join("");
  var exact = matches.some(function (l) { return (l.name || "").toLowerCase() === qv; });
  if (qv && !exact)
    html += '<div class="loc-opt create" data-loccreate="' + esc(inp.value.trim()) + '">+ Create &ldquo;' +
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
    body[field] = opt.dataset.locpick;
    api("order/update", body).then(reload).catch(function (e) { toast(e.message, true); });
  } else {
    // A real fill-out form, not a guessed comma-split (Nate: "add locations
    // to my pick and drop list right then and there") — same popup the
    // Pick/Drop List's own "+ Add Location" uses, just pre-named and wired
    // to finish this pick once saved.
    addLocationModal(opt.dataset.loccreate.split(",")[0].trim(), { oid: oid, field: field });
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
  api("order/update", body).then(reload).catch(function (e) { toast(e.message, true); });
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
    fld("ordered_at", "Date", o.ordered_at && String(o.ordered_at).slice(0, 10), "", "date") +
    fld("delivered_at", "Delivered", o.delivered_at && String(o.delivered_at).slice(0, 10), "", "date") +
    "</div></div>";

  /* Load info stays dispatcher-facing only (drives the chip title, never
     pushed). driver_note is the separate field that actually reaches the
     driver's Sheets tab — D130. */
  h += '<div><div class="sec-h">Driver tab note</div><div class="fields">' +
    fld("driver_note", "Notes", o.driver_note, "What the driver should see when this pushes") +
    "</div></div>";

  h += '<div><div class="sec-h">Mileage / transfer cost</div><div class="fields">' +
    frFld("miles", "Miles", o.miles, "") +
    frFld("freight_amount", "Transfer $", o.internal_freight_amount, "") +
    "</div></div>";

  h += "</div>";
  $("#drawer").innerHTML = h;
  $("#drawer").classList.add("on"); $("#scrim").classList.add("on");
  $("#drawer").setAttribute("aria-hidden", "false");
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
    '<div class="sub">' + esc(o.solomon_order_no || "— no order # —") +
    (o.broker_load_no ? " · load " + esc(o.broker_load_no) : "") + "</div></div>" +
    '<button class="btn" id="dw-close">Close</button></div><div class="dw-body">';
  h += schedBar(oid);
  if (o.billed_at)
    h += '<div class="dw-sched"><span class="pill on">Billed out</span>' +
      '<button class="btn sm" data-reopen-bill="' + oid + '">Reopen For Billing</button></div>';

  h += drawerChipPreview(o);
  h += carrierSectionHtml(oid);

  if (!o.solomon_order_no)
    h += '<div class="note-bar"><b>Needs a Rexius order number</b> — can\'t bill out without it.</div>';

  h += '<div><div class="sec-h">Order</div><div class="fields">' +
    "<label>Broker</label>" + partyCombo(oid, "broker_party_id", o.broker_party_id, "Search brokers") +
    fld("solomon_order_no", "Order #", o.solomon_order_no, externalOrderPlaceholder()) +
    fld("broker_load_no", "Load #", o.broker_load_no, "") +
    fld("po_number", "PU / PO", o.po_number, "") +
    fld("delivery_number", "Delivery #", o.delivery_number, "") +
    fld("ordered_at", "Ordered", o.ordered_at && String(o.ordered_at).slice(0, 10), "", "date") +
    fld("delivered_at", "Delivered", o.delivered_at && String(o.delivered_at).slice(0, 10), "", "date") +
    fld("notes", "Notes", o.notes, "") +
    "</div><label style=\"display:flex;align-items:center;gap:6px;font-size:var(--fs-body-sm);color:var(--ink-2);margin-top:8px\">" +
    '<input type="checkbox" data-oedit="' + oid + '" data-field="tarp"' + (o.tarp ? " checked" : "") +
    "> Tarp load</label></div>";

  /* Two notes, every order kind (D140): Notes above is dispatcher-private,
     never pushed. Driver tab note is the one thing that reaches the
     driver's Sheets tab — same field/pattern Internal Freight transfers
     already had (D130), now universal. */
  h += '<div><div class="sec-h">Driver tab note</div><div class="fields">' +
    fld("driver_note", "Notes", o.driver_note, "What the driver should see when this pushes") +
    "</div></div>";

  /* Pickup / Delivery (D42) — type-ahead against the Pick/Drop List, pre-filled
     from the rate con when it extracted something. */
  var sug = rateConSuggest(oid);
  var prefilled = (!o.pickup_location_id && sug.pickup) || (!o.delivery_location_id && sug.delivery);
  h += '<div><div class="sec-h">Pickup / Drop</div>';
  if (o.route_mode === "custom") {
    h += '<div class="route-summary"><b>' + esc(routeCompactLabel(o)) + '</b>' +
      orderStops(oid).map(function (s) { return '<span><strong>' + s.sequence + ' ' +
        (s.stop_type === "pickup" ? "PICK" : "DROP") + '</strong> ' + esc(routeStopLabel(s)) + '</span>'; }).join("") +
      '</div><button class="btn" data-route-edit="' + oid + '" style="margin-top:8px">Edit Full Route…</button>';
  } else {
    h += '<div style="display:flex;flex-direction:column;gap:9px">' +
      '<div><label style="font-size:var(--fs-body-sm);color:var(--ink-2);display:block;margin-bottom:3px">Pickup</label>' +
        locCombo(oid, "pickup_location_id", o.pickup_location_id, sug.pickup) + "</div>" +
      '<div><label style="font-size:var(--fs-body-sm);color:var(--ink-2);display:block;margin-bottom:3px">Drop</label>' +
        locCombo(oid, "delivery_location_id", o.delivery_location_id, sug.delivery) + "</div></div>" +
      (prefilled ? '<div class="note-bar" style="margin-top:7px">Prefilled from the rate con — confirm each or pick from the list.</div>' : "") +
      ((sug.stops || []).filter(function (s) { return s.stop_type === "pickup"; }).length > 1 ||
       (sug.stops || []).filter(function (s) { return s.stop_type === "delivery"; }).length > 1
        ? '<div class="note-bar" style="margin-top:7px"><b>Possible multi-stop route detected.</b> Use Edit full route to review it.</div>' : "") +
      '<button class="btn" data-route-edit="' + oid + '" style="margin-top:8px">Edit Full Route…</button>';
  }
  h += "</div>";

  h += '<div><div class="sec-h">Documents — ' + ds.length + "</div>" +
    '<div class="doclist" id="dw-docs">';
  ds.forEach(function (d) {
    h += '<div class="docrow"><span class="pill">' + esc(d.doc_type.replace("_", " ")) + "</span>" +
      '<span class="nm">' + esc(d.original_filename || "") + "</span>" +
      '<button class="btn sm" data-viewpath="' + esc(d.storage_path) + '" data-viewname="' +
        esc(d.original_filename || "") + '">View</button>' +
      '<a class="btn sm" href="/api/file/' + encodeURI(d.storage_path) + '" download="' +
        esc(d.original_filename || "") + '">Download</a></div>';
  });
  h += "</div>";
  var missing = need.filter(function (t) { return !have[t]; });
  if (o.route_mode === "custom") {
    var deliveryCount = routeCounts(o.id).delivery;
    h += '<div class="note-bar" style="margin-top:7px">' + deliveryCount + ' delivery stop' +
      (deliveryCount === 1 ? "" : "s") + ' — one combined POD or stop-specific PODs are both accepted.</div>';
  }
  if (missing.length)
    h += '<div style="margin-top:7px;font-size:var(--fs-label);color:var(--bad)">Missing: ' +
         missing.map(function (m) { return m.replace("_", " "); }).join(", ") + "</div>";
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
  $("#drawer").innerHTML = h;
  $("#drawer").classList.add("on"); $("#scrim").classList.add("on");
  $("#drawer").setAttribute("aria-hidden", "false");
}
function fld(name, label, val, ph, type) {
  // Every date field in the app is a smart date input now (D152) — same
  // typing behavior everywhere, not just Reports/Current Week.
  if (type === "date") {
    return "<label>" + esc(label) + '</label><input data-of="' + name +
      '" type="text" inputmode="numeric" data-smartdate data-last-iso="' + esc(val || "") +
      '" value="' + esc(isoToMdy(val)) + '" placeholder="MM/DD/YYYY">';
  }
  return "<label>" + esc(label) + '</label><input data-of="' + name + '" type="' + (type || "text") +
    '" value="' + esc(val == null ? "" : val) + '" placeholder="' + esc(ph || "") + '">';
}
/* Like fld() but saves via /api/freight (D38/D103) instead of /api/order. */
function frFld(name, label, val, ph) {
  return "<label>" + esc(label) + '</label><input data-fr="' + name + '" type="number" step="0.1"' +
    ' value="' + esc(val == null ? "" : val) + '" placeholder="' + esc(ph || "") + '">';
}
function closeDrawer() {
  $("#drawer").classList.remove("on"); $("#scrim").classList.remove("on");
  $("#drawer").setAttribute("aria-hidden", "true"); DRAWER_OID = null;
}
function packageDocs(oid) {
  var o = order(oid), ds = docsFor(oid);
  var wanted = isExt(o) ? ["rate_con", "pod", "invoice"] : ["pod", "invoice"];
  var out = [];
  wanted.forEach(function (t) { ds.forEach(function (d) { if (d.doc_type === t) out.push(d); }); });
  return out;
}
function fetchDocB64(d) {
  return dashboardAuth.fetch("/api/file/" + encodeURI(d.storage_path)).then(function (r) { return r.arrayBuffer(); })
    .then(function (b) { return b64FromBytes(new Uint8Array(b)); });
}
function doPackage(oid, mode) {
  var o = order(oid), ds = packageDocs(oid);
  if (!ds.length) { toast("No documents attached to package.", true); return Promise.reject(new Error("no docs")); }
  var base = (buildChip(o).title || "package").replace(/[^A-Za-z0-9]+/g, "") + "_" +
             (o.solomon_order_no || o.broker_load_no || "pkg");
  if (mode === "individual") {
    ds.forEach(function (d) {
      fetchDocB64(d).then(function (b) { saveBlob(d.original_filename || (base + ".pdf"), bytesFromB64(b)); });
    });
    toast("Downloading " + ds.length + " file(s) individually");
    return Promise.resolve();
  }
  return Promise.all(ds.map(fetchDocB64)).then(mergePdfs).then(function (merged) {
    if (mode === "merged") { saveBlob(base + ".pdf", bytesFromB64(merged)); toast("Merged package downloaded"); return; }
    if (dashboardAuth.config.outlookEnabled && !dashboardAuth.microsoftToken()) {
      toast("Connecting Outlook — choose Draft again after Microsoft returns you here");
      return dashboardAuth.connectOutlook().then(function () {
        throw new Error("Outlook authorization is required before drafting.");
      });
    }
    var b = o.broker_party_id ? party(o.broker_party_id) : null;
    return api("create-draft", { to: (b && b.ap_email) || "", subject: "Invoice Package: " + base,
                                 pdfB64: merged, filename: base + ".pdf" })
      .then(function (r) {
        toast("Outlook draft created in your mailbox");
        if (r.draft && r.draft.webLink) {
          openModal('<div class="modal-hd"><h2>Outlook draft created</h2></div>' +
            '<div class="modal-body"><p style="line-height:1.5;margin:0">The billing packet is attached to a ' +
            'draft in your Microsoft mailbox. Open it to review the recipients and message before sending.</p></div>' +
            '<div class="modal-ft"><button class="btn" id="modal-cancel">Close</button><span style="flex:1"></span>' +
            '<a class="btn pri" href="' + esc(r.draft.webLink) +
            '" target="_blank" rel="noopener">Open Outlook Draft</a></div>');
        }
      });
  });
}
/* Billing completion (D62) — mark an external order billed (out of the queue)
   or reopen it. */
function billOrder(oid, billed) {
  return api("order/bill", { id: oid, billed: billed !== false }).then(function () {
    var o = order(oid); if (o) o.billed_at = billed === false ? null : new Date().toISOString();
  });
}
function isFulfilled(oid) {
  var have = {}; docsFor(oid).forEach(function (d) { have[d.doc_type] = 1; });
  return !!(have.pod && have.invoice);
}
function billDone(oid) {
  if (!isFulfilled(oid) &&
      !confirm("This order doesn't have both a POD and an invoice yet. Mark it billed anyway?")) return;
  billOrder(oid, true).then(reload).then(function () {
    toast("Billed out");
    histPush("bill out",
      function () { return billOrder(oid, false).then(reload); },
      function () { return billOrder(oid, true).then(reload); });
  }).catch(function (e) { toast(e.message, true); });
}
/* Download/draft the selected fulfilled orders in sequence, billing each out. */
function billBatch(mode) {
  var ids = GROUP.filter(function (id) { var o = order(id); return o && isExt(o) && !o.billed_at && isFulfilled(id); });
  if (!ids.length) { toast("Tick fulfilled orders (POD + invoice) first.", true); return; }
  var chain = Promise.resolve();
  ids.forEach(function (id) {
    chain = chain.then(function () { return doPackage(id, mode === "dl" ? "merged" : "draft"); })
      .then(function () { return billOrder(id); });
  });
  chain.then(function () { GROUP = []; return reload(); })
    .then(function () { toast(ids.length + " order(s) billed out"); })
    .catch(function (e) { toast(e.message || "Batch failed", true); reload(); });
}
function billBatchDone() {
  var ids = GROUP.filter(function (id) { var o = order(id); return o && isExt(o) && !o.billed_at; });
  if (!ids.length) { toast("Tick orders first.", true); return; }
  var incomplete = ids.filter(function (id) { return !isFulfilled(id); });
  if (incomplete.length &&
      !confirm(incomplete.length + " of these aren't fulfilled (missing POD/invoice). Mark all billed anyway?")) return;
  Promise.all(ids.map(function (id) { return billOrder(id); })).then(function () { GROUP = []; return reload(); })
    .then(function () { toast(ids.length + " marked billed"); }).catch(function (e) { toast(e.message, true); });
}

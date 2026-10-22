/* ═══ 05-settings-nav-search ═══ */
/* ── Settings (D54) ──────────────────────────────────────────────────────── */
var CUSTOM_ACCENT_OPEN = false;
function vSettings(sub) {
  var h = '<div class="settings-head"><div><h2>Settings</h2><p>Personalize this workspace.</p></div></div>';
  if (sub === "shortcuts") return '<div class="settings-shell">' + h + settingsShortcuts() + "</div>";
  return '<div class="settings-shell">' + h + settingsAppearance() + "</div>";
}
function prefBtn(key, val, label) {
  return '<button class="setting-choice' + (PREFS[key] === val ? " on" : "") + '" data-setpref="' + key +
    '" data-val="' + esc(val) + '">' + esc(label) + "</button>";
}
/* Scheduler row height / truck-column width (D175) — Nate: "id like it to
   be customizable like cell height and width in the scheduler... i do need
   the default height slightly adjusted cause right now its cutting load
   chips off... inside the settings it pops up a window so you can see
   what ur editing as u click it." The +/- steppers reuse the exact
   .fb-fs/.fb-fs-b/.fb-fs-inp component from the font-size control (D174
   made these three finally look identical — Nate: "i like that ui the
   best"). The preview below isn't a mocked-up image — it's the real
   .grid/.slotrow/.chip markup and CSS, sized by the same --row-h/--col-w
   custom properties the actual Scheduler reads, so a click on +/- (which
   calls applyPrefs() through setPref()) resizes this preview live, for
   free, with no preview-specific logic. Two sample chips (one plain, one
   filled/colored, both with a full who/meta/flags/note stack) show
   exactly the content that was getting cut off at the old 72px default. */
function schedulerSizingHtml() {
  var chip1 =
    '<div class="chip" style="--edge:#2F5D8C" draggable="false">' +
      '<div class="who">SAMPLE CUSTOMER CO</div>' +
      '<div class="meta"><span>24 PAL · Sample Order</span></div>' +
      '<div class="flags"><span class="flag">EARLY</span><span class="flag">FORKLIFT</span></div>' +
      '<div class="note">' + NOTEPAD_ICON + 'Call ahead before delivery</div>' +
    "</div>";
  var chip2 =
    '<div class="chip filled" style="--edge:#3F7D3A;background:#3F7D3A;color:#fff" draggable="false">' +
      '<div class="who">SAMPLE FLOWERS INC</div>' +
      '<div class="meta"><span>18 PAL · Sample Order</span></div>' +
      '<div class="flags"><span class="flag">ANYTIME</span></div>' +
      '<div class="dnote">&#9998; Dock 3, ask for Mike</div>' +
    "</div>";
  return '<section class="set-card set-wide"><div class="set-title"><div><div class="set-h">Scheduler sizing</div>' +
    '<p>Set the working size directly. Comfortable spacing is now the permanent baseline.</p></div>' +
    '<button class="btn sm" data-schedsize-reset="1">Reset size</button></div>' +
    '<div class="set-row">' +
    '<label class="setting-field"><span>Row height</span><span class="fb-fs" aria-label="Row height">' +
      '<button class="fb-fs-b" data-schedsize-step="rowHeight|-4" title="Shorter rows">&minus;</button>' +
      '<input class="fb-fs-inp" id="pref-rowh-inp" type="text" inputmode="numeric" value="' + PREFS.rowHeight + '" title="Row height, px (56–160)">' +
      '<button class="fb-fs-b" data-schedsize-step="rowHeight|4" title="Taller rows">+</button></span></label>' +
    '<label class="setting-field"><span>Column width</span><span class="fb-fs" aria-label="Column width">' +
      '<button class="fb-fs-b" data-schedsize-step="colWidth|-10" title="Narrower columns">&minus;</button>' +
      '<input class="fb-fs-inp" id="pref-colw-inp" type="text" inputmode="numeric" value="' + PREFS.colWidth + '" title="Truck column width, px (100–320)">' +
      '<button class="fb-fs-b" data-schedsize-step="colWidth|10" title="Wider columns">+</button></span></label>' +
    "</div>" +
    '<div class="sched-preview"><table class="grid"><tbody><tr class="slotrow">' +
    '<td style="width:var(--col-w,150px)"><div class="cell">' + chip1 + "</div></td>" +
    '<td style="width:var(--col-w,150px)"><div class="cell">' + chip2 + "</div></td>" +
    "</tr></tbody></table></div></section>";
}
function settingsAppearance() {
  var fontName = (FONTS.filter(function (f) { return f[0] === (PREFS.font || ""); })[0] || FONTS[0])[1];
  var h = '<div class="settings-grid">';
  h += '<section class="set-card set-theme"><div class="set-title"><div><div class="set-h">Theme</div>' +
    '<p>Light, dark, or match this device.</p></div></div>' +
    '<div class="setting-choices" role="group" aria-label="Theme">' + prefBtn("theme", "system", "System") +
    prefBtn("theme", "light", "Light") + prefBtn("theme", "dark", "Dark") + "</div>" +
    '<div class="theme-note">Additional themes can include their own texture and motion.</div></section>';
  h += '<section class="set-card accent-card set-accent"><div class="set-title"><div><div class="set-h">Accent</div>' +
    '<p>Choose a color.</p></div></div>' +
    '<div class="accent-palette" role="group" aria-label="Accent colors">' + accentPresetButtons(ACCENT_PRESETS) + '</div>' +
    savedAccentsHtml() +
    '<div class="accent-preview" id="accent-preview"><span class="accent-dot"></span><b>Selected accent</b>' +
      '<span id="accent-value">' + PREFS.accent + '</span></div>' +
    '<div class="custom-accent"><button class="custom-accent-toggle" data-custom-accent-toggle="1" aria-expanded="' + CUSTOM_ACCENT_OPEN +
      '"><span aria-hidden="true">' + (CUSTOM_ACCENT_OPEN ? '&#9662;' : '&#9656;') + '</span>Custom color</button>' +
      (CUSTOM_ACCENT_OPEN ? '<div class="custom-accent-body">' +
      '<div class="accent-editor"><input type="color" id="pref-accent-wheel" value="' + PREFS.accent +
        '" aria-label="Choose custom accent color"><div class="accent-values"><label for="pref-accent-hex">Hex color</label>' +
        '<input id="pref-accent-hex" class="accent-hex" value="' + PREFS.accent + '" maxlength="7" spellcheck="false"></div>' +
        '<button class="btn sm pri" data-accent-save="1">Save color</button></div>' +
      '<div class="setting-help" id="accent-status">Hard-to-read colors are blocked automatically.</div></div>' : '') + '</div></section>';
  h += '<section class="set-card set-type"><div class="set-title"><div><div class="set-h">Typography</div>' +
    '<p>Interface font, and the font for labels and numbers.</p></div></div>' +
    '<label class="setting-field font-field"><span>Interface font</span><select id="pref-font-select">' +
      FONTS.map(function (f) { return '<option value="' + esc(f[0]) + '"' + ((PREFS.font || "") === f[0] ? " selected" : "") +
        ' style="font-family:' + (f[0] || "inherit") + '">' + esc(f[1]) + "</option>"; }).join("") +
    '</select></label>' +
    '<label class="setting-field font-field"><span>Label and number font</span><select id="pref-mono-select">' +
      MONO_FONTS.map(function (f) { return '<option value="' + esc(f[0]) + '"' + ((PREFS.monoFont || "") === f[0] ? " selected" : "") +
        ' style="font-family:' + (f[0] || "inherit") + '">' + esc(f[1]) + "</option>"; }).join("") +
    '</select></label><div class="font-sample" style="font-family:' + (PREFS.font || "inherit") + '">' +
      '<span>' + esc(fontName) + '</span><strong>SAMPLE CUSTOMER</strong>' +
      '<p>Sample Driver · Sample Truck · 24 PAL · Sample Order · EARLY</p></div></section>';
  h += "</div>";
  h += orderNumberingHtml();
  h += schedulerSizingHtml();
  h += '<div class="settings-save-note">Appearance and sizing are saved on this device. Workspace numbering applies to everyone.</div>';
  return h;
}

function orderNumberingHtml() {
  var cfg = orderNumberSettings();
  return '<section class="set-card set-wide numbering-card"><div class="set-title"><div><div class="set-h">Order numbering</div>' +
    '<p>Controls new numbers only. Existing orders are never renamed.</p></div>' +
    '<button class="btn pri" data-numbering-save="1">Save numbering</button></div>' +
    '<div class="numbering-grid">' +
      '<div class="numbering-group"><h3>Bag Orders</h3>' +
        '<label class="setting-field"><span>Format</span><input id="numbering-internal-pattern" value="' + esc(cfg.internal_pattern) + '"></label>' +
        '<label class="setting-field"><span>Department code</span><input id="numbering-internal-dept" value="' + esc(cfg.internal_department) + '" maxlength="20"></label>' +
        '<div class="number-example">Example <b id="numbering-internal-example">' + esc(orderPatternExample(cfg.internal_pattern)) + '</b></div>' +
        '<p>Used when you reserve one number or a whole block.</p></div>' +
      '<div class="numbering-group"><h3>External Orders</h3>' +
        '<label class="setting-field"><span>Format</span><input id="numbering-external-pattern" value="' + esc(cfg.external_pattern) + '"></label>' +
        '<label class="setting-field"><span>Department code</span><input id="numbering-external-dept" value="' + esc(cfg.external_department) + '" maxlength="20"></label>' +
        '<div class="number-example">Example <b id="numbering-external-example">' + esc(orderPatternExample(cfg.external_pattern)) + '</b></div>' +
        '<p>External numbers are still typed in; this sets the current example and reporting code.</p></div>' +
    '</div><div class="setting-help numbering-help">Use {MM}, {YY}, or {YYYY} for dates. Put {####} wherever the sequence belongs; Bag Orders need one sequence block for bulk reservations. Other characters stay as typed.</div></section>';
}
function accentPresetButtons(colors) {
  return colors.map(function (p) {
    var on = normalizeHex(p[0]) === normalizeHex(PREFS.accent);
    return '<button class="accent-swatch' + (on ? ' on' : '') + '" data-accent-pick="' + p[0] +
      '" title="' + p[0] + '" aria-label="Use accent ' + p[0] +
      '" aria-pressed="' + on + '" style="--swatch:' + p[0] + '"></button>';
  }).join("");
}
function savedAccentsHtml() {
  if (!SAVED_ACCENTS.length) return "";
  return '<div class="saved-accents"><div class="accent-section-label">Saved colors</div><div class="saved-accent-list">' +
    SAVED_ACCENTS.map(function (hex) {
      var on = normalizeHex(hex) === normalizeHex(PREFS.accent);
      return '<span class="saved-accent"><button class="accent-swatch mini' + (on ? ' on' : '') +
        '" data-accent-pick="' + hex + '" aria-label="Use saved color ' + hex + '" aria-pressed="' + on +
        '" style="--swatch:' + hex + '"></button><button class="saved-accent-remove" data-accent-forget="' + hex +
        '" aria-label="Remove saved color ' + hex + '" title="Remove saved color">&times;</button></span>';
    }).join("") + '</div></div>';
}
function settingsShortcuts() {
  var h = '<div class="settings-section-title"><div><div class="set-h">Keyboard shortcuts</div><p>Change the key for any action below.</p></div></div>' +
    '<div class="note-bar">Shortcuts never fire ' +
    'while you are typing in a field. Click <b>Record</b>, press the shortcut you want, or press Escape to cancel. ' +
    "If a combo is already assigned, it moves to the new action.</div>";
  h += '<div class="set-card" style="padding:6px 8px"><table class="sc-table"><tbody>';
  SHORTCUTS.forEach(function (s) {
    var rec = RECORDING === s.id;
    h += "<tr><td class=\"sc-lb\">" + esc(s.label) + "</td>" +
      '<td class="sc-key"><span class="kbd">' + (rec ? "press keys..." : esc(keyLabel(KEYMAP[s.id]))) + "</span></td>" +
      '<td class="sc-act"><button class="btn sm' + (rec ? " pri" : "") + '" data-screc="' + s.id + '">' +
      (rec ? "Cancel" : "Record") + "</button>" +
      '<button class="btn sm" data-screset="' + s.id + '">Reset</button></td></tr>';
  });
  h += "</tbody></table></div>";
  h += '<div class="set-row"><button class="btn" data-scresetall="1">Reset All To Defaults</button></div>';
  return h;
}
function settingsHelp() {
  var faqs = [
    ["Scheduler",
      "Scroll through the calendar or enter a date in the header to jump to it. <b>Today</b> returns to the current date. " +
      "Click an empty cell to add a note, drag an order card to schedule or move it, and click a card to open the order. " +
      "Current Week and Driver Tabs show the same schedule in field-ready layouts."],
    ["The three order lists",
      "<b>Bag Orders</b> tracks the bagger’s customer orders. <b>Internal Freight</b> tracks department-to-department " +
      "moves and their mileage/transfer charge; these are not customer invoices. <b>External Orders</b> tracks broker " +
      "work, routes, documents, and billing. Bare reserved Bag Order rows and cancelled orders are not included in the active count."],
    ["Order numbers",
      "Use <b>Add Orders</b> in Bag Orders to reserve a sequential block for a month, year, starting number, and quantity. " +
      "<b>+ Add one</b> reserves the next number in the selected month. Administrators can change both order-number formats " +
      "and reporting department codes under <b>Settings → General</b>. A format change applies only to new numbers; historical numbers stay unchanged."],
    ["External routes and rate confirmations",
      "Create a blank External Order or drop a rate confirmation into the drop area. A normal order has one pickup and one " +
      "delivery; open the route editor when an order needs additional stops. External order numbers remain editable and can be entered when available."],
    ["Documents and billing",
      "Attach rate confirmations, PODs, and invoices from an order. <b>View</b> opens a document in the app and <b>Download</b> " +
      "saves a copy. Loose files are matched when the app finds a reliable order or load number; anything unresolved stays in " +
      "Billing for manual attachment. Billing downloads the merged package once the needed paperwork is attached."],
    ["Database tables",
      "Edit a cell directly. Use the numbered gutter to select one or several rows, then use the table action for archive or delete. " +
      "The header <b>+</b> adds a field, and Manage Columns controls field order and visibility. Archived directory records remain on historical orders."],
    ["Mileage, delivery dates, and rates",
      "<b>Sync Delivery Dates</b> copies completed schedule dates back to orders, saves Motive's miles for those days, and opens a window listing the delivered " +
      "orders that still need mileage. Type the miles (and change the cost if you need to), Save, and the order leaves the list. The Motive tab under Reports shows each truck's day."],
    ["Settings and shortcuts",
      "General contains theme, accent, font, order numbering, and Scheduler sizing. Shortcuts can be " +
      "re-recorded, and <b>Add shortcut</b> gives an action an additional key combination."],
    ["Undo and history",
      "Undo and Redo cover changes made in the current session. Open History for the shared audit trail and " +
      "review a reversible change before restoring it. External actions such as sending data to another service remain recorded but are not reversed remotely."],
    ["Reports",
      "Choose a date range in Reports, then export the order report for analysis in Excel. Internal Freight has its own transfer report. " +
      "Exports use stored order fields and department codes; they do not depend on the visible order-number pattern."]
  ];
  return faqs.map(function (f) {
    return '<div class="set-card"><div class="set-h">' + f[0] + '</div>' +
      '<p style="font-size:var(--fs-body);color:var(--ink-2);line-height:1.55">' + f[1] + "</p></div>";
  }).join("");
}

/* ── Nav ─────────────────────────────────────────────────────────────────── */
var NAV = [
  { k: "dispatch", t: "Dispatch", subs: [{ k: "sched", t: "Scheduler" }, { k: "cw", t: "Current Week" },
      { k: "driver", t: "Driver Tabs" }] },
  { k: "orders", t: "Orders", subs: [{ k: "int", t: "Bag Orders" }, { k: "xfer", t: "Internal Freight" },
      { k: "ext", t: "External Orders" }] },
  { k: "billing", t: "Billing", subs: [{ k: "bill", t: "Invoices & Packages" }] },
  { k: "reports", t: "Reports", subs: [{ k: "rep", t: "Export & Reports" }] },
  { k: "database", t: "Database", subs: [{ k: "bagger", t: "Bagger Customers" }, { k: "brokers", t: "External Customers" },
      { k: "pickdrop", t: "Pick/Drop List" }, { k: "fleet", t: "Fleet" }] }
];
/* Settings (D54) is reached from the header gear, not the main nav, so it lives
   outside NAV — subsOf resolves its tabs specially. */
var SETTINGS_SUBS = [{ k: "appearance", t: "General" }, { k: "shortcuts", t: "Shortcuts" }];
function subsOf(s) {
  var subs;
  if (s === "settings") {
    subs = SETTINGS_SUBS;
  } else {
    subs = [];
    for (var i = 0; i < NAV.length; i++) if (NAV[i].k === s) subs = NAV[i].subs;
    if (s === "database") {
      /* Built-in databases come from the entities metadata now (renamable +
         reorderable, D85); custom sheets (D74) follow. */
      var ents = (DB.entities || []).slice().sort(function (a, b) { return a.sort_order - b.sort_order; });
      // Custom entities (D85 Phase 2) have no slug — addressed as "custom:<id>",
      // same convention as "sheet:<id>" (entityByKey resolves both).
      if (ents.length) subs = ents.map(function (e) { return { k: e.slug || ("custom:" + e.id), t: e.name }; });
      subs = subs.concat((DB.sheets || []).map(function (sh) { return { k: "sheet:" + sh.id, t: sh.name }; }));
    }
  }
  return subs;
}
var RAIL_ON = { sched: 1, int: 1, xfer: 1, ext: 1, cw: 1, driver: 1 };

var RAIL_SHUT = (function () { try { return JSON.parse(localStorage.getItem("railShut") || "{}") || {}; } catch (e) { return {}; } })();
function railToggleGroup(name) {
  RAIL_SHUT[name] = !RAIL_SHUT[name]; if (!RAIL_SHUT[name]) delete RAIL_SHUT[name];
  try { localStorage.setItem("railShut", JSON.stringify(RAIL_SHUT)); } catch (e) { /* not saved on this device */ }
  renderRail();
}
document.addEventListener("click", function (e) { var g = e.target.closest && e.target.closest(".rail-div[data-railgrp]"); if (g) railToggleGroup(g.getAttribute("data-railgrp")); });
document.addEventListener("keydown", function (e) {
  if (e.key !== "Enter" && e.key !== " ") return;
  var g = e.target.closest && e.target.closest(".rail-div[data-railgrp]"); if (g) { e.preventDefault(); railToggleGroup(g.getAttribute("data-railgrp")); }
});
/* ── Shared Staging ───────────────────────────────────────────────────────────────────────────────────────
   STAGED is this screen's copy of the Staging line. The real one lives on the orders themselves (orders.autofill._staged, a number that
   puts the order in line; no new table), so two dispatchers see the same loads: a change made here is written right after the rail redraws
   (stageSyncUp), and a change made on the other screen arrives with the next live update and is read back in reload() (stageFromDB). */
var STAGE = { srv: [], writes: 0 };
function stageFromDB() {
  var srv = (DB.orders || []).filter(function (o) { return o.autofill && o.autofill._staged != null; })
    .sort(function (a, b) { return a.autofill._staged - b.autofill._staged; }).map(function (o) { return o.id; });
  STAGE.srv = srv.slice();
  if (STAGE.writes > 0) return;           // one of your own changes is still being saved: it wins
  STAGED = srv.slice();
}
function stageWrite(id, val) {
  var o = order(id); if (!o) return Promise.resolve();
  var cur = Object.assign({}, o.autofill || {});
  if (val == null) delete cur._staged; else cur._staged = val;
  var next = Object.keys(cur).length ? cur : null;
  o.autofill = next;
  return api("order/update", { id: id, autofill: next });
}
function stageSyncUp() {
  var known = function (id) { return !!order(id); };
  var inSrv = {}, inLoc = {}; STAGE.srv.forEach(function (id) { inSrv[id] = 1; }); STAGED.forEach(function (id) { inLoc[id] = 1; });
  var add = STAGED.filter(function (id) { return !inSrv[id] && known(id); }), rem = STAGE.srv.filter(function (id) { return !inLoc[id] && known(id); });
  var reorder = !add.length && !rem.length && STAGED.length > 1 && STAGED.filter(known).join("|") !== STAGE.srv.filter(known).join("|");
  if (!add.length && !rem.length && !reorder) return;
  STAGE.srv = STAGED.filter(known); STAGE.writes++;
  var base = Date.now(), ops = [];
  if (reorder) STAGED.forEach(function (id, i) { if (known(id)) ops.push(stageWrite(id, base + i)); });
  else {
    add.forEach(function (id) { ops.push(stageWrite(id, base + STAGED.indexOf(id))); });
    rem.forEach(function (id) { ops.push(stageWrite(id, null)); });
  }
  Promise.all(ops).catch(function (e) { toast("Couldn't save Staging: " + (e && e.message || "try again"), true); })
    .then(function () { STAGE.writes--; });
}
function renderRail() {
  var list = STAGED.filter(function (id) {
    if (!Q) return true;
    var o = order(id); if (!o) return false;
    var c = buildChip(o);
    return (c.title + " " + c.line).toLowerCase().indexOf(Q.toLowerCase()) >= 0;
  });
  // Grouped by kind, each group under a labeled line: External, Bag Orders, Internal Freight.
  var groups = [["External", []], ["Bag Orders", []], ["Internal Freight", []]];
  list.forEach(function (id) {
    var o = order(id); if (!o) return;
    groups[o.is_transfer ? 2 : isExt(o) ? 0 : 1][1].push(id);
  });
  $("#rail").innerHTML = list.length ? groups.filter(function (g) { return g[1].length; }).map(function (g) {
    var shut = !!RAIL_SHUT[g[0]];
    // Click the label to fold the group away; a folded group shows just how many are inside.
    return '<div class="rail-div' + (shut ? " shut" : "") + '" data-railgrp="' + esc(g[0]) + '" role="button" tabindex="0" aria-expanded="' + !shut +
      '" title="' + (shut ? "Show" : "Hide") + " " + esc(g[0]) + '"><span>' + esc(g[0]) + "</span>" + (shut ? '<b class="rail-ct">' + g[1].length + "</b>" : "") +
      '<i class="rail-arr">' + (shut ? "&darr;" : "&uarr;") + "</i></div>" +
      (shut ? "" : g[1].map(function (id) { return chipHtml(order(id), true, 'data-from="STAGE"'); }).join(""));
  }).join("") : emptyStateHtml(Q ? "No matches for “" + Q + "”" : "Nothing staged");
  $("#stage-ct").textContent = STAGED.filter(function (id) { return order(id); }).length;
  stageSyncUp();
}
/* Reorder within the Staging rail by drag (D197, Nate: "id also like to be
   able to re order the loads in the staging area by clicking and dragging
   them") — STAGED is a plain client array (never persisted, D51), so this
   is just an array splice + repaint, no server round trip. Same insert-
   position convention as reorderGridRow (04-views.js): splice out the
   dragged id, then splice it in at the target's original index — while a
   live filter (Q) is active, the target's index in the full STAGED array
   still resolves correctly since both ids are looked up by identity, not
   by their filtered-list position. */
function reorderStagedRow(draggedId, targetId) {
  if (draggedId === targetId) return;
  var from = STAGED.indexOf(draggedId), to = STAGED.indexOf(targetId);
  if (from < 0 || to < 0) return;
  var moved = STAGED.splice(from, 1)[0];
  STAGED.splice(to, 0, moved);
  renderRail();
}
/* D170/D205: persisted $/mile rate + minimum charge, at the far right of the
   global formatting toolbar on Orders pages. Nate: "why dont we have an adjustable rate thing... that
   changes the rate calc... only changes what it calculates that run not
   what it was previously." Blur saves to the server (DB.internal_freight_rate
   is the bootstrap-loaded current value); it's applied to every internal-
   flavored order (Bag Orders + Internal Freight transfers) that has miles
   but no charge yet automatically whenever Sync mileage runs — never touches
   an order that already has one, and there's no separate manual button
   (Nate: "i dont want the calc freight button to exist"). Collapsed behind
   a bare arrow, not a button pill (Nate: "i just want the arrow") — points
   left closed, right open (Nate's explicit direction, not the usual
   disclosure-triangle convention — and per D201, plain angle brackets now,
   not the triangle glyph: "i dont like the little triangle thing"). */
function internalFreightRateHtml() {
  var cfg = DB.internal_freight_rate || { rate_per_mile: 0, minimum_charge: 0 };
  return '<span class="ifr-bar' + (IFR_OPEN ? "" : " closed") + '" id="ifr-bar"><button class="rail-toggle-icon" id="ifr-toggle" title="' + (IFR_OPEN ? "Hide" : "Show") +
    ' internal rate" aria-label="Internal rate settings" aria-expanded="' + IFR_OPEN + '">' + (IFR_OPEN ? "&gt;" : "&lt;") + '</button><span class="ifr-body"><span class="lbl">Internal Rate $/Mi</span>' +
    '<input type="number" step="0.01" min="0" id="ifr-rate" class="rate-inp" placeholder="0.00" value="' +
      (cfg.rate_per_mile ? esc(String(cfg.rate_per_mile)) : "") + '" title="Internal freight rate per mile">' +
    '<span class="lbl">Min $</span>' +
    '<input type="number" step="0.01" min="0" id="ifr-min" class="rate-inp" placeholder="0.00" value="' +
      (cfg.minimum_charge ? esc(String(cfg.minimum_charge)) : "") + '" title="Minimum internal freight charge — 0 means no minimum, always miles × rate"></span></span>';
}
/* The IFR rate arrow + Sync mileage/Sync delivery dates buttons used to live
   embedded in the retired .subs tab bar (D200 removed it — Nate: "the order
   section... those tabs actually have buttons and functionality so we need
   to move that somewhere that fits the ui"). Sync actions apply across all
   three order kinds (D154), so each order tracker's own toolbar carries them
   as a `secondary` block, ahead of that tracker's own bulk-action buttons.
   D205 moved Internal Rate into the global formatting toolbar's far-right
   edge on Orders pages, leaving this page toolbar focused on sync/actions.
   #sync-all is click-delegated by id (07-events.js): it runs both syncs and shows the results window. */
function ordersToolbarExtras() {
  return '<button class="btn sm" id="sync-all" title="Pull delivery dates from the schedule, then add miles and cost to the delivered orders">' +
    icon("sync") + 'Sync Delivery Dates</button>';
}
/* ── Motive truck-days and the mileage review ─────────────────────────────
   Motive says how far each truck ran each day (odometers, first on, last off, hours). That is the true total.
   Bag orders and internal freight carry miles typed (or confirmed) on the order; whatever the truck ran beyond
   those is the External bucket, so Bag + Internal + External always adds up to Motive's total.
   One pull saves each truck-day to Supabase (motive_daily) and records the day as pulled, so a day is asked
   from Motive once. Today is never pulled (it is not finished). Sync Delivery Dates syncs the dates, makes sure
   Motive's days are saved, then opens the review window for delivered orders whose mileage is not confirmed. */
var MOT = { rows: {}, pulled: {}, from: "", to: "", loading: false, err: "", view: "day", day: "", pick: null, week: "" };
function motAddDays(iso, n) { var d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return rptIso(d); }
function motYesterday() { return motAddDays(TODAY, -1); }
function motMonday(iso) { var d = new Date(iso + "T12:00:00"), k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return rptIso(d); }
function motDaysBetween(a, b) { var out = [], d = a, n = 0; while (d <= b && n++ < 400) { out.push(d); d = motAddDays(d, 1); } return out; }
function motKey(truck, day) { return String(truck) + "|" + day; }
function motRow(truck, day) { return MOT.rows[motKey(truck, day)] || null; }
function motNum(v) { var n = v == null || v === "" ? null : Number(v); return n == null || isNaN(n) ? null : n; }
// Read saved truck-days for a range into MOT (merging).
function motLoad(from, to) {
  return api("motive/days-list", { from: from, to: to }).then(function (res) {
    (res.days || []).forEach(function (r) { MOT.rows[motKey(r.truck_number, String(r.day).slice(0, 10))] = r; });
    (res.pulled || []).forEach(function (d) { MOT.pulled[String(d).slice(0, 10)] = true; });
    return res;
  });
}
// Days in [from, to] that are finished (before today) and not saved yet.
function motMissing(from, to) {
  var last = motYesterday(); if (to > last) to = last;
  return from > to ? [] : motDaysBetween(from, to).filter(function (d) { return !MOT.pulled[d]; });
}
// Pull the given days from Motive (31 at a time) and save them. force = true re-pulls days already saved.
// Trips on the fleet's trucks with no driver logged in, noted "Yard Move in shop", go to the shop drivers (Shop Mechanic 1, or 2
// when 1 is busy). Runs with every Motive pull, finished days only, fleet trucks only; it never stops a pull when it can't run.
// Nothing is written to Motive until you confirm: the function first only LOOKS and returns its plan, a window lists the trips it
// would assign (all ticked), and only the ones you leave ticked are assigned.
function motAssignShop(from, to) {
  var fleet = (DB.trucks || []).filter(function (t) { return t.active !== false && t.number; }).map(function (t) { return String(t.number); });
  if (!fleet.length) return Promise.resolve(0);
  // Motive counts days in UTC, so an evening trip (after about 5 PM Pacific) is on the NEXT day there. Look one day further so
  // the last evening of the range is not missed; only trips noted "Yard Move in shop" are ever assigned, so the extra day is safe.
  var toNext = new Date(to + "T12:00:00"); toNext.setDate(toNext.getDate() + 1); var end = rptIso(toNext);
  return api("motive/unidentified", { start: from, end: end, trucks: fleet }).then(function (plan) {
    var rows = ((plan && plan.periods) || []).filter(function (p) { return p.assign_to && p.id; });
    if (!rows.length) return 0;
    return motConfirmShop(rows).then(function (ids) {
      if (!ids.length) return 0;
      return api("motive/unidentified", { start: from, end: end, trucks: fleet, apply: true, only_ids: ids }).then(function (r) {
        var res = (r && r.applied) || [], n = res.filter(function (x) { return x.ok; }).length;
        MOT.shopLast = (MOT.shopLast || 0) + n;
        if (res.length > n) toast((res.length - n) + " shop trip" + (res.length - n === 1 ? "" : "s") + " couldn't be assigned in Motive", true);
        return n;
      });
    });
  }, function () { return 0; });
}
// The window: one line per trip the function would assign. Resolves with the Motive ids left ticked ([] = skip). Closing the
// window any other way counts as skipping, so a pull never hangs on it.
function motConfirmShop(rows) {
  return new Promise(function (resolve) {
    var done = false, finish = function (ids) { if (done) return; done = true; if (obs) obs.disconnect(); closeModal(); resolve(ids); }, obs = null;
    var body = rows.map(function (p) {
      return '<tr><td><input type="checkbox" class="mshop-cb" data-id="' + esc(p.id) + '" checked></td><td><b>' + esc(p.truck || "") + "</b></td><td>" + esc(p.start_pacific || "") +
        '</td><td class="n">' + (p.distance != null ? esc(p.distance) : "") + "</td><td>" + esc(p.assign_to) + "</td></tr>";
    }).join("");
    openModal('<div class="modal-hd"><h2>Assign shop trips?</h2></div><div class="modal-body"><p style="margin:0 0 10px;color:var(--ink-2)">These trips on your trucks had no driver and are noted &ldquo;Yard Move in shop&rdquo;. ' +
      "Untick any you don&rsquo;t want given to a shop driver. Nothing is changed in Motive until you click Assign.</p>" +
      '<table class="data" style="min-width:0"><thead><tr><th style="width:28px"></th><th>Truck</th><th>Started (Pacific)</th><th class="n">Miles</th><th>Assign to</th></tr></thead><tbody>' + body + "</tbody></table></div>" +
      '<div class="modal-ft"><button class="btn" id="mshop-skip">Skip These</button><span style="flex:1"></span><button class="btn pri" id="mshop-go"></button></div>');
    var go = $("#mshop-go"), count = function () {
      var n = document.querySelectorAll("#modal .mshop-cb:checked").length; go.textContent = n ? "Assign " + n + " Trip" + (n === 1 ? "" : "s") : "Assign"; go.disabled = !n;
    };
    count();
    [].forEach.call(document.querySelectorAll("#modal .mshop-cb"), function (c) { c.onchange = count; });
    go.onclick = function () { finish([].map.call(document.querySelectorAll("#modal .mshop-cb:checked"), function (c) { return Number(c.dataset.id); })); };
    $("#mshop-skip").onclick = function () { finish([]); };
    var m = $("#modal"); obs = new MutationObserver(function () { if (!m.classList.contains("on")) finish([]); });
    obs.observe(m, { attributes: true, attributeFilter: ["class"] });
  });
}
function motPull(days) {
  if (!days.length) return Promise.resolve(0);
  days = days.slice().sort();
  var chunks = [], cur = [];
  days.forEach(function (d) {
    if (cur.length && (new Date(d) - new Date(cur[0])) / 864e5 > 30) { chunks.push(cur); cur = []; }
    cur.push(d);
  });
  if (cur.length) chunks.push(cur);
  var saved = 0;
  return chunks.reduce(function (p, ch) {
    return p.then(function () {
      var set = {}; ch.forEach(function (d) { set[d] = 1; });
      return motAssignShop(ch[0], ch[ch.length - 1]).then(function () { return api("motive/days", { start: ch[0], end: ch[ch.length - 1] }); }).then(function (res) {
        var rows = (res.days || []).filter(function (r) { return set[String(r.day).slice(0, 10)]; });
        return api("motive/days-save", { rows: rows, days: ch }).then(function () { saved += rows.length; });
      });
    });
  }, Promise.resolve()).then(function () { return motLoad(days[0], days[days.length - 1]); }).then(function () { return saved; });
}
// Make sure every day in the list is saved: load what exists, pull only what is missing.
function motEnsure(days) {
  if (!days.length) return Promise.resolve(0);
  var s = days.slice().sort(), from = s[0], to = s[s.length - 1];
  return motLoad(from, to).then(function () { return motPull(s.filter(function (d) { return d <= motYesterday() && !MOT.pulled[d]; })); });
}

// Orders that ran on this truck on this day (cancelled and the old 2025 history left out).
function motOrdersFor(truck, day) {
  return orders().filter(function (o) {
    return String(o.truck_number || "") === String(truck) && String(o.delivery_date || "").slice(0, 10) === day && o.stage !== "cancelled" && !isHistorical(o);
  });
}
function motIsInternal(o) { return o.kind === "internal" || o.is_transfer === true || o.is_transfer === "true"; }
// Bag / internal / external miles for one truck-day. External is whatever Motive recorded beyond the miles on bag and internal orders.
function motBuckets(truck, day) {
  var row = motRow(truck, day), T = row ? motNum(row.miles) : null, bag = 0, intf = 0, ext = [];
  motOrdersFor(truck, day).forEach(function (o) {
    if (!motIsInternal(o)) { ext.push(o); return; }
    var m = motNum(o.miles) || 0;
    if (o.is_transfer === true || o.is_transfer === "true") intf += m; else bag += m;
  });
  var rest = T == null ? null : T - bag - intf;
  return { total: T, bag: bag, intf: intf, ext: rest == null ? null : Math.max(0, rest), over: rest != null && rest < 0 ? -rest : 0, extOrders: ext };
}
function motFmtTime(iso) { if (!iso) return "—"; var d = new Date(iso); return isNaN(d) ? "—" : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); }   // 24-hour, e.g. 06:45 and 17:30
function motTruckDriver(truck) { var t = (DB.trucks || []).filter(function (x) { return String(x.number) === String(truck); })[0]; return t && t.driver_name || ""; }
function motFreightCost(miles) {
  var cfg = DB.internal_freight_rate || {}, r = Number(cfg.rate_per_mile) || 0, mn = Number(cfg.minimum_charge) || 0;
  return r > 0 && miles > 0 ? Math.round(Math.max(miles * r, mn) * 100) / 100 : null;
}

/* ── The review window ─────────────────────────────────────────────────── */
var MRV = { groups: [], note: "" };
function mrvRowFor(o) {
  var isInt = motIsInternal(o), conf = !!o.miles_confirmed_at, mi = motNum(o.miles), amt = motNum(o.internal_freight_amount);
  // a cost typed before delivery (or one that differs from miles x rate) is kept as typed; otherwise it follows the miles
  var manual = isInt && amt != null && (mi == null || Math.abs(amt - (motFreightCost(mi) || 0)) > 0.005);
  // done = confirmed in this window before, or already has both miles and a cost (typed on the order, or from the old sync)
  return { id: o.id, o: o, ext: !isInt, done: isInt && (conf || (mi != null && amt != null)), m: isInt ? mi : null, cost: manual ? amt : null, costShown: amt };
}
function mrvBuild() {
  var last = motYesterday(), first = motAddDays(TODAY, -31), by = {};   // the last 31 days, like the old sync
  orders().forEach(function (o) {
    if (!motIsInternal(o) || o.miles_confirmed_at || isHistorical(o) || o.stage === "cancelled") return;
    if (motNum(o.miles) != null && motNum(o.internal_freight_amount) != null) return;      // already has miles and a cost
    var day = String(o.delivery_date || "").slice(0, 10);
    if (!day || day > last || day < first) return;
    var truck = o.truck_number ? String(o.truck_number) : "", k = truck + "|" + day;
    by[k] = by[k] || { truck: truck, day: day, rows: [] };
  });
  Object.keys(by).forEach(function (k) {
    var g = by[k];
    var list = g.truck ? motOrdersFor(g.truck, g.day) : orders().filter(function (o) {
      return motIsInternal(o) && !o.truck_number && !o.miles_confirmed_at && !(motNum(o.miles) != null && motNum(o.internal_freight_amount) != null) && String(o.delivery_date || "").slice(0, 10) === g.day && !isHistorical(o) && o.stage !== "cancelled";
    });
    g.rows = list.map(mrvRowFor);
  });
  MRV.groups = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) {
    return a.day < b.day ? 1 : a.day > b.day ? -1 : String(a.truck).localeCompare(String(b.truck)); });
}
// What each row shows: typed miles, or a suggestion worked out from Motive's total. Pure function of the group.
function mrvCalc(g) {
  var row = g.truck ? motRow(g.truck, g.day) : null, T = row ? motNum(row.miles) : null;
  var ints = g.rows.filter(function (r) { return !r.ext; }), exts = g.rows.filter(function (r) { return r.ext; });
  var typed = 0; ints.forEach(function (r) { if (r.m != null) typed += r.m; });
  var info = { total: T, typed: typed, over: 0, extMiles: null, sug: {}, extRpm: null };
  if (T == null) return info;
  var rest = T - typed;
  if (rest < 0) info.over = -rest;
  var open = ints.filter(function (r) { return r.m == null && !r.done; });
  if (!exts.length) {
    var left = rest, k = open.length;
    open.forEach(function (r) { var v = k === 1 ? Math.max(0, Math.round(left * 10) / 10) : Math.max(0, Math.round(rest / open.length)); info.sug[r.id] = v; left -= v; k--; });
  }
  info.extMiles = Math.max(0, Math.round(rest * 10) / 10);
  if (exts.length) { var rev = exts.reduce(function (a, r) { return a + (motNum(r.o.external_rate) || 0); }, 0); if (rev && info.extMiles) info.extRpm = rev / info.extMiles; }
  return info;
}
function mrvLabel(o) { var l = syncOrderLabel(o); return l[0] + (l[1] ? " · " + l[1] : ""); }
function mrvCardsHtml() {
  if (!MRV.groups.length) return '<div class="sync-none">Nothing needs mileage right now.</div>';
  return MRV.groups.map(function (g, gi) {
    var c = mrvCalc(g), row = g.truck ? motRow(g.truck, g.day) : null, drv = (row && row.drivers) || motTruckDriver(g.truck);
    var h = '<div class="mrv-card"><div class="mrv-hd"><b>' + esc(g.truck || "No truck") + "</b>" + (drv ? " · " + esc(drv) : "") + " · " + esc(fmtLongDay(g.day)) +
      '<span class="mrv-tot">' + (c.total != null ? "Motive says <b>" + c.total + "</b> mi" : (g.truck ? "No Motive data for this day" : "No truck on these orders")) + "</span></div>" +
      '<div class="mrv-cols"><span>Type</span><span>Order</span><span>Miles</span><span>Cost</span><span>RPM</span></div>';
    g.rows.forEach(function (r, ri) {
      var o = r.o, type = r.ext ? "External" : o.is_transfer ? "Internal freight" : "Bag order", cls = r.ext ? "x" : o.is_transfer ? "i" : "b";
      if (r.ext) {
        var rate = motNum(o.external_rate);
        h += '<div class="mrv-r ext"><span class="mrv-tag ' + cls + '">' + type + "</span><span>" + esc(mrvLabel(o)) + '</span><span class="mrv-n">' +
          (c.extMiles != null ? c.extMiles : "") + '</span><span class="mrv-n mute">' + (rate != null ? "$" + rate.toLocaleString() + " rate" : "no rate") +
          '</span><span class="mrv-n">' + (c.extRpm ? "$" + c.extRpm.toFixed(2) : "") + "</span></div>";
        return;
      }
      if (r.done) {
        h += '<div class="mrv-r done"><span class="mrv-tag ' + cls + '">' + type + "</span><span>" + esc(mrvLabel(o)) + ' <small>(done)</small></span><span class="mrv-n">' +
          (motNum(o.miles) != null ? o.miles : "") + '</span><span class="mrv-n">' + (r.costShown != null ? "$" + r.costShown : "") + '</span><span></span></div>';
        return;
      }
      var sug = c.sug[r.id], mShown = r.m != null ? r.m : null, mm = mShown != null ? mShown : sug;
      var auto = mm != null ? motFreightCost(mm) : null;
      h += '<div class="mrv-r"><span class="mrv-tag ' + cls + '">' + type + "</span><span>" + esc(mrvLabel(o)) + '</span>' +
        '<input class="mrv-in' + (r.m == null ? " sug" : "") + '" data-mrv="' + gi + "|" + ri + '|m" value="' + (r.m != null ? r.m : "") + '" placeholder="' + (sug != null ? sug : "") + '" inputmode="decimal" aria-label="Miles">' +
        '<input class="mrv-in' + (r.cost == null ? " sug" : "") + '" data-mrv="' + gi + "|" + ri + '|c" value="' + (r.cost != null ? r.cost : "") + '" placeholder="' + (auto != null ? "$" + auto.toFixed(2) : "") + '" inputmode="decimal" aria-label="Cost">' +
        "<span></span></div>";
    });
    if (c.over) h += '<div class="mrv-flag bad">Over by ' + Math.round(c.over * 10) / 10 + " miles. Motive recorded " + c.total + ".</div>";
    else if (c.total != null && g.rows.some(function (r) { return r.ext; })) h += '<div class="mrv-flag">External gets whatever is left: ' + c.extMiles + " miles so far.</div>";
    return h + "</div>";
  }).join("");
}
function fmtLongDay(iso) { var d = new Date(iso + "T12:00:00"); return d.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" }); }
function mrvOpen(note) {
  mrvBuild(); MRV.note = note || "";
  openModal('<div class="modal-hd"><h2>Sync Delivery Dates</h2></div><div class="modal-body mrv-body">' +
    (MRV.note ? '<div class="note-bar">' + MRV.note + "</div>" : "") +
    '<p class="mrv-lead">Delivered orders from the last 31 days with no miles or no cost yet. Dashed boxes are suggestions: type over one and the leftover miles re-spread. Save confirms the miles and cost, and the order leaves this list. Orders that already have both are shown greyed so the day still adds up.</p>' +
    '<div id="mrv-cards">' + mrvCardsHtml() + "</div></div>" +
    '<div class="modal-ft"><button class="btn" id="modal-cancel">Close</button><button class="btn pri" id="mrv-save">Save</button></div>');
  $("#modal").classList.add("wide-modal", "sync-modal");
}
document.addEventListener("input", function (e) {
  var el = e.target.closest && e.target.closest("[data-mrv]"); if (!el) return;
  var p = el.dataset.mrv.split("|"), g = MRV.groups[+p[0]], r = g && g.rows[+p[1]]; if (!r) return;
  var v = el.value.replace(/[^0-9.]/g, ""), n = v === "" || v === "." ? null : Number(v), pos = el.selectionStart;
  if (p[2] === "m") r.m = n; else r.cost = n;
  $("#mrv-cards").innerHTML = mrvCardsHtml();
  var back = document.querySelector('[data-mrv="' + el.dataset.mrv + '"]'); if (back) { back.focus(); try { back.setSelectionRange(pos, pos); } catch (x) { /* not a text box */ } }
});
function mrvSave() {
  var jobs = [];
  MRV.groups.forEach(function (g) {
    var c = mrvCalc(g);
    g.rows.forEach(function (r) {
      if (r.ext || r.done) return;
      var m = r.m != null ? r.m : c.sug[r.id];
      if (m == null || m <= 0) return;                         // nothing to save yet: the order stays on the list
      jobs.push({ r: r, m: m });
    });
  });
  if (!jobs.length) { toast("Nothing to save yet.", true); return; }
  var btn = $("#mrv-save"); if (btn) btn.disabled = true;
  busyStart("Saving mileage…");
  var i = 0, failed = 0;
  (function next() {
    if (i >= jobs.length) {
      busyEnd();
      return reload().then(function () {
        closeModal(); toast("Saved " + (jobs.length - failed) + " order" + (jobs.length - failed === 1 ? "" : "s") + (failed ? " · " + failed + " failed" : ""), failed > 0); render();
      });
    }
    var j = jobs[i++], body = { order_id: j.r.id, miles: String(j.m) };
    if (j.r.cost != null) body.freight_amount = String(j.r.cost);        // a typed cost wins; otherwise the server works it out from the miles
    api("freight", body).then(function () { return api("order/update", { id: j.r.id, miles_confirmed_at: new Date().toISOString() }); })
      .catch(function (err) { failed++; console.error(err); toast(err.message, true); }).then(next);
  })();
}

/* ── Sync Delivery Dates: dates, then Motive's missing days, then the review ── */
function runSyncAll(btn) {
  if (btn.disabled) return;
  btn.disabled = true; busyStart("Syncing delivery dates…");
  var notes = [];
  api("sync-delivery-dates", {}).catch(function (err) { notes.push("Delivery dates: " + esc(err.message)); })
    .then(reload)
    .then(function () {
      busyStart("Reading Motive…");
      // every finished day of the last 31, not just the days with orders, so fleet and external miles are complete
      var days = motDaysBetween(motAddDays(TODAY, -31), motYesterday()), dayMap = days;
      return motEnsure(dayMap).catch(function (err) { notes.push("Motive: " + esc(err.message) + ". You can still type the miles by hand."); });
    })
    .then(function () { btn.disabled = false; busyEnd(); mrvOpen(notes.join(" · ")); })
    .catch(function (err) { btn.disabled = false; busyEnd(); toast(err.message, true); });
}
function syncOrderLabel(o) {
  if (o.is_transfer) return [o.notes || "Internal freight", o.transfer_department_name || ""];
  if (o.kind === "internal") return [o.rexius_order_no || "Bag order", o.customer_name || (o.customer_party_id && party(o.customer_party_id) ? party(o.customer_party_id).name : "")];
  var who = o.broker_name || o.customer_name || "";
  return [o.rexius_order_no || o.broker_load_no || "External order", who];
}
document.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("#mrv-save")) mrvSave(); });
function render() {
  // A drawn-again page would wipe an Employee # or Phone box that is being typed in: wait until you leave it (its blur handler redraws then).
  if (typeof empBusy === "function" && empBusy()) { EMP.pending = true; return; }
  if ((SUB === "cw" || SUB === "driver") && needsHistory(CW_START) && !HISTORY_FETCH)
    ensureHistory().then(function (got) { if (got) render(); });
  reindexLookups(); CELLS = cellContents(); buildOffDays(); buildDayNotes(); buildCatColor(); buildSheetCells(); buildGridFmt(); renderFmtBar();
  // #main's innerHTML is about to be replaced — the shared loc-suggest
  // portal (D228 follow-up) lives outside it and would otherwise survive
  // pointing at a now-detached SUGGEST_INPUT, a stale panel with nothing
  // real left to pick.
  var openSuggest = document.getElementById("loc-suggest-portal");
  if (openSuggest) openSuggest.style.display = "none";
  $("#conn").textContent = "";
  syncHeaderSeen();
  // The persistent top-level .sections/.subs bars are retired (D200). The
  // sidebar owns section navigation. Database and Settings use in-page tabs.
  renderSideNav();

  var main = $("#main");
  // The scheduler node is cached and re-inserted rather than rebuilt (below),
  // but a detached-and-reattached scrollable element loses its scrollTop in
  // most browsers — save it before main.innerHTML clears schedNode out of
  // the DOM, or switching away from Scheduler and back silently dumps the
  // view back to the top of its rolling window (D141).
  if (schedNode && schedNode.parentNode === main) schedScrollTop = schedNode.scrollTop;
  /* Redrawing the view you're already on (after a save/reload) puts every
     scrolling area back where it was; switching views starts at the top.
     Positions are matched by order, and the view's structure is the same
     from one draw to the next. */
  var viewKey = SEC + "|" + SUB + "|" + (SUB === "driver" ? DRIVER_VIEW : ""), SCROLL_SEL = ".grid-wrap, .pad, #main > div";
  var keepScroll = viewKey === LAST_VIEW_KEY ? [].map.call(main.querySelectorAll(SCROLL_SEL), function (el) { return [el.scrollTop, el.scrollLeft]; }) : null;
  var railEl = $("#rail"), railTop = railEl ? railEl.scrollTop : 0;
  var navEl = $("#sidenav-body"), navTop = navEl ? navEl.scrollTop : 0;
  LAST_VIEW_KEY = viewKey;
  if (!keepScroll) requestAnimationFrame(function () { [].forEach.call(main.querySelectorAll(".grid-wrap, .rpt-page"), function (el) { el.classList.add("page-in"); }); });
  main.innerHTML = ""; applyZoom();
  if (SEC === "database") main.insertAdjacentHTML("beforeend", databaseTabsHtml());
  if (SEC === "settings") main.insertAdjacentHTML("beforeend", settingsTabsHtml());
  var railOn = !!RAIL_ON[SUB];
  $("#bodywrap").classList.toggle("norail", !railOn);
  $("#rail-wrap").style.display = railOn ? "flex" : "none";

  if (SUB === "sched") {
    main.insertAdjacentHTML("beforeend", vScheduler());
    if (!schedNode) { schedNode = buildScheduler(); if (SCHED_KEEP) schedNeedsScroll = false; }
    SCHED_KEEP = false;
    main.appendChild(schedNode);
    requestAnimationFrame(function () { requestAnimationFrame(function () { SCHED_STAT.day = schedTopDay(); schedStatsPaint(); }); });
    /* On a fresh build, land the viewport on today once it's in the DOM (D53).
       Reusing the cached node instead just restores wherever it was (D141). */
    if (schedNeedsScroll) {
      schedNeedsScroll = false;
      requestAnimationFrame(function () {
        var el = document.getElementById("row-" + TODAY);
        if (el) el.scrollIntoView({ block: "center" });
      });
    } else {
      requestAnimationFrame(function () { schedNode.scrollTop = schedScrollTop; });
    }
  } else if (SUB === "cw" || SUB === "driver" || SUB === "int" || SUB === "xfer" || SUB === "ext" ||
             SUB === "bill" || SUB === "rep" || SEC === "database") {
    // Inserted straight into #main, not wrapped in a .pad (D137/D140,
    // extended to the three Orders trackers D237, and to Billing/Database
    // D256) — identical to how vScheduler()'s own toolbar+grid-wrap pair
    // are appended, so every list-style section now shares the same
    // header: zero-padding edge-to-edge width, real toolbar background
    // (no more `plain:true` for Billing/Database), and `.grid-wrap{flex:1}`
    // (already generic, not `.pad`-scoped) fills all remaining height
    // instead of sitting inset inside `.pad`'s own padding. Nate: "we do
    // need to create this header system for the database and billing
    // sections to match the app." Billing's own multiple stacked sections
    // (drop zones, unmatched docs, invoice pool, billing queue) are wrapped
    // in ONE `.grid-wrap` by `vBilling()` so they scroll together as a
    // single region below the fixed toolbar, same as before — just not
    // inset. Database's `.pad.grid-pad` hack (D93) is retired outright:
    // it was hand-rolling the exact same flex-fill-and-scroll behavior
    // `main`/`.grid-wrap` already provide generically, just with padding.
    main.insertAdjacentHTML("beforeend", SUB === "cw" ? vCurrentWeek() : SUB === "driver" ? vDriverView() :
      SUB === "int" ? vInternal() : SUB === "xfer" ? vInternalFreight() : SUB === "ext" ? vOrders("external") :
      SUB === "bill" ? vBilling() : SUB === "rep" ? vReports() : vDatabase(SUB));
  } else {
    var html = SUB === "rep" ? vReports() : vSettings(SUB);
    var pad = document.createElement("div");
    pad.className = "pad";
    pad.innerHTML = html;
    main.appendChild(pad);
  }
  if (SEC === "database" || SEC === "settings") {
    requestAnimationFrame(function () {
      var activeDbTab = document.querySelector("#database-tabs .sub-tab[aria-selected=true],#settings-tabs .sub-tab[aria-selected=true]");
      if (activeDbTab) activeDbTab.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }
  if (railOn) renderRail();
  if (keepScroll && keepScroll.length) {
    var els = main.querySelectorAll(SCROLL_SEL);
    keepScroll.forEach(function (p, i) { if (els[i] && (p[0] || p[1])) { els[i].scrollTop = p[0]; els[i].scrollLeft = p[1]; } });
  }
  if (railEl && $("#rail")) $("#rail").scrollTop = railTop;
  if (navEl && $("#sidenav-body")) $("#sidenav-body").scrollTop = navTop;
}
var LAST_VIEW_KEY = null, SCHED_KEEP = false, DRIVER_BOOTED = false;
var AUTOSTAGE_OFF = false;
function reload() { RELOADING++; return api("bootstrap").then(function (d) {
  // A reload rebuilds the Scheduler; keep the spot you were at instead of
  // snapping back to today.
  if (schedNode && schedNode.parentNode) { schedScrollTop = schedNode.scrollTop; SCHED_KEEP = true; }
  // Any order that wasn't here before this reload (a rate con, a pasted load, New Order, a copy) goes straight into the
  // Staging rail. Reserving a block of numbers or bulk-adding blanks turns this off for that one reload.
  var prevIds = DB && DB.orders ? DB.orders.map(function (o) { return o.id; }) : null;
  DB = d;
  stageFromDB();
  if (prevIds && prevIds.length && !AUTOSTAGE_OFF) {
    var seenIds = {}; prevIds.forEach(function (id) { seenIds[id] = 1; });
    var pmNew = placement();
    (d.orders || []).forEach(function (o) { if (!seenIds[o.id] && canStageOrder(o, pmNew[o.id])) STAGED.push(o.id); });
  }
  AUTOSTAGE_OFF = false;
  schedNode = null; render();
  if (typeof rptOnReload === "function") rptOnReload();
  if (!DRIVER_BOOTED) { DRIVER_BOOTED = true; loadDriverActivity(); }   // first load: bring in notes, scans, views
  if (typeof refreshDrawerChipPreview === "function") refreshDrawerChipPreview();
  // Keep the durable History panel current with whatever just changed —
  // reload() already runs after essentially every mutation in the app, so
  // this is "live" without any polling/websocket infrastructure (D134).
  if (typeof historyPanelOpen === "function" && historyPanelOpen()) loadHistoryPanel();
}).finally(function () { RELOADING--; }); }

/* ── Global search (D44) — type anything, it scrapes the already-loaded DB and
   jumps you to the match: an order opens its drawer, everything else navigates
   to the Database tab where it lives. Arrow keys + Enter, or click. */
/* ── Flexible date search (D55) ──────────────────────────────────────────────
   Type a date in the search bar to jump the rolling calendar there, in almost
   any format: "march 2025", "mar 15 2025", "03/04/25", "3-4-2025", ISO. */
var MONTHNAMES = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
function normYear(s) { var n = parseInt(s, 10); return n < 100 ? 2000 + n : n; }
function mkDateObj(y, mo, d, monthLevel) {
  var dt = new Date(Date.UTC(y, mo, d));
  return { ds: iso(dt), monthLevel: !!monthLevel, y: dt.getUTCFullYear(), mo: dt.getUTCMonth() };
}
function parseDateQuery(q) {
  q = (q || "").trim().toLowerCase();
  if (!q) return null;
  var m;
  if ((m = q.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)) && +m[2] >= 1 && +m[2] <= 12)
    return mkDateObj(+m[1], +m[2] - 1, +m[3], false);
  if ((m = q.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/)) &&
      +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31)
    return mkDateObj(m[3] != null ? normYear(m[3]) : +TODAY.slice(0, 4), +m[1] - 1, +m[2], false);
  var monIdx = null, tokens = q.split(/[\s,]+/);
  for (var i = 0; i < tokens.length; i++) if (MONTHNAMES.hasOwnProperty(tokens[i])) { monIdx = MONTHNAMES[tokens[i]]; break; }
  if (monIdx != null) {
    var nums = (q.match(/\d{1,4}/g) || []).map(Number), day = null, year = null;
    nums.forEach(function (n) { if (n >= 1000) year = n; else if (n > 31) year = normYear(String(n)); else if (day == null) day = n; });
    if (year == null) year = +TODAY.slice(0, 4);
    return day == null ? mkDateObj(year, monIdx, 1, true) : mkDateObj(year, monIdx, day, false);
  }
  return null;
}
function monthLabel(dq) { var n = MON[dq.mo]; return n.charAt(0) + n.slice(1).toLowerCase() + " " + dq.y; }
function prettyDate(ds) {
  return new Date(ds + "T00:00:00Z").toLocaleDateString(undefined,
    { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
/* Orders sitting on a given date on the board (any truck, any slot). */
function loadsOnDate(ds) {
  var seen = {}, res = [];
  for (var k in CELLS) if (k.indexOf("|" + ds + "|") >= 0) {
    var v = CELLS[k];
    if (v && v.oid && !seen[v.oid]) { seen[v.oid] = 1; var o = order(v.oid); if (o) res.push(o); }
  }
  return res;
}
function gotoDate(ds, oid) {
  SEC = "dispatch"; SUB = "sched"; SEL = null; render(); jumpTo(ds);
  if (oid) openOrder(oid);
}

var GS_RESULTS = [], GS_SEL = -1;
function searchResults(qraw) {
  var q = (qraw || "").trim().toLowerCase();
  var out = [];
  /* Date jump first — the top hit for a date-shaped query (D55). */
  var dq = parseDateQuery(q);
  if (dq && dq.monthLevel) {
    out.push({ type: "Date", label: "Go to " + monthLabel(dq), sub: "Scheduler",
      run: function () { gotoDate(dq.ds); } });
  } else if (dq) {
    out.push({ type: "Date", label: "Go to " + prettyDate(dq.ds), sub: "Scheduler",
      run: function () { gotoDate(dq.ds); } });
    loadsOnDate(dq.ds).forEach(function (o) {
      out.push({ type: "Load", label: buildChip(o).title + " · " + prettyDate(dq.ds),
        sub: o.rexius_order_no || o.broker_load_no || "",
        run: function () { gotoDate(dq.ds, o.id); } });
    });
  }
  if (q.length < 2) return out.slice(0, 14);
  function has() { for (var i = 0; i < arguments.length; i++) {
    var v = arguments[i]; if (v != null && String(v).toLowerCase().indexOf(q) >= 0) return true; } return false; }
  DB.orders.forEach(function (o) {
    var cust = o.customer_party_id && party(o.customer_party_id), brok = o.broker_party_id && party(o.broker_party_id);
    if (has(o.rexius_order_no, o.broker_load_no, o.po_number, o.delivery_number, o.notes,
            cust && cust.name, brok && brok.name)) {
      out.push({ type: o.kind === "internal" ? "Internal" : "Order",
        label: (o.rexius_order_no || o.broker_load_no || "no #") + " · " + buildChip(o).title,
        sub: [o.po_number && "PO " + o.po_number, o.broker_load_no && "load " + o.broker_load_no,
              o.delivery_number && "del " + o.delivery_number].filter(Boolean).join(" · "),
        run: function () { openOrder(o.id); } });
    }
  });
  DB.parties.forEach(function (p) {
    var isCust = p.is_customer && !p.customer_archived_at;
    var isBroker = p.is_broker && !p.broker_archived_at;
    if (!isCust && !isBroker && !p.is_carrier) return;
    if (has(p.name, p.ap_email, p.manager_name, p.rexius_customer_no, p.notes)) {
      out.push({ type: isCust ? "Customer" : isBroker ? "Broker" : "Carrier", label: p.name,
        sub: p.rexius_customer_no ? "Rexius #" + p.rexius_customer_no : (p.ap_email || p.manager_name || ""),
        run: function () { SEC = "database"; SUB = isCust ? "bagger" : "brokers"; SEL = null; render(); } });
    }
  });
  DB.locations.forEach(function (l) {
    var owner = l.party_id ? party(l.party_id) : null;
    if (owner && owner.is_customer && owner.customer_archived_at) return;
    if (has(l.name, l.city, l.address)) {
      out.push({ type: "Location", label: l.name, sub: [l.city, l.state].filter(Boolean).join(", "),
        run: function () { SEC = "database"; SUB = l.party_id ? "bagger" : "pickdrop"; SEL = null; render(); } });
    }
  });
  DB.drivers.forEach(function (d) {
    if (has(d.full_name)) out.push({ type: "Driver", label: d.full_name, sub: "",
      run: function () { SEC = "database"; SUB = "fleet"; SEL = null; render(); } });
  });
  DB.trucks.forEach(function (t) {
    if (has(t.number)) out.push({ type: "Truck", label: "Truck " + t.number, sub: t.eq || "",
      run: function () { SEC = "database"; SUB = "fleet"; SEL = null; render(); } });
  });
  return out.slice(0, 14);
}
function paintSearch() {
  var panel = $("#gsearch-results");
  if (!GS_RESULTS.length) { panel.style.display = "none"; panel.innerHTML = ""; return; }
  panel.innerHTML = GS_RESULTS.map(function (r, i) {
    return '<div class="gs-opt' + (i === GS_SEL ? " on" : "") + '" data-gsi="' + i + '">' +
      '<span class="gs-ty">' + esc(r.type) + "</span>" +
      '<span class="gs-lb">' + esc(r.label) + "</span>" +
      (r.sub ? '<span class="gs-sb">' + esc(r.sub) + "</span>" : "") + "</div>";
  }).join("");
  panel.style.display = "block";
}
function renderSearch() {
  GS_RESULTS = searchResults($("#gsearch").value); GS_SEL = GS_RESULTS.length ? 0 : -1; paintSearch();
  // Search covers older history too — fetch it once, then refresh the results.
  if ($("#gsearch").value.trim() && DB && DB.history_cutoff && !HISTORY_FETCH) {
    ensureHistory().then(function (got) {
      if (!got) return;
      applyHistory();
      if ($("#gsearch").value.trim()) renderSearch();
    });
  }
}
function gsActivate(i) {
  var r = GS_RESULTS[i]; if (!r) return;
  $("#gsearch-results").style.display = "none"; $("#gsearch").value = ""; GS_RESULTS = []; GS_SEL = -1;
  r.run();
}

/* ── Settings (D54) ──────────────────────────────────────────────────────── */
var CUSTOM_ACCENT_OPEN = false;
function vSettings(sub) {
  var h = '<div class="settings-head"><div><h2>Settings</h2><p>Personalize this workspace and manage your account.</p></div></div>';
  if (sub === "shortcuts") return '<div class="settings-shell">' + h + settingsShortcuts() + "</div>";
  if (sub === "timecalc") return '<div class="settings-shell">' + h + settingsTimeCalc() + "</div>";
  if (sub === "admin") return '<div class="settings-shell">' + h + settingsAdmin() + "</div>";
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
      '<div class="note">&#9873; Call ahead before delivery</div>' +
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
  var h = settingsProfileHtml();
  h += '<div class="settings-grid">';
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
    '<p>Interface font.</p></div></div>' +
    '<label class="setting-field font-field"><span>Interface font</span><select id="pref-font-select">' +
      FONTS.map(function (f) { return '<option value="' + esc(f[0]) + '"' + ((PREFS.font || "") === f[0] ? " selected" : "") +
        ' style="font-family:' + (f[0] || "inherit") + '">' + esc(f[1]) + "</option>"; }).join("") +
    '</select></label><div class="font-sample" style="font-family:' + (PREFS.font || "inherit") + '">' +
      '<span>' + esc(fontName) + '</span><strong>SAMPLE CUSTOMER</strong>' +
      '<p>Sample Driver · Sample Truck · 24 PAL · Sample Order · EARLY</p></div></section>';
  h += settingsConnectionsHtml();
  h += "</div>";
  if (!LOCAL_AUTH.enabled || (DB && DB.me && DB.me.is_admin)) h += orderNumberingHtml();
  h += schedulerSizingHtml();
  h += '<div class="settings-save-note">Profile, appearance, and sizing are saved on this device. Workspace numbering applies to everyone.</div>';
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
function settingsProfileHtml() {
  var h = '<section class="set-card profile-card set-wide"><div class="settings-avatar">' + esc(initials(profileName)) +
    '</div><div class="profile-copy"><div class="set-h">Your profile</div><h3>' + esc(profileName) +
    '</h3><p>Your display name sets the initials shown in the header.</p></div>' +
    '<div class="profile-edit"><label class="setting-field"><span>Display name</span>' +
    '<input id="profile-name-input" value="' + esc(profileName) + '" autocomplete="name"></label>' +
    '<button class="btn pri" data-profile="savename">Save profile</button></div></section>';
  return h;
}
function settingsConnectionsHtml() {
  var authUser = dashboardAuth.user();
  var h = '<section class="set-card set-account"><div class="set-title"><div><div class="set-h">Account</div>' +
    '<p>Sign-in and access for this workspace.</p></div></div>';
  if (LOCAL_AUTH.enabled && DB && DB.me) {
    h += '<div class="connection-row"><div><span class="status-dot on"></span><b>' + esc(DB.me.username || profileName) +
      '</b><small>Local account · ' + (DB.me.is_admin ? "Administrator" : "Restricted access") + '</small></div>' +
      '<span class="connection-actions">' + (DB.me.is_admin ? '<button class="btn sm pri" data-navto="settings|admin">Manage access</button>' : '') +
      '<button class="btn sm" data-profile="signout">Sign out</button></span></div>';
  } else if (!dashboardAuth.config.enabled) {
    h += '<div class="connection-row"><div><span class="status-dot"></span><b>Local workspace</b>' +
      '<small>Hosted sign-in is not connected yet.</small></div></div>';
  } else {
    h += '<div class="connection-row"><div><span class="status-dot on"></span><b>' +
      esc((authUser && authUser.email) || "Microsoft account") + '</b><small>Microsoft sign-in</small></div>' +
      '<button class="btn sm" data-profile="signout">Sign out</button></div>';
  }
  h += "</section><section class=\"set-card set-outlook\"><div class=\"set-title\"><div><div class=\"set-h\">Outlook</div>" +
    "<p>Connection used when billing drafts are created.</p></div></div>";
  if (!dashboardAuth.config.outlookEnabled) {
    h += '<div class="connection-row"><div><span class="status-dot"></span><b>Local mail</b>' +
      '<small>Outlook connection becomes available with hosted accounts.</small></div></div>';
  } else if (dashboardAuth.microsoftToken()) {
    h += '<div class="connection-row"><div><span class="status-dot on"></span><b>Outlook connected</b>' +
      '<small>Drafts are created in your mailbox.</small></div></div>';
  } else {
    h += '<div class="connection-row"><div><span class="status-dot"></span><b>Outlook disconnected</b>' +
      '<small>Connect before creating billing drafts.</small></div>' +
      '<button class="btn sm pri" data-profile="connectoutlook">Connect</button></div>';
  }
  h += "</section>";
  return h;
}
/* ── Access (D125) — manage restricted users' per-section access + the
   Scheduler date-range hard boundary. Only reachable by an admin (gated by
   settingsSubsFor()/canView above); the roster/grants aren't part of the
   normal bootstrap payload, so this section lazy-fetches once and re-renders
   when it lands, same idea as any other async panel. */
var ADMIN_ROSTER = null;
/* Which restricted-user rows are expanded (D259) — every grant checkbox
   toggle clears ADMIN_ROSTER and calls render(), which rebuilds the
   <details class="admin-row"> markup from scratch; without tracking this
   separately every row snapped shut after a single click, found live
   granting Test3 two permissions in a row. Same in-memory-object pattern
   as HISTORY_OPEN_DAYS/TRACKER_COLLAPSED_OPEN — session-only, not
   persisted. Kept in sync by the native `toggle` event (07-events.js),
   not just this file's own open-attribute write, so manually collapsing a
   row also survives the next unrelated re-render. */
var ADMIN_OPEN = {};
function grantableSubs() {
  var list = [];
  NAV.forEach(function (s) {
    subsOf(s.k).forEach(function (sub) { list.push({ section: s.k, sub: sub.k, label: s.t + " — " + sub.t }); });
  });
  SETTINGS_SUBS.forEach(function (sub) { list.push({ section: "settings", sub: sub.k, label: "Settings — " + sub.t }); });
  return list;
}
function settingsAdmin() {
  if (!ADMIN_ROSTER) {
    api("admin/users").then(function (j) {
      ADMIN_ROSTER = j.users || [];
      if (SEC === "settings" && SUB === "admin") render();
    }).catch(function (e) { toast(e.message, true); });
    return '<div class="empty">Loading roster…</div>';
  }
  var subs = grantableSubs();
  var h = '<section class="set-card admin-intro"><div class="set-title"><div><div class="set-h">Dashboard access</div>' +
    '<h3>People and permissions</h3><p>This is where administrators let other accounts see and interact with the dashboard. New accounts begin with a read-only Scheduler; grant only the pages and edit rights they need.</p>' +
    '</div><span class="admin-count">' + ADMIN_ROSTER.filter(function (u) { return !u.is_admin; }).length +
    ' restricted</span></div><div class="setting-help">Scheduler access defaults to 3 weeks back and 1 week forward until you set a custom range.</div></section>';
  var restricted = ADMIN_ROSTER.filter(function (u) { return !u.is_admin; });
  restricted.forEach(function (u) {
    var byKey = {};
    u.grants.forEach(function (g) { byKey[g.section + "|" + g.sub] = g.can_edit; });
    var viewCt = 0, editCt = 0;
    subs.forEach(function (s) {
      var k = s.section + "|" + s.sub;
      if (k in byKey) { viewCt++; if (byKey[k]) editCt++; }
    });
    var hasCustomWindow = !!(u.view_start || u.view_end);
    h += '<details class="admin-row" data-admin-row="' + u.id + '"' + (ADMIN_OPEN[u.id] ? " open" : "") +
      '><summary><span class="admin-avatar">' + esc(initials(u.username)) + '</span>' +
      '<span class="admin-row-name">' + esc(u.username) + "</span>" +
      '<span class="admin-row-sum">' + viewCt + " view · " + editCt + " edit · " +
      (hasCustomWindow ? "custom range" : "default range") + "</span>" +
      '<button class="btn sm bad" data-admin-user-del="' + u.id + '" title="Delete user">Delete</button>' +
      "</summary>";
    h += '<table class="sc-table admin-grid"><thead><tr><th></th><th>View</th><th>Edit</th></tr></thead><tbody>';
    subs.forEach(function (s) {
      var key = s.section + "|" + s.sub, viewOn = key in byKey, editOn = viewOn && byKey[key];
      h += "<tr><td class=\"sc-lb\">" + esc(s.label) + '</td>' +
        '<td class="sc-act"><input type="checkbox" data-admin-view="' + u.id + "|" + s.section + "|" + s.sub +
        '"' + (viewOn ? " checked" : "") + "></td>" +
        '<td class="sc-act"><input type="checkbox" data-admin-edit="' + u.id + "|" + s.section + "|" + s.sub +
        '"' + (editOn ? " checked" : "") + "></td></tr>";
    });
    h += "</tbody></table>";
    var wStart = u.view_start || u.default_view_start || "", wEnd = u.view_end || u.default_view_end || "";
    h += '<div class="admin-window"><span class="lbl">Scheduler date range</span><div class="admin-window-fields">' +
      '<input type="text" inputmode="numeric" aria-label="Scheduler start date" placeholder="MM/DD/YYYY" data-smartdate data-admin-window="' + u.id +
      '|start" data-last-iso="' + wStart + '" value="' + esc(isoToMdy(wStart)) + '"> to ' +
      '<input type="text" inputmode="numeric" aria-label="Scheduler end date" placeholder="MM/DD/YYYY" data-smartdate data-admin-window="' + u.id +
      '|end" data-last-iso="' + wEnd + '" value="' + esc(isoToMdy(wEnd)) + '"> ' +
      '<button class="btn sm" data-admin-window-save="' + u.id + '">Save Range</button> ' +
      (hasCustomWindow
        ? '<button class="btn sm" data-admin-window-clear="' + u.id + '">Reset To Default</button>'
        : "") + "</div></div>";
    h += "</details>";
  });
  if (!restricted.length)
    h += '<div class="empty">No restricted accounts yet — one is created the first time someone signs in.</div>';
  return h;
}
/* Time card calculator — replaced the Help & FAQ settings tab (moved to the
   profile menu as a popup instead, Nate: settings bar should hold this).

   D258 rebuild (Nate: modeled on redcort.com's free timecard calculator —
   "blank the first one is am second one is pm but u can switch it... easy
   to type into... single digits in minutes it goes to 08... in hours it
   just accepts it as the hour time"). Redcort's own hour/minute fields are
   two plain text inputs per time (not a native <input type="time">, which
   forces a browser-chrome picker and hides the "type single digits" flow
   entirely) plus a separate AM/PM toggle — matched here with `.tc-hh`/
   `.tc-mm` text inputs and a `.tc-ampm` button. Minutes zero-pad to 2
   digits on blur (`tcPadMinute`); hours do NOT — a typed "8" stays "8", it
   IS the 12-hour hour, only the AM/PM toggle decides which half of the
   military day it lands in (`tcMinutesOf`). Start defaults AM, End
   defaults PM, both independently click-to-toggle — same default redcort
   uses, confirmed live against the real page before building this.

   D258 also built a "look up from Motive" section here (date/truck/driver
   picker calling a new /api/motive/day-detail for odometer + on-duty-window
   lookup) — verified working live, then deliberately pulled at Nate's
   explicit ask: "i should manually find it if i need to find their time
   cards, and also if im training someone on this job i do not want them
   to rely on that for driver pay just a bad deal." Don't reintroduce an
   automated Motive-driven fill for this calculator — pay figures stay a
   manual lookup by design, not an oversight. */
function timeFieldHtml(id, label, defaultAmPm) {
  return '<label class="mf tc-field"><span>' + esc(label) + '</span><div class="tc-time">' +
    '<input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" class="tc-hh" id="tc-' + id +
    '-hh" placeholder="--" autocomplete="off" aria-label="' + esc(label) + ' hour">' +
    '<span class="tc-colon">:</span>' +
    '<input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" class="tc-mm" id="tc-' + id +
    '-mm" placeholder="--" autocomplete="off" aria-label="' + esc(label) + ' minute">' +
    '<button type="button" class="btn sm tc-ampm" id="tc-' + id + '-ampm" data-tc-ampm="' + id + '">' +
    defaultAmPm + "</button></div></label>";
}
function settingsTimeCalc() {
  return '<div class="set-card"><div class="set-h">Time card calculator</div>' +
    '<p style="font-size:var(--fs-body-sm);color:var(--ink-2);margin-bottom:10px">Enter a start and end time — get their ' +
    "military (24-hour) equivalents and the total hours between them. Start defaults to AM and End to PM; click either " +
    "to switch it.</p>" +
    '<div class="set-row">' + timeFieldHtml("start", "Start time", "AM") + timeFieldHtml("end", "End time", "PM") + "</div>" +
    '<div id="tc-out">' + timeCalcOutHtml() + "</div></div>";
}
/* hh/mm text inputs, not a real <input type="time"> (see block comment
   above) — typed content needs its own digit filtering, since a text input
   accepts anything. */
function tcSanitizeDigits(el) { el.value = el.value.replace(/[^0-9]/g, "").slice(0, 2); }
function tcPadMinute(el) { if (el.value.length === 1) el.value = "0" + el.value; }
function tcClampHour(el) {
  if (!el.value) return;
  var n = Math.max(1, Math.min(12, parseInt(el.value, 10) || 1));
  el.value = String(n);
}
function tcClampMinute(el) {
  if (!el.value) return;
  var n = Math.max(0, Math.min(59, parseInt(el.value, 10) || 0));
  el.value = String(n);
  tcPadMinute(el);
}
/* Returns minutes-since-midnight (military) for one of the two time
   fields, or null while it's incomplete — h stays 1-12 as typed (not
   zero-padded, D258), the AM/PM button's own text is the only thing that
   decides which 12-hour half it lands in. */
function tcMinutesOf(id) {
  var hh = document.getElementById("tc-" + id + "-hh"), mm = document.getElementById("tc-" + id + "-mm"),
    ap = document.getElementById("tc-" + id + "-ampm");
  if (!hh || !mm || !ap || !hh.value || !mm.value) return null;
  var h = parseInt(hh.value, 10), m = parseInt(mm.value, 10);
  if (isNaN(h) || isNaN(m) || h < 1 || h > 12 || m < 0 || m > 59) return null;
  return (h % 12) * 60 + m + (ap.textContent === "PM" ? 12 * 60 : 0);
}
function militaryFromMinutes(mins) {
  var h = Math.floor(mins / 60) % 24, m = mins % 60;
  return String(h).padStart(2, "0") + String(m).padStart(2, "0");
}
function timeCalcOutHtml() {
  var sm = tcMinutesOf("start"), em = tcMinutesOf("end");
  if (sm == null || em == null) return "";
  var total = em - sm; var overnight = total < 0; if (overnight) total += 24 * 60;
  var hrs = Math.floor(total / 60), mins = total % 60;
  var dec = (total / 60).toFixed(2).replace(/\.?0+$/, "");
  return '<div class="set-row"><span class="lbl">Start · military</span><b>' + militaryFromMinutes(sm) + "</b></div>" +
    '<div class="set-row"><span class="lbl">End · military</span><b>' + militaryFromMinutes(em) + "</b></div>" +
    '<div class="set-row"><span class="lbl">Total hours</span><b>' + hrs + "h " + mins + "m (" + dec + " hrs)</b></div>" +
    (overnight ? '<div class="note-bar">End is before start — counted as crossing midnight.</div>' : "");
}
function renderTimeCalc() { var out = document.getElementById("tc-out"); if (out) out.innerHTML = timeCalcOutHtml(); }
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
      "Billing for manual attachment. Billing drafts require the needed paperwork and an Outlook connection when hosted sign-in is enabled."],
    ["Database tables",
      "Edit a cell directly. Use the numbered gutter to select one or several rows, then use the table action for archive or delete. " +
      "The header <b>+</b> adds a field, and Manage Columns controls field order and visibility. Archived directory records remain on historical orders."],
    ["Mileage, delivery dates, and rates",
      "<b>Sync Mileage</b> fills available truck mileage from Motive. If an internal rate is set, blank internal freight charges " +
      "are calculated in that same run; existing charges are not overwritten. <b>Sync Delivery Dates</b> copies completed schedule dates back to orders."],
    ["Settings, shortcuts, and access",
      "General contains profile, theme, accent, font, account, Outlook, order numbering, and Scheduler sizing. Shortcuts can be " +
      "re-recorded, and <b>Add shortcut</b> gives an action an additional key combination. Administrators use Access to control " +
      "which pages another account can view or edit and the Scheduler date range it may load."],
    ["Undo and administrative history",
      "Undo and Redo cover changes made in the current session. Administrators can open History for the shared audit trail and " +
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
   outside NAV — subsOf resolves its tabs specially. Gated like every other
   section under local auth (D125) — a restricted user with no "settings"
   grants sees no Settings tabs at all, only the always-available Sign Out. */
var SETTINGS_SUBS = [{ k: "appearance", t: "General" }, { k: "shortcuts", t: "Shortcuts" },
  { k: "timecalc", t: "Time Calc" }];
function settingsSubsFor() {
  var subs = SETTINGS_SUBS;
  if (DB && DB.me && DB.me.is_admin) subs = subs.concat([{ k: "admin", t: "Access" }]);
  return subs;
}
function subsOf(s) {
  var subs;
  if (s === "settings") {
    subs = settingsSubsFor();
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
  return subs.filter(function (sub) { return canView(s, sub.k); });
}
var RAIL_ON = { sched: 1, int: 1, xfer: 1, ext: 1, cw: 1, driver: 1 };

function renderRail() {
  var list = STAGED.filter(function (id) {
    if (!Q) return true;
    var o = order(id); if (!o) return false;
    var c = buildChip(o);
    return (c.title + " " + c.line).toLowerCase().indexOf(Q.toLowerCase()) >= 0;
  });
  $("#rail").innerHTML = list.length ? list.map(function (id) {
    var o = order(id); return o ? chipHtml(o, true, 'data-from="STAGE"') : "";
  }).join("") : emptyStateHtml(Q ? "No matches for “" + Q + "”" : "Nothing staged");
  $("#stage-ct").textContent = STAGED.length;
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
  var action = (IFR_OPEN ? "Hide" : "Show") + " internal rate settings";
  var toggle = '<button class="ifr-arrow" id="ifr-toggle" title="' +
    action + '" aria-label="' + action + '">' + (IFR_OPEN ? "&gt;" : "&lt;") + "</button>";
  if (!IFR_OPEN) return toggle;
  return toggle +
    '<span class="lbl" style="margin:0 4px 0 6px">Internal rate $/mi</span>' +
    '<input type="number" step="0.01" min="0" id="ifr-rate" class="rate-inp" placeholder="0.00" value="' +
      (cfg.rate_per_mile ? esc(String(cfg.rate_per_mile)) : "") + '" title="Internal freight rate per mile">' +
    '<span class="lbl" style="margin:0 4px">Min $</span>' +
    '<input type="number" step="0.01" min="0" id="ifr-min" class="rate-inp" placeholder="0.00" value="' +
      (cfg.minimum_charge ? esc(String(cfg.minimum_charge)) : "") + '" title="Minimum internal freight charge — 0 means no minimum, always miles × rate">';
}
/* The IFR rate arrow + Sync mileage/Sync delivery dates buttons used to live
   embedded in the retired .subs tab bar (D200 removed it — Nate: "the order
   section... those tabs actually have buttons and functionality so we need
   to move that somewhere that fits the ui"). Sync actions apply across all
   three order kinds (D154), so each order tracker's own toolbar carries them
   as a `secondary` block, ahead of that tracker's own bulk-action buttons.
   D205 moved Internal Rate into the global formatting toolbar's far-right
   edge on Orders pages, leaving this page toolbar focused on sync/actions.
   #motive-sync/#sync-btn remain click-delegated by id (07-events.js). */
function ordersToolbarExtras() {
  return '<button class="btn sm" id="motive-sync">' + icon("sync") + 'Sync Mileage</button>' +
    '<button class="btn sm" id="sync-btn">' + icon("calendar") + 'Sync Delivery Dates</button>';
}
function render() {
  reindexLookups(); CELLS = cellContents(); buildOffDays(); buildDayNotes(); buildCatColor(); buildSheetCells(); buildGridFmt(); renderFmtBar();
  // #main's innerHTML is about to be replaced — the shared loc-suggest
  // portal (D228 follow-up) lives outside it and would otherwise survive
  // pointing at a now-detached SUGGEST_INPUT, a stale panel with nothing
  // real left to pick.
  var openSuggest = document.getElementById("loc-suggest-portal");
  if (openSuggest) openSuggest.style.display = "none";
  // A live permission change (an admin revoking a grant the user is actively
  // viewing) shouldn't leave the page stuck on a now-hidden section (D125).
  if (!canView(SEC, SUB)) { SEC = "dispatch"; SUB = "sched"; SEL = null; }
  $("#conn").textContent = "";
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
  main.innerHTML = ""; applyZoom();
  if (SEC === "database") main.insertAdjacentHTML("beforeend", databaseTabsHtml());
  if (SEC === "settings") main.insertAdjacentHTML("beforeend", settingsTabsHtml());
  var railOn = !!RAIL_ON[SUB];
  $("#bodywrap").classList.toggle("norail", !railOn);
  $("#rail-wrap").style.display = railOn ? "flex" : "none";

  if (SUB === "sched") {
    main.insertAdjacentHTML("beforeend", vScheduler());
    if (!schedNode) schedNode = buildScheduler();
    main.appendChild(schedNode);
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
             SUB === "bill" || SEC === "database") {
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
      SUB === "bill" ? vBilling() : vDatabase(SUB));
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
  applyEditLockUI();
}
/* Gray out (not hide, D126) "add"-style controls for a view-only grant —
   a single generic pass over the current section's DOM instead of threading
   a canEdit check into every individual button template. Structural buttons
   (+ new database/sheet) stay admin-only regardless of any edit grant,
   matching the server's API_PERMISSIONS defaults (D125). */
function applyEditLockUI() {
  var locked = !canEdit(SEC, SUB);
  $$("#new-order,#xfer-add,#xfer-bulk,#new-ratecon,#rc-drop,#int-bulk,#int-add,#add-pickdrop,#add-truck,#add-department," +
     "[data-addcust],[data-addcol],[data-addrow]").forEach(function (el) {
    el.classList.toggle("locked-view", locked);
    if ("disabled" in el) el.disabled = locked;
  });
  $$("[data-archiverows]").forEach(function (el) {
    el.classList.toggle("locked-view", locked);
    el.disabled = locked || !(ROWSEL[el.dataset.archiverows] || []).length;
  });
  var structLocked = !(DB && DB.me && DB.me.is_admin) && !!(DB && DB.me);
  $$("[data-adddb],[data-addsheet]").forEach(function (el) {
    el.classList.toggle("locked-view", structLocked);
  });
}
function reload() { return api("bootstrap").then(function (d) {
  DB = d; schedNode = null; render();
  if (typeof refreshDrawerChipPreview === "function") refreshDrawerChipPreview();
  // Keep the durable History panel current with whatever just changed —
  // reload() already runs after essentially every mutation in the app, so
  // this is "live" without any polling/websocket infrastructure (D134).
  if (typeof historyPanelOpen === "function" && historyPanelOpen()) loadHistoryPanel();
}); }

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
        sub: o.solomon_order_no || o.broker_load_no || "",
        run: function () { gotoDate(dq.ds, o.id); } });
    });
  }
  if (q.length < 2) return out.slice(0, 14);
  function has() { for (var i = 0; i < arguments.length; i++) {
    var v = arguments[i]; if (v != null && String(v).toLowerCase().indexOf(q) >= 0) return true; } return false; }
  DB.orders.forEach(function (o) {
    var cust = o.customer_party_id && party(o.customer_party_id), brok = o.broker_party_id && party(o.broker_party_id);
    if (has(o.solomon_order_no, o.broker_load_no, o.po_number, o.delivery_number, o.notes,
            cust && cust.name, brok && brok.name)) {
      out.push({ type: o.kind === "internal" ? "Internal" : "Order",
        label: (o.solomon_order_no || o.broker_load_no || "no #") + " · " + buildChip(o).title,
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
function renderSearch() { GS_RESULTS = searchResults($("#gsearch").value); GS_SEL = GS_RESULTS.length ? 0 : -1; paintSearch(); }
function gsActivate(i) {
  var r = GS_RESULTS[i]; if (!r) return;
  $("#gsearch-results").style.display = "none"; $("#gsearch").value = ""; GS_RESULTS = []; GS_SEL = -1;
  r.run();
}

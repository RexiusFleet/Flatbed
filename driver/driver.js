/* Dept 12 Driver Schedule (also the bag plant page, in bag plant mode).
 *
 * Drivers pick their name (no password) and see Current Week plus their own
 * tab. Everything shown is the latest PUBLISHED schedule (public_published_schedule),
 * so dispatch edits reach drivers only when the dashboard's Publish Schedule is
 * pressed. Notes, POD/BOL scans and "opened" times go back to Supabase through
 * the public_* functions. Add ?demo to the address for built-in sample data.
 */
(function () {
"use strict";

var CFG = window.DEPT12_CONFIG || {};
var SB_URL = String(CFG.supabaseUrl || "").replace(/\/+$/, "");
var SB_KEY = String(CFG.supabaseKey || "");
var SESSION_KEY = "dept12-supabase-session";   // shared with the dashboard
var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var $ = function (s) { return document.querySelector(s); };

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}
function store(k, v) {
  try {
    if (v === undefined) return localStorage.getItem(k);
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
  } catch (e) { /* private mode */ }
  return null;
}
function storeJson(k, v) {
  if (v !== undefined) return store(k, JSON.stringify(v));
  try { return JSON.parse(store(k) || "null"); } catch (e) { return null; }
}
function toast(m, bad) {
  var t = $("#toast"); t.textContent = m;
  t.className = "show" + (bad ? " bad" : "");
  clearTimeout(t._h); t._h = setTimeout(function () { t.className = ""; }, 3200);
}

/* ── Appearance: same pref_* keys the dashboard writes (01-core) ───────── */
function rgbOf(hex) { var x = String(hex || "").replace("#", ""); return [0, 2, 4].map(function (i) { return parseInt(x.slice(i, i + 2), 16) || 0; }); }
function lum(hex) {
  return rgbOf(hex).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
    .reduce(function (a, v, i) { return a + v * [0.2126, 0.7152, 0.0722][i]; }, 0);
}
function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function applyPrefs() {
  // Light theme only (the dashboard's own theme setting does not apply here).
  var root = document.documentElement, theme = "light";   // these pages are light only
  var accent = store("pref_accent") || "#3F7D3A", font = store("pref_font") || "";
  if (!/^#[0-9a-f]{6}$/i.test(accent)) accent = "#3F7D3A";
  if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme); else root.removeAttribute("data-theme");
  var rgb = rgbOf(accent);
  root.style.setProperty("--brand", accent);
  root.style.setProperty("--brand-soft", "rgba(" + rgb.join(",") + ",.14)");
  root.style.setProperty("--brand-ink", contrast(accent, "#FFFFFF") >= contrast(accent, "#111315") ? "#FFFFFF" : "#111315");
  if (font) root.style.setProperty("--font", font);
  var rowH = parseInt(store("pref_rowHeight"), 10), colW = parseInt(store("pref_colWidth"), 10);
  root.style.setProperty("--row-h", (rowH >= 56 && rowH <= 160 ? rowH : 84) + "px");
  root.style.setProperty("--col-w", (colW >= 100 && colW <= 320 ? colW : 150) + "px");
}
applyPrefs();
window.addEventListener("storage", function (e) { if (e.key && e.key.indexOf("pref_") === 0) applyPrefs(); });

/* Readable text on a filled cell — same threshold as the dashboard's textOn. */
function textOn(hex) {
  if (!hex || hex.charAt(0) !== "#" || hex.length < 7) return "";
  var c = rgbOf(hex);
  return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) > 150 ? "#1a1a1a" : "#ffffff";
}
function fillStyle(hex) { return hex ? "background:" + esc(hex) + ";color:" + textOn(hex) + ";" : ""; }

var MAPS_ICON = '<svg class="gmaps" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><defs><clipPath id="gm-pin">' +
  '<path d="M12 1.5a7.5 7.5 0 0 0-7.5 7.5c0 5.6 7.5 13.5 7.5 13.5s7.5-7.9 7.5-13.5A7.5 7.5 0 0 0 12 1.5z"/></clipPath></defs>' +
  '<g clip-path="url(#gm-pin)"><rect width="24" height="24" fill="#34A853"/><rect x="0" y="0" width="12" height="15" fill="#FBBC04"/>' +
  '<rect x="0" y="0" width="12" height="8" fill="#4285F4"/><rect x="12" y="0" width="12" height="11" fill="#EA4335"/>' +
  '<rect x="12" y="11" width="12" height="4" fill="#4285F4"/></g><circle cx="12" cy="9" r="2.7" fill="#fff"/></svg>';
var SUN_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1"/></svg>';
var MOON_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M13.5 10A6 6 0 0 1 6 2.5a6 6 0 1 0 7.5 7.5z"/></svg>';
var SCAN_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 2h6l3 3v9H4z"/><path d="M10 2v3h3M6.5 9l1.5 1.5L11 7.5"/></svg>';
var SYNC_ICON = '<span class="ico" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 8a6 6 0 0 1 10.2-4.2M14 8a6 6 0 0 1-10.2 4.2M12 2v3h-3M4 14v-3h3"/></svg></span>';

/* ── State ────────────────────────────────────────────────────────────── */
// The bag plant has its own page (bagplant/index.html sets FLATBED_MODE):
// Current Week only, no sign-in, no tabs, bag orders front and center.
var BAG_PLANT = window.FLATBED_MODE === "bagplant";
var DEMO = /[?&]demo\b/.test(location.search);   // built-in sample schedule for design work

// Public, read/write-limited functions in Supabase (no sign-in; only the public key).
function rpcPublic(fn, args) {
  if (!SB_URL || !SB_KEY) return Promise.reject(new Error("The schedule isn't connected yet."));
  return fetch(SB_URL + "/rest/v1/rpc/" + fn, {
    method: "POST", headers: { "apikey": SB_KEY, "Content-Type": "application/json" }, body: JSON.stringify(args || {})
  }).then(function (r) {
    return r.text().then(function (t) {
      var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { /* plain text */ }
      if (!r.ok) throw new Error((j && j.message) || ("Request failed (" + r.status + ")"));
      return j;
    });
  });
}
// S.who: null (sign-in screen) | {role:"driver", truck, name} | {role:"bagplant"} on the bag plant page
var S = {
  who: BAG_PLANT ? { role: "bagplant", name: "Bag Plant" } :
    (function (w) { return w && w.role === "driver" ? w : null; })(storeJson("dept12DriverWho")), tab: BAG_PLANT ? "cw" : (store("dept12DriverTab") || "cw"),
  payload: null, loadKeys: {}, source: "", loadedAt: null, error: "", loading: false,
  scrollTo: null, keepScroll: false, loadOrder: {}, noteKey: null, scans: {}, chipTitle: {},
  serverNotes: {}, serverScans: {}, viewSent: {}, refreshedAt: null
};

/* ── Sign-in (just remembers a name on this device) ─────────────────── */
function signInAs(who) {
  S.who = who; storeJson("dept12DriverWho", who);
  S.tab = who.role === "bagplant" ? "cw" : String(who.truck);
  store("dept12DriverTab", S.tab);
  logView("opened");
  render(); load();
}
function signOut() {
  S.noteKey = null;
  S.who = null; store("dept12DriverWho", null);
  render(); load();
}

/* ── View log: tells the dashboard when each truck last opened what.
   Sent at most once every 5 minutes per kind. ───────────────────────── */
function logView(kind) {
  if (DEMO || !S.who || S.who.role !== "driver") return;
  var last = S.viewSent[kind] || 0;
  if (Date.now() - last < 300000) return;
  S.viewSent[kind] = Date.now();
  rpcPublic("public_log_view", { p_truck: String(S.who.truck), p_kind: kind, p_driver: S.who.name }).catch(function () { S.viewSent[kind] = 0; });
}

/* ── Data ─────────────────────────────────────────────────────────────── */
function load() {
  if (S.loading) return;
  S.loading = true; renderBusy();
  var raw = null;
  var first;
  if (DEMO) {
    first = window.Dept12SheetsPush({ start_date: null, days: 5 }, function (fn, a) {
      return sampleRpc(fn, a).then(function (r) { if (fn === "driver_week_data") raw = r; return r; });
    }).then(function (p) { S.payload = p; S.source = "sample"; S.loadedAt = new Date(); S.refreshedAt = new Date(); S.error = ""; });
  } else {
    first = rpcPublic("public_published_schedule", {}).then(function (pub) {
      if (!pub) { S.payload = null; S.source = ""; S.error = ""; return; }   // nothing published yet
      S.payload = pub.payload; raw = pub.raw; S.source = "published";
      S.loadedAt = new Date(pub.published_at); S.refreshedAt = new Date(); S.error = "";
    }, function (e) {
      S.error = e.message || String(e);   // keep whatever was on screen
    });
  }
  first.then(function () {
    // Which truck/day/slot holds a real load (vs. a plain schedule note) —
    // only real loads get POD/BOL buttons.
    if (raw) {
      S.loadKeys = {}; S.loadOrder = {}; S.loadKind = {}; S.orders = {};
      (raw.orders || []).forEach(function (o) { S.orders[o.id] = o; });
      var kinds = {};
      (raw.orders || []).forEach(function (o) { kinds[o.id] = o.is_transfer ? "xfer" : o.kind === "internal" ? "bag" : "ext"; });
      (raw.loads || []).forEach(function (l) {
        if (!(l.order_ids || []).length) return;
        var k = l.truck_id + "|" + String(l.scheduled_date).slice(0, 10) + "|" + l.slot;
        S.loadKeys[k] = true; S.loadOrder[k] = l.order_ids[0]; S.loadKind[k] = kinds[l.order_ids[0]] || "ext";
      });
    }
    S.loading = false;
    reconcileWho();
    if (S.noteKey) { renderHeader(); } else render();
    loadActivity();
  }).catch(function (e) {
    // Anything unexpected: say what it was on the page instead of sitting blank.
    S.loading = false; S.error = (e && e.message) || String(e);
    try { render(); } catch (e2) { showFatal(e2); }
  });
}
// Notes and scan status other people (and this driver, earlier) put on these loads.
function loadActivity() {
  if (DEMO || !S.orders || !S.who) return;
  var ids = Object.keys(S.orders);
  if (!ids.length) return;
  rpcPublic("public_driver_activity", { p_order_ids: ids }).then(function (a) {
    S.serverNotes = {}; S.serverScans = {};
    (a.notes || []).forEach(function (n) { (S.serverNotes[n.order_id] = S.serverNotes[n.order_id] || []).push({ id: n.id, truck: n.truck, driver: n.driver, text: n.body, at: n.created_at }); });
    (a.scans || []).forEach(function (x) { if (!S.serverScans[x.order_id]) S.serverScans[x.order_id] = { pages: x.pages, at: x.created_at }; });
    if (S.who && S.payload && !S.noteKey) { S.keepScroll = true; render(); }
  }).catch(function () { /* the schedule still works without them */ });
}
function showFatal(e) {
  var m = $("#main");
  if (m) m.innerHTML = '<div class="drv-note"><b>Something went wrong showing the schedule.</b> ' + esc((e && e.message) || String(e)) +
    (e && e.stack ? "<br><small>" + esc(String(e.stack).split("\n").slice(0, 3).join(" | ")) + "</small>" : "") + "</div>";
}

/* ── Helpers ──────────────────────────────────────────────────────────── */
function dParts(ds) {
  // Dates normally arrive as "2026-10-05"; also cope with a trailing time or
  // any other format Safari can read, and never throw on a odd one.
  var s = String(ds == null ? "" : ds), m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  var d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : new Date(s);
  if (isNaN(d.getTime())) return { dow: "", md: s };
  return { dow: DOW[d.getUTCDay()], md: (d.getUTCMonth() + 1) + "/" + d.getUTCDate() };
}
function todayIso() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function dateTimeLabel(d) {
  return d ? d.toLocaleDateString([], { month: "short", day: "numeric" }) + " at " + timeLabel(d) : "";
}
function timeLabel(d) { return d ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""; }
function whenLabel(iso) {
  if (!iso) return "";
  var d = new Date(iso), mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return mins + " min ago";
  var sameDay = d.toDateString() === new Date().toDateString();
  return (sameDay ? "Today" : DOW[d.getDay()] + " " + (d.getMonth() + 1) + "/" + d.getDate()) + " " + timeLabel(d);
}
// Same words the Google push bolds, so a driver's eye lands in the same places.
function loadTextHtml(text) {
  return esc(text).replace(/(Broker\/Customer:|Broker:|PICK:|DROP:|Rexius Order:|Load:|\b07-\d{4}-\d{4}\b)/g, "<b>$1</b>");
}

/* Driver tab chip. External loads read "Broker: X" with the pick and drop
   under it; everything else (bag orders, internal freight, typed notes) keeps
   the text from the schedule. */
// Full address for a stop: name, street, city and state.
function stopLine(name, address, city, state) {
  var place = [city, state].filter(Boolean).join(" ");
  return [name, address, place].filter(Boolean).join(", ");
}
function apptTime12(t) {
  var m = /^(\d{1,2}):(\d{2})/.exec(t || "");
  if (!m) return "";
  var h = +m[1];
  return (h % 12 || 12) + ":" + m[2] + " " + (h >= 12 ? "PM" : "AM");
}
// "MON 10/6 · 7:00–9:00 AM" (window) or "TUE 10/7 · 1:00 PM"
function apptText(a, loadDay) {
  var ds = a.date || loadDay || "", day = "";
  if (ds) { var dt = new Date(ds + "T12:00:00Z"); day = DOW[dt.getUTCDay()].toUpperCase() + " " + (dt.getUTCMonth() + 1) + "/" + dt.getUTCDate(); }
  var from = apptTime12(a.from), to = apptTime12(a.to), t = from || to;
  if (from && to) t = from.slice(-2) === to.slice(-2) ? from.slice(0, -3) + "–" + to : from + "–" + to;
  return [day, t].filter(Boolean).join(" · ");
}
function apptTag(a, day) {
  return a && (a.from || a.to || a.date) ? ' <span class="appt">APPT ' + esc(apptText(a, day)) + "</span>" : "";
}
function orderForKey(key) { return S.orders && S.orders[S.loadOrder[key]] || null; }
function tabChipHtml(key, r) {
  var o = orderForKey(key);
  if (o && o.kind !== "internal" && !o.is_transfer) {
    // The PICK: and DROP: labels always print, even when empty, so the layout
    // reads the same on every load.
    var pick = stopLine(o.pickup_name, o.pickup_address, o.pickup_city, o.pickup_state);
    var drop = stopLine(o.delivery_name, o.delivery_address, o.delivery_city, o.delivery_state);
    return ["<b>Broker/Customer:</b> " + esc(o.broker_name || "—"), "",
      "<b>PICK:</b> " + esc(pick) + apptTag(o.pick_appt, key.split("|")[1]),
      "",
      "<b>DROP:</b> " + esc(drop) + apptTag(o.drop_appt, key.split("|")[1])].join("\n");
  }
  // Bag orders: the same EARLY / ANYTIME and FORKLIFT boxes as Current Week.
  var fl = o && o.kind === "internal" && !o.is_transfer ? flagsHtml(bagFlags(o)) : "";
  return loadTextHtml(r.chip) + (fl ? '<div style="margin-top:6px">' + fl + "</div>" : "");
}
function rexiusOrderNo(key) { var o = orderForKey(key); return o && o.solomon_order_no || ""; }
function loadNo(key) { var o = orderForKey(key); return o && o.broker_load_no || ""; }
function fleet() { return (S.payload && S.payload.drivers || []).filter(function (d) { return d.driver; }); }
// A typed name matches a driver regardless of case/spacing, or by a first
// name / start of a name when only one driver fits.
function driverByName(txt) {
  var t = String(txt || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return null;
  var list = fleet(), exact = list.filter(function (d) { return d.driver.toLowerCase().replace(/\s+/g, " ") === t; });
  if (exact.length) return exact[0];
  var starts = list.filter(function (d) { return d.driver.toLowerCase().indexOf(t) === 0; });
  return starts.length === 1 ? starts[0] : null;
}
/* The page remembers who signed in. After each load, check that driver is
   still in the list: same name on a different truck → follow them to it;
   not in the list at all → back to the name box. Only forget them for good
   when this is the real schedule (a brief outage showing sample data must
   not sign everyone out). */
function reconcileWho() {
  if (!S.who || S.who.role !== "driver" || !S.payload) return;
  var me = driverByTruck(S.who.truck);
  if (me && me.driver === S.who.name) return;
  var byName = fleet().filter(function (d) { return d.driver === S.who.name; })[0];
  if (byName) {
    S.who = { role: "driver", truck: String(byName.truck), name: byName.driver };
    if (S.source === "live") storeJson("dept12DriverWho", S.who);
    if (S.tab !== "cw") S.tab = String(byName.truck);
    return;
  }
  if (S.source === "live") store("dept12DriverWho", null);
  S.who = null; S.noteKey = null;
}
function driverByTruck(num) {
  return (S.payload && S.payload.drivers || []).filter(function (d) { return String(d.truck) === String(num); })[0] || null;
}
// Drivers get Current Week and their own tab; the bag plant gets Current Week.
function isBagPlant() { return !!(S.who && S.who.role === "bagplant"); }
function allowedTab(tab) {
  if (tab === "cw") return true;
  if (isBagPlant()) return false;
  return !!driverByTruck(tab) && !!S.who && String(S.who.truck) === String(tab);
}

/* ── Header + tabs ────────────────────────────────────────────────────── */
function renderHeader() {
  var whoEl = $("#hdr-who");   // the driver page has no name/truck in the header
  if (whoEl) whoEl.innerHTML = !S.who ? "" : isBagPlant() ? "<b>Current Week</b><span>Bag Orders · View Only</span>" :
    "<b>" + esc(S.who.name) + "</b><span>Truck " + esc(S.who.truck) + "</span>";
  // The bag order color code sits in the header, just left of Log Out.
  $("#hdr").innerHTML = S.who ? bagKeyHtml() +
    (BAG_PLANT ? "" : '<button class="btn drv-hbtn" id="signout">Log Out</button>') : "";
}
function renderTabs() {
  var tabs = $("#tabs");
  if (!S.who || !S.payload || isBagPlant()) { tabs.hidden = true; tabs.innerHTML = ""; return; }
  tabs.hidden = false;
  var tab = function (id, label, sub, cls) {
    return '<button class="sub-tab' + (cls ? " " + cls : "") + '" role="tab" data-tab="' + esc(id) + '" aria-selected="' + (String(S.tab) === String(id)) + '">' +
      esc(label) + (sub ? '<span class="trk">' + esc(sub) + "</span>" : "") + "</button>";
  };
  var h = tab("cw", "Current Week");
  S.payload.drivers.forEach(function (d) {
    if (allowedTab(String(d.truck))) h += tab(d.truck, d.driver || "Unassigned", d.truck);
  });
  tabs.innerHTML = h;
  var on = tabs.querySelector("[aria-selected=true]");
  if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/* ── Sign-in screen ───────────────────────────────────────────────────── */
function vLogin() {
  var brand = '<div class="brand drv-login-brand"><span class="brand-mark"><img src="../rexius-logo.png" alt="Rexius"></span>' +
    "<h1>Flatbed Schedule</h1></div>";
  var h = '<div class="drv-login login-gate"><div class="login-card">' + brand;
  var list = fleet();
  // Type your name or pick it from the list (the list shows as you tap in).
  h += "<p>Type or pick your name to see your loads.</p>" +
      '<input id="login-driver" list="login-names" autocomplete="off" autocapitalize="words" spellcheck="false" ' +
        'aria-label="Your name" placeholder="' + (S.payload ? "Your name" : "Loading drivers…") + '">' +
      '<datalist id="login-names">' + list.map(function (d) { return '<option value="' + esc(d.driver) + '">'; }).join("") + "</datalist>" +
      '<button class="btn pri" id="login-go" disabled>View Schedule</button>' +
      '<div id="login-err" class="login-err"></div>';
  return h + "</div></div>";
}

/* ── Toolbar ──────────────────────────────────────────────────────────── */
function bagKeyHtml() {
  var items = [["Early", "#D9EAD3"], ["Anytime", "#FFF2CC"], ["Early East", "#F1C232"], ["Anytime East", "#783F04"]];
  return '<span class="bagkey" aria-label="Bag order color code"><span class="bagkey-t">Bag order color code</span>' +
    items.map(function (x) { return '<span class="bk"><i style="background:' + x[1] + '"></i>' + x[0] + "</span>"; }).join("") + "</span>";
}
function toolbarHtml(title) {
  return '<div class="toolbar cw-toolbar"><h2>' + esc(title) + "</h2>" +
    '<span style="flex:1"></span>' +
    (S.source === "published" ? '<span class="lbl" style="color:var(--good)">Last updated ' + esc(dateTimeLabel(S.loadedAt)) + "</span>" +
        '<span class="lbl">|</span><span class="lbl">Last refreshed ' + esc(timeLabel(S.refreshedAt)) + "</span>" :
      S.source === "live" ? '<span class="lbl" style="color:var(--good)">Updated ' + esc(timeLabel(S.loadedAt)) + "</span>" : "") +
    '<button class="btn pri" id="refresh"' + (S.loading ? " disabled" : "") + ">" + SYNC_ICON + (S.loading ? "Refreshing" : "Refresh") + "</button></div>";
}
function noticeHtml() {
  if (DEMO) return '<div class="drv-note"><b>Demo data.</b> Built-in sample schedule for testing the layout.</div>';
  if (S.error) return '<div class="drv-note"><b>Couldn\'t refresh.</b> ' + esc(S.error) + " Showing the last loaded schedule.</div>";
  return "";
}

/* ── Current Week ─────────────────────────────────────────────────────── */
function vCurrentWeek() {
  var p = S.payload, cw = p.current_week, today = todayIso(), mine = S.who.role === "driver" ? String(S.who.truck) : "";
  // Bag plant: the whole fleet fills the screen, columns as wide as they fit.
  // Bag plant: columns share the screen exactly (its date column is 96px).
  var dateW = 88;   // the bagger page uses exactly the drivers' sizes
  var big = isBagPlant() ? ' style="--col-w:' + Math.max(210, Math.floor((window.innerWidth - dateW - 4) / Math.max(1, cw.length))) + 'px"' : "";
  var h = '<div class="grid-wrap"' + big + '><table class="grid" style="width:calc(' + dateW + 'px + ' + cw.length + ' * var(--col-w,150px))"><thead><tr>' +
    '<th class="corner"><span class="lbl">Date</span></th>';
  cw.forEach(function (t) {
    var open = allowedTab(String(t.truck));
    h += '<th class="trkcol' + (String(t.truck) === mine ? " mine" : "") + '" style="width:var(--col-w,150px)' + (open ? "" : ";cursor:default") + '"' +
      (open ? ' data-tab="' + esc(t.truck) + '" title="Open ' + esc(t.driver || t.truck) + '\'s tab"' : "") + ">" +
      '<span class="drv"' + (t.driver_color ? ' style="--dc:' + esc(t.driver_color) + '"' : "") + ">" + esc(t.driver || "— unassigned —") + "</span>" +
      '<span class="trk">' + esc(t.truck) + " " + esc(t.equipment_type || "") + "</span></th>";
  });
  h += "</tr></thead><tbody>";
  p.dates.forEach(function (ds, di) {
    var dp = dParts(ds);
    for (var s = 0; s < p.slots_per_day; s++) {
      h += '<tr class="slotrow' + (ds === today ? " today" : "") + (ds < today ? " past" : "") + (s === 0 ? " dstart" : "") + '">';
      if (s === 0) h += '<td class="rowhd" rowspan="' + p.slots_per_day + '"><span class="dwk">' + dp.dow.toUpperCase() +
        '</span><br><span class="dnum">' + (+ds.slice(5, 7)) + "/" + ds.slice(8, 10) + "</span></td>";
      cw.forEach(function (t) {
        var r = t.rows[di * p.slots_per_day + s] || {}, open = allowedTab(String(t.truck));
        if (r.off) { h += '<td class="offday">' + (s === Math.ceil(p.slots_per_day / 2) - 1 ? '<div class="off-label">OFF</div>' : "") + "</td>"; return; }
        if (!r.chip) { h += "<td></td>"; return; }
        // A typed Scheduler cell (no load behind it) reads as plain text in
        // the cell, exactly like the dashboard's Current Week.
        if (!S.loadKeys[t.truck_id + "|" + ds + "|" + (s + 1)]) {
          h += "<td" + (r.color ? ' style="background-color:' + esc(r.color) + ";color:" + textOn(r.color) + '"' : "") + '><div class="cell"' +
            (open ? ' data-go="' + esc(t.truck) + "|" + ds + '" style="cursor:pointer"' : "") + '><div class="txt">' + esc(r.chip) + "</div></div></td>";
          return;
        }
        var key = t.truck_id + "|" + ds + "|" + (s + 1), lines = r.chip.split("\n").filter(function (x) { return x.trim(); });
        var ord = S.orders && S.orders[S.loadOrder[key]];
        var go = open ? ' role="button" tabindex="0" data-go="' + esc(t.truck) + "|" + ds + '"' : "";
        // Bag plant: the dashboard's chip (title, City → City, order numbers,
        // flags), big for bag orders and quieter for everything else.
        if (ord && (isBagPlant() || (ord.kind !== "internal" && !ord.is_transfer))) {
          var kindCls = !isBagPlant() ? "" : S.loadKind[key] === "bag" ? "bp-bag" : ord.kind !== "internal" && !ord.is_transfer ? "bp-ext" : "bp-other";
          h += '<td><div class="cell">' + dashChipHtml(ord, r, go, kindCls) + "</div></td>"; return;
        }
        if (isBagPlant()) { h += bagPlantCell(lines, r, S.loadKind[key]); return; }
        h += '<td><div class="cell"><div class="chip' + (r.color ? " filled" : "") + '"' +
          (open ? go : ' style="cursor:default;' + fillStyle(r.color) + '"') +
          (open && r.color ? ' style="' + fillStyle(r.color) + '"' : "") + '><div class="who">' + esc(lines[0]) + "</div>" +
          lines.slice(1).map(function (x) { return '<div class="dnote">' + esc(x) + "</div>"; }).join("") +
          (ord && ord.kind === "internal" && !ord.is_transfer ? flagsHtml(bagFlags(ord)) : "") + "</div></div></td>";
      });
      h += "</tr>";
    }
  });
  return h + "</tbody></table></div>";
}


/* The dashboard's load chip, built from the same order fields: customer or
   broker on top, City → City and the load/order numbers (or pallets and the
   07- number) underneath, then timing/forklift flags and the driver note. */
function cityState(city, state) { return city ? city + (state ? ", " + state : "") : "?"; }
// FORKLIFT / NO FORKLIFT / SPYDER boxes for a bag order (timing is the color key in the header).
function bagFlags(o) {
  var flags = [];
  var fk = String(o.cust_forklift || "").trim().toLowerCase();
  if (fk) flags.push(fk === "nf" || fk === "none" || fk === "no" || fk === "no forklift" ? "NO FORKLIFT" : fk.indexOf("spyder") >= 0 ? "SPYDER" : "FORKLIFT");
  return flags;
}
function flagsHtml(flags) {
  return flags.length ? '<div class="flags">' + flags.map(function (x) { return '<span class="flag">' + esc(x) + "</span>"; }).join("") + "</div>" : "";
}
function dashChipHtml(o, r, attrs, cls) {
  var ext = o.kind !== "internal" && !o.is_transfer, flags = [], title, meta;
  if (o.is_transfer) {
    title = o.notes || o.driver_note || "(no load info)";
    meta = '<div class="meta"><span>Internal Freight · ' + esc(o.transfer_department_name || "") + "</span></div>";
  } else if (ext) {
    // Broker and City → City only: the order and load numbers are on the
    // driver's own tab, and too much here is confusing.
    title = o.broker_name || "(no customer)";
    meta = '<div class="meta meta-2line meta-route"><span class="route-line">' +
      esc(cityState(o.pickup_city, o.pickup_state) + " → " + cityState(o.delivery_city, o.delivery_state)) + "</span></div>";
  } else {
    title = o.customer_name || "(no customer)";
    meta = '<div class="meta meta-2line">' + (o.pallet_count ? "<span>" + esc(o.pallet_count) + " PAL</span>" : "") +
      '<span class="nowrap">' + esc(o.solomon_order_no || "no order #") + "</span></div>";
    flags = bagFlags(o);
  }
  var note = o.driver_note ? '<div class="dnote">&#9998; ' + esc(o.driver_note) + "</div>" : "";
  if (ext) {
    // Every load a driver sees has been pushed, so it wears the pushed look:
    // a soft tint of the driver's color with the solid color as the edge.
    var edge = r.color || "var(--ext)";
    var appt = o.pick_appt || o.drop_appt;
    return '<div class="chip xchip' + (r.color ? " tinted" : "") + (appt ? " has-appt" : "") + (cls ? " " + cls : "") + '" style="--edge:' + edge +
      (r.color ? ";background:color-mix(in srgb," + esc(r.color) + " 17%,var(--panel))" : "") + '"' + (attrs || "") + ">" +
      (appt ? '<span class="appt-ind">APPT</span>' : "") + '<div class="who">' + esc(title) + "</div>" + meta + note + "</div>";
  }
  var edge2 = r.color || (o.cust_timing === "early" ? "var(--early)" : "var(--anytime)");
  return '<div class="chip' + (r.color ? " filled" : "") + (cls ? " " + cls : "") + '" style="--edge:' + edge2 + ";" + fillStyle(r.color) + '"' + (attrs || "") + ">" +
    '<div class="who">' + esc(title) + "</div>" + meta +
    (flags.length ? '<div class="flags">' + flags.map(function (x) { return '<span class="flag">' + esc(x) + "</span>"; }).join("") + "</div>" : "") +
    note + "</div>";
}

/* Bag plant cell: a bag order (07-) is the whole point of this screen — its
   store color, customer and order number big and bold. External loads and
   internal freight stay visible but quiet, so the plant knows the truck's
   busy without reading it. */
// "07-0826-0049 - 24 PAL" → the order number big, pallets beside it.
function bpOrderLine(ord) {
  var m = String(ord).match(/^(.*?)\s*-\s*(\d+\s*PAL)\s*$/i);
  return '<div class="bp-ord"><b>' + esc(m ? m[1] : ord) + "</b>" + (m ? '<span class="bp-pal">' + esc(m[2]) + "</span>" : "") + "</div>";
}
function bagPlantCell(lines, r, kind) {
  if (kind === "bag") {
    var ord = lines[lines.length - 1] || "", mid = lines.slice(1, -1);
    return '<td><div class="cell"><div class="chip filled bp-bag" style="' + fillStyle(r.color) + '">' +
      '<div class="bp-cust">' + esc(lines[0]) + "</div>" +
      mid.map(function (x) { return '<div class="bp-where">' + esc(x) + "</div>"; }).join("") +
      bpOrderLine(ord) + "</div></div></td>";
  }
  return '<td><div class="cell"><div class="chip bp-other"><div class="who">' + esc(lines[0]) + "</div>" +
    (lines[1] ? '<div class="dnote">' + esc(lines[1]) + "</div>" : "") + "</div></div></td>";
}

/* ── One driver's tab ─────────────────────────────────────────────────── */
function linkHtml(url, label, maps) {
  return url ? '<a class="btn sm drv-map" href="' + esc(url) + '" target="_blank" rel="noopener">' + (maps ? MAPS_ICON : "") + esc(label) + "</a>" : "";
}
/* Driver notes on a load, keyed by order id. Prototype: kept in this
   browser's storage, which the dashboard on the same address also reads
   (order drawer → Driver notes). The real version saves to Supabase. */
// A real load keys its notes by order id; a typed Scheduler cell (no order)
// keys them by the cell itself.
function noteId(key) { return S.loadOrder[key] || "cell:" + key; }
function notesFor(key) {
  var oid = noteId(key);
  if (!oid) return [];
  var list = DEMO ? ((storeJson("dept12DriverNotes") || {})[oid] || []) : (S.serverNotes[oid] || []);
  return list.slice().sort(function (a, b) { return a.at < b.at ? 1 : -1; });
}
// Resolves true when saved, false when there was nothing to save.
function saveNote(key, text) {
  var oid = noteId(key), t = String(text || "").trim();
  if (!oid || !t || !S.who) return Promise.resolve(false);
  if (DEMO) {   // sample mode: kept on this device only
    var all = storeJson("dept12DriverNotes") || {};
    (all[oid] = all[oid] || []).push({ id: String(Date.now()), truck: S.who.truck, driver: S.who.name, text: t, at: new Date().toISOString() });
    storeJson("dept12DriverNotes", all);
    return Promise.resolve(true);
  }
  return rpcPublic("public_add_driver_note", { p_order_id: oid, p_driver: S.who.name, p_truck: String(S.who.truck), p_body: t })
    .then(function (r) {
      (S.serverNotes[oid] = S.serverNotes[oid] || []).push({ id: r.id, truck: S.who.truck, driver: S.who.name, text: t, at: r.created_at });
      return true;
    });
}
function notesHtml(key) {
  var list = notesFor(key), h = "";
  if (list.length) h += '<div class="drv-notes">' + list.map(function (n) {
    return '<div class="drv-note-item"><span>' + esc(whenLabel(n.at)) + "</span>" + esc(n.text) + "</div>";
  }).join("") + "</div>";
  if (S.noteKey === key) h += '<div class="drv-note-edit"><textarea id="note-draft" rows="3" aria-label="Note for dispatch" ' +
    'placeholder="Waiting at the receiver, bad site, anything dispatch should know"></textarea>' +
    '<div class="drv-note-acts"><button class="btn" data-note-cancel>Cancel</button><button class="btn pri" data-note-save="' + esc(key) + '">Save Note</button></div></div>';
  return h;
}
/* Scanned POD / BOL for a load. The PDF goes to Supabase (private bucket "driver-scans")
   and becomes that order's POD on the dashboard. A copy also stays on this device
   (IndexedDB) so the driver can open "View PDF" without a signal. */
function scanDb() {
  return new Promise(function (ok, fail) {
    var rq = indexedDB.open("dept12-prototype", 1);
    rq.onupgradeneeded = function () { rq.result.createObjectStore("scans", { keyPath: "id" }); };
    rq.onsuccess = function () { ok(rq.result); };
    rq.onerror = function () { fail(rq.error); };
  });
}
function saveScan(key, blob, pages) {
  var rec = { id: String(Date.now()) + Math.random().toString(36).slice(2, 6), key: key, order_id: S.loadOrder[key] || null,
    truck: S.who.truck, driver: S.who.name, at: new Date().toISOString(), pages: pages, blob: blob };
  return scanDb().then(function (db) {
    return new Promise(function (ok, fail) {
      var tx = db.transaction("scans", "readwrite"); tx.objectStore("scans").put(rec);
      tx.oncomplete = function () { ok(rec); }; tx.onerror = function () { fail(tx.error); };
    });
  });
}
function sendScan(key, blob, pages) {
  var oid = S.loadOrder[key];
  if (DEMO || !oid) return saveScan(key, blob, pages);   // sample mode: this device only
  var path = oid + "/" + Date.now() + ".pdf";
  return fetch(SB_URL + "/storage/v1/object/driver-scans/" + path, {
    method: "POST", headers: { "apikey": SB_KEY, "Content-Type": "application/pdf", "x-upsert": "false" }, body: blob
  }).then(function (r) {
    if (!r.ok) throw new Error("the upload failed (" + r.status + ")");
    return rpcPublic("public_register_scan", { p_order_id: oid, p_path: path, p_pages: pages, p_driver: S.who.name, p_truck: String(S.who.truck) });
  }).then(function () { return saveScan(key, blob, pages).catch(function () { /* the dashboard has it either way */ }); });
}
// Latest scan per load made on this device, for the View PDF link.
function loadScans() {
  if (!window.indexedDB) return;
  scanDb().then(function (db) {
    var all = db.transaction("scans").objectStore("scans").getAll();
    all.onsuccess = function () {
      Object.keys(S.scans).forEach(function (k) { URL.revokeObjectURL(S.scans[k].url); });
      S.scans = {};
      (all.result || []).sort(function (a, b) { return a.at < b.at ? -1 : 1; }).forEach(function (r) {
        if (S.scans[r.key]) URL.revokeObjectURL(S.scans[r.key].url);
        S.scans[r.key] = { url: URL.createObjectURL(r.blob), pages: r.pages, at: new Date(r.at) };
      });
      if (S.who && S.payload && !S.noteKey) { S.keepScroll = true; render(); }
    };
  }).catch(function () { /* no IndexedDB: scans still go to the dashboard */ });
}
// What to show for a load's scan: this device's copy (with a View link), else what the server knows.
function scanInfo(key) {
  var loc = S.scans[key];
  if (loc) return loc;
  var sv = S.serverScans[S.loadOrder[key]];
  return sv ? { pages: sv.pages || 1, at: new Date(sv.at), url: "" } : null;
}
function scanHtml(key) {
  var sc = scanInfo(key);
  if (!sc) return "";
  return '<span class="drv-scanned">' + SCAN_ICON + "<span><b>Scanned</b> · " + sc.pages + " page" + (sc.pages > 1 ? "s" : "") +
    " · " + esc(timeLabel(sc.at)) + "</span></span>" +
    (sc.url ? '<a class="btn sm" href="' + esc(sc.url) + '" target="_blank" rel="noopener">View PDF</a>' : "");
}
function noteBtn(key, big) {
  return S.noteKey !== key ? '<button class="' + (big ? "btn" : "btn sm") + '" data-note="' + esc(key) + '">Add Note</button>' : "";
}
function scanBtn(key, big) {
  return '<button class="' + (big ? "btn" : "btn sm") + '" data-scan="' + esc(key) + '">Scan POD / BOL</button>';
}
// Store map: a picture of the store (PNG in the storeimages folder) for bag orders.
function storeMapUrl(o) {
  var u = o && o.customer_map_url || "";
  return /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(u) ? u : "";
}
function storeMapBtn(key, big) {
  var o = orderForKey(key);
  return o && o.kind === "internal" && !o.is_transfer && storeMapUrl(o)
    ? '<button class="btn ' + (big ? "" : "sm") + '" data-smap="' + esc(key) + '">Store Map</button>' : "";
}
function openStoreMap(key) {
  var o = orderForKey(key), url = storeMapUrl(o);
  if (!url || document.querySelector(".smap")) return;
  var el = document.createElement("div");
  el.className = "smap"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Store map");
  el.innerHTML = '<div class="smap-top"><button class="btn" data-smap-close>Close</button>' +
    '<div class="smap-title"><b>' + esc(o.customer_name || "Store") + "</b><span>Store map</span></div>" +
    '<a class="btn" href="' + esc(url) + '" target="_blank" rel="noopener">Open Full Size</a></div>' +
    '<div class="smap-body"><img src="' + esc(url) + '" alt="Store map for ' + esc(o.customer_name || "this store") + '"></div>';
  document.body.appendChild(el);
  document.body.style.overflow = "hidden";
}
function closeStoreMap() {
  var el = document.querySelector(".smap");
  if (el) { el.remove(); document.body.style.overflow = ""; }
}
document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeStoreMap(); });
function noteButtons(key, big) { return storeMapBtn(key, big) + noteBtn(key, big) + scanBtn(key, big); }
function dayBarHtml(ds, today, cls) {
  var dp = dParts(ds);
  return '<div class="' + cls + (ds === today ? " today" : "") + '" id="d-' + ds + '"><span class="dwk">' + dp.dow.toUpperCase() +
    '</span><span class="dnum">' + dp.md + "</span>" + (ds === today ? '<span class="today-tag">Today</span>' : "") + "</div>";
}
function vDriverGrid(d) {
  var p = S.payload, today = todayIso();
  var h = '<div class="drv-scroll"><div class="drv-pad" style="padding-top:10px"><div class="dv">' +
    '<div class="hd">' + esc(d.driver || "Load") + '</div><div class="hd">Rexius Order #</div><div class="hd">Dispatch Notes</div><div class="hd">PO / PU #</div>' +
    '<div class="hd">Delivery #</div><div class="hd">Load #</div><div class="hd">Driver Notes</div>';
  p.dates.forEach(function (ds, di) {
    h += dayBarHtml(ds, today, "day-bar");
    var rows = d.rows.slice(di * p.slots_per_day, (di + 1) * p.slots_per_day);
    if (rows.some(function (r) { return r.off; })) { h += '<div class="off-cell off-hatch"><div class="off-label">OFF</div></div>'; return; }
    rows.forEach(function (r, s) {
      var key = d.truck_id + "|" + ds + "|" + (s + 1), isLoad = !!S.loadKeys[key];   // typed cells: text only
      S.chipTitle[key] = String(r.chip || "").split("\n")[0];
      h += "<div>" + (r.chip ? '<div class="load-txt' + (r.color ? "" : " unfilled") + '" style="' + fillStyle(r.color) + '">' + tabChipHtml(key, r) +
        (isLoad ? '<div class="chip-scan">' + storeMapBtn(key) + scanBtn(key) + scanHtml(key) + "</div>" : "") + "</div>" : "") + "</div>" +
        '<div class="mono">' + esc(rexiusOrderNo(key)) + "</div>" +
        "<div>" + esc(r.notes || "") + "</div>" +
        '<div class="mono">' + esc(r.po_number || "") + "</div>" +
        '<div class="mono">' + esc(r.delivery_number || "") + "</div>" +
        '<div class="mono">' + esc(loadNo(key)) + "</div>" +
        "<div>" + (isLoad ? '<div class="pod-btns">' + noteBtn(key) + "</div>" + notesHtml(key) : "") + "</div>";
    });
  });
  return h + "</div></div></div>";
}
function vDriverCards(d) {
  var p = S.payload, today = todayIso(), h = '<div class="drv-scroll"><div class="drv-pad"><div class="drv-days">';
  p.dates.forEach(function (ds, di) {
    var rows = d.rows.slice(di * p.slots_per_day, (di + 1) * p.slots_per_day);
    h += '<section class="drv-day' + (ds === today ? " today" : "") + '">' + dayBarHtml(ds, today, "drv-day-hd");
    if (rows.some(function (r) { return r.off; })) { h += '<div class="drv-card off off-hatch"><div class="off-label">OFF</div></div></section>'; return; }
    var any = false;
    rows.forEach(function (r, s) {
      if (!r.chip) return;
      any = true;
      var key = d.truck_id + "|" + ds + "|" + (s + 1), isLoad = !!S.loadKeys[key];   // typed cells: text only
      S.chipTitle[key] = String(r.chip || "").split("\n")[0];
      var fields = [["Rexius Order #", rexiusOrderNo(key)], ["Dispatch Notes", r.notes], ["PO / PU #", r.po_number],
        ["Delivery #", r.delivery_number], ["Load #", loadNo(key)]].filter(function (f) { return f[1]; });
      var links = [];   // store map / pickup / drop buttons are off until the design is settled
      h += '<div class="drv-card"><div class="load-txt' + (r.color ? "" : " unfilled") + '" style="' + fillStyle(r.color) + '">' + tabChipHtml(key, r) + "</div>" +
        (fields.length ? "<dl>" + fields.map(function (f) { return "<dt>" + f[0] + "</dt><dd>" + esc(f[1]) + "</dd>"; }).join("") + "</dl>" : "") +
        (links.length || isLoad ? '<div class="links">' + links.map(function (l) {
          return '<a class="btn drv-map" href="' + esc(l[0]) + '" target="_blank" rel="noopener">' + (l[2] ? MAPS_ICON : "") + l[1] + "</a>"; }).join("") +
          (isLoad ? '<span class="sp"></span>' + noteButtons(key, true) : "") + "</div>" : "") +
        (isLoad ? '<div class="drv-card-notes">' + (scanInfo(key) ? '<div class="scan-row">' + scanHtml(key) + "</div>" : "") + notesHtml(key) + "</div>" : "") + "</div>";
    });
    if (!any) h += '<div class="drv-empty">Nothing scheduled</div>';
    h += "</section>";
  });
  return h + "</div></div></div>";
}

/* ── Render ───────────────────────────────────────────────────────────── */
var NARROW = window.matchMedia("(max-width: 900px)");
function render() {
  try { renderInner(); } catch (e) { showFatal(e); if (window.console) console.error(e); }
}
function renderInner() {
  document.body.classList.toggle("drv-signed-out", !S.who || !S.payload);
  document.body.classList.toggle("drv-bagplant", isBagPlant());
  renderHeader();
  renderTabs();
  // Until a published schedule is on screen, say why: loading, nothing published yet,
  // or a problem reaching it. (The bag plant page never shows the drivers' sign-in box.)
  if (!DEMO && !S.payload) {
    document.body.classList.remove("drv-signed-out");
    var msg = S.loading && !S.loadedAt ? "<b>Loading the schedule…</b>"
      : S.error ? "<b>Couldn't load the schedule.</b> " + esc(S.error) + ' <button class="btn pri" id="refresh">Refresh</button>'
      : '<b>Nothing has been published yet.</b> Check back once dispatch publishes the schedule. <button class="btn pri" id="refresh">Refresh</button>';
    $("#main").innerHTML = '<div class="drv-note">' + msg + "</div>";
    return;
  }
  if (BAG_PLANT && !S.payload) { $("#main").innerHTML = '<div class="drv-note"><b>Loading the schedule…</b></div>'; return; }
  if (!S.who || !S.payload) {
    // Already on the sign-in screen: just refresh the name list, never
    // rebuild the box (that would kick out whoever is mid-typing).
    var box = $("#login-driver");
    if (box) {
      $("#login-names").innerHTML = fleet().map(function (d) { return '<option value="' + esc(d.driver) + '">'; }).join("");
      box.placeholder = S.payload ? "Your name" : "Loading drivers…";
      return;
    }
    $("#main").innerHTML = vLogin();
    return;
  }
  if (!allowedTab(S.tab)) S.tab = driverByTruck(S.who.truck) ? String(S.who.truck) : "cw";
  var d = S.tab === "cw" ? null : driverByTruck(S.tab);
  var prev = $("#main .grid-wrap, #main .drv-scroll"), top = prev ? prev.scrollTop : 0, left = prev ? prev.scrollLeft : 0;
  var title = d ? (d.driver || "Unassigned") + " · " + d.truck : "Current Week";
  $("#main").innerHTML = toolbarHtml(title) + noticeHtml() +
    (d ? (NARROW.matches ? vDriverCards(d) : vDriverGrid(d)) : vCurrentWeek());
  logView(d ? "own" : "cw");
  var sc = $("#main .grid-wrap, #main .drv-scroll");
  if (S.scrollTo) {
    var target = document.getElementById("d-" + S.scrollTo);
    if (target && sc) sc.scrollTop = Math.max(0, target.offsetTop - (NARROW.matches ? 0 : 40));
    S.scrollTo = null;
  } else if (sc && S.keepScroll) { sc.scrollTop = top; sc.scrollLeft = left; }
  S.keepScroll = false;
}
function renderBusy() {
  var b = $("#refresh");
  if (b) { b.disabled = true; b.innerHTML = SYNC_ICON + "Refreshing"; }
}
function openTab(tab, date) {
  if (!allowedTab(tab)) return;
  S.tab = tab; S.scrollTo = date || null; store("dept12DriverTab", tab); render();
}

/* ── Events ───────────────────────────────────────────────────────────── */
document.addEventListener("click", function (e) {
  var t = e.target.closest("[data-tab]");
  if (t) { openTab(t.getAttribute("data-tab")); return; }
  var go = e.target.closest("[data-go]");
  if (go) { var g = go.getAttribute("data-go").split("|"); openTab(g[0], g[1]); return; }
  var nb = e.target.closest("[data-note]");
  if (nb) { S.noteKey = nb.getAttribute("data-note"); S.keepScroll = true; render(); var ta = $("#note-draft"); if (ta) ta.focus(); return; }
  if (e.target.closest("[data-note-cancel]")) { S.noteKey = null; S.keepScroll = true; render(); return; }
  var ns = e.target.closest("[data-note-save]");
  if (ns) {
    ns.disabled = true;
    saveNote(ns.getAttribute("data-note-save"), $("#note-draft").value).then(function (saved) {
      if (!saved) { ns.disabled = false; var d = $("#note-draft"); if (d) d.focus(); return; }
      S.noteKey = null; S.keepScroll = true; render(); toast("Note saved");
    }, function (err) { ns.disabled = false; toast("Couldn't save the note: " + err.message, true); });
    return;
  }
  var smb = e.target.closest("[data-smap]");
  if (smb) { openStoreMap(smb.getAttribute("data-smap")); return; }
  if (e.target.closest("[data-smap-close]")) { closeStoreMap(); return; }
  var sb = e.target.closest("[data-scan]");
  if (sb) {
    var skey = sb.getAttribute("data-scan");
    window.Dept12Scanner.open({ title: S.chipTitle[skey] || "", onDone: function (blob, pages) {
      sendScan(skey, blob, pages).then(function () {
        loadScans(); loadActivity(); toast("POD / BOL sent · " + pages + " page" + (pages > 1 ? "s" : ""));
      }, function (err) { toast("Couldn't send the scan: " + ((err && err.message) || "try again") + ".", true); });
    } });
    return;
  }
  var id = (e.target.closest("button") || {}).id;
  if (id === "refresh") { S.keepScroll = true; load(); }
  else if (id === "signout") signOut();
  else if (id === "login-go") {
    var d = driverByName($("#login-driver").value);
    if (d) signInAs({ role: "driver", truck: String(d.truck), name: d.driver });
    else $("#login-err").textContent = "That name isn't on the schedule. Pick it from the list.";
  }
});
document.addEventListener("input", function (e) {
  if (e.target.id === "login-driver") { $("#login-go").disabled = !e.target.value.trim(); $("#login-err").textContent = ""; }
});
document.addEventListener("change", function (e) {
  if (e.target.id === "login-driver") { $("#login-go").disabled = !e.target.value.trim(); return; }

});
document.addEventListener("keydown", function (e) {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches(".chip[data-go]")) { e.preventDefault(); e.target.click(); }
  if (e.key === "Enter" && e.target.id === "login-driver") { e.preventDefault(); $("#login-go").click(); }
});
NARROW.addEventListener("change", function () { S.keepScroll = true; render(); });
var resizeT = null;
window.addEventListener("resize", function () {
  if (!isBagPlant()) return;
  clearTimeout(resizeT); resizeT = setTimeout(function () { S.keepScroll = true; render(); }, 150);
});
/* ── Sample data (same shape as driver_week_data) ─────────────────────── */
function sampleDates(start, count) {
  var out = [], d = start ? new Date(start + "T12:00:00") : new Date(); d.setHours(12, 0, 0, 0);
  while (out.length < count) {
    if (d.getDay() !== 0 && d.getDay() !== 6) out.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"));
    d.setDate(d.getDate() + 1);
  }
  return out;
}
var SAMPLE_DATES = [];
function sampleRpc(fn, args) {
  if (fn === "driver_week_dates") { SAMPLE_DATES = sampleDates(args.p_start, args.p_count || 3); return Promise.resolve(SAMPLE_DATES); }
  return Promise.resolve(sampleData(SAMPLE_DATES));
}
function sampleData(dates) {
  var trucks = [
    { truck_id: "t1", number: "12-04", eq: "Flatbed", driver_name: "Marco V.", driver_color: "#2F6DB5" },
    { truck_id: "t2", number: "12-07", eq: "Step Deck", driver_name: "Jenna K.", driver_color: "#B5462F" },
    { truck_id: "t3", number: "12-09", eq: "Flatbed", driver_name: "Luis O.", driver_color: "#7A4FB0" },
    { truck_id: "t4", number: "12-11", eq: "Conestoga", driver_name: "Tom W.", driver_color: "#2E8C85" },
    { truck_id: "t5", number: "12-14", eq: "Flatbed", driver_name: "Dana R.", driver_color: "#9A6A15" }
  ];
  var plant3 = { name: "Rexius Plant 3", address: "88110 Territorial Hwy", city: "Eugene", state: "OR", phone: "" };
  function bag(id, cust, city, fork, timing, east, ord, pal, note) {
    return { id: id, kind: "internal", is_transfer: false, route_mode: "standard", solomon_order_no: ord, pallet_count: pal,
      customer_name: cust, cust_city: city, cust_state: "OR", cust_forklift: fork, cust_timing: timing, cust_umatilla: east,
      customer_map_url: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(cust + " " + city + " OR"),
      customer_notes: note || "", driver_note: "" };
  }
  function ext(id, broker, ord, load, drop, po, del, note) {
    return { id: id, kind: "external", is_transfer: false, route_mode: "standard", solomon_order_no: ord, broker_load_no: load,
      broker_name: broker, po_number: po, delivery_number: del, driver_note: note || "",
      pickup_name: plant3.name, pickup_address: plant3.address, pickup_city: plant3.city, pickup_state: plant3.state,
      delivery_name: drop[0], delivery_address: drop[1], delivery_city: drop[2], delivery_state: "OR", delivery_phone: drop[3] || "" };
  }
  function xfer(id, note, dept, color) {
    return { id: id, kind: "external", is_transfer: true, driver_note: note, transfer_department_name: dept, transfer_department_color: color };
  }
  var orders = [
    bag("o1", "Willow Creek Garden Center", "Salem", "Has forklift", "early", false, "07-2609-1142", 22, "Dock 2 in back. Ask for Renee."),
    bag("o2", "Cedar Hollow Nursery", "Albany", "NF", "anytime", false, "07-2609-1150", 14),
    ext("o3", "Northline Logistics", "12-0926-0041", "NL-448213", ["High Desert Builders Yard", "61230 S Hwy 97", "Bend", "541-555-0142"], "PU 55102", "D-88342", "Straps + 4 tarps. Appt 1:00 PM"),
    bag("o4", "Blue Heron Farm Supply", "Hermiston", "Has forklift", "early", true, "07-2609-1201", 26),
    bag("o5", "Three Rivers Feed & Seed", "Pendleton", "Has forklift", "anytime", true, "07-2609-1206", 18),
    xfer("o6", "Haul bark fines, 2 loads", "Dept 4 · Bark Plant", "#CFE2F3"),
    bag("o7", "Coast Range Landscape Supply", "Corvallis", "Has forklift", "early", false, "07-2609-1233", 24),
    ext("o8", "Summit Freight", "12-0926-0038", "SF-20931", ["Mountain View Rock Co", "2200 NE 4th St", "Redmond"], "PO 7719", "", "Call receiver 30 min out"),
    bag("o9", "Riverside Home & Garden", "Roseburg", "NF", "anytime", false, "07-2609-1171", 20),
    bag("o10", "Umpqua Valley Nursery", "Sutherlin", "Has forklift", "early", false, "07-2609-1175", 12),
    bag("o11", "Grants Pass Garden Depot", "Grants Pass", "Spyder", "early", false, "07-2609-1210", 24),
    ext("o12", "Northline Logistics", "12-0926-0047", "NL-448377", ["Klamath Supply Yard", "4100 Washburn Way", "Klamath Falls"], "PU 55240", "D-88501"),
    bag("o13", "Tualatin Valley Garden", "Hillsboro", "Has forklift", "early", false, "07-2609-1144", 26),
    bag("o14", "Forest Grove Feed", "Forest Grove", "Has forklift", "anytime", false, "07-2609-1148", 10),
    xfer("o15", "Chips to Dept 7 yard", "Dept 7 · Soils", "#EAD1DC"),
    bag("o16", "Clackamas Garden Supply", "Oregon City", "NF", "anytime", false, "07-2609-1215", 16),
    bag("o17", "Newberg Nursery & Stone", "Newberg", "Has forklift", "early", false, "07-2609-1222", 22),
    bag("o18", "Columbia Basin Garden", "The Dalles", "Has forklift", "early", true, "07-2609-1152", 24),
    bag("o19", "Blue Mountain Supply", "La Grande", "Has forklift", "anytime", true, "07-2609-1180", 26),
    ext("o20", "Summit Freight", "12-0926-0044", "SF-21044", ["Cascade Pavers Lot", "1800 SE 3rd St", "Bend"], "PO 7788", "D-6120"),
    bag("o21", "Baker City Home & Ranch", "Baker City", "NF", "early", true, "07-2609-1229", 18),
    bag("o22", "McKenzie River Garden", "Springfield", "Has forklift", "early", false, "07-2609-1236", 20),
    bag("o23", "Florence Coast Supply", "Florence", "Has forklift", "anytime", false, "07-2609-1238", 14)
  ];
  // [truck, dayIndex, slot, orderId]
  var plan = [
    ["t1", 0, 1, "o1"], ["t1", 0, 2, "o2"], ["t1", 1, 1, "o3"], ["t1", 2, 1, "o4"], ["t1", 2, 2, "o5"], ["t1", 3, 1, "o6"], ["t1", 4, 1, "o7"],
    ["t2", 0, 1, "o8"], ["t2", 1, 1, "o9"], ["t2", 1, 2, "o10"], ["t2", 2, 1, "o11"], ["t2", 4, 1, "o12"],
    ["t3", 0, 1, "o13"], ["t3", 0, 2, "o14"], ["t3", 1, 1, "o15"], ["t3", 2, 1, "o16"], ["t3", 3, 1, "o17"],
    ["t4", 0, 1, "o18"], ["t4", 1, 1, "o19"], ["t4", 2, 1, "o20"], ["t4", 3, 1, "o21"],
    ["t5", 0, 1, "o22"], ["t5", 1, 1, "o23"]
  ];
  // A couple of demo appointments so the tags and the APPT SET box can be seen.
  orders.forEach(function (o) {
    if (o.id === "o1") o.customer_map_url = "https://raw.githubusercontent.com/NateTooNice/storeimages/main/BM%20655.png";
    if (o.id === "o2") o.customer_map_url = "https://raw.githubusercontent.com/NateTooNice/storeimages/main/BM%20657.png";
  });
  orders.forEach(function (o) {
    if (o.id === "o3") { o.pick_appt = { date: "", from: "07:00", to: "09:00" }; o.drop_appt = { date: "", from: "13:00", to: "" }; }
    if (o.id === "o8") { o.drop_appt = { date: "", from: "10:30", to: "11:30" }; }
  });
  var loads = plan.filter(function (x) { return dates[x[1]]; }).map(function (x, i) {
    return { id: "l" + i, truck_id: x[0], scheduled_date: dates[x[1]], slot: x[2], order_ids: [x[3]] };
  });
  // Typed Scheduler cells (schedule_notes): [truck, dayIndex, slot, text, fill]
  var notes = [["t1", 0, 3, "Load here\nPlant 3 yard, 22 PAL mulch", null], ["t2", 0, 2, "Deadhead back to Plant 3", null],
    ["t3", 1, 2, "Load here", "#F4CCCC"], ["t4", 2, 2, "Pick up empty pallets at Hermiston", "#D9D2E9"],
    ["t5", 2, 1, "Training ride-along with Luis", null], ["t4", 4, 1, "Shop day: tires and DOT inspection", null], ["t1", 3, 2, "PM service at shop, 1:30", null]]
    .filter(function (x) { return dates[x[1]]; })
    .map(function (x) { return { truck_id: x[0], scheduled_date: dates[x[1]], slot: x[2], body: x[3], fmt: x[4] ? { fill: x[4] } : {}, cat_color: null }; });
  var off = [["t2", 3], ["t3", 4], ["t5", 3], ["t5", 4]].filter(function (x) { return dates[x[1]]; })
    .map(function (x) { return { truck_id: x[0], off_date: dates[x[1]] }; });
  return { trucks: trucks, loads: loads, notes: notes, off_days: off, orders: orders, stops: [] };
}

render();
load();
loadScans();
})();

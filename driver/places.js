/* Flatbed Schedule — the Pick/Drop List for drivers, a location's details, photos and files, edit requests, and
 * Upload.
 *
 *   Dept12Places.init(ctx)    driver.js hands over what this needs (rpc, sign-in token, who is signed in, toast …)
 *   Dept12Places.listHtml()   the Pick/Drop List tab: every location A to Z, searchable
 *   Dept12Places.mounted()    after the tab is drawn (puts the search box and the scroll back)
 *   Dept12Places.arrowHtml(id)  the small › on a load's pick / drop / store line
 *
 * A location opens in a panel on the right (it stays open while the schedule redraws). From there: Photos & Docs, and
 * Edit Info Or Add Photos. To the driver an edit is simply saved: their new values show at once with a "Pending" tag.
 * Behind that it goes to the office (app_location_change) and the list itself changes when the office approves; the
 * driver's copy (kept on this device) goes away once the office has decided.
 * Upload (on each load next to Scan POD, and on the toolbar) opens a window like the scanner's: Take Photo / Upload Photo,
 * photos kept in colour (or PDFs), Done sends them to the office (app_office_upload).
 * Files go to the "location-files" storage folder: pending/… for an edit, inbox/… for an upload.
 */
(function () {
"use strict";

var C = null;                                    // from driver.js
var P = { list: null, at: 0, loading: null, q: "", scroll: 0, open: null, edit: null, err: "" };
var CACHE = "dept12Places", MINE = "dept12PlacesMine";
// The driver's own saved changes, shown as if made until the office decides: { location id: { phone, dock_hours, appointment, note } }.
var MY = {};
try { MY = JSON.parse(localStorage.getItem(MINE) || "{}") || {}; } catch (e) { MY = {}; }
function saveMine() { try { localStorage.setItem(MINE, JSON.stringify(MY)); } catch (e) { /* no storage */ } }
// A location as this driver sees it: the list's values with their own pending changes on top.
function view(l) {
  var m = l && l.mine_pending && MY[l.id]; if (!m) return l;
  var v = Object.assign({}, l, { pend: {} });
  ["phone", "dock_hours", "appointment"].forEach(function (k) { if (m[k] !== undefined) { v[k] = m[k]; v.pend[k] = true; } });
  if (m.note) { v.notes = [l.notes, m.note].filter(Boolean).join(" | "); v.pend.notes = true; }
  if (m.files) v.pend.files = m.files;
  return v;
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
}
function $(s, r) { return (r || document).querySelector(s); }
function emp() { var w = C && C.who(); return w && w.emp; }
function byId(id) { return (P.list || []).filter(function (l) { return l.id === id; })[0] || null; }
function clientId() { return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10); }
function safeName(n) { return String(n || "file").replace(/[^\w.\-]+/g, "_").replace(/^_+/, "").slice(-80) || "file"; }

/* ── Loading the list ── */
function load(force) {
  if (!C || !emp()) return Promise.resolve(null);
  if (P.loading) return P.loading;
  if (!force && P.list && Date.now() - P.at < 5 * 60 * 1000) return Promise.resolve(P.list);
  if (!P.list) {
    try { var c = JSON.parse(localStorage.getItem(CACHE) || "null"); if (c && c.list) { P.list = c.list; P.at = 0; } } catch (e) { /* no cache */ }
  }
  P.loading = C.rpc("app_places", { p_emp: emp() }).then(function (list) {
    P.list = list || []; P.at = Date.now(); P.err = "";
    // The office has decided (approved or not): drop this device's copy of the change.
    Object.keys(MY).forEach(function (id) { var l = byId(id); if (!l || !l.mine_pending) delete MY[id]; }); saveMine();
    try { localStorage.setItem(CACHE, JSON.stringify({ list: P.list })); } catch (e) { /* too big or no storage: fine */ }
    return P.list;
  }, function (err) {
    P.err = (err && err.message) || "Couldn't load the list";
    return P.list;
  }).then(function (l) { P.loading = null; redrawOpen(); if (onTab()) C.redraw(); return l; });
  return P.loading;
}
function onTab() { return !!document.querySelector(".plc-list"); }

/* ── The tab ── */
function rowsHtml() {
  var q = P.q.trim().toLowerCase(), last = "", h = "", n = 0;
  (P.list || []).forEach(function (l0) {
    var l = view(l0);
    if (q && [l.name, l.address, l.city, l.state, l.phone].join(" ").toLowerCase().indexOf(q) < 0) return;
    n++;
    var ch = String(l.name || "").charAt(0).toUpperCase(); ch = /[A-Z]/.test(ch) ? ch : "#";
    if (!q && ch !== last) { h += '<tr class="plc-letter"><td colspan="8">' + ch + "</td></tr>"; last = ch; }
    h += '<tr data-place="' + esc(l.id) + '"' + (P.open === l.id ? ' class="on"' : "") + "><td>" + esc(l.name) +
      (l.pend ? ' <span class="plc-tag wait">Pending</span>' : "") + "</td><td>" + esc(l.address) + "</td><td>" + esc(l.city) +
      "</td><td>" + esc(l.state) + "</td><td>" + esc(l.phone) + "</td><td>" + esc(l.dock_hours) + "</td><td>" + esc(l.appointment) +
      "</td><td>" + ((l.files || []).length || "") + "</td></tr>";
  });
  return { html: h, n: n };
}
function listHtml() {
  if (!P.list) load();
  var r = rowsHtml();
  return '<div class="plc-list"><div class="plc-tools"><input id="plc-q" type="search" placeholder="Search name, city, street, phone" autocomplete="off" value="' + esc(P.q) + '">' +
    '<span class="lbl" id="plc-n">' + (P.list ? r.n + " places" : "") + "</span>" +
    (P.err ? '<span class="plc-err">' + esc(P.err) + "</span>" : "") + "</div>" +
    '<div class="plc-scroll grid-wrap">' + (P.list ? '<table class="plc-tbl"><thead><tr><th>Company</th><th>Address</th><th>City</th><th>St</th><th>Phone</th><th>Dock Hours</th><th>Appt</th><th>Photos &amp; Docs</th></tr></thead><tbody id="plc-rows">' + r.html + "</tbody></table>"
      : '<div class="drv-note"><b>Loading the Pick/Drop List…</b></div>') + "</div></div>";
}
function mounted() {
  var sc = $(".plc-scroll"); if (sc) sc.scrollTop = P.scroll;
  if (P.focusSearch) { var q = $("#plc-q"); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } P.focusSearch = false; }
}
document.addEventListener("input", function (e) {
  if (e.target.id !== "plc-q") return;
  P.q = e.target.value;
  var r = rowsHtml(), body = $("#plc-rows"), n = $("#plc-n");
  if (body) body.innerHTML = r.html; if (n) n.textContent = r.n + " places";
});
document.addEventListener("scroll", function (e) { if (e.target && e.target.classList && e.target.classList.contains("plc-scroll")) P.scroll = e.target.scrollTop; }, true);

/* ── The small › on a load ── */
function arrowHtml(id, cls) {
  return '<button type="button" class="loc-more' + (cls ? " " + cls : "") + '" data-place="' + esc(id) + '" aria-label="Dock hours, phone, photos and more" title="Dock hours, phone, photos and more">›</button>';
}

/* ── The location panel (outside the schedule, so a redraw never closes it or wipes what is being typed) ── */
function panel() {
  var el = $("#plc-panel");
  if (!el) {
    el = document.createElement("aside"); el.id = "plc-panel"; el.className = "plc-panel"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Location");
    document.body.appendChild(el);
  }
  return el;
}
function openPlace(id) {
  P.open = id; P.edit = null;
  var el = panel(); el.classList.add("on");
  drawPanel();
  if (!byId(id)) load(true);
  var tr = document.querySelector('tr[data-place="' + id + '"]');
  document.querySelectorAll(".plc-tbl tr.on").forEach(function (x) { x.classList.remove("on"); });
  if (tr) { tr.classList.add("on"); }
}
function closePlace() {
  if (P.edit && editChanged() && !window.confirm("Close without saving your changes?")) return;
  P.open = null; P.edit = null; dropPicks();
  var el = $("#plc-panel"); if (el) el.classList.remove("on");
  document.querySelectorAll(".plc-tbl tr.on").forEach(function (x) { x.classList.remove("on"); });
}
function redrawOpen() { if (P.open && !P.edit && $("#plc-panel.on")) drawPanel(); }
function row(label, val, pend) { return '<div class="plc-row"><span>' + label + "</span><span>" + (val ? esc(val) : "—") + (pend ? ' <span class="plc-tag wait">Pending</span>' : "") + "</span></div>"; }
function drawPanel() {
  var l = view(byId(P.open)), el = panel();
  var top = '<div class="plc-top"><button class="btn" type="button" data-plc="close">Close</button><span style="flex:1"></span>' +
    (onTab() ? "" : '<button class="btn" type="button" data-plc="list">See In Pick/Drop List</button>') + "</div>";
  if (!l) { el.innerHTML = top + '<div class="plc-sec">' + (P.loading ? "Loading…" : "This location is not on the list.") + "</div>"; return; }
  if (P.edit) { el.innerHTML = top + editHtml(l); return; }      // l is the driver's view: they edit what they see
  var n = (l.files || []).length;
  el.innerHTML = top + '<div class="plc-body"><div class="plc-hd"><h3>' + esc(l.name) + "</h3><p>" + esc([l.address, [l.city, l.state].filter(Boolean).join(" ")].filter(Boolean).join(", ")) + "</p></div>" +
    '<div class="plc-sec">' + row("Phone", l.phone, l.pend && l.pend.phone) + row("Dock Hours", l.dock_hours, l.pend && l.pend.dock_hours) +
    row("Appointment", l.appointment, l.pend && l.pend.appointment) + row("Notes", l.notes, l.pend && l.pend.notes) +
    (l.pend && l.pend.files ? row("Photos", l.pend.files + " added", true) : "") + "</div>" +
    '<div class="plc-btns"><button class="btn" type="button" data-plc="files"' + (n ? "" : " disabled") + ">Photos &amp; Docs" + (n ? " (" + n + ")" : "") + "</button>" +
    '<button class="btn pri" type="button" data-plc="edit">Edit Info Or Add Photos</button></div></div>';
}

/* ── Edit request ── */
function editChanged() {
  var l = view(byId(P.open)), e = P.edit; if (!l || !e) return false;
  return e.phone !== (l.phone || "") || e.dock_hours !== (l.dock_hours || "") || e.appointment !== (l.appointment || "") || !!e.note.trim() || e.files.length > 0;
}
function editHtml(l) {
  var e = P.edit;
  var fld = function (k, label, was) {
    var val = e[k], ch = val !== (was || "");
    var input = k === "appointment"
      ? '<select data-pe="appointment"><option value=""></option><option' + (val === "Yes" ? " selected" : "") + ">Yes</option><option" + (val === "No" ? " selected" : "") + ">No</option></select>"
      : '<input data-pe="' + k + '" value="' + esc(val) + '"' + (k === "phone" ? ' inputmode="tel"' : "") + ">";
    return '<label class="plc-field' + (ch ? " ch" : "") + '"><span>' + label + "</span>" + input + (ch ? '<em>Now: ' + (esc(was) || "blank") + "</em>" : "") + "</label>";
  };
  return '<div class="plc-body"><div class="plc-hd"><h3>Edit ' + esc(l.name) + "</h3></div>" +
    '<div class="plc-sec">' + fld("phone", "Phone", l.phone) + fld("dock_hours", "Dock Hours", l.dock_hours) + fld("appointment", "Appointment", l.appointment) +
    '<label class="plc-field"><span>Add a note</span><textarea data-pe="note" rows="3" placeholder="Something the next driver should know">' + esc(e.note) + "</textarea></label></div>" +
    '<div class="plc-sec"><span class="lbl">Add photos or documents</span>' + picksHtml(e.files) +
    '<label class="plc-add">+ Take Photo Or Choose File<input type="file" accept="image/*,application/pdf" multiple data-pfile="edit" hidden></label></div>' +
    '<div class="plc-btns"><button class="btn" type="button" data-plc="cancel">Cancel</button><button class="btn pri" type="button" data-plc="send"' + (e.busy ? " disabled" : "") + ">" + (e.busy ? "Saving…" : "Save") + "</button></div></div>";
}
function picksHtml(files) {
  return files.length ? '<div class="plc-thumbs">' + files.map(function (f, i) {
    return '<div class="plc-thumb' + (f.kind === "document" ? " doc" : "") + '">' + (f.kind === "document" ? '<span>' + esc(f.name) + "</span>" : '<img alt="" src="' + f.url + '">') +
      '<button type="button" class="plc-x" data-prm="' + i + '" aria-label="Remove">×</button></div>';
  }).join("") + "</div>" : "";
}
function dropPicks() { (P.edit ? P.edit.files : []).forEach(function (f) { if (f.url) URL.revokeObjectURL(f.url); }); }

// A photo is made smaller before it goes (longest side 2000 px, JPEG), so it sends on a weak signal. PDFs go as they are.
function prepFile(file) {
  var isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (isPdf) return Promise.resolve({ blob: file, name: safeName(file.name), mime: "application/pdf", kind: "document" });
  return new Promise(function (res) {
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var s = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob(function (b) { res({ blob: b || file, name: safeName(file.name).replace(/\.\w+$/, "") + ".jpg", mime: "image/jpeg", kind: "photo" }); }, "image/jpeg", 0.85);
    };
    img.onerror = function () { URL.revokeObjectURL(url); res({ blob: file, name: safeName(file.name), mime: file.type || "application/octet-stream", kind: "photo" }); };
    img.src = url;
  });
}
function upload(path, blob, mime) {
  var b = C.base();
  return C.token().then(function (token) {
    var h = { "apikey": b.key, "Content-Type": mime || "application/octet-stream", "x-upsert": "false" };
    if (token) h.Authorization = "Bearer " + token;
    return fetch(b.url + "/storage/v1/object/location-files/" + path.split("/").map(encodeURIComponent).join("/"), { method: "POST", headers: h, body: blob });
  }).then(function (r) {
    if (r.ok) return path;
    return r.text().then(function (t) {
      if (/"statusCode":"?409|Duplicate|already exists/i.test(t)) return path;      // an earlier try got this file there
      throw new Error("the upload failed (" + r.status + ")");
    });
  }, function (err) { err.network = true; throw err; });
}
function uploadAll(folder, files) {
  var list = [];
  return files.reduce(function (chain, f, i) {
    return chain.then(function () {
      var path = folder + "/" + (i + 1) + "-" + f.name;
      return upload(path, f.blob, f.mime).then(function () { list.push({ path: path, name: f.name, kind: f.kind, mime: f.mime }); });
    });
  }, Promise.resolve()).then(function () { return list; });
}
function sendEdit() {
  var l0 = byId(P.open), l = view(l0), e = P.edit; if (!l0 || !e || e.busy) return;
  readFields();
  if (!editChanged()) { C.toast("Nothing changed yet.", true); return; }
  var changes = {};
  if (e.phone !== (l.phone || "")) changes.phone = e.phone;
  if (e.dock_hours !== (l.dock_hours || "")) changes.dock_hours = e.dock_hours;
  if (e.appointment !== (l.appointment || "")) changes.appointment = e.appointment;
  if (e.note.trim()) changes.note = e.note.trim();
  e.busy = true; drawPanel();
  uploadAll("pending/" + e.id, e.files).then(function (files) {
    return C.rpc("app_location_change", { p_emp: emp(), p_location_id: l0.id, p_changes: changes, p_files: files, p_client_id: e.id });
  }).then(function () {
    var m = l0.mine_pending && MY[l0.id] ? MY[l0.id] : {};
    Object.keys(changes).forEach(function (k) { m[k] = k === "note" && m.note ? m.note + " | " + changes.note : changes[k]; });
    if (e.files.length) m.files = (m.files || 0) + e.files.length;
    MY[l0.id] = m; saveMine();
    dropPicks(); P.edit = null; l0.mine_pending = true; drawPanel(); refreshRows();
    C.toast("Saved.");
  }, function (err) {
    e.busy = false; drawPanel();
    C.toast((err && err.network) || /fetch|network|load failed/i.test((err && err.message) || "") ? "No signal. Your changes are still here; save again when you have signal." : "Couldn't save: " + ((err && err.message) || "try again") + ".", true);
  });
}
function refreshRows() { var body = $("#plc-rows"); if (body) body.innerHTML = rowsHtml().html; }

/* ── Photos & Docs ── */
function signedUrl(path) {
  var b = C.base();
  return C.token().then(function (token) {
    var h = { "apikey": b.key, "Content-Type": "application/json" };
    if (token) h.Authorization = "Bearer " + token;
    return fetch(b.url + "/storage/v1/object/sign/location-files/" + path.split("/").map(encodeURIComponent).join("/"), { method: "POST", headers: h, body: JSON.stringify({ expiresIn: 600 }) });
  }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.message || "Couldn't open it"); return j; }); })
    .then(function (j) { var u = j.signedURL || j.signedUrl || ""; return /^https?:/.test(u) ? u : b.url + "/storage/v1" + (u.charAt(0) === "/" ? "" : "/") + u; });
}
function openFiles(l, i) {
  var files = l.files || []; if (!files.length) return;
  var el = document.createElement("div"); el.className = "plc-gal"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Photos and documents");
  document.body.appendChild(el);
  var cur = i || 0;
  function draw() {
    var f = files[cur];
    el.innerHTML = '<div class="plc-gal-top"><b>' + esc(l.name) + " · Photos &amp; Docs (" + files.length + ')</b><button class="btn" type="button" data-pg="close">Close</button></div>' +
      '<div class="plc-gal-big" data-pg="big"><span class="plc-gal-wait">Loading…</span></div>' +
      '<div class="plc-gal-cap">' + esc(f.caption || f.name || "") + (f.by ? " · added by " + esc(f.by) : "") + (f.at ? " · " + esc(new Date(f.at).toLocaleDateString()) : "") + "</div>" +
      '<div class="plc-gal-strip">' + files.map(function (x, n) {
        return '<button type="button" class="plc-gal-t' + (n === cur ? " on" : "") + (x.kind === "document" ? " doc" : "") + '" data-pgi="' + n + '">' + esc(x.kind === "document" ? x.name : "Photo " + (n + 1)) + "</button>";
      }).join("") + "</div>";
    signedUrl(f.path).then(function (u) {
      var big = el.querySelector('[data-pg="big"]'); if (!big || files[cur] !== f) return;
      big.innerHTML = f.kind === "document" ? '<a class="btn pri" href="' + esc(u) + '" target="_blank" rel="noopener">Open ' + esc(f.name) + "</a>" : '<img alt="" src="' + esc(u) + '">';
    }, function (err) { var big = el.querySelector('[data-pg="big"]'); if (big) big.innerHTML = '<span class="plc-gal-wait">' + esc(err.message) + "</span>"; });
  }
  el.addEventListener("click", function (e) {
    var b = e.target.closest("[data-pg],[data-pgi]"); if (!b) return;
    if (b.getAttribute("data-pg") === "close") el.remove();
    else if (b.hasAttribute("data-pgi")) { cur = Number(b.getAttribute("data-pgi")); draw(); }
  });
  draw();
}

/* ── Upload: the same kind of window as Scan POD (Take Photo / Upload Photo), but photos stay as they are, in colour,
   and PDFs can be picked too. Done sends them to the office, tied to the load when it was opened from one. ── */
function uploadOpen(orderId, title) {
  if (document.querySelector("#plc-up")) return;
  var st = { id: clientId(), files: [], busy: false };
  var el = document.createElement("div");
  el.className = "scan"; el.id = "plc-up"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Upload");
  el.innerHTML = '<div class="scan-top"><button class="btn drv-hbtn" data-pu="cancel">Cancel</button>' +
    '<div class="scan-title"><b>Upload</b><span>' + esc(title || "Photos or files for the office") + "</span></div>" +
    '<button class="btn pri drv-hbtn" data-pu="done" disabled>Done</button></div>' +
    '<div class="scan-stage" data-pu-stage></div><div class="scan-bar" data-pu-bar></div><div class="scan-pages" data-pu-pages></div>' +
    '<input type="file" data-pu-cam accept="image/*" capture="environment" hidden>' +
    '<input type="file" data-pu-lib accept="image/*,application/pdf" multiple hidden>';
  document.body.appendChild(el);
  function q(s) { return el.querySelector(s); }
  function paint() {
    q("[data-pu=done]").disabled = st.busy || !st.files.length;
    q("[data-pu-stage]").innerHTML = st.busy
      ? '<div class="scan-capture"><div class="scan-hint"><b>Sending…</b></div></div>'
      : '<div class="scan-capture"><div class="scan-hint"><b>' + (st.files.length ? "Add another, or hit Done" : "Upload photos or files") + "</b>" +
        "Damage, a receipt, a sign at the dock: anything the office should see.</div>" +
        '<button class="btn pri scan-big" data-pu="camera">Take Photo</button><button class="btn scan-big" data-pu="library">Upload Photo</button></div>';
    q("[data-pu-bar]").innerHTML = st.files.length ? '<span class="scan-tip">' + st.files.length + (st.files.length > 1 ? " items" : " item") + " ready. Hit Done to send.</span>" : "";
    q("[data-pu-pages]").innerHTML = st.files.map(function (f, i) {
      return '<span class="scan-thumb plc-up-thumb">' + (f.url ? '<img alt="" src="' + f.url + '">' : "<em>PDF</em>") + "<span>" + (i + 1) + "</span>" +
        '<button type="button" class="plc-x" data-purm="' + i + '" aria-label="Remove">×</button></span>';
    }).join("");
  }
  function close() { st.files.forEach(function (f) { if (f.url) URL.revokeObjectURL(f.url); }); el.remove(); }
  el.addEventListener("change", function (e) {
    var inp = e.target.closest("[data-pu-cam],[data-pu-lib]"); if (!inp) return;
    addFiles(inp.files, st.files).then(function () { inp.value = ""; paint(); });
  });
  el.addEventListener("click", function (e) {
    var rm = e.target.closest("[data-purm]");
    if (rm) { var f = st.files.splice(Number(rm.getAttribute("data-purm")), 1)[0]; if (f && f.url) URL.revokeObjectURL(f.url); paint(); return; }
    var b = e.target.closest("[data-pu]"); if (!b || b.disabled) return;
    var k = b.getAttribute("data-pu");
    if (k === "camera") q("[data-pu-cam]").click();
    else if (k === "library") q("[data-pu-lib]").click();
    else if (k === "cancel") { if (!st.files.length || window.confirm("Close without sending?")) close(); }
    else if (k === "done") {
      st.busy = true; paint();
      uploadAll("inbox/" + st.id, st.files).then(function (files) {
        return C.rpc("app_office_upload", { p_emp: emp(), p_order_id: orderId || null, p_note: "", p_files: files, p_client_id: st.id });
      }).then(function () {
        var n = st.files.length; close();
        C.toast((n > 1 ? n + " items" : "Upload") + " sent to the office.");
      }, function (err) {
        st.busy = false; paint();
        C.toast((err && err.network) || /fetch|network|load failed/i.test((err && err.message) || "") ? "No signal. Hit Done again when you have signal." : "Couldn't send: " + ((err && err.message) || "try again") + ".", true);
      });
    }
  });
  paint();
}
function addFiles(list, into) {
  return [].slice.call(list || []).reduce(function (chain, file) {
    return chain.then(function () { return prepFile(file); }).then(function (f) { if (f.kind === "photo") f.url = URL.createObjectURL(f.blob); into.push(f); });
  }, Promise.resolve());
}

/* ── Clicks ── */
document.addEventListener("click", function (e) {
  if (!C) return;
  var pl = e.target.closest("[data-place]");
  if (pl && !e.target.closest("#plc-panel")) { e.preventDefault(); openPlace(pl.getAttribute("data-place")); return; }
  var ub = e.target.closest("[data-upload]");
  if (ub) { uploadOpen(ub.getAttribute("data-upload") || null, ub.getAttribute("data-upload-title") || ""); return; }
  var b = e.target.closest("[data-plc]");
  if (b && !b.disabled) {
    var k = b.getAttribute("data-plc"), l = byId(P.open);
    if (k === "close") closePlace();
    else if (k === "list") { var id = P.open; P.q = ""; P.scroll = 0; C.openTab("pd"); setTimeout(function () { openPlace(id); var tr = document.querySelector('tr[data-place="' + id + '"]'); if (tr) tr.scrollIntoView({ block: "center" }); }, 0); }
    else if (k === "files" && l) openFiles(l, 0);
    else if (k === "edit" && l) { var lv = view(l); P.edit = { id: clientId(), phone: lv.phone || "", dock_hours: lv.dock_hours || "", appointment: lv.appointment || "", note: "", files: [] }; drawPanel(); }
    else if (k === "cancel") { dropPicks(); P.edit = null; drawPanel(); }
    else if (k === "send") sendEdit();
    return;
  }
  var rm = e.target.closest("#plc-panel [data-prm]");
  if (rm && P.edit) { var f = P.edit.files.splice(Number(rm.getAttribute("data-prm")), 1)[0]; if (f && f.url) URL.revokeObjectURL(f.url); drawPanel(); }
});
// Typing updates the edit and marks that one field as changed in place. The form is never redrawn while it is used:
// a redraw would replace the box the driver just tapped and lose what they type next.
function markField(inp) {
  var k = inp.getAttribute("data-pe"), l = view(byId(P.open)); P.edit[k] = inp.value;
  if (k === "note" || !l) return;
  var was = l[k] || "", lab = inp.closest(".plc-field"), em = lab && lab.querySelector("em"), ch = inp.value !== was;
  if (!lab) return;
  lab.classList.toggle("ch", ch);
  if (ch && !em) { em = document.createElement("em"); lab.appendChild(em); }
  if (em) { if (ch) em.textContent = "Now: " + (was || "blank"); else em.remove(); }
}
document.addEventListener("change", function (e) {
  if (!P.edit) return;
  var inp = e.target.closest("#plc-panel [data-pe]");
  if (inp) { markField(inp); return; }
  var fi = e.target.closest("#plc-panel [data-pfile=edit]");
  if (fi) { readFields(); addFiles(fi.files, P.edit.files).then(drawPanel); }
});
document.addEventListener("input", function (e) {
  var t = e.target.closest("#plc-panel [data-pe]"); if (t && P.edit) markField(t);
});
function readFields() { [].forEach.call(document.querySelectorAll("#plc-panel [data-pe]"), function (i) { P.edit[i.getAttribute("data-pe")] = i.value; }); }
document.addEventListener("keydown", function (e) {
  if (e.key !== "Escape") return;
  var g = $(".plc-gal"); if (g) { g.remove(); return; }
  if ($("#plc-up")) return;
  if ($("#plc-panel.on")) closePlace();
});

window.Dept12Places = {
  init: function (ctx) { C = ctx; },
  listHtml: listHtml,
  mounted: mounted,
  arrowHtml: arrowHtml,
  load: load,
  openPlace: openPlace,
  isEditing: function () { return !!P.edit || !!document.querySelector("#plc-up"); }
};
})();

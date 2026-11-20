/* ═══ Driver inbox and the Pick/Drop location window ═══════════════════════════════════════════════════════
   Drivers send two kinds of things from their iPad (supabase/sql/2026-11-20_03):
   - a change to a Pick/Drop location (phone, dock hours, appointment, a note, photos / files): location_change_requests
   - photos / files for the office (Upload, next to Scan POD): driver_uploads
   Both show under "Needs your OK" at the top of the driver activity panel (header, top right). A change also shows in that
   location's window (Database → Pick/Drop List → the Open column), where the location's photos and files live too.
   Approving writes only the parts left ticked. */
var DINBOX = { changes: [], uploads: [], at: 0, busy: false, sig: "" };
var LOCWIN = { id: null, files: null };
var LFURL = {};                                    // stored path → { url, at }: signed links last 5 minutes
var CHG_FIELDS = [["phone", "Phone"], ["dock_hours", "Dock Hours"], ["appointment", "Appointment"], ["note", "Add To Notes"]];

function inboxCount() { return DINBOX.changes.length + DINBOX.uploads.length; }
function inboxLoad() {
  if (DINBOX.busy || !DB || typeof api !== "function") return Promise.resolve();
  DINBOX.busy = true;
  return api("driver-inbox").then(function (r) {
    DINBOX.changes = r.changes || []; DINBOX.uploads = r.uploads || []; DINBOX.at = Date.now();
    var sig = DINBOX.changes.map(function (x) { return x.id; }).join(",") + "|" + DINBOX.uploads.map(function (x) { return x.id; }).join(",");
    if (sig === DINBOX.sig) return;
    DINBOX.sig = sig;
    try { repaintSeen(); } catch (e) { /* header not drawn yet */ }
    if (LOCWIN.id) locWinDraw();
    if (SEC === "database" && SUB === "pickdrop") render();
  }).catch(function () { /* offline, or the SQL is not run yet: try again next time */ })
    .then(function () { DINBOX.busy = false; });
}
setTimeout(inboxLoad, 2500);
setInterval(function () { if (!document.hidden) inboxLoad(); }, 30000);
document.addEventListener("visibilitychange", function () { if (!document.hidden) inboxLoad(); });

function locRow(id) { return (DB && DB.locations || []).filter(function (l) { return l.id === id; })[0] || null; }
function locNow(l, k) {
  if (!l) return "";
  return k === "phone" ? l.phone : k === "dock_hours" ? l.appointment_note : k === "appointment" ? (l.custom || {}).c_appointment : "";
}
function lfIsDoc(f) { return f.kind === "document" || /pdf$/i.test(f.mime || f.mime_type || "") || /\.pdf$/i.test(f.name || f.file_name || ""); }
// A photo or file: a thumbnail (the picture once its link is fetched) that opens in the document viewer.
function lfThumbHtml(f, extra) {
  var path = f.path || f.storage_path, name = f.name || f.file_name || "File";
  return '<span class="lf-thumb' + (lfIsDoc(f) ? " doc" : "") + '"><button type="button" class="lf-open" data-lfview="' + esc(path) + '" data-lfname="' + esc(name) + '" title="' + esc(name) + '">' +
    (lfIsDoc(f) ? icon("pdf") + "<span>" + esc(name) + "</span>" : '<img alt="" data-lfpath="' + esc(path) + '">') + "</button>" + (extra || "") + "</span>";
}
function lfFill(root) {
  [].forEach.call((root || document).querySelectorAll("img[data-lfpath]:not([src])"), function (img) {
    var p = img.getAttribute("data-lfpath"), c = LFURL[p];
    if (c && Date.now() - c.at < 240000) { img.src = c.url; return; }
    api("location-file/url", { path: p }).then(function (r) { LFURL[p] = { url: r.url, at: Date.now() }; img.src = r.url; }, function () { /* leave it blank */ });
  });
}

/* ── Cards ── */
function chgCardHtml(q, inPanel) {
  var l = locRow(q.location_id), ch = q.changes || {};
  var rows = CHG_FIELDS.filter(function (f) { return ch[f[0]] !== undefined; }).map(function (f) {
    var now = locNow(l, f[0]);
    return '<tr><td><input type="checkbox" checked data-chgtake="' + f[0] + '" aria-label="Keep ' + f[1] + '"></td><td>' + f[1] + "</td>" +
      '<td class="old">' + (f[0] === "note" ? "" : (now ? esc(now) : "<i>blank</i>")) + '</td><td class="new">' + (ch[f[0]] ? esc(ch[f[0]]) : "<i>blank</i>") + "</td></tr>";
  }).join("");
  var files = (q.files || []).map(function (f) {
    return lfThumbHtml(f, '<input type="checkbox" checked class="lf-keep" data-chgfile="' + esc(f.path) + '" aria-label="Keep ' + esc(f.name) + '">');
  }).join("");
  return '<div class="ib-card" data-chgcard="' + q.id + '"><div class="ib-hd"><span><b>' + esc(q.driver_name || "A driver") + "</b>" +
    (q.truck ? ' <span class="trk">' + esc(q.truck) + "</span>" : "") + " wants to change <b>" + esc(l ? l.name : "a location") + '</b></span><span class="ib-when">' + esc(seenWhen(Date.parse(q.created_at))) + "</span></div>" +
    (rows ? '<table class="ib-diff">' + rows + "</table>" : "") + (files ? '<div class="lf-grid">' + files + "</div>" : "") +
    '<div class="ib-acts">' + (inPanel && l ? '<button class="btn sm" data-locopen="' + l.id + '">Open Location</button>' : "") +
    '<button class="btn sm" data-chgno="' + q.id + '">Reject</button><button class="btn pri sm" data-chgok="' + q.id + '">Approve</button></div></div>';
}
function upCardHtml(u) {
  var o = u.order_id ? order(u.order_id) : null, n = (u.files || []).length, docs = (u.files || []).filter(lfIsDoc).length;
  var what = docs === n ? (n > 1 ? n + " files" : "a file") : docs ? n + " photos and files" : (n > 1 ? n + " photos" : "a photo");
  return '<div class="ib-card"><div class="ib-hd"><span><b>' + esc(u.driver_name || "A driver") + "</b>" + (u.truck ? ' <span class="trk">' + esc(u.truck) + "</span>" : "") +
    " sent " + what + (o ? " about <b>" + esc(orderNum(o)) + "</b>" : "") + '</span><span class="ib-when">' + esc(seenWhen(Date.parse(u.created_at))) + "</span></div>" +
    (u.note ? '<div class="act-q">' + esc(u.note) + "</div>" : "") +
    '<div class="lf-grid">' + (u.files || []).map(function (f) { return lfThumbHtml(f); }).join("") + "</div>" +
    '<div class="ib-acts"><button class="btn sm" data-upno="' + u.id + '">Dismiss</button><button class="btn sm" data-uploc="' + u.id + '">Save To Pick/Drop…</button>' +
    '<button class="btn pri sm" data-upord="' + u.id + '">Attach To Order…</button></div></div>';
}
// The top of the driver activity panel (seenHtml).
function inboxPopHtml() {
  if (!inboxCount()) return "";
  requestAnimationFrame(function () { lfFill($("#seen-wrap")); });
  return '<div class="ib-hdline">Needs your OK <span class="ib-n">' + inboxCount() + "</span></div>" +
    DINBOX.changes.map(function (q) { return chgCardHtml(q, true); }).join("") + DINBOX.uploads.map(upCardHtml).join("");
}

/* ── Actions ── */
function chgDecide(id, approve, card) {
  var take = [].map.call(card.querySelectorAll("[data-chgtake]:checked"), function (x) { return x.getAttribute("data-chgtake"); });
  var files = [].map.call(card.querySelectorAll("[data-chgfile]:checked"), function (x) { return x.getAttribute("data-chgfile"); });
  if (approve && !take.length && !files.length) { toast("Tick what to keep, or Reject it", true); return; }
  [].forEach.call(card.querySelectorAll("button"), function (b) { b.disabled = true; });
  api("location-change/decide", { id: id, approve: approve, take: take, files: files }).then(function () {
    DINBOX.changes = DINBOX.changes.filter(function (x) { return x.id !== id; }); DINBOX.sig = "";
    LOCWIN.files = null;
    toast(approve ? "Saved to the Pick/Drop List" : "Rejected");
    return reload().then(function () { repaintSeen(); if (LOCWIN.id) locWinLoadFiles(); inboxLoad(); });
  }).catch(function (e) { [].forEach.call(card.querySelectorAll("button"), function (b) { b.disabled = false; }); toast(e.message, true); });
}
function upDone(id, body, msg) {
  return api("driver-upload/done", Object.assign({ id: id }, body)).then(function (r) {
    DINBOX.uploads = DINBOX.uploads.filter(function (x) { return x.id !== id; }); DINBOX.sig = "";
    repaintSeen(); toast(msg || (r && r.note) || "Done");
    inboxLoad();
    if (body.action !== "dismiss") reload();
  });
}
// The number a person would recognise: the order #, else the load #, else the internal freight IF #.
function orderNum(o) { return o.rexius_order_no || o.broker_load_no || o.transfer_no || "(no order #)"; }
function orderLabel(o) { return orderNum(o) + " · " + (o.customer_name || o.broker_name || o.transfer_department_name || o.notes || ""); }
function upAttachModal(u) {
  var list = (DB.orders || []).filter(function (o) { return o.stage !== "cancelled"; }).slice(0, 2000);
  var cur = u.order_id ? order(u.order_id) : null;
  openModal('<div class="modal-hd"><h2>Attach To Order</h2></div><div class="modal-body">' +
    '<label class="mf"><span>Order</span><input id="ib-ord" list="ib-ords" autocomplete="off" placeholder="Order # or customer" value="' + esc(cur ? orderLabel(cur) : "") + '"></label>' +
    '<datalist id="ib-ords">' + list.map(function (o) { return '<option value="' + esc(orderLabel(o)) + '">'; }).join("") + "</datalist>" +
    '<label class="mf"><span>Type</span><select id="ib-type"><option value="pod">POD</option><option value="delivery_receipt">Delivery Receipt</option><option value="other" selected>Other</option></select></label></div>' +
    '<div class="modal-ft"><span style="flex:1"></span><button class="btn" id="modal-cancel">Cancel</button><button class="btn pri" id="ib-attach-go" data-upid="' + u.id + '">Attach</button></div>');
  var inp = $("#ib-ord"); if (inp) inp.focus();
}
function upLocModal(u) {
  openModal('<div class="modal-hd"><h2>Save To Pick/Drop</h2></div><div class="modal-body">' +
    '<label class="mf"><span>Location</span><input id="ib-loc" list="ib-locs" autocomplete="off" placeholder="Search the Pick/Drop List"></label>' +
    '<datalist id="ib-locs">' + (DB.locations || []).map(function (l) { return '<option value="' + esc(l.name + " · " + [l.address, l.city].filter(Boolean).join(", ")) + '">'; }).join("") + "</datalist></div>" +
    '<div class="modal-ft"><span style="flex:1"></span><button class="btn" id="modal-cancel">Cancel</button><button class="btn pri" id="ib-loc-go" data-upid="' + u.id + '">Save</button></div>');
  var inp = $("#ib-loc"); if (inp) inp.focus();
}

/* ── The Pick/Drop location window ── */
function locOpenTh() {
  return '<th class="loc-open-col"><span class="tracker-open-head" role="img" aria-label="Open location" title="Open location">' + icon("orderPanel") + "</span></th>";
}
function locOpenTd(id) {
  var waiting = DINBOX.changes.some(function (q) { return q.location_id === id; });
  return '<td class="loc-open-col"><button class="tracker-open' + (waiting ? " waiting" : "") + '" data-locopen="' + id + '" title="' + (waiting ? "A driver's change is waiting · " : "") +
    'Open location" aria-label="Open location">' + icon("orderPanel") + (waiting ? '<span class="loc-wait-dot"></span>' : "") + "</button></td>";
}
function locWinOpen(id) {
  LOCWIN.id = id; LOCWIN.files = null;
  locWinDraw(); locWinLoadFiles();
}
function locWinLoadFiles() {
  var id = LOCWIN.id; if (!id) return;
  api("location-files", { location_id: id }).then(function (f) { if (LOCWIN.id === id) { LOCWIN.files = f || []; locWinDraw(); } },
    function (e) { if (LOCWIN.id === id) { LOCWIN.files = []; LOCWIN.err = e.message; locWinDraw(); } });
}
function locWinClose() {
  var w = $("#locwin"); if (w) w.classList.remove("on");
  LOCWIN.id = null; LOCWIN.files = null;
  [].forEach.call(document.querySelectorAll("[data-locopen].on"), function (b) { b.classList.remove("on"); });
}
function locWinDraw() {
  var l = locRow(LOCWIN.id), w = $("#locwin");
  if (!w) { w = document.createElement("aside"); w.id = "locwin"; w.className = "locwin"; w.setAttribute("aria-label", "Pick/Drop location"); document.body.appendChild(w); }
  if (!l) { locWinClose(); return; }
  var a = document.activeElement;
  if (a && w.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;      // being typed in: redraw after
  var c = l.custom || {}, files = LOCWIN.files, pend = DINBOX.changes.filter(function (q) { return q.location_id === l.id; });
  var fld = function (label, key, val, kind) {
    var inp = kind === "select" ? '<select data-lwf="' + key + '"><option value=""></option><option' + (val === "Yes" ? " selected" : "") + ">Yes</option><option" + (val === "No" ? " selected" : "") + ">No</option></select>"
      : kind === "area" ? '<textarea data-lwf="' + key + '" rows="3">' + esc(val || "") + "</textarea>" : '<input data-lwf="' + key + '" value="' + esc(val || "") + '">';
    return '<label class="lw-f"><span>' + label + "</span>" + inp + "</label>";
  };
  w.innerHTML = '<div class="lw-top"><b>Pick/Drop Location</b><span style="flex:1"></span><button class="btn sm" data-lwclose>Close</button></div>' +
    '<div class="lw-body"><div class="lw-hd"><h3>' + esc(l.name) + "</h3><p>" + esc([l.address, [l.city, l.state].filter(Boolean).join(" ")].filter(Boolean).join(", ")) + "</p></div>" +
    (pend.length ? '<div class="lw-sec">' + pend.map(function (q) { return chgCardHtml(q, false); }).join("") + "</div>" : "") +
    '<div class="lw-sec">' + fld("Phone", "phone", l.phone) + fld("Dock Hours", "appointment_note", l.appointment_note) +
    fld("Appointment", "c_appointment", c.c_appointment, "select") + fld("Notes", "notes", l.notes, "area") + "</div>" +
    '<div class="lw-sec"><div class="lw-sh"><span class="lbl">Photos and documents' + (files ? " (" + files.length + ")" : "") + "</span></div>" +
    (files === null ? '<div class="lw-muted">Loading…</div>' : files.length ? '<div class="lf-grid">' + files.map(function (f) {
      return lfThumbHtml(f, '<button type="button" class="lf-del" data-lfdel="' + f.id + '" title="Delete" aria-label="Delete ' + esc(f.file_name || "") + '">×</button>');
    }).join("") + "</div>" : '<div class="lw-muted">None yet. Drivers see what you add here.</div>') +
    '<label class="lw-add">+ Upload Photos Or Documents<input type="file" multiple accept="image/*,application/pdf" data-lwup hidden></label></div></div>';
  w.classList.add("on");
  [].forEach.call(document.querySelectorAll("[data-locopen]"), function (b) { b.classList.toggle("on", b.getAttribute("data-locopen") === l.id); });
  lfFill(w);
}

/* ── Events ── */
document.addEventListener("click", function (e) {
  var t = e.target.closest("[data-chgok],[data-chgno],[data-lfview],[data-upno],[data-uploc],[data-upord],[data-locopen],[data-lwclose],[data-lfdel],#ib-attach-go,#ib-loc-go");
  if (!t) return;
  if (t.hasAttribute("data-lfview")) { e.preventDefault(); openViewer("location-file:" + t.getAttribute("data-lfview"), t.getAttribute("data-lfname")); return; }
  if (t.hasAttribute("data-chgok") || t.hasAttribute("data-chgno")) {
    var cid = t.getAttribute("data-chgok") || t.getAttribute("data-chgno");
    chgDecide(cid, t.hasAttribute("data-chgok"), t.closest("[data-chgcard]")); return;
  }
  var uid = t.getAttribute("data-upno") || t.getAttribute("data-uploc") || t.getAttribute("data-upord") || t.getAttribute("data-upid");
  var up = uid && DINBOX.uploads.filter(function (x) { return x.id === uid; })[0];
  if (t.hasAttribute("data-upno") && up) { upDone(up.id, { action: "dismiss" }, "Dismissed").catch(function (er) { toast(er.message, true); }); return; }
  if (t.hasAttribute("data-uploc") && up) { upLocModal(up); return; }
  if (t.hasAttribute("data-upord") && up) { upAttachModal(up); return; }
  if (t.id === "ib-attach-go" && up) {
    var lab = ($("#ib-ord") || {}).value || "", o = (DB.orders || []).filter(function (x) { return orderLabel(x) === lab || x.rexius_order_no === lab.trim() || x.broker_load_no === lab.trim(); })[0];
    if (!o) { toast("Pick an order from the list", true); return; }
    t.disabled = true;
    upDone(up.id, { action: "attach", order_id: o.id, doc_type: $("#ib-type").value }).then(closeModal, function (er) { t.disabled = false; toast(er.message, true); });
    return;
  }
  if (t.id === "ib-loc-go" && up) {
    var lv = ($("#ib-loc") || {}).value || "", loc = (DB.locations || []).filter(function (x) { return lv === x.name + " · " + [x.address, x.city].filter(Boolean).join(", ") || lv.trim() === x.name; })[0];
    if (!loc) { toast("Pick a location from the list", true); return; }
    t.disabled = true;
    upDone(up.id, { action: "location", location_id: loc.id }).then(function () { closeModal(); if (LOCWIN.id === loc.id) locWinLoadFiles(); }, function (er) { t.disabled = false; toast(er.message, true); });
    return;
  }
  if (t.hasAttribute("data-locopen")) {
    var lid = t.getAttribute("data-locopen");
    if (!(SEC === "database" && SUB === "pickdrop")) { SEC = "database"; SUB = "pickdrop"; SEL = null; ACT_OPEN = false; render(); }
    locWinOpen(lid);
    requestAnimationFrame(function () { var b = document.querySelector('[data-locopen="' + lid + '"]'); if (b && b.closest("tr")) b.closest("tr").scrollIntoView({ block: "center" }); });
    return;
  }
  if (t.hasAttribute("data-lwclose")) { locWinClose(); return; }
  if (t.hasAttribute("data-lfdel")) {
    var fid = t.getAttribute("data-lfdel"), f = (LOCWIN.files || []).filter(function (x) { return x.id === fid; })[0];
    if (!f) return;
    confirmModal("Delete " + (f.file_name || "this file") + " from " + ((locRow(LOCWIN.id) || {}).name || "this location") + "? Drivers won't see it any more. This can't be undone.", function () {
      closeModal();
      api("location-file/delete", { id: f.id, path: f.storage_path }).then(function () { toast("Deleted"); locWinLoadFiles(); }, function (er) { toast(er.message, true); });
    }, "Delete File");
  }
});
// Fields in the location window save when you leave them, through the same saves as the grid (so History and undo see them).
document.addEventListener("change", function (e) {
  var f = e.target.closest && e.target.closest("#locwin [data-lwf]");
  if (f && LOCWIN.id) {
    var key = f.getAttribute("data-lwf"), id = LOCWIN.id, v = f.value.trim();
    var p = key === "c_appointment" ? customValueSet("locations", id, "c_appointment", v) : gridCellSet("locations", id, key, v).then(function () { render(); });
    p.then(function () { toast("Saved"); }, function (er) { toast(er.message, true); });
    return;
  }
  var up = e.target.closest && e.target.closest("#locwin [data-lwup]");
  if (up && LOCWIN.id) {
    var id2 = LOCWIN.id, list = [].slice.call(up.files || []);
    if (!list.length) return;
    toast("Uploading " + list.length + (list.length > 1 ? " files…" : " file…"));
    list.reduce(function (chain, file) {
      return chain.then(function () { return api("location-file/add", { location_id: id2, blob: file, name: file.name, by: (LOCAL_AUTH.user && LOCAL_AUTH.user.username) || "Office" }); });
    }, Promise.resolve()).then(function () { toast("Uploaded. Drivers see it on this location."); if (LOCWIN.id === id2) locWinLoadFiles(); },
      function (er) { toast(er.message, true); if (LOCWIN.id === id2) locWinLoadFiles(); });
  }
});
document.addEventListener("keydown", function (e) {
  if (e.key !== "Escape" || !LOCWIN.id) return;
  if (document.querySelector("#modal.on,#viewer.on,#ctxmenu")) return;
  var a = document.activeElement; if (a && a.closest && a.closest("#locwin") && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { a.blur(); return; }
  locWinClose();
});

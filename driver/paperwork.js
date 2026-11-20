/* Flatbed Schedule — paperwork viewer and signature.
 *
 *   Dept12Paper.open({ title, getBytes() -> Promise<ArrayBuffer>, onDone(pdfBlob, pageCount) -> Promise,
 *                      saveKey, notesHeader })
 *
 * A PDF the office marked "Show To Driver" opens full screen. Sign turns the pen on: draw with a finger
 * or pencil on any page. Send Signed Copy stamps the drawing onto the PDF (vendor/pdf-lib) and hands the
 * new PDF to onDone, which uploads it the same way a scan goes. Nothing is changed on the original file.
 * pdf.js (to draw the pages) and pdf-lib (to stamp them) are not loaded with the page: they load when a
 * paper is first opened.
 *
 * Notes: typed notes go on a page added at the end of the copy (headed with notesHeader: driver, truck, order, time).
 * saveKey: after a copy is sent, the drawing and the notes are kept on this device under that key, so opening the same
 * paper again shows them; the driver can change them and send a new copy.
 */
(function () {
"use strict";

var BASE = new URL("../vendor/", document.currentScript.src).href;
var LOADING = {};
function loadScript(name) {
  if (LOADING[name]) return LOADING[name];
  return (LOADING[name] = new Promise(function (res, rej) {
    var s = document.createElement("script");
    s.src = BASE + name;
    s.onload = function () { res(); };
    s.onerror = function () { delete LOADING[name]; s.remove(); rej(new Error("Couldn't load " + name)); };
    document.head.appendChild(s);
  }));
}
function loadPdfJs() {
  return loadScript("pdf.min.js").then(function () {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = BASE + "pdf.worker.min.js";
  });
}
function loadPdfLib() { return window.PDFLib ? Promise.resolve() : loadScript("pdf-lib.min.js"); }

var INK = "#0b1d5c";
var PEN = 0.003;          // pen width as a fraction of the page's width, so the drawing is the same size on the screen and in the PDF
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

/* A point on the page as it is shown (u across, v down, both 0 to 1) → a point in the PDF's own space,
   for a page turned 0, 90, 180 or 270 degrees and a crop box that may not start at 0,0. */
function toPdf(u, v, box, rot) {
  var w = box.width, h = box.height, x, y;
  if (rot === 90) { x = v * w; y = u * h; }
  else if (rot === 180) { x = (1 - u) * w; y = v * h; }
  else if (rot === 270) { x = (1 - v) * w; y = (1 - u) * h; }
  else { x = u * w; y = (1 - v) * h; }
  return { x: box.x + x, y: box.y + y };
}

function open(opts) {
  if (document.querySelector(".paper")) return;
  var el = document.createElement("div");
  el.className = "paper"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Paperwork");
  el.innerHTML =
    '<div class="paper-top"><button class="btn" data-pp="close" type="button">Close</button>' +
    '<div class="paper-title"><b>' + esc(opts.title || "Paperwork") + '</b><span data-pp="status">Loading…</span></div>' +
    '<div class="paper-tools"><a class="btn" data-pp="raw" target="_blank" rel="noopener" hidden>Open File</a><button class="btn" data-pp="sign" type="button" aria-pressed="false" disabled>Sign</button>' +
    '<button class="btn" data-pp="undo" type="button" disabled>Undo</button>' +
    '<button class="btn" data-pp="clear" type="button" disabled>Clear</button>' +
    '<button class="btn" data-pp="notes" type="button" disabled>Notes</button>' +
    '<button class="btn pri" data-pp="send" type="button" disabled>Send Signed Copy</button></div></div>' +
    '<div class="paper-body" data-pp="body"></div>';
  document.body.appendChild(el);
  document.body.style.overflow = "hidden";

  var $ = function (sel) { return el.querySelector(sel); };
  var statusEl = $('[data-pp="status"]'), body = $('[data-pp="body"]');
  var bSign = $('[data-pp="sign"]'), bUndo = $('[data-pp="undo"]'), bClear = $('[data-pp="clear"]'), bSend = $('[data-pp="send"]');
  var pages = [], hist = [], bytes = null, busy = false, pen = false, dead = false, notesEl = null;
  var saved = null;
  try { saved = opts.saveKey ? JSON.parse(localStorage.getItem(opts.saveKey) || "null") : null; } catch (e) { saved = null; }
  if (opts.readOnly) {      // a scan: view only, no pen
    ["sign", "undo", "clear", "notes", "send"].forEach(function (k) { $('[data-pp="' + k + '"]').hidden = true; });
  }
  if (saved) bSend.textContent = "Send New Copy";

  function say(t) { statusEl.textContent = t; }
  function strokeCount() { return hist.length; }
  function drawn() { return pages.some(function (pg) { return pg.strokes.length; }); }
  function notesText() { return notesEl ? notesEl.value.trim() : ""; }
  function changed() { return drawn() || !!notesText(); }
  function sync() {
    bUndo.disabled = bClear.disabled = busy || !strokeCount();
    bSend.disabled = busy || !changed();
    bSign.disabled = busy || !pages.length;
    $('[data-pp="notes"]').disabled = busy || !pages.length;
    if (opts.readOnly) { say(pages.length ? pages.length + " page" + (pages.length > 1 ? "s" : "") : ""); return; }
    bSign.classList.toggle("active", pen); bSign.setAttribute("aria-pressed", String(pen));
    body.classList.toggle("pen", pen);
    say(busy ? "Working…" : pen ? "Sign is on: draw with a finger or pencil. Turn Sign off to scroll." :
      saved && saved.at ? "You sent a copy " + saved.at + ". Change it and send again; the office gets the new copy." :
      changed() ? "Ready. Send Signed Copy when you are done." : pages.length ? pages.length + " page" + (pages.length > 1 ? "s" : "") + ". Sign to draw on it, Notes to type notes onto a last page." : "");
  }
  function paint(pg) {
    var c = pg.over, ctx = c.getContext("2d"), cw = c.width, ch = c.height;
    ctx.clearRect(0, 0, cw, ch);
    ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1.6 * pg.dpr, PEN * cw);
    pg.strokes.forEach(function (st) {
      if (st.length === 1) { ctx.beginPath(); ctx.arc(st[0].u * cw, st[0].v * ch, ctx.lineWidth / 2, 0, 6.2832); ctx.fill(); return; }
      ctx.beginPath(); ctx.moveTo(st[0].u * cw, st[0].v * ch);
      for (var i = 1; i < st.length; i++) ctx.lineTo(st[i].u * cw, st[i].v * ch);
      ctx.stroke();
    });
  }
  function bindPen(pg) {
    var cur = null;
    var pt = function (e) {
      var r = pg.over.getBoundingClientRect();
      return { u: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), v: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
    };
    pg.over.addEventListener("pointerdown", function (e) {
      if (!pen || busy) return;
      e.preventDefault(); pg.over.setPointerCapture(e.pointerId);
      cur = [pt(e)]; pg.strokes.push(cur); hist.push(pg); paint(pg); sync();
    });
    pg.over.addEventListener("pointermove", function (e) {
      if (!cur) return;
      e.preventDefault(); cur.push(pt(e)); paint(pg);
    });
    var end = function () { cur = null; };
    pg.over.addEventListener("pointerup", end); pg.over.addEventListener("pointercancel", end);
  }

  function render(doc) {
    var width = Math.min(960, Math.max(280, body.clientWidth - 24)), dpr = Math.min(2, window.devicePixelRatio || 1);
    var chain = Promise.resolve();
    for (var n = 1; n <= doc.numPages; n++) (function (n) {
      chain = chain.then(function () { return doc.getPage(n); }).then(function (page) {
        if (dead) return;
        var base = page.getViewport({ scale: 1 }), scale = width / base.width, vp = page.getViewport({ scale: scale * dpr });
        var wrap = document.createElement("div"); wrap.className = "paper-page"; wrap.style.width = width + "px"; wrap.style.height = Math.round(vp.height / dpr) + "px";
        var cv = document.createElement("canvas"), over = document.createElement("canvas");
        cv.width = over.width = Math.round(vp.width); cv.height = over.height = Math.round(vp.height);
        cv.style.width = over.style.width = "100%"; cv.style.height = over.style.height = "100%";
        over.className = "paper-over"; over.setAttribute("aria-label", "Signature layer for page " + n);
        wrap.appendChild(cv); wrap.appendChild(over); body.appendChild(wrap);
        var pg = { over: over, strokes: [], dpr: dpr, index: n - 1 }; pages.push(pg); bindPen(pg);
        return page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
      });
    })(n);
    return chain.then(function () {
      if (dead || opts.readOnly) return;
      // The typed notes: a card after the last page, sent as the copy's last page.
      var card = document.createElement("div"); card.className = "paper-notes"; card.style.width = width + "px";
      card.innerHTML = '<div class="paper-notes-hd"><b>Notes</b><span>Typed notes are added as the last page of the copy you send.</span></div>' +
        '<textarea data-pp-notes rows="6" placeholder="e.g. 2 pallets damaged on the left side. Receiver Jim signed."></textarea>';
      body.appendChild(card); notesEl = card.querySelector("textarea");
      notesEl.addEventListener("input", sync);
      // What was sent last time (this device): the drawing on each page and the notes.
      if (saved) {
        (saved.strokes || []).forEach(function (list, i) { var pg = pages[i]; if (!pg || !list) return; pg.strokes = list; list.forEach(function () { hist.push(pg); }); paint(pg); });
        notesEl.value = saved.notes || "";
      }
    });
  }

  // Text broken into lines that fit maxW at the given size (a word longer than a line is cut).
  function wrap(text, font, size, maxW) {
    var out = [];
    String(text).split(/\r?\n/).forEach(function (para) {
      var line = "";
      para.split(/\s+/).forEach(function (w) {
        if (!w) return;
        while (font.widthOfTextAtSize(w, size) > maxW) {
          var n = w.length; while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > maxW) n--;
          if (line) { out.push(line); line = ""; }
          out.push(w.slice(0, n)); w = w.slice(n);
        }
        var t = line ? line + " " + w : w;
        if (font.widthOfTextAtSize(t, size) > maxW) { out.push(line); line = w; } else line = t;
      });
      out.push(line);
    });
    return out;
  }
  // The notes as page(s) at the end of the copy, the same size as the paper's last page.
  function addNotes(doc) {
    var text = notesText(); if (!text) return Promise.resolve();
    var L = window.PDFLib;
    return Promise.all([doc.embedFont(L.StandardFonts.Helvetica), doc.embedFont(L.StandardFonts.HelveticaBold)]).then(function (f) {
      var last = doc.getPages()[doc.getPageCount() - 1], sz = last ? last.getSize() : { width: 612, height: 792 };
      var W = Math.min(sz.width, sz.height) === sz.width ? sz.width : 612, H = W === sz.width ? sz.height : 792;
      var m = 54, size = 12, lh = 17, maxW = W - 2 * m;
      // Helvetica only has Latin characters; anything else is dropped rather than failing the whole copy.
      var clean = function (s) { return String(s).replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF\n]/g, ""); };
      var lines = wrap(clean(text), f[0], size, maxW), page = null, y = 0;
      var newPage = function () {
        page = doc.addPage([W, H]); y = H - m;
        page.drawText(clean(opts.notesHeader || "Driver notes"), { x: m, y: y, size: 10, font: f[1] });
        y -= 8; page.drawLine({ start: { x: m, y: y }, end: { x: W - m, y: y }, thickness: 1 }); y -= 20;
      };
      newPage();
      lines.forEach(function (ln) { if (y < m) newPage(); if (ln) page.drawText(ln, { x: m, y: y, size: size, font: f[0] }); y -= lh; });
    });
  }

  // Stamp the drawing onto a copy of the PDF.
  function build() {
    return loadPdfLib().then(function () { return window.PDFLib.PDFDocument.load(bytes.slice(0)); }).then(function (doc) {
      var list = doc.getPages(), ink = window.PDFLib.rgb(0.043, 0.114, 0.361);
      pages.forEach(function (pg) {
        if (!pg.strokes.length) return;
        var page = list[pg.index]; if (!page) return;
        var box = page.getCropBox(), rot = ((page.getRotation().angle % 360) + 360) % 360;
        var shown = (rot === 90 || rot === 270) ? box.height : box.width, t = Math.max(0.8, PEN * shown);
        pg.strokes.forEach(function (st) {
          var a = toPdf(st[0].u, st[0].v, box, rot);
          if (st.length === 1) { page.drawCircle({ x: a.x, y: a.y, size: t / 2, color: ink, borderWidth: 0 }); return; }
          for (var i = 1; i < st.length; i++) {
            var b = toPdf(st[i].u, st[i].v, box, rot);
            page.drawLine({ start: a, end: b, thickness: t, color: ink, lineCap: window.PDFLib.LineCapStyle.Round });
            a = b;
          }
        });
      });
      return addNotes(doc).then(function () { return doc.save(); }).then(function (out) { return { blob: new Blob([out], { type: "application/pdf" }), pages: doc.getPageCount() }; });
    });
  }

  function close() {
    if (changed() && !saved && !busy && !window.confirm("Close without sending your signature and notes?")) return;
    dead = true; el.remove(); document.body.style.overflow = "";
  }
  el.addEventListener("click", function (e) {
    var b = e.target.closest("[data-pp]"); if (!b || b.disabled) return;
    var k = b.getAttribute("data-pp");
    if (k === "close") close();
    else if (k === "sign") { pen = !pen; sync(); }
    else if (k === "undo") { var pg = hist.pop(); if (pg) { pg.strokes.pop(); paint(pg); } sync(); }
    else if (k === "clear") { pages.forEach(function (pg) { pg.strokes = []; paint(pg); }); hist = []; sync(); }
    else if (k === "notes") { pen = false; sync(); if (notesEl) { notesEl.scrollIntoView({ block: "center", behavior: "smooth" }); notesEl.focus(); } }
    else if (k === "send") {
      busy = true; pen = false; sync();
      build().then(function (r) { return opts.onDone(r.blob, r.pages); }).then(function () {
        if (opts.saveKey) {
          var d = new Date(), at = (d.getMonth() + 1) + "/" + d.getDate() + " " + ((d.getHours() % 12) || 12) + ":" + String(d.getMinutes()).padStart(2, "0") + (d.getHours() < 12 ? " AM" : " PM");
          try { localStorage.setItem(opts.saveKey, JSON.stringify({ at: at, notes: notesText(), strokes: pages.map(function (pg) { return pg.strokes; }) })); } catch (e) { /* no storage: nothing kept */ }
        }
        dead = true; el.remove(); document.body.style.overflow = "";
      }, function (err) { busy = false; sync(); say("Couldn't send it: " + ((err && err.message) || "try again") + "."); });
    }
  });

  // If the file downloaded but the drawing view can't start, the plain file still opens in the phone's own viewer.
  function plain() {
    if (!bytes || dead) return;
    var raw = $('[data-pp="raw"]');
    raw.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })); raw.hidden = false;
  }
  opts.getBytes().then(function (b) {
    bytes = b;
    return loadPdfJs().then(function () { return window.pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise; });
  }).then(render).then(function () { if (!dead) sync(); }, function (err) {
    plain();
    if (!dead) say("Couldn't open it: " + ((err && err.message) || "try again") + ".");
  });
}

window.Dept12Paper = { open: open, toPdf: toPdf };
})();

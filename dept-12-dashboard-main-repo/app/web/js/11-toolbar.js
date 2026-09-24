/* ── Formatting toolbar (D67) — a Sheets-style bar under the header, global but
   its color/text controls act on the Scheduler / Current Week selection. ───── */
/* The exact Google Sheets standard palette (same hex values Nate uses there). */
var SHEETS_COLORS = [
  ["#000000","#434343","#666666","#999999","#b7b7b7","#cccccc","#d9d9d9","#efefef","#f3f3f3","#ffffff"],
  ["#980000","#ff0000","#ff9900","#ffff00","#00ff00","#00ffff","#4a86e8","#0000ff","#9900ff","#ff00ff"],
  ["#e6b8af","#f4cccc","#fce5cd","#fff2cc","#d9ead3","#d0e0e3","#c9daf8","#cfe2f3","#d9d2e9","#ead1dc"],
  ["#dd7e6b","#ea9999","#f9cb9c","#ffe599","#b6d7a8","#a2c4c9","#a4c2f4","#9fc5e8","#b4a7d6","#d5a6bd"],
  ["#cc4125","#e06666","#f6b26b","#ffd966","#93c47d","#76a5af","#6d9eeb","#6fa8dc","#8e7cc3","#c27ba0"],
  ["#a61c00","#cc0000","#e69138","#f1c232","#6aa84f","#45818e","#3c78d8","#3d85c6","#674ea7","#a64d79"],
  ["#85200c","#990000","#b45f06","#bf9000","#38761d","#134f5c","#1155cc","#0b5394","#351c75","#741b47"],
  ["#5b0f00","#660000","#783f04","#7f6000","#274e13","#0c343d","#1c4587","#073763","#20124d","#4c1130"]
];
/* Sheets color picker popover: standard grid + custom hex + "no fill". */
function openSheetsPicker(x, y, onPick, initialColor, showOpacity) {
  closePalette();
  var base = colorBase(initialColor || "#ffffff"), opacity = colorOpacity(initialColor || "#ffffff");
  var el = document.createElement("div"); el.id = "palette"; el.className = "swpick";
  var grid = SHEETS_COLORS.map(function (row) {
    return '<div class="sw-row">' + row.map(function (c) {
      return '<button class="sw-cell" data-hex="' + c + '" title="' + c + '" style="background:' + c + '"></button>';
    }).join("") + "</div>";
  }).join("");
  el.innerHTML =
    '<button class="sw-none" data-hex="">&#8856; No fill</button>' +
    '<div class="sw-grid">' + grid + "</div>" +
    '<div class="sw-custom"><input type="color" id="sw-hex" value="' + base + '">' +
    '<input type="text" id="sw-hex-text" class="hex-text" value="' + base + '" maxlength="7" placeholder="#rrggbb" spellcheck="false"><span>Custom</span>' +
    (showOpacity ? '<label class="sw-opacity">Opacity <input type="range" id="sw-opacity" min="10" max="100" value="' + opacity + '"><output id="sw-opacity-value">' + opacity + '%</output></label>' : "") +
    '<button class="btn sm" id="sw-apply">Apply</button></div>';
  document.body.appendChild(el);
  var r = el.getBoundingClientRect();
  el.style.left = Math.min(x, window.innerWidth - r.width - 8) + "px";
  el.style.top = Math.min(y, window.innerHeight - r.height - 8) + "px";
  el.addEventListener("click", function (e) {
    if (e.target.id === "sw-apply") { onPick(colorWithOpacity(hexInputValue($("#sw-hex-text"), $("#sw-hex")), showOpacity ? $("#sw-opacity").value : 100)); closePalette(); return; }
    var b = e.target.closest("[data-hex]"); if (!b) return;
    var picked = b.getAttribute("data-hex");
    onPick(picked ? colorWithOpacity(picked, showOpacity ? $("#sw-opacity").value : 100) : ""); closePalette();
  });
  el.addEventListener("input", function (e) {
    if (e.target.id === "sw-opacity") $("#sw-opacity-value").value = e.target.value + "%";
    else if (e.target.id === "sw-hex") $("#sw-hex-text").value = e.target.value;
    else if (e.target.id === "sw-hex-text") { var hx = normalizeHex(e.target.value); if (hx) $("#sw-hex").value = hx; }
  });
  PALETTE_ON = true;
}
/* A 3- or 6-digit #hex, with or without the leading #, normalized to
   "#rrggbb" for <input type=color> — null if what's typed isn't a hex color
   yet (mid-edit), so callers can leave the swatch alone until it is one. */
function normalizeHex(v) {
  var s = (v || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(s)) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  return /^[0-9a-fA-F]{6}$/.test(s) ? "#" + s.toLowerCase() : null;
}
/* The color to actually apply from a swatch+text pair: whatever's typed if
   it's valid hex, else the native color input's own (always-valid) value —
   covers a stray edit left mid-typo when Apply is clicked. */
function hexInputValue(textEl, colorEl) {
  return (textEl && normalizeHex(textEl.value)) || (colorEl ? colorEl.value : "#888888");
}

/* A format target is a scheduler/Current-Week cell OR a sheet cell (D75). Read
   from the marquee selection (SELSET elements) else the single selected cell. */
/* Map each selected element to a format target (keeping the element, so border
   ops can read on-screen grid positions). */
function targetEls() {
  var els = (typeof SELSET !== "undefined" && SELSET.length) ? SELSET : (SEL ? [SEL] : []);
  var out = [];
  els.forEach(function (td) {
    var t = null;
    if (td.dataset && td.dataset.sheet) t = { kind: "sheet", sid: td.dataset.sheet, r: +td.dataset.r, c: +td.dataset.c };
    else if (td.dataset && td.dataset.field && td.dataset.table && td.dataset.table !== "sheet" && td.dataset.id)
      t = { kind: "grid", table: td.dataset.table, id: td.dataset.id, field: td.dataset.field };
    else if (td.dataset && td.dataset.key && !td.dataset.field && td.dataset.key.split("|").length === 3) t = { kind: "sched", key: td.dataset.key };
    if (t) out.push({ el: td, t: t });
  });
  return out;
}
function fmtTargets() { return targetEls().map(function (p) { return p.t; }); }
/* The live DOM node for a target descriptor — used to re-resolve a stale SELSET
   element (detached by a re-render) before border ops read its on-screen rect,
   so positional borders don't collapse onto row 0/col 0 (D82). */
function liveTargetEl(t) {
  if (t.kind === "sheet") return document.querySelector('td[data-sheet="' + t.sid + '"][data-r="' + t.r + '"][data-c="' + t.c + '"]');
  if (t.kind === "grid") return document.querySelector('td[data-table="' + t.table + '"][data-id="' + t.id + '"][data-field="' + CSS.escape(t.field) + '"]');
  var sel = 'td[data-key="' + CSS.escape(t.key) + '"]';
  return document.querySelector(sel) || (typeof schedNode !== "undefined" && schedNode && schedNode.querySelector(sel)) || null;
}
function fmtCurrentOf(t) {
  if (t.kind === "sheet") { var sc = (SHEETCELLS[t.sid] || {})[t.r + "|" + t.c]; return (sc && sc.fmt) || {}; }
  if (t.kind === "grid") return gridFmtOf(t.table, t.id, t.field);
  var cv = CELLS[t.key]; return (cv && cv.fmt) || {};
}
/* Toolbar choices are useful before a cell is selected too.  Keep the chosen
   format as a small "next selection" preset, then consume it as soon as the
   user selects a cell.  This makes the bar behave like a spreadsheet toolbar
   instead of making a color picker fail after the user has already chosen one. */
var PENDING_FMT = {};
var PENDING_BORDER = null;
var PENDING_CLEAR = false;
function firstFmt() { var t = fmtTargets(); return t.length ? fmtCurrentOf(t[0]) : PENDING_FMT; }
function queueFormat(patch, label) {
  PENDING_FMT = mergeFmt(PENDING_FMT, patch, false);
  PENDING_CLEAR = false;
  renderFmtBar();
  toast((label || "Format") + " ready — select cell(s) to apply");
}
function applyPendingFormat() {
  if (!fmtTargets().length || (!Object.keys(PENDING_FMT).length && !PENDING_BORDER && !PENDING_CLEAR)) return;
  var patch = PENDING_FMT, border = PENDING_BORDER, clear = PENDING_CLEAR;
  PENDING_FMT = {}; PENDING_BORDER = null; PENDING_CLEAR = false;
  if (clear) clearFormatting();
  if (Object.keys(patch).length) applyFormat(patch, "format");
  if (border) applyBorder(border);
}
function mergeFmt(base, patch, replace) {
  var out = replace ? {} : JSON.parse(JSON.stringify(base || {}));
  for (var k in patch) { if (patch[k] == null || patch[k] === "") delete out[k]; else out[k] = patch[k]; }
  return out;
}
/* Apply a fmt patch (or full replace, for undo) to one target; update the local
   model + repaint in place. */
function fmtApply(t, patch, replace) {
  if (t.kind === "sheet") {
    return api("sheet/cell", { sheet_id: t.sid, r: t.r, c: t.c, fmt: patch, replace: !!replace }).then(function () {
      var m = SHEETCELLS[t.sid] = SHEETCELLS[t.sid] || {};
      var sc = m[t.r + "|" + t.c] = m[t.r + "|" + t.c] || { value: null, fmt: {} };
      sc.fmt = mergeFmt(sc.fmt, patch, replace);
      if ((sc.value == null || sc.value === "") && Object.keys(sc.fmt).length === 0) delete m[t.r + "|" + t.c];
      repaintSheetCell(t.sid, t.r, t.c);
    });
  }
  if (t.kind === "grid") {
    return api("grid/cell-fmt", { table: t.table, id: t.id, field: t.field, fmt: patch, replace: !!replace }).then(function () {
      var k = t.table + "|" + t.id + "|" + t.field, nf = mergeFmt(GRIDFMT[k] || {}, patch, replace);
      if (Object.keys(nf).length === 0) delete GRIDFMT[k]; else GRIDFMT[k] = nf;
      repaintGridCell(t.table, t.id, t.field);
    });
  }
  var p = t.key.split("|");
  return api("cell/format", { truck_id: p[0], date: p[1], slot: +p[2], patch: patch, replace: !!replace }).then(function () {
    var cv = CELLS[t.key]; if (!cv) cv = CELLS[t.key] = { text: "", fmt: {} };
    cv.fmt = mergeFmt(cv.fmt, patch, replace);
    if (!cv.oid && !(cv.text || "").trim() && !cv.catId && Object.keys(cv.fmt).length === 0) delete CELLS[t.key];
    repaintCell(t.key);
  });
}
/* Replace a target's whole fmt (undo path). */
function fmtSetFull(t, fmt) { return fmtApply(t, fmt || {}, true); }
/* Merge a patch into each selected cell's fmt; one undoable step. */
function applyFormat(patch, label) {
  var ts = fmtTargets();
  if (!ts.length) { queueFormat(patch, label); return; }
  var before = ts.map(function (t) { return { t: t, fmt: JSON.parse(JSON.stringify(fmtCurrentOf(t))) }; });
  function apply1(t) { return fmtApply(t, patch, false); }
  Promise.all(ts.map(apply1)).then(function () {
    histPush(label || "format " + ts.length + " cell" + (ts.length > 1 ? "s" : ""),
      function () { return Promise.all(before.map(function (b) { return fmtSetFull(b.t, b.fmt); })); },
      function () { return Promise.all(ts.map(apply1)); });
    renderFmtBar();   // reflect the NEW state — model updates async, so refresh here not synchronously after the call (D82)
  }).catch(function (e) { toast(e.message, true); });
}

/* ── Cell borders (D73; Sheets-parity window D79) — real per-side CSS borders on
   each selected cell, with a color pencil and a line-style/thickness picker.
   Positional ops (outer/inner/horizontal/vertical/edge) resolve against the
   on-screen grid rectangle of the selection. Stored as
   fmt.border { t,b,l,r:hex, s:style, w:px }. */
var BORDER_COLOR = "#000000", BORDER_STYLE = "solid", BORDER_WIDTH = 1;
/* Line-style presets shown in the picker (thickness + dashed/dotted), Sheets-style. */
var BORDER_PRESETS = [
  ["solid", 1, "Thin"], ["solid", 2, "Medium"], ["solid", 3, "Thick"],
  ["dashed", 1, "Dashed"], ["dotted", 1, "Dotted"]];
/* Last-used fill/text color (D78) — Sheets shows a colored bar under the bucket/
   text icons and one click re-applies that color. Persisted per device. */
var LAST_FILL = localStorage.getItem("lastFill") || "#ffff00";
var LAST_TEXT = localStorage.getItem("lastText") || "#000000";
/* Group selected cells into a visual grid by their on-screen top/left, so a
   positional border op knows each cell's row/col and the selection's edges. */
function borderGrid(pairs) {
  pairs.forEach(function (p) { var r = p.el.getBoundingClientRect(); p._t = Math.round(r.top); p._l = Math.round(r.left); });
  function uniq(vals) {
    vals = vals.slice().sort(function (a, b) { return a - b; });
    var u = []; vals.forEach(function (v) { if (!u.length || Math.abs(v - u[u.length - 1]) > 3) u.push(v); }); return u;
  }
  function idx(arr, v) { for (var i = 0; i < arr.length; i++) if (Math.abs(arr[i] - v) <= 3) return i; return 0; }
  var rows = uniq(pairs.map(function (p) { return p._t; })), cols = uniq(pairs.map(function (p) { return p._l; }));
  pairs.forEach(function (p) { p._r = idx(rows, p._t); p._c = idx(cols, p._l); });
  return { rmax: rows.length - 1, cmax: cols.length - 1 };
}
function borderSides(op, p, g) {
  var s = {}, r = p._r, c = p._c;
  if (op === "all") s = { t: 1, b: 1, l: 1, r: 1 };
  else if (op === "outer") { if (r === 0) s.t = 1; if (r === g.rmax) s.b = 1; if (c === 0) s.l = 1; if (c === g.cmax) s.r = 1; }
  else if (op === "inner") { if (r < g.rmax) s.b = 1; if (c < g.cmax) s.r = 1; }
  else if (op === "horiz") { if (r < g.rmax) s.b = 1; }
  else if (op === "vert") { if (c < g.cmax) s.r = 1; }
  else if (op === "left") { if (c === 0) s.l = 1; }
  else if (op === "right") { if (c === g.cmax) s.r = 1; }
  else if (op === "top") { if (r === 0) s.t = 1; }
  else if (op === "bottom") { if (r === g.rmax) s.b = 1; }
  return s;
}
function applyBorder(op) {
  var pairs = targetEls();
  if (!pairs.length) {
    PENDING_BORDER = op;
    PENDING_CLEAR = false;
    renderFmtBar();
    toast("Borders ready — select cell(s) to apply");
    return;
  }
  // Re-point any element detached by a re-render to its live node so borderGrid
  // reads real on-screen positions (D82).
  pairs.forEach(function (p) { if (!p.el.isConnected) { var live = liveTargetEl(p.t); if (live) p.el = live; } });
  var g = borderGrid(pairs);
  var before = pairs.map(function (p) { return { t: p.t, fmt: JSON.parse(JSON.stringify(fmtCurrentOf(p.t))) }; });
  function patchFor(p) {
    if (op === "none") return fmtCurrentOf(p.t).border ? { border: null } : null;
    var cur = fmtCurrentOf(p.t).border ? JSON.parse(JSON.stringify(fmtCurrentOf(p.t).border)) : {};
    var sides = borderSides(op, p, g), added = false;
    ["t", "b", "l", "r"].forEach(function (k) { if (sides[k]) { cur[k] = BORDER_COLOR; added = true; } });
    if (!added) return null;                     // edge op that doesn't touch this cell
    cur.s = BORDER_STYLE; cur.w = BORDER_WIDTH;
    return { border: cur };
  }
  var work = pairs.map(function (p) { return { p: p, patch: patchFor(p) }; }).filter(function (x) { return x.patch; });
  if (!work.length) return;
  function apply1(x) { return fmtApply(x.p.t, x.patch, false); }
  Promise.all(work.map(apply1)).then(function () {
    histPush(op === "none" ? "clear borders" : "borders",
      function () { return Promise.all(before.map(function (b) { return fmtSetFull(b.t, b.fmt); })); },
      function () { return Promise.all(work.map(apply1)); });
  }).catch(function (e) { toast(e.message, true); });
}
/* A horizontal line preview in the given style/width (for the style picker). */
function bordLineSvg(style, w) {
  var dash = style === "dashed" ? ' stroke-dasharray="5 3"' : style === "dotted" ? ' stroke-dasharray="0.5 3.5" stroke-linecap="round"' : "";
  return '<svg width="46" height="12" viewBox="0 0 46 12" aria-hidden="true"><line x1="2" y1="6" x2="44" y2="6" stroke="currentColor" stroke-width="' + w + '"' + dash + "/></svg>";
}
function bordBtn(op, title) { return '<button class="bord-b" data-bord="' + op + '" title="' + title + '">' + bordIcon(op) + "</button>"; }
function openBorderMenu(x, y) {
  closePalette();
  var el = document.createElement("div"); el.id = "palette"; el.className = "bordmenu";
  var row1 = [["all", "All borders"], ["inner", "Inner borders"], ["horiz", "Horizontal inner"], ["vert", "Vertical inner"], ["outer", "Outer border"]];
  var row2 = [["left", "Left border"], ["top", "Top border"], ["right", "Right border"], ["bottom", "Bottom border"], ["none", "Clear borders"]];
  function row(ops) { return ops.map(function (o) { return bordBtn(o[0], o[1]); }).join(""); }
  el.innerHTML =
    '<div class="bord-body">' +
      '<div class="bord-grid">' + row(row1) + row(row2) + "</div>" +
      '<div class="bord-tools">' +
        '<label class="bord-pencil" title="Border color">' + svgIcon("pencil") +
          '<span class="bp-bar" style="background:' + BORDER_COLOR + '"></span>' +
          '<input type="color" id="bord-col" value="' + BORDER_COLOR + '"></label>' +
        '<button class="bord-stybtn" data-bordtool="style" title="Line style">' +
          '<span class="bs-prev">' + bordLineSvg(BORDER_STYLE, BORDER_WIDTH) + "</span>" + svgIcon("expand") + "</button>" +
      "</div>" +
    "</div>" +
    '<div class="bord-stylist" hidden>' + BORDER_PRESETS.map(function (p, i) {
      return '<button class="bord-sty' + (p[0] === BORDER_STYLE && p[1] === BORDER_WIDTH ? " on" : "") +
        '" data-styidx="' + i + '" title="' + p[2] + '">' + bordLineSvg(p[0], p[1]) + "</button>";
    }).join("") + "</div>";
  document.body.appendChild(el);
  var r = el.getBoundingClientRect();
  el.style.left = Math.min(x, window.innerWidth - r.width - 8) + "px";
  el.style.top = Math.min(y, window.innerHeight - r.height - 8) + "px";
  el.addEventListener("input", function (e) {
    if (e.target.id === "bord-col") { BORDER_COLOR = e.target.value; var bar = el.querySelector(".bp-bar"); if (bar) bar.style.background = BORDER_COLOR; }
  });
  el.addEventListener("click", function (e) {
    if (e.target.closest("[data-bordtool=style]")) { var lst = el.querySelector(".bord-stylist"); lst.hidden = !lst.hidden; return; }
    var sty = e.target.closest("[data-styidx]");
    if (sty) {
      var p = BORDER_PRESETS[+sty.dataset.styidx]; BORDER_STYLE = p[0]; BORDER_WIDTH = p[1];
      el.querySelector(".bord-stylist").hidden = true;
      el.querySelector(".bs-prev").innerHTML = bordLineSvg(BORDER_STYLE, BORDER_WIDTH);
      [].forEach.call(el.querySelectorAll(".bord-sty"), function (b) { b.classList.toggle("on", +b.dataset.styidx === +sty.dataset.styidx); });
      return;
    }
    if (e.target.closest(".bord-pencil")) return;   // let the color input open
    var b = e.target.closest("[data-bord]"); if (!b) return;
    applyBorder(b.dataset.bord); closePalette();
  });
  PALETTE_ON = true;
}
/* Clear all hand-applied formatting + color on the selection (Cmd/Ctrl-\). Leaves
   designation-driven colors alone (those aren't fmt). */
function clearFormatting() {
  var ts = fmtTargets();
  if (!ts.length) {
    PENDING_FMT = {}; PENDING_BORDER = null; PENDING_CLEAR = true;
    toast("Clear formatting ready — select cell(s) to apply");
    return;
  }
  var before = ts.map(function (t) { return { t: t, fmt: JSON.parse(JSON.stringify(fmtCurrentOf(t))) }; });
  if (before.every(function (b) { return Object.keys(b.fmt).length === 0; })) return;   // nothing to clear
  function clearOne(t) { return fmtSetFull(t, {}); }
  Promise.all(ts.map(clearOne)).then(function () {
    histPush("clear formatting",
      function () { return Promise.all(before.map(function (b) { return fmtSetFull(b.t, b.fmt); })); },
      function () { return Promise.all(ts.map(clearOne)); });
  }).catch(function (e) { toast(e.message, true); });
}
document.addEventListener("keydown", function (e) {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "\\" || e.code === "Backslash")) {
    if (EDITING || !fmtCanFormat()) return;
    e.preventDefault(); clearFormatting();
  }
});
/* Standard rich-text shortcuts.  When no cell is selected they arm the same
   next-selection preset as the toolbar buttons; while editing, native text
   editing retains control of Cmd/Ctrl-B and Cmd/Ctrl-I. */
document.addEventListener("keydown", function (e) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || EDITING || !fmtCanFormat()) return;
  var tag = e.target && e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable)) return;
  var key = (e.key || "").toLowerCase();
  if (key !== "b" && key !== "i") return;
  e.preventDefault();
  var current = firstFmt();
  applyFormat(key === "b" ? { bold: current.bold ? null : true } : { italic: current.italic ? null : true },
    key === "b" ? "bold" : "italic");
});

/* Zoom + print apply to the board/section. Persisted per device like every
   other PREFS-style setting (Nate, live: "zoom resets to 100 when i
   refresh") — was never saved anywhere, so a real setting silently reset
   itself on every reload. */
var ZOOM = (function () {
  var v = parseFloat(localStorage.getItem("pref_zoom"));
  return isFinite(v) ? Math.max(0.5, Math.min(2, v)) : 1;
})();
/* Zoom scales #main as a whole, but Nate doesn't want it touching each
   view's own toolbar header (Current Week's "Days shown" stepper etc.) —
   only the grid/table content below it should grow or shrink. `zoom` isn't
   a real inherited property; nesting an inverse zoom on the toolbar cancels
   the ancestor's scale for that one element (and its own layout box) while
   everything else under #main still scales normally. --zoom is read by the
   `#main .toolbar` counter-zoom rule in app.css. */
function applyZoom() {
  var m = $("#main"); if (m) m.style.zoom = ZOOM;
  document.documentElement.style.setProperty("--zoom", ZOOM);
}
function setZoom(z) {
  ZOOM = Math.max(0.5, Math.min(2, Math.round(z * 100) / 100));
  localStorage.setItem("pref_zoom", ZOOM);
  applyZoom(); renderFmtBar();
}
applyZoom();

/* Material Symbols paths (Apache-2.0) — the same family Google Sheets draws its
   toolbar from, inlined so the icons match without any external asset (D67). */
var ICONS = {
  history: "M13 3c-4.97 0-9 4.03-9 9H1l4 4 4-4H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.78-4.95-2.05l-1.42 1.42A8.96 8.96 0 0 0 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z",
  print: "M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z",
  undo: "M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z",
  redo: "M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z",
  fill: "M16.56 8.94L7.62 0 6.21 1.41l2.38 2.38-5.15 5.15c-.59.59-.59 1.54 0 2.12l5.5 5.5c.29.29.68.44 1.06.44s.77-.15 1.06-.44l5.5-5.5c.59-.58.59-1.53 0-2.12zM5.21 10L10 5.21 14.79 10H5.21z",
  text: "M11 3L5.5 17h2.25l1.12-3h6.25l1.12 3h2.25L13 3h-2zm-1.38 9L12 5.67 14.38 12H9.62z",
  bold: "M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z",
  italic: "M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z",
  border: "M3 3v18h18V3H3zm8 16H5v-6h6v6zm0-8H5V5h6v6zm8 8h-6v-6h6v6zm0-8h-6V5h6v6z",
  collapse: "M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z",
  expand: "M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z",
  condfmt: "M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z",
  pencil: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
};
function svgIcon(name) {
  return '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="' + ICONS[name] + '"/></svg>';
}
/* A little glyph per border option — a light 2×2 cell outline with the target
   side(s)/line(s) drawn thick in the current color (Sheets-style). */
function bordIcon(op) {
  var box = '<rect x="4" y="4" width="16" height="16" fill="none" stroke="var(--ink-3)" stroke-width="1"/>';
  var L = function (a, b, c, d) { return '<line x1="' + a + '" y1="' + b + '" x2="' + c + '" y2="' + d + '" stroke="currentColor" stroke-width="2.4"/>'; };
  var mid = { h: L(4, 12, 20, 12), v: L(12, 4, 12, 20), t: L(4, 4, 20, 4), b: L(4, 20, 20, 20), l: L(4, 4, 4, 20), r: L(20, 4, 20, 20) };
  var outer = mid.t + mid.b + mid.l + mid.r;
  var parts = {
    all: outer + mid.h + mid.v,
    inner: box + mid.h + mid.v,
    horiz: box + mid.h,
    vert: box + mid.v,
    outer: outer,
    left: box + mid.l, top: box + mid.t, right: box + mid.r, bottom: box + mid.b,
    none: box
  };
  return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' + parts[op] + "</svg>";
}
/* The bar itself. Format controls bite on the Scheduler / Current Week and on
   custom Database sheets (D75). */
function fmtCanFormat() {
  return (SEC === "dispatch" && (SUB === "sched" || SUB === "cw")) ||
         (SEC === "database" && (SUB.indexOf("sheet:") === 0 ||
            ["bagger", "brokers", "pickdrop", "fleet"].indexOf(SUB) >= 0));
}
/* D205: the formatting toolbar is a fixed part of the dashboard shell. Keeping
   it open removes a second disclosure state from the compact navigation, and
   the Orders-only Internal Rate control now owns its far-right edge. */
function renderFmtBar() {
  var bar = $("#fmtbar"); if (!bar) return;
  bar.classList.remove("collapsed");
  var can = fmtCanFormat(), dis = can ? "" : " disabled";
  var fs = firstFmt();
  var zooms = [50, 75, 90, 100, 125, 150, 200], zp = Math.round(ZOOM * 100);
  bar.innerHTML =
    (DB && DB.me && DB.me.is_admin
      ? '<button class="fb" data-fb="history" title="History (admin only)">' + svgIcon("history") + "</button>"
      : "") +
    '<button class="fb" data-fb="print" title="Print">' + svgIcon("print") + "</button>" +
    '<button class="fb" data-fb="undo" title="Undo (Cmd/Ctrl-Z)">' + svgIcon("undo") + "</button>" +
    '<button class="fb" data-fb="redo" title="Redo (Cmd/Ctrl-Shift-Z)">' + svgIcon("redo") + "</button>" +
    '<span class="fb-sep"></span>' +
    '<select class="fb-zoomsel" data-fb="zoomsel" title="Zoom">' +
      zooms.map(function (z) { return '<option value="' + z + '"' + (z === zp ? " selected" : "") + ">" + z + "%</option>"; }).join("") +
      (zooms.indexOf(zp) < 0 ? '<option value="' + zp + '" selected>' + zp + "%</option>" : "") +
    "</select>" +
    '<span class="fb-sep"></span>' +
    '<button class="fb fb-clr"' + dis + ' data-fb="fill" title="Fill color">' + svgIcon("fill") +
      '<span class="fb-bar" style="background:' + (fs.fill || LAST_FILL) + '"></span></button>' +
    '<button class="fb fb-clr"' + dis + ' data-fb="text" title="Text color">' + svgIcon("text") +
      '<span class="fb-bar" style="background:' + (fs.text || LAST_TEXT) + '"></span></button>' +
    '<span class="fb-sep"></span>' +
    '<button class="fb' + (fs.bold ? " on" : "") + '"' + dis + ' data-fb="bold" title="Bold (Cmd/Ctrl-B)">' + svgIcon("bold") + "</button>" +
    '<button class="fb' + (fs.italic ? " on" : "") + '"' + dis + ' data-fb="italic" title="Italic (Cmd/Ctrl-I)">' + svgIcon("italic") + "</button>" +
    '<button class="fb"' + dis + ' data-fb="border" title="Borders">' + svgIcon("border") + "</button>" +
    '<span class="fb-sep"></span>' +
    '<button class="fb-font"' + dis + ' data-fb="font" title="Font" style="font-family:' + (fs.font || "inherit") + '">' +
      '<span class="fb-font-lbl">' + esc(fontLabel(fs.font)) + "</span>" + svgIcon("expand") + "</button>" +
    '<span class="fb-fs"' + dis + '>' +
      '<button class="fb-fs-b" data-fb="fs-dec" title="Decrease font size" tabindex="-1">&minus;</button>' +
      '<input class="fb-fs-inp" data-fb="fs-inp" type="text" inputmode="numeric" value="' +
        (fs.size || 10) + '" title="Font size">' +
      '<button class="fb-fs-b" data-fb="fs-inc" title="Increase font size" tabindex="-1">+</button>' +
    "</span>" +
    '<span style="flex:1"></span>' +
    (SEC === "orders" ? '<div class="fmt-ifr">' + internalFreightRateHtml() + "</div>" : "");
}
/* Font picker (D78) — a custom popover, not a native <select>, because browsers
   ignore font-family on <option> (macOS especially). Each row previews in its own
   face, Sheets-style; the current cell's font is checked. */
function fontLabel(stack) {
  var f = FONTS.filter(function (x) { return x[0] === (stack || ""); })[0];
  return f ? f[1] : "System";
}
function openFontMenu(x, y) {
  closePalette();
  var cur = firstFmt().font || "";
  var el = document.createElement("div"); el.id = "palette"; el.className = "font-menu";
  el.innerHTML = FONTS.map(function (f) {
    return '<button class="font-opt' + (f[0] === cur ? " on" : "") + '" data-font="' + esc(f[0]) +
      '" style="font-family:' + (f[0] || "inherit") + '"><span class="fo-ck">' +
      (f[0] === cur ? "✓" : "") + "</span>" + esc(f[1]) + "</button>";
  }).join("");
  document.body.appendChild(el);
  var r = el.getBoundingClientRect();
  el.style.left = Math.min(x, window.innerWidth - r.width - 8) + "px";
  el.style.top = Math.min(y, window.innerHeight - r.height - 8) + "px";
  el.addEventListener("click", function (e) {
    var b = e.target.closest("[data-font]"); if (!b) return;
    applyFormat({ font: b.dataset.font || null }, "font"); closePalette();
  });
  PALETTE_ON = true;
}
$("#fmtbar") && $("#fmtbar").addEventListener("click", function (e) {
  var b = e.target.closest("[data-fb]"); if (!b) return;
  var a = b.dataset.fb;
  if (a === "history") { if (typeof toggleHistoryPanel === "function") toggleHistoryPanel(); return; }
  if (a === "print") { window.print(); return; }
  if (a === "undo") { histUndo(); return; }
  if (a === "redo") { histRedo(); return; }
  if (!fmtCanFormat()) return;
  if (a === "fill") { if (togglePalette("fill")) return; var r = b.getBoundingClientRect(); openSheetsPicker(r.left, r.bottom + 4, function (hex) { if (hex) { LAST_FILL = hex; localStorage.setItem("lastFill", hex); } applyFormat({ fill: hex || null }, "fill"); }); PALETTE_KIND = "fill"; return; }
  if (a === "text") { if (togglePalette("text")) return; var r2 = b.getBoundingClientRect(); openSheetsPicker(r2.left, r2.bottom + 4, function (hex) { if (hex) { LAST_TEXT = hex; localStorage.setItem("lastText", hex); } applyFormat({ text: hex || null }, "text color"); }); PALETTE_KIND = "text"; return; }
  if (a === "border") { if (togglePalette("border")) return; var r3 = b.getBoundingClientRect(); openBorderMenu(r3.left, r3.bottom + 4); PALETTE_KIND = "border"; return; }
  if (a === "font") { if (togglePalette("font")) return; var rf = b.getBoundingClientRect(); openFontMenu(rf.left, rf.bottom + 4); PALETTE_KIND = "font"; return; }
  if (a === "fs-dec" || a === "fs-inc") {
    // Step from the input's shown value, not firstFmt() — the model updates
    // async, so reading it made rapid clicks jump by 1–2 (D80). The input is the
    // synchronous source of truth between clicks.
    var inp = $(".fb-fs-inp");
    var cur = inp && inp.value !== "" ? (parseInt(inp.value, 10) || 10) : (+firstFmt().size || 10);
    var nv = a === "fs-inc" ? cur + 1 : Math.max(1, cur - 1);
    if (inp) inp.value = nv;
    applyFormat({ size: nv }, "font size"); return;
  }
  if (a === "bold") { applyFormat({ bold: firstFmt().bold ? null : true }, "bold"); }
  else if (a === "italic") { applyFormat({ italic: firstFmt().italic ? null : true }, "italic"); }
});
$("#fmtbar") && $("#fmtbar").addEventListener("change", function (e) {
  var z = e.target.closest('[data-fb="zoomsel"]');
  if (z) { setZoom((+z.value || 100) / 100); return; }
  if (!fmtCanFormat()) return;
  var fi = e.target.closest('[data-fb="fs-inp"]');
  if (fi) { var n = parseInt(fi.value, 10); applyFormat({ size: (n && n > 0) ? n : null }, "font size"); return; }
});
$("#fmtbar") && $("#fmtbar").addEventListener("keydown", function (e) {
  var fi = e.target.closest('[data-fb="fs-inp"]');
  if (fi && e.key === "Enter") { e.preventDefault(); fi.blur(); }
});

/* Drag & drop */
/* Shared drop actions (D61) — used by both mouse HTML5 DnD and touch drag.
   Each records an undo/redo pair (D63). */
function dropLoadOnCell(oid, from, td) {
  var to = td.dataset.key, back = from || "STAGE";
  // Outside-carrier lane (D115/D122) drops the same as any truck cell —
  // moveLoad routes to /api/load/carrier internally; name/cost are filled in
  // later from the drawer's collapsible section, not a blocking modal here.
  // Dropping onto a text-only cell (D250, no confirm/alert — Nate: "we don't
  // need any errors or alerts associated with it") silently replaces the
  // note — api_schedule's place-an-order path already deletes any
  // schedule_notes row at the destination, so this is really just the client
  // getting out of the way. Undo needs the note's own text back (moveLoad's
  // undo alone only ever puts the LOAD back where it came from) — captured
  // before the drop since CELLS[to] is about to be overwritten. Nothing to
  // restore for fmt/category: the forward action loses those the same way
  // it already does when placing over an empty formatted cell, so undo
  // restores exactly what changed (the text), not more than the drop itself
  // preserved.
  var priorNote = (CELLS[to] && !CELLS[to].oid && CELLS[to].text) || "";
  confirmHistoricalMove(back, to, function () {
    moveLoad(oid, from, to).then(function () {
      histPush("move load",
        function () {
          return moveLoad(oid, to, back).then(function () {
            if (priorNote) return scheduleNote(to, priorNote);
          });
        },
        function () { return moveLoad(oid, back, to); });
    }).catch(function (err) { toast(err.message, true); });
  });
}
function dropLoadOnRail(oid, from) {
  confirmHistoricalMove(from, "STAGE", function () {
    moveLoad(oid, from, "STAGE").then(function () {
      histPush("unschedule load",
        function () { return moveLoad(oid, "STAGE", from); },
        function () { return moveLoad(oid, from, "STAGE"); });
    }).catch(function (err) { toast(err.message, true); });
  });
}
document.addEventListener("dragstart", function (e) {
  // Broadened from .chip[draggable=true] (D137) — Driver Tabs' occupied
  // slots (.dv-cell) are draggable-out the same way without being real
  // chips (different, denser text layout); this still matches every real
  // chip too, since chipHtml() always sets data-oid on drag-enabled chips.
  var c = e.target.closest("[draggable=true][data-oid]");
  if (c) { DRAG = { kind: "load", oid: c.dataset.oid, from: c.dataset.from }; c.classList.add("dragging");
           e.dataTransfer.effectAllowed = "move"; return; }
  var p = e.target.closest("[data-pool]");
  if (p && p.getAttribute("draggable") === "true") {
    DRAG = { kind: "invoice", idx: +p.dataset.pool }; e.dataTransfer.effectAllowed = "copy"; return;
  }
  var th = e.target.closest("th.trkcol[draggable=true]");
  if (th) { DRAG = { kind: "truckcol", truckId: th.dataset.truckid }; th.classList.add("dragging");
            e.dataTransfer.effectAllowed = "move"; return; }
  var dbth = e.target.closest("th[data-colref][draggable=true]");
  if (dbth && !e.target.closest(".col-resize")) {
    DRAG = { kind: "dbcol", grid: dbth.dataset.colgrid, ref: dbth.dataset.colref };
    dbth.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; return;
  }
  var grip = e.target.closest(".rowgrip[draggable=true]");
  if (grip) { DRAG = { kind: "dbrow", grid: grip.dataset.grid, rowId: grip.dataset.gridrowid };
              grip.closest("td.rowdrag").classList.add("dragging");
              e.dataTransfer.effectAllowed = "move"; }
});
document.addEventListener("dragend", function () {
  $$(".dragging").forEach(function (n) { n.classList.remove("dragging"); });
  $$(".over").forEach(function (n) { n.classList.remove("over"); });
  DRAG = null;
});
document.addEventListener("dragover", function (e) {
  if (DRAG && DRAG.kind === "load") {
    // Reordering within the rail itself (D197) — a chip dragged from and
    // back onto Staging, over another chip there, not the Scheduler/etc.
    // Checked before the generic #rail case below, which deliberately
    // excludes a STAGE-origin drag (moving into staging you're already in
    // is a no-op) — this is the one STAGE-origin case that isn't a no-op.
    if (DRAG.from === "STAGE") {
      var overChip = e.target.closest("#rail .chip[data-oid]");
      if (overChip && overChip.dataset.oid !== DRAG.oid) { e.preventDefault(); overChip.classList.add("over"); return; }
    }
    // [data-key], not td[data-key] (D137) — Driver Tabs' slots are plain
    // divs, not table cells, but use the same cellKey data-key convention.
    // A text-only cell (no real load, D250) is a valid drop target — only a
    // real placed load blocks the drop.
    var td = e.target.closest("[data-key]:not([data-field])"), rail = e.target.closest("#rail");
    if (td && !cellHasLoad(td.dataset.key)) { e.preventDefault(); td.classList.add("over"); }
    else if (rail && DRAG.from !== "STAGE") { e.preventDefault(); rail.classList.add("over"); }
    return;
  }
  if (DRAG && DRAG.kind === "invoice") {
    var row = e.target.closest("[data-bill]");
    if (row) { e.preventDefault(); row.classList.add("over"); }
    return;
  }
  if (DRAG && DRAG.kind === "truckcol") {
    var th = e.target.closest("th.trkcol:not(.carriercol)");
    if (th && th.dataset.truckid !== DRAG.truckId) { e.preventDefault(); th.classList.add("over"); }
    return;
  }
  if (DRAG && DRAG.kind === "dbcol") {
    var dbth = e.target.closest("th[data-colref]");
    if (dbth && dbth.dataset.colgrid === DRAG.grid && dbth.dataset.colref !== DRAG.ref) {
      e.preventDefault(); dbth.classList.add("over");
    }
    return;
  }
  if (DRAG && DRAG.kind === "dbrow") {
    var rg = e.target.closest("td.rowdrag");
    if (rg && rg.dataset.grid === DRAG.grid && rg.dataset.gridrowid !== DRAG.rowId) { e.preventDefault(); rg.classList.add("over"); }
    return;
  }
  if (!DRAG && e.dataTransfer.types.indexOf("Files") >= 0) {
    var z = e.target.closest("#rc-drop,#batch-drop,#dw-drop,#loose-drop");
    if (z) { e.preventDefault(); z.classList.add("over"); }
  }
});
document.addEventListener("dragleave", function (e) {
  var n = e.target.closest("[data-key],#rail,#rail .chip[data-oid],[data-bill],th.trkcol,th[data-colref],td.rowdrag,#rc-drop,#batch-drop,#dw-drop,#loose-drop");
  if (n) n.classList.remove("over");
});
document.addEventListener("drop", function (e) {
  var files = e.dataTransfer && e.dataTransfer.files;
  var zone = e.target.closest("#rc-drop,#batch-drop,#dw-drop,#loose-drop");
  if (zone && files && files.length) {
    e.preventDefault(); zone.classList.remove("over");
    if (zone.id === "rc-drop") ingestRateCon(files[0]);
    else if (zone.id === "batch-drop") ingestBatch(files[0]);
    else if (zone.id === "loose-drop") ingestLoose(files[0]);
    else { $("#file-doc").files = files; $("#file-doc").dispatchEvent(new Event("change")); }
    return;
  }
  if (!DRAG) return;
  if (DRAG.kind === "invoice") {
    var row = e.target.closest("[data-bill]");
    if (row) { e.preventDefault(); row.classList.remove("over"); assignInvoice(DRAG.idx, row.dataset.bill); }
    DRAG = null; return;
  }
  if (DRAG.kind === "truckcol") {
    var th = e.target.closest("th.trkcol:not(.carriercol)");
    if (th) { e.preventDefault(); th.classList.remove("over"); reorderTrucks(DRAG.truckId, th.dataset.truckid); }
    DRAG = null; return;
  }
  if (DRAG.kind === "dbcol") {
    var dbth = e.target.closest("th[data-colref]");
    if (dbth && dbth.dataset.colgrid === DRAG.grid) {
      e.preventDefault(); dbth.classList.remove("over");
      reorderDatabaseColumns(DRAG.grid, DRAG.ref, dbth.dataset.colref);
    }
    DRAG = null; return;
  }
  if (DRAG.kind === "dbrow") {
    var rg = e.target.closest("td.rowdrag");
    if (rg && rg.dataset.grid === DRAG.grid) {
      e.preventDefault(); rg.classList.remove("over"); reorderGridRow(DRAG.grid, DRAG.rowId, rg.dataset.gridrowid);
    }
    DRAG = null; return;
  }
  if (DRAG.kind === "load" && DRAG.from === "STAGE") {
    var overChip = e.target.closest("#rail .chip[data-oid]");
    if (overChip && overChip.dataset.oid !== DRAG.oid) {
      e.preventDefault(); overChip.classList.remove("over");
      reorderStagedRow(DRAG.oid, overChip.dataset.oid);
      DRAG = null; return;
    }
  }
  var td = e.target.closest("[data-key]:not([data-field])"), rail = e.target.closest("#rail");
  if (td && !cellHasLoad(td.dataset.key)) {
    e.preventDefault(); td.classList.remove("over");
    dropLoadOnCell(DRAG.oid, DRAG.from, td);
    DRAG = null; return;
  }
  if (rail && DRAG.from && DRAG.from !== "STAGE") {
    e.preventDefault(); rail.classList.remove("over");
    dropLoadOnRail(DRAG.oid, DRAG.from);
    DRAG = null;
  }
});

/* ═══ 10-select ═══ */
/* ── Multi-cell selection (D66/D68/D70/D71) — spreadsheet-style, two ways so it's
   solid on a trackpad: click-drag a marquee, OR click one cell then shift-click
   another to select the whole rectangle (no dragging needed). A chip still drags
   to move a load, so selection only starts on the cell background.

   D70: NO pointer capture. setPointerCapture on a plain <div> is buggy in Safari
   (and some Chrome builds) — captured pointermove events don't bubble back to the
   document listener. Without capture, pointermove fires on the element under the
   cursor and bubbles to document in every browser. A `selectstart` guard blocks
   Safari's native text-selection during a drag.

   D71: the highlight is styled with var(--focus) (D172 split this off the
   personalizable var(--brand) so a selection ring reads the same regardless
   of accent choice) — it was long broken because the CSS referenced a
   nonexistent var(--accent), so selection worked but painted nothing.
   Confirm the paint, not just the logic. */
var MARQ = null, SEL_ANCHOR = null, COLSEL = null;
function selectDatabaseColumn(th) {
  var key = th.dataset.colgrid + "|" + th.dataset.colref;
  if (COLSEL === key) { clearMulti(); return; }
  var tr = th.parentNode, idx = [].indexOf.call(tr.children, th), table = th.closest("table");
  var cells = [].map.call(table.tBodies[0].rows, function (row) { return row.children[idx]; })
    .filter(function (td) { return td && !td.classList.contains("col-plus-cell"); });
  setSel(cells); cells.forEach(function (td) { td.classList.add("colrange"); });
  th.classList.add("colsel"); COLSEL = key;
}
function killMarquee() { [].forEach.call(document.querySelectorAll(".marquee"), function (b) { b.remove(); }); }
/* Selectable cells inside a grid: scheduler/Current-Week (td[data-key]) and the
   Database grids (td[data-field]) — so selection works app-wide (D68). */
function gridSelCells(wrap) {
  return wrap ? [].slice.call(wrap.querySelectorAll("td[data-key],td[data-field]")) : [];
}
function boxTds(wrap, x1, y1, x2, y2) {
  var lox = Math.min(x1, x2), hix = Math.max(x1, x2), loy = Math.min(y1, y2), hiy = Math.max(y1, y2);
  return gridSelCells(wrap).filter(function (td) {
    var r = td.getBoundingClientRect();
    return r.right >= lox && r.left <= hix && r.bottom >= loy && r.top <= hiy;
  });
}
function rectTds(wrap, a, b) {
  var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
  return boxTds(wrap, Math.min(ra.left, rb.left), Math.min(ra.top, rb.top), Math.max(ra.right, rb.right), Math.max(ra.bottom, rb.bottom));
}
/* Pointer-based marquee — one code path for mouse, trackpad, and touch. No
   pointer capture (see header); document-level move/up listeners catch the drag
   because events bubble up from whatever cell the cursor is over. */
function selStart(e) {
  if (e.button !== 0 && e.pointerType === "mouse") return;
  // The formatting UI acts ON the selection — clicking it must NOT clear it.
  if (e.target.closest("#palette,#ctxmenu,#drawer,.fmtbar,header")) return;
  if (e.target.closest(".col-resize")) return;   // column resize owns this drag (D85)
  if (e.target.closest("#fillhandle")) return;   // fill-handle drag owns this (D118)
  if (e.target.closest("th[data-colref],.col-plus-h")) return; // header click/drag owns this
  // Cmd / Ctrl / Option held: add or remove single cells without losing the rest (drag to add a block). Any grid, any page.
  if ((e.metaKey || e.ctrlKey || e.altKey) && !e.shiftKey) {
    var atd = e.target.closest("td[data-key],td[data-field]"), awrap = e.target.closest(".grid-wrap");
    if (atd && awrap && gridSelCells(awrap).length && !e.target.closest("input,textarea,select,button,a,.cell-input,[data-rowsel],th,.col-resize,#fillhandle,#palette,#ctxmenu,#drawer,.fmtbar,header")) {
      if (typeof EDITING !== "undefined" && EDITING && EDITING.td !== atd) commitEdit();
      var base = SELSET.length ? SELSET.slice() : (SEL && awrap.contains(SEL) ? [SEL] : []);
      var bi = base.indexOf(atd);
      if (bi >= 0) base.splice(bi, 1); else base.push(atd);
      SEL_ANCHOR = atd;
      if (SEL) { SEL.classList.remove("sel"); SEL = null; }
      if (base.length === 1) { setSel([]); selectCell(base[0]); }
      else if (base.length === 0) clearMulti();
      else setSel(base);
      if (!e.target.closest(".chip")) e.preventDefault();   // a chip keeps its own drag
      MARQ = { x0: e.clientX, y0: e.clientY, sx0: awrap.scrollLeft, sy0: awrap.scrollTop, wrap: awrap, moved: false, box: null, lastX: e.clientX, lastY: e.clientY,
               add: base.slice(), scrollTimer: setInterval(marqueeAutoScrollTick, 16) };
      if (e.target.closest(".chip")) { clearInterval(MARQ.scrollTimer); MARQ = null; }
      return;
    }
  }
  // A chip drag or any other control click means the user moved on — drop the
  // marquee so the next format doesn't hit stale cells (D82).
  if (e.target.closest(".chip")) { clearMulti(); return; }   // chip drag wins
  // Truck column header drag (D87) — same reasoning as chips: this pointerdown's
  // preventDefault() below would otherwise swallow the native HTML5 dragstart
  // AND start a cell marquee under the header, which is what made column drag
  // look like "it selects the cell underneath it" (Nate).
  if (e.target.closest("th.trkcol")) return;
  if (e.target.closest("input,textarea,select,button,a,.cell-input,[data-rowsel]")) { clearMulti(); return; }
  var wrap = e.target.closest(".grid-wrap");
  if (!wrap || !gridSelCells(wrap).length) { clearMulti(); return; }
  var td = e.target.closest("td[data-key],td[data-field]");
  if (e.shiftKey && SEL_ANCHOR && wrap.contains(SEL_ANCHOR)) {   // shift-click = rectangle
    e.preventDefault();
    setSel(rectTds(wrap, SEL_ANCHOR, td || SEL_ANCHOR));
    MARQ = null; return;
  }
  if (!td) { clearMulti(); return; }
  if (td) {
    // The preventDefault below suppresses the compatibility `mousedown`, so the
    // old mousedown→selectCell path never fired on a real click — single-cell
    // selection was dead (D83). Select here instead, committing any open edit
    // first (mirrors the mousedown handler in 06).
    if (td === SEL && !e.shiftKey) {
      e.preventDefault(); clearMulti(); MARQ = null; return; // same cell toggles off
    }
    if (typeof EDITING !== "undefined" && EDITING && EDITING.td !== td) commitEdit();
    SEL_ANCHOR = td;
    selectCell(td);
  }
  e.preventDefault();                                // stops native text-select / drag
  MARQ = { x0: e.clientX, y0: e.clientY, sx0: wrap.scrollLeft, sy0: wrap.scrollTop, wrap: wrap, moved: false, box: null, lastX: e.clientX, lastY: e.clientY,
           scrollTimer: setInterval(marqueeAutoScrollTick, 16) };
}
function selMove(e) {
  if (!MARQ) return;
  MARQ.lastX = e.clientX; MARQ.lastY = e.clientY;
  if (!MARQ.moved && Math.abs(e.clientX - MARQ.x0) + Math.abs(e.clientY - MARQ.y0) < 4) return;
  MARQ.moved = true; e.preventDefault();
  var an = marqAnchor();
  drawMarquee(e.clientX, e.clientY);
  setSel(marqCells(an));
}
function drawMarquee(x1, y1) {
  if (!MARQ.box) { killMarquee(); MARQ.box = document.createElement("div"); MARQ.box.className = "marquee"; document.body.appendChild(MARQ.box); }
  var an = marqAnchor(), vr = MARQ.wrap.getBoundingClientRect();
  var ax = Math.max(vr.left, Math.min(vr.right, an.x)), ay = Math.max(vr.top, Math.min(vr.bottom, an.y));
  var x = Math.min(x1, ax), y = Math.min(y1, ay), w = Math.abs(x1 - ax), h = Math.abs(y1 - ay);
  MARQ.box.style.cssText = "position:fixed;left:" + x + "px;top:" + y + "px;width:" + w + "px;height:" + h + "px";
}
/* Drag near the edge of a scroll container and it keeps scrolling (Nate's
   ask, both for a marquee select and, further down, the fill handle) — a
   plain pointermove-driven drag never fires again once the cursor stops
   moving, so an ordinary drag-to-the-edge just sits there instead of
   revealing more rows the way Excel/Sheets does. Shared by both drags:
   nudges wrap.scrollTop toward whichever edge (x,y) is within GRID_SCROLL
   _EDGE of, returns whether it actually scrolled. A setInterval-driven
   caller, not requestAnimationFrame — rAF callbacks are paused outright by
   the browser whenever the tab/window isn't the foreground one, which
   would silently kill auto-scroll the moment focus moved elsewhere
   mid-drag; a plain timer keeps firing regardless. Vertical only — that's
   what was asked; the same pattern extends to horizontal if needed. */
var GRID_SCROLL_EDGE = 28, GRID_SCROLL_SPEED = 14;
function edgeAutoScroll(wrap, x, y) {
  var r = wrap.getBoundingClientRect();
  if (y < r.top + GRID_SCROLL_EDGE && wrap.scrollTop > 0) {
    wrap.scrollTop = Math.max(0, wrap.scrollTop - (GRID_SCROLL_SPEED + Math.min(60, Math.max(0, r.top + GRID_SCROLL_EDGE - y) / 2))); return true;
  }
  if (y > r.bottom - GRID_SCROLL_EDGE && wrap.scrollTop + wrap.clientHeight < wrap.scrollHeight) {
    wrap.scrollTop = Math.min(wrap.scrollHeight - wrap.clientHeight, wrap.scrollTop + GRID_SCROLL_SPEED + Math.min(60, Math.max(0, y - (r.bottom - GRID_SCROLL_EDGE)) / 2)); return true;
  }
  return false;
}
// Where the drag started, on screen right now: it moves up as the grid scrolls down, so rows that scroll out of view stay selected.
function marqAnchor() { return { x: MARQ.x0 + (MARQ.sx0 - MARQ.wrap.scrollLeft), y: MARQ.y0 + (MARQ.sy0 - MARQ.wrap.scrollTop) }; }
// The cells the drag covers, plus whatever was already picked when Cmd / Ctrl / Option was held.
function marqCells(a) {
  var box = boxTds(MARQ.wrap, a.x, a.y, MARQ.lastX, MARQ.lastY);
  if (!MARQ.add) return box;
  var out = MARQ.add.slice(); box.forEach(function (td) { if (out.indexOf(td) < 0) out.push(td); });
  return out;
}
function marqueeAutoScrollTick() {
  if (!MARQ || !MARQ.moved) return;
  if (edgeAutoScroll(MARQ.wrap, MARQ.lastX, MARQ.lastY)) {
    var a = marqAnchor();
    drawMarquee(MARQ.lastX, MARQ.lastY);
    setSel(marqCells(a));
  }
}
function endMarquee() {
  if (!MARQ) return;
  clearInterval(MARQ.scrollTimer);
  killMarquee();
  if (!MARQ.moved && !MARQ.add) setSel([]);          // keep the plain-click single cell (a Cmd/Ctrl/Option click keeps its set)
  MARQ = null;
}
/* ── Fill handle (D118) — Excel-style drag-to-fill ───────────────────────────
   V1 scope: single-cell source only (SEL, not a multi-cell marquee) — a
   selected block's tiled-pattern fill is a real Excel behavior but adds real
   complexity for a "click and fill a value" ask; easy to extend later.
   Reuses boxTds() from the marquee above, axis-constrained to the source
   cell's own row or column band so the drag only ever extends one direction
   at a time, same as Excel. Write path (fillCellOp) lives in 06 next to
   clearCellOp — same op/undo shape, one histPush per drag. */
var FILL = null;
function ensureFillHandleEl() {
  var el = document.getElementById("fillhandle");
  if (!el) { el = document.createElement("div"); el.id = "fillhandle"; document.body.appendChild(el); }
  return el;
}
function fillSourceTd() {
  if (!SEL || !SEL.dataset || !SEL.isConnected) return null;
  if (SEL.dataset.key) { var cv = CELLS[SEL.dataset.key]; if (cv && cv.oid) return null; }  // no fill over a load chip
  return SEL;
}
function positionFillHandle() {
  var el = ensureFillHandleEl(), td = fillSourceTd();
  if (!td) { el.style.display = "none"; return; }
  var r = td.getBoundingClientRect();
  el.style.left = (r.right - 4) + "px";
  el.style.top = (r.bottom - 4) + "px";
  el.style.display = "block";
}
function fillHandleDown(e) {
  var td = fillSourceTd(); if (!td) return;
  var wrap = td.closest(".grid-wrap"); if (!wrap) return;
  e.preventDefault(); e.stopPropagation();
  FILL = { source: td, wrap: wrap, targets: [], lastX: e.clientX, lastY: e.clientY,
           scrollTimer: setInterval(fillAutoScrollTick, 16) };
}
/* Highlight paints directly on the real target <td>s (a .fill-target class),
   not a separately-drawn overlay rectangle — that was the actual complaint:
   a floating div positioned by its own pixel math can drift out of alignment
   with the real cell borders/gaps, so the preview didn't visibly track what
   was really about to fill. Binding the highlight to the cells themselves
   makes misalignment impossible, same reasoning as the marquee's .selrange. */
function paintFillTargets(next) {
  var nextSet = next;
  FILL.targets.forEach(function (td) { if (nextSet.indexOf(td) < 0) td.classList.remove("fill-target"); });
  nextSet.forEach(function (td) { if (td !== FILL.source) td.classList.add("fill-target"); });
  FILL.targets = nextSet;
}
/* The actual box-and-paint math, factored out of the pointermove handler so
   the auto-scroll timer below can re-run it against the last known pointer
   position after a scroll shifts FILL.source (and every other cell)
   underneath it — same reasoning as the marquee's tick reusing boxTds. */
function fillHandleUpdate(x, y) {
  var r = FILL.source.getBoundingClientRect();
  var cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
  var vertical = Math.abs(y - cy) >= Math.abs(x - cx);
  var box = vertical
    ? { l: r.left, t: Math.min(r.top, y), rr: r.right, b: Math.max(r.bottom, y) }
    : { l: Math.min(r.left, x), t: r.top, rr: Math.max(r.right, x), b: r.bottom };
  // Inset every side 1px — boxTds' overlap test is inclusive (>=/<=), so a
  // box edge sitting exactly on a shared grid line also matches whatever
  // cell touches that same pixel from the other side. That happens on BOTH
  // axes here: the perpendicular one (source cell's own left/right, or
  // top/bottom, sits exactly on the next column's or row's edge) and the
  // fixed end of the drag axis (the source's own un-dragged edge sits
  // exactly on the cell before it). Caught live: dragging straight down one
  // column still filled the column next to it, and the row above the
  // source. The dragged (moving) edge tolerates the same inset fine — the
  // cursor is essentially never exactly on a boundary pixel mid-drag.
  box.l += 1; box.t += 1; box.rr -= 1; box.b -= 1;
  paintFillTargets(boxTds(FILL.wrap, box.l, box.t, box.rr, box.b));
}
function fillHandleMove(e) {
  if (!FILL) return;
  e.preventDefault();
  FILL.lastX = e.clientX; FILL.lastY = e.clientY;
  fillHandleUpdate(e.clientX, e.clientY);
}
function fillAutoScrollTick() {
  if (!FILL) return;
  if (edgeAutoScroll(FILL.wrap, FILL.lastX, FILL.lastY)) fillHandleUpdate(FILL.lastX, FILL.lastY);
}
/* Window losing focus mid-drag cancels, same as the marquee's blur handler
   — an interrupted drag shouldn't silently commit whatever happened to be
   highlighted at that moment. */
function cancelFillHandle() {
  if (!FILL) return;
  clearInterval(FILL.scrollTimer);
  FILL.targets.forEach(function (td) { td.classList.remove("fill-target"); });
  FILL = null;
}
function fillHandleUp() {
  if (!FILL) return;
  clearInterval(FILL.scrollTimer);
  var source = FILL.source, targets = FILL.targets.slice();
  targets.forEach(function (td) { td.classList.remove("fill-target"); });
  FILL = null;
  if (!targets.length) return;
  var val = fillValueOf(source);
  var ops = targets.map(function (td) { return fillCellOp(td, val); }).filter(Boolean);
  commitCellOps(ops, "fill", "Filled");
}
document.addEventListener("pointerdown", function (e) { if (e.target.closest("#fillhandle")) fillHandleDown(e); });
document.addEventListener("pointermove", fillHandleMove);
document.addEventListener("pointerup", fillHandleUp);
document.addEventListener("pointercancel", fillHandleUp);
document.addEventListener("scroll", positionFillHandle, true);

/* ── Note border-drag (D254) — Excel-style "grab the selection's edge to
   move it," scoped to a plain text schedule_notes cell (Nate: "on those
   text notes id like to be able to move them if i click and drag from the
   borders of the selection but leave the drag and fill dot on there and
   functionality alone"). Registered BEFORE selStart below so it can claim
   the pointerdown first — same document-target, so only
   stopImmediatePropagation (not stopPropagation) actually keeps selStart
   from also processing it. Only the cell the SELECTION is already on
   counts (matching the fill handle's own "already selected" precondition,
   D118) — grabbing near some OTHER cell's edge is just normal
   marquee/selection, not a move. Moves text only, same scope choice D250
   made for the drag-a-chip-onto-a-note case: the destination keeps
   whatever fmt it already had (scheduleNote's upsert only ever touches
   `body`) and the source clears via the same scheduleNote(key,"") call
   D82's "clearing keeps fmt" behavior already uses elsewhere — no attempt
   to also carry fmt/category across, consistent rather than a special case. */
var NOTEDRAG = null;
var NOTE_BORDER_PX = 6;
function noteDragSourceTd(e) {
  if (!SEL || SEL.dataset.key == null) return null;
  var cv = CELLS[SEL.dataset.key];
  if (!cv || cv.oid || !cv.text) return null;              // real text note only, never a load or blank cell
  if (e.target.closest("td[data-key]") !== SEL) return null; // only the selection's own border
  var r = SEL.getBoundingClientRect();
  var nearEdge = e.clientX - r.left <= NOTE_BORDER_PX || r.right - e.clientX <= NOTE_BORDER_PX ||
    e.clientY - r.top <= NOTE_BORDER_PX || r.bottom - e.clientY <= NOTE_BORDER_PX;
  return nearEdge ? SEL : null;
}
function noteDragUpdate(x, y) {
  var el = document.elementFromPoint(x, y);
  var td = el && el.closest("td[data-key]");
  if (NOTEDRAG.target && NOTEDRAG.target !== td) NOTEDRAG.target.classList.remove("note-drop-target");
  if (td && td !== NOTEDRAG.source && !cellHasLoad(td.dataset.key)) {
    td.classList.add("note-drop-target"); NOTEDRAG.target = td;
  } else {
    NOTEDRAG.target = null;
  }
}
function noteDragAutoScrollTick() {
  if (!NOTEDRAG) return;
  if (edgeAutoScroll(NOTEDRAG.wrap, NOTEDRAG.lastX, NOTEDRAG.lastY)) noteDragUpdate(NOTEDRAG.lastX, NOTEDRAG.lastY);
}
function noteDragStart(e, td) {
  var wrap = td.closest(".grid-wrap"); if (!wrap) return;
  e.preventDefault(); e.stopImmediatePropagation();
  NOTEDRAG = { source: td, key: td.dataset.key, text: CELLS[td.dataset.key].text, wrap: wrap,
               target: null, lastX: e.clientX, lastY: e.clientY,
               scrollTimer: setInterval(noteDragAutoScrollTick, 16) };
  td.classList.add("note-dragging");
}
function noteDragMove(e) {
  if (!NOTEDRAG) return;
  e.preventDefault();
  NOTEDRAG.lastX = e.clientX; NOTEDRAG.lastY = e.clientY;
  noteDragUpdate(e.clientX, e.clientY);
}
function noteDragEnd() {
  if (!NOTEDRAG) return;
  clearInterval(NOTEDRAG.scrollTimer);
  NOTEDRAG.source.classList.remove("note-dragging");
  if (NOTEDRAG.target) NOTEDRAG.target.classList.remove("note-drop-target");
  var fromKey = NOTEDRAG.key, toKey = NOTEDRAG.target && NOTEDRAG.target.dataset.key, text = NOTEDRAG.text;
  NOTEDRAG = null;
  if (!toKey || toKey === fromKey) return;
  confirmHistoricalMove(fromKey, toKey, function () {
    scheduleNote(toKey, text).then(function () { return scheduleNote(fromKey, ""); }).then(function () {
      histPush("move note",
        function () { return scheduleNote(fromKey, text).then(function () { return scheduleNote(toKey, ""); }); },
        function () { return scheduleNote(toKey, text).then(function () { return scheduleNote(fromKey, ""); }); });
    }).catch(function (err) { toast(err.message, true); });
  });
}
document.addEventListener("pointerdown", function (e) {
  if (e.target.closest("#fillhandle")) return; // fill handle owns this (checked first, above)
  var td = noteDragSourceTd(e);
  if (td) noteDragStart(e, td);
});
document.addEventListener("pointermove", noteDragMove);
document.addEventListener("pointerup", noteDragEnd);
document.addEventListener("pointercancel", noteDragEnd);

/* Pointer events drive it (unifies mouse/trackpad/touch); a parallel `mousedown`
   is NOT added so the two never fight. */
document.addEventListener("pointerdown", selStart);
document.addEventListener("pointermove", selMove);
document.addEventListener("pointerup", endMarquee);
document.addEventListener("pointercancel", endMarquee);
/* Safari fires selectstart even after pointerdown.preventDefault(); kill it while
   a marquee drag is live so no page text gets highlighted. */
document.addEventListener("selectstart", function (e) { if (MARQ && MARQ.moved) e.preventDefault(); });
window.addEventListener("blur", endMarquee);
window.addEventListener("blur", cancelFillHandle);

/* ── Copy/paste (D120) — Sheets-style, app-wide, same value model as the fill
   handle (D118): copy captures the current selection as a rectangular value
   grid by real visual row/col position (not selection order); paste tiles
   that grid across whatever is currently selected, repeating the pattern
   when the paste target is a different size — exactly what Nate asked for
   ("paste over multiple cells, whatever you select"), same as real Sheets. */
var VALCLIP = null;        // { grid: [[val,...],...], h, w }
var COPY_SRC = [];         // cells currently painted as "just copied" (.copy-marquee)
function selectionCells() {
  if (typeof SELSET !== "undefined" && SELSET.length) return SELSET.slice();
  return SEL ? [SEL] : [];
}
/* Group cells into a 2D grid by visual row (top) then column (left) —
   rounded to whole pixels so subpixel layout noise can't split one real row
   or column into two. Works for any rectangular selection: a single cell, a
   marquee block, or a whole-row/whole-column selection. */
function gridShape(tds) {
  var rowTops = [], colLefts = [];
  tds.forEach(function (td) {
    var r = td.getBoundingClientRect(), top = Math.round(r.top), left = Math.round(r.left);
    if (rowTops.indexOf(top) < 0) rowTops.push(top);
    if (colLefts.indexOf(left) < 0) colLefts.push(left);
  });
  rowTops.sort(function (a, b) { return a - b; });
  colLefts.sort(function (a, b) { return a - b; });
  var grid = rowTops.map(function () { return new Array(colLefts.length).fill(null); });
  tds.forEach(function (td) {
    var r = td.getBoundingClientRect();
    var ri = rowTops.indexOf(Math.round(r.top)), ci = colLefts.indexOf(Math.round(r.left));
    grid[ri][ci] = td;
  });
  return { grid: grid, h: rowTops.length, w: colLefts.length };
}
function clearCopyHighlight() {
  COPY_SRC.forEach(function (td) { td.classList.remove("copy-marquee"); });
  COPY_SRC = [];
}
function copySelection() {
  var cells = selectionCells().filter(function (td) {
    var cv = td.dataset.key && CELLS[td.dataset.key];
    return !(cv && cv.oid);   // a load chip has no plain "value" to copy (fill-handle rule, D118)
  });
  if (!cells.length) { toast("Nothing to copy here", true); return; }
  var shape = gridShape(cells);
  VALCLIP = { h: shape.h, w: shape.w,
    grid: shape.grid.map(function (row) { return row.map(function (td) { return td ? fillValueOf(td) : ""; }); }) };
  clearCopyHighlight();
  COPY_SRC = cells;
  cells.forEach(function (td) { td.classList.add("copy-marquee"); });
  toast(cells.length === 1 ? "Cell copied" : "Range copied");
}
function pasteSelection() {
  if (!VALCLIP) { toast("Nothing copied", true); return; }
  var cells = selectionCells();
  if (!cells.length) { toast("Select where to paste", true); return; }
  var shape = gridShape(cells);
  var ops = [];
  for (var r = 0; r < shape.h; r++) {
    for (var c = 0; c < shape.w; c++) {
      var td = shape.grid[r][c]; if (!td) continue;
      var op = fillCellOp(td, VALCLIP.grid[r % VALCLIP.h][c % VALCLIP.w]);
      if (op) ops.push(op);
    }
  }
  clearCopyHighlight();   // Sheets consumes the marching-ants highlight on paste
  commitCellOps(ops, "paste", "Pasted");
}

/* ── Date boxes (data-smartdate) ──────────────────────────────────────────
   A plain text box: typing, clicking into one part, selecting, backspace and
   paste all behave like any normal field (double-click a part, e.g. the year,
   to select just that part and retype it). Nothing is rewritten while you
   type, so the cursor stays where you put it. When you finish — Tab, Enter
   or clicking away — whatever was typed is read as a date and tidied into
   MM/DD/YYYY:
     "9/29" or "929"  → 09/29 of the current year
     "9/29/26"        → 09/29/2026
     "09292026"       → 09/29/2026   (digits only works too)
   Something that isn't a real date puts the box back to what it was and
   says so. Clearing the box clears the date.

   The real date (ISO) lives in data-last-iso, which is what everything that
   reads these boxes uses; .value is only the MM/DD/YYYY people see. The
   tidy-up runs on 'change' at the window, so by the time any other listener
   hears 'change' or 'blur', data-last-iso is already the new date. */
function parseDateText(text) {
  var t = String(text || "").trim();
  if (!t) return { empty: true };
  var parts = t.split(/[^0-9]+/).filter(Boolean), m, d, y = null;
  if (parts.length === 1) {                      // digits only
    var x = parts[0];
    if (x.length === 3) { m = x.slice(0, 1); d = x.slice(1); }
    else if (x.length === 4) { m = x.slice(0, 2); d = x.slice(2); }
    else if (x.length === 6) { m = x.slice(0, 2); d = x.slice(2, 4); y = x.slice(4); }
    else if (x.length === 7) { m = x.slice(0, 1); d = x.slice(1, 3); y = x.slice(3); }
    else if (x.length === 8) { m = x.slice(0, 2); d = x.slice(2, 4); y = x.slice(4); }
    else return null;
  } else if (parts.length === 2) { m = parts[0]; d = parts[1]; }
  else if (parts.length === 3) { m = parts[0]; d = parts[1]; y = parts[2]; }
  else return null;
  var mi = parseInt(m, 10), di = parseInt(d, 10), yi;
  if (y == null || y === "") yi = new Date().getFullYear();
  else if (y.length === 2) yi = 2000 + parseInt(y, 10);
  else if (y.length === 4) yi = parseInt(y, 10);
  else return null;
  var dt = new Date(yi, mi - 1, di);             // rejects 2/30, 13/1, 9/31…
  if (!mi || !di || dt.getFullYear() !== yi || dt.getMonth() !== mi - 1 || dt.getDate() !== di) return null;
  return { iso: yi + "-" + String(mi).padStart(2, "0") + "-" + String(di).padStart(2, "0") };
}
function commitDateBox(el) {
  var r = parseDateText(el.value);
  if (r && r.empty) { el.value = ""; el.removeAttribute("data-last-iso"); return; }
  if (!r) {
    el.value = isoToMdy(el.dataset.lastIso || "");
    toast("That isn't a date. Type it as MM/DD/YYYY, or just 9/29 for this year.", true);
    return;
  }
  el.value = isoToMdy(r.iso); el.dataset.lastIso = r.iso;
}
window.addEventListener("focus", function (e) {
  var el = e.target.closest && e.target.closest("[data-smartdate]");
  if (!el) return;
  // A box rendered with only a date value (no data-last-iso yet) learns it here.
  if (!el.dataset.lastIso) { var r = parseDateText(el.value); if (r && r.iso) el.dataset.lastIso = r.iso; }
  el.dataset.dateTyped = "";
}, true);
window.addEventListener("input", function (e) {
  var el = e.target.closest && e.target.closest("[data-smartdate]");
  if (el) el.dataset.dateTyped = "1";
}, true);
// Tidy up before anyone else hears 'change' (fires when you leave the box).
window.addEventListener("change", function (e) {
  var el = e.target.closest && e.target.closest("[data-smartdate]");
  if (el) commitDateBox(el);
}, true);
document.addEventListener("keydown", function (e) {
  var el = e.target.closest && e.target.closest("[data-smartdate]");
  if (!el) return;
  if (e.key === "Enter") {
    e.preventDefault();
    // Enter = done: leaving the box commits it (the browser fires 'change'
    // once, then 'blur'). On the Scheduler's jump box it also jumps there.
    el.blur();
    if (el.id === "jump" && el.dataset.lastIso) jumpTo(el.dataset.lastIso);
  } else if (e.key === "Escape") {
    el.value = isoToMdy(el.dataset.lastIso || ""); el.dataset.dateTyped = ""; el.blur();
  }
});

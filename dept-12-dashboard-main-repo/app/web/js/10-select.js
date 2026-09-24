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
function toggleDatabaseColumn(th) {
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
  MARQ = { x0: e.clientX, y0: e.clientY, wrap: wrap, moved: false, box: null, lastX: e.clientX, lastY: e.clientY,
           scrollTimer: setInterval(marqueeAutoScrollTick, 16) };
}
function selMove(e) {
  if (!MARQ) return;
  MARQ.lastX = e.clientX; MARQ.lastY = e.clientY;
  if (!MARQ.moved && Math.abs(e.clientX - MARQ.x0) + Math.abs(e.clientY - MARQ.y0) < 4) return;
  MARQ.moved = true; e.preventDefault();
  drawMarquee(e.clientX, e.clientY);
  setSel(boxTds(MARQ.wrap, MARQ.x0, MARQ.y0, e.clientX, e.clientY));
}
function drawMarquee(x1, y1) {
  if (!MARQ.box) { killMarquee(); MARQ.box = document.createElement("div"); MARQ.box.className = "marquee"; document.body.appendChild(MARQ.box); }
  var x = Math.min(x1, MARQ.x0), y = Math.min(y1, MARQ.y0),
      w = Math.abs(x1 - MARQ.x0), h = Math.abs(y1 - MARQ.y0);
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
  if (x < r.left || x > r.right) return false;
  if (y < r.top + GRID_SCROLL_EDGE && wrap.scrollTop > 0) {
    wrap.scrollTop = Math.max(0, wrap.scrollTop - GRID_SCROLL_SPEED); return true;
  }
  if (y > r.bottom - GRID_SCROLL_EDGE && wrap.scrollTop + wrap.clientHeight < wrap.scrollHeight) {
    wrap.scrollTop = Math.min(wrap.scrollHeight - wrap.clientHeight, wrap.scrollTop + GRID_SCROLL_SPEED); return true;
  }
  return false;
}
function marqueeAutoScrollTick() {
  if (!MARQ || !MARQ.moved) return;
  if (edgeAutoScroll(MARQ.wrap, MARQ.lastX, MARQ.lastY)) {
    drawMarquee(MARQ.lastX, MARQ.lastY);
    setSel(boxTds(MARQ.wrap, MARQ.x0, MARQ.y0, MARQ.lastX, MARQ.lastY));
  }
}
function endMarquee() {
  if (!MARQ) return;
  clearInterval(MARQ.scrollTimer);
  killMarquee();
  if (!MARQ.moved) setSel([]);                       // keep the plain-click single cell
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

/* ── Smart date-range inputs (D151) ───────────────────────────────────────
   Nate: "all the date ranges that you can type into should be seamless i
   can type 08/22/2026 or... 8 tab 22 tab 2026... make it easier to work
   with tabs and slashes being the same thing inside the dates." A native
   <input type=date> has no JS-visible way to move its own internal
   segment cursor, so "/" (or a mid-date Tab) can never act as a segment
   advance inside one — there is no browser API for it. These specific
   range fields (Reports From/To, Current Week/Driver Tabs' "First day
   drivers see") are plain `type=text` with a `data-smartdate` marker
   instead; this module owns all typing/backspace/paste inside them and
   is the only thing that writes their `.value`. `.value` is ALWAYS the
   committed ISO date ("" while genuinely empty) — never the mid-typing
   MM/DD/YYYY buffer — so every existing reader elsewhere in the app
   keeps working unmodified; the visible text during editing is cosmetic
   only, restored to the real value on blur if nothing usable was typed.

   Segments: month, day, year — index 0/1/2. "/" always advances one
   segment (never leaves the field). Digits fill the active segment and
   auto-advance once it's full (2 digits for month/day, 4 for year) —
   typing "08222026" straight through works with no separators at all.
   Tab is context-sensitive: on the month segment it just advances to day
   (typing a bare month isn't a usable date yet); from day or year
   onward it COMMITS immediately — inferring the year from the field's
   last real value, or today's year if it never had one — and does NOT
   preventDefault, so focus actually leaves exactly like a normal Tab.
   That's the whole "8 tab 22 [tab away] and it just goes" flow. */
var SMARTDATE = new WeakMap();  // el -> { seg: ["","",""], cur: 0, fresh, touched, justAdvanced, opened }
var SMARTDATE_MAX = [2, 2, 4];
function smartDateState(el) {
  var s = SMARTDATE.get(el);
  if (!s) {
    s = { seg: ["", "", ""], cur: 0, fresh: true, touched: false, justAdvanced: false, opened: [true, true, true] };
    SMARTDATE.set(el, s);
  }
  return s;
}
function smartDateDisplay(s) {
  var parts = [s.seg[0], s.seg[1], s.seg[2]];
  while (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  return parts.join("/");
}
function smartDateRender(el, s) { el.value = smartDateDisplay(s); }
function smartDateReset(el) {
  var s = smartDateState(el);
  s.seg = ["", "", ""]; s.cur = 0; s.fresh = false; s.justAdvanced = false; s.opened = [true, true, true];
  return s;
}
/* Feed one run of digits through the same fill/auto-advance logic a real
   keystroke uses — shared by typing and paste so both behave identically.
   Tracks whether the LAST digit auto-advanced the segment, so an explicit
   "/" immediately after (e.g. the middle slash in "08/20/2026", typed
   right after "08" already auto-advanced past month) can tell "the user
   is confirming a boundary that already happened" from "the user wants
   to skip the rest of this segment" and not double-advance past day.

   `opened` (D226 follow-up) tracks which segments still hold a REAL
   pre-edit value the click handler preserved, vs. one that's already been
   started fresh this session. A segment reached by auto-advance (filling
   month rolls into day), "/", or a Tab-driven cur move is only cleared the
   first time a digit actually lands in it — not eagerly on arrival — so a
   user who clicks the day, types it, and stops never touches the untouched
   year at all. Without this, that first digit APPENDED onto the old value
   (e.g. day "14"→"20" rolls into a year that's still "2026", and one more
   keystroke made it "20265"), which either overflowed into nonsense or, on
   commit, failed length validation and silently fell back to the stale
   year — Nate's "if I go to type the day... takes the year away." */
function smartDateFeed(el, digits) {
  var s = smartDateState(el);
  s.touched = true;
  for (var i = 0; i < digits.length; i++) {
    if (s.cur > 2) break;
    if (!s.opened[s.cur]) { s.seg[s.cur] = ""; s.opened[s.cur] = true; }
    s.seg[s.cur] += digits[i];
    s.justAdvanced = false;
    if (s.seg[s.cur].length >= SMARTDATE_MAX[s.cur] && s.cur < 2) { s.cur++; s.justAdvanced = true; }
  }
  smartDateRender(el, s);
}
/* Commit reads the tracked segments directly (mm/dd/yyyy), never the
   joined display text — a flat "how many digits total" guess can't tell
   a single-digit month from a two-digit one once a year is also typed
   (07202026, is that 07/20/26 or a garbled 7/2/2026?), but the segments
   already know which digits went where as they were typed, so there's
   nothing to guess. Clears to blank (not left stale) if what's typed
   doesn't add up to a real date, fires 'change' so existing listeners
   elsewhere fire exactly as they would for a real type=date input. */
function smartDateCommit(el) {
  var s = smartDateState(el);
  var m = parseInt(s.seg[0], 10), d = parseInt(s.seg[1], 10), iso = "";
  if (m && d && m <= 12 && d <= 31) {
    var y;
    if (s.seg[2].length === 4) y = parseInt(s.seg[2], 10);
    else if (s.seg[2].length === 2) y = 2000 + parseInt(s.seg[2], 10);
    else {
      var fb = el.dataset.lastIso, fbY = fb && /^\d{4}-\d{2}-\d{2}$/.test(fb) ? fb.slice(0, 4) : null;
      y = fbY ? parseInt(fbY, 10) : new Date().getFullYear();
    }
    iso = y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  }
  // The resting display is always MM/DD/YYYY, matching how the field looks
  // right after a fresh render — .value is cosmetic here, never read
  // directly by anything downstream. The real ISO lives in data-last-iso;
  // every reader (the #cw-start change handler, the Reports export click
  // handler) reads that instead of .value.
  el.value = isoToMdy(iso) || "";
  if (iso) el.dataset.lastIso = iso; else el.removeAttribute("data-last-iso");
  SMARTDATE.delete(el);
  // Both events, not just one — different consumers listen for different
  // ones (order-tracker/#cw-start fields save on 'change'; drawer [data-of]
  // fields save on 'blur', comparing against data-undo-prev-iso). A Tab-
  // triggered commit runs from inside a keydown handler, before the
  // browser's own focus change would fire a REAL blur — a dispatched
  // keydown never triggers native focus traversal on its own, so without
  // this the drawer's blur-driven save would just never run (caught live:
  // typing a drawer delivery date and tabbing off left Postgres untouched,
  // no /api/order/update at all). dispatchEvent is synchronous, so the
  // save handler below runs to completion (reading the still-stale
  // data-undo-prev-iso) before the sync lines after this run.
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur"));
  // NOW sync the pre-edit markers — after the listeners above already used
  // them. Left until after, the REAL blur the browser fires moments later
  // (when focus actually leaves for real) sees prev already equal to next
  // and correctly no-ops instead of firing a second, duplicate save.
  el.dataset.undoPrev = el.value; el.dataset.undoPrevIso = el.dataset.lastIso || "";
}
document.addEventListener("focus", function (e) {
  var el = e.target.closest && e.target.closest("[data-smartdate]");
  if (!el) return;
  // The rendered `data-last-iso` attribute is authoritative for the real
  // ISO value (the visible .value is always MM/DD/YYYY once rendered) —
  // only fall back to parsing .value for an element that never got one.
  if (!el.dataset.lastIso) el.dataset.lastIso = mdyToIso(el.value) || "";
  el.value = isoToMdy(el.dataset.lastIso) || el.value;
  smartDateReset(el).fresh = true;
}, true);
/* A mouse click (unlike Tab-in) is the user aiming at ONE part of an
   existing date — Nate: "let me select one part of the date without
   deleting the entire date... if i click and type it wipes it." The focus
   handler above always wipes to a blank fresh-typing state (by design,
   D151's "tab in and just type a whole new date" flow); this runs right
   after it for a real click and re-seeds the segments from the current
   value, positions `cur` at whichever segment the caret landed in, and
   blanks only THAT segment so the next digit replaces it while month/day/
   year elsewhere stay put. Skipped once the user has already typed
   something this focus session (`touched`) — clicking around mid-edit
   doesn't reposition, same as before. */
document.addEventListener("click", function (e) {
  var el = e.target.closest && e.target.closest("[data-smartdate]");
  if (!el || document.activeElement !== el) return;
  var s = smartDateState(el);
  if (s.touched) return;
  var iso = el.dataset.lastIso || "";
  s.seg = [iso.slice(5, 7), iso.slice(8, 10), iso.slice(0, 4)];
  var pos = el.selectionStart == null ? 0 : el.selectionStart;
  s.cur = pos < 3 ? 0 : pos < 6 ? 1 : 2;
  s.seg[s.cur] = "";
  // Only the clicked segment is pre-cleared — the other two hold real
  // values that must survive untouched unless the user actually types into
  // them too (smartDateFeed's `opened` check clears on that first digit).
  s.opened = [false, false, false];
  s.opened[s.cur] = true;
  s.fresh = false;
  s.justAdvanced = false;
});
document.addEventListener("blur", function (e) {
  var el = e.target.closest && e.target.closest("[data-smartdate]");
  // Only commit if the user actually edited something — a plain focus-then-
  // blur (tabbing through without typing) must never blank out a real value.
  if (el && SMARTDATE.has(el)) {
    if (SMARTDATE.get(el).touched) smartDateCommit(el);
    else { el.value = el.dataset.lastIso || ""; SMARTDATE.delete(el); }
  }
}, true);
document.addEventListener("keydown", function (e) {
  var el = e.target.closest && e.target.closest("[data-smartdate]");
  if (!el) return;
  var s = smartDateState(el);
  if (/^[0-9]$/.test(e.key)) {
    e.preventDefault();
    if (s.fresh) s = smartDateReset(el);
    smartDateFeed(el, e.key);
    return;
  }
  if (e.key === "/") {
    e.preventDefault();
    s.fresh = false; s.touched = true;
    // A full segment already auto-advanced on its last digit — this "/"
    // is just confirming that boundary, not asking for a second advance
    // past the segment that's now current (the actual bug this guards:
    // "08" auto-advances to day, then the "/" typed right after would
    // otherwise skip day entirely and land on year).
    if (s.justAdvanced) { s.justAdvanced = false; }
    else if (s.cur < 2) s.cur++;
    smartDateRender(el, s);
    return;
  }
  if (e.key === "Backspace") {
    e.preventDefault();
    s.fresh = false; s.touched = true; s.justAdvanced = false;
    if (s.seg[s.cur]) s.seg[s.cur] = s.seg[s.cur].slice(0, -1);
    else if (s.cur > 0) { s.cur--; s.seg[s.cur] = s.seg[s.cur].slice(0, -1); }
    smartDateRender(el, s);
    return;
  }
  if (e.key === "Tab") {
    if (s.cur === 0 && (s.seg[0] || s.seg[1] || s.seg[2])) {
      e.preventDefault(); s.fresh = false; s.cur = 1; smartDateRender(el, s); return;
    }
    if (s.seg[0] || s.seg[1] || s.seg[2]) smartDateCommit(el);  // else: nothing typed, let Tab just leave
    return;
  }
  if (e.key === "Escape") { el.value = isoToMdy(el.dataset.lastIso || ""); SMARTDATE.delete(el); el.blur(); }
});
document.addEventListener("paste", function (e) {
  var el = e.target.closest && e.target.closest("[data-smartdate]");
  if (!el) return;
  e.preventDefault();
  var text = (e.clipboardData || window.clipboardData).getData("text");
  var digits = text.replace(/\D/g, "");
  if (!digits) return;
  if (smartDateState(el).fresh) smartDateReset(el);
  smartDateFeed(el, digits);
});

/* ── Touch drag (D61) — hold-and-drag a chip like the Google Sheets app.
   A short long-press starts the drag (a quick swipe scrolls instead); a floating
   ghost follows the finger; drop onto an empty cell or the staging rail. Reuses
   the same drop actions as mouse DnD. */
var TOUCHDRAG = null;
document.addEventListener("touchstart", function (e) {
  if (e.touches.length !== 1) return;
  var chip = e.target.closest("[draggable=true][data-oid]");  // broadened D137, see 11-toolbar.js dragstart
  if (!chip) return;
  var t = e.touches[0];
  TOUCHDRAG = { oid: chip.dataset.oid, from: chip.dataset.from, chip: chip,
    x0: t.clientX, y0: t.clientY, started: false, target: null, clone: null, timer: null };
  TOUCHDRAG.timer = setTimeout(function () {
    if (TOUCHDRAG) startTouchDrag(TOUCHDRAG.x0, TOUCHDRAG.y0);
  }, 200);
}, { passive: true });
function startTouchDrag(x, y) {
  var chip = TOUCHDRAG.chip, r = chip.getBoundingClientRect();
  TOUCHDRAG.started = true;
  DRAG = { kind: "load", oid: TOUCHDRAG.oid, from: TOUCHDRAG.from };
  chip.classList.add("dragging");
  var clone = chip.cloneNode(true);
  clone.className += " touch-ghost";
  clone.style.width = r.width + "px";
  TOUCHDRAG.offX = Math.min(r.width / 2, x - r.left); TOUCHDRAG.offY = y - r.top;
  clone.style.left = (x - TOUCHDRAG.offX) + "px"; clone.style.top = (y - TOUCHDRAG.offY) + "px";
  document.body.appendChild(clone); TOUCHDRAG.clone = clone;
  if (navigator.vibrate) try { navigator.vibrate(12); } catch (err) {}
}
document.addEventListener("touchmove", function (e) {
  if (!TOUCHDRAG) return;
  var t = e.touches[0];
  if (!TOUCHDRAG.started) {
    if (Math.abs(t.clientX - TOUCHDRAG.x0) > 8 || Math.abs(t.clientY - TOUCHDRAG.y0) > 8) {
      clearTimeout(TOUCHDRAG.timer); TOUCHDRAG = null;  // it's a scroll
    }
    return;
  }
  e.preventDefault();  // block scroll while dragging
  TOUCHDRAG.clone.style.left = (t.clientX - TOUCHDRAG.offX) + "px";
  TOUCHDRAG.clone.style.top = (t.clientY - TOUCHDRAG.offY) + "px";
  TOUCHDRAG.clone.style.display = "none";
  var el = document.elementFromPoint(t.clientX, t.clientY);
  TOUCHDRAG.clone.style.display = "";
  $$(".over").forEach(function (n) { n.classList.remove("over"); });
  var td = el && el.closest("[data-key]:not([data-field])");  // broadened D137, see 11-toolbar.js dragover
  var rail = el && el.closest("#rail");
  // A text-only cell (no real load, D250) is a valid drop target too.
  if (td && !cellHasLoad(td.dataset.key)) { td.classList.add("over"); TOUCHDRAG.target = { td: td }; }
  else if (rail && TOUCHDRAG.from !== "STAGE") { rail.classList.add("over"); TOUCHDRAG.target = { rail: 1 }; }
  else TOUCHDRAG.target = null;
}, { passive: false });
document.addEventListener("touchend", function (e) {
  if (!TOUCHDRAG) return;
  clearTimeout(TOUCHDRAG.timer);
  if (TOUCHDRAG.started) {
    e.preventDefault();  // suppress the synthetic click so the drawer doesn't open
    if (TOUCHDRAG.clone) TOUCHDRAG.clone.remove();
    TOUCHDRAG.chip.classList.remove("dragging");
    $$(".over").forEach(function (n) { n.classList.remove("over"); });
    var tgt = TOUCHDRAG.target;
    if (tgt && tgt.td) dropLoadOnCell(TOUCHDRAG.oid, TOUCHDRAG.from, tgt.td);
    else if (tgt && tgt.rail && TOUCHDRAG.from && TOUCHDRAG.from !== "STAGE") dropLoadOnRail(TOUCHDRAG.oid, TOUCHDRAG.from);
    DRAG = null;
  }
  TOUCHDRAG = null;
}, { passive: false });
/* D208: Escape closes the mobile navigation drawer without affecting the
   desktop rail's persisted collapsed/expanded preference. */
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && mobileNavMode() && MOBILE_NAV_OPEN) closeMobileNav();
});
document.addEventListener("click", function (e) {
  var z = e.target.closest("#rc-drop,#batch-drop,#dw-drop,#loose-drop");
  if (!z) return;
  if (z.id === "rc-drop") $("#file-ratecon").click();
  else if (z.id === "batch-drop") $("#file-batch").click();
  else if (z.id === "loose-drop") $("#file-loose").click();
  else $("#file-doc").click();
});

/* Resizable staging rail (D44) — drag its left edge; width persists. */
(function () {
  var saved = parseInt(localStorage.getItem("railW"), 10);
  if (saved) document.documentElement.style.setProperty("--rail-w", Math.max(120, Math.min(640, saved)) + "px");
  var h = $("#rail-resize"), dragging = false;
  h.addEventListener("mousedown", function (e) { dragging = true; h.classList.add("dragging");
    document.body.style.userSelect = "none"; e.preventDefault(); });
  document.addEventListener("mousemove", function (e) {
    if (!dragging) return;
    var w = Math.max(120, Math.min(640, window.innerWidth - e.clientX));
    document.documentElement.style.setProperty("--rail-w", w + "px");
  });
  document.addEventListener("mouseup", function () {
    if (!dragging) return; dragging = false; h.classList.remove("dragging"); document.body.style.userSelect = "";
    localStorage.setItem("railW", parseInt(getComputedStyle(document.documentElement).getPropertyValue("--rail-w"), 10) || 276);
  });
})();

/* Resizable sidebar nav (D201) — drag its right edge; width persists
   separately for the expanded and collapsed states (a collapsed icon rail
   and an expanded labeled list want very different widths), mirroring the
   Staging rail's own --rail-w pattern (D44) above. Nate: "make it slightly
   wider so that in collapse mode it fits the text or let me drag it to
   whatever width i want" — collapsed defaults wider than a bare icon strip
   (96px, not 64px) specifically so a wrapped label like "Internal Freight"
   in the accordion has room to breathe. D205's plain 16px cycle glyphs let
   users drag the icon rail as far left as 44px without clipping the controls.
   applyNavWidth() is called on boot and again from toggleSideNav()
   (01-core.js) so switching states immediately shows that state's own
   saved width instead of carrying over the other state's. */
var NAV_W_EXP = Math.max(160, Math.min(360, parseInt(localStorage.getItem("navW"), 10) || 200));
var NAV_W_COL = Math.max(44, Math.min(200, parseInt(localStorage.getItem("navCW"), 10) || 96));
function applyNavWidth() {
  document.body.style.setProperty("--nav-w", (NAV_COLLAPSED ? NAV_W_COL : NAV_W_EXP) + "px");
}
(function () {
  applyNavWidth();
  var h = $("#sidenav-resize"), dragging = false;
  h.addEventListener("mousedown", function (e) { dragging = true; h.classList.add("dragging");
    document.body.style.userSelect = "none"; e.preventDefault(); });
  document.addEventListener("mousemove", function (e) {
    if (!dragging) return;
    var min = NAV_COLLAPSED ? 44 : 160, max = NAV_COLLAPSED ? 200 : 360;
    var w = Math.max(min, Math.min(max, e.clientX));
    if (NAV_COLLAPSED) NAV_W_COL = w; else NAV_W_EXP = w;
    document.body.style.setProperty("--nav-w", w + "px");
  });
  document.addEventListener("mouseup", function () {
    if (!dragging) return; dragging = false; h.classList.remove("dragging"); document.body.style.userSelect = "";
    localStorage.setItem(NAV_COLLAPSED ? "navCW" : "navW", NAV_COLLAPSED ? NAV_W_COL : NAV_W_EXP);
  });
})();

/* Collapsible staging rail (D199) — a dedicated header icon, left of the
   "Staging" label (Nate rejected D197's header button and D198's arrow-
   in-the-resize-handle in turn; this is the third, settled design: "a <>
   icon or something that lives on the staging area at the top to the
   left of 'staging' header"). Independent of the resize width above —
   collapsing never touches --rail-w, so whatever width was saved is
   exactly what comes back on expand.
   D201 replaced the static "<>" glyph with a single directional arrow,
   app-wide rule (Nate: "it should be > or < depending on the nav state...
   whichever direction the toggle takes the nav is the one that should be
   displayed"). The rail sits on the right edge, so collapsing shrinks it
   rightward (">" — collapse moves that way) and expanding grows it back
   out to the left ("<" — expand moves that way). D205 removes the button
   box: this is now the same small plain-glyph treatment as the nav cycler. */
(function () {
  var collapsed = localStorage.getItem("railCollapsed") === "1";
  var btn = $("#rail-toggle");
  function apply() {
    $("#bodywrap").classList.toggle("rail-collapsed", collapsed);
    btn.title = collapsed ? "Show staging" : "Hide staging";
    btn.setAttribute("aria-label", btn.title);
    btn.textContent = collapsed ? "<" : ">";
  }
  apply();
  btn.addEventListener("click", function () {
    collapsed = !collapsed;
    document.body.classList.add("shell-animating");
    clearTimeout(btn._motionTimer);
    btn._motionTimer = setTimeout(function () { document.body.classList.remove("shell-animating"); }, 260);
    localStorage.setItem("railCollapsed", collapsed ? "1" : "0");
    apply();
  });
})();

/* ── Boot ────────────────────────────────────────────────────────────────── */
function bootDashboard() {
  document.body.classList.remove("pre-auth");  // undo renderLoginGate()'s hide; render() sets the real rail state
  return dashboardAuth.initialize().then(function (authState) {
    if (authState && authState.redirecting) return null;
    var user = dashboardAuth.user();
    if (user) {
      var meta = user.user_metadata || {};
      profileName = meta.full_name || meta.name || user.email || profileName;
      renderProfile();
    }
    if (LOCAL_AUTH.enabled && LOCAL_AUTH.user) {
      profileName = LOCAL_AUTH.user.username;
      renderProfile();
    }
    return reload();
  }).then(function (loaded) {
    if (loaded === null) return;
    DRIVER_VIEW = DB.trucks.length ? DB.trucks[0].id : null;
    setTimeout(function () { if (SUB === "sched") jumpTo(TODAY); }, 80);
  }).catch(function (e) {
    $("#conn").textContent = "offline";
    $("#main").innerHTML = '<div class="empty"><b>Cannot reach the server.</b><br>' + esc(e.message) +
      "<br><br>Start it with <span class=\"kbd\">python3 app/server.py</span></div>";
  });
}
// A gate in front of the normal boot (D125) — only ever shows when the
// server's local-auth flag is on and no session cookie is present yet.
// Off (the default), localAuthCheck() reports {enabled:false} and this is a
// no-op straight into the existing boot path.
localAuthCheck().then(function (la) {
  if (la.enabled && !la.user) { renderLoginGate(); return; }
  return bootDashboard();
});

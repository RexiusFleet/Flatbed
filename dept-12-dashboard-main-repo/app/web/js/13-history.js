/* ── Durable admin history (D131/D133/D134/D135) ────────────────────────────
   The server enforces admin access too; this client gate keeps the control
   completely absent for restricted users. The whole point (Nate, D135):
   a way to undo a mistake that persists after the session/tab that made it
   is long gone — not the fast in-memory 50-action stack (D96), which dies
   on reload. No bulk "restore to a point": that mode was cut (D132) as the
   fragile, rarely-needed path. Lives as a persistent left column (not an
   overlay) so it can stay open across navigation until the admin closes
   it — clicking a chip jumps to and flashes whatever it touched without
   the panel fighting the destination for screen space.

   Every revert appends a brand-new immutable audit_events row (D131's
   append-only design, on purpose — the log must never look like it was
   edited). Left as one chip per event, toggling Revert/Redo back and forth
   on the same record would visibly stack "Reverted: Reverted: Reverted: …"
   forever (D134 — confirmed live, Nate hit it repeatedly clicking Redo).
   historyGroupedEvents collapses each revert/redo CHAIN — linked by
   reverts_event_id/reverted_by_event_id — into the one chip a person
   actually wants: the original action's plain label, one button whose
   label reflects the chain's current net state (even hops back to the
   original data = active; odd = reverted), targeting whichever event is
   currently the chain's tip. The full chain still exists in Postgres for
   audit purposes; only the display collapses. Chains with nothing left to
   act on (not reversible, no real change, already at the tip of nothing)
   are dropped entirely — "days with edits u can reverse and thats that."
   historyDayGroups then buckets the survivors by the local calendar day
   the ORIGINAL edit happened on (not whenever it was last toggled) and
   collapses each day behind a header; the newest day opens by default. */
var HISTORY_EVENTS = [];
var HISTORY_HAS_MORE = false;

function historyAdmin() { return !!(DB && DB.me && DB.me.is_admin); }
function historyDate(value) {
  if (!value) return "";
  var d = new Date(value);
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " · " +
    d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function historyFieldName(s) { return String(s || "").replace(/_/g, " "); }
function historyValue(v) {
  if (v == null || v === "") return "empty";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
/* Click-to-navigate: jump to and flash whatever a change touched, the way
   Sheets' version history takes you to the edited cell. Looked up against
   the CURRENT live row (DB.orders/loads/notes/etc, already in memory from
   bootstrap) rather than the change's own before/after — those are pruned
   to just the changed fields (D131), so e.g. a load's truck_id/scheduled_date
   usually isn't in the diff at all unless the move itself was the edit. If
   the row's gone (deleted since), there's nothing to jump to. The panel
   itself is never closed by a jump — it stays open until the admin closes it. */
function historyDbGridSlug(table, row) {
  if (table === "parties") return row.is_customer ? "bagger" : "brokers";
  if (table === "locations") return row.party_id ? "bagger" : "pickdrop";
  if (table === "departments") return "departments";
  return "fleet";           // trucks, drivers
}
function historyFlashEl(el) {
  if (!el) return;
  el.scrollIntoView({ block: "center" });
  el.classList.add("hist-flash");
  setTimeout(function () { el.classList.remove("hist-flash"); }, 1400);
}
function historyJumpTarget(table, id) {
  if (!id) return null;
  if (table === "orders") {
    if (!order(id)) return null;
    return function () { openOrder(id); };
  }
  if (table === "loads" || table === "schedule_notes") {
    var arr = table === "loads" ? DB.loads : DB.notes;
    var row = (arr || []).filter(function (x) { return x.id === id; })[0];
    if (!row || !row.truck_id) return null;
    var ds = String(row.scheduled_date).slice(0, 10), key = cellKey(row.truck_id, ds, row.slot);
    return function () {
      SEC = "dispatch"; SUB = "sched"; SEL = null; render(); jumpTo(ds);
      historyFlashEl(document.querySelector('[data-key="' + CSS.escape(key) + '"]'));
    };
  }
  var dbArrays = { parties: DB.parties, locations: DB.locations, trucks: DB.trucks,
                   drivers: DB.drivers, departments: DB.departments };
  if (dbArrays[table]) {
    var dbRow = (dbArrays[table] || []).filter(function (x) { return x.id === id; })[0];
    if (!dbRow) return null;
    var slug = historyDbGridSlug(table, dbRow);
    return function () {
      var grid = gridKey(slug);
      if (archiveConfigForGrid(grid)) {
        if (grid === "bagger" && table === "locations") {
          var owner = party(dbRow.party_id);
          ARCHIVE_DATABASE_VIEW[grid] = !!(owner && owner.customer_archived_at);
        } else {
          ARCHIVE_DATABASE_VIEW[grid] = databaseRowIsArchived(grid, id);
        }
        ROWSEL[grid] = [];
      }
      SEC = "database"; SUB = slug; SEL = null; render();
      historyFlashEl(document.querySelector('[data-histrow="' + table + "|" + id + '"]'));
    };
  }
  return null;
}
/* First changed row in an event's own diff that resolves to a real place to
   go — almost every event is a single mutation, so this is "the" destination. */
function historyEventJump(e) {
  var changes = (e && e.changes) || [];
  for (var i = 0; i < changes.length; i++) {
    var c = changes[i], id = c.primary_key && c.primary_key.id;
    if (c.operation === "DELETE") continue;
    var go = historyJumpTarget(c.table_name, id);
    if (go) return go;
  }
  return null;
}
/* Collapse each revert/redo chain into one entry: { root, tip, depth, canAct }.
   root = the original action (reverts_event_id null). tip = whichever link
   in the chain is current (found first, since events arrive newest-first —
   the newest member of any chain IS its tip). depth = hops from root to
   tip; even = chain is back to root's data state, odd = currently reverted.
   Only chains with something to actually revert/redo survive — Nate: "days
   with edits u can reverse and thats that" (D135). */
function historyGroupedEvents(events) {
  var byId = {}; events.forEach(function (e) { byId[e.id] = e; });
  var seen = {}, out = [];
  events.forEach(function (e) {
    var root = e, depth = 0;
    while (root.reverts_event_id && byId[root.reverts_event_id]) {
      root = byId[root.reverts_event_id]; depth++;
    }
    if (seen[root.id]) return;
    seen[root.id] = true;
    var canAct = !!(root.reversible && e.change_count && !e.reverted_by_event_id);
    if (!canAct) return;
    out.push({ root: root, tip: e, depth: depth, canAct: canAct });
  });
  return out;
}
/* Local calendar day the chain's original edit happened on — undo lives
   with when the mistake was made, not whenever it was last toggled. */
function historyDayKey(value) {
  var d = new Date(value);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function historyDayLabel(key) {
  var parts = key.split("-").map(Number);
  var d = new Date(parts[0], parts[1] - 1, parts[2]);
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var diff = Math.round((today - d) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
function historyDayGroups(groups) {
  var byDay = {}, order = [];
  groups.forEach(function (g) {
    var key = historyDayKey(g.root.occurred_at);
    if (!byDay[key]) { byDay[key] = []; order.push(key); }
    byDay[key].push(g);
  });
  return order.map(function (key) { return { key: key, groups: byDay[key] }; });
}
var HISTORY_OPEN_DAYS = {};
function historyChangeHtml(c) {
  var line;
  if (c.operation === "UPDATE") {
    line = (c.changed_fields || []).map(function (f) {
      return historyFieldName(f) + ": " + historyValue(c.before_data && c.before_data[f]) +
        " → " + historyValue(c.after_data && c.after_data[f]);
    }).join(" · ");
  } else {
    line = c.operation === "INSERT" ? "Created record" : "Deleted record";
  }
  return '<div class="history-change"><b>' + esc(c.table_name) + " · " + esc(c.operation.toLowerCase()) +
    '</b><span>' + esc(line) + "</span></div>";
}
function historyGroupHtml(g) {
  var root = g.root, tip = g.tip, reverted = g.depth % 2 === 1, canAct = g.canAct;
  var state = "", cls = "";
  if (reverted) { state = '<span class="history-status">reverted</span>'; cls = " superseded"; }
  else if (root.external_effect) state = '<span class="history-status warn">external</span>';
  var jump = historyEventJump(root);
  return '<article class="history-event' + cls + (jump ? " jumpable" : "") + '"' +
    (jump ? ' data-history-jump="' + root.id + '" title="Go there"' : "") + '>' +
    '<div class="history-event-main">' +
    '<div><div class="history-label">' + esc(root.label) + state + '</div><div class="history-meta">' +
      esc(root.actor_name) + (root.section ? " · " + esc(root.section + (root.sub ? " / " + root.sub : "")) : "") +
      " · " + root.change_count + " change" + (root.change_count === 1 ? "" : "s") + '</div></div>' +
    '<div class="history-when">' + esc(historyDate(tip.occurred_at)) + "</div></div>" +
    (canAct ? '<div class="history-actions"><button class="btn sm" data-history-revert="' + tip.id + '">' +
      (reverted ? "Redo" : "Revert action") + '</button></div>' : "") +
    (root.changes && root.changes.length
      ? '<div class="history-changes">' + root.changes.map(historyChangeHtml).join("") + "</div>"
      : "") + "</article>";
}
function historyDayHtml(day) {
  var open = !!HISTORY_OPEN_DAYS[day.key], n = day.groups.length;
  return '<div class="history-day">' +
    '<button class="history-day-hd" data-history-day="' + esc(day.key) + '" aria-expanded="' + open + '">' +
    '<span><span class="history-day-arrow">▸</span>' + esc(historyDayLabel(day.key)) + '</span><span class="history-day-ct">' +
    n + " edit" + (n === 1 ? "" : "s") + "</span></button>" +
    (open ? '<div class="history-day-body">' + day.groups.map(historyGroupHtml).join("") + "</div>" : "") +
    "</div>";
}
function renderHistoryPanel() {
  var body = $("#history-body"); if (!body) return;
  var days = historyDayGroups(historyGroupedEvents(HISTORY_EVENTS));
  // First render after a (re)load: default the most recent day open so the
  // panel isn't a wall of collapsed headers on first look.
  if (days.length && !Object.keys(HISTORY_OPEN_DAYS).length) HISTORY_OPEN_DAYS[days[0].key] = true;
  body.innerHTML = days.length ? days.map(historyDayHtml).join("") :
    '<div class="history-empty">No reversible edits yet.</div>';
  if (HISTORY_HAS_MORE) body.insertAdjacentHTML("beforeend",
    '<button class="btn" data-history-more style="margin:2px auto 8px">Load Older History</button>');
}
function loadHistoryPanel(append) {
  var body = $("#history-body");
  if (body && !append) body.innerHTML = '<div class="history-loading">Loading history…</div>';
  var before = append && HISTORY_EVENTS.length ? "&before=" + HISTORY_EVENTS[HISTORY_EVENTS.length - 1].sequence : "";
  return api("history?limit=100" + before).then(function (j) {
    HISTORY_EVENTS = append ? HISTORY_EVENTS.concat(j.events || []) : (j.events || []);
    HISTORY_HAS_MORE = !!j.has_more; renderHistoryPanel();
  }).catch(function (e) {
    if (body) body.innerHTML = '<div class="history-empty">' + esc(e.message) + "</div>";
  });
}
function historyPanelOpen() {
  var panel = $("#history-panel");
  return !!(panel && panel.classList.contains("on"));
}
function openHistoryPanel() {
  if (!historyAdmin()) return;
  var panel = $("#history-panel"); if (!panel) return;
  panel.classList.add("on"); panel.setAttribute("aria-hidden", "false");
  document.body.classList.add("shell-animating");
  var bw = $("#bodywrap"); if (bw) bw.classList.add("history-on");
  setTimeout(function () { document.body.classList.remove("shell-animating"); }, 260);
  loadHistoryPanel();
}
function closeHistoryPanel() {
  var panel = $("#history-panel"); if (!panel) return;
  panel.classList.remove("on"); panel.setAttribute("aria-hidden", "true");
  document.body.classList.add("shell-animating");
  var bw = $("#bodywrap"); if (bw) bw.classList.remove("history-on");
  setTimeout(function () { document.body.classList.remove("shell-animating"); }, 260);
}
function toggleHistoryPanel() {
  if (historyPanelOpen()) closeHistoryPanel(); else openHistoryPanel();
}
function openHistoryRevertPreview(eventId) {
  api("history/preview", { event_id: eventId }).then(function (p) {
    var target = p.target || {};
    var isRedo = !!target.reverts_event_id, verb = isRedo ? "Redo" : "Revert action";
    var warning = "";
    if ((p.irreversible || []).length) warning += '<div class="history-warning"><b>External effect remains.</b> ' +
      "This action sent an email, Google Sheets push, or other external effect that the database cannot take back.</div>";
    openModal('<div class="modal-hd"><h2>' + (isRedo ? "Redo this action?" : "Revert this action?") + '</h2></div>' +
      '<div class="modal-body">' +
      '<p style="font-size:var(--fs-body-sm);color:var(--ink-2);line-height:1.5;margin:0">' +
      "This action will be reversed without intentionally changing unrelated later work.</p>" + warning +
      '<div class="history-preview"><div class="history-preview-row"><b>' + esc(target.label || "") + '</b><span>' +
      esc((target.actor_name || "") + " · " + historyDate(target.occurred_at)) + '</span><span>' +
      p.change_count + " database change" + (p.change_count === 1 ? "" : "s") + " will be reversed</span></div></div>" +
      "</div>" +
      '<div class="modal-ft"><button class="btn" id="modal-cancel">Cancel</button><span style="flex:1"></span>' +
      '<button class="btn bad" id="history-confirm"' + (p.can_apply ? "" : " disabled") + ">" + verb + "</button></div>");
    var confirm = $("#history-confirm");
    if (confirm && p.can_apply) confirm.addEventListener("click", function () {
      confirm.disabled = true; confirm.textContent = isRedo ? "Redoing…" : "Reverting…";
      api("history/revert", { event_id: eventId, baseline_sequence: p.baseline_sequence }).then(function (r) {
        closeModal();
        return reload().then(function () {
          toast((isRedo ? "Redone" : "Reverted action") + " · " + r.change_count + " change" + (r.change_count === 1 ? "" : "s"));
        });
      }).catch(function (e) {
        confirm.disabled = false; confirm.textContent = verb;
        toast(e.message, true);
      });
    });
  }).catch(function (e) { toast(e.message, true); });
}

$("#history-close") && $("#history-close").addEventListener("click", closeHistoryPanel);
$("#history-panel") && $("#history-panel").addEventListener("click", function (e) {
  var rev = e.target.closest("[data-history-revert]");
  var more = e.target.closest("[data-history-more]");
  var day = e.target.closest("[data-history-day]");
  var chip = day ? null : e.target.closest("[data-history-jump]");
  if (rev) openHistoryRevertPreview(rev.dataset.historyRevert);
  else if (day) { HISTORY_OPEN_DAYS[day.dataset.historyDay] = !HISTORY_OPEN_DAYS[day.dataset.historyDay]; renderHistoryPanel(); }
  else if (more) { more.disabled = true; more.textContent = "Loading…"; loadHistoryPanel(true); }
  else if (chip) {
    var root = HISTORY_EVENTS.filter(function (x) { return x.id === chip.dataset.historyJump; })[0];
    var go = root && historyEventJump(root);
    if (go) go();
  }
});
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && historyPanelOpen()) closeHistoryPanel();
});

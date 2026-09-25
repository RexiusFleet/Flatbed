/* Dept 12 Dashboard — Supabase data layer (no SDK, no build step).
 *
 * The dashboard used to call a local Python server at /api/<route>. This file
 * keeps that exact contract — app.js still calls api("order/update", {...}) —
 * and maps every route onto Supabase:
 *
 *   • Postgres functions (POST /rest/v1/rpc/api_*) for anything with business
 *     rules or several statements (numbering, locks, scheduling, history…).
 *     They are ports of the old Python handlers; see
 *     supabase/migrations/20260924000002_api_functions.sql.
 *   • Plain REST (/rest/v1/<table>) for simple single-row CRUD.
 *   • Storage (/storage/v1, private "documents" bucket) for PDFs.
 *   • Edge Functions (/functions/v1/*) ONLY for Motive and the Google Sheets
 *     driver mirror, because those need secrets the browser must never see.
 *
 * Access: every signed-in account has full access — there are no in-app
 * roles or per-page permissions. Who can sign in is managed in Supabase:
 * create the account under Authentication → Users (with public sign-ups
 * turned off), and add its email to dept12_private.allowed_logins.
 */
(function () {
"use strict";

var CFG = window.DEPT12_CONFIG || {};
var SB_URL = String(CFG.supabaseUrl || "").replace(/\/+$/, "");
var SB_KEY = String(CFG.supabaseKey || "");
var BUCKET = "documents";
var SESSION_KEY = "dept12-supabase-session";

// ── Session ───────────────────────────────────────────────────────────────
var SESSION = null;
try { SESSION = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { SESSION = null; }
function saveSession(s) {
  SESSION = s;
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch (e) { /* private mode: session lives for this tab only */ }
}
function sessionFrom(j) {
  return {
    access_token: j.access_token, refresh_token: j.refresh_token,
    expires_at: j.expires_at || (Math.floor(Date.now() / 1000) + (j.expires_in || 3600)),
    user: j.user || null
  };
}
function authRequest(path, body) {
  return fetch(SB_URL + "/auth/v1/" + path, {
    method: "POST",
    headers: { "apikey": SB_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (!r.ok) throw new Error(j.error_description || j.msg || j.message || j.error || ("Sign-in failed (" + r.status + ")"));
      return j;
    });
  });
}
var REFRESHING = null;
function refreshSession() {
  if (!SESSION || !SESSION.refresh_token) return Promise.reject(new Error("Signed out"));
  if (!REFRESHING) {
    REFRESHING = authRequest("token?grant_type=refresh_token", { refresh_token: SESSION.refresh_token })
      .then(function (j) { saveSession(sessionFrom(j)); return SESSION; })
      .catch(function (e) { saveSession(null); throw e; })
      .then(function (s) { REFRESHING = null; return s; }, function (e) { REFRESHING = null; throw e; });
  }
  return REFRESHING;
}
// A token with under a minute left is refreshed before use.
function accessToken() {
  if (!SESSION) return Promise.reject(signedOutError());
  if ((SESSION.expires_at || 0) - 60 > Date.now() / 1000) return Promise.resolve(SESSION.access_token);
  return refreshSession().then(function (s) { return s.access_token; });
}
function signedOutError() {
  var e = new Error("Your session ended — sign in again."); e.signedOut = true; return e;
}
function signedOut() {
  saveSession(null);
  if (!document.querySelector(".login-gate")) location.reload();
}

// ── Low-level fetch ───────────────────────────────────────────────────────
function errorFrom(r) {
  return r.text().then(function (t) {
    var j = null; try { j = JSON.parse(t); } catch (e) { /* not JSON */ }
    // Postgres `raise exception 'msg'` arrives as {message:"msg"} — the same
    // text the Python server used to return as {error:"msg"}.
    var msg = (j && (j.message || j.error_description || j.msg || j.error)) || t || ("Request failed (" + r.status + ")");
    var e = new Error(String(msg)); e.status = r.status; e.body = j;
    return e;
  });
}
function sbFetch(path, opts, retried) {
  opts = opts || {};
  return accessToken().then(function (tok) {
    var h = { "apikey": SB_KEY, "Authorization": "Bearer " + tok };
    Object.keys(opts.headers || {}).forEach(function (k) { h[k] = opts.headers[k]; });
    return fetch(SB_URL + path, { method: opts.method || "GET", headers: h, body: opts.body });
  }).then(function (r) {
    if (r.status === 401 && !retried) {
      return refreshSession().then(function () { return sbFetch(path, opts, true); },
                                   function () { signedOut(); throw signedOutError(); });
    }
    if (!r.ok) return errorFrom(r).then(function (e) { throw e; });
    return r;
  });
}
function jsonOf(r) {
  return r.text().then(function (t) { return t ? JSON.parse(t) : null; });
}
function rpc(name, args, hist) {
  return sbFetch("/rest/v1/rpc/" + name, {
    method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, hist || {}),
    body: JSON.stringify(args || {})
  }).then(jsonOf);
}
function rest(method, tableQuery, body, hist, prefer) {
  var h = Object.assign({ "Content-Type": "application/json", "Prefer": prefer || "return=representation" }, hist || {});
  return sbFetch("/rest/v1/" + tableQuery, {
    method: method, headers: h, body: body === undefined ? undefined : JSON.stringify(body)
  }).then(jsonOf);
}
function one(rows) { return Array.isArray(rows) ? (rows[0] || null) : rows; }
function edgeFunction(name, body, hist) {
  return sbFetch("/functions/v1/" + name, {
    method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, hist || {}),
    body: JSON.stringify(body || {})
  }).then(jsonOf).then(function (j) {
    if (j && j.error) throw new Error(j.error);
    return j;
  });
}

// ── Storage (private "documents" bucket) ─────────────────────────────────
function objectPath(path) {
  return String(path).split("/").map(encodeURIComponent).join("/");
}
function storageUpload(path, blob, contentType) {
  return sbFetch("/storage/v1/object/" + BUCKET + "/" + objectPath(path), {
    method: "POST",
    headers: { "Content-Type": contentType || blob.type || "application/octet-stream", "x-upsert": "false" },
    body: blob
  });
}
function storageMove(from, to) {
  return sbFetch("/storage/v1/object/move", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucketId: BUCKET, sourceKey: from, destinationKey: to })
  });
}
function storageRemove(paths) {
  paths = (paths || []).filter(Boolean);
  if (!paths.length) return Promise.resolve();
  return sbFetch("/storage/v1/object/" + BUCKET, {
    method: "DELETE", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: paths })
  }).catch(function (e) {
    // The database row is already gone; an orphaned object is harmless and
    // can be cleaned up from the Storage dashboard. Don't fail the action.
    console.warn("Storage cleanup failed for", paths, e);
  });
}
// Short-lived (5 min) signed URL — the bucket is private, so this is the
// only way a browser can read a document.
function storedFileUrl(path) {
  return sbFetch("/storage/v1/object/sign/" + BUCKET + "/" + objectPath(path), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 300 })
  }).then(jsonOf).then(function (j) {
    var u = j.signedURL || j.signedUrl;
    if (!u) throw new Error("Could not open that document.");
    return /^https?:/.test(u) ? u : SB_URL + "/storage/v1" + (u.charAt(0) === "/" ? "" : "/") + u;
  });
}
function fetchStoredFile(path) {
  return sbFetch("/storage/v1/object/authenticated/" + BUCKET + "/" + objectPath(path));
}
function mimeFor(name) {
  var ext = String(name || "").split(".").pop().toLowerCase();
  return ({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
            gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml",
            avif: "image/avif", txt: "text/plain", csv: "text/csv" })[ext] || "application/pdf";
}
function blobFromB64(b64, type) {
  var bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: type });
}

// Download/open links for stored documents: <a data-filepath data-filemode>.
document.addEventListener("click", function (e) {
  var a = e.target.closest && e.target.closest("[data-filepath]");
  if (!a) return;
  e.preventDefault(); e.stopPropagation();
  var path = a.getAttribute("data-filepath"), name = a.getAttribute("data-filename") || path.split("/").pop();
  if (a.getAttribute("data-filemode") === "download") {
    fetchStoredFile(path).then(function (r) { return r.blob(); }).then(function (b) {
      var u = URL.createObjectURL(b), l = document.createElement("a");
      l.href = u; l.download = name; document.body.appendChild(l); l.click(); l.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
    }).catch(function (err) { alert(err.message); });
    return;
  }
  var w = window.open("", "_blank");   // opened synchronously so popup blockers allow it
  storedFileUrl(path).then(function (u) { if (w) w.location = u; else location.href = u; })
    .catch(function (err) { if (w) w.close(); alert(err.message); });
}, true);

// ── History labels (was HISTORY_LABELS / _history_scope in server.py) ─────
// Sent as request headers; the audit trigger turns them into the event the
// admin History panel shows (see 20260924000001_supabase_platform.sql).
var HISTORY_LABELS = {
  "order": "Create order", "order/ingest": "Ingest order",
  "internal-order": "Add bag order", "order/transfer": "Add internal freight order",
  "order/update": "Edit order", "order/route": "Edit order route",
  "order/cancel": "Cancel order", "order/delete": "Delete order",
  "order/copy": "Copy order", "order/bill": "Change billing status",
  "document": "Save document", "document/attach": "Attach document",
  "document/delete": "Delete document", "schedule": "Edit schedule",
  "load/carrier": "Schedule outside carrier", "unschedule": "Unschedule load",
  "cell/color": "Color scheduler cell", "cell/format": "Format scheduler cell",
  "truck/off": "Change truck availability", "day-note": "Edit day note",
  "freight": "Edit freight", "motive/sync-miles": "Sync Motive mileage",
  "internal-freight-rate": "Change internal freight rate",
  "internal-freight-rate/calculate": "Calculate internal freight charges",
  "sync-delivery-dates": "Sync delivery dates", "driver": "Add driver",
  "truck": "Add truck", "assign-truck": "Assign truck",
  "truck/driver": "Change truck driver", "location": "Add location",
  "department": "Add department", "customer": "Add customer",
  "category": "Edit scheduler category", "sheet": "Change sheet",
  "sheet/cell": "Edit sheet cell", "grid/cell-fmt": "Format database cell",
  "row": "Edit database row", "row/custom": "Edit custom field",
  "grid/column": "Add database column", "grid/column/update": "Edit database column",
  "grid/column/delete": "Delete database column", "entity": "Add database",
  "entity/update": "Edit database", "entity/delete": "Delete database",
  "field": "Add database field", "field/update": "Edit database field",
  "field/rename-option": "Rename dropdown option",
  "field/delete": "Delete database field", "record": "Add database record",
  "record/update": "Edit database record", "record/delete": "Delete database record",
  "grid/row": "Add database row", "grid/row/delete": "Delete database row",
  "database/archive": "Archive or restore database row",
  "grid/row/reorder": "Reorder database rows",
  "admin/order-number-settings": "Change order numbering",
  "sheets/push-driver-tabs": "Push driver tabs"
};
function dbNow() { return (window.DEPT12_DB && window.DEPT12_DB()) || {}; }
function findById(list, id) {
  for (var i = 0; i < (list || []).length; i++) if (list[i].id === id) return list[i];
  return null;
}
function orderSub(id) {
  var o = findById(dbNow().orders, id);
  if (!o) return "ext";
  return o.is_transfer ? "xfer" : (o.kind === "internal" ? "int" : "ext");
}
function tableSub(table, id) {
  if (table === "trucks" || table === "drivers") return "fleet";
  if (table === "locations") return "pickdrop";
  if (table === "departments") return "departments";
  if (table === "parties") { var p = findById(dbNow().parties, id); return p && p.is_broker ? "brokers" : "bagger"; }
  return null;
}
function gridSub(grid) { return grid === "external" ? "brokers" : grid; }
// Port of API_PERMISSIONS: which (section, sub) a route belongs to.
function scopeFor(route, d) {
  d = d || {};
  var s = {
    "order": ["orders", d.kind === "internal" ? "int" : "ext"],
    "order/ingest": ["orders", d.kind === "internal" ? "int" : "ext"],
    "internal-order": ["orders", "int"], "order/transfer": ["orders", "xfer"],
    "order/route": ["orders", "ext"],
    "order/bill": ["billing", "bill"], "document": ["billing", "bill"],
    "document/attach": ["billing", "bill"], "document/delete": ["billing", "bill"],
    "schedule": ["dispatch", "sched"], "load/carrier": ["dispatch", "sched"],
    "cell/color": ["dispatch", "sched"], "cell/format": ["dispatch", "sched"],
    "truck/off": ["dispatch", "sched"], "unschedule": ["dispatch", "sched"],
    "day-note": ["dispatch", "sched"],
    "driver": ["database", "fleet"], "truck": ["database", "fleet"],
    "assign-truck": ["database", "fleet"], "truck/driver": ["database", "fleet"],
    "location": ["database", "pickdrop"], "department": ["database", "departments"],
    "customer": ["database", d.kind === "external" ? "brokers" : "bagger"]
  }[route];
  if (s) return s;
  if (/^order\/(update|cancel|delete)$/.test(route)) return ["orders", orderSub(d.id)];
  if (route === "order/copy" || route === "freight") return ["orders", orderSub(d.order_id)];
  if (/^(row|row\/custom|grid\/cell-fmt)$/.test(route)) return ["database", tableSub(d.table, d.id)];
  if (/^(grid\/row|grid\/row\/delete|database\/archive|grid\/row\/reorder)$/.test(route)) return ["database", gridSub(d.grid || "")];
  if (route === "record") return ["database", "custom:" + d.entity_id];
  if (route === "sheet/cell") return ["database", "sheet:" + d.sheet_id];
  if (/^admin\//.test(route)) return ["settings", "appearance"];
  return [null, null];
}
function histHeaders(route, d, extra) {
  d = d || {};
  var label = HISTORY_LABELS[route] ||
    route.split("/").pop().replace(/-/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  var ident = d.solomon_order_no || d.broker_load_no;
  if (ident) label += " " + ident;
  var scope = scopeFor(route, d);
  var h = { "x-dept12-route": "/api/" + route, "x-dept12-label": label.replace(/[^\x20-\x7e]/g, "") };
  if (scope[0]) h["x-dept12-section"] = scope[0];
  if (scope[1]) h["x-dept12-sub"] = String(scope[1]);
  return Object.assign(h, extra || {});
}

// ── Reports → CSV (was _csv / _REPORT_LABELS in server.py) ────────────────
var REPORT_LABELS = {
  dump: {
    solomon_order_no: "Order #", department: "Department Code",
    pivot_department: "Pivot Department", kind: "Kind", is_transfer: "Is Transfer",
    broker_load_no: "Load #", po_number: "PU_PO", delivery_number: "Delivery #",
    customer: "Customer", customer_rexius_no: "Customer Rexius #",
    customer_phone: "Customer Phone", customer_ap_email: "Customer AP Email",
    customer_manager: "Customer Manager",
    broker: "Broker", broker_rexius_no: "Broker Rexius #", broker_phone: "Broker Phone",
    broker_ap_email: "Broker AP Email", broker_manager: "Broker Manager",
    pallet_count: "PAL", stage: "Stage", load_info: "Load Info",
    driver_note: "Driver Tab Note", tarp: "Tarp",
    ordered_at: "Ordered", released_at: "Released",
    requested_delivery_date: "Requested Delivery", delivered_at: "Delivered",
    billed_at: "Billed",
    scheduled_date: "Scheduled Date", slot: "Slot", load_status: "Load Status",
    route_mode: "Route Mode", pushed_at: "Pushed At",
    iso_year: "ISO Year", iso_week: "ISO Week", year_month: "Year-Month",
    season: "Season",
    truck_number: "Truck #", equipment_type: "Equipment Type",
    driver_name: "Driver", driver_color: "Driver Color",
    miles: "Miles", order_motive_miles: "Motive Miles",
    order_miles_adjusted: "Miles Adjusted",
    internal_freight_amount: "Transfer $", external_revenue_load: "External Revenue (Load)",
    orders_on_load: "Orders On Load", external_revenue_share: "External Revenue Share",
    is_carrier: "Is Carrier", carrier_name: "Carrier", carrier_cost: "Carrier Cost",
    pickup_name: "Pickup Name", pickup_address: "Pickup Address",
    pickup_city: "Pickup City", pickup_state: "Pickup State",
    pickup_zip: "Pickup Zip", pickup_phone: "Pickup Phone",
    delivery_name: "Delivery Name", delivery_address: "Delivery Address",
    delivery_city: "Delivery City", delivery_state: "Delivery State",
    delivery_zip: "Delivery Zip", delivery_phone: "Delivery Phone",
    customer_loc_city: "Customer Location City", customer_loc_state: "Customer Location State",
    customer_forklift: "Forklift", customer_timing_window: "Time Window",
    customer_standard_miles: "Standard Miles",
    rate_con_count: "Rate Con Count", pod_count: "POD Count",
    invoice_doc_count: "Invoice Doc Count", day_note: "Day Note"
  },
  freight: { truck_number: "Truck #", department: "Department", load_count: "Load Count", total_amount: "Total $" },
  mileage: { bucket: "Type", customer_or_dept: "Customer_Department", order_count: "Order Count",
             orders_with_miles: "Orders With Miles", total_miles: "Total Miles" },
  customers: {
    name: "Customer", address: "Address", city: "City", state: "State",
    forklift: "Forklift", timing_window: "Time Window", designation: "Designation",
    standard_miles: "Miles", miles_from_umatilla: "Umatilla Miles",
    is_umatilla: "Is Umatilla", appointment_note: "Appointment Note",
    notes: "Notes", phone: "Phone", manager_name: "Manager"
  },
  brokers: { name: "Broker", rexius_customer_no: "Rexius #", ap_email: "AP Email",
             phone: "Phone", manager_name: "Manager", notes: "Notes" },
  fleet: { truck: "Truck #", equipment_type: "Equipment Type", active: "Active", current_driver: "Driver" }
};
var REPORT_ORDER = ["orders", "loads", "missing_pod", "customers", "brokers", "fleet",
                    "customer_order_counts", "documents", "dump", "freight", "mileage"];
function csvOf(rep, labels) {
  var rows = rep && rep.rows, numeric = {};
  if (!rows || !rows.length) return "";
  (rep.numeric_columns || []).forEach(function (c) { numeric[c] = true; });
  var cols = Object.keys(rows[0]); labels = labels || {};
  function cell(v, c) {
    // Match Python's str() exactly: True/False, and numeric columns went
    // through float() so whole numbers print as "255.0".
    var s = v === null || v === undefined ? "" : v === true ? "True" : v === false ? "False"
      : typeof v === "object" ? JSON.stringify(v)
      : numeric[c] && Number.isInteger(Number(v)) ? String(Number(v)) + ".0"
      : numeric[c] ? String(Number(v))
      // Python isoformat always prints 6 microsecond digits; Postgres trims zeros.
      : typeof v === "string" ? v.replace(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.)(\d{1,5})(?=[+-]\d\d:\d\d$)/,
          function (m, a, f) { return a + (f + "00000").slice(0, 6); })
      : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  return [cols.map(function (c) { return labels[c] || c; }).join(",")]
    .concat(rows.map(function (r) { return cols.map(function (c) { return cell(r[c], c); }).join(","); }))
    .join("\n");
}
function buildReport(name, from, to) {
  if (name === "everything") {
    return REPORT_ORDER.reduce(function (p, k) {
      return p.then(function (out) {
        return buildReport(k).then(function (csv) { return out.concat(["### " + k.toUpperCase(), csv, ""]); });
      });
    }, Promise.resolve([])).then(function (parts) { return parts.join("\n"); });
  }
  return rpc("api_report", { p_name: name, p_from: from || null, p_to: to || null })
    .then(function (rows) { return csvOf(rows, REPORT_LABELS[name]); });
}

// ── Route table ───────────────────────────────────────────────────────────
function viaRpc(fn) {
  return function (d, route) { return rpc(fn, { d: d || {} }, histHeaders(route, d)); };
}
function pick(d, keys) {
  var out = {};
  keys.forEach(function (k) { if (d[k] !== undefined) out[k] = d[k]; });
  return out;
}
var ROUTES = {
  "bootstrap": function () {
    return rpc("api_bootstrap", {});
  },
  "order": viaRpc("api_order_create"),
  "order/ingest": viaRpc("api_order_ingest"),
  "internal-order": viaRpc("api_internal_order_add"),
  "order/transfer": viaRpc("api_transfer_order_add"),
  "order/update": viaRpc("api_order_update"),
  "order/route": viaRpc("api_order_route_save"),
  "order/cancel": viaRpc("api_order_cancel"),
  "order/copy": viaRpc("api_order_copy"),
  "order/delete": function (d, route) {
    return rpc("api_order_delete", { d: d }, histHeaders(route, d)).then(function (r) {
      return storageRemove(r.storage_paths).then(function () { return { id: r.id }; });
    });
  },
  "order/bill": function (d, route) {
    var billed = d.billed === undefined ? true : !!d.billed;
    return rest("PATCH", "orders?id=eq." + encodeURIComponent(d.id) + "&select=id,billed_at",
                { billed_at: billed ? new Date().toISOString() : null }, histHeaders(route, d)).then(one);
  },

  // Documents: the RPC owns the row + D7 matching; the bytes go to Storage.
  "document": function (d, route) {
    var meta = Object.assign({}, d); delete meta.b64;
    return rpc("api_document_save", { d: meta }, histHeaders(route, d)).then(function (row) {
      var type = mimeFor(row.original_filename);
      return storageUpload(row.storage_path, blobFromB64(d.b64 || "", type), type).then(function () { return row; },
        function (err) {
          // Compensate: never leave a documents row pointing at no file.
          return rest("DELETE", "documents?id=eq." + row.id, undefined, histHeaders(route, d), "return=minimal")
            .then(function () { throw err; }, function () { throw err; });
        });
    });
  },
  "document/attach": function (d, route) {
    var doc = findById(dbNow().documents, d.id);
    var from = doc && doc.storage_path;
    var get = from ? Promise.resolve(from)
      : rest("GET", "documents?id=eq." + encodeURIComponent(d.id) + "&select=storage_path").then(function (rows) {
          if (!rows || !rows.length) throw new Error("document not found");
          return rows[0].storage_path;
        });
    return get.then(function (oldPath) {
      var newPath = d.order_id + "/" + oldPath.split("/").pop();
      var moved = newPath === oldPath ? Promise.resolve(false) : storageMove(oldPath, newPath).then(function () { return true; });
      return moved.then(function (didMove) {
        return rpc("api_document_attach", { d: Object.assign({}, d, { storage_path: newPath }) }, histHeaders(route, d))
          .catch(function (err) {
            if (!didMove) throw err;
            return storageMove(newPath, oldPath).then(function () { throw err; }, function () { throw err; });
          });
      });
    });
  },
  "document/delete": function (d, route) {
    return rpc("api_document_delete", { d: d }, histHeaders(route, d)).then(function (r) {
      return storageRemove([r.storage_path]).then(function () { return { ok: true, id: r.id }; });
    });
  },
  "create-draft": function () {
    return Promise.reject(new Error("Outlook drafts are not part of the hosted app."));
  },

  "schedule": viaRpc("api_schedule"),
  "load/carrier": viaRpc("api_load_carrier"),
  "cell/color": viaRpc("api_cell_color"),
  "cell/format": viaRpc("api_cell_format"),
  "truck/off": viaRpc("api_truck_off"),
  "unschedule": viaRpc("api_unschedule"),
  "day-note": viaRpc("api_day_note"),
  "category": viaRpc("api_category"),
  "freight": viaRpc("api_freight"),
  "internal-freight-rate": viaRpc("api_internal_freight_rate_save"),
  "internal-freight-rate/calculate": viaRpc("api_internal_freight_rate_calculate"),
  "sync-delivery-dates": viaRpc("api_sync_delivery_dates"),
  "motive/sync-miles": function (d, route) { return edgeFunction("motive-sync", d, histHeaders(route, d)); },
  "sheets/push-driver-tabs": function (d, route) {
    return edgeFunction("sheets-push", d, histHeaders(route, d, d && d.confirm ? { "x-dept12-external": "1" } : {}));
  },

  // Fleet / directory
  "driver": function (d, route) {
    return rest("POST", "drivers", { full_name: d.full_name, color: d.color === undefined ? null : d.color },
                histHeaders(route, d)).then(one);
  },
  "truck": viaRpc("api_truck_add"),
  "assign-truck": viaRpc("api_assign_truck"),
  "truck/driver": viaRpc("api_truck_driver"),
  "location": function (d, route) {
    return rest("POST", "locations",
      pick(d, ["name", "address", "city", "state", "phone", "appointment_note", "notes"]),
      histHeaders(route, d)).then(one);
  },
  "department": function (d, route) {
    return rest("POST", "departments", { name: d.name }, histHeaders(route, d)).then(one);
  },
  "customer": viaRpc("api_customer_add"),

  // Database grids, custom databases, in-app sheets (not Google Sheets)
  "row": viaRpc("api_row_update"),
  "row/custom": viaRpc("api_row_custom"),
  "grid/cell-fmt": viaRpc("api_grid_cell_fmt"),
  "grid/column": viaRpc("api_grid_column_add"),
  "grid/column/update": viaRpc("api_grid_column_update"),
  "grid/column/delete": viaRpc("api_grid_column_delete"),
  "entity": viaRpc("api_entity_create"),
  "entity/update": viaRpc("api_entity_update"),
  "entity/delete": viaRpc("api_entity_delete"),
  "field": viaRpc("api_field_create"),
  "field/update": viaRpc("api_field_update"),
  "field/rename-option": viaRpc("api_field_rename_option"),
  "field/delete": viaRpc("api_field_delete"),
  "record": viaRpc("api_record_create"),
  "record/update": viaRpc("api_record_update"),
  "record/delete": function (d, route) {
    return rest("DELETE", "records?id=eq." + encodeURIComponent(d.id), undefined, histHeaders(route, d), "return=minimal")
      .then(function () { return { ok: true }; });
  },
  "grid/row": viaRpc("api_grid_row_add"),
  "grid/row/delete": viaRpc("api_grid_row_delete"),
  "database/archive": viaRpc("api_database_archive"),
  "grid/row/reorder": viaRpc("api_grid_row_reorder"),
  "sheet": viaRpc("api_sheet"),
  "sheet/cell": viaRpc("api_sheet_cell"),

  // Settings
  "admin/order-number-settings": viaRpc("api_order_number_settings_save"),

  // History and reports
  "history": function (d, route, q) {
    return rpc("api_history_list", { p_limit: parseInt(q.limit || "60", 10),
                                     p_before: q.before ? parseInt(q.before, 10) : null });
  },
  "history/preview": function (d) { return rpc("api_history_preview", { d: d }); },
  "history/revert": function (d) { return rpc("api_history_revert", { d: d }); }
};

// The single entry point app.js uses (unchanged signature from the Python era).
function api(path, body) {
  var qi = path.indexOf("?"), route = qi < 0 ? path : path.slice(0, qi), q = {};
  if (qi >= 0) new URLSearchParams(path.slice(qi + 1)).forEach(function (v, k) { q[k] = v; });
  if (route.indexOf("report/") === 0) {
    return buildReport(route.slice(7), q.from, q.to).then(function (csv) { return { csv: csv }; });
  }
  var fn = ROUTES[route];
  if (!fn) return Promise.reject(new Error("no route /api/" + route));
  return Promise.resolve().then(function () { return fn(body || {}, route, q); });
}

// ── Login gate ────────────────────────────────────────────────────────────
var LOCAL_AUTH = { enabled: true, user: null };
function localAuthCheck() {
  if (!SB_URL || !SB_KEY) {
    document.querySelector("#main").innerHTML = '<div class="empty"><b>Not connected to Supabase yet.</b><br>' +
      'Fill in <span class="kbd">config.js</span> with your project URL and publishable key — see SETUP.md.</div>';
    return new Promise(function () {});
  }
  LOCAL_AUTH.user = SESSION ? { username: (SESSION.user && SESSION.user.email) || "Signed in" } : null;
  return Promise.resolve(LOCAL_AUTH);
}
function localLogout() {
  var tok = SESSION && SESSION.access_token;
  saveSession(null);
  if (!tok) return Promise.resolve();
  return fetch(SB_URL + "/auth/v1/logout", { method: "POST", headers: { "apikey": SB_KEY, "Authorization": "Bearer " + tok } })
    .catch(function () {});
}
function renderLoginGate() {
  var main = document.querySelector("#main") || document.body;
  document.body.classList.add("pre-auth");
  main.innerHTML = '<div class="login-gate"><div class="login-card">' +
    '<div class="brand" aria-label="Dept 12 Flatbed Trucking">' +
    '<span class="brand-mark"><img src="rexius-logo.png" alt="Rexius"></span>' +
    '<span class="brand-copy"><b>Dept 12</b><span>Flatbed Trucking</span></span></div>' +
    '<h2>Sign in</h2>' +
    '<p>Sign in with your Dept 12 account.</p>' +
    '<input id="login-email" type="email" autocomplete="username" placeholder="Email">' +
    '<input id="login-password" type="password" autocomplete="current-password" placeholder="Password">' +
    '<button class="btn pri" id="login-go">Continue</button>' +
    '<div id="login-err" class="login-err"></div></div></div>';
  var go = function () {
    var email = (document.querySelector("#login-email").value || "").trim();
    var pw = document.querySelector("#login-password").value || "";
    if (!email || !pw) return;
    document.querySelector("#login-err").textContent = "";
    authRequest("token?grant_type=password", { email: email, password: pw }).then(function (j) {
      saveSession(sessionFrom(j));
      location.reload();
    }).catch(function (e) { document.querySelector("#login-err").textContent = e.message; });
  };
  document.querySelector("#login-go").addEventListener("click", go);
  ["#login-email", "#login-password"].forEach(function (sel) {
    document.querySelector(sel).addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
  });
  document.querySelector("#login-email").focus();
}
var dashboardAuth = {
  config: { enabled: true, outlookEnabled: false },
  initialize: function () { return Promise.resolve({ configured: true, session: SESSION }); },
  user: function () { return SESSION && SESSION.user; },
  session: function () { return SESSION; },
  signOut: localLogout
};

// Globals app.js relies on.
window.api = api;
window.dashboardAuth = dashboardAuth;
window.LOCAL_AUTH = LOCAL_AUTH;
window.localAuthCheck = localAuthCheck;
window.localLogout = localLogout;
window.renderLoginGate = renderLoginGate;
window.storedFileUrl = storedFileUrl;
window.fetchStoredFile = fetchStoredFile;
})();

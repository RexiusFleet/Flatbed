#!/usr/bin/env node
// LOCAL TESTING ONLY — drives the real supabase-api.js (the same code the
// browser runs) against dev/local-supabase.mjs and checks each ported route.
// Mutates the scratch test database it points at; never run it against a
// real project.
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const BASE = process.env.BASE || "http://localhost:8790";
const cfgJs = await (await fetch(BASE + "/config.js")).text();
const store = new Map();
const g = {
  window: null, fetch, URLSearchParams, Blob, atob, btoa, console, setTimeout, Promise, JSON, Object, Array,
  localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
  document: { addEventListener() {}, querySelector: () => null },
  location: { reload() {} },
};
g.window = g;
vm.createContext(g);
vm.runInContext(cfgJs, g);
vm.runInContext(fs.readFileSync(new URL("../supabase-api.js", import.meta.url), "utf8"), g);

// sign in with the local test account
const tok = await (await fetch(BASE + "/auth/v1/token?grant_type=password", {
  method: "POST", headers: { apikey: g.DEPT12_CONFIG.supabaseKey, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "dispatch@example.test", password: "local-test-password" }),
})).json();
g.localStorage.setItem("dept12-supabase-session", JSON.stringify(tok));
vm.runInContext(fs.readFileSync(new URL("../supabase-api.js", import.meta.url), "utf8"), g);  // reload w/ session
const api = g.api;
let DB = await api("bootstrap");
g.DEPT12_DB = () => DB;
const reload = async () => { DB = await api("bootstrap"); };

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log("  ok  ", name); }
  catch (e) { console.log("  FAIL", name, "—", e.message); process.exitCode = 1; }
}
const expectError = async (p, re) => {
  try { await p; } catch (e) { assert.match(e.message, re); return; }
  throw new Error("expected an error matching " + re);
};

await t("bootstrap shape", async () => {
  for (const k of ["drivers", "trucks", "parties", "locations", "orders", "loads", "notes", "categories",
                   "documents", "entities", "fields", "order_number_settings", "day_notes", "me"]) assert.ok(k in DB, k);
  assert.ok(DB.orders.length > 0 && DB.trucks.length > 0);
  assert.equal(DB.me.is_admin, true);
});

const truck = DB.trucks[0];
const future = "2031-03-04";       // a Tuesday, far from real data
const RUN = Date.now().toString(36).slice(-5);   // keeps unique-constrained test values distinct per run
let ext;
await t("create external order + edit (simple stops sync)", async () => {
  ext = await api("order", { kind: "external" });
  const loc = DB.locations.find((l) => !l.party_id);
  const upd = await api("order/update", { id: ext.id, po_number: "PO-1", pickup_location_id: loc.id, solomon_order_no: "12-0331-" + String(Date.now()).slice(-4) });
  assert.equal(upd.po_number, "PO-1");
  assert.equal(upd.department, DB.order_number_settings.external_department);
  await reload();
  const stops = DB.order_stops.filter((s) => s.order_id === ext.id).sort((a, b) => a.sequence - b.sequence);
  assert.equal(stops.length, 2); assert.equal(stops[0].reference_number, "PO-1"); assert.equal(stops[0].location_id, loc.id);
});

await t("schedule: place, move, note blocks, clear keeps fmt", async () => {
  const l1 = await api("schedule", { truck_id: truck.id, date: future, slot: 1, order_id: ext.id });
  assert.equal(l1.truck_id, truck.id);
  const l2 = await api("schedule", { truck_id: truck.id, date: future, slot: 2, order_id: ext.id });
  await reload();
  assert.equal(DB.loads.filter((l) => l.order_ids.includes(ext.id)).length, 1, "one load per order");
  const ls = DB.load_stops.filter((s) => s.load_id === l2.id);
  assert.equal(ls.length, 2, "load stops synced");
  await api("schedule", { truck_id: truck.id, date: future, slot: 3, action: "note", body: "shop day" });
  await api("cell/format", { truck_id: truck.id, date: future, slot: 3, patch: { fill: "#ff0000" } });
  await api("schedule", { truck_id: truck.id, date: future, slot: 3, action: "clear" });
  await reload();
  const n = DB.notes.find((x) => x.truck_id === truck.id && x.scheduled_date === future && x.slot === 3);
  assert.ok(n && n.body === "" && n.fmt.fill === "#ff0000", "clear keeps formatting (D82)");
  const cc = await api("cell/color", { truck_id: truck.id, date: future, slot: 2, category_id: DB.categories[0].id });
  assert.equal(cc.on, "load");
});

await t("drop onto a text note replaces it (D250)", async () => {
  await api("schedule", { truck_id: truck.id, date: future, slot: 4, action: "note", body: "replace me" });
  await api("schedule", { truck_id: truck.id, date: future, slot: 4, order_id: ext.id });
  await reload();
  assert.ok(!DB.notes.find((x) => x.truck_id === truck.id && x.scheduled_date === future && x.slot === 4));
});

await t("history: list + revert the D250 move/replace event", async () => {
  const h = await api("history?limit=10");
  const ev = h.events[0];
  assert.equal(ev.label, "Edit schedule");
  assert.equal(ev.actor_name, "dispatch@example.test");
  assert.equal(ev.section, "dispatch");
  const p = await api("history/preview", { event_id: ev.id });
  assert.equal(p.can_apply, true);
  const r = await api("history/revert", { event_id: ev.id, baseline_sequence: p.baseline_sequence });
  assert.ok(r.change_count >= 3);
  await reload();
  const back = DB.loads.find((l) => l.order_ids.includes(ext.id));
  assert.equal(back.slot, 2, "load back at its original cell");
  assert.ok(DB.notes.find((x) => x.truck_id === truck.id && x.scheduled_date === future && x.slot === 4 && x.body === "replace me"), "note restored");
  const h2 = await api("history?limit=3");
  assert.match(h2.events[0].label, /^Reverted: Edit schedule/);
});

await t("outside-carrier lane (D115/D122)", async () => {
  await api("load/carrier", { order_id: ext.id, date: future, slot: 1 });
  await expectError(api("load/carrier", { order_id: ext.id, carrier_cost: 100 }), /carrier name before a cost/);
  const r = await api("load/carrier", { order_id: ext.id, carrier_name: "Smoke Test Carrier", carrier_cost: 250 });
  assert.equal(+r.carrier_cost, 250);
  const cleared = await api("load/carrier", { order_id: ext.id, carrier_name: "" });
  assert.equal(cleared.carrier_party_id, null); assert.equal(cleared.carrier_cost, null);
  await api("unschedule", { order_id: ext.id });
});

await t("bag order numbering continues the month sequence (D217/D233)", async () => {
  const r1 = await api("internal-order", { month: "032031", count: 3 });
  assert.equal(r1.created, 3);
  const pat = DB.order_number_settings.internal_pattern;
  assert.equal(r1.first, pat.replace("{MM}", "03").replace("{YY}", "31").replace("{YYYY}", "2031").replace(/\{(#+)\}/, (m, h) => String(r1.start).padStart(h.length, "0")));
  const r2 = await api("internal-order", { month: "032031", count: 1 });
  assert.equal(r2.start, r1.start + 3);
  await expectError(api("internal-order", { month: "132031" }), /valid month/);
});

await t("pattern validation messages", async () => {
  await expectError(api("admin/order-number-settings", { internal_pattern: "07-{MM}", external_pattern: "12", internal_department: "07", external_department: "12" }), /one number block/);
  await expectError(api("admin/order-number-settings", { internal_pattern: "07-{QQ}{###}", external_pattern: "12", internal_department: "07", external_department: "12" }), /Available date fields/);
});

await t("freight: typed miles auto-price, typed $ wins (D187)", async () => {
  await api("internal-freight-rate", { rate_per_mile: 2.5, minimum_charge: 100 });
  const bag = (await api("internal-order", { month: "032031", count: 1 })).orders[0];
  const f1 = await api("freight", { order_id: bag.id, miles: 30 });
  assert.equal(+f1.internal_freight_amount, 100, "minimum binds");
  assert.equal(f1.miles_adjusted, true);
  await api("freight", { order_id: bag.id, freight_amount: 77 });
  const f2 = await api("freight", { order_id: bag.id, miles: 80 });
  assert.equal(+f2.internal_freight_amount, 77, "never overwrites a typed $");
  const calc = await api("internal-freight-rate/calculate", {});
  assert.ok(typeof calc.filled === "number");
});

await t("copy / cancel / delete guards (D30/D93/D29)", async () => {
  const cp = await api("order/copy", { order_id: ext.id });
  assert.equal(cp.solomon_order_no, null); assert.equal(cp.po_number, "PO-1");
  const delivered = DB.orders.find((o) => o.delivered_at && !o.billed_at);
  await expectError(api("order/cancel", { id: delivered.id }), /delivered and locked/);
  const billed = DB.orders.find((o) => o.billed_at);
  if (billed) await expectError(api("order/delete", { id: billed.id }), /billed\/invoiced and locked/);
  const c = await api("order/cancel", { id: cp.id }); assert.equal(c.stage, "cancelled");
  const rs = await api("order/cancel", { id: cp.id, cancelled: false }); assert.equal(rs.stage, "ordered");
  const del = await api("order/delete", { id: cp.id }); assert.equal(del.id, cp.id);
});

await t("custom route editor (D108)", async () => {
  const locs = DB.locations.filter((l) => !l.party_id).slice(0, 3);
  const r = await api("order/route", { order_id: ext.id, route_mode: "custom", stops: [
    { stop_type: "pickup", location_id: locs[0].id, reference_number: "A" },
    { stop_type: "delivery", location_id: locs[1].id, reference_number: "B", pallet_count: 3 },
    { stop_type: "delivery", location_id: locs[2].id, reference_number: "C" }] });
  assert.equal(r.route_mode, "custom"); assert.equal(r.delivery_location_id, locs[2].id); assert.equal(r.delivery_number, "C");
  await expectError(api("order/route", { order_id: ext.id, stops: [{ stop_type: "pickup" }] }), /2–20 stops/);
});

await t("documents: save → private storage → attach (moves object) → view → delete guard", async () => {
  const b64 = Buffer.from("%PDF-1.4 smoke").toString("base64");
  const doc = await api("document", { doc_type: "pod", filename: "smoke test #1.pdf", b64, extracted_fields: {} });
  assert.equal(doc.matched_by, "unmatched"); assert.match(doc.storage_path, /^unmatched\/.+_smoke test _1\.pdf$/);
  await reload();
  const att = await api("document/attach", { id: doc.id, order_id: ext.id });
  assert.ok(att.storage_path.startsWith(ext.id + "/"));
  const bytes = await (await g.fetchStoredFile(att.storage_path)).text();
  assert.equal(bytes, "%PDF-1.4 smoke");
  const url = await g.storedFileUrl(att.storage_path);
  assert.equal(await (await fetch(url)).text(), "%PDF-1.4 smoke", "signed URL serves the file");
  await expectError(api("document/delete", { id: doc.id }), /Only unmatched documents/);
  const loose = await api("document", { doc_type: "other", filename: "loose.pdf", b64 });
  const d = await api("document/delete", { id: loose.id }); assert.equal(d.ok, true);
});

await t("filename matching cascade (D7)", async () => {
  const known = DB.orders.find((o) => o.broker_load_no && /^\d{5,9}$/.test(o.broker_load_no));
  if (!known) return;
  const b64 = Buffer.from("x").toString("base64");
  const doc = await api("document", { doc_type: "rate_con", filename: `RC ${known.broker_load_no}.pdf`, b64 });
  assert.equal(doc.matched_by, "filename");
  assert.equal(doc.order_id, known.id);
  await api("document/attach", { id: doc.id, order_id: known.id });
});

await t("database grids: row edit, custom field, archive, reorder, fmt", async () => {
  const fleetTruck = DB.trucks[DB.trucks.length - 1];
  const r = await api("row", { table: "trucks", id: fleetTruck.id, equipment_type: "BT" });
  assert.equal(r.equipment_type, "BT");
  await api("row", { table: "trucks", id: fleetTruck.id, equipment_type: fleetTruck.eq });
  const bag = DB.locations.find((l) => l.party_id && l.category_id);
  const lr = await api("row", { table: "locations", id: bag.id, category_id: bag.category_id });
  assert.ok(["early", "anytime", null].includes(lr.timing_window));
  const cu = await api("row/custom", { table: "trucks", id: fleetTruck.id, key: "c_smoke", value: "yes" });
  assert.equal(cu.custom.c_smoke, "yes");
  await api("row/custom", { table: "trucks", id: fleetTruck.id, key: "c_smoke", value: "" });
  await api("grid/cell-fmt", { table: "trucks", id: fleetTruck.id, field: "number", fmt: { bold: true } });
  await api("grid/cell-fmt", { table: "trucks", id: fleetTruck.id, field: "number", fmt: { bold: null } });
  const dept = DB.departments[0];
  const a = await api("database/archive", { grid: "departments", id: dept.id, archived: true });
  assert.ok(a.archived_at);
  await api("database/archive", { grid: "departments", id: dept.id, archived: false });
  await expectError(api("grid/row/delete", { grid: "bagger", id: dept.id }), /Archive Selected/);
  const ids = DB.trucks.map((x) => x.id);
  const ro = await api("grid/row/reorder", { grid: "fleet", row_ids: ids });
  assert.equal(ro.count, ids.length);
  await expectError(api("grid/row/reorder", { grid: "fleet", row_ids: ids.slice(1) }), /rows changed/);
});

await t("custom databases + in-app sheets", async () => {
  const ent = await api("entity", { name: "Smoke DB" });
  const f = await api("field", { entity_id: ent.id, label: "Note #" });
  assert.equal(f.key, "note");
  const f2 = await api("field", { entity_id: ent.id, label: "Note" });
  assert.equal(f2.key, "note_2");
  const rec = await api("record", { entity_id: ent.id });
  const ru = await api("record/update", { id: rec.id, field_id: f.id, value: "hi" });
  assert.equal(ru.data[f.id], "hi");
  await api("field/update", { id: f.id, label: "Renamed", options: ["a", "b"] });
  await api("record/delete", { id: rec.id });
  await api("entity/delete", { id: ent.id });
  const sh = await api("sheet", { name: "Smoke sheet" });
  await api("sheet/cell", { sheet_id: sh.id, r: 1, c: 1, value: "x", fmt: { bold: true } });
  await api("sheet", { id: sh.id, name: "Renamed sheet" });
  await api("sheet", { id: sh.id, delete: true });
  const col = await api("grid/column", { grid: "fleet", label: "Smoke Col" });
  assert.match(col.key, /^c_smoke_col/);
  await api("grid/column/delete", { id: col.id });
});

await t("fleet: add truck, assign driver by name twice same day", async () => {
  const tr = await api("truck", { number: "SMOKE-" + RUN, eq: "F" });
  await api("truck/driver", { truck_id: tr.id, driver_name: "Smoke Driver" });
  await api("truck/driver", { truck_id: tr.id, driver_name: "Smoke Driver Two" });
  await api("truck/driver", { truck_id: tr.id, driver_name: "" });
  await api("grid/row/delete", { grid: "fleet", id: tr.id });
});

await t("day note + truck off + category", async () => {
  await api("day-note", { note_date: future, text: "smoke" });
  await api("day-note", { note_date: future, text: "" });
  await api("truck/off", { truck_id: truck.id, off_date: future });
  await api("truck/off", { truck_id: truck.id, off_date: future, on: false });
  const c = await api("category", { name: "Smoke", color: "#123456" });
  await api("category", { id: c.id, delete: true });
});

await t("directory adds (REST routes)", async () => {
  const loc = await api("location", { name: "Smoke Yard " + RUN, city: "Eugene", state: "OR", junk_field: 1 });
  assert.equal(loc.city, "Eugene");
  const dp = await api("department", { name: "Smoke Dept " + RUN, other: "x" });
  assert.equal(dp.name, "Smoke Dept " + RUN);
  const cust = await api("customer", { kind: "bagger", name: "Smoke Bagger " + RUN, city: "Salem", category_id: DB.categories.find((x) => /early/i.test(x.name))?.id });
  assert.equal(cust.is_customer, true);
  const drv = await api("driver", { full_name: "Smoke Solo " + RUN });
  assert.equal(drv.full_name, "Smoke Solo " + RUN);
  const bill = await api("order/bill", { id: ext.id, billed: true });
  assert.ok(bill.billed_at);
  await api("order/bill", { id: ext.id, billed: false });
});

await t("driver-tab push: dry run works, confirm needs the Google secret", async () => {
  const pv = await api("sheets/push-driver-tabs", { start_date: "2026-09-21", days: 5 });
  assert.equal(pv.dry_run, true); assert.equal(pv.days, 5);
  await expectError(api("sheets/push-driver-tabs", { start_date: "2026-09-21", days: 5, confirm: true }), /GOOGLE_SERVICE_ACCOUNT_JSON/);
});

await t("motive sync needs the Motive secret", async () => {
  await expectError(api("motive/sync-miles", {}), /MOTIVE_API_KEY/);
});

await t("reports export CSV", async () => {
  for (const r of ["orders", "loads", "customers", "brokers", "fleet", "dump", "mileage"]) {
    const j = await api("report/" + r + (r === "dump" ? "?from=2026-01-01&to=2026-12-31" : ""));
    assert.ok(j.csv.length > 0, r);
  }
});

await t("sync delivery dates", async () => {
  const s = await api("sync-delivery-dates", {});
  assert.ok(typeof s.synced === "number");
});

await t("no access without a login (anon key only)", async () => {
  const r = await fetch(BASE + "/rest/v1/orders?select=id&limit=1", { headers: { apikey: g.DEPT12_CONFIG.supabaseKey } });
  const body = await r.json();
  assert.ok(r.status === 401 || (Array.isArray(body) && body.length === 0) || body.code === "42501", "anon read blocked: " + JSON.stringify(body).slice(0, 120));
  const f = await fetch(BASE + "/rest/v1/rpc/api_bootstrap", { method: "POST", headers: { apikey: g.DEPT12_CONFIG.supabaseKey, "Content-Type": "application/json" }, body: "{}" });
  assert.ok(!f.ok, "anon rpc blocked");
  const h = await fetch(BASE + "/rest/v1/audit_events?select=id", { headers: { apikey: g.DEPT12_CONFIG.supabaseKey, Authorization: "Bearer " + tok.access_token } });
  assert.ok(!h.ok, "audit tables not directly readable even when signed in");
});

console.log(`\n${passed} passed${process.exitCode ? ", SOME FAILED" : ""}`);

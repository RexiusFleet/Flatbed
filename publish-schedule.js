/* Dept 12 Dashboard - "Publish Schedule": builds what drivers and the bag plant see.
 *
 * Runs in the browser. Dept12BuildSchedule(d, rpc) reads the schedule window
 * (driver_week_dates / driver_week_data through rpc) and returns the payload
 * the driver and bag plant pages draw. Publishing saves it (supabase-api.js).
 * Nothing here talks to Google any more.
 *
 * The week-building half was converted from the retired sheets-push Edge Function's
 * payload.ts (kept in archive/, local only), so the dashboard's Driver Tabs view and
 * what drivers see stay column-for-column identical.
 */
(function () {
"use strict";

/* === Week payload (converted from payload.ts) ================================ */
const LEGEND_COLORS = {
  "early|false": "#D9EAD3",
  // green  — Early Store
  "anytime|false": "#FFF2CC",
  // yellow — Anytime
  "early|true": "#F1C232",
  // dark yellow — Early EAST
  "anytime|true": "#783F04"
  // brown  — Anytime EAST
};
const DARK_FILLS = /* @__PURE__ */ new Set(["#783F04", "#FF0000"]);
const TRUCK_OFF_COLOR = "#000000";
const s = (v) => (v === null || v === void 0 ? "" : String(v)).trim();
function pyRound(x) {
  const f = Math.floor(x), diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}
function pyQuote(q) {
  return encodeURIComponent(q).replace(/%2F/g, "/").replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
function fmtLocation(name, address, city, state, phone) {
  const citystate = [s(city), s(state)].filter(Boolean).join(" ");
  return [s(name), s(address), citystate, s(phone)].filter(Boolean).join(", ");
}
function internalChipText(o, pallets = null) {
  const customer = o.customer_name || "(no customer)";
  const citystate = [s(o.cust_city), s(o.cust_state)].filter(Boolean).join(" ");
  const info = citystate + (o.cust_forklift ? " - " + o.cust_forklift : "");
  let orderLine = o.rexius_order_no || "(no order #)";
  if (pallets !== null && pallets !== void 0) orderLine += ` - ${pallets} PAL`;
  return [customer, info.trim(), orderLine].filter(Boolean).join("\n");
}
function transferChipText(o) {
  return [o.driver_note, o.transfer_department_name || "(no department)"].filter(Boolean).join("\n");
}
function driverChipText(o, pallets, stops) {
  if (o.is_transfer) return transferChipText(o);
  if (o.kind === "external") {
    const header = `${o.broker_name || "(no broker)"} - Rexius Order: ${o.rexius_order_no || ""} | Load: ${o.broker_load_no || ""}`;
    if (o.route_mode === "custom" && stops.length) {
      const lines = [header];
      for (const stop of stops) {
        const label = stop.stop_type === "pickup" ? "PICK" : "DROP";
        const ref = s(stop.reference_number);
        const address = fmtLocation(stop.name, stop.address, stop.city, stop.state, stop.phone);
        let line = `${stop.sequence}. ${label}: ${ref} | ${address}`;
        const extras = [stop.notes];
        if (stop.scheduled_at) extras.unshift("APPT " + stop.scheduled_at_label);
        if (stop.pallet_count !== null && stop.pallet_count !== void 0) extras.unshift(`${stop.pallet_count} PAL`);
        if (extras.some(Boolean)) line += " \u2014 " + extras.filter(Boolean).join(" \xB7 ");
        lines.push(line);
      }
      return lines.join("\n\n");
    }
    const pick = "PICK: " + fmtLocation(o.pickup_name, o.pickup_address, o.pickup_city, o.pickup_state, o.pickup_phone);
    const drop = "DROP: " + fmtLocation(o.delivery_name, o.delivery_address, o.delivery_city, o.delivery_state, o.delivery_phone);
    return [header, pick, drop].join("\n\n");
  }
  return internalChipText(o, pallets);
}
function currentWeekChipText(o, stops) {
  const loc = (name, city, state) => {
    const citystate = [s(city), s(state)].filter(Boolean).join(" ");
    return [s(name), citystate].filter(Boolean).join(", ");
  };
  if (o.is_transfer) return transferChipText(o);
  if (o.kind === "external") {
    const header = `${o.broker_name || "(no broker)"} - Load: ${o.broker_load_no || ""}`;
    if (o.route_mode === "custom" && stops.length) {
      const stopLines2 = [];
      stops.forEach((stop, i) => {
        const label = stop.stop_type === "pickup" ? "PICK" : "DROP";
        const place = loc(stop.name, stop.city, stop.state);
        if (place) stopLines2.push(`${i + 1}. ${label}: ${place}`);
      });
      return stopLines2.length ? [header, stopLines2.join("\n")].join("\n\n") : header;
    }
    const pick = loc(o.pickup_name, o.pickup_city, o.pickup_state);
    const drop = loc(o.delivery_name, o.delivery_city, o.delivery_state);
    const stopLines = [];
    if (pick) stopLines.push("PICK: " + pick);
    if (drop) stopLines.push("DROP: " + drop);
    return stopLines.length ? [header, stopLines.join("\n")].join("\n\n") : header;
  }
  return internalChipText(o, o.pallet_count);
}
function hexToRgb01(h) {
  let x = (h || "").replace(/^#+/, "");
  if (x.length === 8) x = x.slice(0, 6);
  if (x.length !== 6) return null;
  return {
    red: parseInt(x.slice(0, 2), 16) / 255,
    green: parseInt(x.slice(2, 4), 16) / 255,
    blue: parseInt(x.slice(4, 6), 16) / 255
  };
}
function lightenHex(h, whiteMix = 0.78) {
  let x = (h || "").replace(/^#+/, "");
  if (x.length === 8) x = x.slice(0, 6);
  if (x.length !== 6) return null;
  return "#" + [0, 2, 4].map((i) => {
    const v = parseInt(x.slice(i, i + 2), 16);
    return pyRound(v + (255 - v) * whiteMix).toString(16).toUpperCase().padStart(2, "0");
  }).join("");
}
function chipFill(o, driverColor) {
  if (o.is_transfer) return o.transfer_department_color || null;
  if (o.kind === "external") return driverColor ? lightenHex(driverColor) : null;
  return LEGEND_COLORS[`${o.cust_timing}|${!!o.cust_umatilla}`] || null;
}
function buildPayload(dates, data) {
  const inRange = new Set(dates);
  const notesByKey = /* @__PURE__ */ new Map();
  for (const n of data.notes) notesByKey.set(`${n.truck_id}|${n.scheduled_date}|${n.slot}`, n);
  const offByKey = new Set(data.off_days.map((o) => `${o.truck_id}|${o.off_date}`));
  const orders = new Map(data.orders.map((o) => [o.id, o]));
  const stopsByLoad = /* @__PURE__ */ new Map();
  for (const st of data.stops) {
    if (!stopsByLoad.has(st.load_id)) stopsByLoad.set(st.load_id, []);
    stopsByLoad.get(st.load_id).push(st);
  }
  const byTruck = /* @__PURE__ */ new Map();
  for (const l of data.loads) {
    if (!byTruck.has(l.truck_id)) byTruck.set(l.truck_id, /* @__PURE__ */ new Map());
    const days = byTruck.get(l.truck_id);
    if (!days.has(l.scheduled_date)) days.set(l.scheduled_date, /* @__PURE__ */ new Map());
    days.get(l.scheduled_date).set(l.slot, l);
  }
  const truckRows = (t, compact = false) => {
    var _a;
    const truckLoads = byTruck.get(t.truck_id) || /* @__PURE__ */ new Map();
    const out = [];
    for (const dt of dates) {
      if (!inRange.has(dt)) continue;
      const dayLoads = truckLoads.get(dt) || /* @__PURE__ */ new Map();
      for (let slot = 1; slot <= 3; slot++) {
        const ld = dayLoads.get(slot);
        const row = {
          date: dt,
          slot,
          chip: "",
          notes: "",
          pickup: "",
          drop: "",
          store_map: "",
          color: null,
          po_number: "",
          delivery_number: ""
        };
        const oid = ld && ld.order_ids && ld.order_ids.length ? ld.order_ids[0] : null;
        const o = oid ? orders.get(oid) : null;
        if (o) {
          const routeStops = ld ? stopsByLoad.get(ld.id) || [] : [];
          row.chip = compact ? currentWeekChipText(o, routeStops) : driverChipText(o, o.pallet_count, routeStops);
          row.color = chipFill(o, t.driver_color);
          if (!compact) {
            if (o.kind === "external") {
              row.po_number = o.po_number || "";
              row.delivery_number = o.delivery_number || "";
              // Map links are not sent any more: drivers see the address as text.
            }
            row.notes = [o.driver_note, o.customer_notes].filter(Boolean).join(" \xB7 ");
          }
        } else if (!ld) {
          if (offByKey.has(`${t.truck_id}|${dt}`)) {
            row.chip = "OFF";
            row.color = TRUCK_OFF_COLOR;
            row.off = true;
            out.push(row);
            continue;
          }
          const note = notesByKey.get(`${t.truck_id}|${dt}|${slot}`);
          if (note && note.body) {
            row.chip = note.body;
            const fill = (note.fmt || {}).fill;
            row.color = fill ? fill : (_a = note.cat_color) != null ? _a : null;
          }
        }
        out.push(row);
      }
    }
    return out;
  };
  const drivers = data.trucks.map((t) => ({
    driver: t.driver_name,
    truck: t.number,
    equipment_type: t.eq,
    driver_color: t.driver_color,
    truck_id: t.truck_id,
    rows: truckRows(t)
  }));
  const currentWeek = data.trucks.map((t) => ({
    header: [t.driver_name, t.number, t.eq].filter(Boolean).join(" "),
    driver: t.driver_name,
    truck: t.number,
    equipment_type: t.eq,
    driver_color: t.driver_color,
    truck_id: t.truck_id,
    rows: truckRows(t, true)
  }));
  return {
    week_start: dates[0],
    week_end: dates[dates.length - 1],
    days: dates.length,
    slots_per_day: 3,
    dates,
    drivers,
    current_week: currentWeek
  };
}
async function push(d, rpc) {
  var start = d.start_date || null;
  if (start !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(start))) throw new Error("start_date must be YYYY-MM-DD");
  var dates = await rpc("driver_week_dates", { p_start: start, p_count: parseInt(d.days == null ? 3 : d.days, 10) || 3 });
  var data = await rpc("driver_week_data", { p_from: dates[0], p_to: dates[dates.length - 1] });
  return buildPayload(dates, data);
}

window.Dept12BuildSchedule = push;
})();

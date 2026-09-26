/* Dept 12 Dashboard — "Update Google Schedule" (driver mirror sheet push).
 *
 * Runs in the browser. Whoever pushes signs in with their own Google account
 * (a popup the first time; after that Google hands over a fresh one-hour
 * permission without asking while they stay signed into Google). No key or
 * secret exists anywhere: the Google Client ID in config.js is public by
 * design, and the Google account must itself have edit access to the mirror.
 *
 *   Dept12SheetsPush(d, rpc)   d.confirm falsy → dry run: the exact payload,
 *                              no Google call. d.confirm → sign in to Google,
 *                              rewrite Current Week + one tab per truck.
 *
 * The week-building half below is a straight conversion of the former
 * sheets-push Edge Function's payload.ts, so the dashboard's Driver Tabs view
 * and the mirror stay column-for-column identical. The push half is a
 * line-for-line port of that function's handler.ts.
 */
(function () {
"use strict";

// The mirror the 8 driver tablets read. Its ID must never change, and it's
// a constant (not a setting) so nothing can point a push at the dispatcher's
// working sheet.
var MIRROR_SHEET_ID = "15f12Q0Nz4NFNUwbtQ7NgE7eCwSfqx3ai0VJAeZjtKJs";
var DISPATCHER_SHEET_ID = "1KlPQrxbXjDssy3Y5QrU75FoaGpeCmTmQhUC-m0p1mJ4";
// Local testing only: on localhost a copy of the mirror can stand in for it.
try {
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && localStorage.getItem("dept12TestMirrorId"))
    MIRROR_SHEET_ID = localStorage.getItem("dept12TestMirrorId");
} catch (e) { /* no storage: keep the real mirror */ }
if (MIRROR_SHEET_ID === DISPATCHER_SHEET_ID) throw new Error("refusing to push into the dispatcher sheet");

var SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
var SCOPE = "https://www.googleapis.com/auth/spreadsheets";

/* ═══ Week payload (converted from payload.ts) ═══════════════════════════ */
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
const TRUCK_OFF_COLOR = "#FF0000";
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
  let orderLine = o.solomon_order_no || "(no order #)";
  if (pallets !== null && pallets !== void 0) orderLine += ` - ${pallets} PAL`;
  return [customer, info.trim(), orderLine].filter(Boolean).join("\n");
}
function transferChipText(o) {
  return [o.driver_note, o.transfer_department_name || "(no department)"].filter(Boolean).join("\n");
}
function driverChipText(o, pallets, stops) {
  if (o.is_transfer) return transferChipText(o);
  if (o.kind === "external") {
    const header = `${o.broker_name || "(no broker)"} - Rexius Order: ${o.solomon_order_no || ""} | Load: ${o.broker_load_no || ""}`;
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
function mapsViewLink(name, address, city, state) {
  const citystate = [s(city), s(state)].filter(Boolean).join(" ");
  const query = [s(address), citystate].filter(Boolean).join(", ") || s(name);
  return query ? "https://www.google.com/maps/search/?api=1&query=" + pyQuote(query) : "";
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
              const picks = routeStops.filter((x) => x.stop_type === "pickup");
              const drops = routeStops.filter((x) => x.stop_type === "delivery");
              const pick = picks[0] || null, drop = drops[drops.length - 1] || null;
              row.pickup = pick ? mapsViewLink(pick.name, pick.address, pick.city, pick.state) : mapsViewLink(o.pickup_name, o.pickup_address, o.pickup_city, o.pickup_state);
              row.drop = drop ? mapsViewLink(drop.name, drop.address, drop.city, drop.state) : mapsViewLink(o.delivery_name, o.delivery_address, o.delivery_city, o.delivery_state);
            } else {
              row.store_map = o.customer_map_url || "";
            }
            row.notes = [o.driver_note, o.customer_notes].filter(Boolean).join(" \xB7 ");
          }
        } else if (!ld) {
          if (offByKey.has(`${t.truck_id}|${dt}`)) {
            row.chip = "OFF";
            row.color = TRUCK_OFF_COLOR;
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
function fmtRequests(sheetId, row, col, text, fillHex, fontSize = 10) {
  const fmt = { wrapStrategy: "WRAP", verticalAlignment: "TOP" };
  let dark = false;
  if (fillHex) {
    const rgb = hexToRgb01(fillHex);
    if (rgb) {
      fmt.backgroundColor = rgb;
      dark = DARK_FILLS.has(fillHex.toUpperCase());
    }
  }
  const textColor = dark ? { red: 1, green: 1, blue: 1 } : { red: 0, green: 0, blue: 0 };
  fmt.textFormat = { foregroundColor: textColor, fontFamily: "Arial", fontSize };
  const base = { foregroundColor: textColor };
  const formats = /* @__PURE__ */ new Map([[0, { ...base, bold: false }]]);
  for (const m of text.matchAll(/PICK:|DROP:|Rexius Order:|Load:|\b07-\d{4}-\d{4}\b/g)) {
    formats.set(m.index, { ...base, bold: true });
    formats.set(m.index + m[0].length, { ...base, bold: false });
  }
  const runs = formats.size > 1 ? [...formats.entries()].sort((a, b) => a[0] - b[0]).map(([startIndex, format]) => ({ startIndex, format })) : [];
  const cell = { userEnteredValue: { stringValue: text }, userEnteredFormat: fmt };
  if (runs.length) cell.textFormatRuns = runs;
  return [{ updateCells: {
    rows: [{ values: [cell] }],
    fields: "userEnteredValue,userEnteredFormat(backgroundColor,wrapStrategy,verticalAlignment,textFormat),textFormatRuns",
    start: { sheetId, rowIndex: row, columnIndex: col }
  } }];
}
function contrastTextColor(fillHex) {
  const h = (fillHex || "").replace(/^#+/, "");
  if (h.length !== 6) return { red: 0, green: 0, blue: 0 };
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 0.48 ? { red: 1, green: 1, blue: 1 } : { red: 0, green: 0, blue: 0 };
}
function headerCellRequest(sheetId, row, col, text, fillHex = null, fontSize = 14) {
  const hex = fillHex || "#E6E6E6";
  const fill = hexToRgb01(hex) || { red: 0.9, green: 0.9, blue: 0.9 };
  return { updateCells: {
    rows: [{ values: [{
      userEnteredValue: { stringValue: text },
      userEnteredFormat: {
        backgroundColor: fill,
        horizontalAlignment: "CENTER",
        verticalAlignment: "MIDDLE",
        wrapStrategy: "WRAP",
        textFormat: { fontFamily: "Arial", fontSize, bold: true, foregroundColor: contrastTextColor(hex) }
      }
    }] }],
    fields: "userEnteredValue,userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)",
    start: { sheetId, rowIndex: row, columnIndex: col }
  } };
}
function threeSlotGridRequests(sheetId, startCol, endCol, rowHeight, contentFontSize = 10, days = 5) {
  const startRow = 1, endRow = 1 + days * 3;
  const reqs = [
    { updateDimensionProperties: {
      range: { sheetId, dimension: "ROWS", startIndex: startRow, endIndex: endRow },
      properties: { pixelSize: rowHeight },
      fields: "pixelSize"
    } },
    { repeatCell: {
      range: { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startCol, endColumnIndex: endCol },
      cell: { userEnteredFormat: {
        wrapStrategy: "WRAP",
        verticalAlignment: "TOP",
        textFormat: { fontFamily: "Arial", fontSize: contentFontSize }
      } },
      fields: "userEnteredFormat(wrapStrategy,verticalAlignment,textFormat)"
    } }
  ];
  for (let row = startRow; row < endRow; row++) {
    const firstSlot = (row - startRow) % 3 === 0;
    const dateColor = firstSlot ? { red: 0, green: 0, blue: 0 } : { red: 1, green: 1, blue: 1 };
    reqs.push({ repeatCell: {
      range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: {
        numberFormat: { type: "DATE", pattern: "m/d/yy - ddd" },
        horizontalAlignment: "CENTER",
        verticalAlignment: "MIDDLE",
        backgroundColor: { red: 1, green: 1, blue: 1 },
        textFormat: { fontFamily: "Arial", fontSize: 13, bold: true, foregroundColor: dateColor }
      } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment,verticalAlignment,backgroundColor,textFormat)"
    } });
    if (firstSlot) {
      reqs.push({ repeatCell: {
        range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: startCol, endColumnIndex: endCol },
        cell: { userEnteredFormat: { borders: { top: { style: "SOLID_THICK", color: { red: 0, green: 0, blue: 0 } } } } },
        fields: "userEnteredFormat.borders.top"
      } });
    }
  }
  return reqs;
}

/* ═══ Google sign-in ═════════════════════════════════════════════════════ */
var GIS_URL = "https://accounts.google.com/gsi/client";
var GIS_LOADING = null;
var TOKEN = null;   // { value, exp } — kept in memory only, never stored

function loadGis() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  if (!GIS_LOADING) {
    GIS_LOADING = new Promise(function (ok, fail) {
      var s = document.createElement("script");
      s.src = GIS_URL; s.async = true;
      s.onload = function () { ok(); };
      s.onerror = function () { GIS_LOADING = null; fail(new Error("Couldn't load Google sign-in. Check the connection and try again.")); };
      document.head.appendChild(s);
    });
  }
  return GIS_LOADING;
}
// A Google permission to edit Sheets, good for about an hour. Reused until
// it's close to expiring; after the first consent Google renews it without
// asking as long as the person is still signed into Google in this browser.
function googleToken() {
  if (TOKEN && TOKEN.exp - 60000 > Date.now()) return Promise.resolve(TOKEN.value);
  var clientId = (window.DEPT12_CONFIG || {}).googleClientId;
  if (!clientId) return Promise.reject(new Error("Google sign-in isn't set up — add googleClientId to config.js."));
  return loadGis().then(function () {
    return new Promise(function (ok, fail) {
      var client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: function (r) {
          if (r.error || !r.access_token) {
            fail(new Error("Google sign-in didn't finish (" + (r.error_description || r.error || "no permission") + ")."));
            return;
          }
          if (!google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) {
            fail(new Error("Google sign-in needs permission to edit Google Sheets to update the schedule."));
            return;
          }
          TOKEN = { value: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 };
          ok(TOKEN.value);
        },
        error_callback: function (e) {
          fail(new Error(e && e.type === "popup_closed" ? "Google sign-in was closed before it finished."
            : e && e.type === "popup_failed_to_open" ? "The browser blocked the Google sign-in popup — allow popups for this site and try again."
            : "Google sign-in failed."));
        }
      });
      client.requestAccessToken({ prompt: "" });
    });
  });
}

/* ═══ Sheets API ═════════════════════════════════════════════════════════ */
function wait(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
// Retries Google's "slow down" (429) and temporary server errors.
function fetchRetry(url, opts, tries) {
  tries = tries || 0;
  return fetch(url, opts).then(function (r) {
    if ((r.status === 429 || r.status >= 500) && tries < 4) return wait(800 * Math.pow(2, tries)).then(function () { return fetchRetry(url, opts, tries + 1); });
    return r;
  }, function (err) {
    if (tries < 4) return wait(800 * Math.pow(2, tries)).then(function () { return fetchRetry(url, opts, tries + 1); });
    throw err;
  });
}
function Sheets(token) { this.token = token; }
Sheets.prototype.call = function (method, path, body) {
  var sep = path.charAt(0) === ":" || path.charAt(0) === "?" ? "" : "/";
  var self = this;
  return fetchRetry(SHEETS_BASE + "/" + MIRROR_SHEET_ID + sep + path, {
    method: method,
    headers: { Authorization: "Bearer " + this.token, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(function (r) {
    return r.text().then(function (text) {
      if (r.status === 401) TOKEN = null;
      if (r.status === 403 || r.status === 404) {
        throw new Error("This Google account can't edit the drivers' schedule sheet. Sign in with an account that has edit access to it.");
      }
      if (!r.ok) throw new Error("Google Sheets " + method + " failed (HTTP " + r.status + "): " + text.slice(0, 300));
      return text ? JSON.parse(text) : {};
    });
  });
};
Sheets.prototype.tabProps = function () {
  var q = new URLSearchParams({ fields: "sheets.properties(sheetId,title,index,gridProperties(rowCount))" });
  return this.call("GET", "?" + q.toString()).then(function (data) {
    return (data.sheets || []).map(function (x) { return x.properties; });
  });
};
Sheets.prototype.readRange = function (a1) {
  return this.call("GET", "values/" + encodeURIComponent(a1)).then(function (j) { return j.values || []; });
};
Sheets.prototype.writeRange = function (a1, values) {
  return this.call("PUT", "values/" + encodeURIComponent(a1) + "?valueInputOption=USER_ENTERED", { values: values });
};
Sheets.prototype.batchUpdate = function (requests) {
  return this.call("POST", ":batchUpdate", { requests: requests });
};

var escapeRe = function (x) { return x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); };

/* ═══ The push (port of handler.ts) ══════════════════════════════════════ */
async function push(d, rpc) {
  var start = d.start_date || null;
  if (start !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(start))) throw new Error("start_date must be YYYY-MM-DD");
  // Ask Google first, while the click that started the push still counts
  // as a click — browsers block popups that open later than that.
  var token = d.confirm ? googleToken() : null;
  if (token) token.catch(function () {});   // handled at "await token" below
  var dates = await rpc("driver_week_dates", { p_start: start, p_count: parseInt(d.days == null ? 3 : d.days, 10) || 3 });
  var data = await rpc("driver_week_data", { p_from: dates[0], p_to: dates[dates.length - 1] });
  var payload = buildPayload(dates, data);

  if (!d.confirm) {
    // Dry run: the exact push payload, no Google call at all. Load Google's
    // sign-in script now so it's ready the moment the push is confirmed.
    loadGis().catch(function () {});
    return Object.assign({}, payload, { dry_run: true, sync_available: !!(window.DEPT12_CONFIG || {}).googleClientId });
  }
  var sheets = new Sheets(await token);
  var rowCount = payload.days * payload.slots_per_day;
  // Always clear the full 1–14 day range the app allows.
  var maxClearRows = 14 * payload.slots_per_day;

  var props = await sheets.tabProps();
  var cwProp = props.find(function (p) { return p.title === "Current Week"; }) || null;
  var driverTabs = props.filter(function (p) { return p.title !== "Current Week"; });

  var resolved = {}, skipped = [], needCreate = [];
  payload.drivers.forEach(function (drv) {
    var re = new RegExp("\\b" + escapeRe(String(drv.truck)) + "\\b");
    var found = driverTabs.filter(function (p) { return re.test(p.title); });
    if (found.length === 1) resolved[drv.truck] = found[0];
    else if (found.length === 0) needCreate.push(drv);
    else skipped.push({ truck: drv.truck, driver: drv.driver, candidates: found.map(function (p) { return p.title; }) });
  });

  // Create missing tabs and keep tab order = Fleet order.
  var startIndex = cwProp ? cwProp.index + 1 : 0;
  var targetOrder = payload.drivers
    .filter(function (drv) { return drv.truck in resolved || needCreate.indexOf(drv) >= 0; })
    .map(function (drv) { return drv.truck; });
  var reorderNeeded = needCreate.length > 0 || targetOrder.some(function (truck, i) {
    return truck in resolved && resolved[truck].index !== startIndex + i;
  });
  // Hand-made tabs were capped at 17 rows — grow before writing.
  var gridTargetRows = 1 + 14 * payload.slots_per_day;
  var growReqs = (cwProp ? [cwProp] : []).concat(Object.keys(resolved).map(function (k) { return resolved[k]; }))
    .filter(function (p) { return ((p.gridProperties || {}).rowCount || 0) < gridTargetRows; })
    .map(function (p) { return { updateSheetProperties: {
      properties: { sheetId: p.sheetId, gridProperties: { rowCount: gridTargetRows } },
      fields: "gridProperties.rowCount" } }; });

  if (needCreate.length || reorderNeeded || growReqs.length) {
    var provision = growReqs.slice();
    if (needCreate.length) {
      provision = provision.concat(needCreate.map(function (drv) { return { addSheet: { properties: {
        title: [String(drv.driver || "").toUpperCase(), drv.truck, drv.equipment_type].filter(Boolean).join(" "),
        gridProperties: { frozenRowCount: 1, rowCount: gridTargetRows } } } }; }));
    }
    var replies = provision.length ? ((await sheets.batchUpdate(provision)).replies || []) : [];
    needCreate.forEach(function (drv, i) { resolved[drv.truck] = replies[growReqs.length + i].addSheet.properties; });
    var reorderReqs = targetOrder.map(function (truck, i) { return { updateSheetProperties: {
      properties: { sheetId: resolved[truck].sheetId, index: startIndex + i }, fields: "index" } }; });
    if (reorderReqs.length) await sheets.batchUpdate(reorderReqs);
  }

  var pushed = [];
  for (var di = 0; di < payload.drivers.length; di++) {
    var drv = payload.drivers[di];
    if (!(drv.truck in resolved)) continue;
    var tab = resolved[drv.truck].title, sid = resolved[drv.truck].sheetId;
    // B date, C chip, D notes, E PO/PU#, F Delivery#, G/H/I links.
    var values = drv.rows.map(function (r) { return [r.date, r.chip, r.notes, r.po_number, r.delivery_number, "", "", ""]; });
    await sheets.batchUpdate([{ repeatCell: {
      range: { sheetId: sid, startRowIndex: 1, endRowIndex: 1 + maxClearRows, startColumnIndex: 1, endColumnIndex: 9 },
      cell: {}, fields: "userEnteredValue,userEnteredFormat" } }]);
    await sheets.writeRange("'" + tab + "'!B2:I" + (1 + values.length), values);
    var reqs = threeSlotGridRequests(sid, 1, 9, 150, 11, payload.days);
    // Real rich-text links — one tap on a tablet, unlike HYPERLINK().
    drv.rows.forEach(function (r, i) {
      [[6, r.store_map, "Store Map"], [7, r.pickup, "Pickup"], [8, r.drop, "Drop"]].forEach(function (link) {
        if (link[1]) {
          reqs.push({ updateCells: {
            rows: [{ values: [{ userEnteredValue: { stringValue: link[2] },
                                textFormatRuns: [{ startIndex: 0, format: { link: { uri: link[1] } } }] }] }],
            fields: "userEnteredValue,textFormatRuns",
            start: { sheetId: sid, rowIndex: 1 + i, columnIndex: link[0] } } });
        }
      });
    });
    reqs.unshift(headerCellRequest(sid, 0, 2,
      (drv.driver || drv.truck + " " + drv.equipment_type).toUpperCase(), drv.driver_color, 15));
    reqs.unshift({ updateDimensionProperties: {
      range: { sheetId: sid, dimension: "ROWS", startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 42 }, fields: "pixelSize" } });
    drv.rows.forEach(function (r, i) {
      if (!r.chip) return;
      reqs.push.apply(reqs, fmtRequests(sid, 1 + i, 2, r.chip, r.color, 11));
      var sections = r.chip.split("\n\n").length - 1;
      if (sections > 2) {
        reqs.push({ updateDimensionProperties: {
          range: { sheetId: sid, dimension: "ROWS", startIndex: 1 + i, endIndex: 2 + i },
          properties: { pixelSize: Math.min(420, 150 + 60 * (sections - 2)) }, fields: "pixelSize" } });
      }
    });
    await sheets.batchUpdate(reqs);
    pushed.push(tab);
  }

  // Current Week headers are rebuilt from the dashboard on every push.
  var currentWeekPushed = false;
  if (cwProp) {
    var prior = await sheets.readRange("'Current Week'!B1:Z1");
    var priorWidth = prior.length ? prior[0].length : 0;
    var headers = ["DATE"].concat(payload.current_week.map(function (t) { return t.header.toUpperCase(); }));
    var matrix = [];
    for (var i = 0; i < rowCount; i++) {
      matrix.push([payload.current_week[0].rows[i].date].concat(payload.current_week.map(function (t) { return t.rows[i].chip; })));
    }
    var csid = cwProp.sheetId;
    var lastCol = String.fromCharCode(65 + headers.length);
    await sheets.batchUpdate([{ repeatCell: {
      range: { sheetId: csid, startRowIndex: 0, endRowIndex: 1 + maxClearRows, startColumnIndex: 1,
               endColumnIndex: 1 + Math.max(priorWidth, headers.length) },
      cell: {}, fields: "userEnteredValue,userEnteredFormat" } }]);
    await sheets.writeRange("'Current Week'!B1:" + lastCol + "1", [headers]);
    await sheets.writeRange("'Current Week'!B2:" + lastCol + (1 + rowCount), matrix);
    var creqs = threeSlotGridRequests(csid, 1, 1 + headers.length, 108, 10, payload.days);
    creqs.unshift({ updateDimensionProperties: {
      range: { sheetId: csid, dimension: "ROWS", startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 42 }, fields: "pixelSize" } });
    creqs.splice(1, 0, { updateDimensionProperties: {
      range: { sheetId: csid, dimension: "COLUMNS", startIndex: 2, endIndex: 1 + headers.length },
      properties: { pixelSize: 224 }, fields: "pixelSize" } });
    creqs.push(headerCellRequest(csid, 0, 1, "DATE", "#FFFFFF", 16));
    payload.current_week.forEach(function (truck, idx) {
      var col = idx + 2;
      creqs.push(headerCellRequest(csid, 0, col, truck.header.toUpperCase(), truck.driver_color, 14));
      truck.rows.forEach(function (row, ri) {
        if (row.chip) creqs.push.apply(creqs, fmtRequests(csid, 1 + ri, col, row.chip, row.color, 10));
      });
    });
    await sheets.batchUpdate(creqs);
    currentWeekPushed = true;
  }

  // Records the push in History as an external effect, and (once Current
  // Week is written) stamps pushed_at so external chips take driver color.
  await rpc("driver_week_mark_pushed", {
    p_from: payload.week_start, p_to: payload.week_end, p_mark_loads: currentWeekPushed,
    p_meta: { pushed_tabs: pushed, skipped_count: skipped.length, week_start: payload.week_start }
  });
  return { pushed: pushed, skipped: skipped, current_week: currentWeekPushed, week_start: payload.week_start };
}

window.Dept12SheetsPush = push;
})();

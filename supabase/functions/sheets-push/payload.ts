// Driver-tab / Current Week payload — a line-for-line port of server.py's
// _driver_week_payload and its chip/color helpers (D36/D37/D98/D112–D114,
// D130/D140/D165/D178–D185, D222). The dry run returns exactly this object,
// and the confirmed push writes exactly this object, so the dashboard's
// Driver Tabs view and the live mirror stay column-for-column identical.

export type WeekData = {
  trucks: any[]; loads: any[]; notes: any[]; off_days: any[]; orders: any[]; stops: any[];
};

// Exact Google-Sheets stock colors read off the live Current Week legend (D37).
const LEGEND_COLORS: Record<string, string> = {
  "early|false": "#D9EAD3",   // green  — Early Store
  "anytime|false": "#FFF2CC", // yellow — Anytime
  "early|true": "#F1C232",    // dark yellow — Early EAST
  "anytime|true": "#783F04",  // brown  — Anytime EAST
};
export const DARK_FILLS = new Set(["#783F04", "#FF0000"]);
export const TRUCK_OFF_COLOR = "#FF0000";

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();

/** Python's round(): half-to-even on the same double. */
function pyRound(x: number): number {
  const f = Math.floor(x), diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** urllib.parse.quote(query) — unreserved + "/" stay literal. */
function pyQuote(q: string): string {
  return encodeURIComponent(q).replace(/%2F/g, "/")
    .replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

export function fmtLocation(name: unknown, address: unknown, city: unknown, state: unknown, phone: unknown): string {
  const citystate = [s(city), s(state)].filter(Boolean).join(" ");
  return [s(name), s(address), citystate, s(phone)].filter(Boolean).join(", ");
}

function internalChipText(o: any, pallets: unknown = null): string {
  const customer = o.customer_name || "(no customer)";
  const citystate = [s(o.cust_city), s(o.cust_state)].filter(Boolean).join(" ");
  const info = citystate + (o.cust_forklift ? " - " + o.cust_forklift : "");
  let orderLine = o.solomon_order_no || "(no order #)";
  if (pallets !== null && pallets !== undefined) orderLine += ` - ${pallets} PAL`;
  return [customer, info.trim(), orderLine].filter(Boolean).join("\n");
}

function transferChipText(o: any): string {
  return [o.driver_note, o.transfer_department_name || "(no department)"].filter(Boolean).join("\n");
}

function driverChipText(o: any, pallets: unknown, stops: any[]): string {
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
        const extras: unknown[] = [stop.notes];
        if (stop.scheduled_at) extras.unshift("APPT " + stop.scheduled_at_label);
        if (stop.pallet_count !== null && stop.pallet_count !== undefined) extras.unshift(`${stop.pallet_count} PAL`);
        if (extras.some(Boolean)) line += " — " + extras.filter(Boolean).join(" · ");
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

function currentWeekChipText(o: any, stops: any[]): string {
  const loc = (name: unknown, city: unknown, state: unknown) => {
    const citystate = [s(city), s(state)].filter(Boolean).join(" ");
    return [s(name), citystate].filter(Boolean).join(", ");
  };
  if (o.is_transfer) return transferChipText(o);
  if (o.kind === "external") {
    const header = `${o.broker_name || "(no broker)"} - Load: ${o.broker_load_no || ""}`;
    if (o.route_mode === "custom" && stops.length) {
      const stopLines: string[] = [];
      stops.forEach((stop, i) => {
        const label = stop.stop_type === "pickup" ? "PICK" : "DROP";
        const place = loc(stop.name, stop.city, stop.state);
        if (place) stopLines.push(`${i + 1}. ${label}: ${place}`);
      });
      return stopLines.length ? [header, stopLines.join("\n")].join("\n\n") : header;
    }
    const pick = loc(o.pickup_name, o.pickup_city, o.pickup_state);
    const drop = loc(o.delivery_name, o.delivery_city, o.delivery_state);
    const stopLines: string[] = [];
    if (pick) stopLines.push("PICK: " + pick);
    if (drop) stopLines.push("DROP: " + drop);
    return stopLines.length ? [header, stopLines.join("\n")].join("\n\n") : header;
  }
  return internalChipText(o, o.pallet_count);
}

export function hexToRgb01(h: string | null | undefined): { red: number; green: number; blue: number } | null {
  let x = (h || "").replace(/^#+/, "");
  if (x.length === 8) x = x.slice(0, 6);   // browser-side opacity is #RRGGBBAA; Sheets needs RGB
  if (x.length !== 6) return null;
  return { red: parseInt(x.slice(0, 2), 16) / 255, green: parseInt(x.slice(2, 4), 16) / 255,
           blue: parseInt(x.slice(4, 6), 16) / 255 };
}

/** 'View this location' Google Maps link (D113) — a pin, not truck routing. */
function mapsViewLink(name: unknown, address: unknown, city: unknown, state: unknown): string {
  const citystate = [s(city), s(state)].filter(Boolean).join(" ");
  const query = [s(address), citystate].filter(Boolean).join(", ") || s(name);
  return query ? "https://www.google.com/maps/search/?api=1&query=" + pyQuote(query) : "";
}

function lightenHex(h: string | null | undefined, whiteMix = 0.78): string | null {
  let x = (h || "").replace(/^#+/, "");
  if (x.length === 8) x = x.slice(0, 6);
  if (x.length !== 6) return null;
  return "#" + [0, 2, 4].map((i) => {
    const v = parseInt(x.slice(i, i + 2), 16);
    return pyRound(v + (255 - v) * whiteMix).toString(16).toUpperCase().padStart(2, "0");
  }).join("");
}

function chipFill(o: any, driverColor: string | null): string | null {
  if (o.is_transfer) return o.transfer_department_color || null;
  if (o.kind === "external") return driverColor ? lightenHex(driverColor) : null;
  return LEGEND_COLORS[`${o.cust_timing}|${!!o.cust_umatilla}`] || null;
}

export function buildPayload(dates: string[], data: WeekData) {
  const inRange = new Set(dates);
  const notesByKey = new Map<string, any>();
  for (const n of data.notes) notesByKey.set(`${n.truck_id}|${n.scheduled_date}|${n.slot}`, n);
  const offByKey = new Set(data.off_days.map((o: any) => `${o.truck_id}|${o.off_date}`));
  const orders = new Map<string, any>(data.orders.map((o: any) => [o.id, o]));
  const stopsByLoad = new Map<string, any[]>();
  for (const st of data.stops) {
    if (!stopsByLoad.has(st.load_id)) stopsByLoad.set(st.load_id, []);
    stopsByLoad.get(st.load_id)!.push(st);
  }
  const byTruck = new Map<string, Map<string, Map<number, any>>>();
  for (const l of data.loads) {
    if (!byTruck.has(l.truck_id)) byTruck.set(l.truck_id, new Map());
    const days = byTruck.get(l.truck_id)!;
    if (!days.has(l.scheduled_date)) days.set(l.scheduled_date, new Map());
    days.get(l.scheduled_date)!.set(l.slot, l);
  }

  const truckRows = (t: any, compact = false) => {
    const truckLoads = byTruck.get(t.truck_id) || new Map();
    const out: any[] = [];
    for (const dt of dates) {
      if (!inRange.has(dt)) continue;
      const dayLoads = truckLoads.get(dt) || new Map();
      for (let slot = 1; slot <= 3; slot++) {
        const ld = dayLoads.get(slot);
        const row: any = { date: dt, slot, chip: "", notes: "", pickup: "", drop: "", store_map: "",
                           color: null, po_number: "", delivery_number: "" };
        const oid = ld && ld.order_ids && ld.order_ids.length ? ld.order_ids[0] : null;
        const o = oid ? orders.get(oid) : null;
        if (o) {
          const routeStops = ld ? (stopsByLoad.get(ld.id) || []) : [];
          row.chip = compact ? currentWeekChipText(o, routeStops) : driverChipText(o, o.pallet_count, routeStops);
          row.color = chipFill(o, t.driver_color);
          if (!compact) {
            if (o.kind === "external") {
              row.po_number = o.po_number || "";
              row.delivery_number = o.delivery_number || "";
              const picks = routeStops.filter((x) => x.stop_type === "pickup");
              const drops = routeStops.filter((x) => x.stop_type === "delivery");
              const pick = picks[0] || null, drop = drops[drops.length - 1] || null;
              row.pickup = pick ? mapsViewLink(pick.name, pick.address, pick.city, pick.state)
                                : mapsViewLink(o.pickup_name, o.pickup_address, o.pickup_city, o.pickup_state);
              row.drop = drop ? mapsViewLink(drop.name, drop.address, drop.city, drop.state)
                              : mapsViewLink(o.delivery_name, o.delivery_address, o.delivery_city, o.delivery_state);
            } else {
              row.store_map = o.customer_map_url || "";
            }
            row.notes = [o.driver_note, o.customer_notes].filter(Boolean).join(" · ");
          }
        } else if (!ld) {
          if (offByKey.has(`${t.truck_id}|${dt}`)) {
            row.chip = "OFF"; row.color = TRUCK_OFF_COLOR;
            out.push(row);
            continue;
          }
          const note = notesByKey.get(`${t.truck_id}|${dt}|${slot}`);
          if (note && note.body) {
            row.chip = note.body;
            const fill = (note.fmt || {}).fill;
            row.color = fill ? fill : (note.cat_color ?? null);
          }
        }
        out.push(row);
      }
    }
    return out;
  };

  const drivers = data.trucks.map((t: any) => ({
    driver: t.driver_name, truck: t.number, equipment_type: t.eq,
    driver_color: t.driver_color, truck_id: t.truck_id, rows: truckRows(t),
  }));
  const currentWeek = data.trucks.map((t: any) => ({
    header: [t.driver_name, t.number, t.eq].filter(Boolean).join(" "),
    driver: t.driver_name, truck: t.number, equipment_type: t.eq,
    driver_color: t.driver_color, truck_id: t.truck_id, rows: truckRows(t, true),
  }));
  return {
    week_start: dates[0], week_end: dates[dates.length - 1], days: dates.length, slots_per_day: 3,
    dates, drivers, current_week: currentWeek,
  };
}

// ── Sheets request builders (was _fmt_requests etc.) ─────────────────────
export function fmtRequests(sheetId: number, row: number, col: number, text: string,
                            fillHex: string | null, fontSize = 10) {
  const fmt: any = { wrapStrategy: "WRAP", verticalAlignment: "TOP" };
  let dark = false;
  if (fillHex) {
    const rgb = hexToRgb01(fillHex);
    if (rgb) { fmt.backgroundColor = rgb; dark = DARK_FILLS.has(fillHex.toUpperCase()); }
  }
  const textColor = dark ? { red: 1, green: 1, blue: 1 } : { red: 0, green: 0, blue: 0 };
  fmt.textFormat = { foregroundColor: textColor, fontFamily: "Arial", fontSize };
  const base = { foregroundColor: textColor };
  const formats = new Map<number, any>([[0, { ...base, bold: false }]]);
  for (const m of text.matchAll(/PICK:|DROP:|Rexius Order:|Load:|\b07-\d{4}-\d{4}\b/g)) {
    formats.set(m.index!, { ...base, bold: true });
    formats.set(m.index! + m[0].length, { ...base, bold: false });
  }
  const runs = formats.size > 1
    ? [...formats.entries()].sort((a, b) => a[0] - b[0]).map(([startIndex, format]) => ({ startIndex, format }))
    : [];
  const cell: any = { userEnteredValue: { stringValue: text }, userEnteredFormat: fmt };
  if (runs.length) cell.textFormatRuns = runs;
  return [{ updateCells: {
    rows: [{ values: [cell] }],
    fields: "userEnteredValue,userEnteredFormat(backgroundColor,wrapStrategy,verticalAlignment,textFormat),textFormatRuns",
    start: { sheetId, rowIndex: row, columnIndex: col },
  } }];
}

function contrastTextColor(fillHex: string) {
  const h = (fillHex || "").replace(/^#+/, "");
  if (h.length !== 6) return { red: 0, green: 0, blue: 0 };
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 0.48 ? { red: 1, green: 1, blue: 1 } : { red: 0, green: 0, blue: 0 };
}

export function headerCellRequest(sheetId: number, row: number, col: number, text: string,
                                  fillHex: string | null = null, fontSize = 14) {
  const hex = fillHex || "#E6E6E6";
  const fill = hexToRgb01(hex) || { red: 0.9, green: 0.9, blue: 0.9 };
  return { updateCells: {
    rows: [{ values: [{
      userEnteredValue: { stringValue: text },
      userEnteredFormat: {
        backgroundColor: fill, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", wrapStrategy: "WRAP",
        textFormat: { fontFamily: "Arial", fontSize, bold: true, foregroundColor: contrastTextColor(hex) },
      },
    }] }],
    fields: "userEnteredValue,userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)",
    start: { sheetId, rowIndex: row, columnIndex: col },
  } };
}

export function threeSlotGridRequests(sheetId: number, startCol: number, endCol: number, rowHeight: number,
                                      contentFontSize = 10, days = 5) {
  const startRow = 1, endRow = 1 + days * 3;
  const reqs: any[] = [
    { updateDimensionProperties: {
      range: { sheetId, dimension: "ROWS", startIndex: startRow, endIndex: endRow },
      properties: { pixelSize: rowHeight }, fields: "pixelSize" } },
    { repeatCell: {
      range: { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startCol, endColumnIndex: endCol },
      cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "TOP",
                                   textFormat: { fontFamily: "Arial", fontSize: contentFontSize } } },
      fields: "userEnteredFormat(wrapStrategy,verticalAlignment,textFormat)" } },
  ];
  for (let row = startRow; row < endRow; row++) {
    const firstSlot = (row - startRow) % 3 === 0;
    const dateColor = firstSlot ? { red: 0, green: 0, blue: 0 } : { red: 1, green: 1, blue: 1 };
    reqs.push({ repeatCell: {
      range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: {
        numberFormat: { type: "DATE", pattern: "m/d/yy - ddd" },
        horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE",
        backgroundColor: { red: 1, green: 1, blue: 1 },
        textFormat: { fontFamily: "Arial", fontSize: 13, bold: true, foregroundColor: dateColor } } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment,verticalAlignment,backgroundColor,textFormat)" } });
    if (firstSlot) {
      reqs.push({ repeatCell: {
        range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: startCol, endColumnIndex: endCol },
        cell: { userEnteredFormat: { borders: { top: { style: "SOLID_THICK", color: { red: 0, green: 0, blue: 0 } } } } },
        fields: "userEnteredFormat.borders.top" } });
    }
  }
  return reqs;
}

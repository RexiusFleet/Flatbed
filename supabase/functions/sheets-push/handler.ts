// Google Sheets driver-mirror push (was /api/sheets/push-driver-tabs, D35/
// D98/D111–D114/D164/D178–D185).
//
// confirm=false → dry run: returns the exact payload, no Google call at all.
// confirm=true  → rewrites Current Week + one tab per truck on the MIRROR.
//
// Needs the Supabase function secret GOOGLE_SERVICE_ACCOUNT_JSON (the whole
// service-account key file's JSON). It never leaves this function.

import { handle, HttpError, json, requireUser, rpc, fetchRetry } from "../_shared/common.ts";
import { buildPayload, fmtRequests, headerCellRequest, threeSlotGridRequests, WeekData } from "./payload.ts";

// The mirror the 8 driver tablets read. CLAUDE.md: "its ID must never
// change". Deliberately a constant, not a setting/secret, so no config typo
// can ever point this push at the dispatcher's working sheet.
const MIRROR_SHEET_ID: string = "15f12Q0Nz4NFNUwbtQ7NgE7eCwSfqx3ai0VJAeZjtKJs";
const DISPATCHER_SHEET_ID: string = "1KlPQrxbXjDssy3Y5QrU75FoaGpeCmTmQhUC-m0p1mJ4";
if (MIRROR_SHEET_ID === DISPATCHER_SHEET_ID) throw new Error("refusing to push into the dispatcher sheet");

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

function b64url(bytes: Uint8Array | string): string {
  const b = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function serviceAccount(): { client_email: string; private_key: string } | null {
  const raw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    return j.client_email && j.private_key ? j : null;
  } catch {
    return null;
  }
}

/** Service-account JWT → OAuth access token (same flow as GoogleSheetsSync). */
async function googleToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`)));
  const r = await fetchRetry(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
                                assertion: `${header}.${claims}.${b64url(sig)}` }),
  }, "Google token");
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new HttpError(502, `Google token exchange failed: ${JSON.stringify(j)}`);
  return j.access_token;
}

class Sheets {
  constructor(private token: string) {}
  private async call(method: string, path: string, body?: unknown): Promise<any> {
    const sep = path.startsWith(":") || path.startsWith("?") ? "" : "/";
    const r = await fetchRetry(`${SHEETS_BASE}/${MIRROR_SHEET_ID}${sep}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, "Google Sheets");
    const text = await r.text();
    if (!r.ok) throw new HttpError(502, `Google Sheets ${method} failed (HTTP ${r.status}): ${text}`);
    return text ? JSON.parse(text) : {};
  }
  async tabProps(): Promise<any[]> {
    const q = new URLSearchParams({ fields: "sheets.properties(sheetId,title,index,gridProperties(rowCount))" });
    const data = await this.call("GET", "?" + q.toString());
    return (data.sheets || []).map((x: any) => x.properties);
  }
  async readRange(a1: string): Promise<any[][]> {
    return (await this.call("GET", "values/" + encodeURIComponent(a1))).values || [];
  }
  async writeRange(a1: string, values: unknown[][]): Promise<void> {
    await this.call("PUT", "values/" + encodeURIComponent(a1) + "?valueInputOption=USER_ENTERED", { values });
  }
  batchUpdate(requests: unknown[]): Promise<any> {
    return this.call("POST", ":batchUpdate", { requests });
  }
}

const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const handler = handle(async (req) => {
  await requireUser(req);
  const d = await req.json().catch(() => ({}));
  const start = d.start_date || null;
  if (start !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(start))) {
    throw new HttpError(400, "start_date must be YYYY-MM-DD");
  }
  const dates = await rpc<string[]>(req, "driver_week_dates", { p_start: start, p_count: parseInt(d.days ?? 3, 10) || 3 });
  const data = await rpc<WeekData>(req, "driver_week_data", { p_from: dates[0], p_to: dates[dates.length - 1] });
  const payload: any = buildPayload(dates, data);
  const sa = serviceAccount();

  if (!d.confirm) {
    // Dry run (D35): the exact push payload, no Sheets call at all.
    return json({ ...payload, dry_run: true, sync_available: !!sa });
  }
  if (!sa) {
    throw new HttpError(501, "Google Sheets sync needs the service-account key — set the " +
      "GOOGLE_SERVICE_ACCOUNT_JSON function secret in Supabase (SETUP.md, step 6).");
  }
  const sheets = new Sheets(await googleToken(sa));
  const rowCount = payload.days * payload.slots_per_day;
  // Always clear the full 1–14 day range the app allows (D98/D112).
  const maxClearRows = 14 * payload.slots_per_day;

  const props = await sheets.tabProps();
  const cwProp = props.find((p) => p.title === "Current Week") || null;
  const driverTabs = props.filter((p) => p.title !== "Current Week");

  const resolved: Record<string, any> = {};
  const skipped: any[] = [];
  const needCreate: any[] = [];
  for (const drv of payload.drivers) {
    const re = new RegExp("\\b" + escapeRe(String(drv.truck)) + "\\b");
    const found = driverTabs.filter((p) => re.test(p.title));
    if (found.length === 1) resolved[drv.truck] = found[0];
    else if (found.length === 0) needCreate.push(drv);
    else skipped.push({ truck: drv.truck, driver: drv.driver, candidates: found.map((p) => p.title) });
  }

  // D112: create missing tabs and keep tab order = Fleet order.
  const startIndex = cwProp ? cwProp.index + 1 : 0;
  const targetOrder: string[] = payload.drivers
    .filter((drv: any) => drv.truck in resolved || needCreate.includes(drv)).map((drv: any) => drv.truck);
  const reorderNeeded = needCreate.length > 0 || targetOrder.some((truck, i) =>
    truck in resolved && resolved[truck].index !== startIndex + i);
  // D114: hand-made tabs were capped at 17 rows — grow before writing.
  const gridTargetRows = 1 + 14 * payload.slots_per_day;
  const growReqs = [...(cwProp ? [cwProp] : []), ...Object.values(resolved)]
    .filter((p: any) => ((p.gridProperties || {}).rowCount || 0) < gridTargetRows)
    .map((p: any) => ({ updateSheetProperties: {
      properties: { sheetId: p.sheetId, gridProperties: { rowCount: gridTargetRows } },
      fields: "gridProperties.rowCount" } }));

  if (needCreate.length || reorderNeeded || growReqs.length) {
    let provision: any[] = [...growReqs];
    if (needCreate.length) {
      provision = provision.concat(needCreate.map((drv) => ({ addSheet: { properties: {
        title: [String(drv.driver || "").toUpperCase(), drv.truck, drv.equipment_type].filter(Boolean).join(" "),
        gridProperties: { frozenRowCount: 1, rowCount: gridTargetRows } } } })));
    }
    const replies = provision.length ? ((await sheets.batchUpdate(provision)).replies || []) : [];
    needCreate.forEach((drv, i) => { resolved[drv.truck] = replies[growReqs.length + i].addSheet.properties; });
    const reorderReqs = targetOrder.map((truck, i) => ({ updateSheetProperties: {
      properties: { sheetId: resolved[truck].sheetId, index: startIndex + i }, fields: "index" } }));
    if (reorderReqs.length) await sheets.batchUpdate(reorderReqs);
  }

  const pushed: string[] = [];
  for (const drv of payload.drivers) {
    if (!(drv.truck in resolved)) continue;
    const tab = resolved[drv.truck].title, sid = resolved[drv.truck].sheetId;
    // D178/D179: B date, C chip, D notes, E PO/PU#, F Delivery#, G/H/I links.
    const values = drv.rows.map((r: any) => [r.date, r.chip, r.notes, r.po_number, r.delivery_number, "", "", ""]);
    await sheets.batchUpdate([{ repeatCell: {
      range: { sheetId: sid, startRowIndex: 1, endRowIndex: 1 + maxClearRows, startColumnIndex: 1, endColumnIndex: 9 },
      cell: {}, fields: "userEnteredValue,userEnteredFormat" } }]);
    await sheets.writeRange(`'${tab}'!B2:I${1 + values.length}`, values);
    const reqs: any[] = threeSlotGridRequests(sid, 1, 9, 150, 11, payload.days);
    // Real rich-text links — one tap on a tablet, unlike HYPERLINK() (D179).
    drv.rows.forEach((r: any, i: number) => {
      for (const [col, url, label] of [[6, r.store_map, "Store Map"], [7, r.pickup, "Pickup"], [8, r.drop, "Drop"]] as const) {
        if (url) {
          reqs.push({ updateCells: {
            rows: [{ values: [{ userEnteredValue: { stringValue: label },
                                textFormatRuns: [{ startIndex: 0, format: { link: { uri: url } } }] }] }],
            fields: "userEnteredValue,textFormatRuns",
            start: { sheetId: sid, rowIndex: 1 + i, columnIndex: col } } });
        }
      }
    });
    reqs.unshift(headerCellRequest(sid, 0, 2,
      (drv.driver || `${drv.truck} ${drv.equipment_type}`).toUpperCase(), drv.driver_color, 15));
    reqs.unshift({ updateDimensionProperties: {
      range: { sheetId: sid, dimension: "ROWS", startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 42 }, fields: "pixelSize" } });
    drv.rows.forEach((r: any, i: number) => {
      if (!r.chip) return;
      reqs.push(...fmtRequests(sid, 1 + i, 2, r.chip, r.color, 11));
      const sections = r.chip.split("\n\n").length - 1;
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
  let currentWeekPushed = false;
  if (cwProp) {
    const prior = await sheets.readRange("'Current Week'!B1:Z1");
    const priorWidth = prior.length ? prior[0].length : 0;
    const headers = ["DATE", ...payload.current_week.map((t: any) => t.header.toUpperCase())];
    const matrix: any[][] = [];
    for (let i = 0; i < rowCount; i++) {
      matrix.push([payload.current_week[0].rows[i].date, ...payload.current_week.map((t: any) => t.rows[i].chip)]);
    }
    const csid = cwProp.sheetId;
    const lastCol = String.fromCharCode(65 + headers.length);
    await sheets.batchUpdate([{ repeatCell: {
      range: { sheetId: csid, startRowIndex: 0, endRowIndex: 1 + maxClearRows, startColumnIndex: 1,
               endColumnIndex: 1 + Math.max(priorWidth, headers.length) },
      cell: {}, fields: "userEnteredValue,userEnteredFormat" } }]);
    await sheets.writeRange(`'Current Week'!B1:${lastCol}1`, [headers]);
    await sheets.writeRange(`'Current Week'!B2:${lastCol}${1 + rowCount}`, matrix);
    const reqs: any[] = threeSlotGridRequests(csid, 1, 1 + headers.length, 108, 10, payload.days);
    reqs.unshift({ updateDimensionProperties: {
      range: { sheetId: csid, dimension: "ROWS", startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 42 }, fields: "pixelSize" } });
    reqs.splice(1, 0, { updateDimensionProperties: {
      range: { sheetId: csid, dimension: "COLUMNS", startIndex: 2, endIndex: 1 + headers.length },
      properties: { pixelSize: 224 }, fields: "pixelSize" } });
    reqs.push(headerCellRequest(csid, 0, 1, "DATE", "#FFFFFF", 16));
    payload.current_week.forEach((truck: any, idx: number) => {
      const col = idx + 2;
      reqs.push(headerCellRequest(csid, 0, col, truck.header.toUpperCase(), truck.driver_color, 14));
      truck.rows.forEach((row: any, i: number) => {
        if (row.chip) reqs.push(...fmtRequests(csid, 1 + i, col, row.chip, row.color, 10));
      });
    });
    await sheets.batchUpdate(reqs);
    currentWeekPushed = true;
  }

  // Records the push in History as an external effect, and (once Current
  // Week is written) stamps pushed_at so external chips take driver color.
  await rpc(req, "driver_week_mark_pushed", {
    p_from: payload.week_start, p_to: payload.week_end, p_mark_loads: currentWeekPushed,
    p_meta: { pushed_tabs: pushed, skipped_count: skipped.length, week_start: payload.week_start },
  });
  return json({ pushed, skipped, current_week: currentWeekPushed, week_start: payload.week_start });
});

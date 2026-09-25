// Motive ELD mileage sync (was /api/motive/sync-miles + MotiveClient, D48/D124).
//
// Needs the Supabase function secret MOTIVE_API_KEY (read-only Motive key).
// The key never leaves this function.

import { handle, HttpError, json, requireUser, rpc, fetchRetry } from "../_shared/common.ts";

const MOTIVE_BASE = "https://api.gomotive.com";

type Candidate = { id: string; scheduled_date: string; miles_adjusted: boolean; truck_number: string };

/** Per-truck-per-day miles from /v1/logs — faithful port of MotiveClient.daily_miles. */
export async function dailyMiles(key: string, start: string, end: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const add = (k: string, v: number) => out.set(k, (out.get(k) || 0) + v);
  let page = 1;
  while (true) {
    const r = await fetchRetry(
      `${MOTIVE_BASE}/v1/logs?start_date=${start}&end_date=${end}&per_page=100&page_no=${page}`,
      { headers: { "X-Api-Key": key, Accept: "application/json" } }, "Motive");
    if (!r.ok) throw new HttpError(502, `Motive returned HTTP ${r.status}: ${await r.text()}`);
    const data = await r.json();
    const logs: any[] = data.logs || [];
    for (const item of logs) {
      const lg = item.log || item;
      const date = lg.date;
      let captured = false;
      for (const [truckNo, segs] of Object.entries(lg.odometers || {})) {
        let miles = 0;
        for (const s of (segs as any[]) || []) {
          if (!s || typeof s !== "object") continue;
          const st = s.start || 0, en = s.end || 0;
          if (en >= st && st > 0) miles += en - st;   // skip zero/missing/reset readings
        }
        if (miles) { add(`${truckNo}|${date}`, miles); captured = true; }
      }
      // single-vehicle day with unusable odometer segments -> total_miles
      if (!captured && lg.total_miles && lg.vehicle_numbers && !String(lg.vehicle_numbers).includes(",")) {
        add(`${String(lg.vehicle_numbers).trim()}|${date}`, lg.total_miles);
      }
    }
    const pg = data.pagination || {};
    if (!logs.length || (pg.per_page ?? 100) * page >= (pg.total ?? 0)) break;
    page += 1;
  }
  return out;
}

export const handler = handle(async (req) => {
  await requireUser(req);
  const key = (Deno.env.get("MOTIVE_API_KEY") || "").trim();
  if (!key) {
    throw new HttpError(501, "Motive mileage sync needs the API key — set the MOTIVE_API_KEY " +
      "function secret in Supabase (SETUP.md, step 6).");
  }
  const rows = await rpc<Candidate[]>(req, "motive_sync_candidates", {});
  if (!rows.length) {
    return json({ filled: 0, unmatched: [], message: "Nothing to sync — all internal orders have mileage." });
  }
  const dates = rows.map((r) => r.scheduled_date).sort();
  const start = dates[0], end = dates[dates.length - 1];
  const miles = await dailyMiles(key, start, end);
  const unmatched = new Set<string>();
  const results = rows.map((r) => {
    const mi = miles.get(`${String(r.truck_number)}|${r.scheduled_date}`);
    if (mi === undefined) { unmatched.add(String(r.truck_number)); return { id: r.id, miles: null }; }
    return { id: r.id, miles: mi };
  });
  const applied = await rpc<{ filled: number }>(req, "motive_apply_miles", { p_results: results });
  return json({ filled: applied.filled, date_range: [start, end], unmatched: [...unmatched].sort() });
});

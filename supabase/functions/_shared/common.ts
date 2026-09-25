// Shared plumbing for the two Edge Functions.
//
// Both functions act AS THE SIGNED-IN CALLER: they forward the caller's own
// `apikey` + `Authorization` headers to the Data API, so every database read
// and write goes through the same RLS and audit-history triggers as the
// browser, and no Supabase secret/service key is needed at all. The only
// secrets these functions hold are the third-party ones (Motive key, Google
// service account), read from Supabase's function secrets — never from code.
//
// TODO(AUTH): requireUser() only checks that the caller has a valid login.
// With real per-person auth, also require an admin (the Python server kept
// Motive sync and the driver-tab push admin-only); the database functions
// they call already run dept12_require_admin(), which is still a stub.

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-dept12-route, x-dept12-label, " +
    "x-dept12-section, x-dept12-sub, x-dept12-external",
  "Access-Control-Max-Age": "3600",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function supabaseUrl(): string {
  const u = Deno.env.get("SUPABASE_URL");
  if (!u) throw new HttpError(500, "SUPABASE_URL is not available to this function.");
  return u.replace(/\/+$/, "");
}

/** Headers that make a Data API call run as the original caller. */
export function callerHeaders(req: Request): Record<string, string> {
  const h: Record<string, string> = {};
  const auth = req.headers.get("authorization");
  const key = req.headers.get("apikey");
  if (auth) h["Authorization"] = auth;
  if (key) h["apikey"] = key;
  for (const name of ["x-dept12-route", "x-dept12-label", "x-dept12-section", "x-dept12-sub", "x-dept12-external"]) {
    const v = req.headers.get(name);
    if (v) h[name] = v;
  }
  return h;
}

/** Rejects anyone without a valid Supabase Auth session. */
export async function requireUser(req: Request): Promise<{ id: string; email?: string }> {
  const auth = req.headers.get("authorization") || "";
  const key = req.headers.get("apikey") || "";
  if (!/^bearer\s+\S+/i.test(auth) || !key) throw new HttpError(401, "Sign in first.");
  const r = await fetch(supabaseUrl() + "/auth/v1/user", {
    headers: { Authorization: auth, apikey: key },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new HttpError(401, "Sign in first.");
  const user = await r.json();
  if (!user || !user.id) throw new HttpError(401, "Sign in first.");
  return user;
}

/** POST /rest/v1/rpc/<name> as the caller. Postgres errors surface verbatim. */
export async function rpc<T = unknown>(req: Request, name: string, args: Record<string, unknown>,
                                       extra: Record<string, string> = {}): Promise<T> {
  const r = await fetch(`${supabaseUrl()}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { ...callerHeaders(req), ...extra, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!r.ok) throw new HttpError(r.status >= 500 ? 500 : 400, (body && body.message) || text || `rpc ${name} failed`);
  return body as T;
}

/** fetch with a timeout and bounded exponential backoff on 429/5xx. */
export async function fetchRetry(url: string, init: RequestInit, label: string, attempts = 4): Promise<Response> {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
      if (r.status !== 429 && r.status < 500) return r;
      lastErr = new Error(`${label}: HTTP ${r.status} ${await r.text()}`);
    } catch (e) {
      lastErr = e;
    }
    if (i < attempts - 1) await new Promise((res) => setTimeout(res, 500 * 2 ** i + Math.random() * 250));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Wrap a handler with CORS preflight + uniform {error} responses. */
export function handle(fn: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
    if (req.method !== "POST") return json({ error: "Use POST." }, 405);
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  };
}

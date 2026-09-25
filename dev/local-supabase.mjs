#!/usr/bin/env node
// LOCAL TESTING ONLY — a tiny stand-in for a Supabase project so the static
// app, the migrations and the Edge Functions can be exercised on one machine
// before anything touches a real project. Not used in production.
//
//   /rest/v1/*       → a local PostgREST (the same engine Supabase runs)
//   /auth/v1/*       → password sign-in for ONE test account, HS256 JWTs
//   /storage/v1/*    → private bucket emulated in dev/.storage/
//   /functions/v1/*  → the real Edge Function handlers, run by Deno
//   everything else  → the static app files
//
// Usage (see dev/README.md): node dev/local-supabase.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = +(process.env.PORT || 8790);
const PGRST = process.env.PGRST_URL || "http://127.0.0.1:3000";
const SECRET = process.env.JWT_SECRET || "local-dev-jwt-secret-at-least-32-characters!!";
const EMAIL = process.env.TEST_EMAIL || "dispatch@example.test";
const PASSWORD = process.env.TEST_PASSWORD || "local-test-password";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const STORE = path.join(ROOT, "dev", ".storage");
const FN_PORTS = { "motive-sync": 8791, "sheets-push": 8792 };
fs.mkdirSync(STORE, { recursive: true });

const b64u = (b) => Buffer.from(b).toString("base64url");
function sign(claims) {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64u(JSON.stringify(claims));
  return `${h}.${p}.${crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
}
function verify(tok) {
  const [h, p, s] = String(tok || "").split(".");
  if (!s || crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url") !== s) return null;
  const c = JSON.parse(Buffer.from(p, "base64url").toString());
  return c.exp > Date.now() / 1000 ? c : null;
}
export const ANON_KEY = sign({ role: "anon", iss: "local", exp: 4102444800 });
const user = { id: USER_ID, email: EMAIL, role: "authenticated", user_metadata: {} };
function session() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return { access_token: sign({ sub: USER_ID, email: EMAIL, role: "authenticated", exp }),
           token_type: "bearer", expires_in: 3600, expires_at: exp,
           refresh_token: crypto.randomBytes(16).toString("hex"), user };
}
const cors = {
  "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "*",
};
function send(res, code, body, type = "application/json") {
  res.writeHead(code, { ...cors, "Content-Type": type });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const readBody = (req) => new Promise((ok) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c))); });
const claimsOf = (req) => verify((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
const safe = (k) => { const f = path.normalize(path.join(STORE, k)); if (!f.startsWith(STORE)) throw new Error("bad key"); return f; };

async function proxy(req, res, target, bodyBuf) {
  const headers = { ...req.headers };
  for (const k of ["host", "content-length", "transfer-encoding", "connection", "expect"]) delete headers[k];
  const r = await fetch(target, { method: req.method, headers,
    body: ["GET", "HEAD"].includes(req.method) || !bodyBuf.length ? undefined : bodyBuf });
  const out = Buffer.from(await r.arrayBuffer());
  const h = { ...cors };
  r.headers.forEach((v, k) => { if (!["content-encoding", "transfer-encoding", "connection", "content-length"].includes(k)) h[k] = v; });
  res.writeHead(r.status, h); res.end(out);
}

const signed = new Map();   // token -> object key
const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png",
               ".gz": "application/gzip", ".wasm": "application/wasm", ".json": "application/json" };

http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return send(res, 204, "");
    const u = new URL(req.url, `http://localhost:${PORT}`);
    const body = await readBody(req);
    if (u.pathname.startsWith("/rest/v1/")) {
      if (!req.headers.apikey) return send(res, 401, { message: "No API key found in request" });
      if (!req.headers.authorization) req.headers.authorization = `Bearer ${req.headers.apikey}`;
      return await proxy(req, res, PGRST + u.pathname.slice(8) + u.search, body);
    }
    if (u.pathname.startsWith("/auth/v1/")) {
      const p = u.pathname.slice(9), j = body.length ? JSON.parse(body) : {};
      if (p === "token" && u.searchParams.get("grant_type") === "password") {
        if (j.email !== EMAIL || j.password !== PASSWORD) return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials" });
        return send(res, 200, session());
      }
      if (p === "token" && u.searchParams.get("grant_type") === "refresh_token") return send(res, 200, session());
      if (p === "user") return claimsOf(req) ? send(res, 200, user) : send(res, 401, { msg: "invalid JWT" });
      if (p === "logout") return send(res, 204, "");
      return send(res, 404, { msg: "not emulated" });
    }
    if (u.pathname.startsWith("/storage/v1/")) {
      const p = decodeURIComponent(u.pathname.slice(12));
      if (p.startsWith("object/signed/documents/")) {
        const key = signed.get(u.searchParams.get("token"));
        if (!key || key !== p.slice(24)) return send(res, 400, { message: "invalid signature" });
        return send(res, 200, fs.readFileSync(safe(key)), MIME[path.extname(key)] || "application/pdf");
      }
      if (!claimsOf(req)) return send(res, 403, { message: "new row violates row-level security policy" });
      if (p === "object/move") {
        const j = JSON.parse(body); fs.mkdirSync(path.dirname(safe(j.destinationKey)), { recursive: true });
        fs.renameSync(safe(j.sourceKey), safe(j.destinationKey)); return send(res, 200, { message: "Successfully moved" });
      }
      if (p.startsWith("object/sign/documents/")) {
        const key = p.slice(22); if (!fs.existsSync(safe(key))) return send(res, 404, { message: "Object not found" });
        const t = crypto.randomBytes(12).toString("hex"); signed.set(t, key);
        return send(res, 200, { signedURL: `/object/signed/documents/${key.split("/").map(encodeURIComponent).join("/")}?token=${t}` });
      }
      if (p.startsWith("object/authenticated/documents/")) {
        const f = safe(p.slice(31)); if (!fs.existsSync(f)) return send(res, 404, { message: "Object not found" });
        return send(res, 200, fs.readFileSync(f), "application/octet-stream");
      }
      if (p === "object/documents" && req.method === "DELETE") {
        for (const k of JSON.parse(body).prefixes || []) fs.rmSync(safe(k), { force: true });
        return send(res, 200, []);
      }
      if (p.startsWith("object/documents/") && req.method === "POST") {
        const f = safe(p.slice(17)); if (fs.existsSync(f)) return send(res, 400, { message: "The resource already exists" });
        fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body);
        return send(res, 200, { Key: "documents/" + p.slice(17) });
      }
      return send(res, 404, { message: "not emulated" });
    }
    if (u.pathname.startsWith("/functions/v1/")) {
      const name = u.pathname.slice(14).split("/")[0];
      if (!FN_PORTS[name]) return send(res, 404, { error: "no such function" });
      return await proxy(req, res, `http://127.0.0.1:${FN_PORTS[name]}/`, body);
    }
    let f = path.normalize(path.join(ROOT, u.pathname === "/" ? "index.html" : u.pathname));
    if (!f.startsWith(ROOT) || f.includes(`${path.sep}dev${path.sep}`) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, "not found", "text/plain");
    if (u.pathname === "/config.js") {
      return send(res, 200, `window.DEPT12_CONFIG={supabaseUrl:"http://localhost:${PORT}",supabaseKey:${JSON.stringify(ANON_KEY)}};`, "application/javascript");
    }
    return send(res, 200, fs.readFileSync(f), MIME[path.extname(f)] || "application/octet-stream");
  } catch (e) {
    console.error(e); send(res, 500, { message: String(e.message || e) });
  }
}).listen(PORT, () => {
  console.log(`local Supabase stand-in → http://localhost:${PORT}   (login: ${EMAIL} / ${PASSWORD})`);
});

// Edge Functions, each on its own port, with SUPABASE_URL pointing back here.
for (const [name, port] of Object.entries(FN_PORTS)) {
  const env = { ...process.env, SUPABASE_URL: `http://localhost:${PORT}` };
  const p = spawn("deno", ["run", "--quiet", "--allow-net", "--allow-env", "--allow-read",
    path.join(ROOT, "dev", "serve-function.ts"), name, String(port)], { env, stdio: "inherit" });
  process.on("exit", () => p.kill());
}
process.on("SIGINT", () => process.exit(0));

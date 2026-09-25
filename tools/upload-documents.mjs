#!/usr/bin/env node
// Upload the local document files (the Python app's app/storage folder) into
// the private Supabase Storage bucket "documents", keeping every file at the
// exact same relative path the database's documents.storage_path expects.
// SETUP.md, step 8.
//
//   SUPABASE_URL        https://<ref>.supabase.co
//   SUPABASE_SECRET_KEY a *secret* key (sb_secret_… or legacy service_role).
//                       Type it into your terminal only — it bypasses all
//                       security and must never be committed or shared.
//   STORAGE_DIR         folder to upload, e.g. "…/building dept 12 dashboard/app/storage"
//
// Safe to re-run: files that are already uploaded are skipped, never overwritten.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const URL_ = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SECRET_KEY || "";
const DIR = process.env.STORAGE_DIR || "";
if (!URL_ || !KEY || !DIR) {
  console.error("Set SUPABASE_URL, SUPABASE_SECRET_KEY and STORAGE_DIR (see SETUP.md step 8).");
  process.exit(1);
}
const MIME = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
               ".gif": "image/gif", ".webp": "image/webp", ".txt": "text/plain", ".csv": "text/csv" };
const headers = { apikey: KEY, "x-upsert": "false" };
if (KEY.startsWith("eyJ")) headers.Authorization = `Bearer ${KEY}`;   // legacy JWT-style key

function* walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const f = path.join(d, e.name);
    if (e.isDirectory()) yield* walk(f); else yield f;
  }
}

let uploaded = 0, skipped = 0, failed = 0;
const manifest = [];
for (const file of walk(DIR)) {
  const key = path.relative(DIR, file).split(path.sep).join("/");
  const bytes = fs.readFileSync(file);
  manifest.push(`${crypto.createHash("sha256").update(bytes).digest("hex")}  ${bytes.length}  ${key}`);
  const r = await fetch(`${URL_}/storage/v1/object/documents/${key.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" },
    body: bytes,
  });
  if (r.ok) uploaded++;
  else {
    const t = await r.text();
    if (/already exists|Duplicate/i.test(t)) skipped++;
    else { failed++; console.error(`FAILED ${key}: HTTP ${r.status} ${t.slice(0, 200)}`); }
  }
  if ((uploaded + skipped + failed) % 50 === 0) console.log(`… ${uploaded + skipped + failed} files`);
}
console.log(`Uploaded ${uploaded}, already there ${skipped}, failed ${failed}.`);
fs.writeFileSync("upload-manifest.txt", manifest.join("\n") + "\n");
console.log("Wrote upload-manifest.txt (sha256, bytes, path) — keep it private; it lists real file names.");
process.exit(failed ? 1 : 0);

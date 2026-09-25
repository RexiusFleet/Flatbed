# Dept 12 Dashboard (Supabase edition) — agent notes

Static site + Supabase. Read `docs/ARCHITECTURE.md` (where everything
lives now) and `docs/reference/original-CLAUDE.md` (business rules and
Traps — still authoritative for the UI in `app.js`) before changing
anything. When a rule's reasoning isn't clear, ask Nate rather than guess.

## Rules

- **Never commit secrets or real data.** Motive/Google keys live only in
  Supabase function secrets; the secret/service key is only ever typed into
  a terminal. `config.js` holds only the public URL + publishable key.
- **Driver mirror sheet ID never changes** — it's a constant in
  `supabase/functions/sheets-push/handler.ts`; never make it configurable
  and never point anything at the dispatcher sheet `1KlPQ…`.
- **Where logic goes:** multi-statement or guarded rules → a Postgres
  `api_*` function (new migration); single-row CRUD → REST in
  `supabase-api.js`; only third-party-secret calls → an Edge Function.
- **Migrations are append-only.** Never edit an applied file; add a new
  one. Every new mutable table needs the `dept12_history_capture` trigger,
  RLS enabled, a policy, and an explicit `grant … to authenticated`.
- **History labels:** a new route needs an entry in `HISTORY_LABELS` /
  `scopeFor` in `supabase-api.js`, or History shows a generic label.
- **Auth is a stub (`TODO(AUTH)`).** Don't build features that assume
  per-person identity; don't loosen anything further (no `anon` access,
  sign-ups stay off).
- Verify with the harness in `dev/` (`node dev/smoke-test.mjs`) and in a
  browser before calling anything done.

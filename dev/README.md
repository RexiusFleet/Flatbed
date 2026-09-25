# Local test harness (developers only)

Runs the whole app on one Mac with no Supabase account, to check changes
before they touch a real project. Nothing here is used in production.

Pieces:

- `supabase-shim.sql` — the few Supabase platform objects (roles, `auth.*`,
  a minimal `storage` schema) plain Postgres lacks. **Only for a scratch
  database** — a real Supabase project already has all of these.
- `postgrest.conf` — PostgREST (the same engine behind Supabase's Data
  API) pointed at the scratch database `flatbed_test`.
- `local-supabase.mjs` — one Node server that plays Supabase: proxies
  `/rest/v1` to PostgREST, fakes Auth for one test login, keeps Storage
  objects in `dev/.storage/` (gitignored), runs the real Edge Function
  handlers under Deno, and serves the static app with a generated
  `config.js`.
- `smoke-test.mjs` — drives the real `supabase-api.js` through every
  ported route (it changes data — scratch database only).

## Run it

```bash
brew install postgrest deno
```

```bash
createdb -h /tmp flatbed_test && psql -h /tmp -d flatbed_test -f dev/supabase-shim.sql && for f in supabase/migrations/*.sql; do psql -h /tmp -d flatbed_test -v ON_ERROR_STOP=1 -q -f "$f" || break; done
```

Optional — seed it: `psql -h /tmp -d flatbed_test -f supabase/seed.sql`
(synthetic), or copy your local data in with
`SOURCE_DB="dbname=dept12 host=/tmp" TARGET_DB="dbname=flatbed_test host=/tmp" ./tools/import-local-data.sh`.

```bash
postgrest dev/postgrest.conf
```

```bash
node dev/local-supabase.mjs
```

Open http://localhost:8790 and sign in with `dispatch@example.test` /
`local-test-password`. Then:

```bash
node dev/smoke-test.mjs
```

The Google push confirm step and Motive sync stop with a clear "needs the
… secret" message here, by design — there are no real keys locally, and a
real push would write the drivers' live mirror sheet.

#!/usr/bin/env bash
# Copy the business data from the local Mac Postgres (the Python-era app)
# into the Supabase project, AFTER all migrations have been applied there.
# SETUP.md, step 7 walks through it.
#
#   SOURCE_DB  local database         default: "dbname=dept12 host=/tmp"
#   TARGET_DB  Supabase connection string (Session pooler or Direct), e.g.
#              postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
#
# The password is only ever typed into your own terminal. It is not stored
# anywhere by this script and must never be committed.
#
# What it does:
#   1. dumps DATA ONLY from the local database (never the audit history,
#      never table definitions — those come from the migrations);
#   2. in ONE transaction on Supabase: empties every app table (the
#      migrations seed a few default rows that the real data replaces),
#      loads the dump with triggers off, clears any audit rows, commits.
#   If anything fails, the transaction rolls back and Supabase is unchanged.
set -euo pipefail

SOURCE_DB="${SOURCE_DB:-dbname=dept12 host=/tmp}"
: "${TARGET_DB:?Set TARGET_DB to your Supabase connection string (see SETUP.md step 7)}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT   # the dump is real business data — never leave it lying around
DUMP="$TMP/data.sql"

echo "→ Dumping data from the local database…"
pg_dump "$SOURCE_DB" --data-only --no-owner --no-privileges \
  --exclude-table=audit_events --exclude-table=audit_changes \
  --exclude-table-data='storage.*' --schema=public -f "$DUMP"
# pg_dump 17 writes "SET transaction_timeout", which older servers reject.
sed -i.bak '/^SET transaction_timeout/d' "$DUMP"

echo "→ Row counts in the local database:"
psql "$SOURCE_DB" -Atc "select 'orders '||count(*) from orders union all select 'loads '||count(*) from loads
                        union all select 'documents '||count(*) from documents union all select 'parties '||count(*) from parties"

echo "→ Loading into Supabase (single transaction)…"
TABLES=$(psql "$TARGET_DB" -Atc "select string_agg(format('public.%I', tablename), ', ') from pg_tables
                                 where schemaname = 'public' and tablename not in ('audit_events', 'audit_changes')")
{
  echo "\\set ON_ERROR_STOP on"
  echo "begin;"
  echo "set local session_replication_role = replica;"
  echo "truncate $TABLES cascade;"
  echo "\\i $DUMP"
  echo "set local session_replication_role = origin;"
  echo "truncate public.audit_changes, public.audit_events;"
  echo "commit;"
} | psql "$TARGET_DB" -q -v ON_ERROR_STOP=1 > "$TMP/load.log"

echo "→ Row counts now in Supabase:"
psql "$TARGET_DB" -Atc "select 'orders '||count(*) from orders union all select 'loads '||count(*) from loads
                        union all select 'documents '||count(*) from documents union all select 'parties '||count(*) from parties"
echo "Done. Compare the two sets of counts above — they should match."
echo "Next: upload the document files (SETUP.md step 8)."

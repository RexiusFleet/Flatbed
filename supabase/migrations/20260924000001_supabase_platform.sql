-- Supabase hosting: security baseline, audit-history adaptation, storage.
--
-- Everything before this file is the unchanged local schema history. This
-- migration adapts it to a browser that talks to Supabase's Data API
-- (PostgREST) directly, which the local Python server never allowed:
--
--   1. Business dates are Pacific, not the hosted default of UTC.
--   2. Every public table has RLS on with a real (currently permissive)
--      policy for the `authenticated` role, and explicit grants — never for
--      `anon`. The publishable key alone reaches nothing.
--   3. The audit-history trigger no longer uses a session-level setting
--      (PostgREST pools connections, so it would leak between requests —
--      the exact D131 trap) and labels each event from request headers.
--   4. The four reporting views run with the caller's rights.
--   5. A private `documents` Storage bucket replaces app/storage/.
--   6. The 14-day history purge (D169) runs as a pg_cron job.
--
-- ============================================================================
-- TODO(AUTH) — NOT SAFE FOR REAL USERS OR THE PUBLIC INTERNET YET.
-- Every policy below is `to authenticated using (true)`: anyone holding ANY
-- valid login for this Supabase project can read and change everything.
-- The app currently signs everybody in with one shared account. The real
-- follow-up is: per-person Supabase Auth accounts mapped to app_users
-- (auth_user_id), then replace dept12_is_admin() below (and dept12_enforce_view_window() in the next migration) and
-- tighten these policies. See SETUP.md → "Before real users".
-- ============================================================================

-- 1. Pacific business dates (current_date, delivery dates, assignments). ----
do $$ begin
  execute format('alter database %I set timezone to %L', current_database(), 'America/Los_Angeles');
end $$;
set timezone to 'America/Los_Angeles';

-- 2. RLS + policies + grants on every public table. --------------------------
do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('alter table %I enable row level security', t.relname);
    execute format('revoke all on table %I from anon', t.relname);
    if t.relname in ('audit_events', 'audit_changes') then
      -- Audit evidence is reachable only through the security-definer
      -- history functions (api_history_*), never directly.
      execute format('revoke all on table %I from authenticated', t.relname);
      continue;
    end if;
    execute format('grant select, insert, update, delete on table %I to authenticated', t.relname);
    if not exists (select 1 from pg_policy p join pg_class pc on pc.oid = p.polrelid
                   where pc.relname = t.relname and pc.relnamespace = 'public'::regnamespace) then
      -- TODO(AUTH): permissive staff policy, same shape the original
      -- migrations used for the tables they covered.
      execute format('create policy %I on %I for all to authenticated using (true) with check (true)',
                     t.relname || '_staff_all', t.relname);
    end if;
  end loop;
end $$;

grant usage on schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on all sequences in schema public from anon;

-- 4. Views: evaluate with the caller's permissions (and so the caller's RLS).
alter view v_orders_reporting    set (security_invoker = true);
alter view v_loads_reporting     set (security_invoker = true);
alter view v_loads_missing_pod   set (security_invoker = true);
alter view v_freight_transfer_weekly set (security_invoker = true);
revoke all on v_orders_reporting, v_loads_reporting, v_loads_missing_pod, v_freight_transfer_weekly from anon;
grant select on v_orders_reporting, v_loads_reporting, v_loads_missing_pod, v_freight_transfer_weekly to authenticated;

-- ── Auth stubs ───────────────────────────────────────────────────────────────
-- TODO(AUTH): these three functions are the ONLY place authorization is
-- decided today, and they all say "yes". Real auth replaces their bodies
-- (look up app_users by auth.uid(), check is_admin / app_user_grants) — no
-- caller needs to change.
create or replace function dept12_actor_name() returns text
language sql stable set search_path = public, pg_temp as $$
  select coalesce(nullif(auth.jwt() ->> 'email', ''), 'System')
$$;

create or replace function dept12_is_admin() returns boolean
language sql stable set search_path = public, pg_temp as $$
  -- TODO(AUTH): return exists (select 1 from app_users u
  --   where u.auth_user_id = auth.uid() and u.is_admin);
  select coalesce(auth.jwt() ->> 'role', '') in ('authenticated', 'service_role')
$$;

create or replace function dept12_require_admin() returns void
language plpgsql stable set search_path = public, pg_temp as $$
begin
  if not dept12_is_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
end $$;

-- 3. Audit history, adapted for PostgREST. ---------------------------------
-- One HTTP request = one transaction = one audit event. The browser sends
-- x-dept12-route / x-dept12-label / x-dept12-section / x-dept12-sub headers
-- (the same labels the Python server used, HISTORY_LABELS) and the first
-- changed row creates the event. The event id is stored transaction-locally,
-- so it can never leak onto the next request that reuses the connection.
create or replace function dept12_request_header(name text) returns text
language sql stable set search_path = public, pg_temp as $$
  select nullif(current_setting('request.headers', true), '')::json ->> lower(name)
$$;

create or replace function dept12_begin_event(
  p_route text, p_label text, p_action_key text default null,
  p_reversible boolean default true, p_external boolean default false,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare ev uuid;
begin
  insert into audit_events (actor_name, route, action_key, label, section, sub,
                            reversible, external_effect, metadata)
  values (dept12_actor_name(), p_route, coalesce(p_action_key, p_route, 'database.direct'),
          coalesce(nullif(p_label, ''), 'Direct database change'),
          dept12_request_header('x-dept12-section'), dept12_request_header('x-dept12-sub'),
          p_reversible, p_external, coalesce(p_metadata, '{}'::jsonb))
  returning id into ev;
  perform set_config('dept12.history_event_id', ev::text, true);
  return ev;
end $$;

create or replace function dept12_capture_history() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  event_text text := current_setting('dept12.history_event_id', true);
  event_uuid uuid;
  old_data jsonb;
  new_data jsonb;
  old_cmp jsonb;
  new_cmp jsonb;
  pk jsonb := '{}'::jsonb;
  pk_col text;
  fields text[];
  next_sequence integer;
  hdr_route text;
  hdr_external boolean;
begin
  if event_text is null or event_text = '' then
    hdr_route := dept12_request_header('x-dept12-route');
    hdr_external := coalesce(dept12_request_header('x-dept12-external'), '') = '1';
    event_uuid := dept12_begin_event(
      hdr_route,
      coalesce(dept12_request_header('x-dept12-label'),
               case when hdr_route is null then 'Direct database change' end),
      case when hdr_route is null then 'database.direct' end,
      true, hdr_external,
      case when hdr_route is null then jsonb_build_object('source', 'database trigger')
           else '{}'::jsonb end);
  else
    event_uuid := event_text::uuid;
  end if;

  old_data := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  new_data := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;

  old_cmp := coalesce(old_data, '{}'::jsonb) - 'updated_at';
  new_cmp := coalesce(new_data, '{}'::jsonb) - 'updated_at';
  if tg_op = 'UPDATE' and old_cmp = new_cmp then
    return new;
  end if;

  foreach pk_col in array string_to_array(tg_argv[0], ',') loop
    pk := pk || jsonb_build_object(pk_col, coalesce(new_data, old_data) -> pk_col);
  end loop;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}') into fields
    from (
      select key as k
      from jsonb_object_keys(old_cmp || new_cmp) as keys(key)
      where old_cmp -> key is distinct from new_cmp -> key
    ) changed;
  else
    select coalesce(array_agg(key order by key), '{}') into fields
    from jsonb_object_keys(case when tg_op = 'INSERT' then new_cmp else old_cmp end) as keys(key);
  end if;

  select coalesce(max(change_sequence), 0) + 1 into next_sequence
  from audit_changes where event_id = event_uuid;

  insert into audit_changes (
    event_id, change_sequence, table_schema, table_name, operation,
    primary_key, changed_fields, before_data, after_data
  ) values (
    event_uuid, next_sequence, tg_table_schema, tg_table_name, tg_op,
    pk, fields, old_data, new_data
  );

  update audit_events
  set change_count = change_count + 1,
      completed_at = now(),
      affected_tables = case
        when tg_table_name = any(affected_tables) then affected_tables
        else array_append(affected_tables, tg_table_name)
      end
  where id = event_uuid;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Every mutable table keeps its capture trigger (CLAUDE.md rule). Re-assert
-- so a table added by any earlier migration without one is covered.
do $$
declare rec record;
begin
  for rec in
    select c.relname as table_name,
           string_agg(a.attname, ',' order by key_cols.ordinality) as pk_columns
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_index i on i.indrelid = c.oid and i.indisprimary
    join unnest(i.indkey) with ordinality key_cols(attnum, ordinality) on true
    join pg_attribute a on a.attrelid = c.oid and a.attnum = key_cols.attnum
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname not in ('audit_events', 'audit_changes')
    group by c.relname
  loop
    execute format('drop trigger if exists dept12_history_capture on %I', rec.table_name);
    execute format(
      'create trigger dept12_history_capture after insert or update or delete on %I '
      'for each row execute function dept12_capture_history(%L)',
      rec.table_name, rec.pk_columns);
  end loop;
end $$;

-- 6. 14-day history retention (D169). ---------------------------------------
create or replace function dept12_history_purge() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  with old as (select id from audit_events where occurred_at < now() - interval '14 days'),
       gone as (delete from audit_changes where event_id in (select id from old) returning 1)
  select count(*) into n from old;
  delete from audit_events where occurred_at < now() - interval '14 days';
  return n;
end $$;
revoke all on function dept12_history_purge() from public, anon, authenticated;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('dept12-history-purge', '17 3 * * *', 'select public.dept12_history_purge()');
exception when others then
  -- pg_cron isn't available (plain local Postgres). api_history_list also
  -- purges opportunistically, so retention still happens.
  raise notice 'pg_cron unavailable, history purge runs from api_history_list only: %', sqlerrm;
end $$;

-- 5. Private document storage. ----------------------------------------------
-- Object path = documents.storage_path, unchanged from the local layout
-- ("<order-id or unmatched>/<doc-uuid>_<filename>"). Files are only ever
-- fetched through short-lived signed URLs by a signed-in user.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public)
    values ('documents', 'documents', false)
    on conflict (id) do update set public = false;

    drop policy if exists dept12_documents_staff_all on storage.objects;
    -- TODO(AUTH): any signed-in account can read/write every document.
    create policy dept12_documents_staff_all on storage.objects
      for all to authenticated
      using (bucket_id = 'documents') with check (bucket_id = 'documents');
  end if;
end $$;

-- Functions are never callable by anon. (api_* functions grant themselves
-- to authenticated in the next migration.)
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and (p.proname like 'dept12\_%' or p.proname = 'set_updated_at')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on function dept12_actor_name(), dept12_is_admin(), dept12_require_admin(),
  dept12_request_header(text) to authenticated;

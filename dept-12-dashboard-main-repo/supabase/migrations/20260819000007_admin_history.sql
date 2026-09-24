-- D131: immutable, admin-only application history.
--
-- One audit_event is a user-visible action/request; audit_changes contains the
-- exact row versions changed by it.  Application requests set
-- dept12.history_event_id on their Postgres connection before mutating data.
-- Triggers do the rest, including cascades and changes made by future routes.
-- History tables deliberately have no audit trigger: a restore appends a new
-- event and never rewrites its own evidence.

create table audit_events (
  id                       uuid primary key default gen_random_uuid(),
  sequence                 bigserial unique not null,
  occurred_at              timestamptz not null default now(),
  completed_at             timestamptz,
  actor_user_id            uuid references app_users(id) on delete set null,
  actor_name               text not null,
  route                    text,
  action_key               text not null,
  label                    text not null,
  section                  text,
  sub                      text,
  reversible               boolean not null default true,
  external_effect          boolean not null default false,
  change_count             integer not null default 0,
  affected_tables          text[] not null default '{}',
  metadata                 jsonb not null default '{}'::jsonb,
  reverts_event_id         uuid references audit_events(id) on delete set null,
  reverted_by_event_id     uuid references audit_events(id) on delete set null,
  superseded_by_event_id   uuid references audit_events(id) on delete set null
);

create index audit_events_sequence_desc_idx on audit_events (sequence desc);
create index audit_events_actor_idx on audit_events (actor_user_id, sequence desc);

create table audit_changes (
  id              bigserial primary key,
  event_id        uuid not null references audit_events(id) on delete restrict,
  change_sequence integer not null,
  table_schema    text not null default 'public',
  table_name      text not null,
  operation       text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  primary_key     jsonb not null,
  changed_fields  text[] not null default '{}',
  before_data     jsonb,
  after_data      jsonb,
  unique (event_id, change_sequence)
);

create index audit_changes_event_idx on audit_changes (event_id, change_sequence);

alter table audit_events  enable row level security;
alter table audit_changes enable row level security;

-- Intentionally no `authenticated` policy. Unlike the operational tables,
-- audit evidence is never directly staff-readable; only the trusted server's
-- owner/service connection can reach it, after the application admin check.

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
begin
  if event_text is null or event_text = '' then
    -- Imports/maintenance scripts may write outside the HTTP server. Capture
    -- those too under one connection-scoped System event instead of silently
    -- losing them. The first changed row creates the event; later rows on the
    -- same script connection reuse it.
    insert into audit_events
      (actor_name, action_key, label, route, metadata)
    values
      ('System', 'database.direct', 'Direct database change', null,
       jsonb_build_object('source', 'database trigger'))
    returning id into event_uuid;
    perform set_config('dept12.history_event_id', event_uuid::text, false);
  else
    event_uuid := event_text::uuid;
  end if;

  old_data := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  new_data := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;

  -- updated_at is mechanical noise.  Keep it in the snapshots for conflict
  -- checks, but do not create an audit row when it is the only difference.
  old_cmp := coalesce(old_data, '{}'::jsonb) - 'updated_at';
  new_cmp := coalesce(new_data, '{}'::jsonb) - 'updated_at';
  if tg_op = 'UPDATE' and old_cmp = new_cmp then
    return new;
  end if;

  foreach pk_col in array string_to_array(tg_argv[0], ',') loop
    pk := pk || jsonb_build_object(
      pk_col,
      coalesce(new_data, old_data) -> pk_col
    );
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

-- Install the capture trigger on every current table that has a primary key.
-- The primary-key column list is passed to the trigger so composite-key tables
-- (scheduler notes, sheet cells, row order, etc.) restore correctly too.
do $$
declare
  rec record;
begin
  for rec in
    select c.relname as table_name,
           string_agg(a.attname, ',' order by key_cols.ordinality) as pk_columns
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_index i on i.indrelid = c.oid and i.indisprimary
    join unnest(i.indkey) with ordinality key_cols(attnum, ordinality) on true
    join pg_attribute a on a.attrelid = c.oid and a.attnum = key_cols.attnum
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname not in ('audit_events', 'audit_changes')
    group by c.relname
  loop
    execute format('drop trigger if exists dept12_history_capture on %I', rec.table_name);
    execute format(
      'create trigger dept12_history_capture after insert or update or delete on %I '
      'for each row execute function dept12_capture_history(%L)',
      rec.table_name, rec.pk_columns
    );
  end loop;
end $$;

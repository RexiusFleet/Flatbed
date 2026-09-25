-- Supabase hosting: the Python server's routes, ported to Postgres functions.
--
-- The browser calls these through PostgREST (`POST /rest/v1/rpc/<name>`).
-- Each one is a faithful port of the matching handler in the old
-- app/server.py — same validation messages, same guards, same return shape —
-- so the dashboard client didn't have to change its expectations. A port
-- note ("was api_xxx") sits on each function. Each call runs in ONE
-- transaction (the Python server ran most statements in autocommit), so a
-- failed guard can no longer leave half an action behind.
--
-- Routes that are plain single-row CRUD (add a driver, rename a database,
-- toggle billed, ...) are NOT here; the browser does those with ordinary
-- REST calls under RLS (see supabase-api.js).
--
-- SECURITY DEFINER is used only for guarded business rules that must hold
-- even once per-user RLS gets stricter (order numbering, cancel/delete
-- locks, bulk freight pricing, delivery-date sync, history). Everything else
-- is SECURITY INVOKER, i.e. subject to the caller's RLS like a REST call.
--
-- TODO(AUTH): admin-only routes call dept12_require_admin(), and
-- Scheduler writes call dept12_enforce_view_window(); both are stubs that
-- allow everything until real per-user auth exists (see the platform
-- migration). The per-section edit grants (old API_PERMISSIONS table) are
-- not enforced at all yet.

set timezone to 'America/Los_Angeles';

-- ═══ Shared helpers ══════════════════════════════════════════════════════

-- JSON "" → null, the way every Python handler normalised form input.
create or replace function dept12_blank(v jsonb) returns jsonb
language sql immutable as $$
  select case when v is null or v = 'null'::jsonb or v = '""'::jsonb then null else v end
$$;

create or replace function dept12_txt(d jsonb, k text) returns text
language sql immutable as $$ select nullif(d ->> k, '') $$;

-- Python's `d.get(k) or None`: also treats 0/false as missing.
create or replace function dept12_truthy(v jsonb) returns jsonb
language sql immutable as $$
  select case when v is null or v in ('null'::jsonb, '""'::jsonb, '0'::jsonb, 'false'::jsonb) then null
              when jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric = 0 then null
              else v end
$$;

-- Generic allow-listed partial update: `update <table> set <allowed keys
-- present in patch> where id = p_id returning *`. Values are coerced with
-- jsonb_populate_record, so JSON strings/numbers/booleans land in their
-- real column types exactly like psycopg's parameter binding did.
create or replace function dept12_patch(p_table regclass, p_id uuid, p_patch jsonb, p_allowed text[])
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  cols text[];
  clean jsonb;
  res jsonb;
begin
  select array_agg(key order by key),
         jsonb_object_agg(key, coalesce(dept12_blank(value), 'null'::jsonb))
    into cols, clean
  from jsonb_each(coalesce(p_patch, '{}'::jsonb)) where key = any(p_allowed);
  if cols is null then
    execute format('select to_jsonb(t) from %s t where id = $1', p_table) into res using p_id;
    return res;
  end if;
  execute format(
    'update %1$s t set (%2$s) = (select %2$s from jsonb_populate_record(null::%1$s, $1)) '
    'where t.id = $2 returning to_jsonb(t)',
    p_table, (select string_agg(format('%I', c), ', ') from unnest(cols) c)
  ) into res using clean, p_id;
  return res;
end $$;

-- TODO(AUTH): restricted users' Scheduler date window (D125/D126). The
-- stub account is an admin, so this currently never blocks. When real auth
-- lands: look up the caller's app_users row; if not admin, apply
-- view_start/view_end or the rolling 3-weeks-back/1-week-forward default
-- and raise 'That date is outside your permitted Scheduler range.'
create or replace function dept12_enforce_view_window(variadic p_dates date[])
returns void language plpgsql stable set search_path = public, pg_temp as $$
begin
  if dept12_is_admin() then return; end if;
  raise exception 'That date is outside your permitted Scheduler range.';
end $$;

create or replace function dept12_is_invoiced(p_load uuid) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from invoices where load_id = p_load)
$$;

create or replace function dept12_load_for_order(p_order uuid, out id uuid, out scheduled_date date)
language sql stable set search_path = public, pg_temp as $$
  select l.id, l.scheduled_date from loads l join load_orders lo on lo.load_id = l.id
  where lo.order_id = p_order limit 1
$$;

create or replace function dept12_sync_simple_order_stops(p_order uuid)
returns void language plpgsql set search_path = public, pg_temp as $$
declare o record;
begin
  select id, kind, route_mode, is_transfer, pickup_location_id, delivery_location_id,
         po_number, delivery_number
    into o from orders where id = p_order;
  if not found or o.kind <> 'external' or o.is_transfer or o.route_mode <> 'simple' then
    return;
  end if;
  insert into order_stops (order_id, sequence, stop_type, location_id, reference_number)
  values (p_order, 1, 'pickup', o.pickup_location_id, o.po_number),
         (p_order, 2, 'delivery', o.delivery_location_id, o.delivery_number)
  on conflict (order_id, sequence) do update set
    stop_type = excluded.stop_type, location_id = excluded.location_id,
    reference_number = excluded.reference_number;
  delete from order_stops where order_id = p_order and sequence > 2;
end $$;

create or replace function dept12_sync_load_stops(p_load uuid, p_order uuid)
returns void language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from documents d join load_stops s on s.id = d.load_stop_id
             where s.load_id = p_load) then
    raise exception 'This scheduled route has stop-specific paperwork and can no longer be replaced.';
  end if;
  delete from load_stops where load_id = p_load;
  insert into load_stops (load_id, sequence, stop_type, location_id, order_id, order_stop_id,
                          scheduled_at, appointment_required, notes)
  select p_load, sequence, stop_type, location_id, order_id, id,
         scheduled_at, appointment_required, notes
  from order_stops where order_id = p_order order by sequence;
end $$;

-- was _order_mutation_guard (D93/D29)
create or replace function dept12_order_mutation_guard(p_order uuid, p_action text)
returns void language plpgsql set search_path = public, pg_temp as $$
declare r record;
begin
  select o.id, o.delivered_at, o.billed_at,
         exists (select 1 from invoices i
                 where i.order_id = o.id
                    or i.load_id in (select lo.load_id from load_orders lo where lo.order_id = o.id)
         ) as invoiced
    into r from orders o where o.id = p_order;
  if not found then raise exception 'Order not found.'; end if;
  if r.invoiced or r.billed_at is not null then
    raise exception 'This order is billed/invoiced and locked — it can''t be %.', p_action;
  end if;
  if r.delivered_at is not null then
    raise exception 'This order is delivered and locked — it can''t be %.', p_action;
  end if;
end $$;

-- was _detach_order_from_schedule
create or replace function dept12_detach_order(p_order uuid)
returns void language plpgsql set search_path = public, pg_temp as $$
declare lid uuid;
begin
  for lid in delete from load_orders where order_id = p_order returning load_id loop
    continue when exists (select 1 from load_orders where load_id = lid);
    if exists (select 1 from documents where load_id = lid) then
      update loads set status = 'cancelled', scheduled_date = null, driver_id = null,
                       truck_id = null, carrier_party_id = null, is_carrier = false, slot = null
      where id = lid;
    else
      delete from loads where id = lid;
    end if;
  end loop;
end $$;

-- was _time_window_parts
create or replace function dept12_time_window_parts(p_category uuid, out timing text, out umatilla boolean)
language plpgsql stable set search_path = public, pg_temp as $$
declare nm text;
begin
  timing := null; umatilla := false;
  if p_category is null then return; end if;
  select lower(coalesce(name, '')) into nm from categories where id = p_category;
  if not found then raise exception 'Time Window option not found'; end if;
  timing := case when nm like '%early%' then 'early' when nm like '%anytime%' then 'anytime' end;
  umatilla := nm like '%umatilla%';
end $$;

-- was _match_order (D7 cascade, deterministic IDs only)
create or replace function dept12_match_order(p_solomon text, p_load_no text, p_filename text,
                                              out order_id uuid, out how text)
language plpgsql stable set search_path = public, pg_temp as $$
declare m text;
begin
  order_id := null; how := null;
  if coalesce(p_solomon, '') <> '' then
    select id into order_id from orders where solomon_order_no = p_solomon limit 1;
    if order_id is not null then how := 'solomon'; return; end if;
  end if;
  if coalesce(p_load_no, '') <> '' then
    select id into order_id from orders where broker_load_no = p_load_no limit 1;
    if order_id is not null then how := 'broker_load_no'; return; end if;
  end if;
  if coalesce(p_filename, '') <> '' then
    m := substring(p_filename from '\d{2}-\d{4}-\d{4}');
    if m is not null then
      select id into order_id from orders where solomon_order_no = m limit 1;
      if order_id is not null then how := 'filename'; return; end if;
    end if;
    for m in select x[1] from regexp_matches(p_filename, '\d{5,9}', 'g') with ordinality as r(x, n) order by n loop
      select id into order_id from orders where broker_load_no = m limit 1;
      if order_id is not null then how := 'filename'; return; end if;
    end loop;
  end if;
end $$;

-- ── Order-number patterns (D217/D233) ──
create or replace function dept12_validate_order_pattern(p_value text, p_require_sequence boolean default true)
returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare
  pattern text := btrim(coalesce(p_value, ''));
  blocks text[];
  n int;
  remaining text;
begin
  if pattern = '' or length(pattern) > 64 then
    raise exception 'Use a format between 1 and 64 characters.';
  end if;
  select array_agg(x[1]) into blocks from regexp_matches(pattern, '\{(#+)\}', 'g') as x;
  n := coalesce(array_length(blocks, 1), 0);
  if p_require_sequence and n <> 1 then
    raise exception 'Include one number block such as {####} (1–8 digits).';
  end if;
  if n > 1 or (n = 1 and not (length(blocks[1]) between 1 and 8)) then
    raise exception 'Use no more than one number block, with 1–8 digits.';
  end if;
  remaining := regexp_replace(pattern, '\{#+\}', '', 'g');
  remaining := replace(replace(replace(remaining, '{MM}', ''), '{YY}', ''), '{YYYY}', '');
  if position('{' in remaining) > 0 or position('}' in remaining) > 0 then
    raise exception 'Available date fields are {MM}, {YY}, and {YYYY}.';
  end if;
  return pattern;
end $$;

create or replace function dept12_render_order_period(p_pattern text, p_period date)
returns text language sql immutable as $$
  select replace(replace(replace(p_pattern, '{MM}', to_char(p_period, 'MM')),
                         '{YY}', to_char(p_period, 'YY')), '{YYYY}', to_char(p_period, 'YYYY'))
$$;

create or replace function dept12_format_order_number(p_pattern text, p_period date, p_sequence int)
returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare
  rendered text := dept12_render_order_period(dept12_validate_order_pattern(p_pattern), p_period);
  block text := substring(rendered from '\{(#+)\}');
  s text := p_sequence::text;
begin
  -- Python str.zfill: pads, never truncates.
  if length(s) < length(block) then s := lpad(s, length(block), '0'); end if;
  return regexp_replace(rendered, '\{#+\}', s);
end $$;

create or replace function dept12_regex_escape(p text) returns text
language sql immutable as $$
  select regexp_replace(p, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g')
$$;

-- was _find_or_create_carrier
create or replace function dept12_find_or_create_carrier(p_name text)
returns uuid language plpgsql set search_path = public, pg_temp as $$
declare r record; new_id uuid;
begin
  select id, is_carrier into r from parties where lower(name) = lower(p_name) limit 1;
  if found then
    if not r.is_carrier then update parties set is_carrier = true where id = r.id; end if;
    return r.id;
  end if;
  insert into parties (name, is_carrier) values (p_name, true) returning id into new_id;
  return new_id;
end $$;

-- ═══ Bootstrap ════════════════════════════════════════════════════════════

-- was api_bootstrap — everything the UI needs, one round trip.
-- TODO(AUTH): the Python server filtered loads/notes to a restricted user's
-- Scheduler window here (D125); re-add once real per-user auth exists.
create or replace function api_bootstrap() returns json
language sql stable set search_path = public, pg_temp as $$
select json_build_object(
  'drivers', coalesce((select json_agg(x) from (
      select d.id, d.full_name, d.active, d.color, t.number as truck, t.equipment_type as eq
      from drivers d
      left join lateral (
        select tr.number, tr.equipment_type from driver_truck_assignments a
        join trucks tr on tr.id = a.truck_id
        where a.driver_id = d.id and a.effective_to is null limit 1
      ) t on true
      where d.active order by d.created_at) x), '[]'),
  'trucks', coalesce((select json_agg(x) from (
      select t.id, t.number, t.equipment_type as eq, t.active, t.custom,
             dr.id as driver_id, dr.full_name as driver_name, dr.color as driver_color
      from trucks t
      left join lateral (
        select d.id, d.full_name, d.color from driver_truck_assignments a
        join drivers d on d.id = a.driver_id
        where a.truck_id = t.id and a.effective_to is null limit 1
      ) dr on true
      where t.active order by t.sort_order, t.number) x), '[]'),
  'parties', coalesce((select json_agg(x) from (
      select id, name, is_customer, is_broker, is_carrier, rexius_customer_no, ap_email, phone,
             manager_name, notes, customer_archived_at, broker_archived_at, custom
      from parties order by sort_order, name) x), '[]'),
  'locations', coalesce((select json_agg(x) from (
      select id, party_id, name, address, city, state, phone, email, appointment_note, map_url,
             forklift, timing_window, is_umatilla, standard_miles, miles_from_umatilla, notes,
             category_id, custom
      from locations order by name) x), '[]'),
  'grid_columns', coalesce((select json_agg(x) from (
      select * from grid_columns order by grid, sort_order, created_at) x), '[]'),
  'entities', coalesce((select json_agg(x) from (
      select * from entities order by sort_order, created_at) x), '[]'),
  'fields', coalesce((select json_agg(x) from (
      select * from fields order by entity_id, sort_order, created_at) x), '[]'),
  'records', coalesce((select json_agg(x) from (
      select * from records order by entity_id, sort_order, created_at) x), '[]'),
  'order_stops', coalesce((select json_agg(x) from (
      select * from order_stops order by order_id, sequence) x), '[]'),
  'load_stops', coalesce((select json_agg(x) from (
      select * from load_stops order by load_id, sequence) x), '[]'),
  'grid_row_orders', coalesce((select json_agg(x) from (
      select grid, row_id, sort_order from grid_row_orders order by grid, sort_order) x), '[]'),
  'departments', coalesce((select json_agg(x) from (
      select id, name, sort_order, color, archived_at from departments order by sort_order, name) x), '[]'),
  'internal_freight_rate', (select row_to_json(x) from (
      select rate_per_mile, minimum_charge from internal_freight_rate
      order by updated_at desc limit 1) x),
  'order_number_settings', (select row_to_json(x) from (
      select internal_pattern, internal_department, external_pattern, external_department
      from order_number_settings where id = 1) x),
  'orders', coalesce((select json_agg(x) from (
      select o.*, c.name as customer_name, b.name as broker_name,
             td.name as transfer_department_name, t.number as truck_number,
             (select count(*) from documents dd where dd.order_id = o.id) as doc_count
      from orders o
      left join parties c on c.id = o.customer_party_id
      left join parties b on b.id = o.broker_party_id
      left join departments td on td.id = o.transfer_department_id
      left join trucks t on t.id = o.truck_id
      order by o.created_at desc) x), '[]'),
  'loads', coalesce((select json_agg(x) from (
      select l.*, cat.color as cat_color, cat.name as cat_name,
             coalesce(array_agg(lo.order_id) filter (where lo.order_id is not null), '{}') as order_ids
      from loads l
      left join load_orders lo on lo.load_id = l.id
      left join categories cat on cat.id = l.category_id
      group by l.id, cat.color, cat.name) x), '[]'),
  'notes', coalesce((select json_agg(x) from (
      select n.*, cat.color as cat_color from schedule_notes n
      left join categories cat on cat.id = n.category_id) x), '[]'),
  'categories', coalesce((select json_agg(x) from (
      select id, name, color, sort, is_off from categories order by sort) x), '[]'),
  'truck_off_days', coalesce((select json_agg(x) from (
      select truck_id, off_date, note, category_id from truck_off_days) x), '[]'),
  'documents', coalesce((select json_agg(x) from (
      select id, order_id, load_id, load_stop_id, doc_type, original_filename, storage_path,
             matched_by, extracted_fields, uploaded_at
      from documents order by uploaded_at desc) x), '[]'),
  'invoices', coalesce((select json_agg(x) from (
      select * from invoices order by issued_at desc) x), '[]'),
  'sheets', coalesce((select json_agg(x) from (
      select id, name, n_rows, n_cols, sort from sheets order by sort, created_at) x), '[]'),
  'sheet_cells', coalesce((select json_agg(x) from (
      select sheet_id, r, c, value, fmt from sheet_cells) x), '[]'),
  'grid_cell_fmt', coalesce((select json_agg(x) from (
      select table_name, row_id, field, fmt from grid_cell_fmt) x), '[]'),
  'day_notes', coalesce((select json_agg(x) from (
      select id, note_date, text from day_notes order by note_date) x), '[]')
)
$$;

-- ═══ Orders ══════════════════════════════════════════════════════════════

-- was api_create_order (/api/order)
create or replace function api_order_create(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare broker uuid; o orders;
begin
  if dept12_txt(d, 'broker_name') is not null then
    select id into broker from parties where lower(name) = lower(d ->> 'broker_name') limit 1;
    if broker is null then
      insert into parties (name, is_broker) values (d ->> 'broker_name', true) returning id into broker;
    end if;
  end if;
  insert into orders (kind, solomon_order_no, broker_load_no, broker_party_id,
                      po_number, delivery_number, ordered_at, notes)
  values (coalesce(d ->> 'kind', 'external')::load_kind, dept12_txt(d, 'solomon_order_no'),
          dept12_txt(d, 'broker_load_no'), broker, d ->> 'po_number', d ->> 'delivery_number',
          coalesce(dept12_txt(d, 'ordered_at')::date, current_date), d ->> 'notes')
  returning * into o;
  if o.kind = 'external' then perform dept12_sync_simple_order_stops(o.id); end if;
  return to_jsonb(o);
end $$;

-- was api_ingest_order (/api/order/ingest)
create or replace function api_order_ingest(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare m record; v_row jsonb;
begin
  select * into m from dept12_match_order(dept12_txt(d, 'solomon_order_no'),
                                          dept12_txt(d, 'broker_load_no'), dept12_txt(d, 'filename'));
  if m.order_id is not null then
    select to_jsonb(o) into v_row from orders o where o.id = m.order_id;
    return v_row || jsonb_build_object('_match', m.how);
  end if;
  return api_order_create(d) || jsonb_build_object('_match', 'created');
end $$;

-- was api_add_internal_order (/api/internal-order). SECURITY DEFINER: the
-- advisory lock + scan must see every order to hand out a collision-free range.
create or replace function api_internal_order_add(d jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n int := greatest(1, least(coalesce(nullif(d ->> 'count', '')::int, 1), 500));
  month text := coalesce(d ->> 'month', '');
  period date;
  cfg record;
  pattern text;
  rendered text;
  num_re text;
  start_no int;
  found_no text;
  created jsonb := '[]'::jsonb;
  o orders;
  i int;
begin
  if month !~ '^(0[1-9]|1[0-2])\d{4}$' then
    raise exception 'Choose a valid month and four-digit year.';
  end if;
  period := make_date(substring(month from 3)::int, substring(month from 1 for 2)::int, 1);
  perform pg_advisory_xact_lock(hashtext('dept12:bag-order-number'));
  select internal_pattern, internal_department into cfg from order_number_settings where id = 1;
  pattern := dept12_validate_order_pattern(cfg.internal_pattern);
  if coalesce(d ->> 'start', '') <> '' then
    start_no := (d ->> 'start')::int;
  else
    rendered := dept12_render_order_period(pattern, period);
    num_re := '^' || dept12_regex_escape(split_part(regexp_replace(rendered, '\{#+\}', chr(1)), chr(1), 1))
              || '(\d+)'
              || dept12_regex_escape(split_part(regexp_replace(rendered, '\{#+\}', chr(1)), chr(1), 2)) || '$';
    select coalesce(max((regexp_match(solomon_order_no, num_re, 'i'))[1]::bigint), 0) + 1
      into start_no
    from orders where kind = 'internal' and solomon_order_no is not null
      and solomon_order_no ~* num_re;
    start_no := greatest(start_no, 1);
  end if;
  if start_no < 1 then raise exception 'Starting number must be at least 1.'; end if;
  for i in 0 .. n - 1 loop
    insert into orders (kind, solomon_order_no, order_period, department)
    values ('internal', dept12_format_order_number(pattern, period, start_no + i), period,
            cfg.internal_department)
    returning * into o;
    created := created || to_jsonb(o);
  end loop;
  return jsonb_build_object('created', n, 'first', created -> 0 ->> 'solomon_order_no',
                            'last', created -> -1 ->> 'solomon_order_no', 'start', start_no,
                            'orders', created);
end $$;

-- was api_add_transfer_order (/api/order/transfer)
create or replace function api_transfer_order_add(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  n int := greatest(1, least(coalesce(nullif(d ->> 'count', '')::int, 1), 500));
  created jsonb := '[]'::jsonb; o orders;
begin
  for i in 1 .. n loop
    insert into orders (kind, is_transfer, stage) values ('external', true, 'ordered') returning * into o;
    created := created || to_jsonb(o);
  end loop;
  return jsonb_build_object('created', n, 'orders', created);
end $$;

-- was api_copy_order (/api/order/copy)
create or replace function api_order_copy(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare src orders; copied orders;
begin
  select * into src from orders where id = (d ->> 'order_id')::uuid;
  if not found then raise exception 'Order not found'; end if;
  if src.is_transfer then
    insert into orders (kind, is_transfer, transfer_department_id, notes, stage)
    values ('external', true, src.transfer_department_id, src.notes, 'ordered') returning * into copied;
    return to_jsonb(copied);
  end if;
  insert into orders (kind, broker_party_id, customer_party_id, po_number, delivery_number,
                      pallet_count, notes, pickup_location_id, delivery_location_id, route_mode)
  values (src.kind, src.broker_party_id, src.customer_party_id, src.po_number, src.delivery_number,
          src.pallet_count, src.notes, src.pickup_location_id, src.delivery_location_id,
          coalesce(src.route_mode, 'simple'))
  returning * into copied;
  insert into order_stops (order_id, sequence, stop_type, location_id, reference_number,
                           scheduled_at, appointment_required, pallet_count, notes)
  select copied.id, sequence, stop_type, location_id, reference_number, scheduled_at,
         appointment_required, pallet_count, notes
  from order_stops where order_id = src.id order by sequence;
  if src.kind = 'external' and not exists (select 1 from order_stops where order_id = copied.id) then
    perform dept12_sync_simple_order_stops(copied.id);
  end if;
  return to_jsonb(copied);
end $$;

-- was api_update_order (/api/order/update)
create or replace function api_order_update(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  oid_ uuid := (d ->> 'id')::uuid;
  v_row jsonb;
  cfg record;
  ld record;
begin
  v_row := dept12_patch('orders', oid_, d - 'id', array[
    'solomon_order_no', 'broker_load_no', 'po_number', 'delivery_number', 'pallet_count', 'stage',
    'ordered_at', 'released_at', 'requested_delivery_date', 'delivered_at', 'notes', 'driver_note',
    'customer_party_id', 'broker_party_id', 'pickup_location_id', 'delivery_location_id', 'tarp',
    'transfer_department_id']);
  if v_row is null then return null; end if;
  if d ? 'solomon_order_no' and coalesce(v_row ->> 'solomon_order_no', '') <> ''
     and coalesce(v_row ->> 'department', '') = '' then
    select internal_department, external_department into cfg from order_number_settings where id = 1;
    update orders o set department = case when o.kind = 'internal' then cfg.internal_department
                                          else cfg.external_department end
    where id = oid_ returning to_jsonb(o) into v_row;
  end if;
  if v_row ->> 'kind' = 'external' and not coalesce((v_row ->> 'is_transfer')::boolean, false)
     and coalesce(v_row ->> 'route_mode', 'simple') = 'simple'
     and (d ?| array['pickup_location_id', 'delivery_location_id', 'po_number', 'delivery_number']) then
    perform dept12_sync_simple_order_stops(oid_);
    select * into ld from dept12_load_for_order(oid_);
    if ld.id is not null and not dept12_is_invoiced(ld.id) then
      perform dept12_sync_load_stops(ld.id, oid_);
    end if;
  end if;
  return v_row;
end $$;

-- was api_order_route_save (/api/order/route)
create or replace function api_order_route_save(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  oid_ uuid := (d ->> 'order_id')::uuid;
  stops jsonb := coalesce(d -> 'stops', '[]'::jsonb);
  n int;
  kinds text[];
  v_o record;
  ld record;
  s jsonb;
  i int := 0;
  loc uuid;
  pallets int;
  mode text := coalesce(d ->> 'route_mode', 'custom');
  first_pick record;
  last_drop record;
  updated jsonb;
begin
  if jsonb_typeof(stops) <> 'array' then raise exception 'A route needs 2–20 stops.'; end if;
  n := jsonb_array_length(stops);
  if n < 2 or n > 20 then raise exception 'A route needs 2–20 stops.'; end if;
  select array_agg(x ->> 'stop_type' order by ord) into kinds
  from jsonb_array_elements(stops) with ordinality as e(x, ord);
  if exists (select 1 from unnest(kinds) k where k is null or k not in ('pickup', 'delivery')) then
    raise exception 'Every stop must be a pickup or delivery.';
  end if;
  if not ('pickup' = any(kinds)) or not ('delivery' = any(kinds)) then
    raise exception 'A route needs at least one pickup and one delivery.';
  end if;
  select id, kind, delivered_at, billed_at into v_o from orders where id = oid_;
  if not found or v_o.kind <> 'external' then raise exception 'External order not found.'; end if;
  if v_o.delivered_at is not null or v_o.billed_at is not null then
    raise exception 'Delivered or billed routes are locked to protect history.';
  end if;
  select * into ld from dept12_load_for_order(oid_);
  if ld.id is not null and dept12_is_invoiced(ld.id) then
    raise exception 'This route is invoiced and locked.';
  end if;

  create temp table if not exists _route_stops (
    sequence int, stop_type text, location_id uuid, reference_number text,
    scheduled_at timestamptz, appointment_required boolean, pallet_count int, notes text
  ) on commit drop;
  delete from _route_stops;
  for s in select x from jsonb_array_elements(stops) x loop
    i := i + 1;
    loc := null;
    if dept12_txt(s, 'location_id') is not null then
      begin
        loc := (s ->> 'location_id')::uuid;
      exception when others then
        raise exception 'Stop % has an invalid location.', i;
      end;
    end if;
    pallets := nullif(s ->> 'pallet_count', '')::int;
    if pallets is not null and pallets < 0 then raise exception 'Pallet counts cannot be negative.'; end if;
    insert into _route_stops values (i, s ->> 'stop_type', loc, dept12_txt(s, 'reference_number'),
      dept12_txt(s, 'scheduled_at')::timestamptz,
      coalesce((dept12_blank(s -> 'appointment_required') #>> '{}')::boolean, false),
      pallets, dept12_txt(s, 'notes'));
  end loop;

  if mode not in ('simple', 'custom') then raise exception 'invalid route mode'; end if;
  if mode = 'simple' and (n <> 2 or kinds <> array['pickup', 'delivery']) then
    raise exception 'Simple mode requires exactly one pickup followed by one delivery.';
  end if;
  select * into first_pick from _route_stops where stop_type = 'pickup' order by sequence limit 1;
  select * into last_drop from _route_stops where stop_type = 'delivery' order by sequence desc limit 1;

  delete from order_stops where order_id = oid_;
  insert into order_stops (order_id, sequence, stop_type, location_id, reference_number,
                           scheduled_at, appointment_required, pallet_count, notes)
  select oid_, sequence, stop_type::stop_kind, location_id, reference_number, scheduled_at,
         appointment_required, pallet_count, notes
  from _route_stops order by sequence;
  update orders o set route_mode = mode, pickup_location_id = first_pick.location_id,
                      delivery_location_id = last_drop.location_id,
                      po_number = first_pick.reference_number,
                      delivery_number = last_drop.reference_number
  where id = oid_ returning to_jsonb(o) into updated;
  if ld.id is not null then perform dept12_sync_load_stops(ld.id, oid_); end if;
  return updated;
end $$;

-- was api_cancel_order (/api/order/cancel, D93). DEFINER: the lock check
-- must see invoices even if a future policy hides them from the caller.
create or replace function api_order_cancel(d jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare oid_ uuid := (d ->> 'id')::uuid; row jsonb;
begin
  if not coalesce((dept12_blank(d -> 'cancelled') #>> '{}')::boolean, true) then
    update orders o set stage = 'ordered' where id = oid_ returning to_jsonb(o) into row;
    return row;
  end if;
  perform dept12_order_mutation_guard(oid_, 'cancelled');
  perform dept12_detach_order(oid_);
  update orders o set stage = 'cancelled' where id = oid_ returning to_jsonb(o) into row;
  return row;
end $$;

-- was api_delete_order (/api/order/delete, D93). Returns the Storage paths
-- of the deleted order-owned documents; the browser removes those objects
-- after this commits (the Python server deleted local files the same way,
-- after its transaction).
create or replace function api_order_delete(d jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare oid_ uuid := (d ->> 'id')::uuid; paths jsonb; deleted uuid;
begin
  perform dept12_order_mutation_guard(oid_, 'deleted');
  select coalesce(jsonb_agg(storage_path), '[]'::jsonb) into paths from documents where order_id = oid_;
  perform dept12_detach_order(oid_);
  delete from orders where id = oid_ returning id into deleted;
  return jsonb_build_object('id', deleted, 'storage_paths', paths);
end $$;

-- ═══ Directory / Database grids ══════════════════════════════════════════

-- was api_add_customer (/api/customer, D46/D142)
create or replace function api_customer_add(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  nm text := btrim(coalesce(d ->> 'name', ''));
  is_ext boolean := d ->> 'kind' = 'external';
  p parties;
  tw record;
begin
  if nm = '' then raise exception 'Name is required'; end if;
  insert into parties (name, is_customer, is_broker, rexius_customer_no, ap_email, phone,
                       manager_name, notes, sort_order)
  values (nm, not is_ext, is_ext, dept12_txt(d, 'rexius_customer_no'), dept12_txt(d, 'ap_email'),
          dept12_txt(d, 'phone'), dept12_txt(d, 'manager_name'), dept12_txt(d, 'notes'),
          (select coalesce(max(sort_order), 0) + 1 from parties
           where case when is_ext then is_broker else is_customer end))
  returning * into p;
  if not is_ext then
    select * into tw from dept12_time_window_parts(dept12_txt(d, 'category_id')::uuid);
    insert into locations (party_id, name, address, city, state, phone, forklift, timing_window,
                           is_umatilla, category_id, standard_miles, miles_from_umatilla, notes)
    values (p.id, nm, dept12_txt(d, 'address'), dept12_txt(d, 'city'), dept12_txt(d, 'state'),
            dept12_txt(d, 'phone'), dept12_txt(d, 'forklift'), tw.timing, tw.umatilla,
            dept12_txt(d, 'category_id')::uuid, dept12_txt(d, 'standard_miles')::numeric,
            dept12_txt(d, 'miles_from_umatilla')::numeric, dept12_txt(d, 'notes'));
  end if;
  return to_jsonb(p);
end $$;

-- was api_update_row (/api/row)
create or replace function api_row_update(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  tbl text := d ->> 'table';
  patch jsonb := d - 'table' - 'id';
  allowed text[];
  tw record;
begin
  allowed := case tbl
    when 'parties' then array['name', 'ap_email', 'phone', 'manager_name', 'notes', 'rexius_customer_no', 'sort_order']
    when 'locations' then array['name', 'address', 'city', 'state', 'phone', 'email', 'map_url', 'forklift',
      'timing_window', 'is_umatilla', 'standard_miles', 'miles_from_umatilla', 'notes', 'appointment_note', 'category_id']
    when 'drivers' then array['full_name', 'active', 'color']
    when 'trucks' then array['number', 'equipment_type', 'active', 'sort_order']
    when 'departments' then array['name', 'sort_order', 'color']
  end;
  if allowed is null then raise exception 'table not editable'; end if;
  if tbl = 'locations' and patch ? 'category_id' then
    select * into tw from dept12_time_window_parts(dept12_txt(patch, 'category_id')::uuid);
    patch := patch || jsonb_build_object('timing_window', tw.timing, 'is_umatilla', tw.umatilla);
  end if;
  if not exists (select 1 from jsonb_object_keys(patch) k where k = any(allowed)) then
    return jsonb_build_object('ok', true);
  end if;
  return dept12_patch(tbl::regclass, (d ->> 'id')::uuid, patch, allowed);
end $$;

-- was api_update_custom (/api/row/custom, D47)
create or replace function api_row_custom(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare tbl text := d ->> 'table'; v text := dept12_txt(d, 'value'); res jsonb;
begin
  if tbl not in ('parties', 'locations', 'trucks', 'departments') then
    raise exception 'table has no custom columns';
  end if;
  execute format(
    'update %I t set custom = case when $1 is null then custom - $2 else custom || jsonb_build_object($2, $1) end '
    'where id = $3 returning jsonb_build_object(''id'', id, ''custom'', custom)', tbl)
    into res using v, d ->> 'key', (d ->> 'id')::uuid;
  return res;
end $$;

-- was api_grid_cell_fmt (/api/grid/cell-fmt, D76/D82)
create or replace function dept12_merge_fmt(cur jsonb, patch jsonb, replace_all boolean)
returns jsonb language sql immutable as $$
  select case when replace_all then
    coalesce((select jsonb_object_agg(key, value) from jsonb_each(coalesce(patch, '{}'))
              where dept12_blank(value) is not null), '{}')
  else
    coalesce((select jsonb_object_agg(key, value) from jsonb_each(coalesce(cur, '{}'))
              where not (coalesce(patch, '{}') ? key)), '{}')
    || coalesce((select jsonb_object_agg(key, value) from jsonb_each(coalesce(patch, '{}'))
                 where dept12_blank(value) is not null), '{}')
  end
$$;

create or replace function api_grid_cell_fmt(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  tbl text := d ->> 'table'; rid uuid := (d ->> 'id')::uuid; fld text := d ->> 'field';
  cur jsonb; fmt jsonb;
begin
  if tbl not in ('parties', 'locations', 'trucks', 'departments') then raise exception 'unknown grid table'; end if;
  if coalesce(fld, '') !~ '^[a-z_][a-z0-9_]*$' then raise exception 'invalid field'; end if;
  select g.fmt into cur from grid_cell_fmt g where table_name = tbl and row_id = rid and field = fld;
  fmt := dept12_merge_fmt(cur, d -> 'fmt', coalesce((d ->> 'replace')::boolean, false));
  if fmt = '{}'::jsonb then
    delete from grid_cell_fmt where table_name = tbl and row_id = rid and field = fld;
    return jsonb_build_object('ok', true, 'on', 'empty');
  end if;
  insert into grid_cell_fmt (table_name, row_id, field, fmt) values (tbl, rid, fld, fmt)
  on conflict (table_name, row_id, field) do update set fmt = excluded.fmt;
  return jsonb_build_object('ok', true);
end $$;

-- was api_grid_column (/api/grid/column, D47/D96). Structural → admin.
create or replace function api_grid_column_add(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  v_grid text := d ->> 'grid';
  label text := btrim(coalesce(d ->> 'label', ''));
  v_base text; v_key text; n int := 2; nxt int; v_slug text; col grid_columns;
begin
  perform dept12_require_admin();
  if v_grid not in ('bagger', 'external', 'pickdrop', 'fleet', 'departments') then raise exception 'unknown grid'; end if;
  if label = '' then raise exception 'Column name is required'; end if;
  v_base := 'c_' || coalesce(nullif(left(btrim(regexp_replace(lower(label), '[^a-z0-9]+', '_', 'g'), '_'), 24), ''), 'col');
  v_key := v_base;
  while exists (select 1 from grid_columns g where g.grid = v_grid and g.key = v_key) loop
    v_key := v_base || '_' || n; n := n + 1;
  end loop;
  v_slug := case when v_grid = 'external' then 'brokers' else v_grid end;
  select greatest(coalesce((select max(sort_order) from grid_columns g where g.grid = v_grid), 0),
                  coalesce((select max(f.sort_order) from fields f join entities e on e.id = f.entity_id
                            where e.slug = v_slug), 0)) + 1 into nxt;
  insert into grid_columns (grid, key, label, type, options, sort_order)
  values (v_grid, v_key, label, coalesce(d ->> 'type', 'text'), coalesce(d -> 'options', '[]'::jsonb), nxt)
  returning * into col;
  return to_jsonb(col);
end $$;

-- was api_grid_column_delete
create or replace function api_grid_column_delete(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare col record; tbl text;
begin
  perform dept12_require_admin();
  select grid, key into col from grid_columns where id = (d ->> 'id')::uuid;
  if not found then raise exception 'column not found'; end if;
  tbl := case col.grid when 'bagger' then 'parties' when 'external' then 'parties'
                       when 'pickdrop' then 'locations' when 'fleet' then 'trucks'
                       when 'departments' then 'departments' end;
  execute format('update %I set custom = custom - $1', tbl) using col.key;
  delete from grid_columns where id = (d ->> 'id')::uuid;
  return jsonb_build_object('ok', true);
end $$;

-- was api_grid_column_update
create or replace function api_grid_column_update(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
begin
  perform dept12_require_admin();
  if not exists (select 1 from jsonb_object_keys(d) k where k in ('label', 'type', 'options', 'sort_order', 'width')) then
    return jsonb_build_object('ok', true);
  end if;
  return dept12_patch('grid_columns', (d ->> 'id')::uuid, d - 'id',
                      array['label', 'type', 'options', 'sort_order', 'width']);
end $$;

-- was api_entity_create / api_entity_update / api_entity_delete (D85)
create or replace function api_entity_create(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare nm text := btrim(coalesce(d ->> 'name', '')); e entities;
begin
  perform dept12_require_admin();
  if nm = '' then raise exception 'Database name is required'; end if;
  insert into entities (name, kind, sort_order)
  values (nm, 'custom', (select coalesce(max(sort_order), 0) + 1 from entities)) returning * into e;
  return to_jsonb(e);
end $$;

create or replace function api_entity_update(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
begin
  perform dept12_require_admin();
  return dept12_patch('entities', (d ->> 'id')::uuid, d - 'id', array['name', 'sort_order', 'icon']);
end $$;

create or replace function api_entity_delete(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare k text;
begin
  perform dept12_require_admin();
  select kind into k from entities where id = (d ->> 'id')::uuid;
  if not found then raise exception 'database not found'; end if;
  if k <> 'custom' then raise exception 'built-in databases can''t be deleted'; end if;
  delete from entities where id = (d ->> 'id')::uuid;
  return jsonb_build_object('ok', true);
end $$;

-- was api_field_create / update / rename-option / delete
create or replace function api_field_create(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  eid uuid := (d ->> 'entity_id')::uuid; k text;
  label text := btrim(coalesce(d ->> 'label', ''));
  v_base text; v_key text; n int := 2; f fields;
begin
  perform dept12_require_admin();
  select kind into k from entities where id = eid;
  if not found then raise exception 'database not found'; end if;
  if k <> 'custom' then raise exception 'can''t add fields to a built-in database this way'; end if;
  if label = '' then raise exception 'Field name is required'; end if;
  v_base := coalesce(nullif(left(btrim(regexp_replace(lower(label), '[^a-z0-9]+', '_', 'g'), '_'), 24), ''), 'field');
  v_key := v_base;
  while exists (select 1 from fields x where x.entity_id = eid and x.key = v_key) loop
    v_key := v_base || '_' || n; n := n + 1;
  end loop;
  insert into fields (entity_id, key, label, type, options, storage, sort_order)
  values (eid, v_key, label, coalesce(d ->> 'type', 'text'), coalesce(d -> 'options', '[]'::jsonb), 'json',
          (select coalesce(max(sort_order), 0) + 1 from fields where entity_id = eid))
  returning * into f;
  return to_jsonb(f);
end $$;

create or replace function api_field_update(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare fid uuid := (d ->> 'id')::uuid; is_locked boolean;
        allowed text[] := array['label', 'key', 'width', 'sort_order', 'hidden', 'type', 'options', 'conditional_format'];
begin
  perform dept12_require_admin();
  select locked into is_locked from fields where id = fid;
  if not found then raise exception 'field not found'; end if;
  if is_locked then allowed := array['label', 'width', 'sort_order', 'hidden', 'options', 'conditional_format']; end if;
  -- options/conditional_format are jsonb: an explicit null must stay a JSON
  -- value, not become SQL null (Python sent json.dumps(None) = 'null').
  return dept12_patch('fields', fid, d - 'id', allowed);
end $$;

create or replace function api_field_rename_option(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  frm text := coalesce(d ->> 'from', ''); tov text := coalesce(d ->> 'to', '');
  st text; tbl text; col text; n int;
begin
  perform dept12_require_admin();
  if frm = '' or tov = '' or frm = tov then return jsonb_build_object('updated', 0); end if;
  select storage into st from fields where id = (d ->> 'id')::uuid;
  if not found or coalesce(st, '') not like 'column:%' then raise exception 'field not found'; end if;
  tbl := split_part(substring(st from 8), '.', 1);
  col := split_part(substring(st from 8), '.', 2);
  if tbl not in ('parties', 'locations', 'trucks', 'drivers', 'departments') or col !~ '^[a-z_][a-z0-9_]*$' then
    raise exception 'field isn''t a renameable column';
  end if;
  execute format('with u as (update %I set %I = $1 where %I = $2 returning 1) select count(*) from u', tbl, col, col)
    into n using tov, frm;
  return jsonb_build_object('updated', n);
end $$;

create or replace function api_field_delete(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare st text;
begin
  perform dept12_require_admin();
  select storage into st from fields where id = (d ->> 'id')::uuid;
  if not found then raise exception 'field not found'; end if;
  if st is distinct from 'json' then raise exception 'built-in fields can''t be deleted — hide them instead'; end if;
  delete from fields where id = (d ->> 'id')::uuid;
  return jsonb_build_object('ok', true);
end $$;

-- was api_record_create / api_record_update
create or replace function api_record_create(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare r records;
begin
  insert into records (entity_id, data, sort_order)
  values ((d ->> 'entity_id')::uuid, '{}'::jsonb,
          (select coalesce(max(sort_order), 0) + 1 from records where entity_id = (d ->> 'entity_id')::uuid))
  returning * into r;
  return to_jsonb(r);
end $$;

create or replace function api_record_update(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare v text := dept12_txt(d, 'value'); k text := d ->> 'field_id'; r records;
begin
  update records set data = case when v is null then data - k else data || jsonb_build_object(k, v) end
  where id = (d ->> 'id')::uuid returning * into r;
  return to_jsonb(r);
end $$;

-- was api_grid_row (/api/grid/row, D47)
create or replace function api_grid_row_add(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare grid text := d ->> 'grid'; res jsonb; pid uuid;
begin
  if grid = 'bagger' then
    insert into parties (name, is_customer) values ('New customer', true) returning id, to_jsonb(parties.*) into pid, res;
    insert into locations (party_id, name) values (pid, 'New customer');
  elsif grid = 'external' then
    insert into parties (name, is_customer, is_broker) values ('New customer', true, true) returning to_jsonb(parties.*) into res;
  elsif grid = 'pickdrop' then
    insert into locations (name) values ('New location') returning to_jsonb(locations.*) into res;
  elsif grid = 'fleet' then
    insert into trucks (number, equipment_type) values ('NEW-' || left(gen_random_uuid()::text, 4), 'F')
    returning to_jsonb(trucks.*) into res;
  elsif grid = 'departments' then
    insert into departments (name) values ('New department') returning to_jsonb(departments.*) into res;
  else
    raise exception 'unknown grid';
  end if;
  return res;
end $$;

-- was api_grid_row_delete (D47/D191)
create or replace function api_grid_row_delete(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare grid text := d ->> 'grid'; rid uuid := (d ->> 'id')::uuid; n bigint;
begin
  if grid in ('bagger', 'external', 'departments') then
    raise exception 'This database uses Archive Selected instead of delete.';
  elsif grid = 'pickdrop' then
    select count(*) into n from orders where pickup_location_id = rid or delivery_location_id = rid;
    if n > 0 then raise exception 'Can''t delete — % order(s) reference this address.', n; end if;
    delete from locations where id = rid;
  elsif grid = 'fleet' then
    select count(*) into n from loads where truck_id = rid;
    if n > 0 then raise exception 'Can''t delete — % load(s) reference this truck.', n; end if;
    delete from driver_truck_assignments where truck_id = rid;
    delete from trucks where id = rid;
  else
    raise exception 'unknown grid';
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- was api_database_archive (D191/D192)
create or replace function api_database_archive(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare grid text := d ->> 'grid'; rid uuid := (d ->> 'id')::uuid;
        arch boolean := coalesce((dept12_blank(d -> 'archived') #>> '{}')::boolean, true);
        res jsonb;
begin
  if grid = 'bagger' then
    if not exists (select 1 from parties where id = rid and is_customer) then raise exception 'Bagger Customer not found.'; end if;
    update parties set customer_archived_at = case when arch then coalesce(customer_archived_at, now()) end
    where id = rid returning jsonb_build_object('id', id, 'customer_archived_at', customer_archived_at) into res;
  elsif grid = 'external' then
    if not exists (select 1 from parties where id = rid and is_broker) then raise exception 'External Customer not found.'; end if;
    update parties set broker_archived_at = case when arch then coalesce(broker_archived_at, now()) end
    where id = rid returning jsonb_build_object('id', id, 'broker_archived_at', broker_archived_at) into res;
  elsif grid = 'departments' then
    if not exists (select 1 from departments where id = rid) then raise exception 'Internal Freight department not found.'; end if;
    update departments set archived_at = case when arch then coalesce(archived_at, now()) end
    where id = rid returning jsonb_build_object('id', id, 'archived_at', archived_at) into res;
  else
    raise exception 'This database does not support archiving.';
  end if;
  return res;
end $$;

-- was api_grid_row_reorder (D109)
create or replace function api_grid_row_reorder(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  v_grid text := btrim(coalesce(d ->> 'grid', ''));
  raw jsonb := coalesce(d -> 'row_ids', '[]'::jsonb);
  ids uuid[];
  cur uuid[];
  arch boolean := coalesce((dept12_blank(d -> 'archived_view') #>> '{}')::boolean, false);
  eid uuid;
begin
  if jsonb_typeof(raw) <> 'array' or jsonb_array_length(raw) = 0 then
    raise exception 'row_ids must contain the database rows';
  end if;
  begin
    select array_agg((x #>> '{}')::uuid order by n) into ids from jsonb_array_elements(raw) with ordinality e(x, n);
  exception when others then raise exception 'invalid row id';
  end;
  if (select count(distinct x) from unnest(ids) x) <> array_length(ids, 1) then
    raise exception 'row order contains duplicates';
  end if;
  if v_grid = 'bagger' then
    select array_agg(id) into cur from parties where is_customer and (customer_archived_at is not null) = arch;
  elsif v_grid = 'external' then
    select array_agg(id) into cur from parties where is_broker and (broker_archived_at is not null) = arch;
  elsif v_grid = 'pickdrop' then
    select array_agg(id) into cur from locations;
  elsif v_grid = 'fleet' then
    select array_agg(id) into cur from trucks where active;
  elsif v_grid = 'departments' then
    select array_agg(id) into cur from departments where (archived_at is not null) = arch;
  elsif v_grid like 'custom:%' then
    begin eid := substring(v_grid from 8)::uuid;
    exception when others then raise exception 'invalid custom database'; end;
    select array_agg(id) into cur from records where entity_id = eid;
  else
    raise exception 'unknown grid';
  end if;
  if not (coalesce(cur, '{}') @> ids and ids @> coalesce(cur, '{}')) then
    raise exception 'database rows changed; reload and try again';
  end if;
  if v_grid in ('bagger', 'external', 'departments') then
    delete from grid_row_orders g where g.grid = v_grid and row_id = any(cur);
  else
    delete from grid_row_orders g where g.grid = v_grid;
  end if;
  insert into grid_row_orders (grid, row_id, sort_order)
  select v_grid, x, n * 10 from unnest(ids) with ordinality u(x, n);
  return jsonb_build_object('ok', true, 'count', array_length(ids, 1));
end $$;

-- ── Fleet ──
-- was api_add_truck (/api/truck)
create or replace function api_truck_add(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare t trucks;
begin
  insert into trucks (number, equipment_type, sort_order)
  values (d ->> 'number', coalesce(d ->> 'eq', 'F'), (select coalesce(max(sort_order), 0) + 1 from trucks))
  returning * into t;
  return to_jsonb(t);
end $$;

-- was api_assign_truck (/api/assign-truck, D32). Close BOTH sides before
-- inserting; a same-day correction is deleted, not closed (CLAUDE.md trap).
create or replace function api_assign_truck(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare truck uuid := (d ->> 'truck_id')::uuid; drv uuid := dept12_txt(d, 'driver_id')::uuid;
begin
  if truck is not null then
    delete from driver_truck_assignments where truck_id = truck and effective_to is null and effective_from = current_date;
    update driver_truck_assignments set effective_to = current_date - 1 where truck_id = truck and effective_to is null;
  end if;
  if drv is not null then
    delete from driver_truck_assignments where driver_id = drv and effective_to is null and effective_from = current_date;
    update driver_truck_assignments set effective_to = current_date - 1 where driver_id = drv and effective_to is null;
    insert into driver_truck_assignments (driver_id, truck_id, effective_from) values (drv, truck, current_date);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- was api_set_truck_driver (/api/truck/driver, D45)
create or replace function api_truck_driver(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare nm text := btrim(coalesce(d ->> 'driver_name', '')); drv uuid;
begin
  if nm <> '' then
    select id into drv from drivers where lower(full_name) = lower(nm) limit 1;
    if drv is null then insert into drivers (full_name) values (nm) returning id into drv; end if;
  end if;
  return api_assign_truck(jsonb_build_object('truck_id', d ->> 'truck_id', 'driver_id', drv));
end $$;

-- ═══ Scheduler ═══════════════════════════════════════════════════════════

-- was api_schedule (/api/schedule, D29/D32/D82/D250)
create or replace function api_schedule(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  truck uuid := (d ->> 'truck_id')::uuid;
  dt date := (d ->> 'date')::date;
  sl int := (d ->> 'slot')::int;
  act text := d ->> 'action';
  existing uuid;
  nt record;
  res jsonb;
  oid_ uuid;
  prior record;
  o record;
  drv uuid;
  ld loads;
begin
  perform dept12_enforce_view_window(dt);

  if act = 'clear' then
    select id into existing from loads where truck_id = truck and scheduled_date = dt and slot = sl limit 1;
    if existing is not null and dept12_is_invoiced(existing) then
      raise exception 'This load is already invoiced and locked — it can''t be cleared.';
    end if;
    delete from loads where truck_id = truck and scheduled_date = dt and slot = sl;
    select fmt, category_id into nt from schedule_notes where truck_id = truck and scheduled_date = dt and slot = sl;
    if found and ((nt.fmt is not null and nt.fmt <> '{}'::jsonb) or nt.category_id is not null) then
      update schedule_notes set body = '' where truck_id = truck and scheduled_date = dt and slot = sl;
    else
      delete from schedule_notes where truck_id = truck and scheduled_date = dt and slot = sl;
    end if;
    return jsonb_build_object('ok', true);
  end if;

  if act = 'note' then
    select id into existing from loads where truck_id = truck and scheduled_date = dt and slot = sl limit 1;
    if existing is not null and dept12_is_invoiced(existing) then
      raise exception 'This load is already invoiced and locked — it can''t be overwritten.';
    end if;
    delete from loads where truck_id = truck and scheduled_date = dt and slot = sl;
    insert into schedule_notes (truck_id, scheduled_date, slot, body) values (truck, dt, sl, d ->> 'body')
    on conflict (truck_id, scheduled_date, slot) do update set body = excluded.body
    returning to_jsonb(schedule_notes.*) into res;
    return res;
  end if;

  oid_ := (d ->> 'order_id')::uuid;
  select * into prior from dept12_load_for_order(oid_);
  if prior.id is not null then perform dept12_enforce_view_window(prior.scheduled_date); end if;
  if prior.id is not null and dept12_is_invoiced(prior.id) then
    raise exception 'This order is already invoiced and its load is locked — it can''t be rescheduled.';
  end if;
  select id into existing from loads where truck_id = truck and scheduled_date = dt and slot = sl limit 1;
  if existing is not null and dept12_is_invoiced(existing) then
    raise exception 'That slot already holds an invoiced load and can''t be overwritten.';
  end if;
  delete from schedule_notes where truck_id = truck and scheduled_date = dt and slot = sl;
  delete from loads l using load_orders lo where lo.load_id = l.id and lo.order_id = oid_;
  select kind, is_transfer into o from orders where id = oid_;
  select driver_id into drv from driver_truck_assignments where truck_id = truck and effective_to is null limit 1;
  insert into loads (kind, status, scheduled_date, driver_id, truck_id, slot)
  values (o.kind, 'assigned', dt, drv, truck, sl) returning * into ld;
  insert into load_orders (load_id, order_id) values (ld.id, oid_);
  if o.kind = 'external' and not o.is_transfer then perform dept12_sync_load_stops(ld.id, oid_); end if;
  return to_jsonb(ld);
end $$;

-- was api_load_carrier (/api/load/carrier, D115/D122)
create or replace function api_load_carrier(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  oid_ uuid := (d ->> 'order_id')::uuid;
  nm text := btrim(coalesce(d ->> 'carrier_name', ''));
  cost numeric := dept12_txt(d, 'carrier_cost')::numeric;
  ex record;
  has_carrier boolean;
  carrier uuid;
  touched boolean := false;
  new_carrier uuid;
  new_cost numeric;
  set_carrier boolean := false;
  set_cost boolean := false;
  res jsonb;
  prior record;
  dt date;
  sl int;
  dest uuid;
  o record;
  ld loads;
begin
  if cost is not null and cost < 0 then raise exception 'carrier cost cannot be negative'; end if;

  if not (d ? 'date') then
    select * into ex from dept12_load_for_order(oid_);
    if ex.id is null then raise exception 'This order isn''t on the outside-carrier lane.'; end if;
    perform dept12_enforce_view_window(ex.scheduled_date);
    if dept12_is_invoiced(ex.id) then raise exception 'This order is already invoiced and its load is locked.'; end if;
    select carrier_party_id is not null into has_carrier from loads where id = ex.id;
    if d ? 'carrier_name' then
      new_carrier := case when nm <> '' then dept12_find_or_create_carrier(nm) end;
      set_carrier := true;
      has_carrier := new_carrier is not null;
      if not has_carrier and not (d ? 'carrier_cost') then set_cost := true; new_cost := null; end if;
    end if;
    if d ? 'carrier_cost' then
      if cost is not null and not has_carrier then raise exception 'Enter a carrier name before a cost.'; end if;
      set_cost := true; new_cost := cost;
    end if;
    if not set_carrier and not set_cost then return jsonb_build_object('ok', true); end if;
    update loads l set
      carrier_party_id = case when set_carrier then new_carrier else l.carrier_party_id end,
      carrier_cost = case when set_cost then new_cost else l.carrier_cost end
    where id = ex.id returning to_jsonb(l) into res;
    return res;
  end if;

  select * into prior from dept12_load_for_order(oid_);
  if prior.id is not null then perform dept12_enforce_view_window(prior.scheduled_date); end if;
  if prior.id is not null and dept12_is_invoiced(prior.id) then
    raise exception 'This order is already invoiced and its load is locked — it can''t be rescheduled.';
  end if;
  dt := (d ->> 'date')::date; sl := (d ->> 'slot')::int;
  perform dept12_enforce_view_window(dt);
  select id into dest from loads where truck_id is null and driver_id is null and is_carrier
    and scheduled_date = dt and slot = sl limit 1;
  if dest is not null and dept12_is_invoiced(dest) then
    raise exception 'That slot already holds an invoiced load and can''t be overwritten.';
  end if;
  delete from loads l using load_orders lo where lo.load_id = l.id and lo.order_id = oid_;
  select kind, is_transfer into o from orders where id = oid_;
  carrier := case when nm <> '' then dept12_find_or_create_carrier(nm) end;
  insert into loads (kind, status, scheduled_date, slot, is_carrier, carrier_party_id, carrier_cost)
  values (o.kind, 'assigned', dt, sl, true, carrier, case when carrier is not null then cost end)
  returning * into ld;
  insert into load_orders (load_id, order_id) values (ld.id, oid_);
  if o.kind = 'external' and not o.is_transfer then perform dept12_sync_load_stops(ld.id, oid_); end if;
  return to_jsonb(ld);
end $$;

-- was api_unschedule (/api/unschedule, D29)
create or replace function api_unschedule(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare oid_ uuid := (d ->> 'order_id')::uuid; ld record;
begin
  select * into ld from dept12_load_for_order(oid_);
  if ld.id is not null then perform dept12_enforce_view_window(ld.scheduled_date); end if;
  if ld.id is not null and dept12_is_invoiced(ld.id) then
    raise exception 'This load is already invoiced and locked — it can''t be unscheduled.';
  end if;
  delete from loads l using load_orders lo where lo.load_id = l.id and lo.order_id = oid_;
  return jsonb_build_object('ok', true);
end $$;

-- was api_cell_color (/api/cell/color, D66/D82)
create or replace function api_cell_color(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  truck uuid := (d ->> 'truck_id')::uuid; dt date := (d ->> 'date')::date; sl int := (d ->> 'slot')::int;
  cat uuid := dept12_txt(d, 'category_id')::uuid;
  ld uuid; ex record; has_fmt boolean;
begin
  perform dept12_enforce_view_window(dt);
  select id into ld from loads where truck_id = truck and scheduled_date = dt and slot = sl limit 1;
  if ld is not null then
    update loads set category_id = cat where id = ld;
    return jsonb_build_object('ok', true, 'on', 'load');
  end if;
  select body, category_id, fmt into ex from schedule_notes where truck_id = truck and scheduled_date = dt and slot = sl;
  has_fmt := found and ex.fmt is not null and ex.fmt <> '{}'::jsonb;
  if cat is null and not (found and btrim(coalesce(ex.body, '')) <> '') and not has_fmt then
    delete from schedule_notes where truck_id = truck and scheduled_date = dt and slot = sl;
    return jsonb_build_object('ok', true, 'on', 'empty');
  end if;
  insert into schedule_notes (truck_id, scheduled_date, slot, body, category_id)
  values (truck, dt, sl, coalesce(ex.body, ''), cat)
  on conflict (truck_id, scheduled_date, slot) do update set category_id = excluded.category_id;
  return jsonb_build_object('ok', true, 'on', 'note');
end $$;

-- was api_cell_format (/api/cell/format, D67)
create or replace function api_cell_format(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  truck uuid := (d ->> 'truck_id')::uuid; dt date := (d ->> 'date')::date; sl int := (d ->> 'slot')::int;
  rep boolean := coalesce((dept12_blank(d -> 'replace') #>> '{}')::boolean, false);
  ld record; ex record; newfmt jsonb;
begin
  perform dept12_enforce_view_window(dt);
  select id, fmt into ld from loads where truck_id = truck and scheduled_date = dt and slot = sl limit 1;
  if found then
    update loads set fmt = dept12_merge_fmt(ld.fmt, d -> 'patch', rep) where id = ld.id;
    return jsonb_build_object('ok', true, 'on', 'load');
  end if;
  select body, fmt into ex from schedule_notes where truck_id = truck and scheduled_date = dt and slot = sl;
  newfmt := dept12_merge_fmt(case when found then ex.fmt else '{}'::jsonb end, d -> 'patch', rep);
  if newfmt = '{}'::jsonb and not (found and btrim(coalesce(ex.body, '')) <> '') then
    delete from schedule_notes where truck_id = truck and scheduled_date = dt and slot = sl;
    return jsonb_build_object('ok', true, 'on', 'empty');
  end if;
  insert into schedule_notes (truck_id, scheduled_date, slot, body, fmt)
  values (truck, dt, sl, coalesce(ex.body, ''), newfmt)
  on conflict (truck_id, scheduled_date, slot) do update set fmt = excluded.fmt;
  return jsonb_build_object('ok', true, 'on', 'note');
end $$;

-- was api_truck_off (/api/truck/off, D66)
create or replace function api_truck_off(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare truck uuid := (d ->> 'truck_id')::uuid; dt date := (d ->> 'off_date')::date; offcat uuid;
begin
  if d -> 'on' = 'false'::jsonb then
    delete from truck_off_days where truck_id = truck and off_date = dt;
    return jsonb_build_object('ok', true, 'on', false);
  end if;
  select id into offcat from categories where is_off limit 1;
  insert into truck_off_days (truck_id, off_date, note, category_id)
  values (truck, dt, coalesce(dept12_txt(d, 'note'), 'Off'), offcat)
  on conflict (truck_id, off_date) do update set note = excluded.note;
  return jsonb_build_object('ok', true, 'on', true);
end $$;

-- was api_day_note (/api/day-note, D230)
create or replace function api_day_note(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare nd text := dept12_txt(d, 'note_date'); txt text := btrim(coalesce(d ->> 'text', '')); res jsonb;
begin
  if nd is null then raise exception 'note_date is required.'; end if;
  if txt = '' then
    delete from day_notes where note_date = nd::date;
    return jsonb_build_object('note_date', nd, 'text', '');
  end if;
  insert into day_notes (note_date, text) values (nd::date, txt)
  on conflict (note_date) do update set text = excluded.text
  returning jsonb_build_object('id', id, 'note_date', note_date, 'text', text) into res;
  return res;
end $$;

-- was api_category (/api/category, D66). Global legend → admin.
create or replace function api_category(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare c categories;
begin
  perform dept12_require_admin();
  if coalesce((dept12_blank(d -> 'delete') #>> '{}')::boolean, false) and dept12_txt(d, 'id') is not null then
    delete from categories where id = (d ->> 'id')::uuid;
    return jsonb_build_object('ok', true);
  end if;
  if dept12_txt(d, 'id') is not null then
    update categories set name = d ->> 'name', color = d ->> 'color',
                          is_off = coalesce((dept12_blank(d -> 'is_off') #>> '{}')::boolean, false)
    where id = (d ->> 'id')::uuid returning * into c;
    return to_jsonb(c);
  end if;
  insert into categories (name, color, is_off, sort)
  values (d ->> 'name', d ->> 'color', coalesce((dept12_blank(d -> 'is_off') #>> '{}')::boolean, false),
          coalesce((select max(sort) + 10 from categories), 0))
  returning * into c;
  return to_jsonb(c);
end $$;

-- ═══ Custom sheets (in-app spreadsheets, D74 — NOT Google Sheets) ═══════

create or replace function api_sheet(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare s sheets;
begin
  perform dept12_require_admin();
  if coalesce((dept12_blank(d -> 'delete') #>> '{}')::boolean, false) and dept12_txt(d, 'id') is not null then
    delete from sheets where id = (d ->> 'id')::uuid;
    return jsonb_build_object('ok', true);
  end if;
  if dept12_txt(d, 'id') is not null then
    if not exists (select 1 from jsonb_each(d) where key in ('name', 'n_rows', 'n_cols', 'sort')
                   and value <> 'null'::jsonb) then
      return jsonb_build_object('ok', true);
    end if;
    return dept12_patch('sheets', (d ->> 'id')::uuid,
      (select coalesce(jsonb_object_agg(key, value), '{}') from jsonb_each(d)
       where key in ('name', 'n_rows', 'n_cols', 'sort') and value <> 'null'::jsonb),
      array['name', 'n_rows', 'n_cols', 'sort']);
  end if;
  if (select count(*) from sheets) >= 10 then
    raise exception 'Sheet limit reached (10). Delete a sheet before adding another.';
  end if;
  insert into sheets (name, n_rows, n_cols, sort)
  values (coalesce(dept12_txt(d, 'name'), 'New sheet'), coalesce(dept12_truthy(d -> 'n_rows') #>> '{}', '25')::int,
          coalesce(dept12_truthy(d -> 'n_cols') #>> '{}', '25')::int,
          coalesce((select max(sort) + 1 from sheets), 0))
  returning * into s;
  return to_jsonb(s);
end $$;

create or replace function api_sheet_cell(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  sid uuid := (d ->> 'sheet_id')::uuid; rr int := (d ->> 'r')::int; cc int := (d ->> 'c')::int;
  ex record; val text; fmt jsonb;
begin
  select value, sheet_cells.fmt into ex from sheet_cells where sheet_id = sid and r = rr and c = cc;
  val := case when d ? 'value' then d ->> 'value' when ex is not null then ex.value end;
  val := nullif(val, '');
  fmt := coalesce(ex.fmt, '{}'::jsonb);
  if d ? 'fmt' and d -> 'fmt' <> 'null'::jsonb then
    fmt := dept12_merge_fmt(fmt, d -> 'fmt', coalesce((dept12_blank(d -> 'replace') #>> '{}')::boolean, false));
  end if;
  if val is null and fmt = '{}'::jsonb then
    delete from sheet_cells where sheet_id = sid and r = rr and c = cc;
    return jsonb_build_object('ok', true, 'on', 'empty');
  end if;
  insert into sheet_cells (sheet_id, r, c, value, fmt) values (sid, rr, cc, val, fmt)
  on conflict (sheet_id, r, c) do update set value = excluded.value, fmt = excluded.fmt;
  return jsonb_build_object('ok', true);
end $$;

-- ═══ Freight, mileage, delivery dates ═══════════════════════════════════

-- was api_freight (/api/freight, D103/D187)
create or replace function api_freight(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  oid_ uuid := (d ->> 'order_id')::uuid;
  miles_in jsonb := dept12_truthy(d -> 'miles');
  v_row orders;
  cfg record;
begin
  if coalesce((dept12_blank(d -> 'reset_miles') #>> '{}')::boolean, false) then
    update orders set miles = motive_miles, miles_adjusted = false where id = oid_ returning * into v_row;
    return to_jsonb(v_row);
  end if;
  if not (d ?| array['miles', 'freight_amount']) then return jsonb_build_object('ok', true); end if;
  update orders o set
    miles = case when d ? 'miles' then (miles_in #>> '{}')::numeric else o.miles end,
    miles_adjusted = case when d ? 'miles' then dept12_blank(d -> 'miles') is not null else o.miles_adjusted end,
    internal_freight_amount = case when d ? 'freight_amount'
      then (dept12_truthy(d -> 'freight_amount') #>> '{}')::numeric else o.internal_freight_amount end
  where id = oid_ returning * into v_row;
  if d ? 'miles' and dept12_blank(d -> 'miles') is not null and v_row.internal_freight_amount is null then
    select rate_per_mile, minimum_charge into cfg from internal_freight_rate order by updated_at desc limit 1;
    if coalesce(cfg.rate_per_mile, 0) > 0 then
      update orders set internal_freight_amount = round(greatest(miles * cfg.rate_per_mile, cfg.minimum_charge)::numeric, 2)
      where id = oid_ returning * into v_row;
    end if;
  end if;
  return to_jsonb(v_row);
end $$;

-- was api_internal_freight_rate_save (D170). Admin, global setting.
create or replace function api_internal_freight_rate_save(d jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare rate numeric := coalesce(dept12_truthy(d -> 'rate_per_mile') #>> '{}', '0')::numeric;
        minimum numeric := coalesce(dept12_truthy(d -> 'minimum_charge') #>> '{}', '0')::numeric;
        res jsonb;
begin
  perform dept12_require_admin();
  if rate < 0 or minimum < 0 then raise exception 'Rate and minimum can''t be negative.'; end if;
  update internal_freight_rate set rate_per_mile = rate, minimum_charge = minimum, updated_at = now()
  where id = (select id from internal_freight_rate order by updated_at desc limit 1)
  returning jsonb_build_object('rate_per_mile', rate_per_mile, 'minimum_charge', minimum_charge) into res;
  return res;
end $$;

-- was api_internal_freight_rate_calculate (D170). Admin, bulk cross-order;
-- only fills blank charges — never overwrites a typed or earlier value.
create or replace function api_internal_freight_rate_calculate(d jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare cfg record; n int;
begin
  perform dept12_require_admin();
  select rate_per_mile, minimum_charge into cfg from internal_freight_rate order by updated_at desc limit 1;
  if coalesce(cfg.rate_per_mile, 0) <= 0 then raise exception 'Set a rate per mile first.'; end if;
  with u as (
    update orders set internal_freight_amount = round(greatest(miles * cfg.rate_per_mile, cfg.minimum_charge)::numeric, 2)
    where (kind = 'internal' or is_transfer) and miles is not null and internal_freight_amount is null
    returning 1)
  select count(*) into n from u;
  return jsonb_build_object('filled', n);
end $$;

-- was api_sync_delivery_dates (D34/D239). Admin, bulk.
create or replace function api_sync_delivery_dates(d jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform dept12_require_admin();
  with u as (
    update orders o set delivered_at = l.scheduled_date, truck_id = l.truck_id
    from load_orders lo join loads l on l.id = lo.load_id
    where lo.order_id = o.id and l.scheduled_date is not null
      and (o.delivered_at is distinct from l.scheduled_date or o.truck_id is distinct from l.truck_id)
    returning o.id)
  select count(*) into n from u;
  return jsonb_build_object('synced', n);
end $$;

-- ── Motive (called by the motive-sync Edge Function, which holds the key) ──
create or replace function motive_sync_candidates() returns json
language sql stable set search_path = public, pg_temp as $$
  select coalesce(json_agg(x), '[]') from (
    select o.id, l.scheduled_date, o.miles_adjusted, t.number as truck_number
    from orders o
    join load_orders lo on lo.order_id = o.id
    join loads l on l.id = lo.load_id
    join trucks t on t.id = l.truck_id
    where (o.kind = 'internal' or o.is_transfer) and l.scheduled_date is not null
      and o.motive_miles is null and o.motive_synced_at is null) x
$$;

-- p_results: [{"id": "<order uuid>", "miles": 123.4 | null}]. null = Motive
-- had nothing for that truck/day → stamp motive_synced_at and never retry
-- (D124). Adjusted orders keep their typed miles (D48).
create or replace function motive_apply_miles(p_results jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare r record; filled int := 0;
begin
  perform dept12_require_admin();
  for r in select (x ->> 'id')::uuid as id, round((x ->> 'miles')::numeric, 1) as mi
           from jsonb_array_elements(coalesce(p_results, '[]')) x loop
    if r.mi is null then
      update orders set motive_synced_at = now() where id = r.id;
    else
      update orders set motive_miles = r.mi,
                        miles = case when miles_adjusted then miles else r.mi end,
                        motive_synced_at = now()
      where id = r.id;
      filled := filled + 1;
    end if;
  end loop;
  return jsonb_build_object('filled', filled);
end $$;

-- ── Google Sheets driver mirror (called by the sheets-push Edge Function) ──
-- was _rolling_driver_dates (D98): weekdays always count; a weekend day counts
-- only when it holds a real load. Pacific "today".
create or replace function driver_week_dates(p_start date default null, p_count int default 3)
returns date[] language plpgsql stable set search_path = public, pg_temp as $$
declare
  start date := coalesce(p_start, (now() at time zone 'America/Los_Angeles')::date);
  cnt int := greatest(1, least(14, coalesce(p_count, 3)));
  scan_end date;
  weekend date[];
  out date[] := '{}';
  dy date;
begin
  scan_end := start + 45;
  select coalesce(array_agg(distinct l.scheduled_date), '{}') into weekend
  from loads l join load_orders lo on lo.load_id = l.id
  where l.scheduled_date between start and scan_end;
  dy := start;
  while coalesce(array_length(out, 1), 0) < cnt and dy <= scan_end loop
    if extract(isodow from dy) < 6 or dy = any(weekend) then out := out || dy; end if;
    dy := dy + 1;
  end loop;
  if coalesce(array_length(out, 1), 0) <> cnt then
    raise exception 'Could not build the requested driver date window';
  end if;
  return out;
end $$;

-- was the read half of _driver_week_payload: raw rows; the Edge Function
-- turns them into chip text / colors exactly like the Python did.
create or replace function driver_week_data(p_from date, p_to date) returns json
language sql stable set search_path = public, pg_temp as $$
with lds as (
  select l.id, l.truck_id, l.scheduled_date, l.slot,
         coalesce(array_agg(lo.order_id) filter (where lo.order_id is not null), '{}') as order_ids
  from loads l left join load_orders lo on lo.load_id = l.id
  where l.truck_id is not null and l.scheduled_date between p_from and p_to
  group by l.id order by l.slot
)
select json_build_object(
  'trucks', coalesce((select json_agg(x) from (
    select t.id as truck_id, t.number, t.equipment_type as eq,
           dr.id as driver_id, dr.full_name as driver_name, dr.color as driver_color
    from trucks t
    left join lateral (
      select d.id, d.full_name, d.color from driver_truck_assignments a
      join drivers d on d.id = a.driver_id
      where a.truck_id = t.id and a.effective_to is null limit 1
    ) dr on true
    where t.active order by t.sort_order nulls last, t.number) x), '[]'),
  'loads', coalesce((select json_agg(lds) from lds), '[]'),
  'notes', coalesce((select json_agg(x) from (
    select n.truck_id, n.scheduled_date, n.slot, n.body, n.fmt, cat.color as cat_color
    from schedule_notes n left join categories cat on cat.id = n.category_id
    where n.scheduled_date between p_from and p_to) x), '[]'),
  'off_days', coalesce((select json_agg(x) from (
    select truck_id, off_date from truck_off_days where off_date between p_from and p_to) x), '[]'),
  'orders', coalesce((select json_agg(x) from (
    select o.id, o.kind, o.is_transfer, o.route_mode, o.solomon_order_no, o.broker_load_no, o.notes,
           o.driver_note, o.po_number, o.delivery_number, o.pallet_count,
           c.name as customer_name, b.name as broker_name,
           td.name as transfer_department_name, td.color as transfer_department_color,
           pl.name as pickup_name, pl.address as pickup_address, pl.city as pickup_city,
           pl.state as pickup_state, pl.phone as pickup_phone, pl.map_url as pickup_map_url,
           dl.name as delivery_name, dl.address as delivery_address, dl.city as delivery_city,
           dl.state as delivery_state, dl.phone as delivery_phone, dl.map_url as delivery_map_url,
           il.map_url as customer_map_url, il.notes as customer_notes,
           il.city as cust_city, il.state as cust_state, il.forklift as cust_forklift,
           il.timing_window as cust_timing, il.is_umatilla as cust_umatilla
    from orders o
    left join parties c on c.id = o.customer_party_id
    left join parties b on b.id = o.broker_party_id
    left join departments td on td.id = o.transfer_department_id
    left join locations pl on pl.id = o.pickup_location_id
    left join locations dl on dl.id = o.delivery_location_id
    left join lateral (
      select map_url, notes, city, state, forklift, timing_window, is_umatilla
      from locations where party_id = o.customer_party_id limit 1
    ) il on true
    where o.id in (select unnest(order_ids) from lds)) x), '[]'),
  'stops', coalesce((select json_agg(x) from (
    select s.*, loc.name, loc.address, loc.city, loc.state, loc.phone, loc.map_url,
           to_char(s.scheduled_at at time zone 'America/Los_Angeles', 'MM/DD HH12:MI AM') as scheduled_at_label
    from load_stops s left join locations loc on loc.id = s.location_id
    where s.load_id in (select id from lds) order by s.load_id, s.sequence) x), '[]')
)
$$;

-- After a confirmed push: record it in History as an external effect (the
-- Python server's HISTORY_EXTERNAL_PATHS), and — once Current Week was
-- written — stamp pushed_at so external chips take driver color (D85/D164).
create or replace function driver_week_mark_pushed(p_from date, p_to date, p_mark_loads boolean,
                                                   p_meta jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int := 0;
begin
  perform dept12_require_admin();
  perform dept12_begin_event('/api/sheets/push-driver-tabs', 'Push driver tabs',
                             '/api/sheets/push-driver-tabs', true, true, coalesce(p_meta, '{}'));
  update audit_events set completed_at = now()
  where id = current_setting('dept12.history_event_id', true)::uuid;
  if p_mark_loads then
    with u as (update loads set pushed_at = now() where scheduled_date between p_from and p_to returning 1)
    select count(*) into n from u;
  end if;
  return jsonb_build_object('marked', n);
end $$;

-- ═══ Documents ═══════════════════════════════════════════════════════════
-- Bytes live in the private `documents` Storage bucket; these functions own
-- the `documents` rows and the D7 matching. The browser uploads/moves/
-- deletes the object around each call (see supabase-api.js).

-- was api_save_document (/api/document). Creates the row and returns the
-- storage_path the browser must upload the bytes to.
create or replace function api_document_save(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  doc_id uuid := gen_random_uuid();
  oid_ uuid := dept12_txt(d, 'order_id')::uuid;
  matched text := dept12_txt(d, 'matched_by');
  ef jsonb := coalesce(dept12_blank(d -> 'extracted_fields'), '{}'::jsonb);
  m record;
  safe text;
  path text;
  res jsonb;
begin
  if oid_ is null then
    select * into m from dept12_match_order(
      coalesce(dept12_txt(ef, 'solomon'), dept12_txt(ef, 'solomon_order_no')),
      coalesce(dept12_txt(ef, 'load_no'), dept12_txt(ef, 'broker_load_no')),
      dept12_txt(d, 'filename'));
    -- FIX (pre-existing bug in the Python server, found porting): the
    -- matcher's 'solomon' label is not a match_method enum value, so every
    -- document auto-matched by its exact order # failed to save. Store the
    -- real enum value, 'solomon_order_no'.
    if m.order_id is not null then
      oid_ := m.order_id;
      matched := case when m.how = 'solomon' then 'solomon_order_no' else m.how end;
    end if;
  end if;
  if matched is null then matched := case when oid_ is not null then 'manual' else 'unmatched' end; end if;
  safe := regexp_replace(coalesce(dept12_txt(d, 'filename'), 'document.pdf'), '^.*/', '');
  if safe = '' then safe := 'document.pdf'; end if;
  -- Storage object keys: keep the readable name but drop characters object
  -- storage rejects. original_filename keeps the exact name.
  path := coalesce(oid_::text, 'unmatched') || '/' || doc_id || '_' ||
          regexp_replace(safe, '[^A-Za-z0-9 ._()-]', '_', 'g');
  insert into documents (id, order_id, doc_type, storage_path, original_filename,
                         extracted_fields, matched_by, matched_at)
  values (doc_id, oid_, coalesce(d ->> 'doc_type', 'other')::document_kind, path, safe, ef, matched::match_method,
          case when oid_ is not null then now() end)
  returning jsonb_build_object('id', id, 'order_id', order_id, 'doc_type', doc_type,
                               'original_filename', original_filename, 'storage_path', storage_path,
                               'matched_by', matched_by, 'extracted_fields', extracted_fields)
  into res;
  return res;
end $$;

-- was api_attach_document (/api/document/attach). p.storage_path is the
-- object's new location, already moved by the browser.
create or replace function api_document_attach(d jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare res jsonb;
begin
  if not exists (select 1 from documents where id = (d ->> 'id')::uuid) then
    raise exception 'document not found';
  end if;
  update documents x set order_id = (d ->> 'order_id')::uuid, matched_by = 'manual', matched_at = now(),
                         storage_path = coalesce(dept12_txt(d, 'storage_path'), storage_path)
  where id = (d ->> 'id')::uuid returning to_jsonb(x) into res;
  return res;
end $$;

-- was api_delete_document (D94): only genuinely unmatched Billing documents.
create or replace function api_document_delete(d jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  select id, order_id, load_id, load_stop_id, matched_by, storage_path into r
  from documents where id = (d ->> 'id')::uuid;
  if not found then raise exception 'document not found'; end if;
  if r.matched_by <> 'unmatched' or r.order_id is not null or r.load_id is not null or r.load_stop_id is not null then
    raise exception 'Only unmatched documents can be deleted from Billing.';
  end if;
  delete from documents where id = r.id;
  return jsonb_build_object('ok', true, 'id', r.id, 'storage_path', r.storage_path);
end $$;

-- ═══ Admin ═══════════════════════════════════════════════════════════════

-- was api_order_number_settings_save (D217)
create or replace function api_order_number_settings_save(d jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ip text := dept12_validate_order_pattern(d ->> 'internal_pattern');
  ep text := dept12_validate_order_pattern(d ->> 'external_pattern', false);
  idp text := btrim(coalesce(d ->> 'internal_department', ''));
  edp text := btrim(coalesce(d ->> 'external_department', ''));
  res jsonb;
begin
  perform dept12_require_admin();
  if idp = '' or edp = '' then raise exception 'Both department codes are required.'; end if;
  if length(idp) > 20 or length(edp) > 20 then raise exception 'Department codes must be 20 characters or fewer.'; end if;
  update order_number_settings set internal_pattern = ip, internal_department = idp,
                                   external_pattern = ep, external_department = edp
  where id = 1
  returning jsonb_build_object('internal_pattern', internal_pattern, 'internal_department', internal_department,
                               'external_pattern', external_pattern, 'external_department', external_department)
  into res;
  return res;
end $$;

-- was /api/admin/user/delete
create or replace function api_admin_user_delete(d jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare adm boolean;
begin
  perform dept12_require_admin();
  select is_admin into adm from app_users where id = (d ->> 'user_id')::uuid;
  if not found then raise exception 'User not found.'; end if;
  if adm then raise exception 'Can''t delete an admin account.'; end if;
  delete from app_users where id = (d ->> 'user_id')::uuid;
  return jsonb_build_object('ok', true);
end $$;

-- ═══ Durable History (D131–D135, D169, D250) ═════════════════════════════

create or replace function api_history_list(p_limit int default 60, p_before bigint default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare lim int := greatest(1, least(coalesce(p_limit, 60), 199)); evs jsonb;
begin
  perform dept12_require_admin();
  perform dept12_history_purge();
  with e as (
    select * from audit_events
    where completed_at is not null and (change_count > 0 or external_effect)
      and (p_before is null or sequence < p_before)
    order by sequence desc limit lim + 1
  )
  select coalesce(jsonb_agg(
    (to_jsonb(e) - 'completed_at' || jsonb_build_object('completed_at', e.completed_at)) ||
    jsonb_build_object('changes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'event_id', c.event_id, 'change_sequence', c.change_sequence,
        'table_name', c.table_name, 'operation', c.operation, 'primary_key', c.primary_key,
        'changed_fields', c.changed_fields,
        'before_data', case when c.operation = 'UPDATE' then
          (select coalesce(jsonb_object_agg(f, c.before_data -> f), '{}') from unnest(c.changed_fields) f) end,
        'after_data', case when c.operation = 'UPDATE' then
          (select coalesce(jsonb_object_agg(f, c.after_data -> f), '{}') from unnest(c.changed_fields) f) end
      ) order by c.change_sequence)
      from audit_changes c where c.event_id = e.id), '[]'::jsonb))
    order by e.sequence desc), '[]'::jsonb) into evs
  from e;
  return jsonb_build_object(
    'events', coalesce((select jsonb_agg(x order by n) from jsonb_array_elements(evs) with ordinality a(x, n) where n <= lim), '[]'::jsonb),
    'has_more', jsonb_array_length(evs) > lim);
end $$;

create or replace function dept12_history_target(p_event uuid) returns audit_events
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t audit_events;
begin
  select * into t from audit_events
  where id = p_event and completed_at is not null and (change_count > 0 or external_effect);
  if not found then raise exception 'History action not found.'; end if;
  return t;
end $$;

create or replace function dept12_history_baseline() returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(max(sequence), 0) from audit_events
  where completed_at is not null and (change_count > 0 or external_effect)
$$;

create or replace function api_history_preview(d jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t audit_events; n int;
begin
  perform dept12_require_admin();
  t := dept12_history_target(dept12_txt(d, 'event_id')::uuid);
  select count(*) into n from audit_changes where event_id = t.id;
  return jsonb_build_object(
    'target', to_jsonb(t), 'events', jsonb_build_array(to_jsonb(t)), 'change_count', n,
    'irreversible', case when t.external_effect or not t.reversible then jsonb_build_array(to_jsonb(t)) else '[]'::jsonb end,
    'baseline_sequence', dept12_history_baseline(),
    'can_apply', n > 0 and t.reversible and t.reverted_by_event_id is null);
end $$;

-- was _history_apply_inverse: conflict-checked inverse of one audit change.
create or replace function dept12_history_apply_inverse(c audit_changes) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  tbl text := format('%I.%I', c.table_schema, c.table_name);
  pk_cols text[];
  pk_where text;
  cur jsonb;
  conflicts text[];
  cols text[];
begin
  select array_agg(k) into pk_cols from jsonb_object_keys(c.primary_key) k;
  select string_agg(format('t.%1$I = (select %1$I from jsonb_populate_record(null::%2$s, $1))', k, tbl), ' and ')
    into pk_where from unnest(pk_cols) k;
  execute format('select to_jsonb(t) from %s t where %s', tbl, pk_where) into cur using c.primary_key;

  if c.operation = 'UPDATE' then
    if cur is null then raise exception '% row no longer exists', c.table_name; end if;
    select array_agg(f) into conflicts from unnest(c.changed_fields) f
    where cur -> f is distinct from c.after_data -> f;
    if conflicts is not null then
      raise exception '% changed again in: %', c.table_name, array_to_string(conflicts, ', ');
    end if;
    select array_agg(f) into cols from unnest(c.changed_fields) f
    join information_schema.columns ic on ic.table_schema = c.table_schema and ic.table_name = c.table_name
         and ic.column_name = f and ic.is_generated = 'NEVER'
    where not (f = any(pk_cols)) and f <> 'updated_at';
    if cols is null then return; end if;
    execute format('update %s t set (%s) = (select %s from jsonb_populate_record(null::%s, $2)) where %s',
                   tbl, (select string_agg(format('%I', x), ', ') from unnest(cols) x),
                   (select string_agg(format('%I', x), ', ') from unnest(cols) x), tbl, pk_where)
      using c.primary_key, c.before_data;
    return;
  end if;

  if c.operation = 'INSERT' then
    if cur is null then raise exception '% row was already removed', c.table_name; end if;
    if (cur - 'updated_at') is distinct from (c.after_data - 'updated_at') then
      raise exception '% row changed after it was created', c.table_name;
    end if;
    execute format('delete from %s t where %s', tbl, pk_where) using c.primary_key;
    return;
  end if;

  if c.operation = 'DELETE' then
    if cur is not null then raise exception '% primary key is in use again', c.table_name; end if;
    select array_agg(ic.column_name::text order by ic.ordinal_position) into cols
    from information_schema.columns ic
    where ic.table_schema = c.table_schema and ic.table_name = c.table_name
      and ic.is_generated = 'NEVER' and ic.is_identity = 'NO' and c.before_data ? ic.column_name;
    execute format('insert into %s (%s) select %s from jsonb_populate_record(null::%s, $1)',
                   tbl, (select string_agg(format('%I', x), ', ') from unnest(cols) x),
                   (select string_agg(format('%I', x), ', ') from unnest(cols) x), tbl)
      using c.before_data;
    return;
  end if;
  raise exception 'Unsupported historical change.';
end $$;

-- was api_history_revert, including D250's three FK-safe passes: undo
-- INSERTs newest-first, then DELETEs in original order (parents before
-- children), then UPDATEs.
create or replace function api_history_revert(d jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t audit_events;
  ev uuid;
  c audit_changes;
  n int;
begin
  perform dept12_require_admin();
  t := dept12_history_target(dept12_txt(d, 'event_id')::uuid);
  if coalesce(dept12_txt(d, 'baseline_sequence')::bigint, -1) <> dept12_history_baseline() then
    raise exception 'History changed after the preview. Review the revert again.';
  end if;
  if not t.reversible or t.reverted_by_event_id is not null then
    raise exception 'That action cannot be reversed.';
  end if;
  select count(*) into n from audit_changes where event_id = t.id;
  if n = 0 then raise exception 'There are no reversible database changes in that action.'; end if;

  ev := dept12_begin_event('/api/history/revert', 'Reverted: ' || t.label, 'history.action', true, false,
                           jsonb_build_object('target_event_id', t.id));
  for c in select * from audit_changes where event_id = t.id and operation = 'INSERT' order by change_sequence desc loop
    perform dept12_history_apply_inverse(c);
  end loop;
  for c in select * from audit_changes where event_id = t.id and operation = 'DELETE' order by change_sequence asc loop
    perform dept12_history_apply_inverse(c);
  end loop;
  for c in select * from audit_changes where event_id = t.id and operation = 'UPDATE' order by change_sequence desc loop
    perform dept12_history_apply_inverse(c);
  end loop;
  update audit_events set reverted_by_event_id = ev where id = t.id;
  update audit_events set reverts_event_id = t.id, completed_at = now(),
                          metadata = metadata || jsonb_build_object('reversed_change_count', n)
  where id = ev;
  return jsonb_build_object('ok', true, 'event_id', ev, 'change_count', n);
end $$;

-- ═══ Reports (D40/D127/D161/D245) ═══════════════════════════════════════
-- Returns {numeric_columns, rows}; rows are `json` (not jsonb) so column
-- order survives. The browser applies the friendly header labels and writes
-- the CSV exactly as server.py's _csv() did.
create or replace function api_report(p_name text, p_from date default null, p_to date default null)
returns json language plpgsql volatile set search_path = public, pg_temp as $$
declare q text; res json; nums text[];
begin
  case p_name
  when 'orders' then
    q := $q$
      select o.solomon_order_no, o.department, o.kind, o.broker_load_no,
             c.name as customer, b.name as broker, o.pallet_count,
             o.stage, o.ordered_at, o.delivered_at,
             (o.delivered_at - o.ordered_at) as days_order_to_delivery
      from orders o
      left join parties c on c.id = o.customer_party_id
      left join parties b on b.id = o.broker_party_id
      order by o.ordered_at desc$q$;
  when 'loads' then
    q := $q$
      select scheduled_date, driver_name, truck_number, equipment_type,
             kind, status, miles, internal_freight_amount, drop_count
      from v_loads_reporting order by scheduled_date desc$q$;
  when 'missing_pod' then
    q := $q$select * from v_loads_missing_pod order by scheduled_date$q$;
  when 'customers' then
    q := $q$
      select p.name, l.address, l.city, l.state, l.forklift, l.timing_window,
             cat.name as designation, l.standard_miles, l.miles_from_umatilla,
             l.is_umatilla, l.appointment_note, l.notes, p.phone, p.manager_name
      from parties p left join locations l on l.party_id = p.id
      left join categories cat on cat.id = l.category_id
      where p.is_customer and p.customer_archived_at is null order by p.name$q$;
  when 'brokers' then
    q := $q$
      select p.name, p.rexius_customer_no, p.ap_email, p.phone, p.manager_name, p.notes
      from parties p where p.is_broker and p.broker_archived_at is null order by p.name$q$;
  when 'fleet' then
    q := $q$
      select t.number as truck, t.equipment_type, t.active, dr.full_name as current_driver
      from trucks t
      left join lateral (
        select d.full_name from driver_truck_assignments a
        join drivers d on d.id = a.driver_id
        where a.truck_id = t.id and a.effective_to is null limit 1
      ) dr on true
      order by t.number$q$;
  when 'customer_order_counts' then
    q := $q$
      select c.name as customer, extract(year from o.ordered_at)::int as year, count(*) as order_count
      from orders o join parties c on c.id = o.customer_party_id
      where o.kind = 'internal' and o.ordered_at is not null
      group by c.name, extract(year from o.ordered_at)
      order by year desc, order_count desc$q$;
  when 'documents' then
    q := $q$
      select d.doc_type, d.original_filename, d.matched_by, d.uploaded_at,
             o.solomon_order_no, o.broker_load_no
      from documents d left join orders o on o.id = d.order_id
      order by d.uploaded_at desc$q$;
  when 'dump' then
    q := $q$
      with base as (
        select
          o.id, o.solomon_order_no, o.department, o.kind, o.is_transfer,
          o.broker_load_no, o.po_number, o.delivery_number,
          c.name as customer, c.rexius_customer_no as customer_rexius_no,
          c.phone as customer_phone, c.ap_email as customer_ap_email, c.manager_name as customer_manager,
          b.name as broker, b.rexius_customer_no as broker_rexius_no,
          b.phone as broker_phone, b.ap_email as broker_ap_email, b.manager_name as broker_manager,
          td.name as transfer_department,
          o.pallet_count, o.stage, o.notes as load_info, o.driver_note, o.tarp,
          o.ordered_at, o.released_at, o.requested_delivery_date, o.delivered_at, o.billed_at,
          o.route_mode,
          o.miles as order_miles, o.motive_miles as order_motive_miles, o.miles_adjusted as order_miles_adjusted,
          o.internal_freight_amount as order_internal_freight,
          ld.scheduled_date, ld.slot, ld.status as load_status, ld.pushed_at,
          ld.truck_number, ld.equipment_type, ld.driver_name, ld.driver_color,
          ld.miles as load_miles, ld.is_carrier, ld.carrier_name, ld.carrier_cost,
          ld.external_revenue, ld.orders_on_load,
          pl.name as pickup_name, pl.address as pickup_address, pl.city as pickup_city,
          pl.state as pickup_state, pl.postal_code as pickup_zip, pl.phone as pickup_phone,
          dl.name as delivery_name, dl.address as delivery_address, dl.city as delivery_city,
          dl.state as delivery_state, dl.postal_code as delivery_zip, dl.phone as delivery_phone,
          il.city as customer_loc_city, il.state as customer_loc_state, il.forklift as customer_forklift,
          il.timing_window as customer_timing_window, il.standard_miles as customer_standard_miles,
          docs.rate_con_count, docs.pod_count, docs.invoice_doc_count,
          ot.number as order_truck_number,
          coalesce(ld.scheduled_date, o.delivered_at, o.ordered_at) as activity_date,
          dn.text as day_note
        from orders o
        left join parties c on c.id = o.customer_party_id
        left join parties b on b.id = o.broker_party_id
        left join departments td on td.id = o.transfer_department_id
        left join locations pl on pl.id = o.pickup_location_id
        left join locations dl on dl.id = o.delivery_location_id
        left join trucks ot on ot.id = o.truck_id
        left join lateral (
          select forklift, timing_window, standard_miles, city, state
          from locations where party_id = o.customer_party_id limit 1
        ) il on true
        left join lateral (
          select l.scheduled_date, l.slot, l.status, l.pushed_at,
                 t.number as truck_number, t.equipment_type,
                 dr.full_name as driver_name, dr.color as driver_color, l.miles,
                 l.is_carrier, cp.name as carrier_name, l.carrier_cost,
                 (select sum(iv.amount) from invoices iv where iv.load_id = l.id) as external_revenue,
                 (select count(*) from load_orders lo2 where lo2.load_id = l.id) as orders_on_load
          from load_orders lo
          join loads l on l.id = lo.load_id
          left join trucks t on t.id = l.truck_id
          left join drivers dr on dr.id = l.driver_id
          left join parties cp on cp.id = l.carrier_party_id
          where lo.order_id = o.id
          order by l.scheduled_date desc nulls last
          limit 1
        ) ld on true
        left join lateral (
          select
            count(*) filter (where doc_type = 'rate_con') as rate_con_count,
            count(*) filter (where doc_type = 'pod') as pod_count,
            count(*) filter (where doc_type = 'invoice') as invoice_doc_count
          from documents where order_id = o.id
        ) docs on true
        left join day_notes dn on dn.note_date = coalesce(ld.scheduled_date, o.delivered_at, o.ordered_at)::date
      )
      select
        solomon_order_no, department, coalesce(department, transfer_department) as pivot_department,
        kind, is_transfer, broker_load_no, po_number, delivery_number,
        customer, customer_rexius_no, customer_phone, customer_ap_email, customer_manager,
        broker, broker_rexius_no, broker_phone, broker_ap_email, broker_manager,
        pallet_count, stage, load_info, driver_note, tarp,
        ordered_at, released_at, requested_delivery_date, delivered_at, billed_at,
        scheduled_date, slot, load_status, route_mode, pushed_at,
        extract(isoyear from activity_date)::int as iso_year,
        extract(week   from activity_date)::int as iso_week,
        to_char(activity_date, 'YYYY-MM') as year_month,
        case when extract(month from activity_date) between 1 and 7 then 'peak' else 'off' end as season,
        coalesce(order_truck_number, truck_number) as truck_number, equipment_type, driver_name, driver_color,
        coalesce(order_miles, load_miles) as miles, order_motive_miles, order_miles_adjusted,
        order_internal_freight as internal_freight_amount,
        external_revenue as external_revenue_load,
        orders_on_load,
        round(external_revenue / nullif(orders_on_load, 0), 2) as external_revenue_share,
        is_carrier, carrier_name, carrier_cost,
        pickup_name, pickup_address, pickup_city, pickup_state, pickup_zip, pickup_phone,
        delivery_name, delivery_address, delivery_city, delivery_state, delivery_zip, delivery_phone,
        customer_loc_city, customer_loc_state, customer_forklift, customer_timing_window, customer_standard_miles,
        coalesce(rate_con_count, 0) as rate_con_count, coalesce(pod_count, 0) as pod_count,
        coalesce(invoice_doc_count, 0) as invoice_doc_count,
        day_note
      from base
      where ($1 is null or activity_date >= $1)
        and ($2 is null or activity_date <= $2)
      order by activity_date desc nulls last, solomon_order_no$q$;
  when 'freight' then
    q := $q$
      with rows as (
        select l.truck_id, l.id as load_id, '07' as department, o.internal_freight_amount
        from loads l
        join load_orders lo on lo.load_id = l.id
        join orders o on o.id = lo.order_id
        where l.kind = 'internal' and o.internal_freight_amount is not null
          and l.status in ('delivered', 'closed')
          and ($1 is null or l.scheduled_date >= $1)
          and ($2 is null or l.scheduled_date <= $2)
        union all
        select l.truck_id, l.id as load_id, d.name as department, o.internal_freight_amount
        from loads l
        join load_orders lo on lo.load_id = l.id
        join orders o on o.id = lo.order_id
        join departments d on d.id = o.transfer_department_id
        where l.kind = 'external' and o.is_transfer and o.internal_freight_amount is not null
          and l.status in ('delivered', 'closed')
          and ($1 is null or l.scheduled_date >= $1)
          and ($2 is null or l.scheduled_date <= $2)
      )
      select t.number as truck_number, r.department,
             count(distinct r.load_id) as load_count,
             sum(r.internal_freight_amount) as total_amount
      from rows r join trucks t on t.id = r.truck_id
      group by t.number, r.department
      order by t.number, r.department$q$;
  when 'mileage' then
    q := $q$
      with base as (
        select o.id, o.kind, o.is_transfer, c.name as customer, td.name as department,
               coalesce(o.miles, ld.miles) as miles,
               coalesce(ld.scheduled_date, o.delivered_at, o.ordered_at) as activity_date
        from orders o
        left join parties c on c.id = o.customer_party_id
        left join departments td on td.id = o.transfer_department_id
        left join lateral (
          select l.scheduled_date, l.miles
          from load_orders lo join loads l on l.id = lo.load_id
          where lo.order_id = o.id
          order by l.scheduled_date desc nulls last
          limit 1
        ) ld on true
      )
      select
        case when kind = 'internal' then 'internal' when is_transfer then 'transfer' else 'external' end as bucket,
        case when kind = 'internal' then customer when is_transfer then department else null end as customer_or_dept,
        count(*) as order_count, count(miles) as orders_with_miles, sum(miles) as total_miles
      from base
      where ($1 is null or activity_date >= $1)
        and ($2 is null or activity_date <= $2)
      group by 1, 2
      order by 1, total_miles desc nulls last$q$;
  else
    raise exception 'unknown report %', p_name;
  end case;
  -- Materialise once so the column types are known: the Python server
  -- printed every numeric value through float() ("255.0"), and the browser
  -- needs to know which columns those are to write identical CSVs.
  execute 'create temp table _dept12_report on commit drop as ' || q using p_from, p_to;
  select coalesce(array_agg(attname::text order by attnum), '{}') into nums from pg_attribute
  where attrelid = 'pg_temp._dept12_report'::regclass and attnum > 0 and not attisdropped
    and atttypid = 'numeric'::regtype;
  execute 'select coalesce(json_agg(t), ''[]''::json) from pg_temp._dept12_report t' into res;
  drop table pg_temp._dept12_report;
  return json_build_object('numeric_columns', nums, 'rows', res);
end $$;

-- api_report materialises each report in a temp table (to learn its column
-- types). Postgres grants TEMP to everyone by default; make it explicit.
do $$ begin
  execute format('grant temporary on database %I to authenticated', current_database());
exception when others then
  raise notice 'could not grant TEMP (reports need it): %', sqlerrm;
end $$;

-- ═══ Grants ══════════════════════════════════════════════════════════════
-- Only signed-in users may call these; anon (the bare publishable key) may
-- not call anything. Internal dept12_* helpers are not API surface.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and (p.proname like 'api\_%' or p.proname like 'dept12\_%'
                  or p.proname like 'motive\_%' or p.proname like 'driver\_week\_%')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.proname not like 'dept12\_%' or f.proname in
       ('dept12_actor_name', 'dept12_is_admin', 'dept12_require_admin', 'dept12_request_header') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
-- Internal helpers are still called from the invoker functions above, so
-- the authenticated role needs execute on them too — but only indirectly;
-- grant them, while keeping purge/begin_event (definer, audit-writing) off.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname like 'dept12\_%'
             and p.proname not in ('dept12_history_purge', 'dept12_begin_event',
                                   'dept12_history_apply_inverse', 'dept12_history_target',
                                   'dept12_history_baseline', 'dept12_capture_history')
  loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';

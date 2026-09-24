-- ============================================================================
-- Dept 12 Dashboard — initial schema
--
-- Modeled on freight entities, not on the spreadsheet's column layout.
-- See docs/schema.md for the reasoning and docs/decisions.md for the calls made.
--
-- Two money paths, deliberately separate:
--   external load  -> invoices.amount            (billed to broker/customer)
--   internal load  -> loads.internal_freight_amount (charged to the bag plant,
--                     aggregated weekly per truck), AND an end-customer invoice
-- ============================================================================

create extension if not exists pgcrypto;    -- gen_random_uuid()
create extension if not exists btree_gist;  -- exclusion constraint on truck assignments

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────────

create type load_kind      as enum ('external', 'internal');
create type stop_kind      as enum ('pickup', 'delivery');
create type document_kind  as enum ('rate_con', 'pod', 'invoice', 'package', 'other');

-- Internal order pipeline. 'released' = production handed over paperwork saying
-- it is ready to haul. Scheduling is a separate act from releasing.
create type order_stage    as enum ('ordered', 'released', 'scheduled', 'delivered', 'closed', 'cancelled');

-- A load is one truck run. 'closed' means paperwork is back and it has been
-- billed / transferred.
create type load_status    as enum ('planned', 'assigned', 'in_transit', 'delivered', 'closed', 'cancelled');

-- How a document got attached to a load. Recorded so bad auto-matches are
-- auditable rather than invisible.
create type match_method   as enum ('solomon_order_no', 'broker_load_no', 'filename', 'document_text', 'manual', 'unmatched');

-- ─────────────────────────────────────────────────────────────────────────────
-- Shared trigger: maintain updated_at
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- parties — customers, brokers, and outside carriers in one table
--
-- Merges the sheet's "Outside Customer List" (AP email) and "Bagger Customers"
-- (manager, phone) rather than duplicating the same companies across two tabs.
-- Roles are flags because one company can be more than one thing.
-- ─────────────────────────────────────────────────────────────────────────────

create table parties (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  is_customer   boolean not null default false,
  is_broker     boolean not null default false,
  is_carrier    boolean not null default false,
  ap_email      text,
  phone         text,
  manager_name  text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint parties_has_a_role check (is_customer or is_broker or is_carrier)
);

create unique index parties_name_unique on parties (lower(name));
create index parties_broker_idx on parties (id) where is_broker;

comment on table parties is
  'Customers, brokers, and outside carriers. The "++" suffix seen on 7 of 102 '
  'broker names in the legacy sheet is legacy noise and is stripped at import '
  '(decision D5) — do not store it.';

create trigger parties_updated_at before update on parties
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- locations — physical places we pick up from or deliver to
--
-- Merges "Pick/Drop List" and the address side of "Bagger Customers".
-- standard_miles carries the mileage data that already lives in the sheet's
-- customer list; a load may override it with actual miles.
-- ─────────────────────────────────────────────────────────────────────────────

create table locations (
  id                   uuid primary key default gen_random_uuid(),
  party_id             uuid references parties(id) on delete set null,
  name                 text not null,
  address              text,
  city                 text,
  state                text,
  postal_code          text,
  phone                text,
  appointment_required boolean not null default false,
  map_url              text,

  -- 'NF' (no forklift), 'forklift', 'spyder' — from Bagger Customers col E.
  forklift             text check (forklift in ('NF', 'forklift', 'spyder')),

  -- 'early', 'anytime', 'umatilla' — from Bagger Customers col F. Drives the
  -- Current Week colour legend today.
  timing_window        text check (timing_window in ('early', 'anytime', 'umatilla')),

  -- Typical one-way miles to this location. Typed in for now; a Motive ELD
  -- integration may supply actuals later (decision D11).
  standard_miles       numeric(7,1) check (standard_miles >= 0),

  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index locations_party_idx on locations (party_id);

create trigger locations_updated_at before update on locations
  for each row execute function set_updated_at();

-- location_images — the storeimages feature. Points at external URLs; the
-- ~300 MB image repo is never vendored into this one.
create table location_images (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  image_url   text not null,
  caption     text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index location_images_location_idx on location_images (location_id, sort_order);

-- ─────────────────────────────────────────────────────────────────────────────
-- Fleet — drivers and trucks are separate, linked over time
--
-- The sheet conflates them into one column header ("Jordan 63/80 F") and has a
-- "Swap Trucks Between Drivers" feature with nowhere to record the change. The
-- result is that a load hauled in March silently reports today's truck.
-- The date range fixes that (decision D4).
-- ─────────────────────────────────────────────────────────────────────────────

create table drivers (
  id         uuid primary key default gen_random_uuid(),
  full_name  text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index drivers_name_unique on drivers (lower(full_name));

create trigger drivers_updated_at before update on drivers
  for each row execute function set_updated_at();

create table trucks (
  id             uuid primary key default gen_random_uuid(),
  number         text not null,
  -- F = flatbed, BT = B-Train, CV = Curtain Van (flatbed fleet; from the sheet's headers)
  equipment_type text not null check (equipment_type in ('BT', 'F', 'CV')),
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index trucks_number_unique on trucks (lower(number));

create trigger trucks_updated_at before update on trucks
  for each row execute function set_updated_at();

create table driver_truck_assignments (
  id             uuid primary key default gen_random_uuid(),
  driver_id      uuid not null references drivers(id) on delete cascade,
  truck_id       uuid not null references trucks(id)  on delete cascade,
  effective_from date not null,
  effective_to   date,          -- null = current
  created_at     timestamptz not null default now(),

  constraint dta_range_valid check (effective_to is null or effective_to >= effective_from),

  -- A truck cannot be assigned to two drivers over the same dates.
  constraint dta_no_truck_overlap exclude using gist (
    truck_id with =,
    daterange(effective_from, effective_to, '[]') with &&
  ),
  -- A driver cannot hold two trucks over the same dates.
  constraint dta_no_driver_overlap exclude using gist (
    driver_id with =,
    daterange(effective_from, effective_to, '[]') with &&
  )
);

create index dta_driver_idx on driver_truck_assignments (driver_id, effective_from);
create index dta_truck_idx  on driver_truck_assignments (truck_id,  effective_from);

-- ─────────────────────────────────────────────────────────────────────────────
-- orders — a Solomon order. The unit the business tracks BEFORE it is hauled.
--
-- Both departments live here: 12-xxxx-xxxx is Dept 12, 07-xxxx-xxxx is another
-- department whose orders Nate still has to deliver ~80% of, so he needs the
-- pipeline visibility either way. `department` is just the prefix.
-- ─────────────────────────────────────────────────────────────────────────────

create table orders (
  id                uuid primary key default gen_random_uuid(),
  kind              load_kind not null,

  -- 12-0426-0001. Canonical regex /\d{2}-\d{4}-\d{4}/ already exists in the
  -- legacy TMS code at Code.js:517 and :876 — reuse it, do not reinvent.
  solomon_order_no  text check (solomon_order_no ~ '^\d{2}-\d{4}-\d{4}$'),

  -- Derived, not entered. left() is immutable so this can be a stored column.
  department        text generated always as (left(solomon_order_no, 2)) stored,

  -- The broker's own number off the rate con. Independent namespace from
  -- solomon_order_no (decision D2).
  broker_load_no    text,

  customer_party_id uuid references parties(id) on delete restrict,
  broker_party_id   uuid references parties(id) on delete restrict,

  po_number         text,   -- "PU/PO" in the External Order Tracker
  delivery_number   text,
  pallet_count      integer check (pallet_count >= 0),   -- the "PAL" column

  stage             order_stage not null default 'ordered',

  ordered_at        date,
  released_at       timestamptz,  -- production handed over release paperwork
  requested_delivery_date date,
  delivered_at      date,         -- what syncDeliveryDates writes back today

  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Partial unique: prevents the same Solomon order being billed twice, while
-- still allowing orders that do not have one yet.
create unique index orders_solomon_unique
  on orders (solomon_order_no) where solomon_order_no is not null;

-- The same broker may reuse load numbers; the pair must still be unique.
create unique index orders_broker_load_unique
  on orders (broker_party_id, broker_load_no)
  where broker_load_no is not null and broker_party_id is not null;

create index orders_stage_idx      on orders (stage);
create index orders_customer_idx   on orders (customer_party_id);
create index orders_department_idx on orders (department);
create index orders_delivered_idx  on orders (delivered_at);

create trigger orders_updated_at before update on orders
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- loads — one truck run on one day. This is a scheduler grid cell.
--
-- External: normally one order, one pickup, several drops, one billed rate.
-- Internal: several orders combined onto one truck.
--
-- Driver/truck/date/slot live here rather than in a separate assignments table
-- because a load IS inherently one truck on one day.
-- ─────────────────────────────────────────────────────────────────────────────

create table loads (
  id             uuid primary key default gen_random_uuid(),
  kind           load_kind not null,
  status         load_status not null default 'planned',

  scheduled_date date,

  -- Either an internal driver+truck, or an outside carrier — never both.
  driver_id         uuid references drivers(id) on delete restrict,
  truck_id          uuid references trucks(id)  on delete restrict,
  carrier_party_id  uuid references parties(id) on delete restrict,

  -- Position within the driver's day. The sheet allowed 3 (3 rows per date);
  -- kept at 3 for now but no longer a layout constraint (decision D10).
  slot           integer check (slot between 1 and 3),

  -- Actual miles for this run. Defaults from locations.standard_miles at
  -- creation time; typed in for now, Motive ELD later.
  miles          numeric(7,1) check (miles >= 0),

  -- INTERNAL ONLY: what the bag plant is charged for this freight. Entered by
  -- hand, never calculated. Feeds the weekly per-truck freight transfer.
  internal_freight_amount numeric(12,2) check (internal_freight_amount >= 0),

  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- Outside-carrier loads have no internal driver; internal-fleet loads have no
  -- carrier. A planned load may have neither yet.
  constraint loads_driver_xor_carrier check (
    (carrier_party_id is null) or (driver_id is null and truck_id is null)
  ),
  -- A truck without a driver (or vice versa) is meaningless.
  constraint loads_driver_truck_together check (
    (driver_id is null) = (truck_id is null)
  ),
  -- Only internal loads carry a bag-plant freight charge.
  constraint loads_internal_freight_only check (
    internal_freight_amount is null or kind = 'internal'
  )
);

-- One driver cannot be in two places in the same slot on the same day.
create unique index loads_driver_slot_unique
  on loads (driver_id, scheduled_date, slot)
  where driver_id is not null and scheduled_date is not null and slot is not null;

create index loads_scheduled_idx on loads (scheduled_date);
create index loads_status_idx    on loads (status);
create index loads_driver_idx    on loads (driver_id, scheduled_date);
create index loads_truck_idx     on loads (truck_id, scheduled_date);

create trigger loads_updated_at before update on loads
  for each row execute function set_updated_at();

-- load_orders — which orders ride on which load.
-- Many-to-one for internal (several orders per truck), normally one row for
-- external. A join table rather than a column so internal works without
-- special-casing.
create table load_orders (
  load_id   uuid not null references loads(id)  on delete cascade,
  order_id  uuid not null references orders(id) on delete restrict,
  sequence  integer not null default 1,
  primary key (load_id, order_id)
);

create index load_orders_order_idx on load_orders (order_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- load_stops — the itinerary. One pickup, many drops is the normal shape.
--
-- Replaces the single pickup/delivery column pair, which cannot express
-- multi-drop at all.
-- ─────────────────────────────────────────────────────────────────────────────

create table load_stops (
  id                   uuid primary key default gen_random_uuid(),
  load_id              uuid not null references loads(id) on delete cascade,
  sequence             integer not null,
  stop_type            stop_kind not null,
  location_id          uuid references locations(id) on delete restrict,

  -- Which order this drop is for. Essential on internal multi-order loads so a
  -- delivery can be attributed to the right order.
  order_id             uuid references orders(id) on delete set null,

  scheduled_at         timestamptz,
  arrived_at           timestamptz,
  departed_at          timestamptz,
  appointment_required boolean not null default false,
  notes                text,   -- tarp requirements, appointment info (Ext col F)
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (load_id, sequence)
);

create index load_stops_load_idx     on load_stops (load_id, sequence);
create index load_stops_order_idx    on load_stops (order_id);
create index load_stops_location_idx on load_stops (location_id);

create trigger load_stops_updated_at before update on load_stops
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- documents — the PDF is an attachment, never the record.
--
-- Key fields are extracted into columns at ingest. Unmatched documents are
-- allowed (all FKs null) so they can sit in a queue for manual attach rather
-- than being auto-attached on a weak guess (decision D7).
--
-- PODs attach to a STOP, because whether a multi-drop load produces one POD or
-- one per drop varies by customer. load_stop_id is nullable so both work.
-- ─────────────────────────────────────────────────────────────────────────────

create table documents (
  id                    uuid primary key default gen_random_uuid(),
  doc_type              document_kind not null,

  load_id               uuid references loads(id)      on delete cascade,
  order_id              uuid references orders(id)     on delete cascade,
  load_stop_id          uuid references load_stops(id) on delete cascade,

  storage_path          text not null,   -- Supabase Storage
  original_filename     text,

  raw_text              text,            -- extracted or OCR'd text
  extracted_fields      jsonb not null default '{}'::jsonb,
  extraction_confidence numeric(4,3) check (extraction_confidence between 0 and 1),

  matched_by            match_method not null default 'unmatched',
  matched_at            timestamptz,
  uploaded_at           timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Anything not 'unmatched' must actually point at something.
  constraint documents_matched_has_target check (
    matched_by = 'unmatched'
      or load_id is not null
      or order_id is not null
      or load_stop_id is not null
  )
);

create index documents_load_idx      on documents (load_id);
create index documents_order_idx     on documents (order_id);
create index documents_stop_idx      on documents (load_stop_id);
create index documents_type_idx      on documents (doc_type);
create index documents_unmatched_idx on documents (uploaded_at) where matched_by = 'unmatched';
create index documents_fields_idx    on documents using gin (extracted_fields);

create trigger documents_updated_at before update on documents
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- invoices — a financial event, not a file. The invoice amount is the money of
-- record, because invoice generation is what closes a load out and the rate con
-- may be superseded by adjustments (decision D9).
-- ─────────────────────────────────────────────────────────────────────────────

create table invoices (
  id                uuid primary key default gen_random_uuid(),
  load_id           uuid references loads(id)  on delete restrict,
  order_id          uuid references orders(id) on delete restrict,
  customer_party_id uuid not null references parties(id) on delete restrict,

  invoice_number    text not null,
  amount            numeric(12,2) not null check (amount >= 0),

  issued_at         date not null default current_date,
  sent_at           timestamptz,
  archived_at       timestamptz,

  -- The generated invoice/package PDF.
  document_id       uuid references documents(id) on delete set null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint invoices_has_subject check (load_id is not null or order_id is not null)
);

create unique index invoices_number_unique on invoices (lower(invoice_number));
create index invoices_customer_idx on invoices (customer_party_id, issued_at);
create index invoices_load_idx     on invoices (load_id);

create trigger invoices_updated_at before update on invoices
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- freight_transfers — the weekly internal charge to the bag plant, per truck.
--
-- The amounts come from loads.internal_freight_amount; this table records that
-- a transfer was actually posted, so a week can be reconciled and not
-- double-posted. v_freight_transfer_weekly computes the pending numbers.
-- ─────────────────────────────────────────────────────────────────────────────

create table freight_transfers (
  id           uuid primary key default gen_random_uuid(),
  truck_id     uuid not null references trucks(id) on delete restrict,
  week_start   date not null,   -- Monday
  total_amount numeric(12,2) not null check (total_amount >= 0),
  load_count   integer not null default 0 check (load_count >= 0),
  posted_at    timestamptz,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint ft_week_starts_monday check (extract(isodow from week_start) = 1),
  unique (truck_id, week_start)
);

create index freight_transfers_week_idx on freight_transfers (week_start);

create trigger freight_transfers_updated_at before update on freight_transfers
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Views — the reporting surface. Phase 6 exports these to CSV.
--
-- Season is computed here rather than stored: the boundary is fixed at Jan–Jul
-- peak / Aug–Dec off (decision D12), so there is nothing to maintain by hand.
-- ─────────────────────────────────────────────────────────────────────────────

create view v_orders_reporting as
select
  o.*,
  case when extract(month from coalesce(o.delivered_at, o.ordered_at)) between 1 and 7
       then 'peak' else 'off' end                       as season,
  c.name                                                as customer_name,
  b.name                                                as broker_name,
  (o.delivered_at - o.ordered_at)                       as days_order_to_delivery,
  (o.delivered_at - o.released_at::date)                as days_release_to_delivery
from orders o
left join parties c on c.id = o.customer_party_id
left join parties b on b.id = o.broker_party_id;

comment on view v_orders_reporting is
  'Orders with season and lead-time metrics. days_order_to_delivery is the '
  'primary KPI (decision D13).';

-- Loads with the truck that was ACTUALLY assigned on the day it ran — not
-- whatever truck the driver has now. This is the whole point of the date-ranged
-- driver_truck_assignments table.
create view v_loads_reporting as
select
  l.id,
  l.kind,
  l.status,
  l.scheduled_date,
  l.miles,
  l.internal_freight_amount,
  d.full_name                                  as driver_name,
  coalesce(t_hist.number, t_cur.number)        as truck_number,
  coalesce(t_hist.equipment_type, t_cur.equipment_type) as equipment_type,
  car.name                                     as outside_carrier_name,
  (select count(*) from load_stops s
    where s.load_id = l.id and s.stop_type = 'delivery') as drop_count
from loads l
left join drivers d   on d.id = l.driver_id
left join trucks  t_cur on t_cur.id = l.truck_id
left join parties car on car.id = l.carrier_party_id
left join lateral (
  select tr.number, tr.equipment_type
  from driver_truck_assignments a
  join trucks tr on tr.id = a.truck_id
  where a.driver_id = l.driver_id
    and l.scheduled_date >= a.effective_from
    and (a.effective_to is null or l.scheduled_date <= a.effective_to)
  limit 1
) t_hist on true;

-- Weekly internal freight transfer, per truck. Loads that are delivered or
-- closed and carry an amount, grouped into ISO weeks.
create view v_freight_transfer_weekly as
select
  l.truck_id,
  t.number                                        as truck_number,
  date_trunc('week', l.scheduled_date)::date      as week_start,
  count(*)                                        as load_count,
  sum(l.internal_freight_amount)                  as total_amount
from loads l
join trucks t on t.id = l.truck_id
where l.kind = 'internal'
  and l.internal_freight_amount is not null
  and l.status in ('delivered', 'closed')
group by l.truck_id, t.number, date_trunc('week', l.scheduled_date);

comment on view v_freight_transfer_weekly is
  'Pending weekly per-truck charge to the bag plant. Reconcile against the '
  'freight_transfers table, which records what was actually posted.';

-- Loads missing paperwork. A load needs a POD; since some customers sign per
-- stop and some sign once (decision D14), this reports loads with NO pod at all
-- rather than assuming one per drop.
create view v_loads_missing_pod as
select
  l.id                as load_id,
  l.kind,
  l.scheduled_date,
  d.full_name         as driver_name,
  string_agg(distinct p.name, ', ') as customers
from loads l
left join drivers d      on d.id = l.driver_id
left join load_orders lo on lo.load_id = l.id
left join orders o       on o.id = lo.order_id
left join parties p      on p.id = o.customer_party_id
where l.status in ('delivered', 'closed')
  and not exists (
    select 1 from documents doc
    left join load_stops s on s.id = doc.load_stop_id
    where doc.doc_type = 'pod'
      and (doc.load_id = l.id or s.load_id = l.id)
  )
group by l.id, l.kind, l.scheduled_date, d.full_name;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
--
-- Written as if live, per the golden rule, but this is not pointed at a hosted
-- project yet. Deny by default: anon gets nothing. Drivers get NO database
-- access at all — they stay on the read-only mirror Sheet, which is exactly why
-- that boundary is worth keeping.
-- ─────────────────────────────────────────────────────────────────────────────

alter table parties                  enable row level security;
alter table locations                enable row level security;
alter table location_images          enable row level security;
alter table drivers                  enable row level security;
alter table trucks                   enable row level security;
alter table driver_truck_assignments enable row level security;
alter table orders                   enable row level security;
alter table loads                    enable row level security;
alter table load_orders              enable row level security;
alter table load_stops               enable row level security;
alter table documents                enable row level security;
alter table invoices                 enable row level security;
alter table freight_transfers        enable row level security;

-- Supabase provides the `anon` and `authenticated` roles; a plain Postgres
-- instance does not. Create them only if missing so this migration applies
-- identically to a local validation database and to Supabase, where this block
-- is a no-op.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
end $$;

-- Staff (any authenticated user) get full access for now. Tighten to explicit
-- roles when there is more than one class of user in the app.
do $$
declare t text;
begin
  foreach t in array array[
    'parties','locations','location_images','drivers','trucks',
    'driver_truck_assignments','orders','loads','load_orders','load_stops',
    'documents','invoices','freight_transfers'
  ] loop
    execute format(
      'create policy %I_staff_all on %I for all to authenticated using (true) with check (true)',
      t, t
    );
  end loop;
end $$;

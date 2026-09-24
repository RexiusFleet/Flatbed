-- Planned itinerary for external orders before they are placed on a truck.
-- The common workflow remains one pickup + one delivery; route_mode only
-- exposes the advanced editor when a user deliberately saves a custom route.
alter table orders
  add column if not exists route_mode text not null default 'simple'
  check (route_mode in ('simple', 'custom'));

create table if not exists order_stops (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references orders(id) on delete cascade,
  sequence             integer not null check (sequence > 0),
  stop_type            stop_kind not null,
  location_id          uuid references locations(id) on delete restrict,
  reference_number     text,
  scheduled_at         timestamptz,
  appointment_required boolean not null default false,
  pallet_count         integer check (pallet_count >= 0),
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (order_id, sequence)
);

create index if not exists order_stops_order_idx on order_stops (order_id, sequence);
create index if not exists order_stops_location_idx on order_stops (location_id);

create trigger order_stops_updated_at before update on order_stops
  for each row execute function set_updated_at();

alter table load_stops
  add column if not exists order_stop_id uuid references order_stops(id) on delete set null;
create unique index if not exists load_stops_order_stop_idx
  on load_stops (load_id, order_stop_id) where order_stop_id is not null;

-- Every existing external order gets the same invisible two-stop route it has
-- today. Null locations are intentional: references may be entered first.
insert into order_stops (order_id, sequence, stop_type, location_id, reference_number)
select o.id, 1, 'pickup', o.pickup_location_id, o.po_number
from orders o
where o.kind = 'external'
  and not exists (select 1 from order_stops s where s.order_id = o.id and s.sequence = 1);

insert into order_stops (order_id, sequence, stop_type, location_id, reference_number)
select o.id, 2, 'delivery', o.delivery_location_id, o.delivery_number
from orders o
where o.kind = 'external'
  and not exists (select 1 from order_stops s where s.order_id = o.id and s.sequence = 2);

alter table order_stops enable row level security;

create policy order_stops_staff_all on order_stops
  for all to authenticated using (true) with check (true);

-- D103: internal mileage/transfer-$ move from loads to orders so Nate can
-- fill them in the moment an internal order exists, with no requirement to
-- stage or schedule it on a truck first. loads.miles/internal_freight_amount/
-- motive_miles/miles_adjusted are left in place (external loads still carry
-- loads.miles) but the internal drawer/grid and Motive sync stop writing to
-- them going forward.
alter table orders add column miles numeric(7,1) check (miles >= 0);
alter table orders add column miles_adjusted boolean not null default false;
alter table orders add column motive_miles numeric(7,1) check (motive_miles >= 0);
alter table orders add column internal_freight_amount numeric(12,2) check (internal_freight_amount >= 0);

alter table orders add constraint orders_internal_freight_only check (
  kind = 'internal' or (
    miles is null and motive_miles is null and internal_freight_amount is null
    and not miles_adjusted
  )
);

comment on column orders.miles is
  'Actual one-way miles for this internal order''s run (D103, was loads.miles).';
comment on column orders.internal_freight_amount is
  'INTERNAL ONLY: what the bag plant is charged for this order. Hand-entered, '
  'editable before the order is ever staged (D103, was loads.internal_freight_amount).';

-- Backfill from whatever a combined load already carried: miles is the same
-- truck run for every order riding it, so it copies across unchanged; the
-- freight dollar figure was one hand-entered total for the whole load, so
-- split it evenly per order to keep truck-week sums correct after the move.
with per_load as (
  select lo.order_id, l.miles, l.miles_adjusted, l.motive_miles, l.internal_freight_amount,
         count(*) over (partition by l.id) as orders_on_load
  from load_orders lo
  join loads l on l.id = lo.load_id
  where l.kind = 'internal'
)
update orders o set
  miles = per_load.miles,
  miles_adjusted = coalesce(per_load.miles_adjusted, false),
  motive_miles = per_load.motive_miles,
  internal_freight_amount = round(per_load.internal_freight_amount / nullif(per_load.orders_on_load, 0), 2)
from per_load
where per_load.order_id = o.id;

-- Reporting views: internal figures now come from orders (joined through
-- load_orders/loads for truck/date/status); external loads are untouched.
create or replace view v_loads_reporting as
select
  l.id,
  l.kind,
  l.status,
  l.scheduled_date,
  coalesce(ord.miles, l.miles)::numeric(7,1)             as miles,
  coalesce(ord.internal_freight_total, l.internal_freight_amount)::numeric(12,2) as internal_freight_amount,
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
) t_hist on true
left join lateral (
  select max(o.miles) as miles, sum(o.internal_freight_amount) as internal_freight_total
  from load_orders lo join orders o on o.id = lo.order_id
  where lo.load_id = l.id
) ord on true;

create or replace view v_freight_transfer_weekly as
select
  l.truck_id,
  t.number                                        as truck_number,
  date_trunc('week', l.scheduled_date)::date      as week_start,
  count(distinct l.id)                            as load_count,
  sum(o.internal_freight_amount)                  as total_amount
from loads l
join trucks t on t.id = l.truck_id
join load_orders lo on lo.load_id = l.id
join orders o on o.id = lo.order_id
where l.kind = 'internal'
  and o.internal_freight_amount is not null
  and l.status in ('delivered', 'closed')
group by l.truck_id, t.number, date_trunc('week', l.scheduled_date);

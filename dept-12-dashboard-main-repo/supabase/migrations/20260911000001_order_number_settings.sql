-- D217: order numbers are identifiers, not storage for order type or period.
-- Existing numbers remain byte-for-byte unchanged. New Bag Order numbers use
-- an admin-defined pattern, while order_period keeps month/year grouping stable
-- even when that pattern changes. External numbers remain entered by staff;
-- their pattern supplies the current example and department code only.

alter table orders add column if not exists order_period date;

-- Preserve the current Bag Order grouping for historical standard-format rows.
-- Invalid/nonstandard historical values stay visible through the client's
-- legacy fallback and can be assigned a period later without renumbering them.
update orders
set order_period = make_date(
  2000 + substring(solomon_order_no from 6 for 2)::integer,
  substring(solomon_order_no from 4 for 2)::integer,
  1
)
where kind = 'internal'
  and solomon_order_no ~ '^..-(0[1-9]|1[0-2])[0-9]{2}-[0-9]+$';

-- `department` used to be generated from the first two characters of the
-- visible number. Make it ordinary stored data so patterns can put any text
-- first (or omit a department token entirely) without changing reports.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='orders' and column_name='department'
      and is_generated='ALWAYS'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='orders' and column_name='department_legacy'
  ) then
    alter table orders rename column department to department_legacy;
    alter table orders add column department text;
  end if;
end $$;

-- The original reporting view expanded `o.*`, so PostgreSQL follows a renamed
-- column. Rebuild it around the stored department before removing the legacy
-- generated column. No report rows are materialized or lost.
drop view if exists v_orders_reporting;
drop index if exists orders_department_idx;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='orders' and column_name='department_legacy'
  ) then
    update orders set department = department_legacy where department is null;
    alter table orders drop column department_legacy;
  end if;
end $$;
create index if not exists orders_department_idx on orders (department);
create index if not exists orders_order_period_idx on orders (order_period);

create view v_orders_reporting as
select
  o.*,
  case when extract(month from coalesce(o.delivered_at, o.ordered_at)) between 1 and 7
       then 'peak' else 'off' end as season,
  c.name as customer_name,
  b.name as broker_name,
  (o.delivered_at - o.ordered_at) as days_order_to_delivery,
  (o.delivered_at - o.released_at::date) as days_release_to_delivery
from orders o
left join parties c on c.id = o.customer_party_id
left join parties b on b.id = o.broker_party_id;

comment on view v_orders_reporting is
  'Orders with season and lead-time metrics. days_order_to_delivery is the primary KPI (decision D13).';

create table if not exists order_number_settings (
  id                  smallint primary key default 1 check (id = 1),
  internal_pattern    text not null default '07-{MM}{YY}-{####}',
  internal_department text not null default '07',
  external_pattern    text not null default '12-{MM}{YY}-{####}',
  external_department text not null default '12',
  updated_at          timestamptz not null default now()
);

insert into order_number_settings (id) values (1) on conflict (id) do nothing;

drop trigger if exists order_number_settings_updated_at on order_number_settings;
create trigger order_number_settings_updated_at before update on order_number_settings
  for each row execute function set_updated_at();

alter table order_number_settings enable row level security;
drop policy if exists order_number_settings_staff_all on order_number_settings;
create policy order_number_settings_staff_all on order_number_settings
  for all to authenticated using (true) with check (true);

drop trigger if exists dept12_history_capture on order_number_settings;
create trigger dept12_history_capture after insert or update or delete on order_number_settings
  for each row execute function dept12_capture_history('id');

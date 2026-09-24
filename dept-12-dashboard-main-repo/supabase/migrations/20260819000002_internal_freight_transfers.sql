-- D127: Internal Freight tracker — dept-to-dept mileage/$ transfers that
-- carry no customer at all (e.g. "Bag Plant to Umatilla Yard"). Today these
-- get typed into External Orders with everything left blank, which turned
-- out to be indistinguishable from messy legacy-import data on inspection
-- (some blank-customer external rows are real commercial loads that just
-- never got their PO/customer typed in). Nate's call: explicit flag only,
-- going forward — legacy data stays legacy, not retrofitted.
--
-- Departments is a real lookup table (5th builtin Database grid, same tier
-- as parties/trucks/locations — fields.type='relation' is an unimplemented
-- placeholder, so a custom entity would give up real FK enforcement).
--
-- Transfers stay kind='external' (loads.kind is just copied from
-- orders.kind at placement time, so this needs no load_kind enum change,
-- and the ~19+9 call sites that branch on kind across the app don't need
-- touching) — is_transfer marks them instead, and they reuse the exact same
-- miles/motive_miles/miles_adjusted/internal_freight_amount columns D103
-- gave bag-plant orders (same shape: real one-way miles + a hand-entered $
-- transfer charge, just addressed to a department instead of a customer).

create table departments (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index departments_name_ci_idx on departments (lower(name));
alter table departments enable row level security;
create policy departments_staff_all on departments for all to authenticated using (true) with check (true);

alter table orders add column is_transfer boolean not null default false;
alter table orders add column transfer_department_id uuid references departments(id) on delete restrict;

-- Keeps the "clean tell" intact going forward: a transfer never has a
-- customer/broker/solomon # (that's what makes it a transfer, not a normal
-- external order), and a department only ever applies to a transfer.
alter table orders add constraint orders_transfer_shape check (
  not is_transfer or (
    kind = 'external' and customer_party_id is null
    and broker_party_id is null and solomon_order_no is null
  )
);
alter table orders add constraint orders_transfer_department_scope check (
  transfer_department_id is null or is_transfer
);

-- Relax D103's internal-only money guard so transfers can use the same
-- miles/$ fields bag orders already have.
alter table orders drop constraint orders_internal_freight_only;
alter table orders add constraint orders_internal_freight_only check (
  kind = 'internal' or is_transfer or (
    miles is null and motive_miles is null
    and internal_freight_amount is null and not miles_adjusted
  )
);

-- Register as a 5th builtin Database entity (D85 metadata core) — gets the
-- existing generic grid renderer, add/edit/delete, and row-reorder for free.
insert into entities (name, kind, backing_table, slug, sort_order) values
  ('Departments', 'builtin', 'departments', 'departments', 5)
on conflict (slug) do nothing;

insert into fields (entity_id, key, label, type, storage, bold, sort_order, width)
select e.id, 'name', 'Department', 'text', 'column:departments.name', true, 1, 220
from entities e where e.slug = 'departments'
on conflict (entity_id, key) do nothing;

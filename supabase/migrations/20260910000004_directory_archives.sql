-- D192: External Customers and Internal Freight use the same reversible
-- archive pattern as Bagger Customers. Each timestamp is scoped to its own
-- role/directory so a shared party can remain active in another role.

alter table parties
  add column broker_archived_at timestamptz;

alter table departments
  add column archived_at timestamptz;

create index parties_active_broker_order_idx
  on parties (sort_order, name)
  where is_broker and broker_archived_at is null;

create index departments_active_order_idx
  on departments (sort_order, name)
  where archived_at is null;

comment on column parties.broker_archived_at is
  'When set, hide this External Customer from active directory/order pickers while preserving historical references and any customer/carrier role.';

comment on column departments.archived_at is
  'When set, hide this Internal Freight department from active directory/order pickers while preserving historical transfer orders.';

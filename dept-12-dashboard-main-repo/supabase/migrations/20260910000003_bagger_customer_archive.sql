-- D191: Bagger Customers are a reusable directory with historical order links.
-- Removing one from future use must preserve those links, so this timestamp is
-- deliberately scoped to the customer role on the shared parties table.

alter table parties
  add column customer_archived_at timestamptz;

create index parties_active_customer_order_idx
  on parties (sort_order, name)
  where is_customer and customer_archived_at is null;

comment on column parties.customer_archived_at is
  'When set, hide this Bagger Customer from active directory/order pickers while preserving historical references and any broker/carrier role.';

-- What Nate pays an outside carrier for a load he brokers out instead of
-- running himself. carrier_party_id (and the driver_xor_carrier constraint
-- it already obeys) has been in loads since the initial schema — only the
-- cost figure was missing.
alter table loads add column if not exists carrier_cost numeric(10,2)
  check (carrier_cost is null or carrier_cost >= 0);

alter table loads add constraint loads_carrier_cost_only check (
  carrier_cost is null or carrier_party_id is not null
);

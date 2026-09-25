-- A transfer season is identified by its starting year, independent of
-- actual trip dates. Assignment is explicit: do not infer a season from
-- calendar months, since routes can have early or late trips.
alter table orders add column transfer_season integer;
alter table orders add constraint orders_transfer_season_scope check (
  transfer_season is null or (is_transfer and transfer_season between 1900 and 9998)
);

-- D142: unhide the store-map link column on Database -> Bagger Customers.
-- locations.map_url has always been a real column (already in
-- api_bootstrap's locations select, already Motive/Driver-Tabs-readable
-- via locFor(...).map_url) but was never given a `fields` row, so it never
-- rendered as a grid column and Nate had no way to see or edit it in the
-- app. Free-typed URL text, same as Notes/Fork — dcell()'s generic
-- column-backed rendering already linkifies a whole-value URL (D123).
insert into fields (entity_id, key, label, type, storage, sort_order)
select id, 'map_url', 'Store Map', 'text', 'column:locations.map_url', 110
from entities where slug = 'bagger';

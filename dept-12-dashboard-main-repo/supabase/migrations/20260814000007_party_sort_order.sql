-- Lets Nate drag-and-drop reorder rows in the Bagger Customers grid (D87
-- extended to rows, not just Scheduler truck columns). Backfilled to the
-- current alphabetical-by-name order (partitioned by is_customer so
-- customers and brokers/carriers get independent 0-based sequences even
-- though they share this one column) so nothing visibly moves until the
-- first drag.

alter table parties add column sort_order integer not null default 0;

update parties set sort_order = sub.rn
from (select id, row_number() over (partition by is_customer order by name) as rn from parties) sub
where parties.id = sub.id;

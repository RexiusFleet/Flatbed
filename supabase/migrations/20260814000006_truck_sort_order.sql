-- Lets Nate drag-and-drop reorder truck columns on the Scheduler (and Current
-- Week, which renders from the same DB.trucks array client-side, so it mirrors
-- automatically). Backfilled to the current alphanumeric-by-number order so
-- nothing visibly moves until the first drag.

alter table trucks add column sort_order integer not null default 0;

update trucks set sort_order = sub.rn
from (select id, row_number() over (order by number) as rn from trucks) sub
where trucks.id = sub.id;

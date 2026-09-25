-- D127 follow-up #2: per-department chip color, not one static tracker-wide
-- value — Nate: "same color thing we have in fleet... so i can have
-- different ones by dept if i wanted." Supersedes the single entities.color
-- swatch from 20260819000004 (dropped here) with a real per-row column, same
-- shape as Fleet's driver color field (storage='column:departments.color',
-- ui='color' — departments' own row context resolves this directly, unlike
-- Fleet's driver-id indirection, since color lives on the row itself here).
alter table entities drop column color;
alter table departments add column color text;

insert into fields (entity_id, key, label, type, storage, ui, bold, sort_order, width)
select e.id, 'color', 'Color', 'color', 'column:departments.color', 'color', false, 2, 74
from entities e where e.slug = 'departments'
on conflict (entity_id, key) do nothing;

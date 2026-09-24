-- D85 Phase 3: fill metadata gaps found while wiring the drawer to field labels.
--
-- 1. locations.is_umatilla is read by buildChip() but had no fields row on bagger
--    or pickdrop, so it couldn't be managed like every other location flag. Added
--    HIDDEN (Nate): the location Designation/category color already carries
--    Umatilla Early vs. Umatilla Anytime as distinct colors (see categories —
--    live rows split "Umatilla early"/"Umatilla anytime"), so a raw checkbox
--    duplicating that in the grid is redundant. is_umatilla stays wired (still
--    backs buildChip's EAST flag and can be unhidden later) — just not shown.
-- 2. locations.miles_from_umatilla (added 20260806000006, D36 — Rexius dispatches
--    out of two yards, Coburg and Umatilla) never got a fields row on bagger, so
--    the second mileage figure from the original sheet was invisible in the
--    Bagger Customers grid even though the column existed. Added, visible.

insert into fields (entity_id, key, label, type, storage, sort_order, width, hidden)
select e.id, f.key, f.label, f.type, f.storage, f.sort_order, f.width, f.hidden
from entities e
join (values
  ('bagger','is_umatilla','Umatilla / EAST','checkbox','column:locations.is_umatilla',8,90,true),
  ('pickdrop','is_umatilla','Umatilla / EAST','checkbox','column:locations.is_umatilla',8,90,true),
  ('bagger','miles_from_umatilla','Umatilla Miles','number','column:locations.miles_from_umatilla',10,80,false)
) as f(slug,key,label,type,storage,sort_order,width,hidden) on f.slug = e.slug
on conflict (entity_id, key) do nothing;

-- shift bagger's fields that came after "notes" so is_umatilla (hidden), then
-- standard_miles, then miles_from_umatilla land in order ahead of phone/manager.
update fields set sort_order = sort_order + 1
where entity_id = (select id from entities where slug = 'bagger')
  and key = 'standard_miles';
update fields set sort_order = sort_order + 2
where entity_id = (select id from entities where slug = 'bagger')
  and key in ('phone','manager_name');

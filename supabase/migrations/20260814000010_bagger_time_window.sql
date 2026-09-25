-- D99: the colored Bagger designation is the actual delivery Time Window.
-- Keep locations.timing_window/is_umatilla as hidden derived compatibility
-- fields for driver chips, but remove the redundant user-facing Window column.
update fields f
set label = 'Time Window'
from entities e
where f.entity_id = e.id and e.slug = 'bagger' and f.key = 'category_id';

update fields f
set hidden = true
from entities e
where f.entity_id = e.id and e.slug = 'bagger' and f.key = 'timing_window';

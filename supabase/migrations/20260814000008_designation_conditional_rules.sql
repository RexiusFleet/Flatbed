-- D94: move the editable designation colors out of the global formatting
-- toolbar and into the Bagger Customers > Designation column's own rules.
-- Existing user-defined column rules win; only migrate a still-empty field.
with designation_rules as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object('op', 'eq', 'value', name, 'color', color)
      order by sort
    ),
    '[]'::jsonb
  ) as rules
  from categories
)
update fields f
set conditional_format = r.rules
from entities e, designation_rules r
where f.entity_id = e.id
  and e.slug = 'bagger'
  and f.key = 'category_id'
  and f.conditional_format = '[]'::jsonb;

-- D127 follow-up: one static chip color for every Internal Freight transfer,
-- regardless of department. Stored on the entity itself (a single value, not
-- a per-row grid column — a per-department color would contradict "all of
-- them will be in the same color"), editable via a color swatch in
-- Database → Internal Freight's toolbar.
alter table entities add column color text;

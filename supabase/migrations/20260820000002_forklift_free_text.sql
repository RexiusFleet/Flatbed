-- D142 follow-up: the Fork column is free-typed everywhere in the app now
-- (grid cell was already free text; the Add-customer modal's locked
-- NF/forklift/spyder dropdown was switched to text too), but the DB itself
-- still enforced the old 3-value enum via locations_forklift_check --
-- typing anything else 500s the save. Drop it; this was always a note
-- field in practice ("NF", "spyder", but also things dispatchers actually
-- write like "call ahead" or "side door"), not a real enum.
alter table locations drop constraint locations_forklift_check;

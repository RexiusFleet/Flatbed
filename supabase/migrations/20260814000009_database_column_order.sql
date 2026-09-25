-- D96: metadata-backed columns and older JSON custom columns now render in one
-- draggable sequence. Put pre-existing custom columns after core fields before
-- the client starts assigning a shared 1..N order across both tables.
update grid_columns
set sort_order = 1000 + sort_order
where sort_order < 1000;

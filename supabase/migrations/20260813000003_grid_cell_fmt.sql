-- D76: per-cell formatting on the built-in Database grids (Bagger, External,
-- Pick/Drop, Fleet) — the "spreadsheet feel" without losing their structured
-- columns/behaviors. A polymorphic, sparse store: only formatted cells exist.
-- (table_name, row_id, field) identifies a cell across parties/locations/trucks;
-- fmt mirrors the scheduler + sheet per-cell jsonb (fill/text/bold/italic/size/
-- border). No FK — row_id spans several tables — cleaned up opportunistically.
create table grid_cell_fmt (
  table_name text  not null,
  row_id     uuid  not null,
  field      text  not null,
  fmt        jsonb not null default '{}'::jsonb,
  primary key (table_name, row_id, field)
);

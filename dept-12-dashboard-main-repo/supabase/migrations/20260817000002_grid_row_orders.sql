-- Saved default row order for each Database grid.
--
-- This deliberately does not point at one specific row table: built-in grids
-- use parties/locations/trucks while custom databases use records. Keeping the
-- grid key in the primary key also lets the same party be ordered differently
-- in Bagger Customers and External Customers.
create table if not exists grid_row_orders (
  grid       text not null,
  row_id     uuid not null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  primary key (grid, row_id)
);

create index if not exists grid_row_orders_sort_idx
  on grid_row_orders (grid, sort_order);

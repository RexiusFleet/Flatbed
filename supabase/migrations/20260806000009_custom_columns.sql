-- ============================================================================
-- Spreadsheet freedom for the Database section (D47). Nate is creating the
-- reference database and wants to add his own columns/rows and pick a column's
-- type (type-in vs dropdown) — but the four Database grids sit on real tables
-- the rest of the app depends on, so the app's *system* columns stay locked
-- and user-defined *custom* columns live alongside them in a JSONB bag.
--
-- Custom values live on each grid's canonical backing row:
--   bagger  -> parties (customer)     external -> parties (broker)
--   pickdrop-> locations              fleet    -> trucks
-- ============================================================================

alter table parties   add column custom jsonb not null default '{}';
alter table locations add column custom jsonb not null default '{}';
alter table trucks    add column custom jsonb not null default '{}';

-- Per-grid custom column definitions. `key` is the stable JSONB key the
-- value is stored under on the backing row's `custom`.
create table grid_columns (
  id         uuid primary key default gen_random_uuid(),
  grid       text not null,                       -- 'bagger'|'external'|'pickdrop'|'fleet'
  key        text not null,
  label      text not null,
  type       text not null default 'text'
             check (type in ('text', 'number', 'date', 'select', 'checkbox')),
  options    jsonb not null default '[]',         -- dropdown choices, for type='select'
  sort_order integer not null default 0,
  width      integer,
  created_at timestamptz not null default now(),
  unique (grid, key)
);

create index grid_columns_grid_idx on grid_columns (grid, sort_order);

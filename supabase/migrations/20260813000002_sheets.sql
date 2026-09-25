-- D74: the Database section becomes a spreadsheet app. Beyond the built-in grids
-- (Bagger Customers, External Customers, Pick/Drop, Fleet) the user can add
-- arbitrary blank "sheets" from a + in the tab row — each a real spreadsheet you
-- grow at will (default 25×25). The rest of the app is built around the database
-- and it's meant to keep evolving, so this is a generic, sparse cell store.
create table sheets (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  n_rows     int  not null default 25,
  n_cols     int  not null default 25,
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);

-- Sparse: only cells the user has touched exist. r/c are 0-based grid indices.
-- fmt mirrors the scheduler's per-cell format jsonb (fill/text/bold/italic/size/
-- border) so the same toolbar can format sheet cells later (D73).
create table sheet_cells (
  sheet_id uuid not null references sheets(id) on delete cascade,
  r        int  not null,
  c        int  not null,
  value    text,
  fmt      jsonb not null default '{}'::jsonb,
  primary key (sheet_id, r, c)
);

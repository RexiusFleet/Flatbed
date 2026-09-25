-- D65: Scheduler categories + historical-schedule support.
--
-- Two things land together because the 2025 backfill needs both:
--
-- 1. `categories` — named, colored labels for scheduler cells (D65). This is the
--    "spreadsheet tab colors" concept: paint a load chip by type, or mark a truck
--    off for a day. Seeded from Nate's own 2025 color legend. The importer tags
--    every historical load with the matching category; going forward the user
--    sets them by hand on the board.
--
-- 2. Constraint relaxations so the real 2025 data actually fits:
--    - a truck-day can hold MORE THAN 3 loads (rare, but it happens) — the old
--      1..3 slot cap is dropped; slot is now just a 1..N sequence.
--    - a load can sit on a truck with NO known driver. History is keyed on the
--      truck (drivers churn and some no longer work here — Nate); the old
--      "driver and truck are both-or-neither" check forced a phantom driver.
--      New rule: a driver still implies a truck, but a truck can stand alone.
--
-- 3. `truck_off_days` — a truck marked off/unavailable for a whole day (the red
--    rows in the sheet: OFF / FMLA / SICK / CDL physical). Not a load.
--
-- 4. `orders.custom` — provenance for imported rows ({source, raw, color, …}) so
--    the backfill is idempotent and cleanly reversible (delete where
--    custom->>'source' = 'sheet2025'). Mirrors the custom jsonb parties/locations
--    already carry.

create table categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  color       text not null,                       -- #RRGGBB
  sort        integer not null default 0,
  is_off      boolean not null default false,      -- the "truck is off" category
  created_at  timestamptz not null default now()
);

-- Seed from the 2025 legend (Nate, D65). Driver-identity colors and the
-- unknown/ignore colors are deliberately left out — color meant "which driver"
-- there, and we key on truck now.
insert into categories (name, color, sort, is_off) values
  ('Anytime store', '#FFD966', 10, false),
  ('Early store',   '#92D050', 20, false),
  ('Umatilla side', '#BF8F00', 30, false),
  ('Bag plant',     '#B6D7A8', 40, false),
  ('Other dept',    '#FFFF00', 50, false),
  ('Don''t miss',   '#FF00FF', 60, false),
  ('Off',           '#FF0000', 70, true);

alter table loads add column category_id uuid references categories(id) on delete set null;

alter table loads drop constraint loads_slot_check;
alter table loads add constraint loads_slot_check check (slot is null or slot >= 1);

alter table loads drop constraint loads_driver_truck_together;
alter table loads add constraint loads_driver_implies_truck
  check (driver_id is null or truck_id is not null);

create table truck_off_days (
  truck_id    uuid not null references trucks(id) on delete cascade,
  off_date    date not null,
  note        text,
  category_id uuid references categories(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (truck_id, off_date)
);

alter table orders add column custom jsonb not null default '{}'::jsonb;

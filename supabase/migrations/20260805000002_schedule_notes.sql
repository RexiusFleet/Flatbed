-- ============================================================================
-- Free-text scheduler cells.
--
-- A scheduler cell holds either a real load or whatever the dispatcher types —
-- "SHOP — DOT inspection", "Wayne vacation". The sheet always allowed this and
-- taking it away would be a downgrade (decision D19).
--
-- These are NOT loads. Keeping them out of `loads` means `loads` still means
-- "a truck run that happened", so every revenue and utilisation query stays
-- honest without needing to filter notes out.
-- ============================================================================

create table schedule_notes (
  id             uuid primary key default gen_random_uuid(),
  driver_id      uuid not null references drivers(id) on delete cascade,
  scheduled_date date not null,
  slot           integer not null check (slot between 1 and 3),
  body           text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (driver_id, scheduled_date, slot)
);

create index schedule_notes_date_idx on schedule_notes (scheduled_date);

create trigger schedule_notes_updated_at before update on schedule_notes
  for each row execute function set_updated_at();

alter table schedule_notes enable row level security;
create policy schedule_notes_staff_all on schedule_notes
  for all to authenticated using (true) with check (true);

-- A driver/date/slot cannot hold a load and a note at once. Enforced in the
-- application rather than by constraint, since the two live in separate tables.
comment on table schedule_notes is
  'Free-text scheduler cells. Mutually exclusive with a load in the same '
  'driver/date/slot — enforced in application code, not by constraint.';

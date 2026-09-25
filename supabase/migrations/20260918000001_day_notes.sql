-- D230: dispatcher-only notes pinned to a calendar date, not a scheduler
-- cell/truck. Nate: right-click a date on the scheduler, leave a note that
-- "never leaves the app" (no driver tab, no Sheets push) but still shows up
-- when he exports data. One note per date — editing overwrites, clearing
-- (empty text) deletes the row outright; unlike a scheduler cell's
-- schedule_notes (D82) there's no per-cell formatting to preserve alongside
-- an empty note, so there's nothing to keep around.
create table day_notes (
  id         uuid primary key default gen_random_uuid(),
  note_date  date not null unique,
  text       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger day_notes_updated_at before update on day_notes
  for each row execute function set_updated_at();

alter table day_notes enable row level security;
create policy day_notes_staff_all on day_notes for all to authenticated using (true) with check (true);

-- Same durable-history coverage every other mutable table gets (D131/D190).
create trigger dept12_history_capture
  after insert or update or delete on day_notes
  for each row execute function dept12_capture_history('id');

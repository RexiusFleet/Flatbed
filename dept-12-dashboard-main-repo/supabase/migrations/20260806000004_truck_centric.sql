-- ============================================================================
-- Truck-centric Scheduler (D32).
--
-- The Scheduler's columns become trucks, not drivers — a truck has a
-- permanent spot; the driver shown there defaults to whoever currently holds
-- it per driver_truck_assignments, and will eventually be overridden by
-- Motive ELD data per shift. Driver stays a real, independently-manageable
-- entity; it's just no longer what a column is keyed by.
-- ============================================================================

-- Free-text cells are addressed by column, and the column is now a truck.
alter table schedule_notes drop constraint schedule_notes_driver_id_scheduled_date_slot_key;
alter table schedule_notes drop constraint schedule_notes_driver_id_fkey;
alter table schedule_notes rename column driver_id to truck_id;
alter table schedule_notes add constraint schedule_notes_truck_id_fkey
  foreign key (truck_id) references trucks(id) on delete cascade;
alter table schedule_notes add constraint schedule_notes_truck_id_scheduled_date_slot_key
  unique (truck_id, scheduled_date, slot);

comment on table schedule_notes is
  'Free-text scheduler cells. Mutually exclusive with a load in the same '
  'truck/date/slot — enforced in application code, not by constraint.';

-- Driver color — a display accent on the Scheduler/Current Week column
-- header, not a full Sheets-style cell fill (explicitly declined).
alter table drivers add column color text;

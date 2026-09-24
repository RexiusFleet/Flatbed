-- D82: the 3-rows-per-day limit was dropped for loads (D65/D68 —
-- loads_slot_check became slot >= 1, and addDayRow creates slot = n+1), but
-- schedule_notes still carried CHECK (slot >= 1 AND slot <= 3). A 4th+ scheduler
-- row could hold a load yet not a note/color/format, because inserting the
-- schedule_notes row for that cell violated the stale check → silent 500. Relax
-- it to match loads.
alter table schedule_notes drop constraint if exists schedule_notes_slot_check;
alter table schedule_notes add constraint schedule_notes_slot_check check (slot >= 1);

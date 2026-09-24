-- ============================================================================
-- Split the Bagger Customers "Early/Anytime" column into two real axes (D36).
--
-- Pulling the live Bagger Customers tab turned up 4 distinct values, not 3:
-- 'Early', 'Anytime', 'Umatilla', 'Umatilla Early'. The old timing_window
-- enum ('early'/'anytime'/'umatilla') can't represent 'Umatilla Early' at
-- all — it collapses two independent facts (is this store an early-store
-- appointment, and is this an eastern-Oregon/Umatilla run) into one column.
-- Splitting them lets the color selector (D36) represent all 4 real
-- combinations instead of losing one.
--
-- No existing row uses 'umatilla' (confirmed: `select timing_window, count(*)
-- from locations group by timing_window` returns only early/anytime), so
-- narrowing the check constraint is safe with no backfill needed.
--
-- Also adding two fields the real sheet has that ours doesn't: a second
-- mileage figure (Rexius dispatches out of two yards, Coburg and Umatilla —
-- standard_miles was implicitly "from Coburg" already) and a per-location
-- email (distinct from parties.ap_email, which is AP billing, not a store
-- manager's contact).
-- ============================================================================

alter table locations add column is_umatilla boolean not null default false;
alter table locations add column miles_from_umatilla numeric(7,1) check (miles_from_umatilla >= 0);
alter table locations add column email text;

comment on column locations.standard_miles is
  'One-way miles from the Coburg yard. Paired with miles_from_umatilla for the eastern-Oregon dispatch point.';

alter table locations drop constraint locations_timing_window_check;
alter table locations add constraint locations_timing_window_check
  check (timing_window in ('early', 'anytime'));

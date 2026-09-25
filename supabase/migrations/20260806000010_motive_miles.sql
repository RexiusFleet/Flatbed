-- ============================================================================
-- Motive mileage on internal loads (D48). The internal freight transfer is
-- grounded in real ELD miles pulled per truck per day from Motive's /v1/logs
-- (odometer deltas keyed by truck number). `loads.miles` already holds the
-- effective/used figure (hand-editable since D38); we add the raw Motive pull
-- as a reference and a flag that records when Nate has typed over it, so a
-- re-sync never clobbers his adjusted number.
-- ============================================================================

alter table loads add column motive_miles   numeric(7,1) check (motive_miles >= 0);
alter table loads add column miles_adjusted  boolean not null default false;

comment on column loads.motive_miles is
  'Raw per-truck-per-day miles pulled from Motive (reference). loads.miles is the effective value.';
comment on column loads.miles_adjusted is
  'True once Nate has typed over loads.miles; the Motive sync leaves adjusted loads alone.';

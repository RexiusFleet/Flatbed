-- Motive mileage sync (D48) kept re-asking about the same historical orders
-- forever once they came back with no ELD data (pre-dates the truck/account
-- being on Motive) — motive_miles stays null, so the "needs sync" query kept
-- including it, dragging every future sync's date range back to that old
-- date. Nate: "I don't want it to try and find data for those orders" (D124).
-- motive_synced_at marks "we asked Motive about this order" independent of
-- whether it found anything, so a permanently-unmatched historical order
-- drops out of future sync attempts for good.
alter table orders add column if not exists motive_synced_at timestamptz;

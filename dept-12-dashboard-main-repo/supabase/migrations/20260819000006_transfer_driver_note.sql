-- D130: split Internal Freight transfers' single "notes" field into two —
-- "Load Info" (o.notes, unchanged: the route description shown bold on the
-- dashboard chip, e.g. "Bag Plant to Umatilla Yard # 23") and a new
-- driver_note, the text that actually gets pushed to the driver's Sheets
-- tab. Dispatchers write internal shorthand into Load Info; driver_note is
-- what's meant to be read by the driver.
alter table orders add column driver_note text;

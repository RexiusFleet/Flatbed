-- D84: drop the strict solomon_order_no format check. The number is a hand-typed
-- reference on external orders (future Acumatica join key), not something to
-- format-police at the DB — the old `^\d{2}-\d{4}-\d{4}$` check surfaced a raw DB
-- error on any non-standard entry and broke tabbing through the External Orders
-- grid. Internal auto-numbering still generates the standard 07-MMYY-#### form.
alter table orders drop constraint if exists orders_solomon_order_no_check;

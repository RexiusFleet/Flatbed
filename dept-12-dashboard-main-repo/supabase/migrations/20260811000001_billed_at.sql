-- D62: Billing completion. An external order sits in the biller queue until it's
-- billed out (invoice + POD attached, then downloaded/drafted or marked done by
-- hand). `billed_at` records when it left the queue; null = still to bill.
-- Internal orders never enter the biller — their paperwork stays on the order
-- drawer's document attach.
alter table orders add column billed_at timestamptz;
create index orders_billed_idx on orders (billed_at);

-- Tarp requirement was previously just free text typed into orders.notes
-- ("tarp, appointment, etc."). Nate wants a real toggle instead so it can be a
-- proper chip flag, not something buried in a notes string.

alter table orders add column tarp boolean not null default false;

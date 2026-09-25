-- ============================================================================
-- Pickup/Delivery addresses on external orders (D33), matching the legacy
-- External Order Tracker's G/H columns (Pickup Address / Delivery Address,
-- both dropdowns against the Pick/Drop List tab).
--
-- These live directly on `orders`, not `load_stops` — load_stops.load_id is
-- NOT NULL, so a stop can only exist once a load does, but Nate fills in
-- pickup/delivery at order-entry time, before scheduling. `locations` already
-- allows a null party_id, so the same table serves as the Pick/Drop List
-- directory with no schema change of its own.
-- ============================================================================

alter table orders add column pickup_location_id   uuid references locations(id) on delete set null;
alter table orders add column delivery_location_id uuid references locations(id) on delete set null;

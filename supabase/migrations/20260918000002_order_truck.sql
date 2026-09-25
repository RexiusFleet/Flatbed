-- D239: a real truck reference on the order itself, for Bag Orders/Internal
-- Freight's new Truck column and for the freight/mileage reports — both
-- currently resolve "which truck ran this" via a lateral subquery through
-- load_orders -> loads at report time. Populated by the existing "Sync
-- Delivery Dates" action (api_sync_delivery_dates, same single UPDATE that
-- already writes delivered_at from the same load join), not live-tracked on
-- every reschedule -- same staleness tolerance delivered_at itself already
-- has, refreshed by the same button.
alter table orders add column truck_id uuid references trucks(id) on delete set null;

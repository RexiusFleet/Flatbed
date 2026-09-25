-- Reverts 20260912000001: the Year picker already filters Internal Freight
-- by calendar year (externalOrderInYear); a separate season concept just
-- duplicated that and confused the tracker (Nate, 2026-09-12). Transfers now
-- always show under their real ordered/delivered year, never treated as
-- "2025 historical" the way ordinary bag/external import rows are.
alter table orders drop constraint orders_transfer_season_scope;
alter table orders drop column transfer_season;

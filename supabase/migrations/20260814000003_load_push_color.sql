-- D85 Phase 2 item: external push-coloring. Once a load has been pushed to the
-- driver-tab mirror, its external chip color follows the truck's CURRENT driver
-- color (reassignment-aware) instead of the pre-push fmt/category color. Internal
-- loads are unaffected — they stay purely designation-driven (D72).
alter table loads add column if not exists pushed_at timestamptz;

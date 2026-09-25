-- D170: a persisted, adjustable $/mile rate (+ optional minimum charge) for
-- internal-flavored orders — Bag Orders (kind='internal') and Internal
-- Freight transfers (is_transfer, D127), the same two buckets Motive sync
-- already treats identically (D127/D48). Applied on demand from the Orders
-- toolbar to fill blank internal_freight_amount values — never overwrites a
-- load that already has one, whether hand-entered (D38 already supports a
-- per-load override) or filled by an earlier run under a different rate.
--
-- Single settings row, not per-truck/per-customer — Nate's ask was one
-- adjustable number, not a rate table. charge = greatest(miles * rate,
-- minimum); minimum = 0 means the floor never binds (Nate: "if its set to
-- zero it will input the mile rate").
create table internal_freight_rate (
  id             uuid primary key default gen_random_uuid(),
  rate_per_mile  numeric(10,4) not null default 0,
  minimum_charge numeric(10,2) not null default 0,
  updated_at     timestamptz not null default now()
);
insert into internal_freight_rate (rate_per_mile, minimum_charge) values (0, 0);

alter table internal_freight_rate enable row level security;
create policy internal_freight_rate_staff_all on internal_freight_rate
  for all to authenticated using (true) with check (true);

-- D131's history-capture install loop (20260819000007_admin_history.sql) only
-- ran once, over the tables that existed at that migration's apply time — a
-- table created after it (this one) needs its own trigger, same function,
-- same convention (CLAUDE.md: "New mutable tables added after migration
-- 20260819000007 must receive the same trigger").
create trigger dept12_history_capture after insert or update or delete on internal_freight_rate
  for each row execute function dept12_capture_history('id');

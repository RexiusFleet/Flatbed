-- D72: conditional color for internal/bagger chips. A Bagger Customer (a
-- `locations` row) carries a *designation* — one of the scheduler `categories`
-- (Early store, Anytime store, Bag plant, Umatilla side, …). Every internal load
-- delivering to that customer draws its chip fill from the customer's
-- designation, live: recolor the category (the legend) or reassign a customer and
-- all their chips recolor at once. Internal is purely designation-driven — the
-- per-load `loads.category_id`/`loads.fmt.fill` no longer color internal chips
-- (Nate: "I only change colors on external loads"). External loads are unchanged.
alter table locations
  add column category_id uuid references categories(id) on delete set null;

comment on column locations.category_id is
  'Designation for a Bagger Customer — drives the conditional chip color for its internal loads (D72).';

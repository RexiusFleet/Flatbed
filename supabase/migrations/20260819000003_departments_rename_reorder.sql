-- D127 follow-up: Nate's ask — rename the Departments Database grid's display
-- label to "Internal Freight" and move it next to Bagger Customers in the
-- Database tab order. `slug` stays 'departments' (the stable wiring anchor
-- everything server- and client-side keys off) — this only touches the
-- renamable `name`/`sort_order` fields, same as any other entity rename.
update entities set name = 'Internal Freight', sort_order = 2 where slug = 'departments';
update entities set sort_order = 3 where slug = 'brokers';
update entities set sort_order = 4 where slug = 'pickdrop';
update entities set sort_order = 5 where slug = 'fleet';

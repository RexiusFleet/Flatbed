-- Synthetic development seed data. NOT real Rexius data — every company,
-- driver, order number and dollar amount here is invented for testing.
-- Used to verify the schema; safe to load into a local scratch database only.

begin;

-- Parties
insert into parties (id, name, is_customer, is_broker, is_carrier, ap_email) values
  ('11111111-1111-1111-1111-111111111101','Rosboro Lumber Co',   true,  false, false, 'glulamfreight@rosboro.com'),
  ('11111111-1111-1111-1111-111111111102','Tradewinds Brokerage',false, true,  false, 'ap@tradewinds.com'),
  ('11111111-1111-1111-1111-111111111103','Bi-Mart 601',         true,  false, false, null),
  ('11111111-1111-1111-1111-111111111104','Bi-Mart 602',         true,  false, false, null),
  ('11111111-1111-1111-1111-111111111105','Grange Co-op Medford',true,  false, false, null),
  ('11111111-1111-1111-1111-111111111106','Valley Freight Inc',  false, false, true,  'dispatch@valleyfreight.com');

-- Locations (standard_miles seeded from the sheet's customer list)
insert into locations (id, party_id, name, city, state, standard_miles, forklift, timing_window) values
  ('22222222-2222-2222-2222-222222222201','11111111-1111-1111-1111-111111111101','Rosboro Plant','Springfield','OR',   12.0,'forklift','anytime'),
  ('22222222-2222-2222-2222-222222222202','11111111-1111-1111-1111-111111111103','Bi-Mart 601', 'Eugene',     'OR',   18.5,'NF',      'early'),
  ('22222222-2222-2222-2222-222222222203','11111111-1111-1111-1111-111111111104','Bi-Mart 602', 'Springfield','OR',   22.0,'NF',      'early'),
  ('22222222-2222-2222-2222-222222222204','11111111-1111-1111-1111-111111111105','Grange Medford','Medford',  'OR',  168.0,'spyder',  'anytime'),
  ('22222222-2222-2222-2222-222222222205',null,                                  'Bag Plant',   'Eugene',     'OR',    0.0,'forklift','anytime');

insert into location_images (location_id, image_url, sort_order) values
  ('22222222-2222-2222-2222-222222222202','https://raw.githubusercontent.com/NateTooNice/storeimages/main/BM%20601.png',0),
  ('22222222-2222-2222-2222-222222222203','https://raw.githubusercontent.com/NateTooNice/storeimages/main/BM%20602.png',0);

-- Fleet
insert into drivers (id, full_name) values
  ('33333333-3333-3333-3333-333333333301','Wayne'),
  ('33333333-3333-3333-3333-333333333302','Jon'),
  ('33333333-3333-3333-3333-333333333303','Jordan');

insert into trucks (id, number, equipment_type) values
  ('44444444-4444-4444-4444-444444444401','31','BT'),
  ('44444444-4444-4444-4444-444444444402','33','BT'),
  ('44444444-4444-4444-4444-444444444403','72','F');

-- THE CRITICAL TEST: Wayne and Jon swap trucks on 2026-04-01.
-- The sheet cannot represent this; it would report today's truck for old loads.
insert into driver_truck_assignments (driver_id, truck_id, effective_from, effective_to) values
  ('33333333-3333-3333-3333-333333333301','44444444-4444-4444-4444-444444444401','2026-01-01','2026-03-31'),
  ('33333333-3333-3333-3333-333333333301','44444444-4444-4444-4444-444444444402','2026-04-01',null),
  ('33333333-3333-3333-3333-333333333302','44444444-4444-4444-4444-444444444402','2026-01-01','2026-03-31'),
  ('33333333-3333-3333-3333-333333333302','44444444-4444-4444-4444-444444444401','2026-04-01',null),
  ('33333333-3333-3333-3333-333333333303','44444444-4444-4444-4444-444444444403','2026-01-01',null);

-- Orders: internal = dept 07 (the bagger's own product, hauled by dept 12's
-- trucks) always; external = dept 12 (Nate's own broker business, numbered
-- by hand when he builds the order in Solomon). See decision D31.
insert into orders (id, kind, solomon_order_no, customer_party_id, broker_party_id, broker_load_no,
                    pallet_count, stage, ordered_at, released_at, delivered_at) values
  -- internal, delivered
  ('55555555-5555-5555-5555-555555555501','internal','07-0226-0001','11111111-1111-1111-1111-111111111103',null,null,14,'closed',   '2026-02-10','2026-02-16 08:00-08','2026-02-18'),
  ('55555555-5555-5555-5555-555555555502','internal','07-0226-0002','11111111-1111-1111-1111-111111111104',null,null,10,'closed',   '2026-02-11','2026-02-16 08:00-08','2026-02-18'),
  -- another dept 07 order the same month, not contiguous (a gap is normal — not every number the bagger issues gets an entry from Nate)
  ('55555555-5555-5555-5555-555555555503','internal','07-0226-0005','11111111-1111-1111-1111-111111111105',null,null,22,'closed',   '2026-02-01','2026-02-14 08:00-08','2026-02-20'),
  -- internal in May, after the truck swap
  ('55555555-5555-5555-5555-555555555504','internal','07-0526-0007','11111111-1111-1111-1111-111111111103',null,null,12,'closed',   '2026-05-04','2026-05-10 08:00-08','2026-05-12'),
  -- external broker load, one pick many drops
  ('55555555-5555-5555-5555-555555555505','external','12-0326-0044','11111111-1111-1111-1111-111111111101','11111111-1111-1111-1111-111111111102','884895',0,'closed','2026-03-02',null,'2026-03-05'),
  -- external brokered out to an outside carrier
  ('55555555-5555-5555-5555-555555555506','external','12-0626-0088','11111111-1111-1111-1111-111111111101','11111111-1111-1111-1111-111111111102','884901',0,'closed','2026-06-01',null,'2026-06-03'),
  -- still in the pipeline
  ('55555555-5555-5555-5555-555555555507','internal','07-0826-0100','11111111-1111-1111-1111-111111111104',null,null, 8,'ordered',  '2026-08-01',null,null);

-- Loads
-- L1: INTERNAL, Feb, Wayne — carries TWO orders (multi-order load)
insert into loads (id, kind, status, scheduled_date, driver_id, truck_id, slot, miles, internal_freight_amount) values
  ('66666666-6666-6666-6666-666666666601','internal','closed','2026-02-18','33333333-3333-3333-3333-333333333301','44444444-4444-4444-4444-444444444401',1,40.5,285.00),
  -- L2: INTERNAL, Feb, Jordan
  ('66666666-6666-6666-6666-666666666602','internal','closed','2026-02-20','33333333-3333-3333-3333-333333333303','44444444-4444-4444-4444-444444444403',1,336.0,940.00),
  -- L3: INTERNAL, May, Wayne — AFTER the swap, so must report truck 33 not 31
  ('66666666-6666-6666-6666-666666666603','internal','closed','2026-05-12','33333333-3333-3333-3333-333333333301','44444444-4444-4444-4444-444444444402',1,18.5,150.00),
  -- L4: EXTERNAL, Mar, Jon — one pickup, three drops
  ('66666666-6666-6666-6666-666666666604','external','closed','2026-03-05','33333333-3333-3333-3333-333333333302','44444444-4444-4444-4444-444444444402',1,210.0,null),
  -- L5: EXTERNAL brokered out — carrier, no driver/truck
  ('66666666-6666-6666-6666-666666666605','external','closed','2026-06-03',null,null,null,null,null);

update loads set carrier_party_id = '11111111-1111-1111-1111-111111111106'
  where id = '66666666-6666-6666-6666-666666666605';

insert into load_orders (load_id, order_id, sequence) values
  ('66666666-6666-6666-6666-666666666601','55555555-5555-5555-5555-555555555501',1),
  ('66666666-6666-6666-6666-666666666601','55555555-5555-5555-5555-555555555502',2),
  ('66666666-6666-6666-6666-666666666602','55555555-5555-5555-5555-555555555503',1),
  ('66666666-6666-6666-6666-666666666603','55555555-5555-5555-5555-555555555504',1),
  ('66666666-6666-6666-6666-666666666604','55555555-5555-5555-5555-555555555505',1),
  ('66666666-6666-6666-6666-666666666605','55555555-5555-5555-5555-555555555506',1);

-- Stops: L1 = 1 pickup + 2 drops (one per order); L4 = 1 pickup + 3 drops
insert into load_stops (load_id, sequence, stop_type, location_id, order_id) values
  ('66666666-6666-6666-6666-666666666601',1,'pickup',  '22222222-2222-2222-2222-222222222205',null),
  ('66666666-6666-6666-6666-666666666601',2,'delivery','22222222-2222-2222-2222-222222222202','55555555-5555-5555-5555-555555555501'),
  ('66666666-6666-6666-6666-666666666601',3,'delivery','22222222-2222-2222-2222-222222222203','55555555-5555-5555-5555-555555555502'),
  ('66666666-6666-6666-6666-666666666602',1,'pickup',  '22222222-2222-2222-2222-222222222205',null),
  ('66666666-6666-6666-6666-666666666602',2,'delivery','22222222-2222-2222-2222-222222222204','55555555-5555-5555-5555-555555555503'),
  ('66666666-6666-6666-6666-666666666603',1,'pickup',  '22222222-2222-2222-2222-222222222205',null),
  ('66666666-6666-6666-6666-666666666603',2,'delivery','22222222-2222-2222-2222-222222222202','55555555-5555-5555-5555-555555555504'),
  ('66666666-6666-6666-6666-666666666604',1,'pickup',  '22222222-2222-2222-2222-222222222201',null),
  ('66666666-6666-6666-6666-666666666604',2,'delivery','22222222-2222-2222-2222-222222222202','55555555-5555-5555-5555-555555555505'),
  ('66666666-6666-6666-6666-666666666604',3,'delivery','22222222-2222-2222-2222-222222222203','55555555-5555-5555-5555-555555555505'),
  ('66666666-6666-6666-6666-666666666604',4,'delivery','22222222-2222-2222-2222-222222222204','55555555-5555-5555-5555-555555555505'),
  ('66666666-6666-6666-6666-666666666605',1,'pickup',  '22222222-2222-2222-2222-222222222201',null),
  ('66666666-6666-6666-6666-666666666605',2,'delivery','22222222-2222-2222-2222-222222222204','55555555-5555-5555-5555-555555555506');

-- Documents.
-- NOTE: storage_path values here point at files that do NOT exist — SQL cannot
-- create PDFs. The app returns 404 for them, which is correct behaviour, but do
-- not use these rows to test document fetching. Upload a real file through
-- POST /api/document instead. (Cost me a wrong conclusion once.)
-- L4 gets a per-stop POD (customer signs per drop); L1 gets one
-- load-level POD. L5 deliberately has NO pod, to prove the missing-POD report.
insert into documents (doc_type, load_id, storage_path, original_filename, matched_by, matched_at) values
  ('rate_con','66666666-6666-6666-6666-666666666604','rc/tradewinds_884895.pdf','Tradewinds 884895.pdf','filename',now()),
  ('pod',     '66666666-6666-6666-6666-666666666601','pod/l1.pdf',             'BiMart_pod.pdf',       'manual',  now());

insert into documents (doc_type, load_stop_id, storage_path, original_filename, matched_by, matched_at)
select 'pod', id, 'pod/l4_stop'||sequence||'.pdf', 'stop'||sequence||'_pod.pdf', 'solomon_order_no', now()
from load_stops where load_id='66666666-6666-6666-6666-666666666604' and stop_type='delivery';

insert into documents (doc_type, storage_path, original_filename, matched_by) values
  ('invoice', 'unmatched/scan_20260803.pdf','scan_20260803.pdf','unmatched');

-- Invoices — the money of record
insert into invoices (load_id, order_id, customer_party_id, invoice_number, amount, issued_at) values
  ('66666666-6666-6666-6666-666666666604','55555555-5555-5555-5555-555555555505','11111111-1111-1111-1111-111111111101','100241',2450.00,'2026-03-06'),
  ('66666666-6666-6666-6666-666666666605','55555555-5555-5555-5555-555555555506','11111111-1111-1111-1111-111111111101','100388',1875.50,'2026-06-04'),
  ('66666666-6666-6666-6666-666666666601','55555555-5555-5555-5555-555555555501','11111111-1111-1111-1111-111111111103','100112', 610.00,'2026-02-19');

commit;

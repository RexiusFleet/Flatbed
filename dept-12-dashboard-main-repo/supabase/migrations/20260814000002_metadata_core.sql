-- D85: metadata-driven Database core (Phase 1 of the platform rebuild). Turns the
-- four hard-wired Database grids into metadata-described entities so an admin can
-- rename/reorder/resize/retype fields, add conditional formatting, and (later) add
-- whole new databases and rewire dispatch. Built-ins keep their real backing tables
-- (parties/locations/trucks/drivers) — fields carry storage='column:<table>.<field>'
-- pointing at the real column; custom fields will live in the record jsonb. Fields
-- have a STABLE id: the name/key is renamable without breaking any wiring.

create table if not exists entities (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  kind          text not null default 'custom' check (kind in ('builtin','custom')),
  backing_table text,                         -- parties/locations/trucks for builtins; null = generic
  slug          text unique,                  -- stable code handle for builtins (bagger/brokers/pickdrop/fleet)
  icon          text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

create table if not exists fields (
  id                 uuid primary key default gen_random_uuid(),   -- STABLE wiring anchor
  entity_id          uuid not null references entities(id) on delete cascade,
  key                text not null,                                 -- machine name (renamable)
  label              text not null,
  type               text not null default 'text'
                       check (type in ('text','number','date','select','checkbox','color','relation')),
  options            jsonb not null default '[]',
  storage            text not null default 'json',                  -- 'column:<table>.<field>' or 'json'
  ui                 text,                                          -- special cell renderer: designation/equipment/truckdriver/color
  bold               boolean not null default false,                -- render the cell bold (primary column)
  sort_order         integer not null default 0,
  width              integer,
  hidden             boolean not null default false,
  locked             boolean not null default false,                -- report-critical typed field: can't delete/retype
  conditional_format jsonb not null default '[]',                   -- [{op,value,color}] per-cell rules
  created_at         timestamptz not null default now(),
  unique (entity_id, key)
);
create index if not exists fields_entity_idx on fields (entity_id, sort_order);

-- Generic row store for future custom (non-builtin) entities. Built-ins do NOT use
-- this — their rows stay in the real tables.
create table if not exists records (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid not null references entities(id) on delete cascade,
  data       jsonb not null default '{}',                            -- keyed by field id
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists records_entity_idx on records (entity_id, sort_order);

-- Seed the four built-ins to mirror today's grids exactly (regression gate: the UI
-- must render identically before anything is edited).
insert into entities (name, kind, backing_table, slug, sort_order) values
  ('Bagger Customers',  'builtin', 'parties',   'bagger',   1),
  ('External Customers', 'builtin', 'parties',   'brokers',  2),
  ('Pick/Drop List',    'builtin', 'locations', 'pickdrop', 3),
  ('Fleet',             'builtin', 'trucks',    'fleet',    4)
on conflict (slug) do nothing;

insert into fields (entity_id, key, label, type, storage, ui, bold, sort_order, width)
select e.id, f.key, f.label, f.type, f.storage, f.ui, f.bold, f.sort_order, f.width
from entities e
join (values
  -- bagger (parties + its location)
  ('bagger','name','Customer','text','column:parties.name',null,true,1,190),
  ('bagger','address','Address','text','column:locations.address',null,false,2,180),
  ('bagger','city','City','text','column:locations.city',null,false,3,120),
  ('bagger','category_id','Designation','select','column:locations.category_id','designation',false,4,150),
  ('bagger','timing_window','Window','text','column:locations.timing_window',null,false,5,110),
  ('bagger','forklift','Fork','text','column:locations.forklift',null,false,6,100),
  ('bagger','notes','Notes','text','column:locations.notes',null,false,7,250),
  ('bagger','standard_miles','Miles','number','column:locations.standard_miles',null,false,8,80),
  ('bagger','phone','Phone','text','column:parties.phone',null,false,9,130),
  ('bagger','manager_name','Manager','text','column:parties.manager_name',null,false,10,120),
  -- brokers / external (parties)
  ('brokers','name','Broker / Customer','text','column:parties.name',null,true,1,240),
  ('brokers','rexius_customer_no','Rexius #','text','column:parties.rexius_customer_no',null,false,2,130),
  ('brokers','ap_email','AP Email','text','column:parties.ap_email',null,false,3,240),
  ('brokers','notes','Notes','text','column:parties.notes',null,false,4,240),
  -- pickdrop (locations)
  ('pickdrop','name','Company Name','text','column:locations.name',null,true,1,190),
  ('pickdrop','address','Address','text','column:locations.address',null,false,2,190),
  ('pickdrop','city','City','text','column:locations.city',null,false,3,130),
  ('pickdrop','state','State','text','column:locations.state',null,false,4,70),
  ('pickdrop','phone','Phone','text','column:locations.phone',null,false,5,130),
  ('pickdrop','appointment_note','Appointment / dock hours','text','column:locations.appointment_note',null,false,6,170),
  ('pickdrop','notes','Notes','text','column:locations.notes',null,false,7,250),
  -- fleet (trucks + assigned driver)
  ('fleet','number','Truck #','text','column:trucks.number',null,true,1,110),
  ('fleet','equipment_type','Type','text','column:trucks.equipment_type','equipment',false,2,140),
  ('fleet','driver_name','Driver','text','json','truckdriver',false,3,220),
  ('fleet','color','Color','color','column:drivers.color','color',false,4,74)
) as f(slug,key,label,type,storage,ui,bold,sort_order,width) on f.slug = e.slug
on conflict (entity_id, key) do nothing;

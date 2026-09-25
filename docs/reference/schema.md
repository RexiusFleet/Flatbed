# Schema — Phase 2

Migration: `supabase/migrations/20260804000001_initial_schema.sql`
Decisions behind it: [`decisions-archive.md`](decisions-archive.md) (D2–D18)

> **Status: verified.** Applied to PostgreSQL 17.10 locally, seeded, and
> exercised with 5 reporting queries and 12 negative tests — all passing. No
> hosted Supabase project involved, per the golden rule. See *Verification*.

---

## The shape

```
parties ──< locations ──< location_images
   │            │              │
   │            ├──< order_stops >────────────────────────── orders
   │            └──< load_stops >── loads >── load_orders >──┘
   │                                 │                         │
drivers ──< driver_truck_assignments │                         │
   │                    │            │                         │
   └── trucks ──────────┘            │                         │
              └──< freight_transfers │                         │
                                 documents ──< invoices ───────┘
```

Three ideas carry most of the design:

**An order is not a load.** An order is a thing the business sells and tracks
before anyone hauls it. A load is one truck run on one day. Internal work
combines several orders onto one truck; external work is normally one order per
truck, with one pickup and several drops. `load_orders` handles both without
special-casing either.

**A planned route is not its completed truck-run history.** `order_stops`
stores the pickup/drop itinerary while an external order is still staged.
Scheduling snapshots it into `load_stops`, where arrival/departure timestamps
and stop-specific PODs can describe what the truck actually ran. The normal
one-pick/one-drop UI is simply a two-stop itinerary; custom route controls are
only exposed when an order needs additional stops.

**The chip is rendered, never stored.** Chip text is derived from
`loads` + `load_stops` + `parties`. In the sheet the chip text *is* the data,
which is why `extractExternalKeyFromChip`
(`legacy/tms-appsscript/Code.js:871`) has to reverse-engineer it with three
fallback strategies. Storing rendered text and parsing it back is the specific
mistake this project exists to undo.

**Driver and truck are separate, joined over time.** The sheet's column headers
(`"Jordan 63/80 F"`) fuse them, and the *Swap Trucks* feature has nowhere to
record a change — so a load hauled in March silently reports today's truck.
`driver_truck_assignments` carries `effective_from`/`effective_to`, and
`v_loads_reporting` resolves the truck that was actually assigned on the day the
load ran. Two GiST exclusion constraints make overlapping assignments impossible.

## Identity

Three independent namespaces, none of them a primary key (D2):

| Column | Example | Origin |
|---|---|---|
| `orders.solomon_order_no` | `12-0426-0001` | Microsoft Solomon — **the future Acumatica join key** |
| `orders.broker_load_no` | `884895` | the broker's own number, off the rate con |
| `id` | uuid | ours |

`solomon_order_no` is unique when present but intentionally has no format check.
`order_number_settings` holds the current Bag/External templates and department
codes. `orders.department` is stored independently for reporting, and
`orders.order_period` controls Bag Order month/year grouping. Changing a template
affects only future numbers; it does not edit or reinterpret historical rows.

## Money — two separate paths

External loads bill one rate to a broker or customer, captured as
`invoices.amount` at invoice generation, which is what closes the load (D9).

Internal loads generate **both** a bag-plant freight charge
(`loads.internal_freight_amount`, typed in, never calculated) **and** an
end-customer invoice (D16). The `loads_internal_freight_only` constraint keeps
the bag-plant charge off external loads.

`v_freight_transfer_weekly` computes the pending weekly per-truck charge;
`freight_transfers` records what was actually posted, so a week can be reconciled
and not double-posted.

## Documents

The PDF is an attachment; extracted fields are columns and JSONB. Unmatched
documents are allowed to exist with every FK null so they queue for manual
attach — nothing auto-attaches on a weak guess.

`matched_by` records *how* a document was attached, so a bad auto-match is
auditable instead of invisible. Cascade order (D7), revised after testing showed
filename beating text extraction on a real scan:

1. `solomon_order_no` — exact, via `/\d{2}-\d{4}-\d{4}/`
2. `broker_load_no` + broker
3. **filename** — `matchBrokerForFile` (≥0.4) / `findBroker` (≥0.45)
4. document text / OCR
5. below threshold → unmatched queue, manual attach

PODs may attach to a stop or to a load, because whether a multi-drop load
produces one POD or one per drop varies by customer (D14).

## Administrative history

`audit_events` is the immutable user-action timeline; `audit_changes` stores
the exact row versions belonging to each event. Database triggers capture every
insert/update/delete on current primary-key tables. A single-event revert
appends an inverse mutation instead of erasing evidence, so reversals
themselves remain attributable and reversible. History is available only
through admin-checked server routes.

---

## Verification

Verified against PostgreSQL 17.10 (Homebrew) on 2026-08-04. No hosted project.

```bash
# start the server (installed, but not registered as a login service)
LC_ALL="en_US.UTF-8" /opt/homebrew/opt/postgresql@17/bin/pg_ctl \
  -D /opt/homebrew/var/postgresql@17 -l /tmp/pg.log start

# apply schema + synthetic seed
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
dropdb --if-exists dept12_check && createdb dept12_check
psql -v ON_ERROR_STOP=1 -d dept12_check -f supabase/migrations/20260804000001_initial_schema.sql
psql -v ON_ERROR_STOP=1 -d dept12_check -f supabase/seed.sql
```

**One thing broke on first apply**, and it was not on the predicted-risk list:
`create policy ... to authenticated` failed because `authenticated` is a
Supabase-provided role that does not exist in vanilla Postgres. Fixed with a
guarded `create role` block that is a no-op on Supabase, so the same migration
now applies to both. Everything else — including the `btree_gist` exclusion
constraints and the `extract(isodow ...)` CHECK — applied first time.

### Results

**The truck-swap test — the whole reason `driver_truck_assignments` exists.**
Wayne and Jon swap trucks on 2026-04-01. `v_loads_reporting` returns:

| driver | truck | date | correct? |
|---|---|---|---|
| Wayne | **31** | 2026-02-18 | ✓ his truck *then* |
| Wayne | **33** | 2026-05-12 | ✓ his truck *after the swap* |

The spreadsheet reports today's truck for both. This is the class of silent error
the schema exists to prevent.

All five reporting queries returned correct results, including the subtle one:
`v_loads_missing_pod` correctly excluded a load with **per-stop** PODs and a load
with a single **load-level** POD, proving the flexible POD model (D14) works in
both directions.

**12 negative tests, all blocked:** overlapping truck assignments, driver+carrier
on one load, truck without driver, bag-plant charge on an external load,
duplicate and malformed Solomon numbers, slot 4, two loads in one driver/date/slot,
a freight-transfer week that isn't a Monday, a party with no role, a "matched"
document pointing at nothing, and a negative invoice amount.

### The queries that justify the project

These are the success criterion. Each must be a single statement against the
schema, or the design has failed.

**1. Revenue by broker by quarter**
```sql
select b.name, date_trunc('quarter', i.issued_at) as quarter, sum(i.amount)
from invoices i
join loads l       on l.id = i.load_id
join load_orders lo on lo.load_id = l.id
join orders o      on o.id = lo.order_id
join parties b     on b.id = o.broker_party_id
group by b.name, quarter
order by quarter, sum(i.amount) desc;
```

**2. Loads per driver per month, using the HISTORICAL truck**
```sql
select driver_name, truck_number, date_trunc('month', scheduled_date) as month, count(*)
from v_loads_reporting
where driver_name is not null
group by driver_name, truck_number, month
order by month, driver_name;
```

**3. Average days from order to delivery, per customer**
```sql
select customer_name, round(avg(days_order_to_delivery), 1) as avg_days, count(*)
from v_orders_reporting
where days_order_to_delivery is not null
group by customer_name
order by avg_days desc;
```

**4. Loads missing a POD**
```sql
select * from v_loads_missing_pod order by scheduled_date;
```

**5. Weekly freight transfer to the bag plant, per truck**
```sql
select * from v_freight_transfer_weekly order by week_start desc, truck_number;
```

### Still outstanding

**The round-trip check.** Render chip text from these rows and diff it against
the chip text currently in the sheet; it should match character-for-character.
Not done — it needs real sheet data, so it belongs with the Phase 3 Sheets sync
work rather than here.

**RLS is enabled but permissive.** All 13 tables deny anon and allow any
authenticated user. That is correct for now (drivers never touch the database —
they stay on the mirror Sheet) but wants tightening once the app has more than
one class of user.

**No carrier-cost field**, so no margin math on brokered loads — a deliberate
omission per D15, not an oversight.

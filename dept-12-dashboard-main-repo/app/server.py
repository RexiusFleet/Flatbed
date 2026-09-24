#!/usr/bin/env python3
"""
Dept 12 Dashboard — local application server.

Serves the UI and exposes a JSON API over Postgres.

Everything that is NOT Postgres goes through app/adapters.py — document storage
and mail. The target is Supabase plus a hosted web app, so no local assumption
may leak into the core. Set DEPT12_STORAGE / DEPT12_MAIL to swap implementations.

Deliberately dependency-light: stdlib plus psycopg. No framework, no build step,
no bundler. It has to start with one command on an office Windows machine.

    python3 app/server.py

Postgres must be running and migrated. See README.md.
"""

import base64
import datetime
import json
import mimetypes
import os
import re
import secrets
import sys
import time
import uuid
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote, quote

try:
    import psycopg
    from psycopg import sql
    from psycopg.rows import dict_row
    from psycopg.types.json import Jsonb
except ImportError:
    sys.exit("psycopg missing.  pip install 'psycopg[binary]'")

def _load_dotenv():
    """Hand-rolled .env loader (D24: dependency-free, no python-dotenv) — so
    `python3 app/server.py` alone picks up local config (Sheets creds, local
    auth) instead of requiring every launch to export/source it by hand.
    KEY=VALUE per line, blank/'#' lines skipped; a real shell-exported env
    var always wins over the file, same precedence python-dotenv uses."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
    if not os.path.isfile(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            if k and k not in os.environ:
                os.environ[k] = v.strip()


_load_dotenv()

# Loopback remains the safe local default. A hosted container sets DEPT12_HOST
# explicitly (normally 0.0.0.0) and relies on its HTTPS ingress/auth boundary.
HOST = os.environ.get("DEPT12_HOST", "127.0.0.1")
PORT = int(os.environ.get("DEPT12_PORT", "8770"))
DSN = os.environ.get("DEPT12_DSN", "dbname=dept12 host=/tmp")
TIMEZONE = os.environ.get("DEPT12_TIMEZONE", "America/Los_Angeles")

BASE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(BASE, "web")
STORAGE = os.environ.get("DEPT12_STORAGE_ROOT", os.path.join(BASE, "storage"))
os.makedirs(STORAGE, exist_ok=True)

from adapters import GraphDraft, make_auth, make_storage, make_mail, make_sheets, make_motive

STORE = make_storage(STORAGE)
AUTH = make_auth()
MAIL = make_mail()
SHEETS = make_sheets()
MOTIVE = make_motive()
OUTLOOK_GRAPH_ENABLED = bool(AUTH.enabled and
    os.environ.get("DEPT12_OUTLOOK_ENABLED", "false").lower() in ("1", "true", "yes", "on"))
AUTH_STORAGE_KEY = os.environ.get("DEPT12_AUTH_STORAGE_KEY", "dept12-auth")

# ── Local test-login + permissions (D125) ─────────────────────────────────────
# Independent of the dormant Supabase/Entra scaffold above — no external
# service setup needed. Off by default like every other integration flag here.
LOCAL_AUTH_ENABLED = os.environ.get("DEPT12_LOCAL_AUTH_ENABLED", "false").lower() in ("1", "true", "yes", "on")
LOCAL_SESSION_COOKIE = "dept12_local_session"
_local_sessions = {}          # token -> user_id
_local_sessions_lock = threading.Lock()
# Reachable with no session yet (login itself) or best-effort even with a
# stale one (logout, the "am I signed in" probe the client polls at boot).
LOCAL_AUTH_EXEMPT_PATHS = {"/api/local-login", "/api/local-logout", "/api/local-session"}


def browser_auth_config():
    """Public browser configuration only — never emit service-role credentials."""
    return {
        "enabled": AUTH.enabled,
        "supabaseUrl": AUTH.url if AUTH.enabled else "",
        "publishableKey": AUTH.publishable_key if AUTH.enabled else "",
        "loginUrl": os.environ.get("DEPT12_LOGIN_URL", "http://localhost:8780/"),
        "storageKey": AUTH_STORAGE_KEY,
        "cookieDomain": os.environ.get("DEPT12_AUTH_COOKIE_DOMAIN", ""),
        "sdkUrl": os.environ.get("DEPT12_SUPABASE_SDK_URL",
                                "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"),
        "outlookEnabled": bool(AUTH.enabled and OUTLOOK_GRAPH_ENABLED),
        "outlookScopes": "email offline_access Mail.ReadWrite",
    }

# ── Database ─────────────────────────────────────────────────────────────────
# One psycopg connection per thread — the server is now threaded
# (ThreadingHTTPServer), and a psycopg connection is not safe to share across
# threads. Thread-local connections keep each request independent, so a slow
# request (e.g. a live Sheets call) no longer blocks every other click with a
# "failed to fetch".
_local = threading.local()


def db():
    conn = getattr(_local, "conn", None)
    if conn is None or conn.closed:
        conn = psycopg.connect(DSN, row_factory=dict_row, autocommit=True)
        conn.execute("select set_config('TimeZone', %s, false)", (TIMEZONE,))
        _local.conn = conn
    return conn


def q(sql, params=None, one=False):
    with db().cursor() as cur:
        cur.execute(sql, params or ())
        if cur.description is None:
            return None
        rows = cur.fetchall()
        return (rows[0] if rows else None) if one else rows


def current_local_user():
    """The local-auth identity for the current request thread, or None (local
    auth disabled, or the request is exempt/unauthenticated). Thread-local so
    deep handler functions can read it without threading a parameter through
    every one of the ~54 route handlers — same idiom as db()'s connection."""
    return getattr(_local, "local_user", None)


def _local_session_user(token):
    if not token:
        return None
    with _local_sessions_lock:
        user_id = _local_sessions.get(token)
    if not user_id:
        return None
    row = q("select * from app_users where id=%s", (user_id,), one=True)
    if not row:
        return None
    row["grants"] = q(
        "select section, sub, can_edit from app_user_grants where user_id=%s", (row["id"],))
    return row


def jsonable(v):
    """Postgres types the JSON encoder does not know about."""
    import datetime
    import decimal
    if isinstance(v, (datetime.date, datetime.datetime)):
        return v.isoformat()
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, uuid.UUID):
        return str(v)
    raise TypeError(f"not serialisable: {type(v)}")


# ── API ──────────────────────────────────────────────────────────────────────
def api_bootstrap():
    """Everything the UI needs to render. One round trip on load."""
    return {
        "drivers": q("""
            select d.id, d.full_name, d.active, d.color,
                   t.number as truck, t.equipment_type as eq
            from drivers d
            left join lateral (
              select tr.number, tr.equipment_type
              from driver_truck_assignments a
              join trucks tr on tr.id = a.truck_id
              where a.driver_id = d.id and a.effective_to is null
              limit 1
            ) t on true
            where d.active
            order by d.created_at
        """),
        # The Scheduler's actual columns (D32) — driver is the current occupant,
        # not the identity of the column. Mirror image of the drivers query above.
        "trucks": q("""
            select t.id, t.number, t.equipment_type as eq, t.active, t.custom,
                   dr.id as driver_id, dr.full_name as driver_name, dr.color as driver_color
            from trucks t
            left join lateral (
              select d.id, d.full_name, d.color
              from driver_truck_assignments a
              join drivers d on d.id = a.driver_id
              where a.truck_id = t.id and a.effective_to is null
              limit 1
            ) dr on true
            where t.active
            order by t.sort_order, t.number
        """),
        "parties": q("""select id, name, is_customer, is_broker, is_carrier,
                               rexius_customer_no, ap_email, phone, manager_name, notes,
                               customer_archived_at, broker_archived_at, custom
                        from parties order by sort_order, name"""),
        "locations": q("""select id, party_id, name, address, city, state, phone, email,
                                 appointment_note, map_url, forklift,
                                 timing_window, is_umatilla, standard_miles,
                                 miles_from_umatilla, notes, category_id, custom
                          from locations order by name"""),
        "grid_columns": q("select * from grid_columns order by grid, sort_order, created_at"),
        # Metadata core (D85) — entities/fields drive the Database grids; records
        # holds rows for future custom (non-builtin) entities.
        "entities": q("select * from entities order by sort_order, created_at"),
        "fields": q("select * from fields order by entity_id, sort_order, created_at"),
        "records": q("select * from records order by entity_id, sort_order, created_at"),
        "order_stops": q("select * from order_stops order by order_id, sequence"),
        "load_stops": q("select * from load_stops order by load_id, sequence"),
        # Saved default row order is per Database grid. This is intentionally
        # separate from the source tables: Bagger and External Customers can
        # contain the same party without one grid's reorder disturbing the other.
        "grid_row_orders": q("select grid, row_id, sort_order from grid_row_orders order by grid, sort_order"),
        "departments": q("select id, name, sort_order, color, archived_at from departments order by sort_order, name"),
        "internal_freight_rate": q("""select rate_per_mile, minimum_charge from internal_freight_rate
                                       order by updated_at desc limit 1""", one=True),
        "order_number_settings": q("""select internal_pattern, internal_department,
                                              external_pattern, external_department
                                       from order_number_settings where id=1""", one=True),
        "orders": q("""
            select o.*, c.name as customer_name, b.name as broker_name,
                   td.name as transfer_department_name, t.number as truck_number,
                   (select count(*) from documents dd where dd.order_id = o.id) as doc_count
            from orders o
            left join parties c on c.id = o.customer_party_id
            left join parties b on b.id = o.broker_party_id
            left join departments td on td.id = o.transfer_department_id
            left join trucks t on t.id = o.truck_id
            order by o.created_at desc
        """),
        # Aggregate the order ids — joining load_orders directly would emit one
        # row per order, duplicating every internal multi-order load.
        "loads": q("""
            select l.*, cat.color as cat_color, cat.name as cat_name,
                   coalesce(array_agg(lo.order_id) filter (where lo.order_id is not null),
                            '{}') as order_ids
            from loads l
            left join load_orders lo on lo.load_id = l.id
            left join categories cat on cat.id = l.category_id
            group by l.id, cat.color, cat.name
        """),
        "notes": q("""select n.*, cat.color as cat_color
                       from schedule_notes n
                       left join categories cat on cat.id = n.category_id"""),
        # Scheduler cell categories (D65) — spreadsheet-style color labels, and
        # the truck-off markers the 2025 backfill and the board coloring both use.
        "categories": q("select id, name, color, sort, is_off from categories order by sort"),
        "truck_off_days": q("select truck_id, off_date, note, category_id from truck_off_days"),
        "documents": q("""select id, order_id, load_id, load_stop_id, doc_type, original_filename,
                                 storage_path, matched_by, extracted_fields, uploaded_at
                          from documents order by uploaded_at desc"""),
        "invoices": q("select * from invoices order by issued_at desc"),
        # Custom spreadsheet sheets in the Database section (D74).
        "sheets": q("select id, name, n_rows, n_cols, sort from sheets order by sort, created_at"),
        "sheet_cells": q("select sheet_id, r, c, value, fmt from sheet_cells"),
        # Per-cell formatting on the built-in Database grids (D76).
        "grid_cell_fmt": q("select table_name, row_id, field, fmt from grid_cell_fmt"),
        # Day notes (D230) — dispatcher-only annotations pinned to a calendar
        # date, never pushed to drivers/Sheets.
        "day_notes": q("select id, note_date, text from day_notes order by note_date"),
    }


def api_create_order(d):
    """A dropped rate con lands here. solomon_order_no is intentionally optional —
    the order exists first and gets its number when Nate builds it in Solomon."""
    broker_id = None
    if d.get("broker_name"):
        row = q("select id from parties where lower(name)=lower(%s)",
                (d["broker_name"],), one=True)
        if row:
            broker_id = row["id"]
        else:
            broker_id = q("""insert into parties (name, is_broker) values (%s, true)
                             returning id""", (d["broker_name"],), one=True)["id"]
    row = q("""
        insert into orders (kind, solomon_order_no, broker_load_no, broker_party_id,
                            po_number, delivery_number, ordered_at, notes)
        values (%s,%s,%s,%s,%s,%s, coalesce(%s, current_date), %s)
        returning *
    """, (d.get("kind", "external"), d.get("solomon_order_no") or None,
          d.get("broker_load_no") or None, broker_id, d.get("po_number"),
          d.get("delivery_number"), d.get("ordered_at") or None, d.get("notes")),
        one=True)
    if row["kind"] == "external":
        _sync_simple_order_stops(row["id"])
    return row


def _match_order(solomon=None, broker_load_no=None, filename=None):
    """D7 document→order matching cascade, deterministic-ID only: exact Solomon
    order # → exact broker load # → a number pulled from the filename (Solomon-
    shaped first, then any 5–9 digit run matched as a broker load #). Returns
    (order_id, how) or (None, None). Fuzzy text/OCR is already resolved to these
    fields upstream (parseRateCon) — this never guesses."""
    if solomon:
        r = q("select id from orders where solomon_order_no = %s", (solomon,), one=True)
        if r:
            return r["id"], "solomon"
    if broker_load_no:
        r = q("select id from orders where broker_load_no = %s", (broker_load_no,), one=True)
        if r:
            return r["id"], "broker_load_no"
    if filename:
        sm = re.search(r"\d{2}-\d{4}-\d{4}", filename)
        if sm:
            r = q("select id from orders where solomon_order_no = %s", (sm.group(0),), one=True)
            if r:
                return r["id"], "filename"
        for num in re.findall(r"\d{5,9}", filename):
            r = q("select id from orders where broker_load_no = %s", (num,), one=True)
            if r:
                return r["id"], "filename"
    return None, None


def api_ingest_order(d):
    """Rate-con landing point with D7 matching (Phase 4). Tries to match an
    existing order first — so a Dept 12 order Nate keyed in by hand, then the
    broker's rate con arriving after, attaches to the same order instead of
    creating a duplicate. Only creates a new order when nothing matches.
    Returns the order with `_match` = how it matched ('solomon' /
    'broker_load_no' / 'filename' / 'created')."""
    oid, how = _match_order(d.get("solomon_order_no"), d.get("broker_load_no"),
                            d.get("filename"))
    if oid:
        row = q("select * from orders where id=%s", (oid,), one=True)
        row["_match"] = how
        return row
    row = api_create_order(d)
    row["_match"] = "created"
    return row


ORDER_SEQUENCE_TOKEN = re.compile(r"\{(#+)\}")
ORDER_DATE_TOKENS = {"{MM}", "{YY}", "{YYYY}"}


def validate_order_pattern(value, require_sequence=True):
    """Validate a compact, user-facing order-number template."""
    pattern = str(value or "").strip()
    if not pattern or len(pattern) > 64:
        raise ValueError("Use a format between 1 and 64 characters.")
    matches = list(ORDER_SEQUENCE_TOKEN.finditer(pattern))
    if require_sequence and len(matches) != 1:
        raise ValueError("Include one number block such as {####} (1–8 digits).")
    if len(matches) > 1 or (matches and not (1 <= len(matches[0].group(1)) <= 8)):
        raise ValueError("Use no more than one number block, with 1–8 digits.")
    remaining = ORDER_SEQUENCE_TOKEN.sub("", pattern)
    for token in ORDER_DATE_TOKENS:
        remaining = remaining.replace(token, "")
    if "{" in remaining or "}" in remaining:
        raise ValueError("Available date fields are {MM}, {YY}, and {YYYY}.")
    return pattern


def format_order_number(pattern, period, sequence):
    pattern = validate_order_pattern(pattern)
    rendered = (pattern.replace("{MM}", period.strftime("%m"))
                       .replace("{YY}", period.strftime("%y"))
                       .replace("{YYYY}", period.strftime("%Y")))
    return ORDER_SEQUENCE_TOKEN.sub(
        lambda m: str(int(sequence)).zfill(len(m.group(1))), rendered)


def _number_regex_for_period(pattern, period):
    rendered = (validate_order_pattern(pattern)
                .replace("{MM}", period.strftime("%m"))
                .replace("{YY}", period.strftime("%y"))
                .replace("{YYYY}", period.strftime("%Y")))
    match = ORDER_SEQUENCE_TOKEN.search(rendered)
    return re.compile("^" + re.escape(rendered[:match.start()]) + r"(\d+)" +
                      re.escape(rendered[match.end():]) + "$", re.IGNORECASE)


def api_order_number_settings_save(d):
    internal = validate_order_pattern(d.get("internal_pattern"))
    external = validate_order_pattern(d.get("external_pattern"), require_sequence=False)
    internal_dept = str(d.get("internal_department") or "").strip()
    external_dept = str(d.get("external_department") or "").strip()
    if not internal_dept or not external_dept:
        raise ValueError("Both department codes are required.")
    if len(internal_dept) > 20 or len(external_dept) > 20:
        raise ValueError("Department codes must be 20 characters or fewer.")
    return q("""update order_number_settings
                set internal_pattern=%s, internal_department=%s,
                    external_pattern=%s, external_department=%s
                where id=1 returning internal_pattern, internal_department,
                                     external_pattern, external_department""",
             (internal, internal_dept, external, external_dept), one=True)


def api_add_internal_order(d):
    """Reserve one or a bulk block of Bag Order numbers using the current
    workspace pattern. `order_period` owns month/year placement, so changing a
    pattern never rewrites or reclassifies historical order numbers."""
    n = int(d.get("count") or 1)
    n = max(1, min(n, 500))
    month = str(d.get("month") or "")
    if not re.fullmatch(r"(0[1-9]|1[0-2])\d{4}", month):
        raise ValueError("Choose a valid month and four-digit year.")
    period = datetime.date(int(month[2:]), int(month[:2]), 1)
    created = []
    # The lock makes two simultaneous bulk reservations choose distinct ranges.
    with db().transaction():
        q("select pg_advisory_xact_lock(hashtext('dept12:bag-order-number'))")
        cfg = q("""select internal_pattern, internal_department
                   from order_number_settings where id=1""", one=True)
        pattern = validate_order_pattern(cfg["internal_pattern"])
        if d.get("start") not in (None, ""):
            start = int(d["start"])
        else:
            number_re = _number_regex_for_period(pattern, period)
            start = 1
            for row in q("""select solomon_order_no from orders
                            where kind='internal' and solomon_order_no is not null"""):
                found = number_re.match(row["solomon_order_no"])
                if found:
                    start = max(start, int(found.group(1)) + 1)
        if start < 1:
            raise ValueError("Starting number must be at least 1.")
        for i in range(n):
            number = format_order_number(pattern, period, start + i)
            created.append(q("""insert into orders
                (kind, solomon_order_no, order_period, department)
                values ('internal', %s, %s, %s) returning *""",
                (number, period, cfg["internal_department"]), one=True))
    return {"created": len(created), "first": created[0]["solomon_order_no"],
            "last": created[-1]["solomon_order_no"], "start": start,
            "orders": created}


def api_copy_order(d):
    """External Orders 'Copy' (D30): same pick/drop, broker sent a new rate.
    Everything carries over except the two numbers that must be unique per
    load — solomon_order_no and broker_load_no start blank on the copy.

    Internal Freight transfers (D127 follow-up) reuse this same button/route
    but need a much thinner copy — there's no customer/broker/route/PO to
    carry over, just the route identity (department + note). Miles and the
    transfer $ are left blank to refill, same idea as leaving solomon/
    broker_load_no blank on an external copy: per-instance, not route
    identity."""
    src = q("select * from orders where id=%s", (d["order_id"],), one=True)
    if not src:
        raise ValueError("Order not found")
    if src["is_transfer"]:
        return q("""insert into orders (kind, is_transfer, transfer_department_id, notes, stage)
                    values ('external', true, %s, %s, 'ordered') returning *""",
                 (src["transfer_department_id"], src["notes"]), one=True)
    with db().transaction():
        copied = q("""
            insert into orders (kind, broker_party_id, customer_party_id, po_number,
                                delivery_number, pallet_count, notes, pickup_location_id,
                                delivery_location_id, route_mode)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            returning *
        """, (src["kind"], src["broker_party_id"], src["customer_party_id"],
              src["po_number"], src["delivery_number"], src["pallet_count"], src["notes"],
              src.get("pickup_location_id"), src.get("delivery_location_id"), src.get("route_mode", "simple")),
            one=True)
        q("""insert into order_stops (order_id, sequence, stop_type, location_id,
                                         reference_number, scheduled_at, appointment_required,
                                         pallet_count, notes)
             select %s, sequence, stop_type, location_id, reference_number, scheduled_at,
                    appointment_required, pallet_count, notes
             from order_stops where order_id=%s order by sequence""",
          (copied["id"], src["id"]))
        if src["kind"] == "external" and not q(
                "select 1 from order_stops where order_id=%s", (copied["id"],), one=True):
            _sync_simple_order_stops(copied["id"])
        return copied


def api_bill_order(d):
    """Mark an external order billed (leaves the biller queue) or reopen it.
    `billed=false` clears it back into the queue (D62)."""
    if d.get("billed", True):
        return q("update orders set billed_at = now() where id = %s returning id, billed_at",
                 (d["id"],), one=True)
    return q("update orders set billed_at = null where id = %s returning id, billed_at",
             (d["id"],), one=True)


def api_update_order(oid, d):
    allowed = {"solomon_order_no", "broker_load_no", "po_number", "delivery_number",
               "pallet_count", "stage", "ordered_at", "released_at",
               "requested_delivery_date", "delivered_at", "notes", "driver_note",
               "customer_party_id", "broker_party_id", "pickup_location_id",
               "delivery_location_id", "tarp", "transfer_department_id"}
    sets, vals = [], []
    for k, v in d.items():
        if k in allowed:
            sets.append(f"{k} = %s")
            vals.append(v if v != "" else None)
    if not sets:
        return q("select * from orders where id=%s", (oid,), one=True)
    vals.append(oid)
    with db().transaction():
        row = q(f"update orders set {', '.join(sets)} where id=%s returning *", vals, one=True)
        if row and "solomon_order_no" in d and row.get("solomon_order_no") and not row.get("department"):
            cfg = q("""select internal_department, external_department
                       from order_number_settings where id=1""", one=True)
            department = cfg["internal_department"] if row["kind"] == "internal" else cfg["external_department"]
            row = q("update orders set department=%s where id=%s returning *",
                    (department, oid), one=True)
        if row and row["kind"] == "external" and not row.get("is_transfer") \
                and row.get("route_mode", "simple") == "simple" and any(
                k in d for k in ("pickup_location_id", "delivery_location_id", "po_number", "delivery_number")):
            _sync_simple_order_stops(oid)
            load = _load_for_order(oid)
            if load and not _is_invoiced(load["id"]):
                _sync_load_stops(load["id"], oid)
        return row


def api_add_transfer_order(d):
    """A blank placeholder row for the Internal Freight tracker — a dept-to-
    dept mileage/$ transfer with no customer (e.g. 'Bag Plant to Umatilla
    Yard'). Never gets a Solomon number (never invoiced, D127) — created
    blank and filled in from its drawer, same "+ New Order" pattern as
    External Orders. kind stays 'external' (see the migration's header
    comment for why) with is_transfer=true marking it.

    `count` (default 1, D158) bulk-creates that many blank rows in one call —
    the tracker's top "+ Add order" button asks how many; the bottom
    "+ Add one" quick-add still sends no count and gets today's single-row
    shape back (`orders[0]`)."""
    n = int(d.get("count") or 1)
    n = max(1, min(n, 500))
    created = [q("""insert into orders (kind, is_transfer, stage) values ('external', true, 'ordered')
                    returning *""", one=True) for _ in range(n)]
    return {"created": len(created), "orders": created}


def _sync_simple_order_stops(order_id):
    """Make the invisible two-stop itinerary match the familiar inline fields."""
    order_row = q("""select id, kind, route_mode, is_transfer, pickup_location_id, delivery_location_id,
                            po_number, delivery_number
                     from orders where id=%s""", (order_id,), one=True)
    if not order_row or order_row["kind"] != "external" or order_row["is_transfer"] \
            or order_row["route_mode"] != "simple":
        return
    for sequence, stop_type, location_id, reference in (
            (1, "pickup", order_row["pickup_location_id"], order_row["po_number"]),
            (2, "delivery", order_row["delivery_location_id"], order_row["delivery_number"])):
        q("""insert into order_stops
                 (order_id, sequence, stop_type, location_id, reference_number)
             values (%s,%s,%s,%s,%s)
             on conflict (order_id, sequence) do update set
                 stop_type=excluded.stop_type, location_id=excluded.location_id,
                 reference_number=excluded.reference_number""",
          (order_id, sequence, stop_type, location_id, reference))
    q("delete from order_stops where order_id=%s and sequence > 2", (order_id,))


def _sync_load_stops(load_id, order_id):
    """Snapshot an external order itinerary onto its scheduled truck run."""
    if q("""select 1 from documents d join load_stops s on s.id=d.load_stop_id
            where s.load_id=%s limit 1""", (load_id,), one=True):
        raise ValueError("This scheduled route has stop-specific paperwork and can no longer be replaced.")
    q("delete from load_stops where load_id=%s", (load_id,))
    q("""insert into load_stops
             (load_id, sequence, stop_type, location_id, order_id, order_stop_id,
              scheduled_at, appointment_required, notes)
         select %s, sequence, stop_type, location_id, order_id, id,
                scheduled_at, appointment_required, notes
         from order_stops where order_id=%s order by sequence""", (load_id, order_id))


def api_order_route_save(d):
    """Save the deliberately opened advanced route editor for an external order."""
    order_id, stops = d["order_id"], d.get("stops") or []
    if not isinstance(stops, list) or len(stops) < 2 or len(stops) > 20:
        raise ValueError("A route needs 2–20 stops.")
    kinds = [s.get("stop_type") for s in stops]
    if any(k not in ("pickup", "delivery") for k in kinds):
        raise ValueError("Every stop must be a pickup or delivery.")
    if "pickup" not in kinds or "delivery" not in kinds:
        raise ValueError("A route needs at least one pickup and one delivery.")
    row = q("""select id, kind, delivered_at, billed_at from orders where id=%s""",
            (order_id,), one=True)
    if not row or row["kind"] != "external":
        raise ValueError("External order not found.")
    if row["delivered_at"] or row["billed_at"]:
        raise ValueError("Delivered or billed routes are locked to protect history.")
    load = _load_for_order(order_id)
    if load and _is_invoiced(load["id"]):
        raise ValueError("This route is invoiced and locked.")

    prepared = []
    for i, stop in enumerate(stops):
        location_id = stop.get("location_id") or None
        if location_id:
            try:
                location_id = uuid.UUID(str(location_id))
            except (ValueError, TypeError):
                raise ValueError(f"Stop {i + 1} has an invalid location.")
        pallets = stop.get("pallet_count")
        pallets = int(pallets) if pallets not in (None, "") else None
        if pallets is not None and pallets < 0:
            raise ValueError("Pallet counts cannot be negative.")
        prepared.append((order_id, i + 1, stop["stop_type"], location_id,
                         stop.get("reference_number") or None,
                         stop.get("scheduled_at") or None,
                         bool(stop.get("appointment_required")), pallets,
                         stop.get("notes") or None))

    requested_mode = d.get("route_mode", "custom")
    if requested_mode not in ("simple", "custom"):
        raise ValueError("invalid route mode")
    if requested_mode == "simple" and (len(prepared) != 2 or kinds != ["pickup", "delivery"]):
        raise ValueError("Simple mode requires exactly one pickup followed by one delivery.")
    first_pick = next(s for s in prepared if s[2] == "pickup")
    last_drop = next(s for s in reversed(prepared) if s[2] == "delivery")
    with db().transaction():
        q("delete from order_stops where order_id=%s", (order_id,))
        with db().cursor() as cur:
            cur.executemany("""insert into order_stops
                (order_id, sequence, stop_type, location_id, reference_number,
                 scheduled_at, appointment_required, pallet_count, notes)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s)""", prepared)
        updated = q("""update orders set route_mode=%s, pickup_location_id=%s,
                           delivery_location_id=%s, po_number=%s, delivery_number=%s
                       where id=%s returning *""",
                    (requested_mode, first_pick[3], last_drop[3], first_pick[4], last_drop[4], order_id), one=True)
        if load:
            _sync_load_stops(load["id"], order_id)
        return updated


def _order_mutation_guard(oid, action):
    """Protect delivered/billed history from cancel/delete mutations."""
    row = q("""
        select o.id, o.delivered_at, o.billed_at,
               exists (
                 select 1 from invoices i
                 where i.order_id = o.id
                    or i.load_id in (select lo.load_id from load_orders lo where lo.order_id = o.id)
               ) as invoiced
        from orders o where o.id = %s
    """, (oid,), one=True)
    if not row:
        raise ValueError("Order not found.")
    if row["invoiced"] or row["billed_at"]:
        raise ValueError(f"This order is billed/invoiced and locked — it can't be {action}.")
    if row["delivered_at"]:
        raise ValueError(f"This order is delivered and locked — it can't be {action}.")
    return row


def _detach_order_from_schedule(oid):
    """Remove one order from its load without destroying shared-load history.

    A now-empty load is retained as an unscheduled cancelled shell when it owns
    documents; otherwise it is deleted. This avoids the old unschedule trap
    where deleting a load could cascade-delete load-attached paperwork.
    """
    load_ids = [r["load_id"] for r in q(
        "delete from load_orders where order_id=%s returning load_id", (oid,))]
    for load_id in load_ids:
        if q("select 1 from load_orders where load_id=%s", (load_id,), one=True):
            continue
        has_docs = q("select 1 from documents where load_id=%s", (load_id,), one=True)
        if has_docs:
            q("""update loads set status='cancelled', scheduled_date=null,
                     driver_id=null, truck_id=null, carrier_party_id=null,
                     is_carrier=false, slot=null
                   where id=%s""", (load_id,))
        else:
            q("delete from loads where id=%s", (load_id,))


def api_cancel_order(d):
    """Cancel/restore an order from either tracker (D93)."""
    oid, cancelled = d["id"], d.get("cancelled", True)
    if not cancelled:
        return q("update orders set stage='ordered' where id=%s returning *", (oid,), one=True)
    with db().transaction():
        _order_mutation_guard(oid, "cancelled")
        _detach_order_from_schedule(oid)
        return q("update orders set stage='cancelled' where id=%s returning *", (oid,), one=True)


def api_delete_order(d):
    """Permanently delete an unlocked order after the client confirms (D93)."""
    oid = d["id"]
    paths = []
    with db().transaction():
        _order_mutation_guard(oid, "deleted")
        paths = [r["storage_path"] for r in q(
            "select storage_path from documents where order_id=%s", (oid,))]
        _detach_order_from_schedule(oid)
        deleted = q("delete from orders where id=%s returning id", (oid,), one=True)
    for path in paths:
        STORE.delete(path)
    return deleted


def _time_window_parts(category_id):
    """Derive legacy timing flags from the one user-facing Time Window choice."""
    if not category_id:
        return None, False
    cat = q("select name from categories where id=%s", (category_id,), one=True)
    if not cat:
        raise ValueError("Time Window option not found")
    name = (cat["name"] or "").lower()
    timing = "early" if "early" in name else "anytime" if "anytime" in name else None
    return timing, "umatilla" in name


def api_add_customer(d):
    """Create a customer from the Add-customer popup (D46). kind='external'
    makes a broker party (is_broker only — the External Customers/Orders
    population, D104); kind='bagger' makes an internal customer party
    (is_customer only) AND its location row (address + the delivery-window
    dropdown and free-typed forklift note, D142), so the Bagger Customers
    grid and load-chip annotations have what they need. The two lists are
    separate Solomon accounts and must not intermingle in either direction."""
    name = (d.get("name") or "").strip()
    if not name:
        raise ValueError("Name is required")
    external = d.get("kind") == "external"
    sort_pop = "is_broker" if external else "is_customer"
    party = q(f"""insert into parties (name, is_customer, is_broker, rexius_customer_no,
                     ap_email, phone, manager_name, notes, sort_order)
                 values (%s, %s, %s, %s, %s, %s, %s, %s,
                     (select coalesce(max(sort_order), 0) + 1 from parties where {sort_pop}))
                 returning *""",
              (name, not external, external, d.get("rexius_customer_no") or None, d.get("ap_email") or None,
               d.get("phone") or None, d.get("manager_name") or None, d.get("notes") or None),
              one=True)
    if not external:
        timing_window, is_umatilla = _time_window_parts(d.get("category_id"))
        q("""insert into locations (party_id, name, address, city, state, phone, forklift,
                 timing_window, is_umatilla, category_id, standard_miles,
                 miles_from_umatilla, notes)
             values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
          (party["id"], name, d.get("address") or None, d.get("city") or None,
           d.get("state") or None, d.get("phone") or None, d.get("forklift") or None,
           timing_window, is_umatilla, d.get("category_id") or None,
           d.get("standard_miles") or None, d.get("miles_from_umatilla") or None,
           d.get("notes") or None))
    return party


def api_add_location(d):
    """A bare Pick/Drop List entry (D33) — no party_id required, since this is
    the shared address book for external pickup/delivery selection, not tied
    to a specific Bagger customer or broker."""
    return q("""insert into locations (name, address, city, state, phone, appointment_note, notes)
                values (%s,%s,%s,%s,%s,%s,%s) returning *""",
             (d["name"], d.get("address"), d.get("city"), d.get("state"),
              d.get("phone"), d.get("appointment_note"), d.get("notes")), one=True)


def api_add_department(d):
    """Add-department popup (D127 follow-up) — a fill-out window like every
    other Database "+ Add" button, matching Bagger/Location/Truck instead of
    the bare inline blank row a generic custom-entity '+ Row' leaves."""
    return q("insert into departments (name) values (%s) returning *", (d["name"],), one=True)


def api_save_document(d):
    """Store the file on disk, record the row. Documents hang off the order id so
    they follow it everywhere in the app.

    When no order_id is supplied (a loose POD/invoice drop, not the rate-con
    path that creates its own order), run the D7 matcher on the extracted
    fields + filename. A confident ID match attaches it; otherwise it lands in
    the unmatched queue for a manual attach (Phase 4)."""
    raw = base64.b64decode(d["b64"])
    doc_id = str(uuid.uuid4())
    order_id = d.get("order_id") or None
    matched_by = d.get("matched_by")
    if not order_id:
        ef = d.get("extracted_fields") or {}
        order_id, how = _match_order(ef.get("solomon") or ef.get("solomon_order_no"),
                                     ef.get("load_no") or ef.get("broker_load_no"),
                                     d.get("filename"))
        if order_id:
            matched_by = how
    if order_id:
        order_id = str(order_id)   # matcher returns a UUID; the path join needs a str
    if not matched_by:
        matched_by = "manual" if order_id else "unmatched"
    safe = os.path.basename(d.get("filename") or "document.pdf")
    rel = STORE.save(order_id or "unmatched", f"{doc_id}_{safe}", raw)
    return q("""
        insert into documents (id, order_id, doc_type, storage_path, original_filename,
                               extracted_fields, matched_by, matched_at)
        values (%s,%s,%s,%s,%s,%s,%s, case when %s then now() else null end)
        returning id, order_id, doc_type, original_filename, storage_path, matched_by, extracted_fields
    """, (doc_id, order_id, d.get("doc_type", "other"), rel, safe,
          json.dumps(d.get("extracted_fields") or {}), matched_by,
          bool(order_id)), one=True)


def api_attach_document(doc_id, order_id):
    row = q("select storage_path, original_filename from documents where id=%s",
            (doc_id,), one=True)
    if not row:
        raise ValueError("document not found")
    # Move the file into the order's folder so storage mirrors the data model.
    new = STORE.move(row["storage_path"], order_id)
    return q("""update documents set order_id=%s, matched_by='manual', matched_at=now(),
                       storage_path=%s where id=%s returning *""",
             (order_id, new, doc_id), one=True)


def api_delete_document(d):
    """Permanently remove only genuinely unmatched Biller documents.

    Anything attached to an order, load, or stop is operational paperwork and
    must be detached by an explicit future workflow instead of deleted here.
    """
    row = q("""select id, order_id, load_id, load_stop_id, matched_by, storage_path
               from documents where id=%s""", (d["id"],), one=True)
    if not row:
        raise ValueError("document not found")
    if (row["matched_by"] != "unmatched" or row["order_id"] or row["load_id"] or row["load_stop_id"]):
        raise ValueError("Only unmatched documents can be deleted from Billing.")
    q("delete from documents where id=%s", (row["id"],))
    STORE.delete(row["storage_path"])
    return {"ok": True, "id": row["id"]}


def _load_at_cell(truck_id, date, slot):
    return q("select id from loads where truck_id=%s and scheduled_date=%s and slot=%s",
              (truck_id, date, slot), one=True)


def _load_at_carrier_cell(date, slot):
    """The outside-carrier lane's own address space (D115) — keyed by
    scheduled_date/slot same as a truck cell, but truck_id/driver_id are
    always null there (loads_driver_xor_carrier, initial schema), so it
    can't collide with a real truck's cell at the same date/slot. Keyed off
    is_carrier (D122), not carrier_party_id — a freshly-dropped load can sit
    here before it has a carrier name."""
    return q("""select id from loads where truck_id is null and driver_id is null
                and is_carrier and scheduled_date=%s and slot=%s""",
              (date, slot), one=True)


def _find_or_create_carrier(name):
    row = q("select id, is_carrier from parties where lower(name)=lower(%s)", (name,), one=True)
    if row:
        if not row["is_carrier"]:
            q("update parties set is_carrier=true where id=%s", (row["id"],))
        return row["id"]
    return q("insert into parties (name, is_carrier) values (%s, true) returning id",
              (name,), one=True)["id"]


def _load_for_order(order_id):
    return q("""select l.id, l.scheduled_date from loads l join load_orders lo on lo.load_id = l.id
                where lo.order_id = %s""", (order_id,), one=True)


def _default_view_window():
    """A restricted user with no admin-set range still isn't unbounded by
    default (D126) — 3 weeks back, 1 week forward from today, recomputed
    live on every check/read (not stored) so it actually rolls with the
    calendar. An admin setting an explicit view_start/view_end overrides
    this outright."""
    import datetime
    today = datetime.date.today()
    return ((today - datetime.timedelta(days=21)).isoformat(),
            (today + datetime.timedelta(days=7)).isoformat())


def _enforce_view_window(*dates):
    """A restricted user's Scheduler date range is a hard boundary (D125,
    Nate's explicit ask) — checked here on every Scheduler-affecting
    mutation, not just filtered out of the bootstrap read, so a direct API
    call can't slip a load in/out of the window either."""
    user = current_local_user()
    if not user or user["is_admin"]:
        return
    vs, ve = user.get("view_start"), user.get("view_end")
    if not vs and not ve:
        vs, ve = _default_view_window()
    for d in dates:
        if d and ((vs and str(d) < str(vs)) or (ve and str(d) > str(ve))):
            raise ValueError("That date is outside your permitted Scheduler range.")


def _is_invoiced(load_id):
    return bool(q("select 1 from invoices where load_id=%s", (load_id,), one=True))


def _driver_for_truck(truck_id):
    return q("""select driver_id from driver_truck_assignments
                where truck_id=%s and effective_to is null limit 1""",
             (truck_id,), one=True)


def api_schedule(d):
    """Place a load, a note, or clear a cell. truck/date/slot is the
    coordinate (D32) — a truck has the permanent spot on the Scheduler, the
    driver riding it is resolved from driver_truck_assignments at place time.

    Once a load has an invoice against it, it's done — locked against being
    cleared, overwritten, or rescheduled. Copy it into a new order from
    External Orders instead of moving the original."""
    truck_id, date, slot = d["truck_id"], d["date"], int(d["slot"])
    action = d.get("action")
    _enforce_view_window(date)

    if action == "clear":
        existing = _load_at_cell(truck_id, date, slot)
        if existing and _is_invoiced(existing["id"]):
            raise ValueError("This load is already invoiced and locked — it can't be cleared.")
        q("""delete from loads where truck_id=%s and scheduled_date=%s and slot=%s""",
          (truck_id, date, slot))
        # Clearing removes content, not formatting (Sheets parity). A cell's fmt
        # (fill/border, D67) and category color live on its schedule_notes row —
        # keep the row when either is set, blanking only the body; drop it only
        # when the cell is truly bare (D82).
        note = q("""select fmt, category_id from schedule_notes
                    where truck_id=%s and scheduled_date=%s and slot=%s""",
                 (truck_id, date, slot), one=True)
        if note and ((note.get("fmt") and note["fmt"] != {}) or note.get("category_id")):
            q("""update schedule_notes set body='' where truck_id=%s and scheduled_date=%s and slot=%s""",
              (truck_id, date, slot))
        else:
            q("delete from schedule_notes where truck_id=%s and scheduled_date=%s and slot=%s",
              (truck_id, date, slot))
        return {"ok": True}

    if action == "note":
        # A cell holds a load or a note, never both.
        existing = _load_at_cell(truck_id, date, slot)
        if existing and _is_invoiced(existing["id"]):
            raise ValueError("This load is already invoiced and locked — it can't be overwritten.")
        q("delete from loads where truck_id=%s and scheduled_date=%s and slot=%s",
          (truck_id, date, slot))
        return q("""
            insert into schedule_notes (truck_id, scheduled_date, slot, body)
            values (%s,%s,%s,%s)
            on conflict (truck_id, scheduled_date, slot)
            do update set body = excluded.body
            returning *""", (truck_id, date, slot, d["body"]), one=True)

    # Place an order as a load
    order_id = d["order_id"]
    prior = _load_for_order(order_id)
    if prior:
        _enforce_view_window(prior.get("scheduled_date"))
    if prior and _is_invoiced(prior["id"]):
        raise ValueError("This order is already invoiced and its load is locked — it can't be rescheduled.")
    dest = _load_at_cell(truck_id, date, slot)
    if dest and _is_invoiced(dest["id"]):
        raise ValueError("That slot already holds an invoiced load and can't be overwritten.")
    q("delete from schedule_notes where truck_id=%s and scheduled_date=%s and slot=%s",
      (truck_id, date, slot))
    # Remove any previous placement of this order — a load sits in one cell.
    q("""delete from loads l using load_orders lo
         where lo.load_id = l.id and lo.order_id = %s""", (order_id,))
    o = q("select kind, is_transfer from orders where id=%s", (order_id,), one=True)
    driver = _driver_for_truck(truck_id)
    load = q("""
        insert into loads (kind, status, scheduled_date, driver_id, truck_id, slot)
        values (%s,'assigned',%s,%s,%s,%s) returning *
    """, (o["kind"], date, driver["driver_id"] if driver else None, truck_id, slot), one=True)
    q("insert into load_orders (load_id, order_id) values (%s,%s)",
      (load["id"], order_id))
    if o["kind"] == "external" and not o["is_transfer"]:
        _sync_load_stops(load["id"], order_id)
    return load


def api_load_carrier(d):
    """Place (or edit) an order on the outside-carrier lane (D115/D122) —
    Nate's spec: drag from Staging (or any cell) like any normal load, no
    name/cost required up front. truck_id/driver_id stay null
    (loads_driver_xor_carrier, initial schema) so push-driver-tabs can never
    see it — that query only ever matches loads to a real truck_id. One load
    = one order (Nate: he wouldn't broker a combined/multi-stop load out), so
    no load_orders fan-out to worry about like internal's normal combining.

    A payload carrying date/slot is a placement (drag) — always replaces any
    prior load for the order, same as a normal schedule move, and creates a
    fresh is_carrier row even if a name/cost isn't known yet. A payload
    without date/slot is a drawer edit of an already-placed load's name/cost
    (D122's collapsible section) — partial update, no re-placement."""
    order_id = d["order_id"]
    name = (d.get("carrier_name") or "").strip()
    cost = d.get("carrier_cost")
    cost = float(cost) if cost not in (None, "") else None
    if cost is not None and cost < 0:
        raise ValueError("carrier cost cannot be negative")

    if "date" not in d:
        existing = _load_for_order(order_id)
        if not existing:
            raise ValueError("This order isn't on the outside-carrier lane.")
        _enforce_view_window(existing.get("scheduled_date"))
        if _is_invoiced(existing["id"]):
            raise ValueError("This order is already invoiced and its load is locked.")
        row = q("select carrier_party_id from loads where id=%s", (existing["id"],), one=True)
        has_carrier = bool(row["carrier_party_id"])
        sets, params = [], []
        # Presence-based, not truthy-based (D122) — an explicit blank name
        # must actually clear carrier_party_id so undo can round-trip back
        # to "no carrier" instead of silently no-op'ing. Clearing the name
        # also clears cost in the same statement when the request didn't
        # already touch cost, since loads_carrier_cost_only forbids a cost
        # surviving a null carrier_party_id.
        if "carrier_name" in d:
            carrier_id = _find_or_create_carrier(name) if name else None
            sets.append("carrier_party_id=%s"); params.append(carrier_id)
            has_carrier = bool(carrier_id)
            if not has_carrier and "carrier_cost" not in d:
                sets.append("carrier_cost=%s"); params.append(None)
        if "carrier_cost" in d:
            if cost is not None and not has_carrier:
                raise ValueError("Enter a carrier name before a cost.")
            sets.append("carrier_cost=%s"); params.append(cost)
        if not sets:
            return {"ok": True}
        params.append(existing["id"])
        return q(f"update loads set {', '.join(sets)} where id=%s returning *", params, one=True)

    prior = _load_for_order(order_id)
    if prior:
        _enforce_view_window(prior.get("scheduled_date"))
    if prior and _is_invoiced(prior["id"]):
        raise ValueError("This order is already invoiced and its load is locked — it can't be rescheduled.")
    date, slot = d["date"], int(d["slot"])
    _enforce_view_window(date)
    dest = _load_at_carrier_cell(date, slot)
    if dest and _is_invoiced(dest["id"]):
        raise ValueError("That slot already holds an invoiced load and can't be overwritten.")
    q("""delete from loads l using load_orders lo
         where lo.load_id = l.id and lo.order_id = %s""", (order_id,))
    o = q("select kind, is_transfer from orders where id=%s", (order_id,), one=True)
    carrier_id = _find_or_create_carrier(name) if name else None
    load = q("""
        insert into loads (kind, status, scheduled_date, slot, is_carrier, carrier_party_id, carrier_cost)
        values (%s,'assigned',%s,%s,true,%s,%s) returning *
    """, (o["kind"], date, slot, carrier_id, cost if carrier_id else None), one=True)
    q("insert into load_orders (load_id, order_id) values (%s,%s)", (load["id"], order_id))
    if o["kind"] == "external" and not o["is_transfer"]:
        _sync_load_stops(load["id"], order_id)
    return load


def api_cell_color(d):
    """Set (or clear) a cell's category color (D66). A cell holding a load colors
    the load; an empty/text cell colors its schedule_notes row. category_id null
    clears it. Spreadsheet-style fill — the color carries a named category so the
    board stays consistent with the 2025 import and Reports can group by it."""
    truck_id, date, slot = d["truck_id"], d["date"], int(d["slot"])
    _enforce_view_window(date)
    cat = d.get("category_id") or None
    load = _load_at_cell(truck_id, date, slot)
    if load:
        q("update loads set category_id=%s where id=%s", (cat, load["id"]))
        return {"ok": True, "on": "load"}
    existing = q("""select body, category_id, fmt from schedule_notes
                    where truck_id=%s and scheduled_date=%s and slot=%s""",
                 (truck_id, date, slot), one=True)
    # Clearing color on a cell with no text -> drop the row, UNLESS it still
    # carries manual formatting (fill/border, D67) — clearing the color must not
    # wipe the fmt (D82).
    has_fmt = bool(existing and existing.get("fmt") and existing["fmt"] != {})
    if cat is None and not (existing and (existing.get("body") or "").strip()) and not has_fmt:
        q("delete from schedule_notes where truck_id=%s and scheduled_date=%s and slot=%s",
          (truck_id, date, slot))
        return {"ok": True, "on": "empty"}
    q("""insert into schedule_notes (truck_id, scheduled_date, slot, body, category_id)
         values (%s,%s,%s,%s,%s)
         on conflict (truck_id, scheduled_date, slot)
         do update set category_id = excluded.category_id""",
      (truck_id, date, slot, (existing and existing.get("body")) or "", cat))
    return {"ok": True, "on": "note"}


def api_cell_format(d):
    """Merge a formatting patch into a cell's fmt jsonb (D67). Applies to the
    load if the cell holds one, else its schedule_notes row (created if needed).
    A key set to null is removed; {} clears everything. Keys: fill, text, bold,
    italic, size."""
    truck_id, date, slot = d["truck_id"], d["date"], int(d["slot"])
    _enforce_view_window(date)
    patch = d.get("patch") or {}
    load = _load_at_cell(truck_id, date, slot)

    def merged(cur):
        # replace mode (used by undo) swaps the whole fmt for the patch.
        if d.get("replace"):
            return {k: v for k, v in patch.items() if v not in (None, "")}
        cur = dict(cur or {})
        for k, v in patch.items():
            if v is None or v == "":
                cur.pop(k, None)
            else:
                cur[k] = v
        return cur

    if load:
        row = q("select fmt from loads where id=%s", (load["id"],), one=True)
        q("update loads set fmt=%s::jsonb where id=%s", (json.dumps(merged(row["fmt"])), load["id"]))
        return {"ok": True, "on": "load"}
    existing = q("""select body, fmt from schedule_notes
                    where truck_id=%s and scheduled_date=%s and slot=%s""",
                 (truck_id, date, slot), one=True)
    newfmt = merged(existing["fmt"] if existing else {})
    if not newfmt and not (existing and (existing.get("body") or "").strip()):
        q("delete from schedule_notes where truck_id=%s and scheduled_date=%s and slot=%s",
          (truck_id, date, slot))
        return {"ok": True, "on": "empty"}
    q("""insert into schedule_notes (truck_id, scheduled_date, slot, body, fmt)
         values (%s,%s,%s,%s,%s::jsonb)
         on conflict (truck_id, scheduled_date, slot)
         do update set fmt = excluded.fmt""",
      (truck_id, date, slot, (existing and existing.get("body")) or "", json.dumps(newfmt)))
    return {"ok": True, "on": "note"}


def api_truck_off(d):
    """Mark a truck off/unavailable for a whole day, or clear it (D66) — the red
    day the sheet used. Not a load."""
    truck_id, date = d["truck_id"], d["off_date"]
    if d.get("on") is False:
        q("delete from truck_off_days where truck_id=%s and off_date=%s", (truck_id, date))
        return {"ok": True, "on": False}
    off_cat = q("select id from categories where is_off limit 1", one=True)
    q("""insert into truck_off_days (truck_id, off_date, note, category_id)
         values (%s,%s,%s,%s)
         on conflict (truck_id, off_date)
         do update set note = excluded.note""",
      (truck_id, date, d.get("note") or "Off", off_cat["id"] if off_cat else None))
    return {"ok": True, "on": True}


def api_day_note(d):
    """Right-click day-header note (D230) — a dispatcher-only annotation
    pinned to a calendar date, not a truck/slot. Never pushed to driver tabs
    or Sheets; surfaces only in the app and its Day Notes export. Empty text
    deletes the row outright — there's no per-cell formatting to preserve
    alongside it the way schedule_notes has (D82)."""
    note_date = d.get("note_date")
    if not note_date:
        raise ValueError("note_date is required.")
    text = (d.get("text") or "").strip()
    if not text:
        q("delete from day_notes where note_date=%s", (note_date,))
        return {"note_date": note_date, "text": ""}
    return q("""insert into day_notes (note_date, text) values (%s,%s)
                on conflict (note_date) do update set text = excluded.text
                returning id, note_date, text""", (note_date, text), one=True)


def api_category(d):
    """Create / rename / recolor / delete a scheduler category (D66)."""
    if d.get("delete") and d.get("id"):
        q("delete from categories where id=%s", (d["id"],))
        return {"ok": True}
    if d.get("id"):
        return q("""update categories set name=%s, color=%s, is_off=%s
                    where id=%s returning *""",
                 (d["name"], d["color"], bool(d.get("is_off")), d["id"]), one=True)
    return q("""insert into categories (name, color, is_off, sort)
                values (%s,%s,%s, coalesce((select max(sort)+10 from categories),0))
                returning *""",
             (d["name"], d["color"], bool(d.get("is_off"))), one=True)


def api_sheet(d):
    """Create / rename / resize / delete a custom Database sheet (D74)."""
    if d.get("delete") and d.get("id"):
        q("delete from sheets where id=%s", (d["id"],))
        return {"ok": True}
    if d.get("id"):
        sets, vals = [], []
        for col in ("name", "n_rows", "n_cols", "sort"):
            if d.get(col) is not None:
                sets.append(col + "=%s"); vals.append(d[col])
        if not sets:
            return {"ok": True}
        vals.append(d["id"])
        return q("update sheets set " + ", ".join(sets) + " where id=%s returning *", vals, one=True)
    if q("select count(*) as n from sheets", one=True)["n"] >= 10:
        raise ValueError("Sheet limit reached (10). Delete a sheet before adding another.")
    return q("""insert into sheets (name, n_rows, n_cols, sort)
                values (%s, %s, %s, coalesce((select max(sort)+1 from sheets),0))
                returning *""",
             (d.get("name") or "New sheet", int(d.get("n_rows") or 25), int(d.get("n_cols") or 25)),
             one=True)


def api_sheet_cell(d):
    """Set one sheet cell's value and/or merge a fmt patch (D74). An empty cell
    with no formatting is deleted so the store stays sparse."""
    sid, r, c = d["sheet_id"], int(d["r"]), int(d["c"])
    patch = d.get("fmt")
    existing = q("select value, fmt from sheet_cells where sheet_id=%s and r=%s and c=%s",
                 (sid, r, c), one=True)
    value = d["value"] if "value" in d else (existing["value"] if existing else None)
    value = None if value in ("", None) else value
    fmt = dict(existing["fmt"]) if existing else {}
    if patch is not None:
        if d.get("replace"):
            fmt = {k: v for k, v in patch.items() if v not in (None, "")}
        else:
            for k, v in patch.items():
                if v in (None, ""):
                    fmt.pop(k, None)
                else:
                    fmt[k] = v
    if value is None and not fmt:
        q("delete from sheet_cells where sheet_id=%s and r=%s and c=%s", (sid, r, c))
        return {"ok": True, "on": "empty"}
    q("""insert into sheet_cells (sheet_id, r, c, value, fmt)
         values (%s,%s,%s,%s,%s::jsonb)
         on conflict (sheet_id, r, c)
         do update set value = excluded.value, fmt = excluded.fmt""",
      (sid, r, c, value, json.dumps(fmt)))
    return {"ok": True}


def api_grid_cell_fmt(d):
    """Merge a fmt patch (or replace, for undo) into one built-in grid cell's
    formatting (D76). Empty fmt deletes the row so the store stays sparse."""
    table, rid, field = d["table"], d["id"], d["field"]
    # Allow-list the polymorphic target (no FK on this table) so a malformed or
    # hostile client can't accumulate junk rows loaded on every bootstrap (D82).
    if table not in CUSTOM_TABLES:
        raise ValueError("unknown grid table")
    if not field or not re.fullmatch(r"[a-z_][a-z0-9_]*", field):
        raise ValueError("invalid field")
    patch = d.get("fmt") or {}
    row = q("""select fmt from grid_cell_fmt
               where table_name=%s and row_id=%s and field=%s""", (table, rid, field), one=True)
    if d.get("replace"):
        fmt = {k: v for k, v in patch.items() if v not in (None, "")}
    else:
        fmt = dict(row["fmt"]) if row else {}
        for k, v in patch.items():
            if v in (None, ""):
                fmt.pop(k, None)
            else:
                fmt[k] = v
    if not fmt:
        q("delete from grid_cell_fmt where table_name=%s and row_id=%s and field=%s", (table, rid, field))
        return {"ok": True, "on": "empty"}
    q("""insert into grid_cell_fmt (table_name, row_id, field, fmt)
         values (%s,%s,%s,%s::jsonb)
         on conflict (table_name, row_id, field) do update set fmt = excluded.fmt""",
      (table, rid, field, json.dumps(fmt)))
    return {"ok": True}


def api_freight(d):
    """Miles and the bag-plant transfer charge, set against the order directly
    (D103) — no requirement to stage or schedule it first. Miles are pre-filled
    from Motive once the order is on a truck (D48); typing a value here flags
    the order `miles_adjusted` so a re-sync won't overwrite it. `reset_miles`
    drops back to the raw Motive figure.

    Typing miles by hand also auto-fills the transfer $ (D187), the same
    charge a Motive sync's follow-up calculate step would produce — Nate:
    "i want it to auto calc based on mileage i type on an order too, but
    still let me typeover the $ amount if i need to." Same guard as that
    endpoint: only fills a still-blank internal_freight_amount (never
    overwrites a typed-over or already-calculated one) and only when a
    rate is configured. Typing the $ amount directly still always wins,
    whether that happens before or after this."""
    order_id = d["order_id"]
    if d.get("reset_miles"):
        return q("update orders set miles = motive_miles, miles_adjusted = false "
                 "where id=%s returning *", (order_id,), one=True)
    sets, vals = [], []
    if "miles" in d:
        sets.append("miles = %s"); vals.append(d.get("miles") or None)
        sets.append("miles_adjusted = %s"); vals.append(d.get("miles") not in (None, ""))
    if "freight_amount" in d:
        sets.append("internal_freight_amount = %s"); vals.append(d.get("freight_amount") or None)
    if not sets:
        return {"ok": True}
    vals.append(order_id)
    row = q(f"update orders set {', '.join(sets)} where id=%s returning *", vals, one=True)
    if "miles" in d and d.get("miles") not in (None, "") and row["internal_freight_amount"] is None:
        cfg = q("select rate_per_mile, minimum_charge from internal_freight_rate "
                "order by updated_at desc limit 1", one=True)
        rate = float(cfg["rate_per_mile"]) if cfg else 0
        if rate > 0:
            row = q("""update orders set internal_freight_amount = round(greatest(miles * %s, %s)::numeric, 2)
                       where id=%s returning *""", (rate, float(cfg["minimum_charge"]), order_id), one=True)
    return row


def api_motive_sync_miles():
    """Pull per-truck-per-day miles from Motive for every internal-flavored
    order that doesn't have them yet (D48) — bag-plant orders (kind=internal)
    AND Internal Freight transfers (is_transfer, D127), the only two buckets
    Nate wants ELD-tracked; true external mileage is derived by subtraction,
    not synced per-load. Miles live on the order (D103), but Motive
    only reports per truck per day, so an order needs an actual scheduled load
    before it has a truck/date to look up — orders still waiting to be staged
    are simply skipped until then. Batched: one date-range call to the ELD
    covers all trucks; already-filled orders are skipped, so repeat syncs cost
    almost nothing. Adjusted orders keep Nate's number (only motive_miles
    refreshes).

    motive_synced_at (D124) marks "we asked Motive about this order" whether
    or not it found anything — an order whose date predates that truck (or
    the whole account) being on Motive will never match, and without this
    it stayed in the query forever, dragging every future sync's date range
    back to that old date. Nate: "I don't want it to try and find data for
    those orders." Once stamped, an order drops out of the query for good
    even if it never got mileage — no retry mechanism, matching the ask."""
    if not MOTIVE.available:
        raise ValueError(MOTIVE.why)
    rows = q("""select o.id, l.scheduled_date, o.miles_adjusted, t.number as truck_number
                from orders o
                join load_orders lo on lo.order_id = o.id
                join loads l on l.id = lo.load_id
                join trucks t on t.id = l.truck_id
                where (o.kind = 'internal' or o.is_transfer) and l.scheduled_date is not null
                  and o.motive_miles is null and o.motive_synced_at is null""")
    if not rows:
        return {"filled": 0, "unmatched": [], "message": "Nothing to sync — all internal orders have mileage."}
    dates = [r["scheduled_date"] for r in rows]
    start, end = min(dates).isoformat(), max(dates).isoformat()
    miles_map = MOTIVE.daily_miles(start, end)
    filled, unmatched = 0, set()
    for r in rows:
        mi = miles_map.get((str(r["truck_number"]), r["scheduled_date"].isoformat()))
        if mi is None:
            unmatched.add(r["truck_number"])
            q("update orders set motive_synced_at=now() where id=%s", (r["id"],))
            continue
        mi = round(mi, 1)
        if r["miles_adjusted"]:
            q("update orders set motive_miles=%s, motive_synced_at=now() where id=%s", (mi, r["id"]))
        else:
            q("update orders set motive_miles=%s, miles=%s, motive_synced_at=now() where id=%s",
              (mi, mi, r["id"]))
        filled += 1
    return {"filled": filled, "date_range": [start, end], "unmatched": sorted(unmatched)}


def api_internal_freight_rate_save(d):
    """D170: the persisted $/mile rate + minimum charge shown on the Orders
    toolbar. One settings row — always update it in place, never insert a
    second one."""
    rate = float(d.get("rate_per_mile") or 0)
    minimum = float(d.get("minimum_charge") or 0)
    if rate < 0 or minimum < 0:
        raise ValueError("Rate and minimum can't be negative.")
    return q("""update internal_freight_rate
                set rate_per_mile=%s, minimum_charge=%s, updated_at=now()
                where id = (select id from internal_freight_rate order by updated_at desc limit 1)
                returning rate_per_mile, minimum_charge""", (rate, minimum), one=True)


def api_internal_freight_rate_calculate():
    """D170: apply the current rate/minimum to internal-flavored orders (Bag
    Orders + Internal Freight transfers, same D127 pairing Motive sync uses)
    that have miles but no charge yet. Deliberately WHERE internal_freight_
    amount is null — an order that already has a value, hand-entered or from
    an earlier run under a different rate, is never touched (Nate: "only
    changes what it calculates that run not what it was previously").
    charge = greatest(miles * rate, minimum); minimum=0 never binds, so it's
    always plain miles * rate."""
    cfg = q("select rate_per_mile, minimum_charge from internal_freight_rate order by updated_at desc limit 1", one=True)
    rate = float(cfg["rate_per_mile"])
    if rate <= 0:
        raise ValueError("Set a rate per mile first.")
    rows = q("""update orders
                set internal_freight_amount = round(greatest(miles * %s, %s)::numeric, 2)
                where (kind = 'internal' or is_transfer)
                  and miles is not null and internal_freight_amount is null
                returning id""", (rate, float(cfg["minimum_charge"])))
    return {"filled": len(rows or [])}


def api_unschedule(order_id):
    # Invoiced loads are locked (D29) — match the friendly error the other
    # schedule mutations give instead of letting the FK RESTRICT raise a raw 500.
    load = _load_for_order(order_id)
    if load:
        _enforce_view_window(load.get("scheduled_date"))
    if load and _is_invoiced(load["id"]):
        raise ValueError("This load is already invoiced and locked — it can't be unscheduled.")
    q("""delete from loads l using load_orders lo
         where lo.load_id = l.id and lo.order_id = %s""", (order_id,))
    return {"ok": True}


def api_sync_delivery_dates():
    """Ported from syncDeliveryDates: write the scheduled date back onto the
    order. Covers both kinds (D34) — it was internal-only in the legacy sheet
    because that's all the sheet's version applied to, but there's no reason
    an external order's delivered_at shouldn't sync the same way once it's
    been run. Lives on the Internal and External Orders pages, not the
    Scheduler (D34).

    Also stamps truck_id from the same load join (D239) — Nate wanted a
    Truck column on Bag Orders/Internal Freight, and pointed out this sync
    already resolves "which truck ran this order" for delivered_at, so
    persisting it here means the freight/mileage reports can read a plain
    orders.truck_id instead of re-deriving it via a lateral subquery through
    load_orders/loads at report time. Re-running this after a load's truck
    changes keeps it current, same staleness tolerance delivered_at itself
    already has."""
    rows = q("""
        update orders o set delivered_at = l.scheduled_date, truck_id = l.truck_id
        from load_orders lo join loads l on l.id = lo.load_id
        where lo.order_id = o.id
          and l.scheduled_date is not null
          and (o.delivered_at is distinct from l.scheduled_date
               or o.truck_id is distinct from l.truck_id)
        returning o.id
    """)
    return {"synced": len(rows or [])}


def _rolling_driver_dates(start_date=None, count=3):
    """Next N driver-visible dates from a chosen start (D98).

    Weekdays always count. Saturday/Sunday count only when at least one real
    scheduled load exists, so a normal Friday handoff becomes Fri/Mon/Tue but a
    loaded Saturday becomes Fri/Sat/Mon. Mirrors the Current Week browser view.
    """
    import datetime
    try:
        start = datetime.date.fromisoformat(start_date) if start_date else datetime.date.today()
    except (TypeError, ValueError):
        raise ValueError("start_date must be YYYY-MM-DD")
    count = max(1, min(14, int(count or 3)))
    scan_end = start + datetime.timedelta(days=45)
    weekend_loads = {r["scheduled_date"] for r in q("""
        select distinct l.scheduled_date
        from loads l join load_orders lo on lo.load_id=l.id
        where l.scheduled_date between %s and %s
    """, (start, scan_end))}
    out, day = [], start
    while len(out) < count and day <= scan_end:
        if day.weekday() < 5 or day in weekend_loads:
            out.append(day)
        day += datetime.timedelta(days=1)
    if len(out) != count:
        raise ValueError("Could not build the requested driver date window")
    return out


def _fmt_location(name, address, city, state, phone):
    """One address as the legacy chip renders it (D36):
    '{name}, {address}, {city} {state}, {phone}', dropping empty parts.

    Matches the screenshot example
    'ABC Roofing Eugene, 4227 W6th AVE, Eugene OR, 541-683-3222'."""
    citystate = " ".join(p for p in [(city or "").strip(), (state or "").strip()] if p)
    parts = [p for p in [(name or "").strip(), (address or "").strip(), citystate,
                         (phone or "").strip()] if p]
    return ", ".join(parts)


def _internal_chip_text(o, pallets=None):
    """Internal chip hierarchy from Nate's working TMS sheet.

    Customer is the scan target, location/equipment sits on its own line, and
    the Solomon 07 number anchors the final line beside the pallet count.
    """
    customer = o.get("customer_name") or "(no customer)"
    citystate = " ".join(p for p in [(o.get("cust_city") or "").strip(),
                                     (o.get("cust_state") or "").strip()] if p)
    info = citystate + (" - " + o["cust_forklift"] if o.get("cust_forklift") else "")
    order_line = o.get("solomon_order_no") or "(no order #)"
    if pallets is not None:
        order_line += f" - {pallets} PAL"
    return "\n".join(x for x in [customer, info.strip(), order_line] if x)


def _transfer_chip_text(o):
    """Internal Freight transfers (D127/D130) have no broker/customer or
    pickup/delivery to build the normal external chip from. o.notes ("Load
    Info") is dispatcher-facing route shorthand and stays on the dashboard
    chip only — it deliberately does NOT get pushed here. driver_note is the
    text actually meant for the driver; department stays the second line for
    the same at-a-glance traceability the dashboard chip has."""
    return "\n".join(x for x in [o.get("driver_note"),
                                  o.get("transfer_department_name") or "(no department)"] if x)


def _driver_chip_text(o, pallets=None, stops=None):
    """The DRIVER LOAD CHIP (D36, PO#/delivery# split out to their own
    columns D178, header/PICK-DROP layout reworked D180, blank line
    restored between PICK and DROP D183).

    External:

        {broker} - Rexius Order: {solomon} | Load: {load#}

        PICK: {pickup name, address, city state, phone}

        DROP: {delivery name, address, city state, phone}

    "Rexius Order:" and "Load:" are bolded the same way "PICK:"/"DROP:"
    already are (`_fmt_requests`' label regex). PO/PU# and Delivery# don't
    lead the PICK/DROP lines — those live in the driver tab's own E/F
    columns instead (`_driver_week_payload`). ',INC.' is literally part of
    the stored broker name, not added here.

    Internal chips are provisional — Nate's examples were all external. Best
    effort from the bagger-customer fields: customer, city/state - forklift,
    pallet count."""
    if o.get("is_transfer"):
        return _transfer_chip_text(o)
    if o["kind"] == "external":
        header = "{} - Rexius Order: {} | Load: {}".format(
            o.get("broker_name") or "(no broker)",
            o.get("solomon_order_no") or "", o.get("broker_load_no") or "")
        if o.get("route_mode") == "custom" and stops:
            lines = [header]
            for stop in stops:
                label = "PICK" if stop["stop_type"] == "pickup" else "DROP"
                ref = (stop.get("reference_number") or "").strip()
                address = _fmt_location(stop.get("name"), stop.get("address"),
                                        stop.get("city"), stop.get("state"), stop.get("phone"))
                line = f'{stop["sequence"]}. {label}: {ref} | {address}'
                extras = [stop.get("notes")]
                if stop.get("scheduled_at"):
                    extras.insert(0, "APPT " + stop["scheduled_at"].strftime("%m/%d %I:%M %p"))
                if stop.get("pallet_count") is not None:
                    extras.insert(0, f'{stop["pallet_count"]} PAL')
                if any(extras):
                    line += " — " + " · ".join(x for x in extras if x)
                lines.append(line)
            return "\n\n".join(lines)
        # Blank line between every section — header, PICK, DROP (D183). The
        # driver tab chip has room for it; Current Week's compact chip
        # (`_current_week_chip_text`) deliberately keeps PICK/DROP tight
        # since its cell is a fixed, smaller size.
        pick = "PICK: {}".format(
            _fmt_location(o.get("pickup_name"), o.get("pickup_address"),
                          o.get("pickup_city"), o.get("pickup_state"), o.get("pickup_phone")))
        drop = "DROP: {}".format(
            _fmt_location(o.get("delivery_name"), o.get("delivery_address"),
                          o.get("delivery_city"), o.get("delivery_state"), o.get("delivery_phone")))
        return "\n\n".join([header, pick, drop])

    return _internal_chip_text(o, pallets)


def _current_week_chip_text(o, stops=None):
    """The compact Current Week chip (D37) — deliberately smaller than the
    full driver-tab dump because Nate's Current Week cells are a fixed size he
    doesn't want to resize. Broker/Load#, then pickup and drop as name +
    city + state (D182 — Load# only, not the full Rexius Order/Load# header
    the driver tab chip has, D180 — Nate found the Solomon # one field too
    many for this fixed-size cell):

        {broker} - Load: {load#}
        PICK: {pickup name}, {pickup city} {pickup state}
        DROP: {delivery name}, {delivery city} {delivery state}

    Internal: customer + city + state, same idea."""
    def loc(name, city, state):
        citystate = " ".join(p for p in [(city or "").strip(), (state or "").strip()] if p)
        return ", ".join(p for p in [(name or "").strip(), citystate] if p)
    if o.get("is_transfer"):
        return _transfer_chip_text(o)
    if o["kind"] == "external":
        header = "{} - Load: {}".format(
            o.get("broker_name") or "(no broker)", o.get("broker_load_no") or "")
        # Blank line between broker/customer and the stop block (readable),
        # but the stops themselves stay tight — single newlines — so they
        # still fit the fixed-size Current Week cell (D179).
        if o.get("route_mode") == "custom" and stops:
            stop_lines = []
            for i, stop in enumerate(stops, 1):
                label = "PICK" if stop.get("stop_type") == "pickup" else "DROP"
                place = loc(stop.get("name"), stop.get("city"), stop.get("state"))
                if place:
                    stop_lines.append(f"{i}. {label}: {place}")
            return "\n\n".join([header, "\n".join(stop_lines)]) if stop_lines else header
        pick = loc(o.get("pickup_name"), o.get("pickup_city"), o.get("pickup_state"))
        drop = loc(o.get("delivery_name"), o.get("delivery_city"), o.get("delivery_state"))
        stop_lines = []
        if pick:
            stop_lines.append("PICK: " + pick)
        if drop:
            stop_lines.append("DROP: " + drop)
        return "\n\n".join([header, "\n".join(stop_lines)]) if stop_lines else header
    return _internal_chip_text(o, o.get("pallet_count"))


# Exact Google-Sheets stock colors read off the live Current Week legend
# (A2:A5), keyed by (timing_window, is_umatilla) — D37. These are the four
# legend swatches: Early Store, Anytime, Early EAST, Anytime EAST.
LEGEND_COLORS = {
    ("early", False):   "#D9EAD3",  # green  — Early Store
    ("anytime", False): "#FFF2CC",  # yellow — Anytime
    ("early", True):    "#F1C232",  # dark yellow — Early EAST
    ("anytime", True):  "#783F04",  # brown  — Anytime EAST
}
# Brown is dark enough that black text is unreadable on it.
DARK_FILLS = {"#783F04", "#FF0000"}
# Truck off for the day (D65's Scheduler hatch is local-UI only; the pushed
# sheet has no pattern fills, so a plain solid red is the closest match).
TRUCK_OFF_COLOR = "#FF0000"


def _hex_to_rgb01(h):
    h = (h or "").lstrip("#")
    if len(h) == 8:  # browser-side opacity is #RRGGBBAA; Sheets needs RGB
        h = h[:6]
    if len(h) != 6:
        return None
    return {"red": int(h[0:2], 16) / 255, "green": int(h[2:4], 16) / 255,
            "blue": int(h[4:6], 16) / 255}


def _maps_view_link(name, address, city, state):
    """A 'view this location' Google Maps link (D113) — pin + satellite view,
    deliberately not turn-by-turn directions. Consumer Google Maps has no
    truck-safe routing mode; a generated route can send a truck under a low
    bridge or down a weight-restricted road. Drivers use their own truck
    GPS/routing app for the actual route — this just shows where they're
    going and how to get the truck in, same job the old store-map image did
    for internal loads, for an external address instead."""
    citystate = " ".join(p for p in [(city or "").strip(), (state or "").strip()] if p)
    query = ", ".join(p for p in [(address or "").strip(), citystate] if p) or (name or "").strip()
    return "https://www.google.com/maps/search/?api=1&query=" + quote(query) if query else ""




def _lighten_hex(h, white_mix=0.78):
    """Keep a driver's hue while making an external chip easy to read."""
    h = (h or "").lstrip("#")
    if len(h) == 8:
        h = h[:6]
    if len(h) != 6:
        return None
    vals = [int(h[i:i + 2], 16) for i in (0, 2, 4)]
    mixed = [round(v + (255 - v) * white_mix) for v in vals]
    return "#" + "".join(f"{v:02X}" for v in mixed)


def _chip_fill(o, driver_color):
    """The cell background for a chip (D37). Internal loads take the legend
    color from their delivery customer's timing_window/is_umatilla; external
    loads take a light tint of the assigned driver's color; Internal Freight
    transfers (D127 follow-up #2) take their department's own static color
    (departments.color, same tier as the internal legend) — no driver tint,
    no fallback if that department has no color set. The full color is
    reserved for the row-one header, keeping the association without
    reducing chip readability."""
    if o.get("is_transfer"):
        return o.get("transfer_department_color") or None
    if o["kind"] == "external":
        return _lighten_hex(driver_color) if driver_color else None
    return LEGEND_COLORS.get((o.get("cust_timing"), bool(o.get("cust_umatilla"))))


def _fmt_requests(sheet_id, row, col, text, fill_hex, font_size=10):
    """batchUpdate requests to make one chip cell render correctly (D37):
    wrap on so multi-line chips stay inside the cell (the Current Week
    overflow Nate hit), the legend/driver background fill, black-or-white
    text for contrast, and bold 'PICK:'/'DROP:' prefixes via text-format
    runs. `row`/`col` are 0-based. Sending the value here too (not relying on
    a prior values write) keeps the text and its bold runs atomic."""
    fmt = {"wrapStrategy": "WRAP", "verticalAlignment": "TOP"}
    dark = False
    if fill_hex:
        rgb = _hex_to_rgb01(fill_hex)
        if rgb:
            fmt["backgroundColor"] = rgb
            dark = fill_hex.upper() in DARK_FILLS
    text_color = {"red": 1, "green": 1, "blue": 1} if dark else {"red": 0, "green": 0, "blue": 0}
    fmt["textFormat"] = {"foregroundColor": text_color, "fontFamily": "Arial",
                         "fontSize": font_size}

    # Bold every PICK:/DROP:/Rexius Order:/Load: label (D180) and the
    # Solomon 07 number on internal chips. Text-format runs are positional,
    # so one ordered map handles repeated labels on multi-stop routes
    # without overlapping runs.
    base = {"foregroundColor": text_color}
    formats = {0: {**base, "bold": False}}
    for match in re.finditer(r"PICK:|DROP:|Rexius Order:|Load:|\b07-\d{4}-\d{4}\b", text):
        formats[match.start()] = {**base, "bold": True}
        formats[match.end()] = {**base, "bold": False}
    runs = [{"startIndex": idx, "format": value}
            for idx, value in sorted(formats.items())] if len(formats) > 1 else []

    cell = {"userEnteredValue": {"stringValue": text},
            "userEnteredFormat": fmt}
    if runs:
        cell["textFormatRuns"] = runs
    return [{
        "updateCells": {
            "rows": [{"values": [cell]}],
            "fields": "userEnteredValue,userEnteredFormat(backgroundColor,wrapStrategy,verticalAlignment,textFormat),textFormatRuns",
            "start": {"sheetId": sheet_id, "rowIndex": row, "columnIndex": col},
        }
    }]


def _contrast_text_color(fill_hex):
    """Black/white header text selected from the actual dashboard color."""
    h = (fill_hex or "").lstrip("#")
    if len(h) != 6:
        return {"red": 0, "green": 0, "blue": 0}
    red, green, blue = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
    return ({"red": 1, "green": 1, "blue": 1} if luminance < 0.48 else
            {"red": 0, "green": 0, "blue": 0})


def _header_cell_request(sheet_id, row, col, text, fill_hex=None, font_size=14):
    """One authoritative row-one header sourced from dashboard driver state."""
    fill_hex = fill_hex or "#E6E6E6"
    fill = _hex_to_rgb01(fill_hex) or {"red": 0.9, "green": 0.9, "blue": 0.9}
    return {"updateCells": {
        "rows": [{"values": [{
            "userEnteredValue": {"stringValue": text},
            "userEnteredFormat": {
                "backgroundColor": fill, "horizontalAlignment": "CENTER",
                "verticalAlignment": "MIDDLE", "wrapStrategy": "WRAP",
                "textFormat": {"fontFamily": "Arial", "fontSize": font_size,
                               "bold": True,
                               "foregroundColor": _contrast_text_color(fill_hex)}}}]}],
        "fields": "userEnteredValue,userEnteredFormat(backgroundColor,horizontalAlignment,"
                  "verticalAlignment,wrapStrategy,textFormat)",
        "start": {"sheetId": sheet_id, "rowIndex": row, "columnIndex": col}}}


def _three_slot_grid_requests(sheet_id, start_col, end_col, row_height,
                              content_font_size=10, days=5):
    """Match the live Current Week convention across rows 2:16.

    Every day owns three rows. The first date is bold black with a thick top
    rule; the two repeated dates beneath it are bold white, so the day reads
    as one visual block while the underlying cells remain sortable dates.
    """
    start_row, end_row = 1, 1 + (int(days) * 3)
    reqs = [
        {"updateDimensionProperties": {
            "range": {"sheetId": sheet_id, "dimension": "ROWS",
                      "startIndex": start_row, "endIndex": end_row},
            "properties": {"pixelSize": row_height}, "fields": "pixelSize"}},
        {"repeatCell": {
            "range": {"sheetId": sheet_id, "startRowIndex": start_row,
                      "endRowIndex": end_row, "startColumnIndex": start_col,
                      "endColumnIndex": end_col},
            "cell": {"userEnteredFormat": {
                "wrapStrategy": "WRAP", "verticalAlignment": "TOP",
                "textFormat": {"fontFamily": "Arial", "fontSize": content_font_size}}},
            "fields": "userEnteredFormat(wrapStrategy,verticalAlignment,textFormat)"}},
    ]
    for row in range(start_row, end_row):
        first_slot = (row - start_row) % 3 == 0
        date_color = ({"red": 0, "green": 0, "blue": 0} if first_slot else
                      {"red": 1, "green": 1, "blue": 1})
        reqs.append({"repeatCell": {
            "range": {"sheetId": sheet_id, "startRowIndex": row, "endRowIndex": row + 1,
                      "startColumnIndex": 1, "endColumnIndex": 2},
            "cell": {"userEnteredFormat": {
                "numberFormat": {"type": "DATE", "pattern": "m/d/yy - ddd"},
                "horizontalAlignment": "CENTER", "verticalAlignment": "MIDDLE",
                "backgroundColor": {"red": 1, "green": 1, "blue": 1},
                "textFormat": {"fontFamily": "Arial", "fontSize": 13,
                               "bold": True, "foregroundColor": date_color}}},
            "fields": "userEnteredFormat(numberFormat,horizontalAlignment,verticalAlignment,"
                      "backgroundColor,textFormat)"}})
        if first_slot:
            reqs.append({"repeatCell": {
                "range": {"sheetId": sheet_id, "startRowIndex": row,
                          "endRowIndex": row + 1, "startColumnIndex": start_col,
                          "endColumnIndex": end_col},
                "cell": {"userEnteredFormat": {"borders": {"top": {
                    "style": "SOLID_THICK", "color": {"red": 0, "green": 0, "blue": 0}}}}},
                "fields": "userEnteredFormat.borders.top"}})
    return reqs


def _driver_week_payload(start_date=None, days=3):
    """Build the three-slots-per-day export for driver tabs and Current Week.

    Driver tabs receive the detailed chip plus notes and links. Current Week
    receives a compact chip for every active truck, including trucks without a
    current driver. The payload is read-only and is also the exact dry-run
    preview shown before any Google Sheets write.
    """
    dates = _rolling_driver_dates(start_date, days)
    trucks = q("""
        select t.id as truck_id, t.number, t.equipment_type as eq,
               dr.id as driver_id, dr.full_name as driver_name, dr.color as driver_color
        from trucks t
        left join lateral (
          select d.id, d.full_name, d.color
          from driver_truck_assignments a
          join drivers d on d.id = a.driver_id
          where a.truck_id = t.id and a.effective_to is null
          limit 1
        ) dr on true
        where t.active
        order by t.sort_order nulls last, t.number
    """)
    loads = q("""
        select l.id, l.truck_id, l.scheduled_date, l.slot,
               coalesce(array_agg(lo.order_id) filter (where lo.order_id is not null), '{}') as order_ids
        from loads l
        left join load_orders lo on lo.load_id = l.id
        where l.truck_id is not null and l.scheduled_date between %s and %s
        group by l.id
        order by l.slot
    """, (dates[0], dates[-1]))

    # A cell with no real load can still hold free text, exactly like the old
    # sheet (README: "an ad-hoc job, a shop day, a reminder") — this payload
    # used to only ever look at `loads`, so a schedule_notes-only cell pushed
    # as a fully blank row (Nate, live: typed text in an empty Scheduler cell,
    # never showed up on the pushed sheet at all). Keyed the same way `loads`
    # is grouped below (truck_id, date, slot) so it drops into the same slot
    # loop as a load would.
    notes_by_key = {}
    for n in q("""
        select n.truck_id, n.scheduled_date, n.slot, n.body, n.fmt, cat.color as cat_color
        from schedule_notes n left join categories cat on cat.id = n.category_id
        where n.scheduled_date between %s and %s
    """, (dates[0], dates[-1])):
        notes_by_key[(n["truck_id"], n["scheduled_date"], n["slot"])] = n

    # Truck off for the day (Nate, 2026-09-12): a pushed slot with no real
    # load must say OFF and go red, matching the Scheduler's own offday
    # hatch (02-chips-extract.js OFFDAYS) instead of pushing a blank cell.
    off_by_key = {(o["truck_id"], o["off_date"])
                  for o in q("""select truck_id, off_date from truck_off_days
                                where off_date between %s and %s""", (dates[0], dates[-1]))}

    order_ids = sorted({oid for l in loads for oid in (l["order_ids"] or [])})
    orders = {}
    if order_ids:
        rows = q("""
            select o.id, o.kind, o.is_transfer, o.route_mode, o.solomon_order_no, o.broker_load_no, o.notes,
                   o.driver_note, o.po_number, o.delivery_number, o.pallet_count,
                   c.name as customer_name, b.name as broker_name,
                   td.name as transfer_department_name, td.color as transfer_department_color,
                   pl.name as pickup_name, pl.address as pickup_address, pl.city as pickup_city,
                   pl.state as pickup_state, pl.phone as pickup_phone, pl.map_url as pickup_map_url,
                   dl.name as delivery_name, dl.address as delivery_address, dl.city as delivery_city,
                   dl.state as delivery_state, dl.phone as delivery_phone, dl.map_url as delivery_map_url,
                   il.map_url as customer_map_url, il.notes as customer_notes,
                   il.city as cust_city, il.state as cust_state, il.forklift as cust_forklift,
                   il.timing_window as cust_timing, il.is_umatilla as cust_umatilla
            from orders o
            left join parties c on c.id = o.customer_party_id
            left join parties b on b.id = o.broker_party_id
            left join departments td on td.id = o.transfer_department_id
            left join locations pl on pl.id = o.pickup_location_id
            left join locations dl on dl.id = o.delivery_location_id
            left join lateral (
              select map_url, notes, city, state, forklift, timing_window, is_umatilla
              from locations where party_id = o.customer_party_id limit 1
            ) il on true
            where o.id = any(%s)
        """, (order_ids,))
        orders = {r["id"]: r for r in rows}

    load_ids = [l["id"] for l in loads]
    stops_by_load = {}
    if load_ids:
        stop_rows = q("""
            select s.*, loc.name, loc.address, loc.city, loc.state, loc.phone, loc.map_url
            from load_stops s left join locations loc on loc.id=s.location_id
            where s.load_id = any(%s) order by s.load_id, s.sequence
        """, (load_ids,))
        for stop in stop_rows:
            stops_by_load.setdefault(stop["load_id"], []).append(stop)

    by_truck = {}
    for l in loads:
        by_truck.setdefault(l["truck_id"], {}).setdefault(l["scheduled_date"], {})[l["slot"]] = l

    def truck_rows(t, compact=False):
        truck_loads = by_truck.get(t["truck_id"], {})
        out = []
        for dt in dates:
            day_loads = truck_loads.get(dt, {})
            for slot in range(1, 4):
                ld = day_loads.get(slot)
                row = {"date": dt.isoformat(), "slot": slot, "chip": "", "notes": "",
                       "pickup": "", "drop": "", "store_map": "", "color": None,
                       "po_number": "", "delivery_number": ""}
                oid = (ld["order_ids"][0] if ld and ld["order_ids"] else None)
                o = orders.get(oid) if oid else None
                if o:
                    route_stops = stops_by_load.get(ld["id"], []) if ld else []
                    row["chip"] = (_current_week_chip_text(o, route_stops) if compact else
                                   _driver_chip_text(o, pallets=o.get("pallet_count"),
                                                     stops=route_stops))
                    row["color"] = _chip_fill(o, t["driver_color"])
                    if not compact:
                        if o["kind"] == "external":
                            row["po_number"] = o.get("po_number") or ""
                            row["delivery_number"] = o.get("delivery_number") or ""
                            picks = [s for s in route_stops if s["stop_type"] == "pickup"]
                            drops = [s for s in route_stops if s["stop_type"] == "delivery"]
                            pick, drop = (picks[0] if picks else None), (drops[-1] if drops else None)
                            row["pickup"] = (_maps_view_link(pick["name"], pick["address"], pick["city"], pick["state"])
                                              if pick else
                                              _maps_view_link(o["pickup_name"], o["pickup_address"],
                                                              o["pickup_city"], o["pickup_state"]))
                            row["drop"] = (_maps_view_link(drop["name"], drop["address"], drop["city"], drop["state"])
                                           if drop else
                                           _maps_view_link(o["delivery_name"], o["delivery_address"],
                                                           o["delivery_city"], o["delivery_state"]))
                            # Store Map (column G) stays 07/internal-only
                            # (D112) — external's own pickup/drop links above
                            # are the D113 map convenience for external.
                        else:
                            row["store_map"] = o["customer_map_url"] or ""
                        # Two notes per order everywhere now (D140): o.notes
                        # ("Load Info") is dispatcher-private and never pushed;
                        # o.driver_note is the one thing that reaches the
                        # driver's Sheets tab. customer_notes (location-level,
                        # e.g. forklift/gate instructions) still rides along —
                        # it's not dispatcher shorthand, it's driver-relevant.
                        row["notes"] = " · ".join(x for x in
                            [o["driver_note"], o["customer_notes"]] if x)
                elif not ld:
                    if (t["truck_id"], dt) in off_by_key:
                        # The truck being off for the whole day outranks any
                        # note text that might also sit in this slot — a
                        # dispatcher needs OFF to read on every one of that
                        # day's rows, not just whichever slot has no note.
                        row["chip"], row["color"] = "OFF", TRUCK_OFF_COLOR
                        out.append(row)
                        continue
                    # No real load in this slot — fall back to a free-text
                    # schedule_notes cell, same fmt.fill-over-category color
                    # precedence the Scheduler UI itself uses (effFill,
                    # 04-views.js). Goes in `chip`, not `notes` — this text
                    # IS the cell's content, not an annotation on some load.
                    note = notes_by_key.get((t["truck_id"], dt, slot))
                    if note and note["body"]:
                        row["chip"] = note["body"]
                        fmt = note.get("fmt") or {}
                        fill = fmt.get("fill")
                        row["color"] = fill if fill else note.get("cat_color")
                out.append(row)
        return out

    drivers_out = []
    for t in trucks:
        drivers_out.append({
            "driver": t["driver_name"], "truck": t["number"], "equipment_type": t["eq"],
            "driver_color": t["driver_color"], "truck_id": t["truck_id"],
            "rows": truck_rows(t),
        })

    current_week = [{
        "header": " ".join(x for x in [t["driver_name"], t["number"], t["eq"]] if x),
        "driver": t["driver_name"], "truck": t["number"], "equipment_type": t["eq"],
        "driver_color": t["driver_color"], "truck_id": t["truck_id"],
        "rows": truck_rows(t, compact=True),
    } for t in trucks]

    return {"week_start": dates[0].isoformat(), "week_end": dates[-1].isoformat(),
            "days": len(dates), "slots_per_day": 3,
            "dates": [d.isoformat() for d in dates], "drivers": drivers_out,
            "current_week": current_week}


def api_add_driver(d):
    """Truck is the Scheduler's entity now (D32) — adding a driver no longer
    creates one. An unassigned driver is fine; assign them to a truck via
    api_assign_truck when ready."""
    return q("insert into drivers (full_name, color) values (%s,%s) returning *",
              (d["full_name"], d.get("color")), one=True)


def api_add_truck(d):
    return q("""insert into trucks (number, equipment_type, sort_order)
                values (%s, %s, (select coalesce(max(sort_order), 0) + 1 from trucks))
                returning *""", (d["number"], d.get("eq", "F")), one=True)


def api_assign_truck(d):
    """Reassign a truck to a driver (D32) — closes whichever assignment each
    of them currently holds (a truck holds one driver, a driver holds one
    truck — driver_truck_assignments already enforces this) and opens a new
    one. driver_id may be null to unassign the truck entirely."""
    truck_id, new_driver = d["truck_id"], d.get("driver_id")
    # Close out both sides' current assignments FIRST — the truck's old
    # driver and the new driver's old truck — before inserting the new row,
    # otherwise the new driver would briefly hold two open assignments and
    # trip dta_no_driver_overlap. A same-day correction (assigned today,
    # reassigned again today) is deleted outright rather than closed —
    # closing it would set effective_to before effective_from and violate
    # dta_range_valid.
    for col, val in (("truck_id", truck_id), ("driver_id", new_driver)):
        if not val:
            continue
        q(f"delete from driver_truck_assignments where {col}=%s and effective_to is null "
          f"and effective_from = current_date", (val,))
        q(f"update driver_truck_assignments set effective_to = current_date - 1 "
          f"where {col}=%s and effective_to is null", (val,))
    if new_driver:
        q("""insert into driver_truck_assignments (driver_id, truck_id, effective_from)
             values (%s,%s,current_date)""", (new_driver, truck_id))
    return {"ok": True}


def api_set_truck_driver(d):
    """Set a truck's current driver by free-text name (D45) — Nate just types
    a name in the Fleet grid; no dropdown, no separate driver roster. Finds a
    driver with that name (case-insensitive) or creates one, then assigns via
    the same close-both-sides logic as api_assign_truck. Blank name unassigns.
    (Motive ELD will drive this per-shift later — for now it's a manual set.)"""
    truck_id = d["truck_id"]
    name = (d.get("driver_name") or "").strip()
    driver_id = None
    if name:
        row = q("select id from drivers where lower(full_name) = lower(%s)", (name,), one=True)
        driver_id = row["id"] if row else q(
            "insert into drivers (full_name) values (%s) returning id", (name,), one=True)["id"]
    return api_assign_truck({"truck_id": truck_id, "driver_id": driver_id})


def api_update_row(table, rid, d):
    cols = {
        "parties": {"name", "ap_email", "phone", "manager_name", "notes", "rexius_customer_no", "sort_order"},
        "locations": {"name", "address", "city", "state", "phone", "email", "map_url",
                      "forklift", "timing_window", "is_umatilla", "standard_miles",
                      "miles_from_umatilla", "notes", "appointment_note", "category_id"},
        "drivers": {"full_name", "active", "color"},
        "trucks": {"number", "equipment_type", "active", "sort_order"},
        "departments": {"name", "sort_order", "color"},
    }.get(table)
    if not cols:
        raise ValueError("table not editable")
    if table == "locations" and "category_id" in d:
        d = dict(d)
        d["timing_window"], d["is_umatilla"] = _time_window_parts(d.get("category_id"))
    sets, vals = [], []
    for k, v in d.items():
        if k in cols:
            sets.append(f"{k} = %s")
            vals.append(v if v != "" else None)
    if not sets:
        return {"ok": True}
    vals.append(rid)
    return q(f"update {table} set {', '.join(sets)} where id=%s returning *", vals, one=True)


# ── Custom columns / spreadsheet freedom on the Database grids (D47) ──────────
# Each grid's custom values live in the `custom` JSONB on one canonical table.
GRID_TABLE = {"bagger": "parties", "external": "parties",
              "pickdrop": "locations", "fleet": "trucks", "departments": "departments"}
CUSTOM_TABLES = {"parties", "locations", "trucks", "departments"}


def api_update_custom(d):
    """Write one custom-column value into a row's `custom` JSONB (D47). Empty
    value removes the key so the bag stays clean. Everything is stored as a JSON
    string; the client renders it by the column's declared type."""
    table = d["table"]
    if table not in CUSTOM_TABLES:
        raise ValueError("table has no custom columns")
    val = d.get("value")
    val = None if val in (None, "") else str(val)
    return q(f"""update {table} set custom =
                   case when %(v)s::text is null then custom - %(k)s::text
                        else custom || jsonb_build_object(%(k)s::text, %(v)s::text) end
                 where id = %(id)s returning id, custom""",
             {"v": val, "k": d["key"], "id": d["id"]}, one=True)


def api_grid_column(d):
    """Add a custom column to a grid — label + type (+ dropdown options)."""
    grid, label = d["grid"], (d.get("label") or "").strip()
    if grid not in GRID_TABLE:
        raise ValueError("unknown grid")
    if not label:
        raise ValueError("Column name is required")
    base = "c_" + (re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")[:24] or "col")
    used = {r["key"] for r in q("select key from grid_columns where grid=%s", (grid,))}
    key, n = base, 2
    while key in used:
        key, n = f"{base}_{n}", n + 1
    # Metadata fields and legacy JSON custom columns now share one visual order
    # in the Database grid (D96), so a new column must follow both sets.
    slug = "brokers" if grid == "external" else grid
    nxt = q("""select greatest(
                 coalesce((select max(sort_order) from grid_columns where grid=%s), 0),
                 coalesce((select max(f.sort_order) from fields f join entities e on e.id=f.entity_id
                           where e.slug=%s), 0)
               ) + 1 as n""", (grid, slug), one=True)["n"]
    return q("""insert into grid_columns (grid, key, label, type, options, sort_order)
                values (%s,%s,%s,%s,%s,%s) returning *""",
             (grid, key, label, d.get("type", "text"),
              json.dumps(d.get("options") or []), nxt), one=True)


def api_grid_column_update(d):
    allowed = {"label", "type", "options", "sort_order", "width"}
    sets, vals = [], []
    for k, v in d.items():
        if k in allowed:
            sets.append(f"{k} = %s")
            vals.append(json.dumps(v) if k == "options" else v)
    if not sets:
        return {"ok": True}
    vals.append(d["id"])
    return q(f"update grid_columns set {', '.join(sets)} where id=%s returning *", vals, one=True)


def api_grid_column_delete(d):
    col = q("select grid, key from grid_columns where id=%s", (d["id"],), one=True)
    if not col:
        raise ValueError("column not found")
    q(f"update {GRID_TABLE[col['grid']]} set custom = custom - %s", (col["key"],))
    q("delete from grid_columns where id=%s", (d["id"],))
    return {"ok": True}


def api_entity_update(d):
    """Rename / reorder a database (metadata core, D85). Label-level only —
    entity `slug` and `backing_table` stay stable so wiring never breaks."""
    allowed = {"name", "sort_order", "icon"}
    sets, vals = [], []
    for k in allowed:
        if k in d:
            sets.append(f"{k} = %s"); vals.append(d[k])
    if not sets:
        return q("select * from entities where id=%s", (d["id"],), one=True)
    vals.append(d["id"])
    return q(f"update entities set {', '.join(sets)} where id=%s returning *", vals, one=True)


def api_field_update(d):
    """Update one field's metadata (D85) — rename (label/key), resize (width),
    reorder (sort_order), hide, retype, options, or conditional-format rules. A
    field's id is the stable wiring anchor, so renaming never breaks references.
    `locked` (report-critical typed fields) can't be retyped."""
    fid = d["id"]
    cur = q("select locked, storage from fields where id=%s", (fid,), one=True)
    if not cur:
        raise ValueError("field not found")
    allowed = {"label", "key", "width", "sort_order", "hidden", "type", "options", "conditional_format"}
    if cur["locked"]:
        allowed -= {"type", "key"}
    sets, vals = [], []
    for k in allowed:
        if k in d:
            if k in ("options", "conditional_format"):
                sets.append(f"{k} = %s::jsonb"); vals.append(json.dumps(d[k]))
            else:
                sets.append(f"{k} = %s"); vals.append(d[k])
    if not sets:
        return q("select * from fields where id=%s", (fid,), one=True)
    vals.append(fid)
    return q(f"update fields set {', '.join(sets)} where id=%s returning *", vals, one=True)


_IDENT_RE = re.compile(r"^[a-z_][a-z0-9_]*$")


def api_field_rename_option(d):
    """Renaming one of a select field's options (D146) should carry every row
    still holding the old text along with it — Nate: 'when i update the
    dropdowns they need to update in the database.' The dropdown-options
    editor only ever calls this for an in-place edit of an existing row
    (client-side: the option's original value changed, not a delete+add), so
    every call here really is a rename, not a fresh option nobody's used
    yet. table/col come from the field's own storage, never straight from
    the request body, but are still checked against a real identifier
    shape before going into the query."""
    fid, frm, to = d["id"], d.get("from") or "", d.get("to") or ""
    if not frm or not to or frm == to:
        return {"updated": 0}
    field = q("select storage from fields where id=%s", (fid,), one=True)
    if not field or not (field["storage"] or "").startswith("column:"):
        raise ValueError("field not found")
    table, col = field["storage"][7:].split(".")
    if table not in ("parties", "locations", "trucks", "drivers", "departments") \
            or not _IDENT_RE.match(col):
        raise ValueError("field isn't a renameable column")
    rows = q(f"update {table} set {col}=%s where {col}=%s returning id", (to, frm))
    return {"updated": len(rows)}


def api_entity_create(d):
    """Create a custom database (D85 Phase 2) — an admin-defined table with no
    backing SQL table of its own; its rows live in `records`. Builtins are
    seeded once by migration and never created here."""
    name = (d.get("name") or "").strip()
    if not name:
        raise ValueError("Database name is required")
    nxt = q("select coalesce(max(sort_order),0)+1 as n from entities", one=True)["n"]
    return q("""insert into entities (name, kind, sort_order) values (%s,'custom',%s)
                returning *""", (name, nxt), one=True)


def api_entity_delete(d):
    """Delete a custom database and everything in it (fields/records cascade
    via FK). Builtins can't be deleted — their backing tables are real data."""
    ent = q("select kind from entities where id=%s", (d["id"],), one=True)
    if not ent:
        raise ValueError("database not found")
    if ent["kind"] != "custom":
        raise ValueError("built-in databases can't be deleted")
    q("delete from entities where id=%s", (d["id"],))
    return {"ok": True}


def api_field_create(d):
    """Add a field to a custom database (D85 Phase 2). Only custom entities —
    builtins' fields are seeded by migration and typed to a real column."""
    ent = q("select kind from entities where id=%s", (d["entity_id"],), one=True)
    if not ent:
        raise ValueError("database not found")
    if ent["kind"] != "custom":
        raise ValueError("can't add fields to a built-in database this way")
    label = (d.get("label") or "").strip()
    if not label:
        raise ValueError("Field name is required")
    base = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")[:24] or "field"
    used = {r["key"] for r in q("select key from fields where entity_id=%s", (d["entity_id"],))}
    key, n = base, 2
    while key in used:
        key, n = f"{base}_{n}", n + 1
    nxt = q("select coalesce(max(sort_order),0)+1 as n from fields where entity_id=%s",
            (d["entity_id"],), one=True)["n"]
    return q("""insert into fields (entity_id, key, label, type, options, storage, sort_order)
                values (%s,%s,%s,%s,%s,'json',%s) returning *""",
             (d["entity_id"], key, label, d.get("type", "text"),
              json.dumps(d.get("options") or []), nxt), one=True)


def api_field_delete(d):
    """Delete a custom field. Builtins' fields are wiring anchors — can't be
    deleted, only hidden (`fields.hidden` via api_field_update)."""
    fld = q("select locked, storage from fields where id=%s", (d["id"],), one=True)
    if not fld:
        raise ValueError("field not found")
    if fld["storage"] != "json":
        raise ValueError("built-in fields can't be deleted — hide them instead")
    q("delete from fields where id=%s", (d["id"],))
    return {"ok": True}


def api_record_create(d):
    """Add a blank row to a custom database."""
    nxt = q("select coalesce(max(sort_order),0)+1 as n from records where entity_id=%s",
            (d["entity_id"],), one=True)["n"]
    return q("""insert into records (entity_id, data, sort_order) values (%s,'{}'::jsonb,%s)
                returning *""", (d["entity_id"], nxt), one=True)


def api_record_update(d):
    """Write one field's value into a record's `data` JSONB, keyed by the
    field's stable id (so renaming a field never orphans existing data).
    Empty value removes the key, same "empty cell" convention as everywhere
    else in the app."""
    val = d.get("value")
    val = None if val in (None, "") else str(val)
    return q("""update records set data =
                  case when %(v)s::text is null then data - %(k)s::text
                       else data || jsonb_build_object(%(k)s::text, %(v)s::text) end
                where id = %(id)s returning *""",
             {"v": val, "k": d["field_id"], "id": d["id"]}, one=True)


def api_record_delete(d):
    q("delete from records where id=%s", (d["id"],))
    return {"ok": True}


def api_grid_row_reorder(d):
    """Persist a complete row order for one Database grid.

    The client sends the full visible population, not a partial selection. We
    verify that population before writing so a stale browser cannot silently
    drop rows from the saved order.
    """
    grid = (d.get("grid") or "").strip()
    raw_ids = d.get("row_ids") or []
    if not isinstance(raw_ids, list) or not raw_ids:
        raise ValueError("row_ids must contain the database rows")
    try:
        row_ids = [uuid.UUID(str(rid)) for rid in raw_ids]
    except (ValueError, TypeError):
        raise ValueError("invalid row id")
    if len(row_ids) != len(set(row_ids)):
        raise ValueError("row order contains duplicates")

    archived_grid = grid in ("bagger", "external", "departments")
    archived = bool(d.get("archived_view"))
    if grid == "bagger":
        current = q("""select id from parties
                     where is_customer and (customer_archived_at is not null)=%s""",
                    (archived,))
    elif grid == "external":
        current = q("""select id from parties
                     where is_broker and (broker_archived_at is not null)=%s""",
                    (archived,))
    elif grid == "pickdrop":
        current = q("select id from locations")
    elif grid == "fleet":
        current = q("select id from trucks where active")
    elif grid == "departments":
        current = q("select id from departments where (archived_at is not null)=%s",
                    (archived,))
    elif grid.startswith("custom:"):
        try:
            entity_id = uuid.UUID(grid[7:])
        except ValueError:
            raise ValueError("invalid custom database")
        current = q("select id from records where entity_id=%s", (entity_id,))
    else:
        raise ValueError("unknown grid")

    current_ids = {r["id"] for r in current}
    if set(row_ids) != current_ids:
        raise ValueError("database rows changed; reload and try again")

    conn = db()
    with conn.transaction():
        with conn.cursor() as cur:
            if archived_grid:
                # Active and archived rows are two views of one directory.
                # Reordering either view must leave the other view's saved
                # positions intact.
                cur.execute("delete from grid_row_orders where grid=%s and row_id=any(%s)",
                            (grid, list(current_ids)))
            else:
                cur.execute("delete from grid_row_orders where grid=%s", (grid,))
            cur.executemany(
                "insert into grid_row_orders (grid, row_id, sort_order) values (%s,%s,%s)",
                [(grid, rid, (i + 1) * 10) for i, rid in enumerate(row_ids)],
            )
    return {"ok": True, "count": len(row_ids)}


def api_grid_row(d):
    """Add a blank row to a grid — a placeholder Nate fills in inline (D47)."""
    grid = d["grid"]
    if grid == "bagger":
        p = q("insert into parties (name, is_customer) values ('New customer', true) returning *", one=True)
        q("insert into locations (party_id, name) values (%s, 'New customer')", (p["id"],))
        return p
    if grid == "external":
        return q("""insert into parties (name, is_customer, is_broker)
                    values ('New customer', true, true) returning *""", one=True)
    if grid == "pickdrop":
        return q("insert into locations (name) values ('New location') returning *", one=True)
    if grid == "fleet":
        return q("insert into trucks (number, equipment_type) values (%s, 'F') returning *",
                 ("NEW-" + str(uuid.uuid4())[:4],), one=True)
    if grid == "departments":
        return q("insert into departments (name) values ('New department') returning *", one=True)
    raise ValueError("unknown grid")


def api_grid_row_delete(d):
    """Delete a grid row, blocking (with a clear message) when it's referenced
    by real orders/loads so history stays intact (D47)."""
    grid, rid = d["grid"], d["id"]
    if grid in ("bagger", "external", "departments"):
        raise ValueError("This database uses Archive Selected instead of delete.")
    if grid == "pickdrop":
        n = q("""select count(*) as n from orders
                 where pickup_location_id=%s or delivery_location_id=%s""", (rid, rid), one=True)["n"]
        if n:
            raise ValueError(f"Can't delete — {n} order(s) reference this address.")
        q("delete from locations where id=%s", (rid,))
    elif grid == "fleet":
        n = q("select count(*) as n from loads where truck_id=%s", (rid,), one=True)["n"]
        if n:
            raise ValueError(f"Can't delete — {n} load(s) reference this truck.")
        q("delete from driver_truck_assignments where truck_id=%s", (rid,))
        q("delete from trucks where id=%s", (rid,))
    elif grid == "departments":
        n = q("select count(*) as n from orders where transfer_department_id=%s", (rid,), one=True)["n"]
        if n:
            raise ValueError(f"Can't delete — {n} transfer order(s) reference this department.")
        q("delete from departments where id=%s", (rid,))
    else:
        raise ValueError("unknown grid")
    return {"ok": True}


def api_database_archive(d):
    """Archive/restore one role-specific directory row without breaking history."""
    grid, rid = d["grid"], d["id"]
    archived = bool(d.get("archived", True))
    if grid == "bagger":
        row = q("select id from parties where id=%s and is_customer", (rid,), one=True)
        table, field, label = "parties", "customer_archived_at", "Bagger Customer"
    elif grid == "external":
        row = q("select id from parties where id=%s and is_broker", (rid,), one=True)
        table, field, label = "parties", "broker_archived_at", "External Customer"
    elif grid == "departments":
        row = q("select id from departments where id=%s", (rid,), one=True)
        table, field, label = "departments", "archived_at", "Internal Freight department"
    else:
        raise ValueError("This database does not support archiving.")
    if not row:
        raise ValueError(label + " not found.")
    return q(f"""update {table}
                 set {field}=case when %s then coalesce({field}, now()) else null end
                 where id=%s returning id, {field}""", (archived, rid), one=True)


# ── Local-auth permission table (D125) ─────────────────────────────────────
# Maps each mutating route to the (section, sub) it needs `edit` on. A path
# NOT in this table fails closed — admin-only — so a route added later and
# forgotten here doesn't silently become an open door. A handful of generic
# Database endpoints don't know which grid they're touching from the path
# alone (per-grid granularity was a deliberate choice, D125) — those entries
# are resolver functions doing one extra lookup, mirroring the client's own
# gridKey()/entityForGrid() routing (04-views.js).
def _order_kind_sub(order_id):
    row = q("select kind, is_transfer from orders where id=%s", (order_id,), one=True)
    if not row:
        return "ext"
    if row["is_transfer"]:
        return "xfer"
    return "int" if row["kind"] == "internal" else "ext"


def _database_sub_for_table(table, row_id):
    if table in ("trucks", "drivers"):
        return "fleet"
    if table == "locations":
        return "pickdrop"
    if table == "departments":
        return "departments"
    if table == "parties":
        row = q("select is_broker from parties where id=%s", (row_id,), one=True)
        return "brokers" if row and row["is_broker"] else "bagger"
    return None


def _record_entity_sub(record_id):
    row = q("select entity_id from records where id=%s", (record_id,), one=True)
    return "custom:" + str(row["entity_id"]) if row else None


def _grid_sub(grid):
    return "brokers" if grid == "external" else grid


API_PERMISSIONS = {
    "/api/order":            lambda d: ("orders", "int" if d.get("kind") == "internal" else "ext"),
    "/api/order/ingest":     lambda d: ("orders", "int" if d.get("kind") == "internal" else "ext"),
    "/api/internal-order":   ("orders", "int"),
    "/api/order/transfer":   ("orders", "xfer"),
    "/api/order/update":     lambda d: ("orders", _order_kind_sub(d["id"])),
    "/api/order/route":      ("orders", "ext"),
    "/api/order/cancel":     lambda d: ("orders", _order_kind_sub(d["id"])),
    "/api/order/delete":     lambda d: ("orders", _order_kind_sub(d["id"])),
    "/api/order/copy":       lambda d: ("orders", _order_kind_sub(d["order_id"])),
    "/api/order/bill":       ("billing", "bill"),
    "/api/document":         ("billing", "bill"),
    "/api/document/attach":  ("billing", "bill"),
    "/api/document/delete":  ("billing", "bill"),
    "/api/create-draft":     ("billing", "bill"),
    "/api/schedule":         ("dispatch", "sched"),
    "/api/load/carrier":     ("dispatch", "sched"),
    "/api/cell/color":       ("dispatch", "sched"),
    "/api/cell/format":      ("dispatch", "sched"),
    "/api/truck/off":        ("dispatch", "sched"),
    "/api/unschedule":       ("dispatch", "sched"),
    "/api/day-note":         ("dispatch", "sched"),
    "/api/freight":          lambda d: ("orders", _order_kind_sub(d["order_id"])),
    "/api/driver":           ("database", "fleet"),
    "/api/truck":            ("database", "fleet"),
    "/api/assign-truck":     ("database", "fleet"),
    "/api/truck/driver":     ("database", "fleet"),
    "/api/location":         ("database", "pickdrop"),
    "/api/department":       ("database", "departments"),
    "/api/customer":         lambda d: ("database", "brokers" if d.get("kind") == "external" else "bagger"),
    "/api/row":              lambda d: ("database", _database_sub_for_table(d["table"], d["id"])),
    "/api/row/custom":       lambda d: ("database", _database_sub_for_table(d["table"], d["id"])),
    "/api/grid/cell-fmt":    lambda d: ("database", _database_sub_for_table(d["table"], d["id"])),
    "/api/grid/row":         lambda d: ("database", _grid_sub(d["grid"])),
    "/api/grid/row/delete":  lambda d: ("database", _grid_sub(d["grid"])),
    "/api/database/archive": lambda d: ("database", _grid_sub(d["grid"])),
    "/api/grid/row/reorder": lambda d: ("database", _grid_sub(d.get("grid") or "")),
    "/api/record":           lambda d: ("database", "custom:" + str(d["entity_id"])),
    "/api/record/update":    lambda d: ("database", _record_entity_sub(d["id"])),
    "/api/record/delete":    lambda d: ("database", _record_entity_sub(d["id"])),
    "/api/sheet/cell":       lambda d: ("database", "sheet:" + str(d["sheet_id"])),
}
# Deliberately admin-only regardless of any grant (not in the table above):
# /api/motive/sync-miles, /api/sync-delivery-dates (bulk, cross-order),
# /api/internal-freight-rate and /api/internal-freight-rate/calculate (D170 —
# a global rate setting + a bulk cross-order fill, not per-user data),
# /api/category (a global color legend, not per-user data), /api/sheet and
# the /api/entity*, /api/field*, /api/grid/column* families (structural —
# renaming a field or adding a database, a different blast radius than
# editing a row), and /api/sheets/push-driver-tabs (writes the live mirror
# sheet 8 tablets read in the field, D111) — sensible defaults, Nate's call
# to loosen any of them later.


def _check_route_permission(path, d, user):
    entry = API_PERMISSIONS.get(path)
    if entry is None:
        return False
    section, sub = entry(d) if callable(entry) else entry
    if not sub:
        return False
    grants = {(g["section"], g["sub"]): g["can_edit"] for g in user["grants"]}
    return grants.get((section, sub), False)


def _filter_scheduler_by_window(payload, view_start, view_end):
    """The one deliberate hard-boundary exception (D125) — everywhere else
    this phase is UI-hide + server-side edit-block only, but a restricted
    user's Scheduler date window is filtered out of the read itself."""
    def in_window(ds):
        if ds is None:
            return True
        if view_start and str(ds) < str(view_start):
            return False
        if view_end and str(ds) > str(view_end):
            return False
        return True
    payload["loads"] = [l for l in payload["loads"] if in_window(l.get("scheduled_date"))]
    payload["notes"] = [n for n in payload["notes"] if in_window(n.get("scheduled_date"))]


# ── Admin history (D131) ────────────────────────────────────────────────────
# The browser's HIST stack remains the fast, same-session Undo/Redo mechanism.
# This is the durable shared ledger: one event per request, populated by the
# database triggers installed in 20260819000007_admin_history.sql.
HISTORY_SKIP_PATHS = {
    "/api/local-login", "/api/local-logout",
    "/api/history/preview", "/api/history/revert",
}
HISTORY_EXTERNAL_PATHS = {"/api/sheets/push-driver-tabs", "/api/create-draft"}

HISTORY_LABELS = {
    "/api/order": "Create order", "/api/order/ingest": "Ingest order",
    "/api/internal-order": "Add bag order", "/api/order/transfer": "Add internal freight order",
    "/api/order/update": "Edit order", "/api/order/route": "Edit order route",
    "/api/order/cancel": "Cancel order", "/api/order/delete": "Delete order",
    "/api/order/copy": "Copy order", "/api/order/bill": "Change billing status",
    "/api/document": "Save document", "/api/document/attach": "Attach document",
    "/api/document/delete": "Delete document", "/api/schedule": "Edit schedule",
    "/api/load/carrier": "Schedule outside carrier", "/api/unschedule": "Unschedule load",
    "/api/cell/color": "Color scheduler cell",
    "/api/cell/format": "Format scheduler cell", "/api/truck/off": "Change truck availability",
    "/api/day-note": "Edit day note",
    "/api/freight": "Edit freight", "/api/motive/sync-miles": "Sync Motive mileage",
    "/api/internal-freight-rate": "Change internal freight rate",
    "/api/internal-freight-rate/calculate": "Calculate internal freight charges",
    "/api/sync-delivery-dates": "Sync delivery dates", "/api/driver": "Add driver",
    "/api/truck": "Add truck", "/api/assign-truck": "Assign truck",
    "/api/truck/driver": "Change truck driver", "/api/location": "Add location",
    "/api/department": "Add department", "/api/customer": "Add customer",
    "/api/category": "Edit scheduler category", "/api/sheet": "Change sheet",
    "/api/sheet/cell": "Edit sheet cell", "/api/grid/cell-fmt": "Format database cell",
    "/api/row": "Edit database row", "/api/row/custom": "Edit custom field",
    "/api/grid/column": "Add database column", "/api/grid/column/update": "Edit database column",
    "/api/grid/column/delete": "Delete database column", "/api/entity": "Add database",
    "/api/entity/update": "Edit database", "/api/entity/delete": "Delete database",
    "/api/field": "Add database field", "/api/field/update": "Edit database field",
    "/api/field/rename-option": "Rename dropdown option",
    "/api/field/delete": "Delete database field", "/api/record": "Add database record",
    "/api/record/update": "Edit database record", "/api/record/delete": "Delete database record",
    "/api/grid/row": "Add database row", "/api/grid/row/delete": "Delete database row",
    "/api/database/archive": "Archive or restore database row",
    "/api/grid/row/reorder": "Reorder database rows",
    "/api/admin/grants": "Change user permissions", "/api/admin/view-window": "Change user date range",
    "/api/admin/user/delete": "Delete user", "/api/admin/order-number-settings": "Change order numbering",
    "/api/sheets/push-driver-tabs": "Push driver tabs",
    "/api/create-draft": "Create Outlook draft",
}


def _history_admin():
    user = current_local_user()
    return bool(user and user.get("is_admin"))


def _history_scope(path, body):
    entry = API_PERMISSIONS.get(path)
    if entry is None:
        if path.startswith("/api/admin/"):
            return "settings", "admin"
        return None, None
    try:
        return entry(body) if callable(entry) else entry
    except Exception:
        return None, None


def _history_label(path, body):
    label = HISTORY_LABELS.get(path, path.rsplit("/", 1)[-1].replace("-", " ").title())
    # Add the most useful identifier without putting entire request bodies or
    # document contents into event metadata.
    ident = body.get("solomon_order_no") or body.get("broker_load_no")
    if ident:
        label += " " + str(ident)
    return label


def _history_create_event(path, body, *, label=None, action_key=None,
                          reversible=True, external_effect=False, metadata=None):
    user = current_local_user()
    actor_id = user.get("id") if user else None
    actor_name = user.get("username") if user else "System"
    section, sub = _history_scope(path, body)
    row = q("""
        insert into audit_events
          (actor_user_id, actor_name, route, action_key, label, section, sub,
           reversible, external_effect, metadata)
        values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        returning id, sequence
    """, (actor_id, actor_name, path, action_key or path, label or _history_label(path, body),
          section, sub, reversible, external_effect, Jsonb(metadata or {})), one=True)
    q("select set_config('dept12.history_event_id', %s, false)", (str(row["id"]),))
    return row


def _history_finish_event(event_id, metadata=None):
    q("""update audit_events
         set completed_at=now(), metadata=metadata || %s
         where id=%s""", (Jsonb(metadata or {}), event_id))


def _history_clear_context():
    q("select set_config('dept12.history_event_id', '', false)")


HISTORY_RETENTION_DAYS = 14


def _history_purge_old():
    """D168: audit evidence older than HISTORY_RETENTION_DAYS is deleted, not
    just hidden — Nate's gut number from D133 ("~1 week") settled at 14 days.
    This is a real delete of audit_events/audit_changes, distinct from D131's
    "never update/delete audit evidence" rule, which is about not rewriting
    history during a revert, not about retention. audit_changes.event_id is
    ON DELETE RESTRICT, so children go first; reverts_event_id/
    reverted_by_event_id/superseded_by_event_id are ON DELETE SET NULL, so a
    revert chain whose root ages out just loses that link, it doesn't block
    the purge or corrupt a still-recent tip."""
    old = q("""select id from audit_events
               where occurred_at < now() - interval '%s days'""" % HISTORY_RETENTION_DAYS)
    if not old:
        return 0
    ids = [r["id"] for r in old]
    q("delete from audit_changes where event_id = any(%s)", (ids,))
    q("delete from audit_events where id = any(%s)", (ids,))
    return len(ids)


def _history_purge_loop():
    while True:
        try:
            n = _history_purge_old()
            if n:
                print(f"  history: purged {n} event(s) older than {HISTORY_RETENTION_DAYS} days")
        except Exception as e:
            print(f"  history: purge failed: {e}")
        time.sleep(24 * 60 * 60)


def _history_event_rows(limit=60, before_sequence=None):
    params = []
    where = "where completed_at is not null and (change_count > 0 or external_effect)"
    if before_sequence is not None:
        where += " and sequence < %s"
        params.append(before_sequence)
    params.append(max(1, min(int(limit), 200)))
    events = q(f"""
        select id, sequence, occurred_at, completed_at, actor_user_id, actor_name,
               route, action_key, label, section, sub, reversible, external_effect,
               change_count, affected_tables, metadata, reverts_event_id,
               reverted_by_event_id, superseded_by_event_id
        from audit_events {where}
        order by sequence desc limit %s
    """, tuple(params))
    ids = [e["id"] for e in events]
    changes = q("""
        select id, event_id, change_sequence, table_name, operation, primary_key,
               changed_fields, before_data, after_data
        from audit_changes where event_id = any(%s)
        order by event_id, change_sequence
    """, (ids,)) if ids else []
    by_event = {}
    for change in changes:
        # The immutable tables retain complete row snapshots. The timeline only
        # needs changed values for UPDATE and a primary key for create/delete;
        # pruning here prevents a 100-event panel from shipping large custom
        # JSON/document metadata repeatedly.
        if change["operation"] == "UPDATE":
            fields = change["changed_fields"]
            change["before_data"] = {f: change["before_data"].get(f) for f in fields}
            change["after_data"] = {f: change["after_data"].get(f) for f in fields}
        else:
            change["before_data"] = None
            change["after_data"] = None
        by_event.setdefault(change["event_id"], []).append(change)
    for event in events:
        event["changes"] = by_event.get(event["id"], [])
    return events


def _history_target_event(target_event_id):
    target = q("""select * from audit_events
                  where id=%s and completed_at is not null
                    and (change_count > 0 or external_effect)""", (target_event_id,), one=True)
    if not target:
        raise ValueError("History action not found.")
    return target


def _history_changes(event_ids):
    if not event_ids:
        return []
    return q("""select * from audit_changes where event_id = any(%s)
                order by change_sequence desc""", (event_ids,))


def api_history_preview(body):
    target = _history_target_event(body.get("event_id"))
    changes = _history_changes([target["id"]])
    irreversible = [target] if (target["external_effect"] or not target["reversible"]) else []
    baseline = q("""select coalesce(max(sequence), 0) as sequence from audit_events
                    where completed_at is not null and (change_count > 0 or external_effect)""", one=True)["sequence"]
    action_available = (bool(target["reversible"]) and not target["reverted_by_event_id"])
    can_apply = bool(changes) and action_available
    return {
        "target": target, "events": [target], "change_count": len(changes),
        "irreversible": irreversible, "baseline_sequence": baseline, "can_apply": can_apply,
    }


def _history_column_info(schema_name, table_name):
    return q("""select column_name, data_type, is_generated, is_identity
                from information_schema.columns
                where table_schema=%s and table_name=%s order by ordinal_position""",
             (schema_name, table_name))


def _history_param(value, data_type):
    return Jsonb(value) if data_type in ("json", "jsonb") and value is not None else value


def _history_current_row(change):
    pk = change["primary_key"]
    where = sql.SQL(" and ").join(
        sql.SQL("{} = %s").format(sql.Identifier(k)) for k in pk
    )
    stmt = sql.SQL("select to_jsonb(t) as row_data from {}.{} t where {}").format(
        sql.Identifier(change["table_schema"]), sql.Identifier(change["table_name"]), where)
    return q(stmt, tuple(pk.values()), one=True)


def _history_without_mechanical(data):
    if data is None:
        return None
    return {k: v for k, v in data.items() if k != "updated_at"}


def _history_apply_inverse(change):
    current_row = _history_current_row(change)
    current = current_row["row_data"] if current_row else None
    operation = change["operation"]
    expected = change["after_data"]
    target = change["before_data"]
    pk = change["primary_key"]

    if operation == "UPDATE":
        if current is None:
            raise ValueError(f'{change["table_name"]} row no longer exists')
        conflicts = [f for f in change["changed_fields"]
                     if current.get(f) != expected.get(f)]
        if conflicts:
            raise ValueError(f'{change["table_name"]} changed again in: {", ".join(conflicts)}')
        info = {c["column_name"]: c for c in _history_column_info(change["table_schema"], change["table_name"])}
        fields = [f for f in change["changed_fields"]
                  if f not in pk and f != "updated_at" and f in info and info[f]["is_generated"] == "NEVER"]
        if not fields:
            return
        sets = sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(f)) for f in fields)
        where = sql.SQL(" and ").join(sql.SQL("{} = %s").format(sql.Identifier(k)) for k in pk)
        stmt = sql.SQL("update {}.{} set {} where {}").format(
            sql.Identifier(change["table_schema"]), sql.Identifier(change["table_name"]), sets, where)
        vals = [_history_param(target.get(f), info[f]["data_type"]) for f in fields] + list(pk.values())
        q(stmt, tuple(vals))
        return

    if operation == "INSERT":
        if current is None:
            raise ValueError(f'{change["table_name"]} row was already removed')
        if _history_without_mechanical(current) != _history_without_mechanical(expected):
            raise ValueError(f'{change["table_name"]} row changed after it was created')
        where = sql.SQL(" and ").join(sql.SQL("{} = %s").format(sql.Identifier(k)) for k in pk)
        stmt = sql.SQL("delete from {}.{} where {}").format(
            sql.Identifier(change["table_schema"]), sql.Identifier(change["table_name"]), where)
        q(stmt, tuple(pk.values()))
        return

    if operation == "DELETE":
        if current is not None:
            raise ValueError(f'{change["table_name"]} primary key is in use again')
        columns = [c for c in _history_column_info(change["table_schema"], change["table_name"])
                   if c["is_generated"] == "NEVER" and c["is_identity"] == "NO"
                   and c["column_name"] in target]
        names = [c["column_name"] for c in columns]
        stmt = sql.SQL("insert into {}.{} ({}) values ({})").format(
            sql.Identifier(change["table_schema"]), sql.Identifier(change["table_name"]),
            sql.SQL(", ").join(map(sql.Identifier, names)),
            sql.SQL(", ").join(sql.Placeholder() for _ in names))
        q(stmt, tuple(_history_param(target.get(c["column_name"]), c["data_type"]) for c in columns))
        return

    raise ValueError("Unsupported historical change.")


def api_history_revert(body):
    target = _history_target_event(body.get("event_id"))
    latest = q("""select coalesce(max(sequence), 0) as sequence from audit_events
                  where completed_at is not null and (change_count > 0 or external_effect)""", one=True)["sequence"]
    if int(body.get("baseline_sequence") or -1) != latest:
        raise ValueError("History changed after the preview. Review the revert again.")
    if not target["reversible"] or target["reverted_by_event_id"]:
        raise ValueError("That action cannot be reversed.")

    changes = _history_changes([target["id"]])
    if not changes:
        raise ValueError("There are no reversible database changes in that action.")

    # FK-safe application order (D250, found live reverting a drag that both
    # deleted an old loads/load_orders pair and inserted a new one for the
    # same order in one request — moving a load between two cells always
    # shapes an event this way, not just the new drag-onto-a-note case).
    # _history_changes fetches DESC (most recent first), which is correct on
    # its own for undoing a single chain of dependent creates, but breaks
    # here: undoing the DELETEs by re-inserting in that same DESC order asks
    # to recreate a child row (load_orders) before the parent row (loads) it
    # references exists again, since the parent's original delete has a
    # LOWER change_sequence than its cascaded child's. Undo every INSERT (a
    # delete) first, most-recent-first — safe because a row created later in
    # the same event is never a dependency of one created earlier; then undo
    # every DELETE (a re-insert) in original chronological order, so a
    # parent row is recreated before any child that references it; updates
    # don't have this ordering concern.
    inserts_undo = [c for c in changes if c["operation"] == "INSERT"]
    deletes_undo = [c for c in reversed(changes) if c["operation"] == "DELETE"]
    updates_undo = [c for c in changes if c["operation"] == "UPDATE"]
    ordered_changes = inserts_undo + deletes_undo + updates_undo

    history_event = _history_create_event(
        "/api/history/revert", body, label="Reverted: " + target["label"],
        action_key="history.action", metadata={"target_event_id": str(target["id"])})
    try:
        with db().transaction():
            for change in ordered_changes:
                _history_apply_inverse(change)
            q("update audit_events set reverted_by_event_id=%s where id=%s",
              (history_event["id"], target["id"]))
            q("update audit_events set reverts_event_id=%s where id=%s",
              (target["id"], history_event["id"]))
            _history_finish_event(history_event["id"], {"reversed_change_count": len(changes)})
    finally:
        _history_clear_context()
    return {"ok": True, "event_id": history_event["id"], "change_count": len(changes)}


class Handler(BaseHTTPRequestHandler):
    server_version = "Dept12/0.1"

    # ── plumbing ──
    def _send(self, code, body, ctype="application/json", set_cookie=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, default=jsonable).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        if set_cookie:
            self.send_header("Set-Cookie", set_cookie)
        # Static assets (HTML/CSS/JS) must never be served stale — a cached
        # app.css/app.js after an update leaves features half-broken (e.g. the
        # document viewer with no styles looked like "nothing pops up"). D51.
        base_ctype = ctype.split(";")[0]
        if base_ctype in ("text/html", "text/css", "application/javascript", "text/javascript"):
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        elif urlparse(self.path).path.startswith("/api/"):
            # Authenticated JSON, reports, and documents must not land in a
            # shared browser/proxy cache on the hosted app.
            self.send_header("Cache-Control", "no-store")
        elif base_ctype.startswith("image/") or base_ctype in ("font/woff", "font/woff2"):
            # Static images/fonts (the header logo, icons) never changed
            # without also changing filename in this app, and were getting NO
            # cache header at all — every reference re-fetched fresh over the
            # network with no validator, which is what turned a same-page
            # logo request into a real repeated round-trip capable of racing
            # a navigation and showing up as a spurious net::ERR_CONNECTION_
            # RESET in the console (D238, Nate: "fix that harmless logo error
            # its annoying"). A day is plenty for a dev server; revisit if
            # these ever need to change in place without a filename bump.
            self.send_header("Cache-Control", "public, max-age=86400")
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n)) if n else {}

    def _cookie_value(self, name):
        """Read the chunked browser auth cookie used by both localhost ports."""
        from urllib.parse import unquote
        raw = self.headers.get("Cookie", "")
        values = {}
        for part in raw.split(";"):
            if "=" not in part:
                continue
            key, value = part.strip().split("=", 1)
            values[key] = unquote(value)
        try:
            count = int(values.get(name + ".count", "0"))
        except ValueError:
            count = 0
        if count:
            return "".join(values.get(f"{name}.{i}", "") for i in range(count))
        return values.get(name)

    def _access_token(self):
        auth = self.headers.get("Authorization", "")
        if auth.lower().startswith("bearer "):
            return auth[7:].strip()
        stored = self._cookie_value(AUTH_STORAGE_KEY)
        if stored:
            try:
                return json.loads(stored).get("access_token")
            except (ValueError, AttributeError):
                return None
        return None

    def _authenticate_api(self, path):
        self.auth_user = None
        _local.local_user = None
        if AUTH.enabled:
            try:
                self.auth_user = AUTH.verify(self._access_token())
            except PermissionError as e:
                self._send(401, {"error": str(e), "code": "AUTH_REQUIRED"})
                return False
        if LOCAL_AUTH_ENABLED and path not in LOCAL_AUTH_EXEMPT_PATHS:
            user = _local_session_user(self._cookie_value(LOCAL_SESSION_COOKIE))
            if user is None:
                self._send(401, {"error": "Sign in first.", "code": "LOCAL_AUTH_REQUIRED"})
                return False
            _local.local_user = user
        return True

    def log_message(self, *_):
        pass

    # ── GET ──
    def do_GET(self):
        u = urlparse(self.path)
        p = u.path
        try:
            if p.startswith("/api/") and not self._authenticate_api(p):
                return
            if p == "/api/local-session":
                # Unauthenticated probe — the client polls this at boot to
                # decide login-gate vs. app, so it must work with no session.
                user = None
                if LOCAL_AUTH_ENABLED:
                    row = _local_session_user(self._cookie_value(LOCAL_SESSION_COOKIE))
                    if row:
                        user = {"id": row["id"], "username": row["username"], "is_admin": row["is_admin"],
                                "view_start": row.get("view_start"), "view_end": row.get("view_end"),
                                "grants": row["grants"]}
                return self._send(200, {"enabled": LOCAL_AUTH_ENABLED, "user": user})
            if p == "/api/history":
                if not _history_admin():
                    return self._send(403, {"error": "Admin access required."})
                from urllib.parse import parse_qs
                qs = parse_qs(u.query)
                limit = max(1, min(int((qs.get("limit") or [60])[0]), 199))
                before = (qs.get("before") or [None])[0]
                events = _history_event_rows(limit + 1, int(before) if before else None)
                return self._send(200, {"events": events[:limit], "has_more": len(events) > limit})
            if p == "/api/admin/users":
                if not (_local.local_user and _local.local_user["is_admin"]):
                    return self._send(403, {"error": "Admin access required."})
                users = q("select id, username, is_admin, view_start, view_end from app_users order by is_admin desc, username")
                grants = q("select user_id, section, sub, can_edit from app_user_grants")
                by_user = {}
                for g in grants:
                    by_user.setdefault(g["user_id"], []).append(g)
                default_start, default_end = _default_view_window()
                for u_row in users:
                    u_row["grants"] = by_user.get(u_row["id"], [])
                    u_row["default_view_start"] = default_start
                    u_row["default_view_end"] = default_end
                return self._send(200, {"users": users})
            if p == "/api/bootstrap":
                payload = api_bootstrap()
                if self.auth_user:
                    payload["auth_user"] = {
                        "id": self.auth_user.get("id"),
                        "email": self.auth_user.get("email"),
                        "user_metadata": self.auth_user.get("user_metadata") or {},
                    }
                if _local.local_user:
                    u_row = _local.local_user
                    payload["me"] = {
                        "id": u_row["id"], "username": u_row["username"], "is_admin": u_row["is_admin"],
                        "view_start": u_row.get("view_start"), "view_end": u_row.get("view_end"),
                        "grants": u_row["grants"],
                    }
                    if not u_row["is_admin"]:
                        vs, ve = u_row.get("view_start"), u_row.get("view_end")
                        if not vs and not ve:
                            vs, ve = _default_view_window()
                        _filter_scheduler_by_window(payload, vs, ve)
                return self._send(200, payload)
            if p == "/api/sheets/status":
                return self._send(200, {"available": SHEETS.available, "why": SHEETS.why})
            if p == "/api/motive/status":
                return self._send(200, {"available": MOTIVE.available, "why": MOTIVE.why})
            if p.startswith("/api/file/"):
                rel = unquote(p[len("/api/file/"):])
                # Content-Type from the extension so the in-app viewer can render
                # images inline, not just PDFs (D51).
                ctype = mimetypes.guess_type(rel)[0] or "application/pdf"
                try:
                    return self._send(200, STORE.read(rel), ctype)
                except Exception:
                    return self._send(404, {"error": "not found"})
            if p.startswith("/api/report/"):
                from urllib.parse import parse_qs
                qs = parse_qs(u.query)
                frm = (qs.get("from") or [None])[0] or None
                to = (qs.get("to") or [None])[0] or None
                return self._send(200, {"csv": build_report(p.rsplit("/", 1)[1], frm, to)})
            # app.js is assembled from app/web/js/*.js (split for token-friendly
            # editing; see the app.js map in WORKTREE.md). One shared IIFE, so the
            # runtime is identical to the old monolith — the fragments are just the
            # closure body, concatenated in filename order.
            if p == "/app.js":
                jsdir = os.path.join(WEB, "js")
                parts = []
                for fn in sorted(os.listdir(jsdir)):
                    if not fn.endswith(".js"):
                        continue
                    with open(os.path.join(jsdir, fn), "r") as f:
                        c = f.read()
                    parts.append(c[:-1] if c.endswith("\n") else c)
                js = ("/* Dept 12 Dashboard — client. Assembled from app/web/js/*.js "
                      "(one IIFE; see the app.js section map in WORKTREE.md). */\n"
                      "(function () {\n\"use strict\";\n" + "\n".join(parts) + "\n})();\n")
                return self._send(200, js.encode("utf-8"), "application/javascript")
            if p == "/auth-config.js":
                js = "window.DEPT12_APP_CONFIG=Object.freeze(" + json.dumps(browser_auth_config()) + ");\n"
                return self._send(200, js, "application/javascript")
            # static
            rel = "index.html" if p in ("/", "") else p.lstrip("/")
            full = os.path.normpath(os.path.join(WEB, rel))
            if not full.startswith(WEB) or not os.path.isfile(full):
                return self._send(404, "not found", "text/plain")
            ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
            with open(full, "rb") as f:
                return self._send(200, f.read(), ctype)
        except Exception as e:
            return self._send(500, {"error": str(e)})

    # ── POST ──
    def do_POST(self):
        p = urlparse(self.path).path
        try:
            if p.startswith("/api/") and not self._authenticate_api(p):
                return
            d = self._body()
            history_event = None
            if p == "/api/local-login":
                username = (d.get("username") or "").strip()
                if not username:
                    return self._send(400, {"error": "Enter a username."})
                row = q("select * from app_users where lower(username)=lower(%s)", (username,), one=True)
                if not row:
                    row = q("insert into app_users (username) values (%s) returning *", (username,), one=True)
                token = secrets.token_hex(32)
                with _local_sessions_lock:
                    _local_sessions[token] = row["id"]
                cookie = f"{LOCAL_SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000"
                return self._send(200, {"user": {
                    "id": row["id"], "username": row["username"], "is_admin": row["is_admin"],
                    "view_start": row.get("view_start"), "view_end": row.get("view_end"), "grants": [],
                }}, set_cookie=cookie)
            if p == "/api/local-logout":
                token = self._cookie_value(LOCAL_SESSION_COOKIE)
                if token:
                    with _local_sessions_lock:
                        _local_sessions.pop(token, None)
                return self._send(200, {"ok": True},
                    set_cookie=f"{LOCAL_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
            if p in ("/api/history/preview", "/api/history/revert"):
                if not _history_admin():
                    return self._send(403, {"error": "Admin access required."})
                result = api_history_preview(d) if p.endswith("/preview") else api_history_revert(d)
                return self._send(200, result)
            if p == "/api/admin/order-number-settings" and LOCAL_AUTH_ENABLED and not (
                    _local.local_user and _local.local_user["is_admin"]):
                return self._send(403, {"error": "Admin access required."})
            if p in ("/api/admin/grants", "/api/admin/view-window", "/api/admin/user/delete") and not (
                    _local.local_user and _local.local_user["is_admin"]):
                return self._send(403, {"error": "Admin access required."})
            if p in ("/api/admin/grants", "/api/admin/view-window", "/api/admin/user/delete",
                     "/api/admin/order-number-settings"):
                history_event = _history_create_event(p, d)
            if p == "/api/admin/order-number-settings":
                return self._send(200, api_order_number_settings_save(d))
            if p == "/api/admin/user/delete":
                target = q("select is_admin from app_users where id=%s", (d["user_id"],), one=True)
                if not target:
                    return self._send(404, {"error": "User not found."})
                if target["is_admin"]:
                    return self._send(400, {"error": "Can't delete an admin account."})
                q("delete from app_users where id=%s", (d["user_id"],))
                with _local_sessions_lock:
                    for tok, uid in list(_local_sessions.items()):
                        if uid == d["user_id"]:
                            _local_sessions.pop(tok, None)
                return self._send(200, {"ok": True})
            if p == "/api/admin/grants":
                if d.get("can_edit") is None and not d.get("revoke"):
                    return self._send(400, {"error": "can_edit or revoke is required."})
                if d.get("revoke"):
                    q("delete from app_user_grants where user_id=%s and section=%s and sub=%s",
                      (d["user_id"], d["section"], d["sub"]))
                    return self._send(200, {"ok": True})
                return self._send(200, q("""
                    insert into app_user_grants (user_id, section, sub, can_edit)
                    values (%s,%s,%s,%s)
                    on conflict (user_id, section, sub) do update set can_edit = excluded.can_edit
                    returning *""", (d["user_id"], d["section"], d["sub"], bool(d["can_edit"])), one=True))
            if p == "/api/admin/view-window":
                return self._send(200, q("""
                    update app_users set view_start=%s, view_end=%s where id=%s
                    returning id, view_start, view_end""",
                    (d.get("view_start") or None, d.get("view_end") or None, d["user_id"]), one=True))
            if LOCAL_AUTH_ENABLED and _local.local_user and not _local.local_user["is_admin"] \
                    and not _check_route_permission(p, d, _local.local_user):
                return self._send(403, {"error": "You don't have edit access to that."})
            if history_event is None and p.startswith("/api/") and p not in HISTORY_SKIP_PATHS:
                # A driver-tab dry run is a preview, not an external action.
                if not (p == "/api/sheets/push-driver-tabs" and not d.get("confirm")):
                    external = p in HISTORY_EXTERNAL_PATHS
                    history_event = _history_create_event(
                        p, d, reversible=not external, external_effect=external)
            if p == "/api/order":
                return self._send(200, api_create_order(d))
            if p == "/api/order/ingest":
                return self._send(200, api_ingest_order(d))
            if p == "/api/order/update":
                return self._send(200, api_update_order(d["id"], d))
            if p == "/api/order/route":
                return self._send(200, api_order_route_save(d))
            if p == "/api/order/cancel":
                return self._send(200, api_cancel_order(d))
            if p == "/api/order/delete":
                return self._send(200, api_delete_order(d))
            if p == "/api/internal-order":
                return self._send(200, api_add_internal_order(d))
            if p == "/api/order/transfer":
                return self._send(200, api_add_transfer_order(d))
            if p == "/api/order/copy":
                return self._send(200, api_copy_order(d))
            if p == "/api/order/bill":
                return self._send(200, api_bill_order(d))
            if p == "/api/document":
                return self._send(200, api_save_document(d))
            if p == "/api/document/attach":
                return self._send(200, api_attach_document(d["id"], d["order_id"]))
            if p == "/api/document/delete":
                return self._send(200, api_delete_document(d))
            if p == "/api/schedule":
                return self._send(200, api_schedule(d))
            if p == "/api/load/carrier":
                return self._send(200, api_load_carrier(d))
            if p == "/api/freight":
                return self._send(200, api_freight(d))
            if p == "/api/motive/sync-miles":
                return self._send(200, api_motive_sync_miles())
            if p == "/api/internal-freight-rate":
                return self._send(200, api_internal_freight_rate_save(d))
            if p == "/api/internal-freight-rate/calculate":
                return self._send(200, api_internal_freight_rate_calculate())
            if p == "/api/unschedule":
                return self._send(200, api_unschedule(d["order_id"]))
            if p == "/api/sync-delivery-dates":
                return self._send(200, api_sync_delivery_dates())
            if p == "/api/driver":
                return self._send(200, api_add_driver(d))
            if p == "/api/truck":
                return self._send(200, api_add_truck(d))
            if p == "/api/assign-truck":
                return self._send(200, api_assign_truck(d))
            if p == "/api/truck/driver":
                return self._send(200, api_set_truck_driver(d))
            if p == "/api/location":
                return self._send(200, api_add_location(d))
            if p == "/api/department":
                return self._send(200, api_add_department(d))
            if p == "/api/customer":
                return self._send(200, api_add_customer(d))
            if p == "/api/cell/color":
                return self._send(200, api_cell_color(d))
            if p == "/api/cell/format":
                return self._send(200, api_cell_format(d))
            if p == "/api/truck/off":
                return self._send(200, api_truck_off(d))
            if p == "/api/day-note":
                return self._send(200, api_day_note(d))
            if p == "/api/category":
                return self._send(200, api_category(d))
            if p == "/api/sheet":
                return self._send(200, api_sheet(d))
            if p == "/api/sheet/cell":
                return self._send(200, api_sheet_cell(d))
            if p == "/api/grid/cell-fmt":
                return self._send(200, api_grid_cell_fmt(d))
            if p == "/api/row":
                return self._send(200, api_update_row(d["table"], d["id"], d["values"]))
            if p == "/api/row/custom":
                return self._send(200, api_update_custom(d))
            if p == "/api/grid/column":
                return self._send(200, api_grid_column(d))
            if p == "/api/grid/column/update":
                return self._send(200, api_grid_column_update(d))
            if p == "/api/grid/column/delete":
                return self._send(200, api_grid_column_delete(d))
            if p == "/api/entity":
                return self._send(200, api_entity_create(d))
            if p == "/api/entity/update":
                return self._send(200, api_entity_update(d))
            if p == "/api/entity/delete":
                return self._send(200, api_entity_delete(d))
            if p == "/api/field":
                return self._send(200, api_field_create(d))
            if p == "/api/field/update":
                return self._send(200, api_field_update(d))
            if p == "/api/field/rename-option":
                return self._send(200, api_field_rename_option(d))
            if p == "/api/field/delete":
                return self._send(200, api_field_delete(d))
            if p == "/api/record":
                return self._send(200, api_record_create(d))
            if p == "/api/record/update":
                return self._send(200, api_record_update(d))
            if p == "/api/record/delete":
                return self._send(200, api_record_delete(d))
            if p == "/api/grid/row":
                return self._send(200, api_grid_row(d))
            if p == "/api/grid/row/delete":
                return self._send(200, api_grid_row_delete(d))
            if p == "/api/database/archive":
                return self._send(200, api_database_archive(d))
            if p == "/api/grid/row/reorder":
                return self._send(200, api_grid_row_reorder(d))
            if p == "/api/sheets/push-driver-tabs":
                payload = _driver_week_payload(d.get("start_date"), d.get("days", 3))
                if not d.get("confirm"):
                    # Dry run (D35): compute the exact push payload from our
                    # own schedule data and hand it back — no Sheets call at
                    # all — so the format can be reviewed before anything
                    # ever touches the live mirror (15f12…).
                    payload["dry_run"] = True
                    payload["sync_available"] = SHEETS.available
                    return self._send(200, payload)
                if not SHEETS.available:
                    return self._send(501, {"error": SHEETS.why})
                row_count = payload["days"] * payload["slots_per_day"]
                # Always clear the full 1–14 day range the app allows (D98's
                # clamp), not just this push's row_count — otherwise shrinking
                # the Days-shown control (or a truck whose last push was wider)
                # leaves old rows sitting below the new, smaller window (D112).
                max_clear_rows = 14 * payload["slots_per_day"]

                props = SHEETS.tab_props()
                cw_prop = next((p for p in props if p["title"] == "Current Week"), None)
                driver_tabs = [p for p in props if p["title"] != "Current Week"]

                resolved, skipped, need_create = {}, [], []
                for drv in payload["drivers"]:
                    found = [p for p in driver_tabs
                             if re.search(r"\b" + re.escape(drv["truck"]) + r"\b", p["title"])]
                    if len(found) == 1:
                        resolved[drv["truck"]] = found[0]
                    elif len(found) == 0:
                        need_create.append(drv)
                    else:
                        skipped.append({"truck": drv["truck"], "driver": drv["driver"],
                                         "candidates": [p["title"] for p in found]})

                # Fleet future-proofing (D112): a truck with no matching tab
                # yet gets one created (same "{DRIVER} {NUMBER} {TYPE}"
                # convention the hand-made tabs already use), and every
                # driver tab's position is kept in sync with the app's truck
                # order (Fleet's sort_order) — added trucks and reordered
                # trucks both show up correctly with zero manual sheet work.
                start_index = (cw_prop["index"] + 1) if cw_prop else 0
                target_order = [drv["truck"] for drv in payload["drivers"]
                                 if drv["truck"] in resolved or drv in need_create]
                reorder_needed = bool(need_create) or any(
                    resolved.get(truck, {}).get("index") != start_index + i
                    for i, truck in enumerate(target_order) if truck in resolved)

                # The real hand-made tabs turned out to be capped at a fixed
                # 17-row grid (D114) — exactly why the old dynamic clear
                # range never fully wiped a shrunk window: nothing could
                # clear past row 17 either. Grow any tab that's short of the
                # max 1-14 day window (D98's clamp) so both the clear and a
                # future wider push always fit; new tabs are created at full
                # size up front so they never need this.
                grid_target_rows = 1 + 14 * payload["slots_per_day"]
                grow_reqs = [{"updateSheetProperties": {
                    "properties": {"sheetId": p["sheetId"],
                                   "gridProperties": {"rowCount": grid_target_rows}},
                    "fields": "gridProperties.rowCount"}}
                    for p in ([cw_prop] if cw_prop else []) + list(resolved.values())
                    if p.get("gridProperties", {}).get("rowCount", 0) < grid_target_rows]

                if need_create or reorder_needed or grow_reqs:
                    provision_reqs = list(grow_reqs)
                    if need_create:
                        provision_reqs += [{"addSheet": {"properties": {
                            "title": " ".join(x for x in
                                [(drv["driver"] or "").upper(), drv["truck"], drv["equipment_type"]] if x),
                            "gridProperties": {"frozenRowCount": 1, "rowCount": grid_target_rows}}}}
                            for drv in need_create]
                    replies = SHEETS.batch_update(provision_reqs).get("replies", []) if provision_reqs else []
                    for drv, reply in zip(need_create, replies[len(grow_reqs):]):
                        resolved[drv["truck"]] = reply["addSheet"]["properties"]
                    reorder_reqs = [{"updateSheetProperties": {
                        "properties": {"sheetId": resolved[truck]["sheetId"], "index": start_index + i},
                        "fields": "index"}} for i, truck in enumerate(target_order)]
                    if reorder_reqs:
                        SHEETS.batch_update(reorder_reqs)

                pushed = []
                for drv in payload["drivers"]:
                    if drv["truck"] not in resolved:
                        continue
                    tab, sid = resolved[drv["truck"]]["title"], resolved[drv["truck"]]["sheetId"]
                    # D178/D179: E/F carry the PO/PU# and Delivery# as their own
                    # plain-text columns (Nate: cleaner than burying them in the
                    # chip text); the Pickup/Drop map links that used to live in
                    # E/F moved to H/I instead. G (Store Map, internal-only)
                    # stays put. G/H/I are written separately as real rich-text
                    # links (below), not plain values here — a bare
                    # =HYPERLINK() formula only opens on a second tap after
                    # Sheets shows its hover/preview chip, which read as "not
                    # actually hyperlinking" on a driver's tablet (D179). Load#
                    # doesn't get its own column (tried in D179, reverted in
                    # D180) — it's back to living only in the chip header.
                    values = [[r["date"], r["chip"], r["notes"],
                               r["po_number"], r["delivery_number"],
                               "", "", ""]
                              for r in drv["rows"]]
                    # Driver tabs are a rolling window, not an append-only log.
                    # Three large rows per day preserve every scheduler slot.
                    SHEETS.batch_update([{"repeatCell": {
                        "range": {"sheetId": sid, "startRowIndex": 1,
                                  "endRowIndex": 1 + max_clear_rows,
                                  "startColumnIndex": 1, "endColumnIndex": 9},
                        "cell": {}, "fields": "userEnteredValue,userEnteredFormat"
                    }}])
                    SHEETS.write_range(f"'{tab}'!B2:I{1 + len(values)}", values)
                    reqs = _three_slot_grid_requests(
                        sid, 1, 9, row_height=150, content_font_size=11,
                        days=payload["days"])
                    # Real rich-text links (textFormatRuns.format.link), not
                    # HYPERLINK() formulas — these navigate on a single tap,
                    # the same as a link typed by hand via Insert > Link.
                    for i, r in enumerate(drv["rows"]):
                        for col, url, label in ((6, r["store_map"], "Store Map"),
                                                 (7, r["pickup"], "Pickup"),
                                                 (8, r["drop"], "Drop")):
                            if url:
                                reqs.append({"updateCells": {
                                    "rows": [{"values": [{
                                        "userEnteredValue": {"stringValue": label},
                                        "textFormatRuns": [{"startIndex": 0,
                                            "format": {"link": {"uri": url}}}]}]}],
                                    "fields": "userEnteredValue,textFormatRuns",
                                    "start": {"sheetId": sid, "rowIndex": 1 + i, "columnIndex": col}}})
                    reqs.insert(0, _header_cell_request(
                        sid, 0, 2,
                        (drv["driver"] or f'{drv["truck"]} {drv["equipment_type"]}').upper(),
                        drv.get("driver_color"), font_size=15))
                    # Row-one column labels (DATE/NOTES/PO-PU#/etc.) are
                    # Nate's own manual edit on the live sheet (D179) — push
                    # only ever owned the driver-name banner (C1) below, and
                    # deliberately still doesn't touch B1/D1:I1.
                    reqs.insert(0, {"updateDimensionProperties": {
                        "range": {"sheetId": sid, "dimension": "ROWS",
                                  "startIndex": 0, "endIndex": 1},
                        "properties": {"pixelSize": 42}, "fields": "pixelSize"}})
                    for i, r in enumerate(drv["rows"]):
                        if r["chip"]:
                            reqs += _fmt_requests(sid, 1 + i, 2, r["chip"],
                                                  r.get("color"), font_size=11)
                            # A four-stop route can be twice as tall as a
                            # normal chip. Expand only those rare rows so the
                            # complete route stays visible without making the
                            # entire driver tab unwieldy.
                            sections = r["chip"].count("\n\n")
                            if sections > 2:
                                reqs.append({"updateDimensionProperties": {
                                    "range": {"sheetId": sid, "dimension": "ROWS",
                                              "startIndex": 1 + i, "endIndex": 2 + i},
                                    "properties": {"pixelSize": min(420, 150 + 60 * (sections - 2))},
                                    "fields": "pixelSize"}})
                    SHEETS.batch_update(reqs)
                    pushed.append(tab)

                # Current Week's row-one headers are rebuilt from the dashboard
                # on every push. That makes truck order, driver assignment,
                # names, and colors self-correcting instead of inheriting stale
                # values from an older workbook layout.
                current_week_pushed = False
                if cw_prop:
                    prior_values = SHEETS.read_range("'Current Week'!B1:Z1")
                    prior_width = len(prior_values[0]) if prior_values else 0
                    headers = ["DATE"] + [t["header"].upper() for t in payload["current_week"]]
                    matrix = []
                    for i in range(row_count):
                        row = [payload["current_week"][0]["rows"][i]["date"]]
                        row += [truck["rows"][i]["chip"] for truck in payload["current_week"]]
                        matrix.append(row)
                    current_sid = cw_prop["sheetId"]
                    SHEETS.batch_update([{"repeatCell": {
                        "range": {"sheetId": current_sid, "startRowIndex": 0,
                                  "endRowIndex": 1 + max_clear_rows,
                                  "startColumnIndex": 1,
                                  "endColumnIndex": 1 + max(prior_width, len(headers))},
                        "cell": {}, "fields": "userEnteredValue,userEnteredFormat"
                    }}])
                    SHEETS.write_range(
                        f"'Current Week'!B1:{chr(65 + len(headers))}1", [headers])
                    SHEETS.write_range(
                        f"'Current Week'!B2:{chr(65 + len(headers))}{1 + row_count}", matrix)
                    reqs = _three_slot_grid_requests(
                        current_sid, 1, 1 + len(headers), row_height=108,
                        content_font_size=10, days=payload["days"])
                    reqs.insert(0, {"updateDimensionProperties": {
                        "range": {"sheetId": current_sid, "dimension": "ROWS",
                                  "startIndex": 0, "endIndex": 1},
                        "properties": {"pixelSize": 42}, "fields": "pixelSize"}})
                    reqs.insert(1, {"updateDimensionProperties": {
                        "range": {"sheetId": current_sid, "dimension": "COLUMNS",
                                  "startIndex": 2, "endIndex": 1 + len(headers)},
                        "properties": {"pixelSize": 224}, "fields": "pixelSize"}})
                    reqs.append(_header_cell_request(
                        current_sid, 0, 1, "DATE", "#FFFFFF", font_size=16))
                    for col_offset, truck in enumerate(payload["current_week"], 2):
                        reqs.append(_header_cell_request(
                            current_sid, 0, col_offset, truck["header"].upper(),
                            truck.get("driver_color"), font_size=14))
                        for i, row in enumerate(truck["rows"]):
                            if row["chip"]:
                                reqs += _fmt_requests(current_sid, 1 + i, col_offset,
                                                      row["chip"], row.get("color"),
                                                      font_size=10)
                    SHEETS.batch_update(reqs)
                    current_week_pushed = True

                # Every load now has a visible destination: assigned trucks on
                # both views, and unmanned trucks on Current Week.
                if current_week_pushed:
                    q("""update loads set pushed_at = now()
                         where scheduled_date between %s and %s""",
                      (payload["week_start"], payload["week_end"]))
                if history_event:
                    _history_finish_event(history_event["id"], {
                        "pushed_tabs": pushed, "skipped_count": len(skipped),
                        "week_start": str(payload["week_start"]),
                    })
                return self._send(200, {"pushed": pushed, "skipped": skipped,
                    "current_week": current_week_pushed,
                    "week_start": payload["week_start"]})
            if p == "/api/create-draft":
                if OUTLOOK_GRAPH_ENABLED:
                    graph_token = self.headers.get("X-Microsoft-Provider-Token", "").strip()
                    if not graph_token:
                        return self._send(401, {"error": "Connect Outlook before creating a draft.",
                                                "code": "OUTLOOK_AUTH_REQUIRED"})
                    result = GraphDraft(graph_token).create_draft(
                        d.get("to", ""), d.get("subject", ""),
                        base64.b64decode(d["pdfB64"]), d.get("filename") or "invoice.pdf")
                    if history_event:
                        _history_finish_event(history_event["id"], {
                            "to": d.get("to", ""), "subject": d.get("subject", "")})
                    return self._send(200, {"ok": True, "draft": result})
                if not MAIL.available:
                    return self._send(501, {"error": MAIL.why})
                MAIL.create_draft(d.get("to", ""), d.get("subject", ""),
                                  base64.b64decode(d["pdfB64"]),
                                  d.get("filename") or "invoice.pdf")
                if history_event:
                    _history_finish_event(history_event["id"], {
                        "to": d.get("to", ""), "subject": d.get("subject", "")})
                return self._send(200, {"ok": True, "draft": None})
            return self._send(404, {"error": "no route " + p})
        except Exception as e:
            return self._send(500, {"error": str(e)})
        finally:
            # `_history_create_event` sets dept12.history_event_id with is_local=false
            # (D131), so it survives on the pooled per-thread connection past this
            # request. Left uncleared, the NEXT request handled on this thread — a
            # skip-listed or otherwise event-less mutation, e.g. /api/local-login's
            # insert on a brand-new username — would have its trigger-captured audit
            # rows silently misattributed to this request's event. Every request
            # (success or error) must reset it, not just the error path.
            try:
                _history_clear_context()
            except Exception:
                pass


# ── Reports ──────────────────────────────────────────────────────────────────
REPORTS = {
    "orders": """
        select o.solomon_order_no, o.department, o.kind, o.broker_load_no,
               c.name as customer, b.name as broker, o.pallet_count,
               o.stage, o.ordered_at, o.delivered_at,
               (o.delivered_at - o.ordered_at) as days_order_to_delivery
        from orders o
        left join parties c on c.id=o.customer_party_id
        left join parties b on b.id=o.broker_party_id
        order by o.ordered_at desc""",
    "loads": """
        select scheduled_date, driver_name, truck_number, equipment_type,
               kind, status, miles, internal_freight_amount, drop_count
        from v_loads_reporting order by scheduled_date desc""",
    "missing_pod": "select * from v_loads_missing_pod order by scheduled_date",
    "customers": """
        select p.name, l.address, l.city, l.state, l.forklift, l.timing_window,
               cat.name as designation, l.standard_miles, l.miles_from_umatilla,
               l.is_umatilla, l.appointment_note, l.notes, p.phone, p.manager_name
        from parties p left join locations l on l.party_id = p.id
        left join categories cat on cat.id = l.category_id
        where p.is_customer and p.customer_archived_at is null order by p.name""",
    "brokers": """
        select p.name, p.rexius_customer_no, p.ap_email, p.phone, p.manager_name, p.notes
        from parties p where p.is_broker and p.broker_archived_at is null order by p.name""",
    "fleet": """
        select t.number as truck, t.equipment_type, t.active,
               dr.full_name as current_driver
        from trucks t
        left join lateral (
          select d.full_name from driver_truck_assignments a
          join drivers d on d.id = a.driver_id
          where a.truck_id = t.id and a.effective_to is null limit 1
        ) dr on true
        order by t.number""",
    "customer_order_counts": """
        select c.name as customer, extract(year from o.ordered_at)::int as year,
               count(*) as order_count
        from orders o join parties c on c.id = o.customer_party_id
        where o.kind = 'internal' and o.ordered_at is not null
        group by c.name, extract(year from o.ordered_at)
        order by year desc, order_count desc""",
    "documents": """
        select d.doc_type, d.original_filename, d.matched_by, d.uploaded_at,
               o.solomon_order_no, o.broker_load_no
        from documents d left join orders o on o.id=d.order_id
        order by d.uploaded_at desc""",
}


# The "giant dump" (D40) — one wide row per order, joined to its load, truck,
# driver, and money on both paths (external revenue from invoices, internal
# freight from the load). Date-range filtered on the order's activity date
# (scheduled → delivered → ordered, first non-null). Built to be pivoted in
# Excel, not pre-aggregated: e.g. "$ to pull per bagger account" = filter
# kind=internal, sum internal_freight_share by truck_number.
#
# External invoice revenue is still per LOAD, and an internal load can still
# combine several orders, so external revenue keeps its even per-order share
# (orders_on_load). Internal miles/freight moved to the order itself (D103) —
# it's a real per-order figure now, not a load total to split.
#
# pivot_department (D127) is department (the Solomon-derived '07'/'12' code,
# already populated for bag orders) coalesced with transfer_department (the
# Internal Freight tracker's real department name) — one column to pivot by
# for a bag order, a transfer, or a real external order (blank on the last).
_DUMP_SQL = """
with base as (
  select
    o.id, o.solomon_order_no, o.department, o.kind, o.is_transfer,
    o.broker_load_no, o.po_number, o.delivery_number,
    c.name as customer, c.rexius_customer_no as customer_rexius_no,
    c.phone as customer_phone, c.ap_email as customer_ap_email, c.manager_name as customer_manager,
    b.name as broker, b.rexius_customer_no as broker_rexius_no,
    b.phone as broker_phone, b.ap_email as broker_ap_email, b.manager_name as broker_manager,
    td.name as transfer_department,
    o.pallet_count, o.stage, o.notes as load_info, o.driver_note, o.tarp,
    o.ordered_at, o.released_at, o.requested_delivery_date, o.delivered_at, o.billed_at,
    o.route_mode,
    o.miles as order_miles, o.motive_miles as order_motive_miles, o.miles_adjusted as order_miles_adjusted,
    o.internal_freight_amount as order_internal_freight,
    ld.scheduled_date, ld.slot, ld.status as load_status, ld.pushed_at,
    ld.truck_number, ld.equipment_type, ld.driver_name, ld.driver_color,
    ld.miles as load_miles, ld.is_carrier, ld.carrier_name, ld.carrier_cost,
    ld.external_revenue, ld.orders_on_load,
    pl.name as pickup_name, pl.address as pickup_address, pl.city as pickup_city,
    pl.state as pickup_state, pl.postal_code as pickup_zip, pl.phone as pickup_phone,
    dl.name as delivery_name, dl.address as delivery_address, dl.city as delivery_city,
    dl.state as delivery_state, dl.postal_code as delivery_zip, dl.phone as delivery_phone,
    il.city as customer_loc_city, il.state as customer_loc_state, il.forklift as customer_forklift,
    il.timing_window as customer_timing_window, il.standard_miles as customer_standard_miles,
    docs.rate_con_count, docs.pod_count, docs.invoice_doc_count,
    ot.number as order_truck_number,
    coalesce(ld.scheduled_date, o.delivered_at, o.ordered_at) as activity_date,
    dn.text as day_note
  from orders o
  left join parties c on c.id = o.customer_party_id
  left join parties b on b.id = o.broker_party_id
  left join departments td on td.id = o.transfer_department_id
  left join locations pl on pl.id = o.pickup_location_id
  left join locations dl on dl.id = o.delivery_location_id
  -- Prefer the plain orders.truck_id column (D239, stamped by Sync Delivery
  -- Dates) over the lateral-through-loads guess below; the lateral stays as
  -- a fallback for an order that hasn't been (re-)synced since getting a
  -- truck, so this report never loses a truck it could previously show.
  left join trucks ot on ot.id = o.truck_id
  left join lateral (
    select forklift, timing_window, standard_miles, city, state
    from locations where party_id = o.customer_party_id limit 1
  ) il on true
  left join lateral (
    select l.scheduled_date, l.slot, l.status, l.pushed_at,
           t.number as truck_number, t.equipment_type,
           dr.full_name as driver_name, dr.color as driver_color, l.miles,
           l.is_carrier, cp.name as carrier_name, l.carrier_cost,
           (select sum(iv.amount) from invoices iv where iv.load_id = l.id) as external_revenue,
           (select count(*) from load_orders lo2 where lo2.load_id = l.id) as orders_on_load
    from load_orders lo
    join loads l on l.id = lo.load_id
    left join trucks t on t.id = l.truck_id
    left join drivers dr on dr.id = l.driver_id
    left join parties cp on cp.id = l.carrier_party_id
    where lo.order_id = o.id
    order by l.scheduled_date desc nulls last
    limit 1
  ) ld on true
  left join lateral (
    select
      count(*) filter (where doc_type = 'rate_con') as rate_con_count,
      count(*) filter (where doc_type = 'pod') as pod_count,
      count(*) filter (where doc_type = 'invoice') as invoice_doc_count
    from documents where order_id = o.id
  ) docs on true
  -- Day notes (D230/D245) are pinned to a calendar date, not an order, so
  -- there's no real FK to join on — this matches the same activity_date
  -- every order in this dump already sorts/pivots by, below. Must follow
  -- the `ld` lateral above so its scheduled_date is in scope here.
  left join day_notes dn on dn.note_date = coalesce(ld.scheduled_date, o.delivered_at, o.ordered_at)::date
)
select
  solomon_order_no, department, coalesce(department, transfer_department) as pivot_department,
  kind, is_transfer, broker_load_no, po_number, delivery_number,
  customer, customer_rexius_no, customer_phone, customer_ap_email, customer_manager,
  broker, broker_rexius_no, broker_phone, broker_ap_email, broker_manager,
  pallet_count, stage, load_info, driver_note, tarp,
  ordered_at, released_at, requested_delivery_date, delivered_at, billed_at,
  scheduled_date, slot, load_status, route_mode, pushed_at,
  extract(isoyear from activity_date)::int as iso_year,
  extract(week   from activity_date)::int as iso_week,
  to_char(activity_date, 'YYYY-MM') as year_month,
  case when extract(month from activity_date) between 1 and 7 then 'peak' else 'off' end as season,
  coalesce(order_truck_number, truck_number) as truck_number, equipment_type, driver_name, driver_color,
  coalesce(order_miles, load_miles) as miles, order_motive_miles, order_miles_adjusted,
  order_internal_freight as internal_freight_amount,
  external_revenue as external_revenue_load,
  orders_on_load,
  round(external_revenue / nullif(orders_on_load, 0), 2) as external_revenue_share,
  is_carrier, carrier_name, carrier_cost,
  pickup_name, pickup_address, pickup_city, pickup_state, pickup_zip, pickup_phone,
  delivery_name, delivery_address, delivery_city, delivery_state, delivery_zip, delivery_phone,
  customer_loc_city, customer_loc_state, customer_forklift, customer_timing_window, customer_standard_miles,
  coalesce(rate_con_count, 0) as rate_con_count, coalesce(pod_count, 0) as pod_count,
  coalesce(invoice_doc_count, 0) as invoice_doc_count,
  day_note
from base
where (%(frm)s::date is null or activity_date >= %(frm)s::date)
  and (%(to)s::date  is null or activity_date <= %(to)s::date)
order by activity_date desc nulls last, solomon_order_no
"""


# Internal freight transfer, date-filterable (D40, reshaped D127) — truck +
# department totals for the picked date range (Nate: "transfer per truck for
# the date range", collapsed rather than the old weekly buckets — the full
# data dump below is the raw-data-to-pivot-yourself companion when a weekly
# or per-customer view is needed). Bag-plant loads (kind='internal') are
# hardcoded department '07'; Internal Freight transfers (is_transfer) join
# their real department. Delivered/closed loads only — you transfer for
# completed hauls.
_FREIGHT_SQL = """
with rows as (
  select l.truck_id, l.id as load_id, '07' as department, o.internal_freight_amount
  from loads l
  join load_orders lo on lo.load_id = l.id
  join orders o on o.id = lo.order_id
  where l.kind = 'internal' and o.internal_freight_amount is not null
    and l.status in ('delivered', 'closed')
    and (%(frm)s::date is null or l.scheduled_date >= %(frm)s::date)
    and (%(to)s::date  is null or l.scheduled_date <= %(to)s::date)
  union all
  select l.truck_id, l.id as load_id, d.name as department, o.internal_freight_amount
  from loads l
  join load_orders lo on lo.load_id = l.id
  join orders o on o.id = lo.order_id
  join departments d on d.id = o.transfer_department_id
  where l.kind = 'external' and o.is_transfer and o.internal_freight_amount is not null
    and l.status in ('delivered', 'closed')
    and (%(frm)s::date is null or l.scheduled_date >= %(frm)s::date)
    and (%(to)s::date  is null or l.scheduled_date <= %(to)s::date)
)
select t.number as truck_number, r.department,
       count(distinct r.load_id) as load_count,
       sum(r.internal_freight_amount) as total_amount
from rows r
join trucks t on t.id = r.truck_id
group by t.number, r.department
order by t.number, r.department
"""


# Mileage split three ways (D127): bag-plant internal by customer, Internal
# Freight transfers by department, and true external (kind='external' and
# not is_transfer) as one total — transfers are internal-flavored mileage,
# not external, so they must NOT fall into the external total. Reuses the
# same per-order miles/activity-date resolution as _DUMP_SQL. External is
# safe to sum at the order level with no split: external is always one order
# per load (CLAUDE.md), unlike internal where several orders share a load.
# orders_with_miles vs order_count surfaces orders with no mileage entered
# yet instead of silently shrinking the total.
_MILEAGE_SQL = """
with base as (
  select o.id, o.kind, o.is_transfer, c.name as customer, td.name as department,
         coalesce(o.miles, ld.miles) as miles,
         coalesce(ld.scheduled_date, o.delivered_at, o.ordered_at) as activity_date
  from orders o
  left join parties c on c.id = o.customer_party_id
  left join departments td on td.id = o.transfer_department_id
  left join lateral (
    select l.scheduled_date, l.miles
    from load_orders lo join loads l on l.id = lo.load_id
    where lo.order_id = o.id
    order by l.scheduled_date desc nulls last
    limit 1
  ) ld on true
)
select
  case when kind = 'internal' then 'internal' when is_transfer then 'transfer' else 'external' end as bucket,
  case when kind = 'internal' then customer when is_transfer then department else null end as customer_or_dept,
  count(*)          as order_count,
  count(miles)      as orders_with_miles,
  sum(miles)        as total_miles
from base
where (%(frm)s::date is null or activity_date >= %(frm)s::date)
  and (%(to)s::date  is null or activity_date <= %(to)s::date)
group by 1, 2
order by 1, total_miles desc nulls last
"""

PARAM_SQL = {"dump": _DUMP_SQL, "freight": _FREIGHT_SQL, "mileage": _MILEAGE_SQL}

# Friendly CSV headers (Nate's ask) — plain column names like `solomon_order_no`
# or `pivot_department` are fine for the app's own code but not for a report
# someone opens straight into Excel. One dict per report, keyed to that
# report's own raw column names, reusing the same wording the app's own grid
# headers/drawer labels use wherever a column has an obvious on-screen match
# (Order #, PAL, Load Info, Transfer $, Time Window, ...) and a plain
# hand-written label for anything dump-only with no grid equivalent (ISO Year,
# Pivot Department, Orders On Load, ...). A header that would naturally carry
# a slash (PU/PO, Customer/Department) uses an underscore instead (Nate: "if
# it has a slash use an underscore") — a literal slash in a CSV header can
# read as a formula/path separator once pulled into Excel. Any column NOT
# listed here (there shouldn't be any) falls back to its raw name in _csv().
_REPORT_LABELS = {
    "dump": {
        "solomon_order_no": "Order #", "department": "Department Code",
        "pivot_department": "Pivot Department", "kind": "Kind", "is_transfer": "Is Transfer",
        "broker_load_no": "Load #", "po_number": "PU_PO", "delivery_number": "Delivery #",
        "customer": "Customer", "customer_rexius_no": "Customer Rexius #",
        "customer_phone": "Customer Phone", "customer_ap_email": "Customer AP Email",
        "customer_manager": "Customer Manager",
        "broker": "Broker", "broker_rexius_no": "Broker Rexius #", "broker_phone": "Broker Phone",
        "broker_ap_email": "Broker AP Email", "broker_manager": "Broker Manager",
        "pallet_count": "PAL", "stage": "Stage", "load_info": "Load Info",
        "driver_note": "Driver Tab Note", "tarp": "Tarp",
        "ordered_at": "Ordered", "released_at": "Released",
        "requested_delivery_date": "Requested Delivery", "delivered_at": "Delivered",
        "billed_at": "Billed",
        "scheduled_date": "Scheduled Date", "slot": "Slot", "load_status": "Load Status",
        "route_mode": "Route Mode", "pushed_at": "Pushed At",
        "iso_year": "ISO Year", "iso_week": "ISO Week", "year_month": "Year-Month",
        "season": "Season",
        "truck_number": "Truck #", "equipment_type": "Equipment Type",
        "driver_name": "Driver", "driver_color": "Driver Color",
        "miles": "Miles", "order_motive_miles": "Motive Miles",
        "order_miles_adjusted": "Miles Adjusted",
        "internal_freight_amount": "Transfer $", "external_revenue_load": "External Revenue (Load)",
        "orders_on_load": "Orders On Load", "external_revenue_share": "External Revenue Share",
        "is_carrier": "Is Carrier", "carrier_name": "Carrier", "carrier_cost": "Carrier Cost",
        "pickup_name": "Pickup Name", "pickup_address": "Pickup Address",
        "pickup_city": "Pickup City", "pickup_state": "Pickup State",
        "pickup_zip": "Pickup Zip", "pickup_phone": "Pickup Phone",
        "delivery_name": "Delivery Name", "delivery_address": "Delivery Address",
        "delivery_city": "Delivery City", "delivery_state": "Delivery State",
        "delivery_zip": "Delivery Zip", "delivery_phone": "Delivery Phone",
        "customer_loc_city": "Customer Location City", "customer_loc_state": "Customer Location State",
        "customer_forklift": "Forklift", "customer_timing_window": "Time Window",
        "customer_standard_miles": "Standard Miles",
        "rate_con_count": "Rate Con Count", "pod_count": "POD Count",
        "invoice_doc_count": "Invoice Doc Count", "day_note": "Day Note",
    },
    "freight": {
        "truck_number": "Truck #", "department": "Department",
        "load_count": "Load Count", "total_amount": "Total $",
    },
    "mileage": {
        "bucket": "Type", "customer_or_dept": "Customer_Department",
        "order_count": "Order Count", "orders_with_miles": "Orders With Miles",
        "total_miles": "Total Miles",
    },
    "customers": {
        "name": "Customer", "address": "Address", "city": "City", "state": "State",
        "forklift": "Forklift", "timing_window": "Time Window", "designation": "Designation",
        "standard_miles": "Miles", "miles_from_umatilla": "Umatilla Miles",
        "is_umatilla": "Is Umatilla", "appointment_note": "Appointment Note",
        "notes": "Notes", "phone": "Phone", "manager_name": "Manager",
    },
    "brokers": {
        "name": "Broker", "rexius_customer_no": "Rexius #", "ap_email": "AP Email",
        "phone": "Phone", "manager_name": "Manager", "notes": "Notes",
    },
    "fleet": {
        "truck": "Truck #", "equipment_type": "Equipment Type",
        "active": "Active", "current_driver": "Driver",
    },
}


def _csv(rows, labels=None):
    if not rows:
        return ""
    cols = list(rows[0].keys())
    labels = labels or {}
    header = [labels.get(c, c) for c in cols]

    def cell(v):
        s = "" if v is None else str(jsonable(v) if not isinstance(v, (str, int, float)) else v)
        return '"' + s.replace('"', '""') + '"' if re.search(r'[",\n]', s) else s

    return "\n".join([",".join(header)] + [",".join(cell(r[c]) for c in cols) for r in rows])


def build_report(name, frm=None, to=None):
    if name in PARAM_SQL:
        return _csv(q(PARAM_SQL[name], {"frm": frm or None, "to": to or None}) or [], _REPORT_LABELS.get(name))
    if name == "everything":
        out = []
        for k in list(REPORTS) + list(PARAM_SQL):
            out.append("### " + k.upper())
            out.append(build_report(k))
            out.append("")
        return "\n".join(out)
    sql = REPORTS.get(name)
    if not sql:
        return "error,unknown report\n" + name
    return _csv(q(sql) or [], _REPORT_LABELS.get(name))


if __name__ == "__main__":
    try:
        n = q("select count(*) as n from orders", one=True)["n"]
    except Exception as e:
        sys.exit(f"Cannot reach the configured Postgres database.\n  {e}\n"
                 f"Start it and apply migrations — see README.md")
    print(f"  storage: {type(STORE).__name__}   mail: {type(MAIL).__name__}")
    print(f"  auth: {'Supabase' if AUTH.enabled else 'disabled'}   "
          f"outlook graph: {'enabled' if OUTLOOK_GRAPH_ENABLED else 'disabled'}")
    if not MAIL.available:
        print(f"  NOTE: {MAIL.why}")
    print(f"Dept 12 Dashboard  →  http://{HOST}:{PORT}")
    print(f"  db: connected ({n} orders; timezone {TIMEZONE})")
    print("Leave this window open while you work.\n")
    threading.Thread(target=_history_purge_loop, daemon=True).start()
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

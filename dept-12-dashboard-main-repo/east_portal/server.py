#!/usr/bin/env python3
"""Rexius Bag Orders portal.

Runs separately from the dispatcher dashboard while sharing its Postgres data
and document storage. Local default: http://127.0.0.1:8785.
"""

import base64
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import smtplib
import sys
import threading
import time
import uuid
from email.message import EmailMessage
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
APP_DIR = ROOT / "app"
WEB_DIR = Path(__file__).resolve().parent / "web"
VENDOR_DIR = APP_DIR / "web" / "vendor"
LOGO_PATH = APP_DIR / "web" / "rexius-logo.png"


def load_dotenv():
    path = ROOT / ".env"
    if not path.is_file():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key and key not in os.environ:
            os.environ[key] = value.strip()


load_dotenv()
sys.path.insert(0, str(APP_DIR))

try:
    import psycopg
    from psycopg.rows import dict_row
    from psycopg.types.json import Jsonb
except ImportError:
    sys.exit("psycopg missing. Install psycopg[binary] before starting the portal.")

from adapters import make_storage  # noqa: E402

HOST = os.environ.get("EAST_PORTAL_HOST", "127.0.0.1")
PORT = int(os.environ.get("EAST_PORTAL_PORT", "8785"))
DSN = os.environ.get("DEPT12_DSN", "dbname=dept12 host=/tmp")
TIMEZONE = os.environ.get("DEPT12_TIMEZONE", "America/Los_Angeles")
STORAGE_ROOT = os.environ.get("DEPT12_STORAGE_ROOT", str(APP_DIR / "storage"))
ACCESS_CODE = os.environ.get("EAST_PORTAL_ACCESS_CODE", "").strip()
SESSION_SECRET = os.environ.get("EAST_PORTAL_SESSION_SECRET", "").strip()
MAX_BODY_BYTES = int(os.environ.get("EAST_PORTAL_MAX_BODY_BYTES", str(18 * 1024 * 1024)))
NOTIFY_TO = os.environ.get("EAST_NOTIFY_EMAIL", "nathanl@rexius.com").strip()
PORTAL_SCOPE = os.environ.get("DRIVER_PORTAL_SCOPE", "umatilla").strip().lower()

STORE = make_storage(STORAGE_ROOT)
_local = threading.local()


def db():
    conn = getattr(_local, "conn", None)
    if conn is None or conn.closed:
        conn = psycopg.connect(DSN, row_factory=dict_row, autocommit=True)
        conn.execute("select set_config('TimeZone', %s, false)", (TIMEZONE,))
        _local.conn = conn
    return conn


def q(statement, params=None, one=False):
    with db().cursor() as cur:
        cur.execute(statement, params or ())
        if cur.description is None:
            return None
        rows = cur.fetchall()
        return (rows[0] if rows else None) if one else rows


def jsonable(value):
    import datetime
    import decimal

    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    raise TypeError(f"not JSON serializable: {type(value)}")


def _session_key():
    seed = SESSION_SECRET or ("east-portal:" + ACCESS_CODE)
    return hashlib.sha256(seed.encode("utf-8")).digest()


def make_session_cookie(secure=False):
    expires = int(time.time()) + 30 * 24 * 60 * 60
    payload = f"east:{expires}"
    signature = hmac.new(_session_key(), payload.encode(), hashlib.sha256).hexdigest()
    value = base64.urlsafe_b64encode(f"{payload}:{signature}".encode()).decode().rstrip("=")
    attrs = f"east_portal_session={value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000"
    if secure:
        attrs += "; Secure"
    return attrs


def valid_session(cookie_header):
    if not ACCESS_CODE:
        return True
    try:
        jar = SimpleCookie()
        jar.load(cookie_header or "")
        value = jar["east_portal_session"].value
        decoded = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)).decode()
        prefix, expires, signature = decoded.split(":", 2)
        payload = f"{prefix}:{expires}"
        expected = hmac.new(_session_key(), payload.encode(), hashlib.sha256).hexdigest()
        return prefix == "east" and int(expires) >= int(time.time()) and hmac.compare_digest(signature, expected)
    except Exception:
        return False


def _order_rows(completed=False):
    completion_join = "join" if completed else "left join"
    completion_filter = (
        "and (ec.completed_at at time zone %s)::date = (now() at time zone %s)::date"
        if completed else "and ec.order_id is null"
    )
    stage_filter = "and o.stage <> 'cancelled'" if completed else \
        "and o.stage in ('ordered','released','scheduled')"
    scope_filter = "and loc.is_umatilla" if PORTAL_SCOPE != "all" else ""
    params = (TIMEZONE, TIMEZONE) if completed else ()
    return q(f"""
        select o.id, o.solomon_order_no, o.stage, o.driver_note,
               c.name as customer_name,
               loc.city, loc.state, loc.timing_window,
               src.id as source_document_id, src.original_filename,
               src.uploaded_at as published_at,
               ec.truck_number as completed_truck, ec.completed_at
        from orders o
        join parties c on c.id=o.customer_party_id
        join locations loc on loc.id=o.delivery_location_id
        join lateral (
          select id, original_filename, uploaded_at
          from documents
          where order_id=o.id and doc_type='delivery_receipt'
          order by uploaded_at desc limit 1
        ) src on true
        {completion_join} driver_receipt_completions ec on ec.order_id=o.id
        where o.kind='internal' and not coalesce(o.is_transfer, false)
          {scope_filter} {stage_filter}
          {completion_filter}
        order by coalesce(ec.completed_at, src.uploaded_at) desc, o.solomon_order_no
    """, params)


def bootstrap():
    trucks = q("select id, number from trucks where active order by sort_order, number")
    return {
        "scope": "all" if PORTAL_SCOPE == "all" else "umatilla",
        "trucks": trucks,
        "ready": _order_rows(False),
        "completed": _order_rows(True),
    }


def eligible_order(order_id, lock=False):
    suffix = " for update of o" if lock else ""
    return q("""
        select o.id, o.solomon_order_no, o.stage, c.name as customer_name,
               loc.city, loc.state,
               src.id as source_document_id, src.storage_path, src.original_filename
        from orders o
        join parties c on c.id=o.customer_party_id
        join locations loc on loc.id=o.delivery_location_id
        join lateral (
          select id, storage_path, original_filename
          from documents
          where order_id=o.id and doc_type='delivery_receipt'
          order by uploaded_at desc limit 1
        ) src on true
        left join driver_receipt_completions ec on ec.order_id=o.id
        where o.id=%s and o.kind='internal' and not coalesce(o.is_transfer, false)
          and (%s='all' or loc.is_umatilla)
          and o.stage in ('ordered','released','scheduled')
          and ec.order_id is null
    """ + suffix, (order_id, PORTAL_SCOPE), one=True)


class EmailNotifier:
    def __init__(self):
        self.mode = os.environ.get("EAST_EMAIL_MODE", "file").strip().lower()
        self.sender = os.environ.get("EAST_EMAIL_FROM", "dept12@rexius.com").strip()

    def message(self, order, truck_number, note, pdf, filename):
        msg = EmailMessage()
        msg["To"] = NOTIFY_TO
        msg["From"] = self.sender
        msg["Subject"] = f"{order['solomon_order_no']} - Completed Delivery Receipt"
        lines = [
            f"Order {order['solomon_order_no']} was completed in Rexius Bag Orders.",
            "",
            f"Customer: {order['customer_name']}",
            f"Location: {', '.join(x for x in [order.get('city'), order.get('state')] if x)}",
            f"Truck: {truck_number}",
        ]
        if note:
            lines += ["", "Driver Notes:", note]
        msg.set_content("\n".join(lines))
        msg.add_attachment(pdf, maintype="application", subtype="pdf", filename=filename)
        return msg

    def send(self, order, truck_number, note, pdf, filename):
        if self.mode == "none" or not NOTIFY_TO:
            return "disabled"
        msg = self.message(order, truck_number, note, pdf, filename)
        if self.mode == "file":
            outbox = Path(os.environ.get("EAST_EMAIL_OUTBOX", str(ROOT / "east_portal" / "test_outbox")))
            if not outbox.is_absolute():
                outbox = ROOT / outbox
            outbox.mkdir(parents=True, exist_ok=True)
            stamp = time.strftime("%Y%m%d-%H%M%S")
            safe_order = re.sub(r"[^A-Za-z0-9-]+", "_", order["solomon_order_no"] or "order")
            (outbox / f"{stamp}-{safe_order}.eml").write_bytes(msg.as_bytes())
            return "captured"
        if self.mode != "smtp":
            raise ValueError("EAST_EMAIL_MODE must be file, smtp, or none")
        host = os.environ.get("EAST_SMTP_HOST", "").strip()
        if not host:
            raise ValueError("EAST_SMTP_HOST is required for SMTP email")
        port = int(os.environ.get("EAST_SMTP_PORT", "587"))
        username = os.environ.get("EAST_SMTP_USER", "")
        password = os.environ.get("EAST_SMTP_PASSWORD", "")
        starttls = os.environ.get("EAST_SMTP_STARTTLS", "true").lower() in ("1", "true", "yes", "on")
        with smtplib.SMTP(host, port, timeout=20) as smtp:
            smtp.ehlo()
            if starttls:
                smtp.starttls()
                smtp.ehlo()
            if username:
                smtp.login(username, password)
            smtp.send_message(msg)
        return "sent"


NOTIFIER = EmailNotifier()


def complete_order(order_id, payload):
    truck_number = str(payload.get("truck_number") or "").strip()[:40]
    note = (payload.get("note") or "").strip()[:2000]
    if not truck_number:
        raise ValueError("Enter the truck number before completing the receipt.")
    truck = q(
        "select id, number from trucks where active and lower(number)=lower(%s)",
        (truck_number,),
        one=True,
    )
    if not truck:
        raise ValueError("That truck number is not in the active fleet.")

    try:
        signed_pdf = base64.b64decode(payload.get("pdf_b64") or "", validate=True)
    except Exception as exc:
        raise ValueError("The signed PDF could not be read.") from exc
    if not signed_pdf.startswith(b"%PDF-"):
        raise ValueError("The completed document is not a PDF.")
    if len(signed_pdf) > 12 * 1024 * 1024:
        raise ValueError("The completed PDF is larger than 12 MB.")

    order = eligible_order(order_id)
    if not order:
        raise LookupError("This receipt was already completed or is no longer available.")

    doc_id = str(uuid.uuid4())
    order_no = order["solomon_order_no"] or "Order"
    filename = f"{order_no} Completed Delivery Receipt.pdf"
    safe_filename = re.sub(r"[^A-Za-z0-9._ -]+", "_", filename)
    storage_path = STORE.save(str(order_id), f"{doc_id}_{safe_filename}", signed_pdf)
    try:
        with db().transaction():
            locked = eligible_order(order_id, lock=True)
            if not locked:
                raise LookupError("This receipt was already completed or is no longer available.")
            q("""
                insert into documents
                  (id, order_id, doc_type, storage_path, original_filename,
                   extracted_fields, matched_by, matched_at)
                values (%s,%s,'pod',%s,%s,%s,'manual',now())
            """, (doc_id, order_id, storage_path, safe_filename, Jsonb({
                "driver_portal": True,
                "source_document_id": str(locked["source_document_id"]),
                "truck_id": str(truck["id"]),
                "truck_number": truck["number"],
                "driver_note": note,
            })))
            q("""
                insert into driver_receipt_completions
                  (order_id, source_document_id, pod_document_id,
                   truck_id, truck_number, driver_note)
                values (%s,%s,%s,%s,%s,%s)
            """, (order_id, locked["source_document_id"], doc_id,
                  truck["id"], truck["number"], note or None))
            q("""
                update orders
                set delivered_at=coalesce(delivered_at, current_date),
                    stage=case when stage in ('closed','cancelled') then stage else 'delivered' end
                where id=%s
            """, (order_id,))
    except Exception:
        STORE.delete(storage_path)
        raise
    finally:
        # The durable-history trigger creates a connection-scoped System event
        # for this portal transaction. Clear it because this thread-local
        # connection can serve another completion later (same trap as D131).
        try:
            q("select set_config('dept12.history_event_id', '', false)")
        except Exception:
            pass

    email_result = "failed"
    try:
        email_result = NOTIFIER.send(order, truck["number"], note, signed_pdf, safe_filename)
    except Exception as exc:
        print(f"Rexius Bag Orders email failed for {order_no}: {exc}", file=sys.stderr)
    return {"ok": True, "order_id": str(order_id), "email": email_result}


class Handler(BaseHTTPRequestHandler):
    server_version = "Rexius-Bag-Orders/0.1"

    def log_message(self, *_):
        pass

    def send_body(self, status, body, content_type="application/json", cookie=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, default=jsonable).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        path = urlparse(self.path).path
        if path.startswith("/api/") or content_type == "application/pdf":
            self.send_header("Cache-Control", "no-store")
        elif content_type.startswith(("text/html", "text/css", "application/javascript")):
            self.send_header("Cache-Control", "no-cache")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > MAX_BODY_BYTES:
            raise ValueError("Request is too large.")
        return json.loads(self.rfile.read(length)) if length else {}

    def unlocked(self):
        return valid_session(self.headers.get("Cookie", ""))

    def require_session(self):
        if self.unlocked():
            return True
        self.send_body(401, {"error": "Enter the East Side access code.", "code": "LOCKED"})
        return False

    def do_GET(self):
        path = urlparse(self.path).path
        try:
            if path == "/api/session":
                return self.send_body(200, {"locked": bool(ACCESS_CODE), "unlocked": self.unlocked()})
            if path == "/api/bootstrap":
                if not self.require_session():
                    return
                return self.send_body(200, bootstrap())
            match = re.fullmatch(r"/api/order/([0-9a-fA-F-]{36})/pdf", path)
            if match:
                if not self.require_session():
                    return
                order = eligible_order(match.group(1))
                if not order:
                    return self.send_body(404, {"error": "Receipt not available."})
                return self.send_body(200, STORE.read(order["storage_path"]), "application/pdf")
            if path == "/rexius-logo.png":
                return self.send_body(200, LOGO_PATH.read_bytes(), "image/png")
            if path.startswith("/vendor/"):
                name = path.rsplit("/", 1)[-1]
                if name not in {"pdf.min.js", "pdf.worker.min.js", "pdf-lib.min.js"}:
                    return self.send_body(404, "not found", "text/plain")
                return self.send_body(200, (VENDOR_DIR / name).read_bytes(), "application/javascript")
            rel = "index.html" if path in ("", "/") else path.lstrip("/")
            full = (WEB_DIR / rel).resolve()
            if WEB_DIR.resolve() not in full.parents or not full.is_file():
                return self.send_body(404, "not found", "text/plain")
            content_type = mimetypes.guess_type(str(full))[0] or "application/octet-stream"
            return self.send_body(200, full.read_bytes(), content_type)
        except Exception as exc:
            return self.send_body(500, {"error": str(exc)})

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            payload = self.read_json()
            if path == "/api/unlock":
                if not ACCESS_CODE or secrets.compare_digest(str(payload.get("code", "")), ACCESS_CODE):
                    secure = self.headers.get("X-Forwarded-Proto", "").lower() == "https"
                    return self.send_body(200, {"ok": True}, cookie=make_session_cookie(secure))
                return self.send_body(403, {"error": "That access code is not correct."})
            if not self.require_session():
                return
            match = re.fullmatch(r"/api/order/([0-9a-fA-F-]{36})/complete", path)
            if match:
                try:
                    return self.send_body(200, complete_order(match.group(1), payload))
                except LookupError as exc:
                    return self.send_body(409, {"error": str(exc)})
                except ValueError as exc:
                    return self.send_body(400, {"error": str(exc)})
            return self.send_body(404, {"error": "Not found."})
        except ValueError as exc:
            return self.send_body(400, {"error": str(exc)})
        except Exception as exc:
            return self.send_body(500, {"error": str(exc)})


if __name__ == "__main__":
    if HOST not in ("127.0.0.1", "localhost") and not ACCESS_CODE:
        print("WARNING: EAST_PORTAL_ACCESS_CODE is empty on a non-local host.", file=sys.stderr)
    print(f"Rexius Bag Orders -> http://{HOST}:{PORT}")
    print(f"Completion email -> {NOTIFY_TO or 'disabled'} ({NOTIFIER.mode})")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

"""
Adapters for everything that is not Postgres.

This exists because the target is Supabase + a hosted web app, and the local
implementations here must not leak into the core. Per CLAUDE.md: use an
adapter/interface pattern for any external data source so swapping the backend
does not require rewriting the app.

Selected by environment variable:

    DEPT12_STORAGE = local | supabase        (default: local)
    DEPT12_MAIL    = outlook | graph | none  (default: outlook, falls back to none)
    DEPT12_SHEETS  = google | none           (default: none)

Porting status, honestly:

  Storage  — LocalStorage works today. SupabaseStorage is written against the
             real REST contract but is UNTESTED, because the golden rule says we
             stay off a hosted project for now. `documents.storage_path` is
             already storage-agnostic, so the swap is this class and nothing else.

  Mail     — OutlookDraft works today on Windows only. It CANNOT work from a
             hosted web app: COM automation requires Outlook running on the same
             machine as the code. GraphDraft is the web-compatible replacement
             and needs an Entra app registration plus Mail.ReadWrite. That is a
             decision, not a port — see docs/decisions.md D25.

  Sheets   — Phase 3 (docs/decisions.md D32 part 2, D35, D111). Service-account
             credentials now exist (secrets/, gitignored). GoogleSheetsSync's
             token exchange is real — a hand-rolled RS256 JWT signer against
             stdlib bignums only, no cryptography/pyjwt dependency, since this
             project stays dependency-free (D24). read_range/write_range
             against the Sheets API v4 REST shape are written but the actual
             row/column mapping for the live SCHEDULER tab is still not built
             — that's deliberately generic (read_range/write_range, not
             "write a placement") because the mapping can only be confirmed
             against the real sheet — see legacy/tms-appsscript/CLAUDE.md for
             the documented layout.

             Two different sheets, two different jobs (D111) — `DEPT12_SHEETS_ID`
             is a single global env var, so which sheet it must point at depends
             on which caller uses the shared `SHEETS` instance:
               - `app/server.py`'s only use of `SHEETS` is `push-driver-tabs`,
                 which writes finished, formatted content straight into each
                 truck's hand-named tab (e.g. "WAYNE 31 BT") — those tabs only
                 exist on the driver-facing **mirror** (15f12…). Point the
                 running server's `DEPT12_SHEETS_ID` at the mirror, not the
                 dispatcher's working sheet — the working sheet has no
                 per-driver tabs to match against, so every driver silently
                 no-ops (shows up in the response's `skipped`, not an error).
               - One-off `scripts/` that read dispatcher input (e.g.
                 `import_outside_customers.py`'s Outside Customer List tab)
                 want the **working sheet** (1KlPQ…) instead, and hardcode
                 their own id rather than relying on this env var, since it's
                 pinned to the mirror for the running server.
"""

import base64
import hashlib
import json
import mimetypes
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request


# ── Storage ──────────────────────────────────────────────────────────────────
class StorageAdapter:
    """Documents are addressed by a relative path recorded in
    documents.storage_path. Implementations decide what that path means."""

    def save(self, folder: str, filename: str, data: bytes) -> str:
        raise NotImplementedError

    def read(self, path: str) -> bytes:
        raise NotImplementedError

    def move(self, path: str, new_folder: str) -> str:
        raise NotImplementedError

    def delete(self, path: str) -> None:
        raise NotImplementedError


class LocalStorage(StorageAdapter):
    """Files under app/storage/<order_id>/. Used for local development."""

    def __init__(self, root: str):
        self.root = root
        os.makedirs(root, exist_ok=True)

    def _full(self, path: str) -> str:
        full = os.path.normpath(os.path.join(self.root, path))
        if not full.startswith(self.root):
            raise ValueError("path escapes storage root")
        return full

    def save(self, folder: str, filename: str, data: bytes) -> str:
        d = os.path.join(self.root, folder)
        os.makedirs(d, exist_ok=True)
        full = os.path.join(d, filename)
        with open(full, "wb") as f:
            f.write(data)
        return os.path.relpath(full, self.root)

    def read(self, path: str) -> bytes:
        with open(self._full(path), "rb") as f:
            return f.read()

    def move(self, path: str, new_folder: str) -> str:
        old = self._full(path)
        d = os.path.join(self.root, new_folder)
        os.makedirs(d, exist_ok=True)
        new = os.path.join(d, os.path.basename(old))
        if os.path.exists(old) and old != new:
            os.replace(old, new)
        return os.path.relpath(new, self.root)

    def delete(self, path: str) -> None:
        try:
            os.remove(self._full(path))
        except OSError:
            pass


class SupabaseStorage(StorageAdapter):
    """Supabase Storage over the REST API.

    Contract-tested locally but not live-tested against a hosted project yet,
    per the golden rule. Written now so the port is a config change rather than
    a redesign, and so the shape of the work is visible before it is scheduled.

    Needs SUPABASE_URL and SUPABASE_SERVICE_KEY. The service key is server-side
    only; it must never reach the browser.
    """

    def __init__(self, url: str, key: str, bucket: str = "documents"):
        self.base = url.rstrip("/") + "/storage/v1/object"
        self.key = key
        self.bucket = bucket

    def _req(self, method, path, data=None, ctype="application/pdf"):
        # Object names keep the user's original filename and commonly contain
        # spaces. Quote the HTTP path without quoting its `/` separators.
        encoded_path = urllib.parse.quote(path, safe="/")
        req = urllib.request.Request(f"{self.base}/{encoded_path}", data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.key}")
        req.add_header("apikey", self.key)
        if data is not None:
            req.add_header("Content-Type", ctype)
            req.add_header("x-upsert", "true")
        with _urlopen(req) as r:   # certifi CA bundle — bare urlopen fails on this box (D35/D82)
            return r.read()

    def save(self, folder: str, filename: str, data: bytes) -> str:
        path = f"{folder}/{filename}"
        ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        self._req("POST", f"{self.bucket}/{path}", data, ctype)
        return path

    def read(self, path: str) -> bytes:
        return self._req("GET", f"{self.bucket}/{path}")

    def move(self, path: str, new_folder: str) -> str:
        new = f"{new_folder}/{os.path.basename(path)}"
        import json
        self._req("POST", "move",
                  json.dumps({"bucketId": self.bucket,
                              "sourceKey": path, "destinationKey": new}).encode(),
                  "application/json")
        return new

    def delete(self, path: str) -> None:
        try:
            self._req("DELETE", f"{self.bucket}/{path}")
        except urllib.error.HTTPError:
            pass


# ── Mail ─────────────────────────────────────────────────────────────────────
class MailAdapter:
    available = False
    why = "no mail adapter configured"

    def create_draft(self, to: str, subject: str, pdf: bytes, filename: str) -> None:
        raise NotImplementedError(self.why)


class NoMail(MailAdapter):
    available = False
    why = ("Outlook drafts need Windows with Outlook installed (win32com), or a "
           "Microsoft Graph app registration for the hosted web app. "
           "Download the merged PDF and attach it manually for now.")


EMAIL_BODY = """\
<html><body style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;color:#222222;">
<p style="margin:0 0 12px 0;">Hello,</p>
<p style="margin:0 0 12px 0;">Please see the attached invoice.</p>
<p style="margin:0 0 12px 0;">
  <em style="font-size:11px;color:#555555;">This email was sent automatically, feel free to respond with questions and concerns.</em>
</p>
<p style="margin:0 0 18px 0;">Thank you,</p>
<div style="font-size:13px;color:#222222;line-height:1.15;">
  <span style="font-weight:bold;">Nathan Lee</span> | Rexius Flatbed Trucking<br>
  MC# 194041<br>
  Office: 541-342-1835<br>
  Direct: 458-298-0680
</div>
</body></html>
"""


class OutlookDraft(MailAdapter):
    """Windows-only, ported from legacy/invoicing-local/server.py.

    Retries are split deliberately: the build can be retried wholesale because
    nothing is persisted until .Save(), while .Save() is retried on the SAME
    object so a rejected-but-actually-saved call re-saves instead of creating a
    second draft.
    """

    # Transient COM errors meaning "Outlook is busy", not real failures.
    RETRY = {-2147418111,   # 0x80010001 RPC_E_CALL_REJECTED
             -2147417846,   # 0x8001010A RPC_E_SERVERCALL_RETRYLATER
             -2146959355}   # 0x80080005 CO_E_SERVER_EXEC_FAILURE

    def __init__(self):
        import win32com.client, pywintypes  # noqa: F401
        self.win32com = win32com.client
        self.pywintypes = pywintypes
        self.available = True

    def _retryable(self, e):
        hr = e.args[0] if getattr(e, "args", None) else None
        return hr in self.RETRY

    def _build(self, to, subject, pdf_path):
        outlook = self.win32com.Dispatch("Outlook.Application")
        mail = outlook.CreateItem(0)
        mail.Subject = subject
        if to:
            ok = False
            try:
                for addr in re.split(r"[;,]\s*", to.strip()):
                    if addr:
                        rcp = mail.Recipients.Add(addr)
                        try:
                            rcp.Resolve()
                        except Exception:
                            pass
                try:
                    mail.Recipients.ResolveAll()
                except Exception:
                    pass
                ok = True
            except Exception:
                ok = False
            if not ok:
                try:
                    mail.To = to
                except Exception:
                    pass
        mail.HTMLBody = EMAIL_BODY
        mail.Attachments.Add(pdf_path)
        return mail

    def create_draft(self, to, subject, pdf, filename):
        import tempfile
        path = os.path.join(tempfile.gettempdir(), os.path.basename(filename) or "invoice.pdf")
        with open(path, "wb") as f:
            f.write(pdf)
        try:
            mail = None
            for i in range(5):
                try:
                    mail = self._build(to, subject, path)
                    break
                except self.pywintypes.com_error as e:
                    if self._retryable(e) and i < 4:
                        time.sleep(0.05 * (i + 1)); continue
                    raise
            for i in range(6):
                try:
                    mail.Save(); return
                except self.pywintypes.com_error as e:
                    if self._retryable(e) and i < 5:
                        time.sleep(0.05 * (i + 1)); continue
                    raise
        finally:
            try:
                os.remove(path)
            except OSError:
                pass


class GraphDraft(MailAdapter):
    """Microsoft Graph — the web-compatible replacement for Outlook COM.

    UNTESTED. Needs an Entra app registration with Mail.ReadWrite and a token.
    Creates the draft in the user's real Outlook mailbox, so drafts still appear
    where Nate expects them — the behaviour survives even though COM cannot.

    Two calls: create the message, then upload the attachment to it.
    """

    def __init__(self, token: str, user: str = "me"):
        self.token = token
        self.user = user
        self.available = True

    def create_draft(self, to, subject, pdf, filename):
        import base64, json
        root = f"https://graph.microsoft.com/v1.0/{'me' if self.user == 'me' else 'users/' + self.user}"

        def call(method, url, body, ctype="application/json"):
            req = urllib.request.Request(url, data=body, method=method)
            req.add_header("Authorization", f"Bearer {self.token}")
            req.add_header("Content-Type", ctype)
            with _urlopen(req) as r:   # certifi CA bundle — bare urlopen fails on this box (D35/D82)
                return json.loads(r.read() or b"{}")

        msg = call("POST", f"{root}/messages", json.dumps({
            "subject": subject,
            "body": {"contentType": "HTML", "content": EMAIL_BODY},
            "toRecipients": [{"emailAddress": {"address": a}}
                             for a in re.split(r"[;,]\s*", (to or "").strip()) if a],
        }).encode())

        if len(pdf) < 3 * 1024 * 1024:
            call("POST", f"{root}/messages/{msg['id']}/attachments", json.dumps({
                "@odata.type": "#microsoft.graph.fileAttachment",
                "name": os.path.basename(filename),
                "contentType": "application/pdf",
                "contentBytes": base64.b64encode(pdf).decode(),
            }).encode())
        else:
            if len(pdf) > 150 * 1024 * 1024:
                raise ValueError("Outlook attachments cannot exceed 150 MB.")
            session = call("POST", f"{root}/messages/{msg['id']}/attachments/createUploadSession",
                           json.dumps({"AttachmentItem": {
                               "attachmentType": "file",
                               "name": os.path.basename(filename),
                               "size": len(pdf),
                               "contentType": "application/pdf",
                           }}).encode())
            upload_url = session["uploadUrl"]
            # Outlook accepts sequential chunks up to 4 MB. 12 × 320 KiB also
            # satisfies Graph's range-alignment convention for resumable uploads.
            chunk_size = 12 * 320 * 1024
            for start in range(0, len(pdf), chunk_size):
                chunk = pdf[start:start + chunk_size]
                end = start + len(chunk) - 1
                req = urllib.request.Request(upload_url, data=chunk, method="PUT")
                req.add_header("Content-Length", str(len(chunk)))
                req.add_header("Content-Range", f"bytes {start}-{end}/{len(pdf)}")
                req.add_header("Content-Type", "application/octet-stream")
                with _urlopen(req) as response:
                    response.read()
        return {"id": msg.get("id"), "webLink": msg.get("webLink")}


# ── Authentication ───────────────────────────────────────────────────────────
class AuthAdapter:
    """Server-side API authentication boundary.

    Static app files remain public so a browser can load enough code to redirect
    to login. When enabled, every /api/* request is verified before it reaches
    business logic.
    """

    enabled = False
    url = ""
    publishable_key = ""

    def verify(self, token: str):
        return None


class NoAuth(AuthAdapter):
    enabled = False


class SupabaseAuth(AuthAdapter):
    """Verify a Supabase access token against the hosted Auth service.

    This intentionally uses the public ``/auth/v1/user`` contract instead of a
    service-role key or locally hard-coded signing secret. It is dormant unless
    DEPT12_AUTH_ENABLED=true. A short cache avoids a network round trip for each
    asset/API request while keeping revocation delay bounded.
    """

    enabled = True

    def __init__(self, url: str, publishable_key: str, cache_seconds: int = 45):
        self.url = url.rstrip("/")
        self.publishable_key = publishable_key
        self.cache_seconds = max(0, cache_seconds)
        self._cache = {}

    def verify(self, token: str):
        if not token:
            raise PermissionError("Sign in is required.")
        cache_key = hashlib.sha256(token.encode()).hexdigest()
        cached = self._cache.get(cache_key)
        if cached and cached[0] > time.time():
            return cached[1]

        req = urllib.request.Request(self.url + "/auth/v1/user")
        req.add_header("Authorization", "Bearer " + token)
        req.add_header("apikey", self.publishable_key)
        try:
            with _urlopen(req) as response:
                user = json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise PermissionError("Your session is invalid or expired.") from None
            raise
        if not user.get("id"):
            raise PermissionError("Supabase did not return an authenticated user.")
        self._cache[cache_key] = (time.time() + self.cache_seconds, user)
        if len(self._cache) > 500:
            now = time.time()
            self._cache = {k: v for k, v in self._cache.items() if v[0] > now}
        return user


def _urlopen(req):
    """urllib.request.urlopen, but with a real CA bundle.

    The python.org macOS build ships without root certificates wired into the
    system trust store, so a bare urlopen() against a real HTTPS endpoint
    fails with CERTIFICATE_VERIFY_FAILED — not a code bug, just this
    environment. Use certifi's bundle when it's installed (it already is,
    pulled in as a psycopg dependency); fall back to the default context
    otherwise so this is a no-op on environments that don't need it.
    """
    import ssl
    try:
        import certifi
        ctx = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        ctx = None
    return urllib.request.urlopen(req, context=ctx)


# ── Sheets sync ──────────────────────────────────────────────────────────────
def _der_read_len(data: bytes, i: int):
    b = data[i]
    if b < 0x80:
        return b, i + 1
    nbytes = b & 0x7F
    return int.from_bytes(data[i + 1 : i + 1 + nbytes], "big"), i + 1 + nbytes


def _der_read_tlv(data: bytes, i: int):
    tag = data[i]
    length, j = _der_read_len(data, i + 1)
    return tag, data[j : j + length], j + length


def _der_read_int(data: bytes, i: int):
    tag, value, j = _der_read_tlv(data, i)
    if tag != 0x02:
        raise ValueError("expected DER INTEGER (0x02), got %#x" % tag)
    return int.from_bytes(value, "big"), j


def _rsa_key_from_pem(pem: str):
    """Extract (modulus, private_exponent) from a PEM RSA private key,
    PKCS#1 or PKCS#8, using nothing but stdlib DER parsing.

    No cryptography/pyjwt package is installed in this environment and this
    project stays dependency-free (D24) — hand-rolling the handful of DER
    fields we actually need (n, d) is small enough to be worth doing directly
    rather than adding a pip dependency for one call site.
    """
    lines = [l for l in pem.strip().splitlines() if not l.startswith("-----")]
    der = base64.b64decode("".join(lines))
    tag, seq, _ = _der_read_tlv(der, 0)
    if tag != 0x30:
        raise ValueError("not a DER SEQUENCE — malformed private key")

    def parse_pkcs1(body):
        i = 0
        _, i = _der_read_int(body, i)  # version
        n, i = _der_read_int(body, i)
        _, i = _der_read_int(body, i)  # public exponent
        d, i = _der_read_int(body, i)
        return n, d

    try:
        return parse_pkcs1(seq)
    except ValueError:
        pass  # not bare PKCS#1 — unwrap PKCS#8 below

    i = 0
    _, i = _der_read_int(seq, i)  # version
    _, _, i = _der_read_tlv(seq, i)  # AlgorithmIdentifier, unused
    tag, octet, _ = _der_read_tlv(seq, i)
    if tag != 0x04:
        raise ValueError("expected OCTET STRING for PKCS#8 privateKey")
    _, inner, _ = _der_read_tlv(octet, 0)
    return parse_pkcs1(inner)


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _rsa_sign_sha256(message: bytes, n: int, d: int) -> bytes:
    """RSASSA-PKCS1-v1_5 / SHA-256 signing (RFC 8017 §9.2), by hand — the
    other half of staying off the cryptography package for this one call."""
    digest = hashlib.sha256(message).digest()
    # DER prefix for a SHA-256 DigestInfo, RFC 8017 Appendix B.1.
    prefix = bytes.fromhex("3031300d060960864801650304020105000420")
    t = prefix + digest
    k = (n.bit_length() + 7) // 8
    ps_len = k - len(t) - 3
    if ps_len < 8:
        raise ValueError("RSA key too small for SHA-256 PKCS#1 v1.5 padding")
    em = b"\x00\x01" + b"\xff" * ps_len + b"\x00" + t
    signature_int = pow(int.from_bytes(em, "big"), d, n)
    return signature_int.to_bytes(k, "big")


class SheetsAdapter:
    available = False
    why = "no Sheets adapter configured"

    def read_range(self, a1_range: str) -> list:
        raise NotImplementedError(self.why)

    def write_range(self, a1_range: str, values: list) -> None:
        raise NotImplementedError(self.why)

    def list_tabs(self) -> list:
        raise NotImplementedError(self.why)


class NoSheetsSync(SheetsAdapter):
    available = False
    why = ("Sheets sync needs a Google Cloud service account with edit access "
           "to the dispatcher's working sheet (1KlPQ…) — set DEPT12_SHEETS=google "
           "and DEPT12_SHEETS_CREDS to its key-file path once that exists.")


class GoogleSheetsSync(SheetsAdapter):
    """Google Sheets API v4, service-account auth. Auth + read access
    live-verified against both the dispatcher's working sheet (1KlPQ…) and
    the driver-facing mirror (15f12…) (D111); the actual batchUpdate write
    path used by push-driver-tabs is exercised by that feature, not this
    class in isolation. Addresses whichever spreadsheet id its caller passes
    in — see the module docstring for which id each caller needs; this class
    itself has no opinion, callers must not mix them up."""

    BASE = "https://sheets.googleapis.com/v4/spreadsheets"
    SCOPE = "https://www.googleapis.com/auth/spreadsheets"
    TOKEN_URL = "https://oauth2.googleapis.com/token"

    def __init__(self, creds_path: str, spreadsheet_id: str):
        with open(creds_path) as f:
            creds = json.load(f)
        self._client_email = creds["client_email"]
        self._n, self._d = _rsa_key_from_pem(creds["private_key"])
        self.spreadsheet_id = spreadsheet_id
        self._token = None
        self._token_exp = 0
        self.available = True

    def _access_token(self) -> str:
        now = int(time.time())
        if self._token and now < self._token_exp - 30:
            return self._token

        header = _b64url(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
        claims = _b64url(json.dumps({
            "iss": self._client_email,
            "scope": self.SCOPE,
            "aud": self.TOKEN_URL,
            "iat": now,
            "exp": now + 3600,
        }).encode())
        signing_input = f"{header}.{claims}".encode()
        signature = _b64url(_rsa_sign_sha256(signing_input, self._n, self._d))
        assertion = f"{header}.{claims}.{signature}"

        body = urllib.parse.urlencode({
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": assertion,
        }).encode()
        req = urllib.request.Request(self.TOKEN_URL, data=body, method="POST")
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
        try:
            with _urlopen(req) as r:
                resp = json.loads(r.read())
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"Google token exchange failed: {e.read().decode()}") from e

        self._token = resp["access_token"]
        self._token_exp = now + int(resp.get("expires_in", 3600))
        return self._token

    def _call(self, method: str, path: str, body=None):
        # ':batchUpdate' attaches directly to the id (no slash); 'values/…'
        # and 'values/…?…' take the usual '/'.
        sep = "" if path.startswith(":") else "/"
        url = f"{self.BASE}/{self.spreadsheet_id}{sep}{path}"
        req = urllib.request.Request(
            url, data=json.dumps(body).encode() if body is not None else None, method=method)
        req.add_header("Authorization", f"Bearer {self._access_token()}")
        req.add_header("Content-Type", "application/json")
        with _urlopen(req) as r:
            return json.loads(r.read() or b"{}")

    def read_range(self, a1_range: str) -> list:
        # safe="" — a tab name containing a literal "/" (e.g. "Pick/Drop
        # List", D257) must have it percent-encoded too, or it splits the
        # URL path into extra segments and 400s with a generic Drive
        # "Page Not Found" page instead of a real API error.
        return self._call("GET", f"values/{urllib.parse.quote(a1_range, safe='')}").get("values", [])

    def write_range(self, a1_range: str, values: list) -> None:
        self._call("PUT", f"values/{urllib.parse.quote(a1_range, safe='')}?valueInputOption=USER_ENTERED",
                    {"values": values})

    def _sheet_props(self) -> list:
        url = f"{self.BASE}/{self.spreadsheet_id}?" + urllib.parse.urlencode(
            {"fields": "sheets.properties(sheetId,title,index,gridProperties(rowCount))"})
        req = urllib.request.Request(url, method="GET")
        req.add_header("Authorization", f"Bearer {self._access_token()}")
        with _urlopen(req) as r:
            data = json.loads(r.read())
        return [s["properties"] for s in data.get("sheets", [])]

    def tab_props(self) -> list:
        """title/sheetId/index for every tab, one call — push-driver-tabs
        (D112) uses this once up front instead of a `sheet_id()` round trip
        per driver, and needs `index` to detect/fix drift from the app's
        truck order."""
        return self._sheet_props()

    def batch_update(self, requests: list) -> dict:
        """Low-level spreadsheets.batchUpdate. Kept generic on purpose (a
        list of Sheets API request objects) so cell formatting — background
        color, wrap, bold text runs — lives with the color/legend logic in
        the caller, matching read_range/write_range's generic shape."""
        return self._call("POST", ":batchUpdate", {"requests": requests})


# ── Motive ELD (D48) ─────────────────────────────────────────────────────────
class MotiveAdapter:
    available = False
    why = "no Motive adapter configured"

    def daily_miles(self, start_date: str, end_date: str) -> dict:
        raise NotImplementedError(self.why)


class NoMotive(MotiveAdapter):
    available = False
    why = ("Motive mileage sync needs the API key — save it in secrets/ and set "
           "DEPT12_MOTIVE=motive and DEPT12_MOTIVE_CREDS to its path.")


class MotiveClient(MotiveAdapter):
    """Motive Fleet API, X-Api-Key auth. Read-only. Pulls per-truck-per-day
    miles from /v1/logs — each daily log carries an `odometers` map keyed by
    truck number (start/end readings), so miles per (truck, day) = Σ(end-start)
    for that truck. `total_miles` is the single-vehicle fallback. Batched by
    date range (one call covers every truck for up to per_page driver-days),
    and the caller caches results, so a sync is only a handful of requests."""

    BASE = "https://api.gomotive.com"

    def __init__(self, creds_path: str):
        with open(creds_path) as f:
            self.key = f.read().strip()
        self.available = True

    def _get(self, path: str):
        req = urllib.request.Request(self.BASE + path)
        req.add_header("X-Api-Key", self.key)
        req.add_header("Accept", "application/json")
        with _urlopen(req) as r:
            return json.loads(r.read())

    def daily_miles(self, start_date: str, end_date: str) -> dict:
        out, page = {}, 1
        while True:
            data = self._get(
                f"/v1/logs?start_date={start_date}&end_date={end_date}&per_page=100&page_no={page}")
            logs = data.get("logs", [])
            for item in logs:
                lg = item.get("log", item)
                date = lg.get("date")
                captured = False
                for truck_no, segs in (lg.get("odometers") or {}).items():
                    miles = 0
                    for s in segs:
                        if not isinstance(s, dict):
                            continue
                        st, en = s.get("start") or 0, s.get("end") or 0
                        if en >= st > 0:          # skip zero/missing/reset readings
                            miles += en - st
                    if miles:
                        key = (str(truck_no), date)
                        out[key] = out.get(key, 0) + miles
                        captured = True
                # single-vehicle day with unusable odometer segments -> total_miles
                if not captured and lg.get("total_miles") and lg.get("vehicle_numbers") \
                        and "," not in str(lg["vehicle_numbers"]):
                    key = (str(lg["vehicle_numbers"]).strip(), date)
                    out[key] = out.get(key, 0) + lg["total_miles"]
            pg = data.get("pagination") or {}
            if not logs or pg.get("per_page", 100) * page >= pg.get("total", 0):
                break
            page += 1
        return out


# ── Selection ────────────────────────────────────────────────────────────────
def make_motive() -> MotiveAdapter:
    kind = os.environ.get("DEPT12_MOTIVE", "none").lower()
    if kind == "motive":
        creds = os.environ.get("DEPT12_MOTIVE_CREDS")
        if not creds or not os.path.exists(creds):
            return NoMotive()
        return MotiveClient(creds)
    return NoMotive()


def make_storage(local_root: str) -> StorageAdapter:
    kind = os.environ.get("DEPT12_STORAGE", "local").lower()
    if kind == "supabase":
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_KEY")
        if not url or not key:
            raise SystemExit("DEPT12_STORAGE=supabase needs SUPABASE_URL and SUPABASE_SERVICE_KEY")
        bucket = os.environ.get("DEPT12_STORAGE_BUCKET", "documents").strip() or "documents"
        return SupabaseStorage(url, key, bucket)
    return LocalStorage(local_root)


def make_auth() -> AuthAdapter:
    enabled = os.environ.get("DEPT12_AUTH_ENABLED", "false").lower() in ("1", "true", "yes", "on")
    if not enabled:
        return NoAuth()
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = (os.environ.get("SUPABASE_PUBLISHABLE_KEY") or
           os.environ.get("SUPABASE_ANON_KEY") or "").strip()
    if not url or not key:
        raise SystemExit("DEPT12_AUTH_ENABLED=true needs SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY")
    return SupabaseAuth(url, key, int(os.environ.get("DEPT12_AUTH_CACHE_SECONDS", "45")))


def make_mail() -> MailAdapter:
    kind = os.environ.get("DEPT12_MAIL", "outlook").lower()
    if kind == "none":
        return NoMail()
    if kind == "graph":
        tok = os.environ.get("GRAPH_TOKEN")
        if not tok:
            return NoMail()
        return GraphDraft(tok, os.environ.get("GRAPH_USER", "me"))
    try:
        return OutlookDraft()
    except ImportError:
        return NoMail()


def make_sheets() -> SheetsAdapter:
    kind = os.environ.get("DEPT12_SHEETS", "none").lower()
    if kind == "google":
        creds = os.environ.get("DEPT12_SHEETS_CREDS")
        sheet_id = os.environ.get("DEPT12_SHEETS_ID")
        if not creds or not sheet_id:
            return NoSheetsSync()
        return GoogleSheetsSync(creds, sheet_id)
    return NoSheetsSync()

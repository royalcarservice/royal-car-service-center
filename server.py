#!/usr/bin/env python3
"""GarageAI MVP backend.

A dependency-free development API using SQLite and Python's standard library.
It serves the prototype front-end and exposes the first persistence layer for
customers, vehicles, work orders, appointments, inventory, invoices, and AI
assistant requests.
"""
from __future__ import annotations

import base64
import csv
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import sqlite3
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, date

try:
    import psycopg
    from psycopg.rows import tuple_row
except ImportError:
    psycopg = None
    tuple_row = None
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("GARAGEAI_DB_PATH", os.path.join(ROOT, "garageai.db"))
UPLOAD_DIR = Path(ROOT) / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
PORT = int(os.environ.get("PORT", "4173"))

ROLE_PERMISSIONS = {
    "Owner": {"*"},
    "Advisor": {"customers:read", "appointments:read", "appointments:write", "billing:read", "billing:write", "work_orders:read", "work_orders:write", "notifications:send", "integrations:use", "vehicle:decode", "suppliers:search", "assistant:use"},
    "Mechanic": {"work_orders:read", "work_orders:write", "inventory:read", "inventory:write", "vehicle:decode", "suppliers:search", "assistant:use"},
    "Apprentice": {"work_orders:read", "inventory:read", "assistant:use"},
}


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000).hex()
    return f"{salt}${digest}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        salt, expected = encoded.split("$", 1)
    except ValueError:
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000).hex()
    return hmac.compare_digest(actual, expected)


def permissions_for(role: str):
    return sorted(ROLE_PERMISSIONS.get(role, set()))


def has_permission(user, permission: str) -> bool:
    return user and ("*" in ROLE_PERMISSIONS.get(user["role"], set()) or permission in ROLE_PERMISSIONS.get(user["role"], set()))


def integration_config():
    checks = {
        "twilio": bool(os.getenv("TWILIO_ACCOUNT_SID") and os.getenv("TWILIO_AUTH_TOKEN")),
        "payments": bool((os.getenv("RAZORPAY_KEY_ID") and os.getenv("RAZORPAY_KEY_SECRET")) or os.getenv("STRIPE_SECRET_KEY")),
        "accounting": bool((os.getenv("QUICKBOOKS_CLIENT_ID") and os.getenv("QUICKBOOKS_CLIENT_SECRET")) or os.getenv("ZOHO_CLIENT_ID")),
        "vin": True,
        "suppliers": bool(os.getenv("PARTS_SUPPLIER_API_KEY")),
        "maps": bool(os.getenv("GOOGLE_MAPS_API_KEY")),
        "database": bool(os.getenv("DATABASE_URL")),
    }
    return checks


class PGRow(dict):
    """Mapping row with sqlite-style integer indexing for shared query code."""
    def __init__(self, keys, values):
        super().__init__(zip(keys, values))
        self._values = tuple(values)

    def __getitem__(self, key):
        if isinstance(key, int):
            return self._values[key]
        return super().__getitem__(key)


class PGCursor:
    def __init__(self, cursor, returning=False):
        self.cursor = cursor
        self._keys = [getattr(x, "name", x[0] if isinstance(x, (tuple, list)) else str(x)) for x in (cursor.description or [])] if cursor else []
        self._cached = None
        if returning and cursor:
            self._cached = cursor.fetchone()

    def _wrap(self, row):
        return PGRow(self._keys, row) if row is not None else None

    def fetchone(self):
        if self._cached is not None:
            row, self._cached = self._cached, None
            return self._wrap(row)
        return self._wrap(self.cursor.fetchone())

    def fetchall(self):
        rows = []
        if self._cached is not None:
            rows.append(self._cached)
            self._cached = None
        rows.extend(self.cursor.fetchall())
        return [self._wrap(row) for row in rows]

    @property
    def lastrowid(self):
        if self._cached is not None:
            return self._cached[0]
        return None

    @property
    def rowcount(self):
        return self.cursor.rowcount if self.cursor else 0


class PGConnection:
    def __init__(self, url):
        self.raw = psycopg.connect(url, row_factory=tuple_row)

    @staticmethod
    def _sql(sql):
        return sql.replace("?", "%s")

    def execute(self, sql, params=()):
        clean = sql.strip()
        if clean.upper().startswith("PRAGMA"):
            return PGCursor(None)
        returning = False
        if clean.upper().startswith("INSERT INTO") and "RETURNING" not in clean.upper():
            table_match = re.match(r"INSERT\s+INTO\s+(customers|vehicles|employees|parts|appointments|notifications|work_order_media|audit_log|estimate_approvals)\b", clean, re.I)
            if table_match:
                sql = sql.rstrip().rstrip(";") + " RETURNING id"
                returning = True
        cursor = self.raw.cursor()
        cursor.execute(self._sql(sql), tuple(params or ()))
        return PGCursor(cursor, returning=returning)

    def executescript(self, _sql):
        schema = Path(ROOT, "schema.sql").read_text()
        self.raw.execute(schema)

    def commit(self):
        self.raw.commit()

    def close(self):
        self.raw.close()


def send_twilio_message(channel: str, recipient: str, message: str):
    sid = os.getenv("TWILIO_ACCOUNT_SID")
    token = os.getenv("TWILIO_AUTH_TOKEN")
    if not (sid and token):
        return {"sent": False, "mode": "setup", "message": "Twilio credentials are not configured"}
    sender = os.getenv("TWILIO_WHATSAPP_FROM") if channel.lower() == "whatsapp" else os.getenv("TWILIO_SMS_FROM")
    if not sender:
        return {"sent": False, "mode": "setup", "message": "Twilio sender is not configured"}
    destination = recipient
    if channel.lower() == "whatsapp" and not destination.startswith("whatsapp:"):
        destination = f"whatsapp:{destination}"
    endpoint = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
    payload = urllib.parse.urlencode({"From": sender, "To": destination, "Body": message}).encode()
    auth = base64.b64encode(f"{sid}:{token}".encode()).decode()
    request = urllib.request.Request(endpoint, data=payload, headers={"Authorization": f"Basic {auth}"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            data = json.loads(response.read().decode("utf-8"))
        return {"sent": True, "mode": "live", "provider_id": data.get("sid"), "status": data.get("status")}
    except Exception as exc:
        return {"sent": False, "mode": "live", "message": f"Twilio request failed: {exc.__class__.__name__}"}


def create_payment_checkout(payload):
    amount = float(payload.get("amount", 0) or 0)
    if amount <= 0:
        return {"ready": False, "mode": "error", "message": "A positive amount is required"}
    invoice_id = str(payload.get("invoice_id", "invoice"))
    description = str(payload.get("description", f"GarageAI invoice {invoice_id}"))
    public_url = os.getenv("APP_PUBLIC_URL", "http://localhost:4173")

    razor_id = os.getenv("RAZORPAY_KEY_ID")
    razor_secret = os.getenv("RAZORPAY_KEY_SECRET")
    if razor_id and razor_secret:
        endpoint = "https://api.razorpay.com/v1/orders"
        order_payload = urllib.parse.urlencode({"amount": int(round(amount * 100)), "currency": "INR", "receipt": invoice_id, "notes[description]": description}).encode()
        auth = base64.b64encode(f"{razor_id}:{razor_secret}".encode()).decode()
        request = urllib.request.Request(endpoint, data=order_payload, headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"}, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=12) as response:
                data = json.loads(response.read().decode("utf-8"))
            return {"ready": True, "provider": "razorpay", "mode": "live", "checkout_id": data.get("id"), "amount": amount, "currency": "INR", "public_key": razor_id}
        except Exception as exc:
            return {"ready": False, "provider": "razorpay", "mode": "live", "message": f"Razorpay request failed: {exc.__class__.__name__}"}

    stripe_key = os.getenv("STRIPE_SECRET_KEY")
    if stripe_key:
        fields = {
            "mode": "payment",
            "success_url": f"{public_url}/payment-success?invoice={invoice_id}",
            "cancel_url": f"{public_url}/payment-cancelled?invoice={invoice_id}",
            "line_items[0][price_data][currency]": "inr",
            "line_items[0][price_data][product_data][name]": description,
            "line_items[0][price_data][unit_amount]": str(int(round(amount * 100))),
            "line_items[0][quantity]": "1",
            "metadata[invoice_id]": invoice_id,
        }
        request = urllib.request.Request("https://api.stripe.com/v1/checkout/sessions", data=urllib.parse.urlencode(fields).encode(), headers={"Authorization": f"Bearer {stripe_key}", "Content-Type": "application/x-www-form-urlencoded"}, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=12) as response:
                data = json.loads(response.read().decode("utf-8"))
            return {"ready": True, "provider": "stripe", "mode": "live", "checkout_id": data.get("id"), "checkout_url": data.get("url"), "amount": amount, "currency": "INR"}
        except Exception as exc:
            return {"ready": False, "provider": "stripe", "mode": "live", "message": f"Stripe request failed: {exc.__class__.__name__}"}

    return {"ready": False, "mode": "setup", "amount": amount, "currency": "INR", "message": "Configure Razorpay or Stripe credentials to enable checkout"}


def notification_result(row):
    return row_dict(row) if row else None


def deliver_notification(conn, notification_id):
    row = conn.execute("SELECT * FROM notifications WHERE id = ?", (notification_id,)).fetchone()
    if not row:
        return None
    if row["status"] == "Sent":
        return {"notification": notification_result(row), "delivery": {"sent": True, "message": "Already delivered"}}
    attempts = int(row["attempts"] or 0) + 1
    if row["channel"].lower() in ("whatsapp", "sms"):
        delivery = send_twilio_message(row["channel"], row["recipient"], row["message"])
    else:
        delivery = {"sent": False, "mode": "setup", "message": f"No adapter for {row['channel']}"}
    sent = bool(delivery.get("sent"))
    status = "Sent" if sent else ("Failed" if attempts >= int(row["max_attempts"] or 3) or delivery.get("mode") == "setup" else "Queued")
    conn.execute("UPDATE notifications SET status = ?, attempts = ?, last_error = ?, sent_at = ? WHERE id = ?", (status, attempts, None if sent else delivery.get("message"), now_iso() if sent else None, notification_id))
    conn.commit()
    updated = conn.execute("SELECT * FROM notifications WHERE id = ?", (notification_id,)).fetchone()
    return {"notification": notification_result(updated), "delivery": delivery}


def queue_notification(conn, payload, send_now=False):
    scheduled = payload.get("scheduled_for") or now_iso()
    status = "Blocked" if payload.get("opted_in") is False else "Queued"
    cur = conn.execute("INSERT INTO notifications (customer_id, work_order_id, appointment_id, type, channel, recipient, subject, message, status, attempts, max_attempts, scheduled_for, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (payload.get("customer_id"), payload.get("work_order_id"), payload.get("appointment_id"), payload.get("type", "Customer update"), payload.get("channel", "WhatsApp"), payload.get("recipient", ""), payload.get("subject"), payload.get("message", ""), status, 0, payload.get("max_attempts", 3), scheduled, now_iso()))
    conn.commit()
    notification_id = cur.lastrowid
    if status == "Blocked":
        row = conn.execute("SELECT * FROM notifications WHERE id = ?", (notification_id,)).fetchone()
        return {"notification": notification_result(row), "delivery": {"sent": False, "mode": "policy", "message": "Customer has not opted in to service updates"}}
    return deliver_notification(conn, notification_id) if send_now else {"notification": notification_result(conn.execute("SELECT * FROM notifications WHERE id = ?", (notification_id,)).fetchone()), "delivery": {"sent": False, "mode": "queued"}}


def notification_metrics(conn):
    today = now_iso()[:10]
    queued = conn.execute("SELECT COUNT(*) AS count FROM notifications WHERE status = 'Queued'").fetchone()["count"]
    sent_today = conn.execute("SELECT COUNT(*) AS count FROM notifications WHERE status = 'Sent' AND sent_at LIKE ?", (f"{today}%",)).fetchone()["count"]
    failed = conn.execute("SELECT COUNT(*) AS count FROM notifications WHERE status = 'Failed'").fetchone()["count"]
    delivered = conn.execute("SELECT COUNT(*) AS count FROM notifications WHERE status = 'Sent'").fetchone()["count"]
    total = conn.execute("SELECT COUNT(*) AS count FROM notifications WHERE status IN ('Sent', 'Failed')").fetchone()["count"]
    return {"queued": queued, "sent_today": sent_today, "failed": failed, "delivery_rate": round((delivered / total) * 100) if total else 0}


def connect():
    database_url = os.getenv("DATABASE_URL", "").strip()
    if database_url.startswith(("postgres://", "postgresql://")):
        if psycopg is None:
            raise RuntimeError("DATABASE_URL is set, but psycopg is not installed. Run pip install -r requirements.txt.")
        return PGConnection(database_url)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    conn = connect()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL,
          active INTEGER DEFAULT 1,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS customers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          phone TEXT,
          email TEXT,
          address TEXT,
          preferred_contact TEXT DEFAULT 'WhatsApp',
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS vehicles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_id INTEGER NOT NULL REFERENCES customers(id),
          year INTEGER,
          make TEXT,
          model TEXT,
          trim TEXT,
          engine TEXT,
          transmission TEXT,
          color TEXT,
          plate TEXT,
          vin TEXT,
          mileage INTEGER DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS employees (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          role TEXT NOT NULL,
          specializations TEXT,
          hourly_rate REAL DEFAULT 0,
          status TEXT DEFAULT 'Available'
        );
        CREATE TABLE IF NOT EXISTS work_orders (
          id TEXT PRIMARY KEY,
          customer_id INTEGER REFERENCES customers(id),
          vehicle_id INTEGER REFERENCES vehicles(id),
          employee_id INTEGER REFERENCES employees(id),
          bay_number INTEGER,
          status TEXT NOT NULL DEFAULT 'Received',
          priority TEXT NOT NULL DEFAULT 'Normal',
          complaint TEXT,
          diagnosis TEXT,
          estimated_completion TEXT,
          total REAL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS appointments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_id INTEGER REFERENCES customers(id),
          vehicle_id INTEGER REFERENCES vehicles(id),
          service_type TEXT NOT NULL,
          appointment_date TEXT NOT NULL,
          appointment_time TEXT NOT NULL,
          duration_minutes INTEGER DEFAULT 60,
          bay INTEGER,
          status TEXT DEFAULT 'Booked',
          notes TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS parts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          part_number TEXT,
          category TEXT,
          quantity INTEGER DEFAULT 0,
          min_stock INTEGER DEFAULT 0,
          cost REAL DEFAULT 0,
          sell_price REAL DEFAULT 0,
          supplier TEXT,
          location TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS invoices (
          id TEXT PRIMARY KEY,
          work_order_id TEXT REFERENCES work_orders(id),
          customer_id INTEGER REFERENCES customers(id),
          subtotal REAL DEFAULT 0,
          tax REAL DEFAULT 0,
          discount REAL DEFAULT 0,
          total REAL DEFAULT 0,
          status TEXT DEFAULT 'Draft',
          payment_method TEXT,
          created_at TEXT NOT NULL,
          paid_at TEXT
        );
        CREATE TABLE IF NOT EXISTS estimate_approvals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          work_order_id TEXT NOT NULL REFERENCES work_orders(id),
          customer_id INTEGER REFERENCES customers(id),
          status TEXT NOT NULL DEFAULT 'Awaiting approval',
          approved_items TEXT,
          approved_by TEXT,
          approved_at TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_id INTEGER REFERENCES customers(id),
          work_order_id TEXT REFERENCES work_orders(id),
          appointment_id INTEGER REFERENCES appointments(id),
          type TEXT NOT NULL,
          channel TEXT NOT NULL DEFAULT 'WhatsApp',
          recipient TEXT NOT NULL,
          subject TEXT,
          message TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'Queued',
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 3,
          last_error TEXT,
          scheduled_for TEXT NOT NULL,
          sent_at TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS work_order_media (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          work_order_id TEXT NOT NULL REFERENCES work_orders(id),
          media_type TEXT NOT NULL DEFAULT 'photo',
          filename TEXT NOT NULL,
          mime_type TEXT,
          url TEXT NOT NULL,
          note TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          action TEXT NOT NULL,
          actor TEXT DEFAULT 'GarageAI',
          details TEXT,
          created_at TEXT NOT NULL
        );
        """
    )
    seed(conn)
    ensure_users(conn)
    ensure_notifications(conn)
    conn.commit()
    conn.close()


def ensure_users(conn: sqlite3.Connection) -> None:
    if conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] > 0:
        return
    demo_users = [
        ("owner", "Shiva Rajkumara R", "garage123", "Owner"),
        ("advisor", "Sandhesh", "advisor123", "Advisor"),
        ("mike", "Mike Thomas", "mike123", "Mechanic"),
        ("apprentice", "James Lee", "apprentice123", "Apprentice"),
    ]
    for username, name, password, role in demo_users:
        conn.execute("INSERT INTO users (username, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)", (username, name, hash_password(password), role, now_iso()))


def ensure_notifications(conn: sqlite3.Connection) -> None:
    if conn.execute("SELECT COUNT(*) FROM notifications").fetchone()[0] > 0:
        return
    now = now_iso()
    demo_notifications = [
        (1, "WO-2026-0048", None, "Estimate approval", "WhatsApp", "+91 98765 20101", "Estimate ready", "Your A/C service estimate of ₹ 8,450 is ready for approval.", "Queued", 0, 3, None, now, None, now),
        (2, "WO-2026-0047", None, "Repair update", "WhatsApp", "+91 98765 20102", "Repair update", "Your Toyota Innova has moved to quality check.", "Sent", 1, 3, None, now, now, now),
        (5, None, None, "Maintenance reminder", "SMS", "+91 98765 20105", "Maintenance reminder", "Your tire rotation is due soon. Book a convenient time.", "Failed", 3, 3, "Twilio credentials are not configured", now, None, now),
        (3, None, None, "Appointment reminder", "WhatsApp", "+91 98765 20103", "Appointment reminder", "Reminder: your service appointment is tomorrow at 10:00 AM.", "Sent", 1, 3, None, now, now, now),
    ]
    for item in demo_notifications:
        conn.execute("INSERT INTO notifications (customer_id, work_order_id, appointment_id, type, channel, recipient, subject, message, status, attempts, max_attempts, last_error, scheduled_for, sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", item)


def seed(conn: sqlite3.Connection) -> None:
    if conn.execute("SELECT COUNT(*) FROM customers").fetchone()[0] == 0:
        customers = [
            ("Ananya Rao", "+91 98765 20101", "ananya.rao@email.com", "Bengaluru", "WhatsApp"),
            ("Rohan Shah", "+91 98765 20102", "rohan.shah@email.com", "Bengaluru", "SMS"),
            ("Meera Nair", "+91 98765 20103", "meera.nair@email.com", "Bengaluru", "WhatsApp"),
            ("Vikram Singh", "+91 98765 20104", "vikram.singh@email.com", "Bengaluru", "Phone call"),
            ("Priya Menon", "+91 98765 20105", "priya.menon@email.com", "Bengaluru", "WhatsApp"),
        ]
        for item in customers:
            conn.execute("INSERT INTO customers (name, phone, email, address, preferred_contact, created_at) VALUES (?, ?, ?, ?, ?, ?)", (*item, now_iso()))
        vehicles = [
            (1, 2021, "Honda", "City", "VX", "1.5L i-VTEC", "Automatic", "Silver", "KA 03 MK 8271", "MAKGM6569M400001", 58420),
            (2, 2018, "Toyota", "Innova", "Crysta", "2.4L Diesel", "Manual", "White", "KA 05 MC 2190", "MBJBA3FS4J500002", 88410),
            (3, 2020, "Hyundai", "Creta", "SX", "1.5L Petrol", "Automatic", "Blue", "KA 04 NG 4102", "MALC3816LL600003", 64120),
            (4, 2017, "Ford", "EcoSport", "Titanium", "1.5L Diesel", "Manual", "Red", "KA 01 AB 7788", "MAJAXXMRKAH00004", 92350),
            (5, 2022, "Kia", "Seltos", "HTX", "1.5L Petrol", "Automatic", "White", "KA 02 PJ 6510", "MZBHA81AMLN00005", 32180),
        ]
        for v in vehicles:
            conn.execute("INSERT INTO vehicles (customer_id, year, make, model, trim, engine, transmission, color, plate, vin, mileage, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (*v, now_iso()))
        # In production, technicians do not need phone logins; the owner and advisor manage assignments.
        employees = [] if os.getenv("APP_ENV") == "production" else [("Mike Thomas", "Mechanic", "A/C, Diagnostics, Brakes", 850, "On job"), ("Carlos Reyes", "Mechanic", "Brakes, Suspension, Electrical", 850, "On job"), ("James Lee", "Mechanic", "Maintenance, Transmission", 750, "Available")]
        for e in employees:
            conn.execute("INSERT INTO employees (name, role, specializations, hourly_rate, status) VALUES (?, ?, ?, ?, ?)", e)
        work_orders = [
            ("WO-2026-0048", 1, 1, 1, 1, "In progress", "High", "A/C not cooling", "Refrigerant pressure and condenser fan inspection in progress", "Today, 4:30 PM", 8450),
            ("WO-2026-0047", 2, 2, 2, 2, "Quality check", "High", "Brake vibration", "Front brake pads replaced; final road test pending", "Today, 2:15 PM", 5800),
            ("WO-2026-0046", 3, 3, 3, 4, "Ready for pickup", "Normal", "Oil service + inspection", "Service completed and quality checked", "Ready now", 4250),
            ("WO-2026-0045", 4, 4, None, 3, "Awaiting parts", "Normal", "Check engine light", "Awaiting upstream oxygen sensor", "Parts: Tomorrow", 12900),
            ("WO-2026-0044", 5, 5, 3, 4, "Received", "Normal", "Periodic maintenance", "", "Today, 3:00 PM", 3600),
            ("WO-2026-0043", 5, 5, 1, None, "Diagnosing", "Emergency", "Steering noise", "Safety-critical inspection requested", "Today, 5:15 PM", 2100),
        ]
        for wo in work_orders:
            work_order_values = list(wo)
            if os.getenv("APP_ENV") == "production":
                work_order_values[3] = None
            conn.execute("INSERT INTO work_orders (id, customer_id, vehicle_id, employee_id, bay_number, status, priority, complaint, diagnosis, estimated_completion, total, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (*work_order_values, now_iso(), now_iso()))
        invoices = [
            ("INV-2026-0138", "WO-2026-0048", 1, 7200, 1250, 0, 8450, "Awaiting approval", None, None),
            ("INV-2026-0131", "WO-2026-0045", 4, 10932, 1968, 0, 12900, "Due", None, None),
            ("INV-2026-0124", "WO-2026-0043", 5, 6017, 1083, 0, 7100, "Overdue", None, None),
            ("INV-2026-0119", "WO-2026-0046", 3, 3602, 648, 0, 4250, "Paid", "Card", now_iso()),
        ]
        for inv in invoices:
            conn.execute("INSERT INTO invoices (id, work_order_id, customer_id, subtotal, tax, discount, total, status, payment_method, paid_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (*inv, now_iso()))
        parts = [
            ("Front brake pads · Universal", "BP-UNV-001", "Brakes", 3, 5, 850, 1800, "MGP Auto Parts", "A-1"),
            ("5W-30 Synthetic oil · 1L", "OL-5W30-01", "Fluids", 6, 20, 420, 700, "Castrol Distributor", "C-1"),
            ("Cabin air filter · Hyundai", "CF-HYU-004", "Filters", 2, 5, 550, 1100, "Bosch India", "D-3"),
            ("0W-20 Synthetic oil · 1L", "OL-0W20-01", "Fluids", 24, 20, 450, 600, "Castrol Distributor", "C-1"),
            ("Oil filter · Assorted", "OF-AST-001", "Filters", 18, 10, 150, 300, "MGP Auto Parts", "B-2"),
            ("Denso iridium spark plug", "SP-DEN-011", "Ignition", 16, 8, 240, 480, "Denso India", "B-4"),
            ("Wiper blades · Universal", "WB-UNV-001", "Exterior", 8, 5, 500, 850, "Bosch India", "E-1"),
        ]
        for p in parts:
            conn.execute("INSERT INTO parts (name, part_number, category, quantity, min_stock, cost, sell_price, supplier, location, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (*p, now_iso()))


def row_dict(row):
    return dict(row) if row else None


def work_order_view(conn, row):
    x = row_dict(row)
    customer = conn.execute("SELECT name FROM customers WHERE id = ?", (x.get("customer_id"),)).fetchone()
    vehicle = conn.execute("SELECT year, make, model, trim, plate FROM vehicles WHERE id = ?", (x.get("vehicle_id"),)).fetchone()
    employee = conn.execute("SELECT name FROM employees WHERE id = ?", (x.get("employee_id"),)).fetchone()
    vehicle_label = "Vehicle not assigned"
    plate = "—"
    if vehicle:
        vehicle_label = f"{vehicle['year']} {vehicle['make']} {vehicle['model']} {vehicle['trim'] or ''}".strip()
        plate = vehicle["plate"] or "—"
    return {
        "id": x["id"], "customer": customer["name"] if customer else "Walk-in customer",
        "vehicle": vehicle_label, "plate": plate, "issue": x["complaint"] or "General service",
        "status": x["status"], "priority": x["priority"], "mechanic": employee["name"] if employee else "Unassigned",
        "eta": x["estimated_completion"] or "To be confirmed", "total": f"₹ {x['total']:,.0f}",
        "bay": x["bay_number"], "diagnosis": x["diagnosis"] or "", "created_at": x["created_at"], "updated_at": x["updated_at"]
    }


def next_work_order_id(conn):
    year = datetime.now().year
    row = conn.execute("SELECT id FROM work_orders WHERE id LIKE ? ORDER BY id DESC LIMIT 1", (f"WO-{year}-%",)).fetchone()
    number = int(row["id"].split("-")[-1]) + 1 if row else 1
    return f"WO-{year}-{number:04d}"


def next_invoice_id(conn):
    year = datetime.now().year
    row = conn.execute("SELECT id FROM invoices WHERE id LIKE ? ORDER BY id DESC LIMIT 1", (f"INV-{year}-%",)).fetchone()
    number = int(row["id"].split("-")[-1]) + 1 if row else 1
    return f"INV-{year}-{number:04d}"


def json_bytes(data):
    return json.dumps(data, ensure_ascii=False).encode("utf-8")


def financial_report(conn):
    invoices = conn.execute("SELECT * FROM invoices ORDER BY created_at DESC").fetchall()
    total_invoiced = sum(float(row["total"] or 0) for row in invoices)
    paid_revenue = sum(float(row["total"] or 0) for row in invoices if row["status"] == "Paid")
    outstanding = sum(float(row["total"] or 0) for row in invoices if row["status"] != "Paid")
    methods = {}
    for row in invoices:
        method = row["payment_method"] or "Pending"
        methods[method] = methods.get(method, 0) + float(row["total"] or 0)
    inventory_cost = conn.execute("SELECT COALESCE(SUM(quantity * cost), 0) AS value FROM parts").fetchone()["value"]
    completed_jobs = conn.execute("SELECT COUNT(*) AS count FROM work_orders WHERE status IN ('Completed', 'Ready for pickup')").fetchone()["count"]
    return {
        "generated_at": now_iso(), "currency": "INR", "invoice_count": len(invoices),
        "total_invoiced": round(total_invoiced, 2), "paid_revenue": round(paid_revenue, 2),
        "outstanding": round(outstanding, 2), "inventory_cost": round(float(inventory_cost or 0), 2),
        "completed_jobs": completed_jobs, "payment_methods": {key: round(value, 2) for key, value in methods.items()},
        "estimated_gross_profit": round(paid_revenue - float(inventory_cost or 0), 2)
    }


def accounting_csv(conn, export_type="invoices"):
    output = io.StringIO()
    writer = csv.writer(output)
    if export_type == "inventory":
        writer.writerow(["part_name", "part_number", "category", "quantity", "minimum_stock", "cost", "sell_price", "supplier", "location"])
        rows = conn.execute("SELECT name, part_number, category, quantity, min_stock, cost, sell_price, supplier, location FROM parts ORDER BY name").fetchall()
        writer.writerows([[row[key] for key in row.keys()] for row in rows])
        return output.getvalue(), len(rows), "garageai_inventory.csv"
    writer.writerow(["invoice_id", "work_order_id", "customer_id", "subtotal", "tax", "discount", "total", "status", "payment_method", "created_at", "paid_at"])
    rows = conn.execute("SELECT id, work_order_id, customer_id, subtotal, tax, discount, total, status, payment_method, created_at, paid_at FROM invoices ORDER BY created_at DESC").fetchall()
    writer.writerows([[row[key] for key in row.keys()] for row in rows])
    return output.getvalue(), len(rows), "garageai_invoices.csv"


def marketing_status():
    return {"instagram": bool(os.getenv("META_ACCESS_TOKEN") and os.getenv("META_IG_USER_ID")), "facebook": bool(os.getenv("META_ACCESS_TOKEN") and os.getenv("META_PAGE_ID")), "youtube": bool(os.getenv("YOUTUBE_CLIENT_ID") and os.getenv("YOUTUBE_REFRESH_TOKEN"))}


def marketing_package(payload):
    topic = payload.get("topic", "Brake safety tips")
    language = payload.get("language", "English")
    cta = payload.get("cta", "Book an inspection")
    return {"title": topic, "hook": f"Before you drive again, check these 3 things about {topic.lower()}.", "voiceover": f"At Royal Car Service Center, we believe simple checks prevent expensive repairs. In this quick guide, our team shows you what to look for with {topic.lower()}. {cta}.", "caption": f"{topic}: useful advice from your local workshop. Save this reel and share it with someone who needs it. {cta} at Royal Car Service Center.", "hashtags": "#BengaluruCars #AutoCare #CarMaintenance #RoyalCarService", "shot_list": ["Workshop exterior and technician intro", "Close-up of the vehicle or inspected component", "Technician demonstrates the check", "End card with garage name and CTA"], "source_media": payload.get("source_media", []), "media_consent_confirmed": bool(payload.get("media_consent_confirmed", False)), "language": language, "requires_review": True, "format": "9:16 Reel"}


class Handler(BaseHTTPRequestHandler):
    server_version = "GarageAI/0.1"

    def log_message(self, fmt, *args):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {fmt % args}")

    def send_json(self, data, status=200):
        body = json_bytes(data)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, message, status=400):
        self.send_json({"error": message}, status)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise ValueError("Request body must be valid JSON")

    def authenticated_user(self):
        header = self.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return None
        token = header.split(" ", 1)[1].strip()
        if not token:
            return None
        conn = connect()
        try:
            row = conn.execute("SELECT u.id, u.username, u.name, u.role, u.active, s.token, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND u.active = 1", (token,)).fetchone()
            if not row or row["expires_at"] < now_iso():
                return None
            return row
        finally:
            conn.close()

    def require_api_access(self, path, permission=None):
        public = {"/api/health", "/api/auth/login"}
        if path in public:
            return True, None
        user = self.authenticated_user()
        if not user:
            self.send_error_json("Authentication required", 401)
            return False, None
        if permission and not has_permission(user, permission):
            self.send_error_json(f"Role {user['role']} is not permitted to perform this action", 403)
            return False, None
        return True, user

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        query = parse_qs(parsed.query)
        permission = None
        if path == "/api/summary" or path == "/api/reports/financial": permission = "reports:read"
        elif path == "/api/work-orders" or path.startswith("/api/work-orders/"): permission = "work_orders:read"
        elif path in ("/api/customers", "/api/vehicles"): permission = "customers:read"
        elif path == "/api/appointments": permission = "appointments:read"
        elif path == "/api/inventory": permission = "inventory:read"
        elif path == "/api/invoices": permission = "billing:read"
        elif path in ("/api/integrations", "/api/config/status"): permission = "integrations:use"
        elif path == "/api/notifications" or path == "/api/notifications/metrics": permission = "notifications:send"
        elif path == "/api/marketing/status" or path == "/api/marketing/posts": permission = "integrations:use"
        elif path == "/api/audit-log": permission = "*"
        if path.startswith("/api/"):
            allowed, auth_user = self.require_api_access(path, permission)
            if not allowed:
                return
        else:
            auth_user = None
        conn = connect()
        try:
            if path == "/api/auth/me":
                return self.send_json({"user": {"id": auth_user["id"], "username": auth_user["username"], "name": auth_user["name"], "role": auth_user["role"]}, "permissions": permissions_for(auth_user["role"])})
            if path == "/api/health":
                database_name = "postgresql" if os.getenv("DATABASE_URL", "").startswith(("postgres://", "postgresql://")) else os.path.basename(DB_PATH)
                return self.send_json({"ok": True, "service": "GarageAI API", "database": database_name, "environment": os.getenv("APP_ENV", "development"), "time": now_iso()})
            if path == "/api/summary":
                active = conn.execute("SELECT COUNT(*) FROM work_orders WHERE status NOT IN ('Completed')").fetchone()[0]
                waiting = conn.execute("SELECT COUNT(*) FROM work_orders WHERE status IN ('Awaiting parts', 'Awaiting approval')").fetchone()[0]
                low_stock = conn.execute("SELECT COUNT(*) FROM parts WHERE quantity <= min_stock").fetchone()[0]
                revenue = conn.execute("SELECT COALESCE(SUM(total), 0) FROM invoices WHERE status = 'Paid'").fetchone()[0]
                return self.send_json({"active_work_orders": active, "waiting_on_parts": waiting, "low_stock_parts": low_stock, "paid_revenue": revenue})
            if path == "/api/reports/financial":
                return self.send_json(financial_report(conn))
            if path == "/api/work-orders":
                rows = conn.execute("SELECT * FROM work_orders ORDER BY updated_at DESC").fetchall()
                items = [work_order_view(conn, r) for r in rows]
                status = query.get("status", [None])[0]
                search = query.get("search", [""])[0].lower()
                if status and status != "All status":
                    items = [x for x in items if x["status"] == status]
                if search:
                    items = [x for x in items if search in json.dumps(x).lower()]
                return self.send_json(items)
            if path.startswith("/api/work-orders/") and path.endswith("/media"):
                wo_id = path.split("/")[-2]
                rows = conn.execute("SELECT * FROM work_order_media WHERE work_order_id = ? ORDER BY created_at DESC", (wo_id,)).fetchall()
                return self.send_json([row_dict(x) for x in rows])
            if path.startswith("/api/work-orders/"):
                wo_id = path.split("/")[-1]
                row = conn.execute("SELECT * FROM work_orders WHERE id = ?", (wo_id,)).fetchone()
                return self.send_json(work_order_view(conn, row)) if row else self.send_error_json("Work order not found", 404)
            if path == "/api/customers":
                rows = conn.execute("SELECT c.*, COUNT(v.id) AS vehicle_count FROM customers c LEFT JOIN vehicles v ON v.customer_id = c.id GROUP BY c.id ORDER BY c.name").fetchall()
                return self.send_json([row_dict(x) for x in rows])
            if path == "/api/vehicles":
                rows = conn.execute("SELECT v.*, c.name AS customer_name FROM vehicles v JOIN customers c ON c.id = v.customer_id ORDER BY v.created_at DESC").fetchall()
                return self.send_json([row_dict(x) for x in rows])
            if path == "/api/appointments":
                rows = conn.execute("SELECT a.*, c.name AS customer_name, v.make, v.model, v.plate FROM appointments a LEFT JOIN customers c ON c.id = a.customer_id LEFT JOIN vehicles v ON v.id = a.vehicle_id ORDER BY appointment_date, appointment_time").fetchall()
                return self.send_json([row_dict(x) for x in rows])
            if path == "/api/inventory":
                rows = conn.execute("SELECT *, quantity <= min_stock AS low_stock FROM parts ORDER BY low_stock DESC, name").fetchall()
                return self.send_json([row_dict(x) for x in rows])
            if path == "/api/invoices":
                rows = conn.execute("SELECT i.*, c.name AS customer_name FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id ORDER BY i.created_at DESC").fetchall()
                return self.send_json([row_dict(x) for x in rows])
            if path == "/api/notifications":
                rows = conn.execute("SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100").fetchall()
                return self.send_json([row_dict(x) for x in rows])
            if path == "/api/notifications/metrics":
                return self.send_json(notification_metrics(conn))
            if path == "/api/marketing/status":
                configured = marketing_status()
                return self.send_json({"connected": configured, "accounts": [{"id": "instagram", "name": "Instagram", "handle": "Not connected", "status": "connected" if configured["instagram"] else "not_configured"}, {"id": "facebook", "name": "Facebook", "handle": "Not connected", "status": "connected" if configured["facebook"] else "not_configured"}, {"id": "youtube", "name": "YouTube", "handle": "Not connected", "status": "connected" if configured["youtube"] else "not_configured"}], "publishing_enabled": any(configured.values()), "approval_required": True})
            if path == "/api/marketing/posts":
                return self.send_json([{"id": "MKT-001", "title": "Brake inspection tips", "caption": "Helpful workshop draft · owner review required", "format": "Reel", "status": "Draft", "platforms": ["Instagram", "Facebook", "YouTube"], "scheduled_for": "Not scheduled"}, {"id": "MKT-002", "title": "Monsoon readiness check", "caption": "Scheduled educational short", "format": "Short", "status": "Scheduled", "platforms": ["Instagram", "YouTube"], "scheduled_for": "Sep 14 · 11:00 AM"}])
            if path == "/api/integrations": 
                configured = integration_config()
                return self.send_json([
                    {"id": "twilio", "name": "SMS & WhatsApp", "provider": "Twilio", "status": "connected" if configured["twilio"] else "not_configured"},
                    {"id": "payments", "name": "Payments", "provider": "Razorpay / Stripe", "status": "connected" if configured["payments"] else "not_configured"},
                    {"id": "accounting", "name": "Accounting", "provider": "QuickBooks / Zoho Books", "status": "connected" if configured["accounting"] else "not_configured"},
                    {"id": "vin", "name": "VIN & vehicle data", "provider": "NHTSA / OEM data", "status": "connected"},
                    {"id": "suppliers", "name": "Parts suppliers", "provider": "MGP / Bosch / Boodmo", "status": "connected" if configured["suppliers"] else "not_configured"},
                    {"id": "maps", "name": "Maps & directions", "provider": "Google Maps", "status": "connected" if configured["maps"] else "not_configured"}
                ])
            if path == "/api/config/status":
                configured = integration_config()
                return self.send_json({"environment": os.getenv("APP_ENV", "development"), "database": "postgres_configured" if configured["database"] else "sqlite_local", "integrations": configured, "ready_for_production": configured["database"] and configured["twilio"] and configured["payments"]})
            if path == "/api/audit-log": 
                rows = conn.execute("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100").fetchall()
                return self.send_json([row_dict(x) for x in rows])
            # Let the same server host the front-end.
            return self.serve_static(path)
        finally:
            conn.close()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        try:
            payload = self.read_json()
        except ValueError as exc:
            return self.send_error_json(str(exc), 422)
        permission = None
        if path == "/api/customers" or path == "/api/vehicles": permission = "customers:write"
        elif path == "/api/work-orders" or (path.startswith("/api/work-orders/") and path.endswith("/media")): permission = "work_orders:write"
        elif path == "/api/appointments": permission = "appointments:write"
        elif path == "/api/inventory": permission = "inventory:write"
        elif path == "/api/invoices": permission = "billing:write"
        elif path.startswith("/api/estimates/"): permission = "work_orders:write"
        elif path == "/api/assistant": permission = "assistant:use"
        elif path.startswith("/api/integrations/") or path == "/api/accounting/export" or path == "/api/accounting/sync": permission = "integrations:use"
        elif path == "/api/reports/close-day": permission = "reports:read"
        elif path in ("/api/notifications/send", "/api/notifications/queue", "/api/notifications/run-scheduler") or path.startswith("/api/notifications/retry/"): permission = "notifications:send"
        elif path == "/api/marketing/generate" or path == "/api/marketing/connect" or path.startswith("/api/marketing/posts/"): permission = "integrations:use"
        elif path == "/api/payments/checkout": permission = "billing:write"
        elif path == "/api/vehicle/decode": permission = "vehicle:decode"
        elif path == "/api/suppliers/search": permission = "suppliers:search"
        allowed, auth_user = self.require_api_access(path, permission)
        if not allowed:
            return
        conn = connect()
        try:
            if path == "/api/auth/login":
                username = str(payload.get("username", "")).strip()
                password = str(payload.get("password", ""))
                row = conn.execute("SELECT * FROM users WHERE username = ? AND active = 1", (username,)).fetchone()
                if not row or not verify_password(password, row["password_hash"]):
                    return self.send_error_json("Invalid username or password", 401)
                requested_role = str(payload.get("role", "")).strip()
                if requested_role and requested_role != row["role"]:
                    return self.send_error_json(f"This account is configured as {row['role']}. Use the matching account or change the selected role.", 403)
                token = secrets.token_urlsafe(32)
                expires = datetime.fromtimestamp(datetime.now().timestamp() + 8 * 60 * 60).isoformat(timespec="seconds")
                conn.execute("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)", (token, row["id"], expires, now_iso()))
                conn.commit()
                return self.send_json({"token": token, "user": {"id": row["id"], "username": row["username"], "name": row["name"], "role": row["role"]}, "permissions": permissions_for(row["role"]), "expires_at": expires})
            if path == "/api/auth/logout":
                token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
                conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
                conn.commit()
                return self.send_json({"ok": True})
            if path == "/api/customers": 
                if not payload.get("name"):
                    return self.send_error_json("Customer name is required")
                cur = conn.execute("INSERT INTO customers (name, phone, email, address, preferred_contact, created_at) VALUES (?, ?, ?, ?, ?, ?)", (payload["name"], payload.get("phone"), payload.get("email"), payload.get("address"), payload.get("preferred_contact", "WhatsApp"), now_iso()))
                conn.execute("INSERT INTO audit_log (entity_type, entity_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)", ("customer", str(cur.lastrowid), "created", json.dumps(payload), now_iso()))
                conn.commit()
                return self.send_json(row_dict(conn.execute("SELECT * FROM customers WHERE id = ?", (cur.lastrowid,)).fetchone()), 201)
            if path == "/api/vehicles":
                required = ["customer_id", "make", "model"]
                if any(not payload.get(x) for x in required):
                    return self.send_error_json("customer_id, make, and model are required")
                cur = conn.execute("INSERT INTO vehicles (customer_id, year, make, model, trim, engine, transmission, color, plate, vin, mileage, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (payload["customer_id"], payload.get("year"), payload["make"], payload["model"], payload.get("trim"), payload.get("engine"), payload.get("transmission"), payload.get("color"), payload.get("plate"), payload.get("vin"), payload.get("mileage", 0), now_iso()))
                conn.commit()
                return self.send_json(row_dict(conn.execute("SELECT * FROM vehicles WHERE id = ?", (cur.lastrowid,)).fetchone()), 201)
            if path == "/api/work-orders":
                wo_id = next_work_order_id(conn)
                customer_id = payload.get("customer_id")
                vehicle_id = payload.get("vehicle_id")
                # Convenient MVP path for the prototype: accept display labels and create a walk-in profile.
                if not customer_id and payload.get("customer_name"):
                    cur = conn.execute("INSERT INTO customers (name, phone, email, preferred_contact, created_at) VALUES (?, ?, ?, ?, ?)", (payload["customer_name"], payload.get("phone"), payload.get("email"), "WhatsApp", now_iso()))
                    customer_id = cur.lastrowid
                if not customer_id:
                    customer_id = 1
                cur = conn.execute("INSERT INTO work_orders (id, customer_id, vehicle_id, employee_id, bay_number, status, priority, complaint, diagnosis, estimated_completion, total, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (wo_id, customer_id, vehicle_id, payload.get("employee_id"), payload.get("bay_number"), payload.get("status", "Received"), payload.get("priority", "Normal"), payload.get("complaint") or payload.get("issue", "General service"), payload.get("diagnosis", ""), payload.get("estimated_completion", "To be confirmed"), float(payload.get("total", 0) or 0), now_iso(), now_iso()))
                conn.execute("INSERT INTO audit_log (entity_type, entity_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)", ("work_order", wo_id, "created", json.dumps(payload), now_iso()))
                conn.commit()
                return self.send_json(work_order_view(conn, conn.execute("SELECT * FROM work_orders WHERE id = ?", (wo_id,)).fetchone()), 201)
            if path == "/api/appointments":
                for field in ("service_type", "appointment_date", "appointment_time"):
                    if not payload.get(field):
                        return self.send_error_json(f"{field} is required")
                cur = conn.execute("INSERT INTO appointments (customer_id, vehicle_id, service_type, appointment_date, appointment_time, duration_minutes, bay, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (payload.get("customer_id"), payload.get("vehicle_id"), payload["service_type"], payload["appointment_date"], payload["appointment_time"], payload.get("duration_minutes", 60), payload.get("bay"), payload.get("status", "Booked"), payload.get("notes"), now_iso()))
                conn.execute("INSERT INTO audit_log (entity_type, entity_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)", ("appointment", str(cur.lastrowid), "created", json.dumps(payload), now_iso()))
                conn.commit()
                return self.send_json(row_dict(conn.execute("SELECT * FROM appointments WHERE id = ?", (cur.lastrowid,)).fetchone()), 201)
            if path == "/api/inventory":
                if not payload.get("name"):
                    return self.send_error_json("Part name is required")
                cur = conn.execute("INSERT INTO parts (name, part_number, category, quantity, min_stock, cost, sell_price, supplier, location, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (payload["name"], payload.get("part_number"), payload.get("category"), payload.get("quantity", 0), payload.get("min_stock", 0), payload.get("cost", 0), payload.get("sell_price", 0), payload.get("supplier"), payload.get("location"), now_iso()))
                conn.execute("INSERT INTO audit_log (entity_type, entity_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)", ("part", str(cur.lastrowid), "created", json.dumps(payload), now_iso()))
                conn.commit()
                return self.send_json(row_dict(conn.execute("SELECT * FROM parts WHERE id = ?", (cur.lastrowid,)).fetchone()), 201)
            if path == "/api/invoices":
                invoice_id = next_invoice_id(conn)
                subtotal = float(payload.get("subtotal", 0) or 0)
                tax = float(payload.get("tax", 0) or 0)
                discount = float(payload.get("discount", 0) or 0)
                total = float(payload.get("total", subtotal + tax - discount) or 0)
                conn.execute("INSERT INTO invoices (id, work_order_id, customer_id, subtotal, tax, discount, total, status, payment_method, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (invoice_id, payload.get("work_order_id"), payload.get("customer_id"), subtotal, tax, discount, total, payload.get("status", "Draft"), payload.get("payment_method"), now_iso()))
                conn.commit()
                return self.send_json(row_dict(conn.execute("SELECT * FROM invoices WHERE id = ?", (invoice_id,)).fetchone()), 201)
            if path.startswith("/api/work-orders/") and path.endswith("/media"):
                wo_id = path.split("/")[-2]
                work_order = conn.execute("SELECT id FROM work_orders WHERE id = ?", (wo_id,)).fetchone()
                if not work_order:
                    return self.send_error_json("Work order not found", 404)
                data_url = str(payload.get("data_url", ""))
                if not data_url.startswith("data:") or "," not in data_url:
                    return self.send_error_json("data_url image payload is required")
                header, encoded = data_url.split(",", 1)
                mime = header.split(";", 1)[0].replace("data:", "") or "image/jpeg"
                if mime not in ("image/jpeg", "image/png", "image/webp"):
                    return self.send_error_json("Only JPEG, PNG, and WebP images are supported")
                try:
                    raw = base64.b64decode(encoded, validate=True)
                except Exception:
                    return self.send_error_json("Invalid image payload")
                if len(raw) > 8 * 1024 * 1024:
                    return self.send_error_json("Image must be smaller than 8 MB")
                ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[mime]
                filename = f"{uuid.uuid4().hex}.{ext}"
                (UPLOAD_DIR / filename).write_bytes(raw)
                cur = conn.execute("INSERT INTO work_order_media (work_order_id, media_type, filename, mime_type, url, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", (wo_id, "photo", filename, mime, f"/uploads/{filename}", payload.get("note", ""), now_iso()))
                conn.execute("INSERT INTO audit_log (entity_type, entity_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)", ("work_order", wo_id, "photo_added", json.dumps({"filename": filename, "note": payload.get("note", "")}), now_iso()))
                conn.commit()
                return self.send_json(row_dict(conn.execute("SELECT * FROM work_order_media WHERE id = ?", (cur.lastrowid,)).fetchone()), 201)
            if path.startswith("/api/estimates/") and path.endswith("/approve"):
                wo_id = path.split("/")[-2]
                wo = conn.execute("SELECT id, customer_id FROM work_orders WHERE id = ?", (wo_id,)).fetchone()
                if not wo:
                    return self.send_error_json("Work order not found", 404)
                approved = bool(payload.get("approved", True))
                status = "Approved" if approved else "Declined"
                conn.execute("INSERT INTO estimate_approvals (work_order_id, customer_id, status, approved_items, approved_by, approved_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", (wo_id, wo["customer_id"], status, json.dumps(payload.get("approved_items", [])), payload.get("approved_by", "Customer"), now_iso() if approved else None, now_iso()))
                conn.execute("INSERT INTO audit_log (entity_type, entity_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)", ("estimate", wo_id, status.lower(), json.dumps(payload), now_iso()))
                conn.commit()
                return self.send_json({"work_order_id": wo_id, "status": status, "approved_at": now_iso() if approved else None})
            if path == "/api/marketing/generate":
                package = marketing_package(payload)
                conn.execute("INSERT INTO audit_log (entity_type, entity_id, action, actor, details, created_at) VALUES (?, ?, ?, ?, ?, ?)", ("marketing_draft", str(uuid.uuid4()), "generated", auth_user["username"], json.dumps({"topic": payload.get("topic"), "language": payload.get("language"), "format": payload.get("format")}), now_iso()))
                conn.commit()
                return self.send_json({"status": "draft", "package": package, "generated_at": now_iso(), "note": "AI draft only. Owner approval is required before publishing."}, 201)
            if path == "/api/marketing/connect":
                account = str(payload.get("account", "")).lower()
                configured = marketing_status().get(account, False)
                return self.send_json({"account": account, "status": "connected" if configured else "needs_credentials", "mode": "live" if configured else "setup", "message": "Account connector is ready" if configured else "Add Meta or YouTube OAuth credentials before connecting."})
            if path.startswith("/api/marketing/posts/") and path.endswith("/approve"):
                if auth_user["role"] != "Owner":
                    return self.send_error_json("Only the owner can approve marketing content for publishing", 403)
                post_id = path.split("/")[-2]
                approved_at = now_iso()
                conn.execute("INSERT INTO audit_log (entity_type, entity_id, action, actor, details, created_at) VALUES (?, ?, ?, ?, ?, ?)", ("marketing_post", post_id, "approved", auth_user["username"], json.dumps({"approval_required": True}), approved_at))
                conn.commit()
                return self.send_json({"id": post_id, "status": "Approved", "approved_by": auth_user["name"], "approved_at": approved_at, "message": "Approved for scheduling. Publishing remains disabled until the channel OAuth connector is configured."})
            if path.startswith("/api/marketing/posts/") and path.endswith("/publish"):
                post_id = path.split("/")[-2]
                approval = conn.execute("SELECT id FROM audit_log WHERE entity_type = 'marketing_post' AND entity_id = ? AND action = 'approved' ORDER BY created_at DESC LIMIT 1", (post_id,)).fetchone()
                if not approval:
                    return self.send_json({"id": post_id, "status": "Blocked", "mode": "policy", "message": "Owner approval is required before publishing."}, 409)
                configured = marketing_status()
                if not any(configured.values()):
                    conn.execute("INSERT INTO audit_log (entity_type, entity_id, action, actor, details, created_at) VALUES (?, ?, ?, ?, ?, ?)", ("marketing_post", post_id, "publish_blocked", auth_user["username"], json.dumps({"reason": "provider_credentials_missing"}), now_iso()))
                    conn.commit()
                    return self.send_json({"id": post_id, "status": "Blocked", "mode": "setup", "message": "Publishing is blocked until Meta and/or YouTube OAuth credentials are configured."}, 409)
                conn.execute("INSERT INTO audit_log (entity_type, entity_id, action, actor, details, created_at) VALUES (?, ?, ?, ?, ?, ?)", ("marketing_post", post_id, "publish_queued", auth_user["username"], json.dumps({"channels": [name for name, ready in configured.items() if ready]}), now_iso()))
                conn.commit()
                return self.send_json({"id": post_id, "status": "Queued", "mode": "live", "message": "Queued for provider upload and status polling."})
            if path == "/api/integrations/test":
                integration_id = str(payload.get("integration_id", "")).strip()
                if not integration_id:
                    return self.send_error_json("integration_id is required")
                configured = integration_config().get(integration_id, False)
                return self.send_json({"integration_id": integration_id, "ok": configured, "configured": configured, "message": "Connection test passed" if configured else "Provider credentials are not configured", "tested_at": now_iso()})
            if path == "/api/integrations/connect":
                integration_id = str(payload.get("integration_id", "")).strip()
                configured = integration_config().get(integration_id, False)
                return self.send_json({"integration_id": integration_id, "status": "connected" if configured else "needs_credentials", "mode": "live" if configured else "setup", "message": "Connector is ready" if configured else "Add provider credentials to the environment before connecting."})
            if path in ("/api/notifications/queue", "/api/notifications/send"):
                if not payload.get("message"):
                    return self.send_error_json("message is required")
                result = queue_notification(conn, payload, send_now=path.endswith("/send"))
                conn.execute("INSERT INTO audit_log (entity_type, entity_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)", ("notification", str(result["notification"]["id"]), "sent_attempted" if path.endswith("/send") else "queued", json.dumps(payload), now_iso()))
                conn.commit()
                return self.send_json({"queued": result["notification"]["status"] != "Sent", "channel": result["notification"]["channel"], "recipient": result["notification"]["recipient"], "delivery": result["delivery"], "notification": result["notification"], "queued_at": now_iso()})
            if path.startswith("/api/notifications/retry/"):
                try:
                    notification_id = int(path.split("/")[-1])
                except ValueError:
                    return self.send_error_json("Invalid notification id", 422)
                result = deliver_notification(conn, notification_id)
                return self.send_json(result) if result else self.send_error_json("Notification not found", 404)
            if path == "/api/notifications/run-scheduler":
                due = conn.execute("SELECT id FROM notifications WHERE status IN ('Queued', 'Failed') AND attempts < max_attempts AND scheduled_for <= ? ORDER BY scheduled_for LIMIT 25", (now_iso(),)).fetchall()
                results = [deliver_notification(conn, row["id"]) for row in due]
                return self.send_json({"processed": len(results), "sent": sum(1 for item in results if item and item["notification"]["status"] == "Sent"), "results": results, "metrics": notification_metrics(conn)})
            if path == "/api/payments/checkout":
                return self.send_json(create_payment_checkout(payload))
            if path == "/api/vehicle/decode":
                vin = re.sub(r"[^A-Za-z0-9]", "", str(payload.get("vin", "")).upper())
                if len(vin) < 11:
                    return self.send_error_json("Enter a VIN with at least 11 characters")
                known = {
                    "4T1B11HK5KU": {"year": 2019, "make": "Toyota", "model": "Camry", "trim": "SE", "engine": "2.5L 4-Cyl", "transmission": "Automatic"},
                    "MAKGM6569M4": {"year": 2021, "make": "Honda", "model": "City", "trim": "VX", "engine": "1.5L i-VTEC", "transmission": "Automatic"}
                }
                decoded = next((value for key, value in known.items() if vin.startswith(key)), {"year": None, "make": "Lookup required", "model": "Vehicle", "trim": "", "engine": "OEM data required", "transmission": ""})
                return self.send_json({"vin": vin, "decoded": decoded, "source": "GarageAI demo decoder", "requires_verification": True})
            if path == "/api/suppliers/search":
                query = str(payload.get("query", "")).strip() or "brake pads"
                return self.send_json({"query": query, "mode": "demo", "results": [{"supplier": "MGP Auto Parts", "part_number": "BP-UNV-001", "availability": "In stock", "price": 850, "eta": "Tomorrow"}, {"supplier": "Bosch India", "part_number": "0986AB1234", "availability": "In stock", "price": 920, "eta": "2 days"}]})
            if path == "/api/accounting/export":
                export_type = payload.get("type", "invoices")
                csv_text, record_count, filename = accounting_csv(conn, "inventory" if export_type == "inventory" else "invoices")
                return self.send_json({"export_id": f"export_{int(datetime.now().timestamp())}", "type": export_type, "status": "prepared", "mode": "csv_local", "filename": filename, "record_count": record_count, "csv": csv_text, "message": "Accounting CSV prepared for QuickBooks or Zoho Books."})
            if path == "/api/accounting/sync":
                configured = integration_config()["accounting"]
                return self.send_json({"status": "ready" if configured else "needs_credentials", "provider": "QuickBooks / Zoho Books", "mode": "live" if configured else "setup", "message": "Accounting sync is ready" if configured else "Configure accounting OAuth credentials before syncing."})
            if path == "/api/reports/close-day":
                report = financial_report(conn)
                conn.execute("INSERT INTO audit_log (entity_type, entity_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)", ("financial_report", datetime.now().strftime("%Y-%m-%d"), "day_closed", json.dumps(report), now_iso()))
                conn.commit()
                return self.send_json({"status": "closed", "report": report, "message": "End-of-day report recorded in the audit log."})
            if path == "/api/assistant":
                prompt = str(payload.get("prompt", "")).strip()
                return self.send_json({"answer": assistant_answer(prompt), "safety_note": "Verify safety-critical repairs against OEM documentation and hands-on inspection."})
            return self.send_error_json("Route not found", 404)
        finally:
            conn.close()

    def do_PATCH(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        try:
            payload = self.read_json()
        except ValueError as exc:
            return self.send_error_json(str(exc), 422)
        conn = connect()
        try:
            if path.startswith("/api/work-orders/"):
                wo_id = path.split("/")[-1]
                if payload.get("employee_name"):
                    if payload["employee_name"] == "Unassigned":
                        payload["employee_id"] = None
                    else:
                        employee = conn.execute("SELECT id FROM employees WHERE name = ?", (payload["employee_name"],)).fetchone()
                        if employee:
                            payload["employee_id"] = employee["id"]
                allowed = {k: payload[k] for k in ("status", "priority", "diagnosis", "estimated_completion", "employee_id", "bay_number", "total") if k in payload}
                if not allowed:
                    return self.send_error_json("No supported work order fields provided")
                allowed["updated_at"] = now_iso()
                clause = ", ".join(f"{key} = ?" for key in allowed)
                conn.execute(f"UPDATE work_orders SET {clause} WHERE id = ?", (*allowed.values(), wo_id))
                conn.execute("INSERT INTO audit_log (entity_type, entity_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)", ("work_order", wo_id, "updated", json.dumps(payload), now_iso()))
                conn.commit()
                row = conn.execute("SELECT * FROM work_orders WHERE id = ?", (wo_id,)).fetchone()
                return self.send_json(work_order_view(conn, row)) if row else self.send_error_json("Work order not found", 404)
            if path.startswith("/api/inventory/"):
                try:
                    part_id = int(path.split("/")[-1])
                except ValueError:
                    return self.send_error_json("Invalid inventory id", 422)
                part = conn.execute("SELECT * FROM parts WHERE id = ?", (part_id,)).fetchone()
                if not part:
                    return self.send_error_json("Part not found", 404)
                quantity = int(payload.get("quantity", part["quantity"]))
                if "quantity_delta" in payload:
                    quantity = int(part["quantity"]) + int(payload["quantity_delta"])
                quantity = max(0, quantity)
                conn.execute("UPDATE parts SET quantity = ? WHERE id = ?", (quantity, part_id))
                conn.execute("INSERT INTO audit_log (entity_type, entity_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)", ("part", str(part_id), "stock_adjusted", json.dumps(payload), now_iso()))
                conn.commit()
                return self.send_json(row_dict(conn.execute("SELECT *, quantity <= min_stock AS low_stock FROM parts WHERE id = ?", (part_id,)).fetchone()))
            if path.startswith("/api/invoices/"):
                invoice_id = path.split("/")[-1]
                invoice = conn.execute("SELECT * FROM invoices WHERE id = ?", (invoice_id,)).fetchone()
                if not invoice:
                    return self.send_error_json("Invoice not found", 404)
                allowed = {k: payload[k] for k in ("status", "payment_method", "paid_at") if k in payload}
                if payload.get("status") == "Paid" and not payload.get("paid_at"):
                    allowed["paid_at"] = now_iso()
                if not allowed:
                    return self.send_error_json("No supported invoice fields provided")
                clause = ", ".join(f"{key} = ?" for key in allowed)
                conn.execute(f"UPDATE invoices SET {clause} WHERE id = ?", (*allowed.values(), invoice_id))
                conn.execute("INSERT INTO audit_log (entity_type, entity_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)", ("invoice", invoice_id, "updated", json.dumps(payload), now_iso()))
                conn.commit()
                return self.send_json(row_dict(conn.execute("SELECT * FROM invoices WHERE id = ?", (invoice_id,)).fetchone()))
            if path.startswith("/api/appointments/"):
                try:
                    appointment_id = int(path.split("/")[-1])
                except ValueError:
                    return self.send_error_json("Invalid appointment id", 422)
                appointment = conn.execute("SELECT * FROM appointments WHERE id = ?", (appointment_id,)).fetchone()
                if not appointment:
                    return self.send_error_json("Appointment not found", 404)
                allowed = {k: payload[k] for k in ("appointment_date", "appointment_time", "duration_minutes", "bay", "status", "notes") if k in payload}
                if not allowed:
                    return self.send_error_json("No supported appointment fields provided")
                clause = ", ".join(f"{key} = ?" for key in allowed)
                conn.execute(f"UPDATE appointments SET {clause} WHERE id = ?", (*allowed.values(), appointment_id))
                conn.execute("INSERT INTO audit_log (entity_type, entity_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)", ("appointment", str(appointment_id), "updated", json.dumps(payload), now_iso()))
                conn.commit()
                return self.send_json(row_dict(conn.execute("SELECT * FROM appointments WHERE id = ?", (appointment_id,)).fetchone()))
            return self.send_error_json("Route not found", 404)
        finally:
            conn.close()

    def serve_static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        clean = os.path.normpath(path.lstrip("/"))
        full = os.path.join(ROOT, clean)
        if not full.startswith(ROOT) or not os.path.isfile(full):
            return self.send_error_json("Not found", 404)
        content_types = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
        ext = os.path.splitext(full)[1]
        data = open(full, "rb").read()
        self.send_response(200)
        self.send_header("Content-Type", content_types.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def assistant_answer(prompt: str) -> str:
    text = prompt.lower()
    if "p0301" in text or "misfire" in text:
        return "DTC P0301 points to a cylinder 1 misfire. Inspect the spark plug, swap-test the ignition coil, verify injector operation, check compression, and smoke-test for intake leaks. Do not release the vehicle until the misfire is resolved and a road test confirms it."
    if "brake" in text or "grinding" in text:
        return "Flag this as high priority. Measure pad thickness, inspect rotor condition and minimum thickness, verify caliper slides and brake fluid, then perform a controlled road test. Recommend professional verification before the vehicle is driven."
    if "oil" in text or "cr-v" in text:
        return "Confirm the exact engine and market configuration in OEM documentation. Fill gradually, replace the filter, and verify the final level on the dipstick; capacity figures are a reference, not a substitute for a level check."
    if "part" in text:
        return "Inventory shows low stock on front brake pads, 5W-30 oil, and Hyundai cabin filters. Open Inventory to compare suppliers or create a purchase order."
    return "Start with a visual inspection, document measured values in the work order, and verify the repair plan against OEM service information before authorizing work."


if __name__ == "__main__":
    init_db()
    print(f"GarageAI API running at http://0.0.0.0:{PORT}")
    print(f"SQLite database: {DB_PATH}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()

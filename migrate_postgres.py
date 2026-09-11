#!/usr/bin/env python3
"""Apply schema.sql to a PostgreSQL DATABASE_URL.

Usage:
  pip install -r requirements.txt
  DATABASE_URL=postgresql://... python migrate_postgres.py

Demo users are only inserted when SEED_DEMO_USERS=true. Change their
passwords immediately in a real deployment.
"""
from __future__ import annotations

import hashlib
import os
import secrets
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parent


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()
    return f"{salt}${digest}"


def main() -> None:
    url = os.getenv("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is required")
    with psycopg.connect(url) as conn:
        conn.execute((ROOT / "schema.sql").read_text())
        if os.getenv("SEED_DEMO_USERS", "false").lower() == "true":
            users = [
                ("owner", "Arjun Mehta", "garage123", "Owner"),
                ("advisor", "Nisha Kapoor", "advisor123", "Advisor"),
                ("mike", "Mike Thomas", "mike123", "Mechanic"),
                ("apprentice", "James Lee", "apprentice123", "Apprentice"),
            ]
            for username, name, password, role in users:
                conn.execute("""INSERT INTO users (username, name, password_hash, role)
                                VALUES (%s, %s, %s, %s)
                                ON CONFLICT (username) DO NOTHING""", (username, name, hash_password(password), role))
        conn.commit()
    print("GarageAI PostgreSQL schema applied successfully.")


if __name__ == "__main__":
    main()

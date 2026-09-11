#!/usr/bin/env sh
set -eu

if [ -n "${DATABASE_URL:-}" ]; then
  echo "Applying PostgreSQL schema..."
  python migrate_postgres.py
fi

exec python server.py

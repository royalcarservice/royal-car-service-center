#!/usr/bin/env python3
"""Create a timestamped GarageAI backup.

- PostgreSQL: uses pg_dump when DATABASE_URL is configured.
- Local development: uses SQLite's online backup API.
"""
from __future__ import annotations

import os
import shutil
import sqlite3
import subprocess
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKUP_DIR = Path(os.getenv("BACKUP_DIR", ROOT / "backups"))


def main():
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    database_url = os.getenv("DATABASE_URL", "")
    if database_url.startswith(("postgres://", "postgresql://")):
        target = BACKUP_DIR / f"garageai-{stamp}.dump"
        subprocess.run(["pg_dump", database_url, "--format=custom", "--file", str(target)], check=True)
    else:
        source_path = Path(os.getenv("GARAGEAI_DB_PATH", ROOT / "garageai.db"))
        target = BACKUP_DIR / f"garageai-{stamp}.db"
        source = sqlite3.connect(source_path)
        destination = sqlite3.connect(target)
        with destination:
            source.backup(destination)
        destination.close()
        source.close()
    print(f"Backup created: {target}")


if __name__ == "__main__":
    main()

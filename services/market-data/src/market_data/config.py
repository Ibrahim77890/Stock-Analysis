"""Paths and environment configuration shared by all modules."""

import os
from pathlib import Path

from dotenv import find_dotenv, load_dotenv

load_dotenv(find_dotenv())

PROJECT_DIR = Path(__file__).resolve().parents[2]  # services/market-data
REPO_ROOT = PROJECT_DIR.parents[1]
DATA_DIR = Path(os.environ.get("MARKETLAB_DATA_DIR", REPO_ROOT / "data"))
UNIVERSE_FILE = PROJECT_DIR / "config" / "universe_v1.csv"
DOCS_DIR = REPO_ROOT / "docs"
REPORT_DIR = DATA_DIR / "reports"

DEFAULT_START = "2016-01-04"
DEFAULT_END = "2025-12-31"
SOURCE = "alpaca"


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set (see .env.example).")
    return url

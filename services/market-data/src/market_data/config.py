"""Paths and environment configuration shared by all modules."""

import logging
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


TIINGO_START = "2005-01-03"  # long-history start for the second source (Sprint 05)
KEY_VARS = {
    "ALPACA": ("ALPACA_API_KEY_ID", "ALPACA_API_SECRET_KEY"),
    "TIINGO": ("TIINGO_API_KEY",),
    "FRED": ("FRED_API_KEY",),
}


def _require(var: str) -> str:
    value = os.environ.get(var, "").strip()
    if not value:
        raise RuntimeError(f"{var} is not set (add it to .env; see .env.example).")
    return value


def tiingo_key() -> str:
    return _require("TIINGO_API_KEY")


def fred_key() -> str:
    return _require("FRED_API_KEY")


def redact(text: str) -> str:
    """Replace every configured key value in `text` by '***' (longest values first)."""
    values = [os.environ.get(v, "").strip() for names in KEY_VARS.values() for v in names]
    for value in sorted({v for v in values if len(v) >= 6}, key=len, reverse=True):
        text = text.replace(value, "***")
    return text


class _RedactFilter(logging.Filter):
    """Replaces configured key values in log records (httpx logs full request URLs, FRED keeps its key in the URL)."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # noqa: BLE001
            return True
        cleaned = redact(message)
        if cleaned != message:
            record.msg, record.args = cleaned, ()
        return True


def install_log_redaction() -> None:
    for name in ("httpx", "httpcore", "urllib3"):
        lg = logging.getLogger(name)
        if not any(isinstance(f, _RedactFilter) for f in lg.filters):
            lg.addFilter(_RedactFilter())


install_log_redaction()

"""Key presence and liveness checks. Never prints or returns a key value (task 05_01)."""

import os

import httpx

from market_data import config

TIMEOUT = 15.0


def key_status() -> dict[str, dict]:
    """Per provider: whether every variable is set and a length class like 'set, 40 chars'."""
    out = {}
    for name, variables in config.KEY_VARS.items():
        lengths = [len(os.environ.get(v, "").strip()) for v in variables]
        is_set = all(n > 0 for n in lengths)
        out[name] = {"set": is_set,
                     "detail": "set, " + " + ".join(f"{n} chars" for n in lengths) if is_set else "NOT SET",
                     "variables": list(variables)}
    return out


def _classify(status: int) -> str:
    if status == 200:
        return "ok"
    if status in (400, 401, 403):
        return "rejected"
    return f"error (HTTP {status})"


def ping(provider: str, transport: httpx.BaseTransport | None = None) -> str:
    """One cheap authenticated request. Returns ok | rejected | unreachable | error (HTTP n). Never raises."""
    try:
        with httpx.Client(timeout=TIMEOUT, transport=transport) as c:
            if provider == "TIINGO":
                r = c.get("https://api.tiingo.com/api/test",
                          headers={"Authorization": f"Token {config.tiingo_key()}"})
            elif provider == "FRED":
                r = c.get("https://api.stlouisfed.org/fred/series",
                          params={"series_id": "DGS3MO", "api_key": config.fred_key(), "file_type": "json"})
            elif provider == "ALPACA":
                r = c.get("https://data.alpaca.markets/v2/stocks/AAPL/bars",
                          params={"timeframe": "1Day", "start": "2024-01-02", "limit": 1, "feed": "iex"},
                          headers={"APCA-API-KEY-ID": os.environ.get("ALPACA_API_KEY_ID", ""),
                                   "APCA-API-SECRET-KEY": os.environ.get("ALPACA_API_SECRET_KEY", "")})
            else:
                raise ValueError(f"unknown provider {provider}")
            return _classify(r.status_code)
    except httpx.TransportError:
        return "unreachable"
    except RuntimeError:
        return "not set"


def check_keys(do_ping: bool = False, transport: httpx.BaseTransport | None = None,
               required: tuple[str, ...] = ("TIINGO", "FRED")) -> dict:
    status = key_status()
    for name, info in status.items():
        info["ping"] = ping(name, transport) if (do_ping and info["set"]) else None
    missing = [n for n in required if not status[n]["set"]]
    return {"keys": status, "required": list(required), "missing_required": missing}

"""Seeded synthetic daily bars for the scale benchmark (never mixed with real data)."""

import hashlib
from pathlib import Path

import numpy as np
import polars as pl

SEED = 20260101
N_SYMBOLS = 5000
N_SESSIONS = 2520
BLOCK = 500  # symbols per generated block (bounds memory)
START = np.datetime64("2016-01-04")


def sessions(n: int = N_SESSIONS) -> np.ndarray:
    """First n weekdays from START (a stand-in calendar; the benchmark is not about holidays)."""
    days = np.arange(START, START + np.timedelta64(n * 2, "D"))
    wk = days[np.is_busday(days)]
    return wk[:n]


def generate_block(block_index: int, n_symbols: int, n_sessions: int = N_SESSIONS, seed: int = SEED) -> pl.DataFrame:
    """Geometric random walk, valid OHLC, positive prices, integer volume.

    Each block has its own child seed, so the output is independent of block order.
    """
    rng = np.random.default_rng(np.random.SeedSequence(seed).spawn(block_index + 1)[block_index])
    first_id = block_index * BLOCK + 1
    s0 = rng.uniform(5, 500, size=(n_symbols, 1))
    log_ret = rng.normal(0.0003, 0.02, size=(n_symbols, n_sessions))
    close = s0 * np.exp(np.cumsum(log_ret, axis=1))
    prev = np.concatenate([s0, close[:, :-1]], axis=1)
    open_ = prev * np.exp(rng.normal(0, 0.005, size=close.shape))
    top = np.maximum(open_, close)
    bot = np.minimum(open_, close)
    high = top * (1 + np.abs(rng.normal(0, 0.01, size=close.shape)))
    low = bot * (1 - np.minimum(np.abs(rng.normal(0, 0.01, size=close.shape)), 0.5))
    volume = rng.lognormal(13, 1, size=close.shape).astype(np.int64)
    dates = np.tile(sessions(n_sessions), n_symbols)
    ids = np.repeat(np.arange(first_id, first_id + n_symbols, dtype=np.int64), n_sessions)
    r = lambda a: np.round(a, 4).ravel()  # noqa: E731
    return pl.DataFrame({
        "instrument_id": ids, "trade_date": dates.astype("datetime64[D]"),
        "open": r(open_), "high": r(high), "low": r(low), "close": r(close), "volume": volume.ravel(),
    })


def frame_hash(df: pl.DataFrame) -> str:
    h = hashlib.sha256()
    for col in df.columns:
        h.update(df[col].to_numpy().tobytes())
    return h.hexdigest()


def write_dataset(out_dir: Path, n_symbols: int = N_SYMBOLS, n_sessions: int = N_SESSIONS, seed: int = SEED) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for b, start in enumerate(range(0, n_symbols, BLOCK)):
        df = generate_block(b, min(BLOCK, n_symbols - start), n_sessions, seed)
        path = out_dir / f"synthetic_bars_{b:03d}.parquet"
        df.write_parquet(path, compression="zstd")
        paths.append(path)
    return paths

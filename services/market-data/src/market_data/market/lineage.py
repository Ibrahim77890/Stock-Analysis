"""Data lineage: where a symbol's bars came from and which caveats apply."""

from datetime import date
from pathlib import Path

import psycopg

from market_data.core import config
from market_data.ingestion.download import raw_files
from market_data.core.manifest import manifest_path, read_manifest, sha256_file
from market_data.market.read import bar_range_stats, instrument_id

FEED_CAVEAT = ("Volume is IEX-only (one venue), a subset of consolidated volume; do not compare it "
               "with other feeds or sites.")
UNIVERSE_CAVEAT = ("The universe is today's surviving symbols only, so results on it are "
                   "survivorship-biased (delisted names are absent).")


CONSOLIDATED_CAVEAT = ("Prices and volume are consolidated across US venues (Tiingo). Tiingo's free plan is for internal "
                       "use only: do not share charts or numbers built from it.")


def lineage(conn: psycopg.Connection, symbol: str, cursor: date | None = None,
            data_dir: Path | None = None, source: str = config.SOURCE) -> dict:
    """Join bars -> ingestion job -> manifest file -> quality results for one symbol.

    Quality counts only include flags dated on or before `cursor` (no future leakage).
    `bar_job_ids` lists the loader jobs that last wrote the symbol's rows (can be several after revisions).
    """
    data_dir = data_dir or config.DATA_DIR
    iid = instrument_id(conn, symbol)  # raises UnknownSymbolError
    stats = bar_range_stats(conn, symbol, cursor, source)
    warnings: list[str] = []
    with conn.cursor() as cur:
        cur.execute("SELECT ingestion_job_id, file_name, file_sha256, status, rows_read, rows_inserted, rows_updated, "
                    "rows_unchanged, rows_rejected FROM market.ingestion_job WHERE ingestion_job_id = ANY(%s) "
                    "ORDER BY ingestion_job_id", (stats["job_ids"],))
        jobs = [dict(job_id=r[0], file_name=r[1], file_sha256=r[2], status=r[3], rows_read=r[4], inserted=r[5],
                     updated=r[6], unchanged=r[7], rejected=r[8],
                     reconciles=r[4] == r[5] + r[6] + r[7] + r[8]) for r in cur.fetchall()]
        cur.execute("SELECT run_id FROM market.data_quality_result ORDER BY result_id DESC LIMIT 1")
        row = cur.fetchone()
        quality, run_id = {}, row[0] if row else None
        if run_id and source != config.SOURCE:
            warnings.append("quality results are not tagged by source; none are reported for this source")
        elif run_id:
            cur.execute("SELECT rule, count(*) FROM market.data_quality_result WHERE run_id = %s AND instrument_id = %s "
                        "AND (trade_date IS NULL OR %s::date IS NULL OR trade_date <= %s::date) GROUP BY rule ORDER BY rule",
                        (run_id, iid, cursor, cursor))
            quality = dict(cur.fetchall())
        else:
            warnings.append("no quality run exists yet")

    manifest = None
    files = raw_files(data_dir / "raw" / source / "bars_1d", symbol)
    if not files:
        warnings.append("raw file not found on disk; manifest unavailable")
    else:
        raw = files[-1]
        if not manifest_path(raw).exists():
            warnings.append(f"manifest missing for {raw.name}")
        else:
            m = read_manifest(raw)
            actual = sha256_file(raw)
            ok = actual == m["file_sha256"]
            if not ok:
                warnings.append("hash mismatch: the raw file differs from its manifest")
            manifest = {"file": raw.name, "provider": m["provider"], "endpoint": m["endpoint"],
                        "retrieved_at": m["retrieved_at"], "feed": m["parameters"].get("feed"),
                        "adjustment_requested": m["parameters"].get("adjustment"),
                        "row_count": m["row_count"], "manifest_sha256": m["file_sha256"],
                        "file_sha256_now": actual, "hash_matches": ok}
    return {"symbol": symbol, "cursor": cursor, "stored_adjustment": "raw", "bars": stats["bars"],
            "first_date": stats["first_date"], "last_date": stats["last_date"], "bar_job_ids": stats["job_ids"],
            "jobs": jobs, "manifest": manifest, "quality_run_id": run_id, "quality_counts": quality,
            "source": source, "feed_caveat": FEED_CAVEAT if source == config.SOURCE else CONSOLIDATED_CAVEAT, "universe_caveat": UNIVERSE_CAVEAT, "warnings": warnings}

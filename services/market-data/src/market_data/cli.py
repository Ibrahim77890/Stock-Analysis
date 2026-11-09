"""Command-line entry point: `market-data <command>` (or `uv run market-data ...`)."""

import argparse
import sys
from pathlib import Path

import psycopg

from market_data.core import config


def _conn() -> psycopg.Connection:
    return psycopg.connect(config.database_url())


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="market-data")
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("download", help="download raw bars + corporate actions with manifests")
    d.add_argument("--universe", default=str(config.UNIVERSE_FILE))
    d.add_argument("--start", default=config.DEFAULT_START)
    d.add_argument("--end", default=config.DEFAULT_END)
    d.add_argument("--feed", default="iex")
    d.add_argument("--force", action="store_true")

    td = sub.add_parser("tiingo-download", help="download raw Tiingo daily records (resumable; free tier 50 req/hour)")
    td.add_argument("--universe", default=str(config.UNIVERSE_FILE))
    td.add_argument("--start", default=config.TIINGO_START)
    td.add_argument("--end", default=config.DEFAULT_END)
    td.add_argument("--max-requests", type=int, default=45)
    td.add_argument("--force", action="store_true")
    tl = sub.add_parser("tiingo-load", help="load raw Tiingo files into PostgreSQL as source='tiingo' (idempotent)")
    tl.add_argument("--universe", default=str(config.UNIVERSE_FILE))

    fd = sub.add_parser("fred-download", help="download FRED series DGS3MO and VIXCLS (needs FRED_API_KEY)")
    fd.add_argument("--start", default="2000-01-01")
    fd.add_argument("--end", default=config.DEFAULT_END)
    fd.add_argument("--force", action="store_true")
    sub.add_parser("fred-load", help="load raw FRED files into market.macro_observation (idempotent)")

    v = sub.add_parser("verify", help="check every raw file against its manifest hash")
    v.add_argument("--root", default=str(config.DATA_DIR / "raw"))

    l = sub.add_parser("load", help="load raw files into PostgreSQL (idempotent)")
    l.add_argument("--universe", default=str(config.UNIVERSE_FILE))

    rc = sub.add_parser("reconcile", help="compare two price sources (default alpaca vs tiingo) and write a report")
    rc.add_argument("--a", default="alpaca")
    rc.add_argument("--b", default="tiingo")
    rc.add_argument("--symbols", nargs="*")

    q = sub.add_parser("quality", help="run data-quality rules and write a report")
    q.add_argument("--run", action="store_true", required=True)
    q.add_argument("--threshold", type=float, default=0.40)
    q.add_argument("--source", default=config.SOURCE)

    ck = sub.add_parser("check-keys", help="report which API keys are set (never prints them); --ping tests them")
    ck.add_argument("--ping", action="store_true")

    sv = sub.add_parser("serve", help="run the HTTP API + Swagger UI (http://127.0.0.1:8000/docs)")
    sv.add_argument("--port", type=int, default=8000)
    sv.add_argument("--host", default="127.0.0.1")
    sv.add_argument("--allow-remote", action="store_true", help="permit a non-loopback host (no authentication exists)")
    sub.add_parser("export-openapi", help="write docs/02-domain/openapi-market-data.json")

    sub.add_parser("bench-index-experiment", help="02_01: effect of a (trade_date, instrument_id) index")
    for name in ("bench-generate", "bench-load", "bench-report"):
        sub.add_parser(name)
    b = sub.add_parser("bench-run")
    b.add_argument("--cold", action="store_true", help="skip warm-up; run right after restarting PostgreSQL")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.cmd == "download":
        from market_data.ingestion.download import download_universe
        from market_data.core.universe import symbols

        print(download_universe(symbols(args.universe), args.start, args.end, feed=args.feed, force=args.force))
    elif args.cmd == "tiingo-download":
        from market_data.ingestion.download_tiingo import EXIT_QUOTA, download_tiingo
        from market_data.core.universe import symbols

        summary = download_tiingo(symbols(args.universe), args.start, args.end,
                                  max_requests=args.max_requests, force=args.force)
        print({k: v for k, v in summary.items() if k != "failures"}, summary["failures"] or "")
        if summary["stopped_by"] == "quota":
            print("quota reached; rerun later")
            return EXIT_QUOTA
        return 1 if summary["failed"] else 0
    elif args.cmd == "tiingo-load":
        from market_data.ingestion.load import load_tiingo_universe
        from market_data.core.universe import load_universe

        with _conn() as conn:
            for r in load_tiingo_universe(conn, load_universe(args.universe)):
                print(r)
    elif args.cmd == "fred-download":
        from market_data.ingestion.macro import download_fred

        print(download_fred(start=args.start, end=args.end, force=args.force))
    elif args.cmd == "fred-load":
        from market_data.ingestion.macro import load_fred

        with _conn() as conn:
            for r in load_fred(conn):
                print(r)
    elif args.cmd == "verify":
        from market_data.core.manifest import verify_tree

        results = verify_tree(Path(args.root))
        bad = [r for r in results if not r[1]]
        for path, ok, msg in bad:
            print(f"FAIL {path}: {msg}")
        print(f"{len(results) - len(bad)} ok, {len(bad)} failed")
        return 1 if bad else 0
    elif args.cmd == "load":
        from market_data.ingestion.load import load_universe_files
        from market_data.core.universe import load_universe

        with _conn() as conn:
            for r in load_universe_files(conn, load_universe(args.universe)):
                print(r)
    elif args.cmd == "reconcile":
        from market_data.market.reconcile import reconcile_universe, write_report

        with _conn() as conn:
            rep = reconcile_universe(conn, args.symbols, args.a, args.b)
        print(write_report(rep), rep["totals"])
    elif args.cmd == "quality":
        from market_data.ingestion.quality import run_quality

        with _conn() as conn:
            rep = run_quality(conn, source=args.source, threshold=args.threshold)
        print(rep["run_id"], rep["totals_per_rule"], f"{rep['seconds']}s")
    elif args.cmd == "check-keys":
        from market_data.core.keys import check_keys

        rep = check_keys(do_ping=args.ping)
        for name, info in rep["keys"].items():
            print(f"{name:7s} {info['detail']}" + (f"  ping: {info['ping']}" if info["ping"] else ""))
        if rep["missing_required"]:
            print("missing required for Sprint 05:", ", ".join(rep["missing_required"]))
            return 2
    elif args.cmd == "serve":
        import uvicorn

        if args.host not in ("127.0.0.1", "localhost", "::1") and not args.allow_remote:
            print("Refusing to bind to a non-loopback host without --allow-remote (the API has no authentication).")
            return 2
        uvicorn.run("market_data.api:app", host=args.host, port=args.port)
    elif args.cmd == "export-openapi":
        import json

        from market_data.api.app import openapi_schema

        out = config.DOCS_DIR / "02-domain" / "openapi-market-data.json"
        out.write_text(json.dumps(openapi_schema(), indent=2, sort_keys=True), encoding="utf-8")
        print(out)
    elif args.cmd.startswith("bench-"):
        from market_data.bench import benchmark as bench

        if args.cmd == "bench-generate":
            print(bench.generate())
        else:
            with _conn() as conn:
                if args.cmd == "bench-index-experiment":
                    print(bench.index_experiment(conn))
                elif args.cmd == "bench-load":
                    print(bench.load(conn))
                elif args.cmd == "bench-run":
                    out = bench.run(conn, "cold" if args.cold else "warm")
                    print(out["workloads"])
                else:
                    print(bench.report(conn))
    return 0


if __name__ == "__main__":
    sys.exit(main())

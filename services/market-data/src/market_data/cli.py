"""Command-line entry point: `market-data <command>` (or `uv run market-data ...`)."""

import argparse
import sys
from pathlib import Path

import psycopg

from market_data import config


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

    v = sub.add_parser("verify", help="check every raw file against its manifest hash")
    v.add_argument("--root", default=str(config.DATA_DIR / "raw"))

    l = sub.add_parser("load", help="load raw files into PostgreSQL (idempotent)")
    l.add_argument("--universe", default=str(config.UNIVERSE_FILE))

    q = sub.add_parser("quality", help="run data-quality rules and write a report")
    q.add_argument("--run", action="store_true", required=True)
    q.add_argument("--threshold", type=float, default=0.40)

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
        from market_data.download import download_universe
        from market_data.universe import symbols

        print(download_universe(symbols(args.universe), args.start, args.end, feed=args.feed, force=args.force))
    elif args.cmd == "verify":
        from market_data.manifest import verify_tree

        results = verify_tree(Path(args.root))
        bad = [r for r in results if not r[1]]
        for path, ok, msg in bad:
            print(f"FAIL {path}: {msg}")
        print(f"{len(results) - len(bad)} ok, {len(bad)} failed")
        return 1 if bad else 0
    elif args.cmd == "load":
        from market_data.load import load_universe_files
        from market_data.universe import load_universe

        with _conn() as conn:
            for r in load_universe_files(conn, load_universe(args.universe)):
                print(r)
    elif args.cmd == "quality":
        from market_data.quality import run_quality

        with _conn() as conn:
            rep = run_quality(conn, threshold=args.threshold)
        print(rep["run_id"], rep["totals_per_rule"], f"{rep['seconds']}s")
    elif args.cmd == "serve":
        import uvicorn

        if args.host not in ("127.0.0.1", "localhost", "::1") and not args.allow_remote:
            print("Refusing to bind to a non-loopback host without --allow-remote (the API has no authentication).")
            return 2
        uvicorn.run("market_data.api:app", host=args.host, port=args.port)
    elif args.cmd == "export-openapi":
        import json

        from market_data.api import openapi_schema

        out = config.DOCS_DIR / "02-domain" / "openapi-market-data.json"
        out.write_text(json.dumps(openapi_schema(), indent=2, sort_keys=True), encoding="utf-8")
        print(out)
    elif args.cmd.startswith("bench-"):
        from market_data import bench

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

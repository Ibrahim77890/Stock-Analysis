import json

import httpx
import pytest

from market_data import cli
from market_data.core import config
from market_data.ingestion import download_tiingo as dt
from market_data.core.manifest import sha256_file, verify_tree

FAKE = "KEY-ABC-123456"
SYMS = [f"S{i:02d}" for i in range(12)]


def rec(day="2020-01-02T00:00:00.000Z", close=10.0):
    return {"date": day, "open": close, "high": close + 1, "low": close - 1, "close": close, "volume": 1000,
            "adjOpen": 1.0, "adjHigh": 1.0, "adjLow": 1.0, "adjClose": 1.0, "adjVolume": 1000,
            "divCash": 0.0, "splitFactor": 1.0}


class Server:
    def __init__(self, fail_on=None, status_on=None):
        self.calls, self.fail_on, self.status_on = [], fail_on, status_on or {}

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        n = len(self.calls)
        assert "token" not in str(request.url).lower() and FAKE not in str(request.url)
        assert request.headers["Authorization"] == f"Token {FAKE}"
        sym = request.url.path.split("/")[3]
        if self.fail_on == n:
            return httpx.Response(429, json={"detail": "limit"})
        if sym in self.status_on:
            return httpx.Response(self.status_on[sym], text="x")
        return httpx.Response(200, json=[rec(close=10.0 + n)])


_REAL_MAKE_CLIENT = dt.make_client


def client(server):
    return _REAL_MAKE_CLIENT(FAKE, httpx.MockTransport(server))


def run(tmp_path, server, symbols=SYMS, **kw):
    return dt.download_tiingo(symbols, "2020-01-01", "2020-12-31", data_dir=tmp_path, client=client(server),
                              sleep=lambda s: None, **kw)


def test_budget_and_resume(tmp_path):
    s = Server()
    a = run(tmp_path, s, max_requests=5)
    assert (a["written"], a["http_requests"], a["stopped_by"], a["remaining"]) == (5, 5, "max_requests", 7)
    b = run(tmp_path, s, max_requests=5)
    assert (b["written"], b["skipped"], b["http_requests"]) == (5, 5, 5)
    c = run(tmp_path, s, max_requests=5)
    assert (c["written"], c["skipped"], c["http_requests"], c["stopped_by"]) == (2, 10, 2, "complete")
    assert len(s.calls) == 12
    d = run(tmp_path, s, max_requests=5)  # idempotent: nothing new
    assert (d["written"], d["http_requests"], d["skipped"]) == (0, 0, 12)
    assert all(ok for _, ok, _ in verify_tree(tmp_path / "raw"))


def test_quota_stops_and_keeps_files(tmp_path):
    s = Server(fail_on=3)
    out = run(tmp_path, s, max_requests=45)
    assert out["stopped_by"] == "quota" and out["written"] == 2 and out["remaining"] == 10
    assert len(list((tmp_path / "raw" / "tiingo" / "bars_1d").glob("*.parquet"))) == 2


def test_cli_exit_code_3_on_quota(tmp_path, monkeypatch, capsys):
    uni = tmp_path / "u.csv"
    uni.write_text("symbol,name,type,sector,reason_included\n" + "\n".join(f"{s},n,stock,x,r" for s in SYMS))
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setenv("TIINGO_API_KEY", FAKE)
    s = Server(fail_on=3)
    monkeypatch.setattr(dt, "make_client", lambda token=None, transport=None: client(s))
    code = cli.main(["tiingo-download", "--universe", str(uni), "--start", "2020-01-01", "--end", "2020-12-31"])
    assert code == 3 and "quota reached; rerun later" in capsys.readouterr().out


def test_fake_key_never_written_anywhere(tmp_path, caplog):
    s = Server(status_on={"S03": 500})
    out = run(tmp_path, s, max_requests=45)
    assert out["failed"] == 1 and "S03" in out["failures"]
    for p in tmp_path.rglob("*"):
        if p.is_file():
            assert FAKE.encode() not in p.read_bytes(), p
    assert FAKE not in json.dumps(out) and FAKE not in caplog.text


def test_not_found_recorded_and_skipped(tmp_path):
    s = Server(status_on={"S01": 404})
    a = run(tmp_path, s, symbols=SYMS[:3])
    assert a["not_found"] == 1 and a["written"] == 2
    assert "S01" in json.loads((tmp_path / "raw" / "tiingo" / "not_found.json").read_text())
    b = run(tmp_path, s, symbols=SYMS[:3])
    assert b["http_requests"] == 0 and b["not_found"] == 1 and b["skipped"] == 2


def test_failed_request_never_replaces_existing_file(tmp_path):
    run(tmp_path, Server(), symbols=SYMS[:1])
    f = tmp_path / "raw" / "tiingo" / "bars_1d" / "S00.parquet"
    before = sha256_file(f)
    s = Server(status_on={"S00": 500})
    out = run(tmp_path, s, symbols=SYMS[:1], force=True)
    assert out["failed"] == 1 and sha256_file(f) == before
    assert len(list(f.parent.glob("S00*.parquet"))) == 1


def test_summary_counts_add_up_and_report_written(tmp_path):
    out = run(tmp_path, Server(status_on={"S02": 404, "S04": 500}), max_requests=6)
    assert out["skipped"] + out["written"] + out["failed"] + out["not_found"] + out["remaining"] == out["requested"]
    assert list((tmp_path / "reports").glob("tiingo-download-*.json"))


def test_timestamped_sibling_when_file_exists_and_force(tmp_path):
    run(tmp_path, Server(), symbols=SYMS[:1])
    run(tmp_path, Server(), symbols=SYMS[:1], force=True)
    assert len(list((tmp_path / "raw" / "tiingo" / "bars_1d").glob("S00*.parquet"))) == 2


def test_share_class_symbol_is_mapped_for_the_request_only(tmp_path):
    s = Server()
    out = run(tmp_path, s, symbols=["BRK.B"])
    assert out["written"] == 1 and s.calls[0].url.path == "/tiingo/daily/BRK-B/prices"
    assert (tmp_path / "raw" / "tiingo" / "bars_1d" / "BRK.B.parquet").exists()

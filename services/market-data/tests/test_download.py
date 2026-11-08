import json

import httpx
import polars as pl
import pytest

from market_data.download import DownloadError, download_universe, fetch_daily_bars
from market_data.manifest import verify_file, verify_tree


def bar(day: str) -> dict:
    return {"t": f"{day}T04:00:00Z", "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 10, "n": 1, "vw": 1.2}


class FakeAlpaca:
    """Counts calls; serves two pages of bars, canned corporate actions, and optional failures."""

    def __init__(self, fail_first: int = 0, status: int = 429):
        self.calls = 0
        self.fail_first = fail_first
        self.status = status

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        if self.fail_first > 0:
            self.fail_first -= 1
            return httpx.Response(self.status)
        if "corporate-actions" in request.url.path:
            return httpx.Response(200, json={"corporate_actions": {"forward_splits": [
                {"symbol": "AAA", "ex_date": "2020-08-31", "new_rate": 4, "old_rate": 1}]}})
        if request.url.params.get("page_token") == "p2":
            return httpx.Response(200, json={"bars": [bar("2020-01-03")], "next_page_token": None})
        return httpx.Response(200, json={"bars": [bar("2020-01-02")], "next_page_token": "p2"})


def client(handler) -> httpx.Client:
    return httpx.Client(base_url="https://x", transport=httpx.MockTransport(handler))


def test_pagination_collects_all_pages():
    h = FakeAlpaca()
    df = fetch_daily_bars("AAA", "2020-01-01", "2020-01-31", client=client(h))
    assert df.height == 2 and h.calls == 2


def test_retry_on_429_then_success():
    h = FakeAlpaca(fail_first=2)
    sleeps = []
    df = fetch_daily_bars("AAA", "2020-01-01", "2020-01-31", client=client(h), sleep=sleeps.append)
    assert df.height == 2 and sleeps == [1.0, 2.0]


def test_gives_up_after_max_retries():
    h = FakeAlpaca(fail_first=99, status=503)
    with pytest.raises(DownloadError, match="giving up"):
        fetch_daily_bars("AAA", "2020-01-01", "2020-01-31", client=client(h), sleep=lambda s: None)
    assert h.calls == 5


def test_client_error_fails_loudly_without_retry():
    h = FakeAlpaca(fail_first=99, status=403)
    with pytest.raises(DownloadError, match="403"):
        fetch_daily_bars("AAA", "2020-01-01", "2020-01-31", client=client(h), sleep=lambda s: None)
    assert h.calls == 1


def test_download_writes_manifests_and_rerun_makes_no_calls(tmp_path):
    h = FakeAlpaca()
    kw = dict(data_dir=tmp_path, client=client(h), sleep=lambda s: None)
    first = download_universe(["AAA"], "2020-01-01", "2020-01-31", **kw)
    assert first["downloaded"] == 2  # one bars file + one corporate-actions file
    calls = h.calls
    second = download_universe(["AAA"], "2020-01-01", "2020-01-31", **kw)
    assert h.calls == calls and second["skipped"] == 2 and second["downloaded"] == 0

    results = verify_tree(tmp_path)
    assert len(results) == 2 and all(ok for _, ok, _ in results)
    raw = tmp_path / "raw" / "alpaca" / "bars_1d" / "AAA.parquet"
    m = json.loads((raw.parent / "AAA.parquet.manifest.json").read_text())
    assert m["row_count"] == 2 and m["parameters"]["adjustment"] == "raw"
    assert {"retrieved_at", "file_sha256", "provider", "endpoint", "license_note", "tool_version"} <= set(m)
    assert pl.read_parquet(raw).height == 2


def test_force_never_overwrites_existing_raw_file(tmp_path):
    h = FakeAlpaca()
    kw = dict(data_dir=tmp_path, client=client(h), sleep=lambda s: None)
    download_universe(["AAA"], "2020-01-01", "2020-01-31", **kw)
    download_universe(["AAA"], "2020-01-01", "2020-01-31", force=True, **kw)
    files = sorted((tmp_path / "raw" / "alpaca" / "bars_1d").glob("AAA*.parquet"))
    assert len(files) == 2


def test_corrupt_byte_is_detected(tmp_path):
    download_universe(["AAA"], "2020-01-01", "2020-01-31", data_dir=tmp_path, client=client(FakeAlpaca()),
                      sleep=lambda s: None)
    raw = tmp_path / "raw" / "alpaca" / "bars_1d" / "AAA.parquet"
    data = bytearray(raw.read_bytes())
    data[len(data) // 2] ^= 0xFF
    raw.write_bytes(bytes(data))
    ok, msg = verify_file(raw)
    assert not ok and "hash mismatch" in msg


def test_bar_dates_within_requested_range(tmp_path):
    download_universe(["AAA"], "2020-01-01", "2020-01-31", data_dir=tmp_path, client=client(FakeAlpaca()),
                      sleep=lambda s: None)
    df = pl.read_parquet(tmp_path / "raw" / "alpaca" / "bars_1d" / "AAA.parquet")
    dates = df["t"].str.slice(0, 10)
    assert dates.min() >= "2020-01-01" and dates.max() <= "2020-01-31"

import httpx
import pytest

from market_data import cli
from market_data.core import config, keys

FAKE = "KEY-ABC-123456"


def _transport(status=200, boom=False):
    def handler(request):
        if boom:
            raise httpx.ConnectError("no network")
        return httpx.Response(status, json={})
    return httpx.MockTransport(handler)


def test_missing_key_names_variable_not_value(monkeypatch):
    monkeypatch.delenv("TIINGO_API_KEY", raising=False)
    with pytest.raises(RuntimeError) as e:
        config.tiingo_key()
    assert "TIINGO_API_KEY" in str(e.value)
    monkeypatch.delenv("FRED_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="FRED_API_KEY"):
        config.fred_key()


def test_keys_returned_when_set(monkeypatch):
    monkeypatch.setenv("TIINGO_API_KEY", FAKE)
    assert config.tiingo_key() == FAKE


def test_check_keys_output_never_contains_key(monkeypatch, capsys):
    monkeypatch.setenv("TIINGO_API_KEY", FAKE)
    monkeypatch.setenv("FRED_API_KEY", FAKE + "-F")
    rep = keys.check_keys(do_ping=True, transport=_transport(200))
    assert FAKE not in repr(rep)
    assert rep["keys"]["TIINGO"]["detail"] == f"set, {len(FAKE)} chars"
    assert rep["keys"]["TIINGO"]["ping"] == "ok"
    assert config.redact(f"url?api_key={FAKE}-F&x=1") == "url?api_key=***&x=1"


def test_ping_rejected_and_unreachable_do_not_raise(monkeypatch):
    monkeypatch.setenv("TIINGO_API_KEY", FAKE)
    monkeypatch.setenv("FRED_API_KEY", FAKE)
    assert keys.ping("TIINGO", _transport(401)) == "rejected"
    assert keys.ping("FRED", _transport(400)) == "rejected"
    assert keys.ping("TIINGO", _transport(boom=True)) == "unreachable"
    assert keys.ping("TIINGO", _transport(503)).startswith("error")


def test_cli_exit_code_2_when_required_key_missing(monkeypatch, capsys):
    monkeypatch.setattr(config, "KEY_VARS", {"ALPACA": ("A1",), "TIINGO": ("TIINGO_API_KEY",), "FRED": ("FRED_API_KEY",)})
    monkeypatch.setattr(keys.config, "KEY_VARS", config.KEY_VARS)
    monkeypatch.delenv("TIINGO_API_KEY", raising=False)
    monkeypatch.setenv("FRED_API_KEY", FAKE)
    monkeypatch.setenv("A1", "x")
    assert cli.main(["check-keys"]) == 2
    out = capsys.readouterr().out
    assert "TIINGO" in out and FAKE not in out


def test_env_is_git_ignored_and_not_tracked():
    import subprocess
    root = config.REPO_ROOT
    assert subprocess.run(["git", "check-ignore", ".env"], cwd=root, capture_output=True, text=True).stdout.strip() == ".env"
    tracked = subprocess.run(["git", "ls-files"], cwd=root, capture_output=True, text=True).stdout.split()
    assert ".env" not in tracked


def test_httpx_request_log_lines_are_redacted(monkeypatch, caplog):
    import logging

    monkeypatch.setenv("FRED_API_KEY", FAKE)
    with caplog.at_level(logging.INFO, logger="httpx"):
        with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={}))) as c:
            c.get("https://api.stlouisfed.org/fred/series/observations", params={"api_key": FAKE, "series_id": "X"})
    assert "api_key=***" in caplog.text and FAKE not in caplog.text

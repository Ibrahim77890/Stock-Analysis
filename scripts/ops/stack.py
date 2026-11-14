"""Check prerequisites, start and stop the whole MarketLab stack with one command.

    python scripts/ops/stack.py check     # names every missing prerequisite in plain words; starts nothing
    python scripts/ops/stack.py start     # check, migrate, seed, then start Python (8000), the gateway (3000) and the web app (5173)
    python scripts/ops/stack.py stop      # stop what `start` started
    python scripts/ops/stack.py status    # which of the three answer

Secrets: only the NAMES of missing variables are printed, never a value. Logs go to data/logs/ and process ids to data/run/ (both git-ignored).
"""

from __future__ import annotations

import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
API, WEB, PY = ROOT / "apps" / "api", ROOT / "apps" / "web", ROOT / "services" / "market-data"
RUN, LOGS = ROOT / "data" / "run", ROOT / "data" / "logs"
PORTS = {"python": 8000, "gateway": 3000, "web": 5173}
REQUIRED = ("DATABASE_URL", "JWT_SECRET", "INTERNAL_API_TOKEN")
WIN = os.name == "nt"


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    f = Path(os.environ.get("MARKETLAB_ENV_FILE", ROOT / ".env"))   # the override exists for tests
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"')
    return env


def venv_python() -> Path:
    return PY / ".venv" / ("Scripts/python.exe" if WIN else "bin/python")


def port_free(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) != 0


def answers(port: int, path: str = "/health") -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=2) as r:
            return r.status == 200
    except Exception:  # noqa: BLE001
        return False


def check(need_free_ports: bool = True) -> list[str]:
    problems: list[str] = []
    env = {**load_env(), **({k: v for k, v in os.environ.items() if k in REQUIRED} if "MARKETLAB_ENV_FILE" not in os.environ else {})}
    if not Path(os.environ.get("MARKETLAB_ENV_FILE", ROOT / ".env")).exists():
        problems.append("The file .env is missing. Copy .env.example to .env and fill it in (see the README).")
    for name in REQUIRED:
        if not env.get(name):
            problems.append(f"The setting {name} is empty or missing in .env.")
    node = shutil.which("node")
    if not node:
        problems.append("Node.js was not found. Install Node.js 20.19 or newer.")
    else:
        v = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip().lstrip("v").split(".")
        if (int(v[0]), int(v[1])) < (20, 19):
            problems.append(f"Node.js {'.'.join(v)} is too old. Install 20.19 or newer.")
    if not venv_python().exists():
        problems.append("The Python environment is missing. Run `uv sync` (or create .venv and install the project) in services/market-data.")
    for app in (API, WEB):
        if not (app / "node_modules").exists():
            problems.append(f"Packages are not installed in {app.relative_to(ROOT)}. Run `npm ci` there.")
    if env.get("DATABASE_URL"):
        try:
            import psycopg  # noqa: PLC0415
            psycopg.connect(env["DATABASE_URL"], connect_timeout=3).close()
        except ImportError:
            pass
        except Exception:  # noqa: BLE001
            problems.append("PostgreSQL does not answer at DATABASE_URL. Is the service running, and are the user, password and database right?")
    if need_free_ports:
        for name, port in PORTS.items():
            if not port_free(port):
                problems.append(f"Port {port} ({name}) is already in use. Stop what is using it, or run `python scripts/ops/stack.py stop`.")
    return problems


def run_step(title: str, cmd: list[str], cwd: Path, env: dict[str, str]) -> None:
    print(f"- {title}")
    r = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, shell=WIN and cmd[0] in ("npm", "npx"))
    if r.returncode != 0:
        tail = (r.stderr or r.stdout).strip().splitlines()[-3:]
        raise SystemExit(f"Step failed: {title}\n" + "\n".join(tail))


def start() -> int:
    problems = check()
    if problems:
        print("MarketLab cannot start yet:\n" + "\n".join(f" * {p}" for p in problems))
        return 1
    env = {**os.environ, **load_env()}
    py = str(venv_python())
    run_step("applying the Python database migrations", [py, "-m", "alembic", "upgrade", "head"], PY, env)
    run_step("building the gateway", ["npm", "run", "build"], API, env)
    run_step("applying the gateway database migrations", ["npm", "run", "migrate:up"], API, env)
    run_step("loading the glossary", ["node", "dist/scripts/seed-glossary.js"], API, env)
    run_step("loading the lessons", ["node", "dist/scripts/seed-lessons.js"], API, env)
    RUN.mkdir(parents=True, exist_ok=True)
    LOGS.mkdir(parents=True, exist_ok=True)
    flags = (subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP) if WIN else 0
    procs = {}
    for name, cmd, cwd in (("python", [py, "-m", "market_data.cli", "serve"], PY), ("gateway", ["node", "dist/src/main.js"], API),
                           ("web", ["npm", "run", "dev"], WEB)):
        log = open(LOGS / f"{name}.log", "ab")
        p = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=log, stderr=log, stdin=subprocess.DEVNULL, creationflags=flags,
                             start_new_session=not WIN, shell=WIN and cmd[0] == "npm")
        procs[name] = p.pid
    (RUN / "pids.json").write_text(json.dumps(procs), encoding="utf-8")
    for name, port in PORTS.items():
        for _ in range(60):
            if answers(port, "/health" if name != "web" else "/"):
                break
            time.sleep(1)
        else:
            print(f"{name} did not answer in time; read data/logs/{name}.log")
            return 1
    print("\nMarketLab is running:\n  Web app          http://127.0.0.1:5173\n  Gateway Swagger  http://127.0.0.1:3000/docs\n  Python Swagger   http://127.0.0.1:8000/docs")
    print("Stop it with: python scripts/ops/stack.py stop")
    return 0


def stop() -> int:
    f = RUN / "pids.json"
    if not f.exists():
        print("Nothing to stop: no process list found (data/run/pids.json).")
        return 0
    for name, pid in json.loads(f.read_text(encoding="utf-8")).items():
        try:
            if WIN:
                subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
            else:
                os.killpg(os.getpgid(pid), signal.SIGTERM)
            print(f"stopped {name} (process {pid})")
        except Exception:  # noqa: BLE001
            print(f"{name} was already stopped")
    f.unlink()
    return 0


def status() -> int:
    for name, port in PORTS.items():
        print(f"{name:8} port {port}: {'answers' if answers(port, '/health' if name != 'web' else '/') else 'not answering'}")
    return 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "check"
    if cmd == "check":
        p = check(need_free_ports=False)
        print("Everything needed is in place." if not p else "Missing:\n" + "\n".join(f" * {x}" for x in p))
        sys.exit(1 if p else 0)
    sys.exit({"start": start, "stop": stop, "status": status}.get(cmd, lambda: print("usage: stack.py check|start|stop|status") or 2)())

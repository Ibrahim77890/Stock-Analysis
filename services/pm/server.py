#!/usr/bin/env python3
"""MarketLab project board: a local, dependency-free web app over the repository's sprints folder.

    python services/pm/server.py            # http://127.0.0.1:4300 (opens the browser)
    python services/pm/server.py --port 5000 --no-browser

Source of truth is the file system, read fresh on every request:
  sprints/NN_current|NN_done/README.md           sprint title, goals, definition of done
  sprints/.../tasks/NN_MM_task.md                one issue per file
  sprints/.../completed/<task id>*.md            => task is Done
  sprints/.../pending/<task id>*.md              => task is In Progress (started or blocked)
  neither                                        => Todo
  sprints/.../concepts/*.md                      concept pool (sorted alphabetically)
  sprints/current_status.md, docs/**, agent/**   project memory and documentation

The only write the app performs is a status change, which moves/creates a note file in
completed/ or pending/. It listens on 127.0.0.1 only and rejects cross-origin writes.
"""

import argparse
import json
import re
import sys
import webbrowser
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SPRINTS = ROOT / "sprints"
READABLE_DIRS = ("sprints", "docs", "agent")
STATUSES = ("todo", "in_progress", "done")

SPRINT_DIR = re.compile(r"^(\d{2})_(current|done)$")
TASK_FILE = re.compile(r"^(\d{2}_\d{2})_task\.md$")


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def h1(text: str, fallback: str) -> str:
    m = re.search(r"^#\s+(.+)$", text, re.M)
    return m.group(1).strip() if m else fallback


def section(text: str, heading_regex: str) -> str:
    """Body of the first '## ' section whose heading matches, up to the next '## '."""
    m = re.search(rf"^##\s+{heading_regex}.*$", text, re.M)
    if not m:
        return ""
    rest = text[m.end():]
    n = re.search(r"^##\s+", rest, re.M)
    return (rest[: n.start()] if n else rest).strip()


def note_files(folder: Path, task_id: str) -> list[Path]:
    if not folder.is_dir():
        return []
    return sorted(p for p in folder.glob("*.md") if p.stem == task_id or p.stem.startswith(task_id + "_"))


def parse_task(sprint_dir: Path, path: Path) -> dict:
    text = read(path)
    task_id = TASK_FILE.match(path.name).group(1)
    title = re.sub(r"^Task\s+\S+?:\s*", "", h1(text, task_id))
    if not text.strip():
        title = f"{task_id} (spec file is empty)"
    meta = lambda key: (re.search(rf"\*\*{key}:\*\*\s*(.*?)(?=\s{{2,}}\*\*|\s*$)", text, re.M) or [None, ""])[1].strip()
    done, pending = note_files(sprint_dir / "completed", task_id), note_files(sprint_dir / "pending", task_id)
    status = "done" if done else "in_progress" if pending else "todo"
    criteria = re.findall(r"^- \[( |x)\] ", section(text, "Acceptance"), re.M)
    return {
        "id": task_id, "title": title, "path": rel(path), "status": status,
        "size": meta("Size"), "depends_on": [d for d in re.findall(r"\d{2}_\d{2}", meta("Depends on"))],
        "goal": section(text, "Goal"),
        "criteria_total": len(criteria),
        "concepts": sorted(set(re.findall(r"\.\./concepts/([\w\-]+\.md)", meta_line(text, "Concepts to read first")))),
        "notes": [{"kind": "done" if p.parent.name == "completed" else "pending", "path": rel(p)}
                  for p in done + pending],
    }


def meta_line(text: str, key: str) -> str:
    m = re.search(rf"\*\*{key}:\*\*(.*)", text)
    return m.group(1) if m else ""


def list_sprints() -> list[dict]:
    out = []
    for d in sorted(SPRINTS.iterdir()) if SPRINTS.is_dir() else []:
        m = SPRINT_DIR.match(d.name)
        if not (m and d.is_dir()):
            continue
        readme = read(d / "README.md")
        tasks = [parse_task(d, p) for p in sorted((d / "tasks").glob("*_task.md")) if TASK_FILE.match(p.name)]
        out.append({
            "number": m.group(1), "state": m.group(2), "dir": rel(d),
            "title": re.sub(r"^Sprint\s+\d+:\s*", "", h1(readme, d.name)),
            "goals": section(readme, "Goals"), "why": section(readme, "Why this sprint"),
            "out_of_scope": section(readme, "Out of scope"), "definition_of_done": section(readme, "Definition of done"),
            "readme": rel(d / "README.md") if (d / "README.md").exists() else None,
            "tasks": tasks,
        })
    return out


def list_concepts() -> list[dict]:
    out = []
    for d in sorted(SPRINTS.glob("*/concepts")):
        for p in d.glob("*.md"):
            text = read(p)
            used = re.search(r"\*\*Used by tasks:\*\*\s*(.*)", text)
            out.append({
                "title": h1(text, p.stem), "file": p.name, "path": rel(p),
                "sprint": d.parent.name[:2],
                "used_by": re.findall(r"\d{2}_\d{2}", used.group(1)) if used else [],
            })
    return sorted(out, key=lambda c: c["title"].casefold())


def list_docs() -> list[dict]:
    out = []
    for top in ("docs", "agent"):
        for p in sorted((ROOT / top).rglob("*.md")):
            out.append({"title": h1(read(p), p.stem), "path": rel(p), "group": p.parent.relative_to(ROOT).as_posix()})
    status = SPRINTS / "current_status.md"
    if status.exists():
        out.insert(0, {"title": h1(read(status), "Current status"), "path": rel(status), "group": "sprints"})
    return out


def project() -> dict:
    blueprint = next(iter((ROOT / "docs").glob("*/MarketLab_Project_Blueprint.md")), None)
    text = read(blueprint) if blueprint else ""
    status = read(SPRINTS / "current_status.md")
    return {
        "name": h1(text, "MarketLab"),
        "description": section(text, r"1\.\s+Executive Summary") or "No project description found in docs/.",
        "blueprint": rel(blueprint) if blueprint else None,
        "snapshot": section(status, "Snapshot"),
    }


def safe_path(rel_path: str) -> Path | None:
    p = (ROOT / rel_path).resolve()
    try:
        r = p.relative_to(ROOT)
    except ValueError:
        return None
    if not r.parts or r.parts[0] not in READABLE_DIRS or p.suffix.lower() not in (".md", ".csv", ".txt"):
        return None
    return p if p.is_file() else None


def set_status(sprint: str, task_id: str, status: str) -> tuple[int, dict]:
    if status not in STATUSES:
        return 400, {"error": f"status must be one of {STATUSES}"}
    d = next((s for s in SPRINTS.glob(f"{sprint}_*") if s.is_dir()), None)
    if d is None or not TASK_FILE.match(f"{task_id}_task.md") or not (d / "tasks" / f"{task_id}_task.md").exists():
        return 404, {"error": "unknown sprint or task"}
    done, pending = d / "completed", d / "pending"
    has_done, has_pending = note_files(done, task_id), note_files(pending, task_id)
    current = "done" if has_done else "in_progress" if has_pending else "todo"
    if status == current:
        return 200, {"status": current}
    stamp = date.today().isoformat()
    if status == "todo":
        return 400, {"error": "Moving back to Todo would delete notes; remove the note file by hand if you really want that."}
    if status == "done":
        done.mkdir(exist_ok=True)
        if has_pending:
            for p in has_pending:
                p.rename(done / p.name)
        else:
            (done / f"{task_id}.md").write_text(f"# {task_id} completed\n\nMarked done from the project board on {stamp}.\n", encoding="utf-8")
    else:  # in_progress
        pending.mkdir(exist_ok=True)
        if has_done:
            if any(p.stem != task_id for p in has_done):
                return 409, {"error": "Several completion notes exist; move them by hand."}
            for p in has_done:
                p.rename(pending / p.name)
        else:
            (pending / f"{task_id}.md").write_text(f"# {task_id} in progress\n\nStarted from the project board on {stamp}.\n", encoding="utf-8")
    return 200, {"status": status}


class Handler(BaseHTTPRequestHandler):
    server_version = "MarketLabPM/1.0"

    def log_message(self, fmt, *args):  # quiet
        pass

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code: int = 200) -> None:
        self._send(code, json.dumps(obj).encode("utf-8"), "application/json; charset=utf-8")

    def do_GET(self):
        url = urlparse(self.path)
        try:
            if url.path in ("/", "/index.html"):
                self._send(200, (HERE / "index.html").read_bytes(), "text/html; charset=utf-8")
            elif url.path == "/api/project":
                self._json({**project(), "sprints": list_sprints(), "concepts": list_concepts(), "docs": list_docs()})
            elif url.path == "/api/file":
                p = safe_path(parse_qs(url.query).get("path", [""])[0])
                if p is None:
                    return self._json({"error": "not found"}, 404)
                self._json({"path": rel(p), "content": p.read_text(encoding="utf-8", errors="replace")})
            else:
                self._json({"error": "not found"}, 404)
        except Exception as exc:  # noqa: BLE001
            self._json({"error": f"{type(exc).__name__}: {exc}"}, 500)

    def do_POST(self):
        origin = self.headers.get("Origin")
        if origin and urlparse(origin).netloc != self.headers.get("Host"):
            return self._json({"error": "cross-origin request refused"}, 403)
        url = urlparse(self.path)
        m = re.fullmatch(r"/api/task/(\d{2})/(\d{2}_\d{2})/status", url.path)
        if not m:
            return self._json({"error": "not found"}, 404)
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0)) or 0) or b"{}")
            code, payload = set_status(m.group(1), m.group(2), str(body.get("status", "")))
            self._json(payload, code)
        except Exception as exc:  # noqa: BLE001
            self._json({"error": f"{type(exc).__name__}: {exc}"}, 500)


def main() -> int:
    ap = argparse.ArgumentParser(description="MarketLab local project board")
    ap.add_argument("--port", type=int, default=4300)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError as exc:
        print(f"Cannot listen on port {args.port}: {exc}", file=sys.stderr)
        return 1
    url = f"http://127.0.0.1:{args.port}"
    print(f"MarketLab project board: {url}  (Ctrl+C to stop)")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

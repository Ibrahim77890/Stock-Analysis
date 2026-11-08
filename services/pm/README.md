# MarketLab project board

Local, Linear-style board over the `sprints/` folder. No dependencies (Python standard library only).

    python services/pm/server.py              # http://127.0.0.1:4300, opens the browser
    python services/pm/server.py --port 5000 --no-browser

* **Project**: description (blueprint section 1), progress, current snapshot from `sprints/current_status.md`.
* **Sprint NN**: Board / List / About. One issue per `tasks/NN_MM_task.md`.
  Status comes from files: note in `completed/` = Done, note in `pending/` = In Progress, otherwise Todo.
  Dragging a card (or the status dropdown) moves/creates the note file. Moving back to Todo is refused (it would delete notes).
* **Concepts**: every `sprints/*/concepts/*.md`, sorted alphabetically, rendered Markdown by default (Raw toggle).
* **Docs & status log**: `docs/`, `agent/`, `sprints/current_status.md`.

Reads files fresh on every request (press `r` or Refresh). Listens on 127.0.0.1 only; writes reject cross-origin requests;
only `.md/.csv/.txt` under `sprints/`, `docs/`, `agent/` are served.

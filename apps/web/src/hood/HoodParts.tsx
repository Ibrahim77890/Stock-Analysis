import { useState } from "react";
import type { EpisodeState, SystemInfo, TraceEntry } from "../api/client";
import { hood as copy } from "../copy/hood";
import { Button } from "../components/ui";

export function ArchitectureDiagram() {
  const boxes = [
    { x: 10, label: "Your browser" },
    { x: 185, label: "Front desk (NestJS)" },
    { x: 360, label: "Number cruncher (Python)" },
    { x: 535, label: "Database (PostgreSQL)" },
  ];
  return (
    <figure>
      <svg viewBox="0 0 700 150" width="100%" role="img" aria-labelledby="hood-alt" style={{ background: "#fff", border: "1px solid #aab4c3", borderRadius: 8 }}>
        <title id="hood-alt">Four boxes in a row joined by arrows: your browser, the front desk, the number cruncher and the database.</title>
        {boxes.map((b, i) => (
          <g key={b.label}>
            <rect x={b.x} y={40} width={155} height={70} rx={10} fill="#e7f0fc" stroke="#1f5fbf" strokeWidth={2} />
            <text x={b.x + 77} y={80} textAnchor="middle" fontSize={13} fill="#17325c">{b.label}</text>
            {i < boxes.length - 1 && <path d={`M${b.x + 157} 75 L${b.x + 180} 75`} stroke="#1b2330" strokeWidth={2} markerEnd="url(#arrow)" />}
          </g>
        ))}
        <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#1b2330" /></marker></defs>
        <text x={535 + 77} y={130} textAnchor="middle" fontSize={11} fill="#4a5568">drawers: app, research, market</text>
      </svg>
      <figcaption>
        <ol>
          {copy.parts.map((p) => <li key={p.name}><strong>{p.name}.</strong> {p.does}</li>)}
        </ol>
      </figcaption>
    </figure>
  );
}

const DOWN_TEXT = { gateway: copy.downFront, python: copy.downPython, database: copy.downDb } as const;

export function StatusLights({ system }: { system: SystemInfo }) {
  const items: Array<[keyof typeof DOWN_TEXT, string, string]> = [
    ["gateway", "Front desk", system.health.gateway],
    ["python", "Number cruncher", system.health.python],
    ["database", "Database", system.health.database],
  ];
  return (
    <div>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {items.map(([key, name, state]) => {
          const ok = state === "ok";
          return (
            <li key={key}>
              <span aria-hidden="true" style={{ color: ok ? "#14663a" : "#a12020" }}>{ok ? "●" : "○"} </span>
              <strong>{name}:</strong> {ok ? copy.running : copy.down}
              {!ok && <span className="muted"> - {DOWN_TEXT[key]}</span>}
            </li>
          );
        })}
      </ul>
      <p className="muted">{copy.checkedAt}: {new Date(system.checked_at).toLocaleTimeString()}</p>
    </div>
  );
}

export function WhatTheServerKnows({ episode }: { episode: EpisodeState | null }) {
  const revealed = episode?.status === "revealed";
  return (
    <div className="grid">
      <div>
        <h3>{revealed ? copy.revealedHead : copy.hiddenHead}</h3>
        <ul>{copy.hiddenList.map((h) => <li key={h.item}><strong>{h.item}.</strong> <span className="muted">{h.why}</span></li>)}</ul>
      </div>
      <div>
        <h3>{copy.keptHead}</h3>
        <ul>
          <li>{copy.keptGuesses}</li>
          <li>{copy.keptDay}{episode ? ` Right now: day ${episode.day} of ${episode.n_bars}.` : ""}</li>
          <li>{copy.keptSeed}</li>
        </ul>
      </div>
    </div>
  );
}

const SENTENCES: Record<string, string> = {
  "POST /episodes": "Started a new episode",
  "GET /episodes": "Looked at your list of episodes",
  "GET /episodes/:id": "Opened an episode",
  "GET /episodes/:id/bars": "Loaded the chart",
  "POST /episodes/:id/advance": "Moved the episode forward",
  "POST /episodes/:id/predictions": "Sent a guess",
  "GET /episodes/:id/predictions": "Looked at your guesses",
  "GET /episodes/:id/score": "Worked out your score",
  "POST /episodes/:id/reveal": "Revealed an episode",
  "GET /me/progress": "Looked at your progress",
  "GET /me": "Checked who you are",
  "GET /system": "Checked that everything is running",
  "GET /trace": "Looked at this list",
  "POST /auth/login": "Signed in",
  "POST /auth/register": "Created an account",
  "GET /glossary/:slug": "Looked up a word",
  "GET /glossary": "Opened the word list",
};

export const sentenceFor = (route: string): string => SENTENCES[route] ?? "Did something else";
export const statusWordFor = (status: number): string => (status < 400 ? copy.worked : status === 404 ? copy.refused : copy.failed);

/** Shows words, durations and statuses only: no ids, no bodies, no tokens. */
export function RequestTable({ rows }: { rows: TraceEntry[] }) {
  const [more, setMore] = useState(false);
  if (rows.length === 0) return <p className="muted">{copy.requestsEmpty}</p>;
  return (
    <div>
      <table aria-label={copy.requestsTitle}>
        <thead><tr><th scope="col">When</th><th scope="col">What you did</th><th scope="col">Handled by</th><th scope="col">Took</th><th scope="col">Result</th>{more && <th scope="col">Route</th>}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.request_id}>
              <td>{new Date(r.time).toLocaleTimeString()}</td>
              <td>{sentenceFor(r.route)}</td>
              <td>{r.upstream.length > 0 ? "browser, front desk, number cruncher" : "browser, front desk"}</td>
              <td>{Math.round(r.duration_ms)} ms</td>
              <td>{statusWordFor(r.status)}</td>
              {more && <td className="muted">{r.route} ({r.status})</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <Button variant="secondary" onClick={() => setMore((m) => !m)} aria-expanded={more}>{copy.showMore}</Button>
    </div>
  );
}

export function SystemMap({ system, gatewayBase }: { system: SystemInfo; gatewayBase: string }) {
  return (
    <details>
      <summary>{copy.developersTitle}</summary>
      <p className="muted">{copy.developersNote}</p>
      <h3>{copy.ownership}</h3>
      <table>
        <thead><tr><th>Drawer (schema)</th><th>Owner</th><th>Holds</th></tr></thead>
        <tbody>{system.ownership.map((o) => <tr key={o.schema}><td>{o.schema}</td><td>{o.owner}</td><td>{o.holds}</td></tr>)}</tbody>
      </table>
      <ul>
        <li>Front desk migration: {system.app_migration ?? "unknown"}</li>
        <li>Number cruncher migration: {system.python_migration ?? "unknown"}</li>
        <li><a href={`${gatewayBase}/docs`}>Front desk API pages (Swagger)</a></li>
        <li><a href="http://127.0.0.1:8000/docs">Number cruncher API pages (Swagger)</a></li>
      </ul>
    </details>
  );
}

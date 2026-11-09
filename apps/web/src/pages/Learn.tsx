import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Bar, EpisodeListItem, EpisodeState, PredictionItem } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { episode as copy } from "../copy/episode";
import { Button, Callout, Card, EmptyState, ErrorMessage, Loading } from "../components/ui";
import { EpisodeChart } from "../episode/EpisodeChart";
import { GuessForm } from "../episode/GuessForm";
import { GuessList } from "../episode/GuessList";
import { CandleHelp, Coach, Phase, StatusLine } from "../episode/Parts";

export function Learn() {
  const { api } = useAuth();
  const nav = useNavigate();
  const [kind, setKind] = useState<"mixed" | "real" | "synthetic">("mixed");
  const [length, setLength] = useState("250");
  const [list, setList] = useState<EpisodeListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.listEpisodes().then(setList, (e) => setError(e.message)); }, [api]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const e = await api.createEpisode({ kind, n_bars: Number(length) });
      nav(`/learn/${e.episode_id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Learn</h1>
      <Card title={copy.startTitle}>
        <p>{copy.hiddenNote}</p>
        <p><label htmlFor="kind">{copy.kindLabel}</label>
          <select id="kind" value={kind} onChange={(e) => setKind(e.target.value as any)}>
            {Object.entries(copy.kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></p>
        <p><label htmlFor="length">{copy.lengthLabel}</label>
          <select id="length" value={length} onChange={(e) => setLength(e.target.value)}>
            {Object.entries(copy.lengths).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></p>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <Button onClick={start} disabled={busy}>{copy.start}</Button>
      </Card>
      <Card title={copy.yourEpisodes}>
        {!list && !error && <Loading />}
        {list && list.length === 0 && <EmptyState>{copy.noEpisodes}</EmptyState>}
        {list && list.length > 0 && (
          <table aria-label={copy.yourEpisodes}>
            <thead><tr><th>Started</th><th>Progress</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.episode_id}>
                  <td>{new Date(e.created_at).toLocaleString()}</td><td>Day {e.day} of {e.n_bars}</td>
                  <td>{e.status === "open" ? "Open" : "Revealed"}</td>
                  <td>{e.status === "open" ? <Link to={`/learn/${e.episode_id}`}>{copy.resume}</Link> : <Link to={`/score/${e.episode_id}`}>{copy.see}</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

export function EpisodeScreen() {
  const { id = "" } = useParams();
  const { api } = useAuth();
  const nav = useNavigate();
  const [state, setState] = useState<EpisodeState | null>(null);
  const [bars, setBars] = useState<Bar[]>([]);
  const [preds, setPreds] = useState<PredictionItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>(0);
  const [showVolume, setShowVolume] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [moving, setMoving] = useState(false);
  const moveLock = useRef(false);

  const load = useCallback(async () => {
    try {
      const [s, b, p] = await Promise.all([api.episode(id), api.bars(id), api.predictions(id)]);
      setState(s); setBars(b.bars); setPreds(p.predictions); setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, id]);
  useEffect(() => { void load(); }, [load]);

  async function advance(n: number) {
    if (moveLock.current) return;
    moveLock.current = true;
    setMoving(true);
    try { await api.advance(id, n); setPhase(0); await load(); } catch (e) { setError((e as Error).message); } finally { moveLock.current = false; setMoving(false); }
  }

  async function send(h: 1 | 5 | 10, p: number) {
    const r = await api.guess(id, h, p);
    if (r.created !== false) setPhase(2);
    await load();
    return r;
  }

  if (error && !state) return <ErrorMessage>{error}</ErrorMessage>;
  if (!state) return <Loading>{copy.loading}</Loading>;
  const waiting = preds.filter((p) => p.status === "pending").length;
  const answered = preds.some((p) => p.status === "resolved");
  const revealed = state.status === "revealed";
  const atEnd = state.day >= state.n_bars;

  return (
    <div onKeyDown={(e) => { if (e.key === "ArrowRight" && !revealed && !atEnd && (e.target as HTMLElement).tagName !== "INPUT") void advance(1); }}>
      <h1>{copy.chartTitle}</h1>
      <Coach phase={phase} answered={answered} />
      <StatusLine day={state.day} nBars={state.n_bars} waiting={waiting} revealed={revealed} />
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {answered && <Callout kind="tip">{copy.hintAfterAnswer}</Callout>}
      <Card title={copy.chartTitle}>
        <CandleHelp />
        <EpisodeChart bars={bars} showVolume={showVolume} />
        <details onToggle={(e) => setShowVolume((e.target as HTMLDetailsElement).open)}>
          <summary>{copy.showMore}: {copy.showVolume}</summary>
          <p className="muted">{copy.volumeNote}</p>
        </details>
      </Card>
      <div className="grid">
        <Card title={copy.askTitle}>
          <GuessForm day={state.day} nBars={state.n_bars} disabled={revealed} onSend={send} onTouched={() => setPhase((p) => (p === 0 ? 1 : p))} />
        </Card>
        <Card title={copy.moveTitle}>
          <div className="row">
            <Button onClick={() => advance(1)} disabled={moving || atEnd || revealed}>{copy.nextDay}</Button>
            <Button variant="secondary" onClick={() => advance(5)} disabled={moving || atEnd || revealed}>{copy.fiveDays}</Button>
          </div>
          {atEnd && <p>{copy.atEnd}</p>}
          <p className="muted">{copy.keyHint}</p>
        </Card>
      </div>
      <Card title={copy.guessesTitle}><GuessList items={preds} /></Card>
      {!finishing ? (
        <Button onClick={() => setFinishing(true)}>{copy.finish}</Button>
      ) : (
        <Card title={copy.finishTitle}>
          <p>{copy.finishBody}</p>
          <div className="row">
            <Button onClick={() => nav(`/score/${id}`)}>{copy.finishYes}</Button>
            <Button variant="secondary" onClick={() => setFinishing(false)}>{copy.finishNo}</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

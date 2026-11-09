import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Bar, EpisodeListItem, EpisodeState, PredictionItem } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { episode as copy } from "../copy/episode";
import { Icon } from "../components/Icon";
import { Button, Callout, Card, Chip, EmptyState, ErrorMessage, Loading, PageHead, ProgressBar } from "../components/ui";
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
      <PageHead title="Learn" eyebrow={<><Icon name="eye" />Guess and get scored</>} intro="Look at a hidden chart, guess what happens next, and see how honest your guesses are." />
      <div className="episode-grid">
        <Card title={copy.startTitle}>
          <p>{copy.hiddenNote}</p>
          <div className="field">
            <label htmlFor="kind">{copy.kindLabel}</label>
            <select id="kind" value={kind} onChange={(e) => setKind(e.target.value as any)}>
              {Object.entries(copy.kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="length">{copy.lengthLabel}</label>
            <select id="length" value={length} onChange={(e) => setLength(e.target.value)}>
              {Object.entries(copy.lengths).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          {error && <ErrorMessage>{error}</ErrorMessage>}
          <Button size="big" onClick={start} disabled={busy}>{copy.start}<Icon name="arrow" /></Button>
        </Card>
        <Card title="How a round works">
          <ol className="how-list">
            <li><Icon name="eye" /><span><strong>Look.</strong> The chart has no name and no dates.</span></li>
            <li><Icon name="target" /><span><strong>Guess.</strong> Pick a number from 1% to 99%.</span></li>
            <li><Icon name="check" /><span><strong>Learn.</strong> Move forward and see what really happened.</span></li>
          </ol>
        </Card>
      </div>
      <h2 className="section-title">{copy.yourEpisodes}</h2>
      {!list && !error && <Loading />}
      {list && list.length === 0 && <EmptyState>{copy.noEpisodes}</EmptyState>}
      {list && list.length > 0 && (
        <div className="grid" aria-label={copy.yourEpisodes} role="list">
          {list.map((e) => (
            <article className="card" key={e.episode_id} role="listitem">
              <div className="card-head">
                <h3>{new Date(e.created_at).toLocaleDateString()}</h3>
                {e.status === "open" ? <Chip kind="accent">Open</Chip> : <Chip kind="ok">Revealed</Chip>}
              </div>
              <p className="muted">Day {e.day} of {e.n_bars}</p>
              <ProgressBar value={e.day} max={e.n_bars} label="Episode progress" />
              <p style={{ marginTop: "0.9rem", marginBottom: 0 }}>
                {e.status === "open" ? <Link className="btn secondary small" to={`/learn/${e.episode_id}`}>{copy.resume}</Link> : <Link className="btn secondary small" to={`/score/${e.episode_id}`}>{copy.see}</Link>}
              </p>
            </article>
          ))}
        </div>
      )}
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
      <PageHead title={copy.chartTitle} eyebrow={<><Icon name="eye" />Hidden chart</>} />
      <Coach phase={phase} answered={answered} />
      <StatusLine day={state.day} nBars={state.n_bars} waiting={waiting} revealed={revealed} />
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {answered && <Callout kind="tip">{copy.hintAfterAnswer}</Callout>}
      <div className="episode-grid">
        <div>
          <Card title={copy.chartTitle}>
            <CandleHelp />
            <EpisodeChart bars={bars} showVolume={showVolume} />
            <details onToggle={(e) => setShowVolume((e.target as HTMLDetailsElement).open)}>
              <summary>{copy.showMore}: {copy.showVolume}</summary>
              <p className="muted">{copy.volumeNote}</p>
            </details>
          </Card>
          <Card title={copy.guessesTitle}><GuessList items={preds} /></Card>
        </div>
        <div className="sticky">
          <Card title={copy.askTitle}>
            <GuessForm day={state.day} nBars={state.n_bars} disabled={revealed} onSend={send} onTouched={() => setPhase((p) => (p === 0 ? 1 : p))} />
          </Card>
          <Card title={copy.moveTitle}>
            <div className="row">
              <Button onClick={() => advance(1)} disabled={moving || atEnd || revealed}>{copy.nextDay}</Button>
              <Button variant="secondary" onClick={() => advance(5)} disabled={moving || atEnd || revealed}>{copy.fiveDays}</Button>
            </div>
            {atEnd && <p>{copy.atEnd}</p>}
            <p className="hint">{copy.keyHint}</p>
          </Card>
          {!finishing ? (
            <Button variant="secondary" onClick={() => setFinishing(true)}>{copy.finish}</Button>
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
      </div>
    </div>
  );
}

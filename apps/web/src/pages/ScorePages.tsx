import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { EpisodeState, Progress, Reveal, Score, SystemInfo, TraceEntry } from "../api/client";
import { API_BASE } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { hood } from "../copy/hood";
import { score as copy } from "../copy/score";
import { Icon } from "../components/Icon";
import { Callout, Card, EmptyState, ErrorMessage, Loading, num, PageHead } from "../components/ui";
import { ArchitectureDiagram, RequestTable, StatusLights, SystemMap, WhatTheServerKnows } from "../hood/HoodParts";
import { CalibrationPlot, DataTrail, LuckPanel, RevealBox, ScoreCard } from "../score/ScoreParts";

export function ScorePage() {
  const { id = "" } = useParams();
  const { api } = useAuth();
  const [s, setS] = useState<Score | null>(null);
  const [ep, setEp] = useState<EpisodeState | null>(null);
  const [rev, setRev] = useState<Reveal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [score, state] = await Promise.all([api.score(id), api.episode(id)]);
      setS(score); setEp(state); setError(null);
    } catch (e) { setError((e as Error).message); }
  }, [api, id]);
  useEffect(() => { void load(); }, [load]);

  async function reveal() {
    setRevealError(null);
    try { setRev(await api.reveal(id)); await load(); } catch { setRevealError(copy.revealFailed); }
  }

  if (error && !s) return <ErrorMessage>{error}</ErrorMessage>;
  if (!s || !ep) return <Loading />;
  const revealed = ep.status === "revealed" || rev !== null;
  return (
    <>
      <PageHead title={copy.title} eyebrow={<><Icon name="target" />Score</>} />
      <Card><ScoreCard s={s} /></Card>
      {s.bins.some((b) => b.n > 0) && <Card><CalibrationPlot bins={s.bins} /></Card>}
      {s.enough && <Card><LuckPanel s={s} /></Card>}
      <Card>
        {revealed && !rev ? (
          <>
            <p>This episode is already revealed.</p>
            <RevealBox onReveal={reveal} result={null} error={revealError} />
          </>
        ) : <RevealBox onReveal={reveal} result={rev} error={revealError} />}
      </Card>
      {!revealed && <p><Link to={`/learn/${id}`}>Back to the chart</Link></p>}
    </>
  );
}

export function ProgressPage() {
  const { api } = useAuth();
  const [p, setP] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.progress().then(setP, (e) => setError(e.message)); }, [api]);
  if (error) return <ErrorMessage>{error}</ErrorMessage>;
  if (!p) return <Loading />;
  const revealedAny = p.by_kind.real.n + p.by_kind.synthetic.n > 0;
  return (
    <>
      <PageHead title={copy.progressTitle} eyebrow={<><Icon name="chart" />Across all episodes</>} />
      {p.overall.n === 0 ? <EmptyState>{copy.progressEmpty}</EmptyState> : (
        <>
          <Card><ScoreCard s={{ ...p.overall, bins: [], murphy: {}, counts: undefined }} /></Card>
          <Card title="Real and made-up charts">
            {revealedAny ? (
              <div className="table-wrap"><table aria-label="Real and made-up charts">
                <thead><tr><th>Kind</th><th>Answered guesses</th><th>Score</th></tr></thead>
                <tbody>
                  <tr><td>Real charts</td><td>{p.by_kind.real.n}</td><td>{num(p.by_kind.real.brier)}</td></tr>
                  <tr><td>Made-up charts</td><td>{p.by_kind.synthetic.n}</td><td>{num(p.by_kind.synthetic.brier)}</td></tr>
                </tbody>
              </table></div>
            ) : <EmptyState>Reveal an episode to see this split.</EmptyState>}
            <p className="muted">{copy.madeUpNote}</p>
          </Card>
          <Card title={copy.byFarTitle}>
            <table aria-label={copy.byFarTitle}>
              <thead><tr><th>How far ahead</th><th>Answered guesses</th><th>Score</th></tr></thead>
              <tbody>{(["1", "5", "10"] as const).map((h) => <tr key={h}><td>{h} {h === "1" ? "day" : "days"}</td><td>{p.by_horizon[h].n}</td><td>{num(p.by_horizon[h].brier)}</td></tr>)}</tbody>
            </table>
          </Card>
        </>
      )}
      <Callout kind="careful">In this sample, a score only tells you about the guesses you made so far.</Callout>
    </>
  );
}

export function UnderTheHood() {
  const { api } = useAuth();
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [episode, setEpisode] = useState<EpisodeState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.system().then(setSystem, (e) => setError(e.message));
    api.trace().then(setTrace, () => undefined);
    api.listEpisodes().then((l) => { if (l[0]) setEpisode(l[0]); }, () => undefined);
  }, [api]);

  return (
    <>
      <PageHead title={hood.title} intro={hood.intro} eyebrow={<><Icon name="layers" />Behind the screens</>} />
      <Card title="The four parts"><ArchitectureDiagram /></Card>
      <Card title={hood.statusTitle}>
        {error ? <ErrorMessage>{error}</ErrorMessage> : system ? <StatusLights system={system} /> : <Loading />}
      </Card>
      <Card title={hood.knowsTitle}><WhatTheServerKnows episode={episode} /></Card>
      <Card title={hood.requestsTitle}><RequestTable rows={trace} /></Card>
      <Card title={hood.trailTitle}><p>{hood.trailBody}</p></Card>
      {system && <Card><SystemMap system={system} gatewayBase={API_BASE} /></Card>}
    </>
  );
}

export { DataTrail };

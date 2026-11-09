import { useId, useState } from "react";
import type { Bin, Reveal, Score } from "../api/client";
import { score as copy } from "../copy/score";
import { Button, Callout, num, pct, Stat } from "../components/ui";

const COIN = 0.25;

/** 0 (perfect) to 0.5 (clearly worse than guessing); the coin-flip line sits in the middle at 0.25. */
export function ScoreMeter({ value }: { value: number }) {
  const pos = Math.min(Math.max(value, 0), 0.5) / 0.5 * 100;
  return (
    <div className="meter" role="img" aria-label={`Score meter from 0 (perfect) to 0.5. Guessing is at 0.25. Your score is ${num(value)}.`}>
      <span className="mark" style={{ left: "50%" }}><span>{copy.meterGuessing} (0.25)</span></span>
      <span className="mark you" style={{ left: `${pos}%` }}><span>You: {num(value)}</span></span>
      <span className="end" style={{ left: 10 }}>{copy.meterPerfect}</span>
      <span className="end" style={{ right: 10 }}>{copy.meterWorse}</span>
    </div>
  );
}

export function ScoreCard({ s }: { s: Score }) {
  const counts = s.counts;
  const total = counts ? counts.resolved + counts.pending + counts.void : 0;
  return (
    <>
      <h3>{copy.howComputed}</h3>
      {s.brier === null ? (
        <p>You have no answered guesses yet. Send a guess, move forward, and come back.</p>
      ) : (
        <>
          <Stat big={num(s.brier)} meaning={<>{copy.yourScore}. {copy.lowerBetter}</>} />
          <ScoreMeter value={s.brier} />
        </>
      )}
      {counts && (
        <p aria-label={copy.counts}>
          Answered {counts.resolved}, waiting {counts.pending}, not counted {counts.void}. <span className="muted">(Total {total})</span>
        </p>
      )}
      <h3>{copy.mightMean}</h3>
      {!s.enough ? (
        <Callout kind="info"><strong>{copy.tooFewTitle}.</strong> You have {s.n} answered {s.n === 1 ? "guess" : "guesses"}. {copy.tooFewBody}</Callout>
      ) : (
        <p>{s.brier! < COIN - 0.01 ? copy.betterThan : s.brier! > COIN + 0.01 ? copy.worseThan : copy.sameAs}</p>
      )}
    </>
  );
}

export function CalibrationPlot({ bins }: { bins: Bin[] }) {
  const tableId = useId();
  const filled = bins.filter((b) => b.n > 0 && b.mean_forecast !== null && b.observed !== null);
  const W = 340, H = 340, pad = 44;
  const x = (v: number) => pad + v * (W - 2 * pad);
  const y = (v: number) => H - pad - v * (H - 2 * pad);
  return (
    <div>
      <h3>{copy.calibTitle}</h3>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: 440, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12 }}
        role="img" aria-label="Calibration plot. The diagonal line is perfect. Each dot is one group of similar guesses." aria-describedby={tableId}>
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} style={{ stroke: "var(--muted)" }} strokeDasharray="5 4" />
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(0)} style={{ stroke: "var(--text)" }} />
        <line x1={x(0)} y1={y(0)} x2={x(0)} y2={y(1)} style={{ stroke: "var(--text)" }} />
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <text x={x(t)} y={H - 22} fontSize="11" textAnchor="middle" style={{ fill: "var(--text)" }}>{Math.round(t * 100)}%</text>
            <text x={pad - 6} y={y(t) + 4} fontSize="11" textAnchor="end" style={{ fill: "var(--text)" }}>{Math.round(t * 100)}%</text>
          </g>
        ))}
        <text x={W / 2} y={H - 6} fontSize="12" textAnchor="middle" style={{ fill: "var(--text)" }}>What you said</text>
        <text x={12} y={H / 2} fontSize="12" textAnchor="middle" style={{ fill: "var(--text)" }} transform={`rotate(-90 12 ${H / 2})`}>How often it happened</text>
        {filled.map((b) => (
          <g key={b.bin_low} data-testid="calib-dot">
            <line x1={x(b.mean_forecast!)} x2={x(b.mean_forecast!)} y1={y(b.wilson_low!)} y2={y(b.wilson_high!)} style={{ stroke: "var(--accent)" }} strokeWidth="2" />
            <circle cx={x(b.mean_forecast!)} cy={y(b.observed!)} r={b.sparse ? 6 : 7} style={{ fill: b.sparse ? "var(--surface)" : "var(--accent)", stroke: "var(--accent)" }} strokeWidth="2" data-sparse={b.sparse} />
            <text x={x(b.mean_forecast!) + (b.mean_forecast! > 0.55 ? -10 : 10)} y={y(b.observed!) - 8} textAnchor={b.mean_forecast! > 0.55 ? "end" : "start"} fontSize="11" style={{ fill: "var(--text)" }}>n={b.n}{b.sparse ? ` (${copy.fewPoints})` : ""}</text>
          </g>
        ))}
      </svg>
      <p className="muted">{copy.calibHelp}</p>
      <div className="table-wrap"><table id={tableId} aria-label={copy.tableTitle}>
        <caption>{copy.tableTitle}</caption>
        <thead><tr><th>Group (you said)</th><th>Guesses</th><th>Average you said</th><th>Happened</th><th>Likely range</th></tr></thead>
        <tbody>
          {filled.map((b) => (
            <tr key={b.bin_low}>
              <td>{Math.round(b.bin_low * 100)}% to {Math.round(b.bin_high * 100)}%</td><td>{b.n}{b.sparse ? ` (${copy.fewPoints})` : ""}</td>
              <td>{pct(b.mean_forecast)}</td><td>{pct(b.observed)}</td><td>{pct(b.wilson_low)} to {pct(b.wilson_high)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

export function LuckPanel({ s }: { s: Score }) {
  const [more, setMore] = useState(false);
  if (!s.enough || s.luck.luck_probability === null) return null;
  const x = Math.round(s.luck.luck_probability * 100);
  return (
    <section aria-label={copy.luckTitle}>
      <h3>{copy.luckTitle}</h3>
      <p>If your percentages had been matched to random outcomes, you would have scored this well or better about {x} out of 100 times.</p>
      <p className="muted">{copy.luckCaution}</p>
      <Button variant="secondary" onClick={() => setMore((m) => !m)} aria-expanded={more}>Show more</Button>
      {more && <p className="muted">We shuffled the outcomes {s.luck.n_perm} times (seed {s.luck.seed}). In {s.luck.count} shuffles the score was as good as yours or better.</p>}
    </section>
  );
}

export function DataTrail({ trail }: { trail: NonNullable<Reveal["data_trail"]> }) {
  return (
    <section aria-label={copy.trailTitle}>
      <h3>{copy.trailTitle}</h3>
      <ul>
        <li>Provider: {trail.provider}{trail.retrieved_at ? `, saved ${trail.retrieved_at}` : ""}.</li>
        <li>{trail.adjustment}</li>
        <li>{trail.feed_caveat}</li>
        <li>{trail.universe_caveat}</li>
        {trail.file_hash_matches === false && <li>Warning: the saved file did not match its fingerprint.</li>}
      </ul>
      <Callout kind="careful">{copy.licence}</Callout>
    </section>
  );
}

export function RevealResult({ r }: { r: Reveal }) {
  return (
    <section aria-label="What the episode was">
      <h3>{r.kind === "real" ? copy.wasReal : copy.wasMadeUp}</h3>
      {r.identity ? (
        <p>
          It was <strong>{r.identity.name}</strong> ({r.identity.symbol}), from {r.identity.first_date} to {r.identity.last_date}. Data source: {r.identity.source}.
        </p>
      ) : (
        <p>{r.statement} Random seed: {r.seed}.</p>
      )}
      {r.data_trail && <DataTrail trail={r.data_trail} />}
      <h3>{copy.notTitle}</h3>
      <ul>{copy.notList.map((t) => <li key={t}>{t}</li>)}</ul>
    </section>
  );
}

export function RevealBox({ onReveal, result, error }: { onReveal: () => Promise<void>; result: Reveal | null; error: string | null }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (result) return <RevealResult r={result} />;
  return (
    <section aria-label={copy.revealTitle}>
      <h2>{copy.revealTitle}</h2>
      <p>{copy.revealBody}</p>
      {error && <Callout kind="careful"><span role="alert">{error}</span></Callout>}
      {!asking ? (
        <Button onClick={() => setAsking(true)}>{copy.revealButton}</Button>
      ) : (
        <div className="row">
          <Button disabled={busy} onClick={async () => { setBusy(true); try { await onReveal(); } finally { setBusy(false); setAsking(false); } }}>{copy.revealConfirm}</Button>
          <Button variant="secondary" onClick={() => setAsking(false)}>{copy.revealCancel}</Button>
        </div>
      )}
    </section>
  );
}

import { ReactNode, useId, useState } from "react";
import { Button } from "../../components/ui";
import { lessons } from "../../copy/lessons";
import { DEFAULT_MANY_TRIES_SEED, flips, longestRun, manyTries, outcomes } from "./random";

const t = lessons.demo;

/** Frame shared by the demos: a title, what to look at, controls, the result in words, and the "made-up data" note. */
function Frame({ title, look, controls, children }: { title: string; look: string; controls: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="demo" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      <p className="muted">{look}</p>
      <div className="demo-controls">{controls}</div>
      <div className="demo-result" role="status" aria-live="polite">{children}</div>
      <p className="demo-note">{t.madeUp}</p>
    </section>
  );
}

function SeedButton({ seed, onNext, label = t.anotherSeed }: { seed: number; onNext: () => void; label?: string }) {
  return (
    <>
      <Button variant="secondary" size="small" onClick={onNext}>{label}</Button>
      <span className="chip">{t.seedLabel(seed)}</span>
    </>
  );
}

export function Chance70() {
  const [percent, setPercent] = useState(70);
  const [seed, setSeed] = useState(1);
  const days = outcomes(seed, percent);
  const ups = days.filter(Boolean).length;
  const sliderId = useId();
  return (
    <Frame title={t.chance.title} look={t.chance.look} controls={
      <>
        <label htmlFor={sliderId}>{t.chance.slider}: <strong>{percent}</strong></label>
        <input id={sliderId} type="range" min={1} max={99} value={percent} onChange={(e) => setPercent(Number(e.target.value))} />
        <SeedButton seed={seed} onNext={() => setSeed(seed + 1)} />
      </>
    }>
      <ul className="marks" aria-label={t.chance.result(ups, days.length)}>
        {days.map((up, i) => (
          <li key={i} className={up ? "mark up" : "mark down"}><span aria-hidden="true">{up ? "▲" : "▼"}</span> {up ? t.chance.up : t.chance.down}</li>
        ))}
      </ul>
      <p><strong>{t.chance.result(ups, days.length)}</strong></p>
    </Frame>
  );
}

export function CoinStreaks() {
  const [seed, setSeed] = useState(1);
  const seq = flips(seed);
  const run = longestRun(seq);
  const side = run.symbol === "H" ? t.coins.heads : t.coins.tails;
  return (
    <Frame title={t.coins.title} look={t.coins.look} controls={<SeedButton seed={seed} onNext={() => setSeed(seed + 1)} label={t.coins.flip} />}>
      <p className="flips" aria-label={t.coins.row}>
        {seq.map((s, i) => (
          <span key={i} className={i >= run.start && i < run.start + run.length ? "flip hit" : "flip"}>{s}</span>
        ))}
      </p>
      <p><strong>{t.coins.result(run.length, side)}</strong> {run.length >= 5 ? t.coins.normal : t.coins.short}</p>
    </Frame>
  );
}

const signed = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`;

export function ManyTries() {
  const [seed, setSeed] = useState(DEFAULT_MANY_TRIES_SEED);
  const r = manyTries(seed);
  return (
    <Frame title={t.tries.title} look={t.tries.look} controls={<SeedButton seed={seed} onNext={() => setSeed(seed + 1)} label={t.tries.run} />}>
      <p><strong>{t.tries.result(signed(r.firstPct), signed(r.newPct))}</strong></p>
      <p className="muted">{t.tries.rule(r.best.fast, r.best.slow)} {t.tries.caution}</p>
    </Frame>
  );
}

export const DEMOS: Record<string, () => ReactNode> = {
  "chance-70": () => <Chance70 />,
  "coin-streaks": () => <CoinStreaks />,
  "many-tries": () => <ManyTries />,
};

/** Unknown ids render a plain note and nothing else. */
export function Demo({ id }: { id: string }) {
  const make = Object.prototype.hasOwnProperty.call(DEMOS, id) ? DEMOS[id] : undefined;
  if (!make) return <p className="muted" role="note">{t.unknown}</p>;
  return <>{make()}</>;
}

import { episode as copy } from "../copy/episode";
import { Stepper } from "../components/ui";
import { Rich } from "../components/Term";

export type Phase = 0 | 1 | 2; // 0 look, 1 guess (form touched), 2 move on (guess sent)

export function Coach({ phase, answered }: { phase: Phase; answered: boolean }) {
  const steps = copy.coach.map((s, i) => ({
    step: s.step,
    hint: i === 2 && answered ? copy.hintAfterAnswer : i === 2 && phase === 2 ? copy.hintAfterSend : s.hint,
  }));
  return <Stepper steps={steps} current={phase} />;
}

export function StatusLine({ day, nBars, waiting, revealed }: { day: number; nBars: number; waiting: number; revealed: boolean }) {
  return (
    <p role="status" aria-live="polite" className="muted">
      Day {day} of {nBars} - {waiting} {waiting === 1 ? "guess" : "guesses"} waiting - {revealed ? "this episode is revealed" : "name, dates and price level still hidden"}.
    </p>
  );
}

/** A tiny labelled picture of one candle, so "open, high, low, close" mean something. */
export function CandleHelp() {
  return (
    <details>
      <summary><Rich text="What is a {{candle|candle}}?" /></summary>
      <svg width="260" height="150" role="img" aria-label="A candle: a box from the open price to the close price, with thin lines to the high and the low." style={{ background: "#fff", border: "1px solid #aab4c3", borderRadius: 8 }}>
        <line x1="70" x2="70" y1="15" y2="135" stroke="#1b2330" strokeWidth="2" />
        <rect x="45" y="45" width="50" height="60" fill="#14663a" stroke="#14663a" />
        <text x="110" y="22" fontSize="13" fill="#1b2330">high: the top line</text>
        <text x="110" y="50" fontSize="13" fill="#1b2330">close: top of an up box</text>
        <text x="110" y="108" fontSize="13" fill="#1b2330">open: bottom of an up box</text>
        <text x="110" y="138" fontSize="13" fill="#1b2330">low: the bottom line</text>
      </svg>
      <p className="muted">An up day has a close above its open. Up days are drawn with an up arrow in the table below the chart.</p>
    </details>
  );
}

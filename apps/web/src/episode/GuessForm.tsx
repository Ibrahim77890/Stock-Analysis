import { useRef, useState } from "react";
import type { PredictionItem } from "../api/client";
import { episode as copy } from "../copy/episode";
import { Button, Callout } from "../components/ui";

type Horizon = 1 | 5 | 10;
const HORIZONS: Horizon[] = [1, 5, 10];

/** "7 out of 10" for 70%, "5.5 out of 10" for 55%. */
export const outOfTen = (percent: number): string => `${Number((percent / 10).toFixed(1))} out of 10`;

interface Props {
  day: number;
  nBars: number;
  disabled?: boolean;
  onSend: (horizon: Horizon, pUp: number) => Promise<PredictionItem>;
  onTouched?: () => void;
}

export function GuessForm({ day, nBars, disabled, onSend, onTouched }: Props) {
  const [horizon, setHorizon] = useState<Horizon>(1);
  const [text, setText] = useState("50");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  const percent = Number(text);
  const valid = /^\d{1,2}$/.test(text) && percent >= 1 && percent <= 99;
  const tooLate = day + horizon > nBars;

  async function submit() {
    if (!valid || tooLate || disabled || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const r = await onSend(horizon, Number((percent / 100).toFixed(4)));
      setMessage(r.created === false ? copy.alreadySent : null);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const touch = () => onTouched?.();

  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} aria-label={copy.askTitle}>
      <fieldset style={{ border: "none", padding: 0, margin: "0 0 1.1rem" }}>
        <legend style={{ fontWeight: 600, marginBottom: "0.4rem" }}>{copy.howFar}</legend>
        <div className="segmented">
          {HORIZONS.map((h) => {
            const late = day + h > nBars;
            return (
              <label key={h} style={late ? { opacity: 0.6 } : undefined}>
                <input type="radio" name="horizon" value={h} checked={horizon === h} disabled={late}
                  onChange={() => { setHorizon(h); touch(); }} />
                {" "}<span>{copy.horizons[String(h) as "1" | "5" | "10"]}</span>
                {late && <span className="muted"> ({copy.tooLate})</span>}
              </label>
            );
          })}
        </div>
      </fieldset>

      <label htmlFor="percent-number">{copy.howSure}</label>
      <div className="row">
        <input id="percent-slider" aria-label={`${copy.howSure} (slider)`} type="range" min={1} max={99} value={valid ? percent : 50}
          onChange={(e) => { setText(e.target.value); touch(); }} />
        <input id="percent-number" type="number" min={1} max={99} value={text} aria-invalid={!valid} style={{ width: "5.5rem" }}
          onChange={(e) => { setText(e.target.value); touch(); }} />
        <span aria-hidden="true">%</span>
      </div>
      <p className="hint">{copy.noIdea}. {copy.verySure}.</p>
      {valid
        ? <p aria-live="polite">You are saying: {outOfTen(percent)} times I would be right about "higher".</p>
        : <p role="alert" className="error-text">Please type a whole number from 1 to 99.</p>}
      <Callout kind="careful">{copy.noTakeBacks}</Callout>
      <Button type="submit" size="big" disabled={!valid || tooLate || disabled || busy}>{busy ? copy.sending : copy.send}</Button>
      {message && <p role="status" style={{ marginTop: "0.6rem" }}>{message}</p>}
    </form>
  );
}

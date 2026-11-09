import { useRef, useState } from "react";
import type { RuleInput } from "../api/client";
import { Icon } from "../components/Icon";
import { Rich } from "../components/Term";
import { Button, Card } from "../components/ui";
import { lab } from "../copy/lab";

export interface RuleErrors { fast?: string; slow?: string; cost?: string }

const isWhole = (t: string) => /^\d{1,3}$/.test(t.trim());

/** The checks mirror the limits of the gateway and the Python service; the server still checks everything again. */
export function checkRule(fastText: string, slowText: string, costText: string): { errors: RuleErrors; rule: RuleInput | null } {
  const errors: RuleErrors = {};
  const fast = Number(fastText), slow = Number(slowText), cost = Number(costText);
  if (!isWhole(fastText) || fast < 2 || fast > 299) errors.fast = lab.errFast;
  if (!isWhole(slowText) || slow < 3 || slow > 300) errors.slow = lab.errSlow;
  if (!errors.fast && !errors.slow && fast >= slow) errors.fast = lab.errFastSlow;
  if (costText.trim() === "" || !Number.isFinite(cost) || cost < 0 || cost > 50) errors.cost = lab.errCost;
  const ok = Object.keys(errors).length === 0;
  return { errors, rule: ok ? { fast, slow, cost_bps: cost } : null };
}

export function RuleForm({ busy, onRun, initial }: { busy: boolean; onRun: (r: RuleInput) => Promise<void> | void; initial?: Partial<RuleInput> }) {
  const [fast, setFast] = useState(String(initial?.fast ?? 20));
  const [slow, setSlow] = useState(String(initial?.slow ?? 100));
  const [cost, setCost] = useState(String(initial?.cost_bps ?? 2));
  const [errors, setErrors] = useState<RuleErrors>({});
  const lock = useRef(false);

  async function submit() {
    if (busy || lock.current) return;
    const { errors: e, rule } = checkRule(fast, slow, cost);
    setErrors(e);
    if (!rule) return;
    lock.current = true;
    try { await onRun(rule); } finally { lock.current = false; }
  }

  return (
    <Card title={lab.ruleTitle}>
      <p className="muted"><Rich text={lab.ruleIntro} /></p>
      <form onSubmit={(ev) => { ev.preventDefault(); void submit(); }} noValidate aria-label={lab.ruleTitle}>
        <div className="rule-form">
          <div className="field">
            <label htmlFor="fast">{lab.fastLabel}</label>
            <input id="fast" type="number" inputMode="numeric" value={fast} aria-invalid={Boolean(errors.fast)} aria-describedby="fast-help" onChange={(e) => setFast(e.target.value)} />
            {errors.fast ? <p className="error-text" id="fast-help" role="alert">{errors.fast}</p> : <p className="hint" id="fast-help">{lab.fastHelp}</p>}
          </div>
          <div className="field">
            <label htmlFor="slow">{lab.slowLabel}</label>
            <input id="slow" type="number" inputMode="numeric" value={slow} aria-invalid={Boolean(errors.slow)} aria-describedby="slow-help" onChange={(e) => setSlow(e.target.value)} />
            {errors.slow ? <p className="error-text" id="slow-help" role="alert">{errors.slow}</p> : <p className="hint" id="slow-help">{lab.slowHelp}</p>}
          </div>
          <div className="field">
            <label htmlFor="cost">{lab.costLabel}</label>
            <input id="cost" type="number" inputMode="decimal" step="0.5" value={cost} aria-invalid={Boolean(errors.cost)} aria-describedby="cost-help" onChange={(e) => setCost(e.target.value)} />
            {errors.cost ? <p className="error-text" id="cost-help" role="alert">{errors.cost}</p> : <p className="hint" id="cost-help"><Rich text={lab.costHelp} /></p>}
          </div>
        </div>
        <Button type="submit" size="big" disabled={busy}>{busy ? <><span className="spinner" aria-hidden="true" /> {lab.running}</> : <>{lab.run}<Icon name="arrow" /></>}</Button>
      </form>
    </Card>
  );
}

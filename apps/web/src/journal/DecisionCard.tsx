import { useRef, useState } from "react";
import { ApiError, Decision, DecisionIn } from "../api/client";
import { Button, Callout } from "../components/ui";
import { decision as copy } from "../copy/journal";

interface Props {
  day: number;
  disabled?: boolean;
  onSend: (body: DecisionIn) => Promise<Decision>;
}

const newKey = (): string => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** One practice decision: a stance and a reason. The same key is reused until it is saved, so a double click stores one row. */
export function DecisionCard({ day, disabled, onSend }: Props) {
  const [stance, setStance] = useState<"long" | "flat">("flat");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const key = useRef(newKey());
  const sending = useRef(false);

  async function submit() {
    if (sending.current) return;
    if (!reason.trim()) { setMessage({ kind: "error", text: copy.needReason }); return; }
    sending.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const r = await onSend({ stance, reason: reason.trim(), client_key: key.current });
      setMessage({ kind: "ok", text: r.created === false ? copy.alreadySaved : copy.saved(r.day) });
      setReason("");
      key.current = newKey();
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      setMessage({ kind: "error", text: status === 429 || status === 422 ? (e as Error).message : copy.errors[status] ?? (e as Error).message });
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  if (disabled) return <p className="muted">{copy.revealedNote}</p>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <p className="muted small">{copy.intro}</p>
      <fieldset className="question">
        <legend>{copy.stanceLegend}</legend>
        {(["flat", "long"] as const).map((s) => (
          <label key={s} className={stance === s ? "option chosen" : "option"}>
            <input type="radio" name="stance" checked={stance === s} onChange={() => setStance(s)} />
            <span>{copy[s]}</span>
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor="decision-reason">{copy.reasonLabel}</label>
        <textarea id="decision-reason" rows={3} maxLength={280} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby="decision-count" />
        <p id="decision-count" className="muted small" aria-live="polite">{copy.reasonCounter(reason.length)}</p>
      </div>
      <Button type="submit" disabled={busy}>{busy ? copy.recording : copy.record}</Button>
      <p className="muted small">Day {day}</p>
      <div role="status" aria-live="polite">
        {message && <Callout kind={message.kind === "ok" ? "tip" : "careful"}>{message.text}</Callout>}
      </div>
    </form>
  );
}

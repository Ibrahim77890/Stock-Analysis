import { useEffect, useRef, useState } from "react";
import type { StudyOverview, VaultResult } from "../api/client";
import { Icon } from "../components/Icon";
import { Button, Callout, Card, ErrorMessage } from "../components/ui";
import { lab } from "../copy/lab";
import { pctSigned, ratio } from "../lib/format";
import { GrowthChart } from "./GrowthChart";
import { readingText, vaultReading, vaultSideBySide } from "./readings";

type Trial = StudyOverview["trials"][number];

/** Spend-once confirmation. A built-in dialog (never the browser's confirm): Cancel has focus first, Escape and Cancel close it,
 *  the word OPEN must be typed, and the button sends exactly one request. */
export function VaultDialog({ trial, busy, onCancel, onConfirm }: { trial: Trial; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const [typed, setTyped] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);
  const sent = useRef(false);
  useEffect(() => { cancelRef.current?.focus(); }, []);
  const ready = typed.trim() === "OPEN" && !busy;

  function trap(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.stopPropagation(); onCancel(); return; }
    if (e.key !== "Tab") return;
    const nodes = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input"))
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)); // document order
    if (!nodes.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function confirm() {
    if (!ready || sent.current) return;
    sent.current = true;
    onConfirm();
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="vault-dialog-title" onKeyDown={trap}>
        <h2 id="vault-dialog-title"><Icon name="lock" /> {lab.dialogTitle}</h2>
        <p>{lab.dialogRule(trial.fast, trial.slow, trial.cost_bps)}</p>
        <Callout kind="careful">{lab.dialogOnce}</Callout>
        <form onSubmit={(e) => { e.preventDefault(); confirm(); }}>
          <div className="field">
            <label htmlFor="vault-confirm">{lab.dialogType}</label>
            <input id="vault-confirm" type="text" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
          <div className="row">
            <Button ref={cancelRef} variant="secondary" onClick={onCancel}>{lab.dialogCancel}</Button>
            <Button type="submit" disabled={!ready}>{lab.dialogConfirm}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function VaultPanel({ study, vault, error, busy, onOpen }: {
  study: StudyOverview; vault: VaultResult | null; error: string | null; busy: boolean; onOpen: (t: Trial) => Promise<void>;
}) {
  const [choice, setChoice] = useState<string>("");
  const [asking, setAsking] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const trials = study.trials;
  const key = (t: Trial) => `${t.fast}/${t.slow}/${t.cost_bps}`;
  const chosen = trials.find((t) => key(t) === (choice || (trials.length ? key(trials[trials.length - 1]) : ""))) ?? null;

  function closeDialog() {
    setAsking(false);
    setTimeout(() => cardRef.current?.focus(), 0); // focus goes back to the vault card
  }

  if (vault) return <VaultOpened v={vault} />;

  return (
    <div className="card vault-card" ref={cardRef} tabIndex={-1} aria-label={lab.vaultTitle} role="region">
      <div className="card-head">
        <h2><span className="vault-lock"><Icon name="lock" /></span> {lab.vaultTitle}</h2>
        <span className="chip accent">{lab.vaultLocked}</span>
      </div>
      <p>{lab.vaultBefore(`${study.vault_years.toFixed(1)} years`)}</p>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {trials.length === 0 ? <p className="muted">{lab.vaultNeedRun}</p> : (
        <>
          <div className="field">
            <label htmlFor="vault-rule">{lab.vaultChoose}</label>
            <select id="vault-rule" value={chosen ? key(chosen) : ""} onChange={(e) => setChoice(e.target.value)}>
              {trials.map((t) => <option key={t.order} value={key(t)}>{t.fast}-day and {t.slow}-day, {t.cost_bps} bps</option>)}
            </select>
          </div>
          <Button disabled={!chosen || busy} onClick={() => setAsking(true)}>{lab.vaultButton}</Button>
        </>
      )}
      {asking && chosen && (
        <VaultDialog trial={chosen} busy={busy} onCancel={closeDialog}
          onConfirm={async () => { try { await onOpen(chosen); } finally { setAsking(false); } }} />
      )}
    </div>
  );
}

export function VaultOpened({ v }: { v: VaultResult }) {
  const reading = readingText(vaultReading(v));
  const rows = vaultSideBySide(v);
  return (
    <section className="stack" aria-label={lab.vaultOpenTitle}>
      <Card className="vault-card">
        <div className="card-head">
          <h2><span className="vault-lock"><Icon name="unlock" /></span> {lab.vaultOpenTitle}</h2>
          <span className="chip ok">{lab.vaultOpened}</span>
        </div>
        <p>{lab.vaultTried(v.ideas_tried)}</p>
        <p style={{ fontSize: "1.1rem", fontWeight: 600 }} data-testid="vault-reading">{reading}</p>
        <p className="muted">{lab.vaultNewStudy}</p>
      </Card>
      <Card title={lab.vaultCompare}>
        <div className="table-wrap">
          <table aria-label={lab.vaultCompare}>
            <thead>
              <tr><th />
                <th className="num">{lab.colPractice}: {lab.lineRule}</th><th className="num">{lab.colPractice}: {lab.lineHold}</th>
                <th className="num">{lab.colVault}: {lab.lineRule}</th><th className="num">{lab.colVault}: {lab.lineHold}</th></tr>
            </thead>
            <tbody>
              <tr><td>{lab.rows.total.label}</td>
                <td className="num">{pctSigned(v.practice.rule.total_return, 0)}</td><td className="num">{pctSigned(v.practice.buy_hold.total_return, 0)}</td>
                <td className="num">{pctSigned(v.rule.total_return, 0)}</td><td className="num">{pctSigned(v.buy_hold.total_return, 0)}</td></tr>
              {rows.map((r) => (
                <tr key={r.label}><td>{r.label}</td>
                  <td className="num">{r.practice[0]}</td><td className="num">{r.practice[1]}</td><td className="num">{r.vault[0]}</td><td className="num">{r.vault[1]}</td></tr>
              ))}
              <tr><td>{lab.sharpeLabel}</td>
                <td className="num">{ratio(v.practice.rule.sharpe)}</td><td className="num">{ratio(v.practice.buy_hold.sharpe)}</td>
                <td className="num">{ratio(v.rule.sharpe)}</td><td className="num">{ratio(v.buy_hold.sharpe)}</td></tr>
            </tbody>
          </table>
        </div>
        <p className="hint">{lab.vaultAfterNote}</p>
      </Card>
      <Card title={lab.vaultChartTitle}>
        <GrowthChart growth={v.growth} yearly={v.yearly} title={lab.vaultChartTitle} />
      </Card>
    </section>
  );
}

import { ReactNode, useState } from "react";
import type { LabRun } from "../api/client";
import { Icon } from "../components/Icon";
import { Rich } from "../components/Term";
import { Button, Callout, Card, Chip } from "../components/ui";
import { lab } from "../copy/lab";
import { fallText, growthOf100, pctPlain, pctSigned, ratio, whole } from "../lib/format";
import { GrowthChart } from "./GrowthChart";
import { costSentence, headline, luckSentence } from "./readings";

/** The fixed result cards, in a fixed order. Every number for the rule has its buy-and-hold number beside it. */
export function Results({ run, notice, extra }: { run: LabRun; notice?: string | null; extra?: ReactNode }) {
  const [more, setMore] = useState(false);
  const costs = costSentence(run.costs);
  return (
    <section aria-label={lab.resultsTitle} className="stack">
      <h2>{lab.resultsTitle}</h2>
      {notice && <Callout kind="info">{notice}</Callout>}
      {run.warnings.map((w) => <Callout key={w} kind="careful">{w}</Callout>)}
      <Card className="accent">
        <p style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: 0 }} data-testid="headline">{headline(run)}</p>
      </Card>

      <Card title={lab.chartTitle}>
        <p className="muted"><Rich text={lab.chartHelp} /></p>
        <GrowthChart growth={run.growth} yearly={run.yearly} />
      </Card>

      <Card title={lab.numbersTitle}>
        <div className="compare">
          <div className="col rule">
            <Chip kind="accent">{lab.lineRule}</Chip>
            <div className="headline">{pctSigned(run.rule.total_return, 0)}</div>
            <dl>
              <dt>{lab.rows.perYear.label}</dt><dd>{pctSigned(run.rule.cagr)}</dd>
              <dt>{lab.rows.fall.label}</dt><dd>{fallText(run.rule.max_drawdown)}</dd>
              <dt>{lab.rows.time.label}</dt><dd>{pctPlain(run.rule.exposure)}</dd>
              <dt>{lab.rows.trades.label}</dt><dd>{run.rule.trades}</dd>
            </dl>
          </div>
          <div className="col hold">
            <Chip>{lab.lineHold}</Chip>
            <div className="headline">{pctSigned(run.buy_hold.total_return, 0)}</div>
            <dl>
              <dt>{lab.rows.perYear.label}</dt><dd>{pctSigned(run.buy_hold.cagr)}</dd>
              <dt>{lab.rows.fall.label}</dt><dd>{fallText(run.buy_hold.max_drawdown)}</dd>
              <dt>{lab.rows.time.label}</dt><dd>{pctPlain(run.buy_hold.exposure)}</dd>
              <dt>{lab.rows.trades.label}</dt><dd>{run.buy_hold.trades}</dd>
            </dl>
          </div>
        </div>
        <ul className="how-list">
          <li><Icon name="info" /><span><strong>{lab.rows.total.label}.</strong> <span className="muted">{lab.rows.total.mean} The big number above is this one.</span></span></li>
          <li><Icon name="info" /><span><strong>{lab.rows.perYear.label}.</strong> <span className="muted">{lab.rows.perYear.mean}</span></span></li>
          <li><Icon name="info" /><span><strong>{lab.rows.fall.label}.</strong> <span className="muted">{lab.rows.fall.mean}</span></span></li>
        </ul>
        {run.rule.trades < 20 && <Callout kind="careful">{lab.tooFewTrades}</Callout>}
        <Button variant="ghost" size="small" aria-expanded={more} onClick={() => setMore((m) => !m)}>{lab.showMore}</Button>
        {more && (
          <p className="muted">
            <strong>{lab.sharpeLabel}:</strong> rule {ratio(run.rule.sharpe)}, buy and hold {ratio(run.buy_hold.sharpe)}. {lab.sharpeMean}
          </p>
        )}
      </Card>

      <Card title={lab.costsTitle}>
        <p className="muted">{lab.costsIntro}</p>
        <div className="table-wrap">
          <table aria-label={lab.costsTitle}>
            <thead><tr><th>{lab.costCol}</th><th className="num">{lab.ruleCol}</th><th className="num">{lab.holdCol}</th><th className="num">Trades</th></tr></thead>
            <tbody>
              {run.costs.map((c) => (
                <tr key={c.cost_bps} className={c.cost_bps === run.params.cost_bps ? "mark" : undefined}>
                  <td>{c.cost_bps} basis points{c.cost_bps === run.params.cost_bps ? " (yours)" : ""}</td>
                  <td className="num">{pctSigned(c.total_return, 0)}</td><td className="num">{pctSigned(c.buy_hold_total_return, 0)}</td><td className="num">{c.trades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {costs ? <p style={{ marginTop: "0.8rem" }}>{costs}</p> : <p className="muted">The cost table is not available for this run.</p>}
      </Card>

      <Card title={lab.luckTitle}>
        <p>{luckSentence(run.luck)}</p>
        <p className="muted">{lab.luckCaution}</p>
      </Card>

      {extra}
      <NotTell />
    </section>
  );
}

export function NotTell() {
  return (
    <Card title={lab.notTitle}>
      <ul className="dont-list">{lab.notList.map((t) => <li key={t}>{t}</li>)}</ul>
    </Card>
  );
}

export { growthOf100, whole };

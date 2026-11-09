import { createChart, LineSeries, LineStyle, PriceScaleMode } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { lab } from "../copy/lab";
import { CHART } from "../lib/chartTheme";
import { pctSigned } from "../lib/format";

export interface Growth { dates: string[]; rule: number[]; buy_hold: number[] }
export interface YearRow { year: number; rule: number; buy_hold: number }

/** Both lines start at 100, the axis is logarithmic, the lines differ by dash style as well as colour, and a table with the
 *  yearly changes is the text alternative. */
export function GrowthChart({ growth, yearly, title = lab.chartTitle }: { growth: Growth; yearly: YearRow[]; title?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [table, setTable] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      autoSize: true, height: 340,
      layout: { background: { color: CHART.surface }, textColor: CHART.text, fontFamily: CHART.font },
      grid: { vertLines: { color: CHART.grid }, horzLines: { color: CHART.grid } },
      rightPriceScale: { mode: PriceScaleMode.Logarithmic, borderColor: CHART.border },
      timeScale: { borderColor: CHART.border },
    });
    const rule = chart.addSeries(LineSeries, { color: CHART.rule, lineWidth: 3, title: lab.lineRule, priceFormat: { type: "price", precision: 0, minMove: 1 } });
    const hold = chart.addSeries(LineSeries, { color: CHART.hold, lineWidth: 2, lineStyle: LineStyle.Dashed, title: lab.lineHold, priceFormat: { type: "price", precision: 0, minMove: 1 } });
    rule.setData(growth.dates.map((d, i) => ({ time: d, value: growth.rule[i] })) as any);
    hold.setData(growth.dates.map((d, i) => ({ time: d, value: growth.buy_hold[i] })) as any);
    chart.timeScale().fitContent();
    return () => { chart.remove(); };
  }, [growth]);

  return (
    <div>
      <p className="muted" style={{ marginBottom: "0.4rem" }}>{lab.chartAxis}</p>
      <div className="chart-frame">
        <div ref={ref} role="img" aria-label={`${title}: your rule and buy and hold, both starting at 100, drawn on a log scale. A table with the yearly changes is available below.`} data-testid="growth-chart" />
      </div>
      <p className="legend" aria-hidden="true">
        <span className="key"><svg viewBox="0 0 36 10"><line x1="0" x2="36" y1="5" y2="5" style={{ stroke: "var(--series-rule)" }} strokeWidth="4" /></svg>{lab.lineRule} (solid line)</span>
        <span className="key"><svg viewBox="0 0 36 10"><line x1="0" x2="36" y1="5" y2="5" style={{ stroke: "var(--series-hold)" }} strokeWidth="3" strokeDasharray="6 4" /></svg>{lab.lineHold} (dashed line)</span>
      </p>
      <button type="button" className="btn ghost small" aria-expanded={table} onClick={() => setTable((t) => !t)}>{table ? lab.hideTable : lab.showTable}</button>
      {table && (
        <div className="table-wrap">
          <table aria-label="Yearly change">
            <caption>Change in each calendar year</caption>
            <thead><tr><th>{lab.tableYear}</th><th className="num">{lab.lineRule}</th><th className="num">{lab.lineHold}</th></tr></thead>
            <tbody>{yearly.map((y) => <tr key={y.year}><td>{y.year}</td><td className="num">{pctSigned(y.rule)}</td><td className="num">{pctSigned(y.buy_hold)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

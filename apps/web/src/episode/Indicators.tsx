import { createChart, IChartApi, LineSeries, LineStyle } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import type { Api } from "../api/client";
import { indicators as copy } from "../copy/journal";
import { Button } from "../components/ui";
import { CHART } from "../lib/chartTheme";
import { formatDay, toTime } from "./EpisodeChart";

export type IndicatorName = "sma" | "ema" | "rsi";
export interface Point { day: number; value: number }
export type Series = Partial<Record<IndicatorName, Point[]>>;
const WINDOW: Record<IndicatorName, number> = { sma: 20, ema: 20, rsi: 14 };
const ORDER: IndicatorName[] = ["sma", "ema", "rsi"];

/** Loads each active indicator once per day of the episode. Values only ever cover days already revealed. */
export function useIndicators(api: Api, id: string, day: number, active: Set<IndicatorName>) {
  const [series, setSeries] = useState<Series>({});
  const [error, setError] = useState<string | null>(null);
  const key = [...active].sort().join(",");
  useEffect(() => {
    let alive = true;
    const names = [...active];
    if (names.length === 0) { setSeries({}); return; }
    Promise.all(names.map(async (n) => [n, (await api.indicators(id, n, WINDOW[n])).values as Point[]] as const))
      .then((pairs) => { if (alive) { setSeries(Object.fromEntries(pairs)); setError(null); } })
      .catch((e) => alive && setError((e as Error).message));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, id, day, key]);
  return { series, error };
}

export function IndicatorToggles({ active, onToggle }: { active: Set<IndicatorName>; onToggle: (n: IndicatorName) => void }) {
  return (
    <div role="group" aria-label={copy.title}>
      <div className="row">
        {ORDER.map((n) => (
          <Button key={n} variant={active.has(n) ? "primary" : "secondary"} size="small" aria-pressed={active.has(n)} onClick={() => onToggle(n)}>
            {copy.toggles[n]}
          </Button>
        ))}
      </div>
      {ORDER.filter((n) => active.has(n)).map((n) => <p key={n} className="muted small">{copy.explain[n]}</p>)}
      <p className="muted small">{copy.notForecast}</p>
    </div>
  );
}

/** The RSI panel: its own small chart with lines at 30 and 70, followed by the numbers as a table. */
export function RsiPanel({ points }: { points: Point[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  useEffect(() => {
    if (!ref.current || points.length === 0) return;
    const chart = createChart(ref.current, {
      autoSize: true, height: 140,
      layout: { background: { color: CHART.surface }, textColor: CHART.text, fontFamily: CHART.font },
      grid: { vertLines: { color: CHART.grid }, horzLines: { color: CHART.grid } },
      rightPriceScale: { borderColor: CHART.border },
      localization: { timeFormatter: (t: number) => formatDay(t), priceFormatter: (p: number) => p.toFixed(0) },
      timeScale: { borderColor: CHART.border, tickMarkFormatter: (t: number) => formatDay(t), timeVisible: false },
    });
    chartRef.current = chart;
    const s = chart.addSeries(LineSeries, { color: CHART.rsi, lineWidth: 2 });
    s.setData(points.map((p) => ({ time: toTime(p.day), value: p.value })));
    s.createPriceLine({ price: 70, color: CHART.hold, lineStyle: LineStyle.Dashed, lineWidth: 1, title: "70" });
    s.createPriceLine({ price: 30, color: CHART.hold, lineStyle: LineStyle.Dashed, lineWidth: 1, title: "30" });
    chart.timeScale().fitContent();
    return () => { chart.remove(); chartRef.current = null; };
  }, [points]);
  if (points.length === 0) return <p className="muted">{copy.noValues}</p>;
  return <div className="chart-frame"><div ref={ref} role="img" aria-label={copy.rsiChart} data-testid="rsi-chart" /></div>;
}

/** The numbers behind the lines, as text (the charts are pictures). */
export function IndicatorTable({ series, active }: { series: Series; active: Set<IndicatorName> }) {
  const names = ORDER.filter((n) => active.has(n));
  if (names.length === 0) return null;
  const rows = names.map((n) => ({ n, last: (series[n] ?? []).slice(-10) }));
  return (
    <details>
      <summary>{copy.showNumbers}</summary>
      {rows.map(({ n, last }) => (
        <div className="table-wrap" key={n}>
          <table aria-label={`${copy.toggles[n]}: ${copy.tableCaption}`}>
            <caption>{copy.toggles[n]}: {copy.tableCaption}</caption>
            <thead><tr><th>{copy.day}</th><th>Value</th></tr></thead>
            <tbody>
              {last.length === 0 ? <tr><td colSpan={2}>{copy.noValues}</td></tr> : last.map((p) => <tr key={p.day}><td>{p.day}</td><td>{p.value.toFixed(n === "rsi" ? 0 : 1)}</td></tr>)}
            </tbody>
          </table>
        </div>
      ))}
    </details>
  );
}

import { CandlestickSeries, createChart, HistogramSeries, IChartApi, UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { Bar } from "../api/client";
import { episode as copy } from "../copy/episode";

const DAY = 86400;
/** Lightweight Charts wants timestamps; we number days and show "Day N" only (no calendar dates). */
export const toTime = (day: number): UTCTimestamp => (day * DAY) as UTCTimestamp;
export const formatDay = (time: number): string => `Day ${Math.round(time / DAY)}`;

export const UP = "#14663a";
export const DOWN = "#a12020";

export function EpisodeChart({ bars, showVolume }: { bars: Bar[]; showVolume: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      autoSize: true,
      height: 360,
      layout: { background: { color: "#ffffff" }, textColor: "#1b2330" },
      grid: { vertLines: { color: "#e3e8ef" }, horzLines: { color: "#e3e8ef" } },
      localization: { timeFormatter: (t: number) => formatDay(t), priceFormatter: (p: number) => p.toFixed(1) },
      timeScale: { tickMarkFormatter: (t: number) => formatDay(t), timeVisible: false, secondsVisible: false },
    });
    chartRef.current = chart;
    const candles = chart.addSeries(CandlestickSeries, { upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN });
    candles.setData(bars.map((b) => ({ time: toTime(b.day), open: b.open, high: b.high, low: b.low, close: b.close })));
    if (showVolume) {
      const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", color: "#7f8da3" });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      vol.setData(bars.map((b) => ({ time: toTime(b.day), value: b.rel_volume })));
    }
    chart.timeScale().fitContent();
    return () => { chart.remove(); chartRef.current = null; };
  }, [bars, showVolume]);

  const last = bars.slice(-10);
  return (
    <div>
      <div ref={ref} role="img" aria-label={`${copy.chartTitle}: ${bars.length} days. A table with the last 10 days follows.`} data-testid="chart" />
      <p className="muted" aria-hidden="true">
        <span className="up">▲ {copy.upDay}</span> &nbsp; <span className="down">▼ {copy.downDay}</span> &nbsp; {copy.priceAxis}
      </p>
      <table aria-label={copy.lastDays}>
        <caption>{copy.lastDays}</caption>
        <thead><tr><th>Day</th><th>Open</th><th>Close</th><th>Change</th></tr></thead>
        <tbody>
          {last.map((b) => {
            const up = b.close >= b.open;
            return (
              <tr key={b.day}>
                <td>{b.day}</td><td>{b.open.toFixed(1)}</td><td>{b.close.toFixed(1)}</td>
                <td className={up ? "up" : "down"}>{up ? "▲ up" : "▼ down"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

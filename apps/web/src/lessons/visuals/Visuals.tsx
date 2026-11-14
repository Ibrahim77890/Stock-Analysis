import { ReactNode, useId } from "react";
import { afterCosts, brier, dayChange, expectedMisses, manyPaths, round, rsiFrom, shareUp, sma } from "./math";

/** A figure with a title, a drawing or table, and a sentence about what to look at. Drawings are labelled for screen readers. */
function Figure({ title, look, children }: { title: string; look: string; children: ReactNode }) {
  const id = useId();
  return (
    <figure className="visual" aria-labelledby={id}>
      <figcaption id={id}><strong>{title}</strong></figcaption>
      {children}
      <p className="muted small visual-look">{look}</p>
    </figure>
  );
}

const fill = (v: string) => ({ fill: `var(${v})` });
const stroke = (v: string) => ({ stroke: `var(${v})` });
const Math_ = ({ children }: { children: ReactNode }) => <p className="math" role="math">{children}</p>;
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;

// ------------------------------------------------------------------ lesson 1
export function CandleAnatomy() {
  const open = 100, close = 104;
  const label = (x: number, y: number, text: string, anchor: "start" | "end" = "start") => <text x={x} y={y} textAnchor={anchor} fontSize="13" fontWeight="700" style={fill("--text")}>{text}</text>;
  return (
    <Figure title="One candle, four prices" look="Look at where the open and the close sit. If the close is above the open, the price rose that day.">
      <svg viewBox="0 0 380 230" className="visual-svg" role="img" aria-label="Two candles. The first closes above its open, an up day. The second closes below its open, a down day. Each shows a high, a low, an open and a close.">
        <rect x="1" y="1" width="378" height="228" rx="14" style={{ ...fill("--surface"), ...stroke("--line") }} strokeWidth="2" />
        <line x1="95" x2="95" y1="30" y2="200" style={stroke("--up")} strokeWidth="4" strokeLinecap="round" />
        <rect x="75" y="62" width="40" height="86" rx="5" style={fill("--up")} />
        {label(125, 36, "High")}{label(125, 68, "Close")}{label(125, 154, "Open")}{label(125, 204, "Low")}
        {label(95, 222, "Up day", "end")}
        <line x1="270" x2="270" y1="30" y2="200" style={stroke("--down")} strokeWidth="4" strokeLinecap="round" />
        <rect x="250" y="62" width="40" height="86" rx="5" style={fill("--down")} />
        {label(300, 36, "High")}{label(300, 68, "Open")}{label(300, 154, "Close")}{label(300, 204, "Low")}
        {label(270, 222, "Down day", "end")}
      </svg>
      <Math_>Change = (close − open) ÷ open = ({close} − {open}) ÷ {open} = {pct(dayChange(open, close))}. A positive change is an up day.</Math_>
    </Figure>
  );
}

const ROW: Array<[number, number, number, number]> = [ // open, high, low, close
  [100, 102, 99, 101.5], [101.5, 103, 100.5, 102.5], [102.5, 104, 101.5, 101.8], [101.8, 102.6, 99.8, 100.2], [100.2, 101.4, 99.4, 101],
  [101, 103.4, 100.8, 103], [103, 105, 102.4, 104.5], [104.5, 105.2, 103.2, 103.6], [103.6, 104, 101.8, 102.2], [102.2, 103.8, 101.9, 103.4],
];
function candlesSvg(rows: Array<[number, number, number, number]>, w: number, h: number, top: number) {
  const lo = Math.min(...rows.map((r) => r[2])) - 0.5, hi = Math.max(...rows.map((r) => r[1])) + 0.5;
  const y = (v: number) => top + ((hi - v) / (hi - lo)) * h;
  const step = (w - 20) / rows.length;
  return rows.map((r, i) => {
    const up = r[3] >= r[0], x = 14 + i * step + step / 2, bw = Math.min(22, step * 0.55);
    return (
      <g key={i}>
        <line x1={x} x2={x} y1={y(r[1])} y2={y(r[2])} style={stroke(up ? "--up" : "--down")} strokeWidth="3" strokeLinecap="round" />
        <rect x={x - bw / 2} y={y(Math.max(r[0], r[3]))} width={bw} height={Math.max(3, Math.abs(y(r[0]) - y(r[3])))} rx="3" style={fill(up ? "--up" : "--down")} />
      </g>
    );
  });
}

export function CandleRow() {
  const ups = ROW.filter((r) => r[3] >= r[0]).length;
  return (
    <Figure title="A row of candles is a path" look="Each box is one day. Together they show where the price has been. They do not show where it goes next.">
      <svg viewBox="0 0 380 170" className="visual-svg" role="img" aria-label={`Ten daily candles in a row. ${ups} of the ten closed above their open.`}>
        <rect x="1" y="1" width="378" height="168" rx="14" style={{ ...fill("--surface"), ...stroke("--line") }} strokeWidth="2" />
        {candlesSvg(ROW, 360, 120, 16)}
      </svg>
      <Math_>{ups} up days and {ROW.length - ups} down days in these {ROW.length} candles. The count describes the past only.</Math_>
    </Figure>
  );
}

const VOLUME = [1.0, 0.8, 1.2, 0.9, 2.1, 1.1, 0.7, 1.5];
export function VolumeBars() {
  const rows = ROW.slice(0, VOLUME.length);
  const maxV = Math.max(...VOLUME);
  const step = 340 / VOLUME.length;
  return (
    <Figure title="Busy days and quiet days" look="Find the tallest bar. That day was about twice as busy as usual.">
      <svg viewBox="0 0 380 230" className="visual-svg" role="img" aria-label="Eight candles with a bar under each showing relative volume. The fifth day is the busiest at 2.1 times the usual.">
        <rect x="1" y="1" width="378" height="228" rx="14" style={{ ...fill("--surface"), ...stroke("--line") }} strokeWidth="2" />
        {candlesSvg(rows, 360, 100, 14)}
        {VOLUME.map((v, i) => (
          <g key={i}>
            <rect x={24 + i * step} y={214 - (v / maxV) * 80} width={step * 0.5} height={(v / maxV) * 80} rx="3" style={fill(v === maxV ? "--accent" : "--series-hold")} />
          </g>
        ))}
      </svg>
      <Math_>Relative volume = volume today ÷ usual volume. For example 1.5 million ÷ 1.0 million = {round(1.5 / 1.0, 1)}, so day 8 was one and a half times as busy as usual.</Math_>
    </Figure>
  );
}

// ------------------------------------------------------------------ lesson 2
export function ExpectedMisses() {
  const guesses = 10, chance = 0.7, misses = expectedMisses(guesses, chance);
  return (
    <Figure title="What 70% looks like" look="Count the filled boxes and the empty ones. Even a good 70% guess misses about three times in ten.">
      <svg viewBox="0 0 380 90" className="visual-svg short" role="img" aria-label={`Ten boxes. ${guesses - misses} are filled, for guesses that went up. ${misses} are empty, for guesses that did not.`}>
        {Array.from({ length: guesses }, (_, i) => (
          <rect key={i} x={12 + i * 36} y="14" width="30" height="46" rx="6" style={i < guesses - misses ? { ...fill("--up") } : { ...fill("--surface"), ...stroke("--down") }} strokeWidth="3" />
        ))}
        <text x="12" y="80" fontSize="12" fontWeight="700" style={fill("--muted")}>{guesses - misses} went up</text>
        <text x="368" y="80" textAnchor="end" fontSize="12" fontWeight="700" style={fill("--muted")}>{misses} did not</text>
      </svg>
      <Math_>Expected misses = guesses × (1 − chance) = {guesses} × (1 − {chance.toFixed(2)}) = {misses}</Math_>
    </Figure>
  );
}

// ------------------------------------------------------------------ lesson 3
export function BrierFormula() {
  const rows: Array<[number, 0 | 1, string]> = [[0.7, 1, "70% and it went up"], [0.9, 0, "90% and it fell"], [0.5, 1, "50% and it went up"], [0.5, 0, "50% and it fell"], [1, 1, "100% and it went up"]];
  return (
    <Figure title="How a guess becomes a score" look="Compare the rows. A sure guess that is wrong costs far more than a doubtful one.">
      <Math_>Score = (guess − outcome)². The outcome is 1 if the price went up and 0 if it did not.</Math_>
      <div className="table-wrap">
        <table aria-label="Worked Brier score examples">
          <thead><tr><th>Your guess</th><th>Outcome</th><th>Working</th><th>Score</th></tr></thead>
          <tbody>
            {rows.map(([g, o, text]) => (
              <tr key={text}><td>{text}</td><td>{o}</td><td>({g} − {o})² = {round((g - o) ** 2, 2).toFixed(2)}</td><td><strong>{brier(g, o).toFixed(2)}</strong></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </Figure>
  );
}

export function BrierCurve() {
  const W = 360, H = 190, x = (p: number) => 30 + p * (W - 50), y = (v: number) => 10 + (1 - v) * (H - 40);
  const pts = (f: (p: number) => number) => Array.from({ length: 41 }, (_, i) => `${x(i / 40)},${y(f(i / 40))}`).join(" ");
  const table = [0, 0.25, 0.5, 0.75, 1];
  return (
    <Figure title="The cost of a guess" look="Find the point where both lines meet at 0.25. That is the cost of saying 50% every time.">
      <svg viewBox={`0 0 ${W + 20} ${H + 20}`} className="visual-svg" role="img" aria-label="A graph of the score for guesses from 0 to 1. One curve is for days the price went up and falls to 0 at a guess of 1. The other is for days it did not and rises from 0. They cross at a guess of 0.5 with a score of 0.25.">
        <rect x="1" y="1" width={W + 18} height={H + 18} rx="14" style={{ ...fill("--surface"), ...stroke("--line") }} strokeWidth="2" />
        <line x1={x(0)} x2={x(1)} y1={y(0)} y2={y(0)} style={stroke("--border")} strokeWidth="2" />
        <line x1={x(0)} x2={x(0)} y1={y(0)} y2={y(1)} style={stroke("--border")} strokeWidth="2" />
        <polyline points={pts((p) => (p - 1) ** 2)} fill="none" style={stroke("--up")} strokeWidth="4" strokeLinejoin="round" />
        <polyline points={pts((p) => p ** 2)} fill="none" style={stroke("--down")} strokeWidth="4" strokeLinejoin="round" />
        <circle cx={x(0.5)} cy={y(0.25)} r="7" style={{ ...fill("--accent"), ...stroke("--surface") }} strokeWidth="2" />
        <text x={x(0.5) + 10} y={y(0.25) - 8} fontSize="12" fontWeight="800" style={fill("--accent-strong")}>0.25 coin-flip line</text>
        <text x={x(0)} y={H + 14} fontSize="11" style={fill("--muted")}>guess 0</text>
        <text x={x(1)} y={H + 14} textAnchor="end" fontSize="11" style={fill("--muted")}>guess 1</text>
        <text x={x(0.05)} y={y(0.95)} fontSize="12" fontWeight="700" style={fill("--down")}>it did not go up</text>
        <text x={x(0.52)} y={y(0.95)} fontSize="12" fontWeight="700" style={fill("--up")}>it went up</text>
      </svg>
      <details>
        <summary>Show the numbers</summary>
        <div className="table-wrap"><table aria-label="Score by guess">
          <thead><tr><th>Guess</th><th>Score if it went up</th><th>Score if it did not</th></tr></thead>
          <tbody>{table.map((p) => <tr key={p}><td>{p}</td><td>{brier(p, 1).toFixed(2)}</td><td>{brier(p, 0).toFixed(2)}</td></tr>)}</tbody>
        </table></div>
      </details>
    </Figure>
  );
}

// ------------------------------------------------------------------ lesson 4
const BINS: Array<{ guess: number; made: number; ups: number }> = [{ guess: 60, made: 10, ups: 6 }, { guess: 70, made: 10, ups: 6 }, { guess: 80, made: 10, ups: 5 }, { guess: 90, made: 10, ups: 6 }];
export function CalibrationPlot() {
  const W = 300, x = (g: number) => 40 + ((g - 50) / 50) * W, y = (v: number) => 10 + (1 - (v - 0.5) / 0.5) * 170;
  return (
    <Figure title="Do your numbers match life?" look="Points below the dashed line mean you were too sure. Points on the line mean your numbers matched what happened.">
      <svg viewBox="0 0 380 210" className="visual-svg" role="img" aria-label="A graph of the share of guesses that went up against the size of the guess. A dashed line shows a perfect match. Four example points lie below it, which means too sure.">
        <rect x="1" y="1" width="378" height="208" rx="14" style={{ ...fill("--surface"), ...stroke("--line") }} strokeWidth="2" />
        <line x1={x(50)} x2={x(100)} y1={y(1)} y2={y(0.5)} style={stroke("--series-hold")} strokeWidth="3" strokeDasharray="8 6" />
        <line x1={x(50)} x2={x(100)} y1={y(0.5)} y2={y(0.5)} style={stroke("--border")} strokeWidth="2" />
        <line x1={x(50)} x2={x(50)} y1={y(0.5)} y2={y(1)} style={stroke("--border")} strokeWidth="2" />
        {BINS.map((b) => <circle key={b.guess} cx={x(b.guess)} cy={y(shareUp(b.ups, b.made))} r="8" style={{ ...fill("--down"), ...stroke("--surface") }} strokeWidth="2" />)}
        <text x={x(50) + 4} y="204" fontSize="11" style={fill("--muted")}>guess 50%</text>
        <text x={x(100)} y="204" textAnchor="end" fontSize="11" style={fill("--muted")}>guess 100%</text>
        <text x={x(80)} y={y(0.97)} fontSize="12" fontWeight="700" style={fill("--series-hold")}>perfect match</text>
      </svg>
      <Math_>Share that went up = guesses that went up ÷ guesses made. For the 80% group: {BINS[2].ups} ÷ {BINS[2].made} = {pct(shareUp(BINS[2].ups, BINS[2].made))}, well under 80%.</Math_>
      <div className="table-wrap"><table aria-label="Example groups of guesses">
        <thead><tr><th>You said</th><th>Guesses made</th><th>Went up</th><th>Share</th></tr></thead>
        <tbody>{BINS.map((b) => <tr key={b.guess}><td>{b.guess}%</td><td>{b.made}</td><td>{b.ups}</td><td>{pct(shareUp(b.ups, b.made))}</td></tr>)}</tbody>
      </table></div>
    </Figure>
  );
}

// ------------------------------------------------------------------ lesson 5
export function ManyPathsFigure() {
  const p = manyPaths(3, 12, 200);
  const all = p.lines.flat(), lo = Math.min(...all), hi = Math.max(...all);
  const W = 360, H = 170, x = (d: number) => 14 + (d / 200) * (W - 14), y = (v: number) => 10 + ((hi - v) / (hi - lo)) * H;
  const line = (l: number[]) => l.map((v, d) => `${x(d)},${y(v)}`).join(" ");
  const sign = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
  return (
    <Figure title="Twelve made-up lines, one winner" look="The bold line looks best on the left. Now look at what the same line does on the right, on days it never saw.">
      <svg viewBox="0 0 380 200" className="visual-svg" role="img" aria-label={`Twelve random price lines with no trend. The one that did best on the first half is drawn bold. On the second half it gained ${sign(p.newPct)}.`}>
        <rect x="1" y="1" width="378" height="198" rx="14" style={{ ...fill("--surface"), ...stroke("--line") }} strokeWidth="2" />
        {p.lines.map((l, i) => i !== p.best && <polyline key={i} points={line(l)} fill="none" style={stroke("--series-hold")} strokeWidth="1.5" opacity="0.5" />)}
        <polyline points={line(p.lines[p.best])} fill="none" style={stroke("--accent")} strokeWidth="4" strokeLinejoin="round" />
        <line x1={x(p.split)} x2={x(p.split)} y1="10" y2={H + 10} style={stroke("--down")} strokeWidth="2" strokeDasharray="6 5" />
        <text x={x(p.split / 2)} y="194" textAnchor="middle" fontSize="12" fontWeight="700" style={fill("--muted")}>first part</text>
        <text x={x(p.split * 1.5)} y="194" textAnchor="middle" fontSize="12" fontWeight="700" style={fill("--muted")}>new part</text>
      </svg>
      <Math_>The best of {p.lines.length} lines did {sign(p.firstPct)} on the first part and {sign(p.newPct)} on the new part. Chance alone made these lines. Other seeds look different.</Math_>
    </Figure>
  );
}

// ------------------------------------------------------------------ lesson 6
export function CostDrag() {
  const W = 360, H = 150, x = (n: number) => 20 + (n / 200) * (W - 20), y = (v: number) => 10 + ((100 - v) / 20) * H;
  const curve = (bps: number) => Array.from({ length: 41 }, (_, i) => `${x(i * 5)},${y(afterCosts(bps, i * 5))}`).join(" ");
  return (
    <Figure title="Small costs add up" look="The more often a rule trades, the lower the line falls. The 10 basis point line falls five times as fast.">
      <Math_>Value after n trades = 100 × (1 − cost)ⁿ. 2 basis points is a cost of 0.0002, and 10 basis points is 0.0010. 100 basis points make 1%.</Math_>
      <svg viewBox="0 0 380 190" className="visual-svg" role="img" aria-label="A graph of the value of 100 after up to 200 trades. A line for 2 basis points per trade ends near 96. A line for 10 basis points per trade ends near 82.">
        <rect x="1" y="1" width="378" height="188" rx="14" style={{ ...fill("--surface"), ...stroke("--line") }} strokeWidth="2" />
        <line x1={x(0)} x2={x(200)} y1={y(100)} y2={y(100)} style={stroke("--border")} strokeWidth="2" />
        <polyline points={curve(2)} fill="none" style={stroke("--accent")} strokeWidth="4" strokeLinecap="round" />
        <polyline points={curve(10)} fill="none" style={stroke("--down")} strokeWidth="4" strokeLinecap="round" />
        <text x={x(200)} y={y(afterCosts(2, 200)) - 6} textAnchor="end" fontSize="12" fontWeight="700" style={fill("--accent-strong")}>2 bps</text>
        <text x={x(200)} y={y(afterCosts(10, 200)) - 6} textAnchor="end" fontSize="12" fontWeight="700" style={fill("--down")}>10 bps</text>
        <text x={x(0)} y="184" fontSize="11" style={fill("--muted")}>0 trades</text>
        <text x={x(200)} y="184" textAnchor="end" fontSize="11" style={fill("--muted")}>200 trades</text>
      </svg>
      <div className="table-wrap"><table aria-label="Value of 100 after costs">
        <thead><tr><th>Trades</th><th>At 2 basis points</th><th>At 10 basis points</th></tr></thead>
        <tbody>{[50, 100, 200].map((n) => <tr key={n}><td>{n}</td><td>{afterCosts(2, n).toFixed(2)}</td><td>{afterCosts(10, n).toFixed(2)}</td></tr>)}</tbody>
      </table></div>
    </Figure>
  );
}

// ------------------------------------------------------------------ lesson 7
const CLOSES = [10, 11, 12, 11, 13, 14, 13, 15, 16, 15];
export function SmaDiagram() {
  const avg = sma(CLOSES, 3);
  const W = 340, H = 130, x = (i: number) => 24 + (i / (CLOSES.length - 1)) * W, y = (v: number) => 14 + ((16.5 - v) / 7) * H;
  const d5 = CLOSES.slice(2, 5), mean5 = (d5[0] + d5[1] + d5[2]) / 3;
  return (
    <Figure title="A moving average smooths the path" look="The smooth line follows the price with a delay. It is built from old prices, so it cannot see ahead.">
      <svg viewBox="0 0 380 170" className="visual-svg" role="img" aria-label="Ten closing prices and their 3-day average. The average line is smoother than the price line and lags behind it.">
        <rect x="1" y="1" width="378" height="168" rx="14" style={{ ...fill("--surface"), ...stroke("--line") }} strokeWidth="2" />
        <polyline points={CLOSES.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" style={stroke("--series-hold")} strokeWidth="3" strokeLinejoin="round" />
        <polyline points={avg.map((v, i) => (v === null ? "" : `${x(i)},${y(v)}`)).filter(Boolean).join(" ")} fill="none" style={stroke("--accent")} strokeWidth="4" strokeLinejoin="round" />
        <text x="30" y="160" fontSize="12" fontWeight="700" style={fill("--series-hold")}>closing price</text>
        <text x="150" y="160" fontSize="12" fontWeight="700" style={fill("--accent-strong")}>3-day average</text>
      </svg>
      <Math_>Average of 3 days = (day 1 + day 2 + day 3) ÷ 3. For days 3, 4 and 5: ({d5[0]} + {d5[1]} + {d5[2]}) ÷ 3 = {mean5.toFixed(1)}</Math_>
      <details>
        <summary>Show the numbers</summary>
        <div className="table-wrap"><table aria-label="Closing prices and the 3-day average">
          <thead><tr><th>Day</th><th>Close</th><th>3-day average</th></tr></thead>
          <tbody>{CLOSES.map((c, i) => <tr key={i}><td>{i + 1}</td><td>{c}</td><td>{avg[i] === null ? "no value yet" : (avg[i] as number).toFixed(1)}</td></tr>)}</tbody>
        </table></div>
      </details>
    </Figure>
  );
}

export function RsiFormula() {
  const gain = 1.2, loss = 0.4, rs = round(gain / loss, 6), value = rsiFrom(gain, loss);
  const mark = 20 + (value / 100) * 320;
  return (
    <Figure title="How the RSI is worked out" look="A high number means the last days were mostly rises. It does not mean a fall is due.">
      <Math_>RS = average gain ÷ average loss. RSI = 100 − 100 ÷ (1 + RS). With an average gain of {gain} and an average loss of {loss}: RS = {rs}, so RSI = 100 − 100 ÷ {round(1 + rs, 6)} = {round(value, 0)}.</Math_>
      <svg viewBox="0 0 360 80" className="visual-svg short" role="img" aria-label={`A scale from 0 to 100 with lines at 30 and 70. A marker sits at ${round(value, 0)}.`}>
        <rect x="20" y="30" width="320" height="16" rx="8" style={fill("--surface-2")} />
        <line x1={20 + 0.3 * 320} x2={20 + 0.3 * 320} y1="22" y2="54" style={stroke("--series-hold")} strokeWidth="2" strokeDasharray="4 3" />
        <line x1={20 + 0.7 * 320} x2={20 + 0.7 * 320} y1="22" y2="54" style={stroke("--series-hold")} strokeWidth="2" strokeDasharray="4 3" />
        <circle cx={mark} cy="38" r="10" style={{ ...fill("--accent"), ...stroke("--surface") }} strokeWidth="3" />
        <text x="20" y="72" fontSize="11" style={fill("--muted")}>0</text><text x={20 + 0.3 * 320} y="72" textAnchor="middle" fontSize="11" style={fill("--muted")}>30</text>
        <text x={20 + 0.7 * 320} y="72" textAnchor="middle" fontSize="11" style={fill("--muted")}>70</text><text x="340" y="72" textAnchor="end" fontSize="11" style={fill("--muted")}>100</text>
      </svg>
      <div className="table-wrap"><table aria-label="RSI examples">
        <thead><tr><th>Last days</th><th>Average gain</th><th>Average loss</th><th>RSI</th></tr></thead>
        <tbody>
          <tr><td>All rises</td><td>1.0</td><td>0</td><td>{rsiFrom(1, 0)}</td></tr>
          <tr><td>Rises and falls equal</td><td>0.5</td><td>0.5</td><td>{rsiFrom(0.5, 0.5)}</td></tr>
          <tr><td>Mostly rises</td><td>{gain}</td><td>{loss}</td><td>{round(value, 0)}</td></tr>
        </tbody>
      </table></div>
    </Figure>
  );
}

export const VISUALS: Record<string, () => ReactNode> = {
  "candle-anatomy": () => <CandleAnatomy />, "candle-row": () => <CandleRow />, "volume-bars": () => <VolumeBars />,
  "expected-misses": () => <ExpectedMisses />, "brier-formula": () => <BrierFormula />, "brier-curve": () => <BrierCurve />,
  "calibration-plot": () => <CalibrationPlot />, "many-paths": () => <ManyPathsFigure />, "cost-drag": () => <CostDrag />,
  "sma-diagram": () => <SmaDiagram />, "rsi-formula": () => <RsiFormula />,
};

/** Unknown ids render nothing and a plain note. */
export function Visual({ id }: { id: string }) {
  const make = Object.prototype.hasOwnProperty.call(VISUALS, id) ? VISUALS[id] : undefined;
  if (!make) return <p className="muted" role="note">This picture is not available.</p>;
  return <>{make()}</>;
}

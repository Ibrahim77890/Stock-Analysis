/** The small calculations behind the lesson diagrams. Pure functions, so a test can check every number the page shows. */
import { draws } from "../demos/random";

export const round = (x: number, digits = 2): number => Number(x.toFixed(digits));

/** Candle: change of a day as a share of its open. */
export const dayChange = (open: number, close: number): number => (close - open) / open;

/** Lesson 2: guesses x (1 - chance) of them are expected to miss. */
export const expectedMisses = (guesses: number, chance: number): number => round(guesses * (1 - chance), 6);

/** Lesson 3: (guess - outcome) squared. The outcome is 1 when the price went up and 0 when it did not. */
export const brier = (guess: number, outcome: 0 | 1): number => round((guess - outcome) ** 2, 6);

/** Lesson 4: the share of guesses that went up. */
export const shareUp = (ups: number, guesses: number): number => ups / guesses;

/** Lesson 6: value of 100 after `trades` trades that each cost `costBps` basis points. */
export const afterCosts = (costBps: number, trades: number, start = 100): number => start * Math.pow(1 - costBps / 10000, trades);

/** Lesson 7: mean of the last n closes up to each day (null while there are fewer than n). */
export function sma(values: number[], n: number): Array<number | null> {
  return values.map((_, i) => (i + 1 < n ? null : values.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n));
}

/** Lesson 7: RSI from an average gain and an average loss. 100 with no losses; 50 when nothing moved. */
export function rsiFrom(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Lesson 5: `lines` made-up price paths of `days` days (no trend at all), and the best one on the first part. */
export interface Paths { lines: number[][]; best: number; firstPct: number; newPct: number; split: number }
export function manyPaths(seed = 3, lines = 12, days = 200): Paths {
  const split = Math.floor(days / 2);
  const all = draws(seed, lines * days);
  const out: number[][] = [];
  for (let l = 0; l < lines; l++) {
    const path = [100];
    for (let d = 0; d < days; d++) path.push(path[path.length - 1] * (1 + (all[l * days + d] - 0.5) * 0.04));
    out.push(path);
  }
  let best = 0;
  for (let l = 1; l < lines; l++) if (out[l][split] > out[best][split]) best = l;
  return { lines: out, best, split, firstPct: (out[best][split] / 100 - 1) * 100, newPct: (out[best][days] / out[best][split] - 1) * 100 };
}

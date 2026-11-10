/** A small seeded generator (mulberry32): the same seed always gives the same numbers, so a demo can be repeated and tested. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` numbers in [0, 1) for a seed. */
export function draws(seed: number, n: number): number[] {
  const next = mulberry32(seed);
  return Array.from({ length: n }, () => next());
}

/** Chance70: which of 20 outcomes went up for a chance in percent (1 to 99). */
export function outcomes(seed: number, percent: number, n = 20): boolean[] {
  return draws(seed, n).map((d) => d < percent / 100);
}

export interface Run { length: number; symbol: string; start: number }

/** The longest run of the same symbol in a sequence. An empty sequence gives length 0. */
export function longestRun(seq: readonly string[]): Run {
  let best: Run = { length: 0, symbol: "", start: 0 };
  let i = 0;
  while (i < seq.length) {
    let j = i;
    while (j + 1 < seq.length && seq[j + 1] === seq[i]) j++;
    if (j - i + 1 > best.length) best = { length: j - i + 1, symbol: seq[i], start: i };
    i = j + 1;
  }
  return best;
}

/** CoinStreaks: 100 flips as "H" and "T". */
export function flips(seed: number, n = 100): string[] {
  return draws(seed, n).map((d) => (d < 0.5 ? "H" : "T"));
}

// ---- ManyTries: a made-up price path and 50 random moving-average rules

export const RULES = 50;
const DAYS = 400;
const SPLIT = 200;
export const DEFAULT_MANY_TRIES_SEED = 24;

export interface Rule { fast: number; slow: number }
export interface ManyTries { seed: number; rules: number; best: Rule; firstPct: number; newPct: number; firstIsBetter: boolean }

/** Daily changes of a made-up price: uniform between -2% and +2%, so the path has no trend at all. */
export function dailyChanges(seed: number): number[] {
  return draws(seed, DAYS).map((d) => (d - 0.5) * 0.04);
}

function average(prices: number[], end: number, len: number): number {
  let s = 0;
  for (let i = end - len + 1; i <= end; i++) s += prices[i];
  return s / len;
}

/** Total return of a crossover rule over days [from, to). The rule only looks at prices up to the day before. */
export function ruleReturn(changes: number[], rule: Rule, from: number, to: number): number {
  const prices: number[] = [100];
  for (const c of changes) prices.push(prices[prices.length - 1] * (1 + c));
  let growth = 1;
  for (let day = from; day < to; day++) {
    const t = day; // decide at the close of day t, earn the change of day t + 1 (prices[t + 1] / prices[t] - 1)
    if (t < rule.slow - 1) continue;
    const long = average(prices, t, rule.fast) > average(prices, t, rule.slow);
    if (long) growth *= 1 + changes[t];
  }
  return growth - 1;
}

export function randomRules(seed: number, n = RULES): Rule[] {
  const d = draws(seed + 1000, n * 2);
  return Array.from({ length: n }, (_, i) => ({ fast: 2 + Math.floor(d[2 * i] * 19), slow: 21 + Math.floor(d[2 * i + 1] * 80) }));
}

/** Try 50 random rules on the first 200 days, keep the best, then run the same rule on the next 200 days. */
export function manyTries(seed: number): ManyTries {
  const changes = dailyChanges(seed);
  const rules = randomRules(seed);
  let best = rules[0], bestFirst = -Infinity;
  for (const r of rules) {
    const v = ruleReturn(changes, r, 0, SPLIT);
    if (v > bestFirst) { bestFirst = v; best = r; }
  }
  const newPart = ruleReturn(changes, best, SPLIT, DAYS);
  return { seed, rules: rules.length, best, firstPct: bestFirst * 100, newPct: newPart * 100, firstIsBetter: bestFirst > newPart };
}

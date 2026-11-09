import type { LabRun, VaultResult } from "../api/client";
import { lab } from "../copy/lab";
import { fallText, growthOf100, pctSigned, whole } from "../lib/format";

/** Sentences are built from the numbers by fixed rules: no verdicts, no advice, and always the benchmark beside the rule. */

export function headline(run: Pick<LabRun, "practice_years" | "rule" | "buy_hold">): string {
  const r = whole(growthOf100(run.rule.total_return ?? 0));
  const b = whole(growthOf100(run.buy_hold.total_return ?? 0));
  return `In these ${run.practice_years.toFixed(1)} practice years, 100 in your rule became ${r}. 100 in buy and hold became ${b}.`;
}

/** Says where the rule falls behind buy and hold, and where it stops making money, from the cost table only. */
export function costSentence(costs: LabRun["costs"]): string | null {
  if (!costs.length) return null;
  const level = (c: number) => `${c} basis points`;
  const behind = costs.filter((c) => (c.total_return ?? -Infinity) < (c.buy_hold_total_return ?? Infinity));
  const parts: string[] = [];
  if (behind.length === 0) {
    parts.push("At every cost level shown, the rule finished ahead of buy and hold in this sample.");
  } else if (behind.length === costs.length) {
    parts.push("At every cost level shown, the rule finished behind buy and hold in this sample.");
  } else {
    const firstBehind = behind[0].cost_bps;
    parts.push(`The rule finished ahead of buy and hold at costs below ${level(firstBehind)}, and behind it from ${level(firstBehind)} up.`);
  }
  const lost = costs.find((c) => (c.total_return ?? 0) <= 0);
  if (lost) parts.push(`At ${level(lost.cost_bps)} the rule no longer made money.`);
  return parts.join(" ");
}

export function luckSentence(luck: LabRun["luck"]): string {
  const asGood = luck.fraction_as_good === null ? null : Math.round(luck.fraction_as_good * luck.n_paths);
  if (asGood === null) return "The luck check could not be worked out for this rule.";
  const range = luck.p5 !== null && luck.p95 !== null ? ` Most mixed-up histories ended between ${pctSigned(luck.p5, 0)} and ${pctSigned(luck.p95, 0)}.` : "";
  return `Mixing up the order of the days ${luck.n_paths} times, ${asGood} of ${luck.n_paths} mixed-up histories did as well as your rule or better.${range}`;
}

export type VaultReading = "worse" | "similar" | "better" | "unknown";

/** Compares the Sharpe ratio on practice with the Sharpe ratio on the vault (it does not depend on how long each window is). */
export function vaultReading(v: Pick<VaultResult, "rule" | "practice">): VaultReading {
  const a = v.practice.rule.sharpe, b = v.rule.sharpe;
  if (a === null || b === null || a === undefined || b === undefined) return "unknown";
  if (b < a - 0.3) return "worse";
  if (b > a + 0.3) return "better";
  return "similar";
}

export const readingText = (r: VaultReading): string =>
  r === "worse" ? lab.readingMuchWorse : r === "better" ? lab.readingBetter : r === "similar" ? lab.readingSimilar : lab.readingUnknown;

export const vaultSideBySide = (v: Pick<VaultResult, "rule" | "buy_hold" | "practice">) => [
  { label: lab.rows.perYear.label, practice: [pctSigned(v.practice.rule.cagr), pctSigned(v.practice.buy_hold.cagr)], vault: [pctSigned(v.rule.cagr), pctSigned(v.buy_hold.cagr)] },
  { label: lab.rows.fall.label, practice: [fallText(v.practice.rule.max_drawdown), fallText(v.practice.buy_hold.max_drawdown)], vault: [fallText(v.rule.max_drawdown), fallText(v.buy_hold.max_drawdown)] },
  { label: lab.rows.trades.label, practice: [String(v.practice.rule.trades), String(v.practice.buy_hold.trades)], vault: [String(v.rule.trades), String(v.buy_hold.trades)] },
];

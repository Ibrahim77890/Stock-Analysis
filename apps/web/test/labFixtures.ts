import type { LabRun, StudyOverview, VaultResult } from "../src/api/client";

const metrics = (over: Record<string, number | null> = {}) => ({ total_return: 0.8, cagr: 0.05, max_drawdown: -0.3, exposure: 0.6, trades: 25, sharpe: 0.7, ...over });

export const growth = () => ({
  dates: ["2005-01-03", "2010-06-01", "2015-06-01", "2021-12-29"],
  rule: [100, 140, 190, 180], buy_hold: [100, 150, 240, 250],
});

export const costs = (rule: number[], hold: number[]) =>
  [0, 2, 5, 10, 20].map((c, i) => ({ cost_bps: c, total_return: rule[i], sharpe: 0.6, trades: 25, buy_hold_total_return: hold[i] }));

export function run(over: Partial<LabRun> = {}): LabRun {
  return {
    study_id: 7, symbol: "TESTX", counted: true, trial_count: 1,
    params: { fast: 10, slow: 40, cost_bps: 2, seed: 1, n_paths: 100 }, practice_years: 17, practice_bars: 4278,
    rule: metrics(), buy_hold: metrics({ total_return: 1.5, cagr: 0.07, max_drawdown: -0.5, exposure: 1, trades: 1, sharpe: 0.9 }),
    growth: growth(), yearly: [{ year: 2005, rule: 0.1, buy_hold: 0.2 }, { year: 2006, rule: -0.05, buy_hold: 0.1 }],
    costs: costs([0.9, 0.8, 0.6, 0.3, -0.1], [1.5, 1.5, 1.5, 1.5, 1.5]),
    luck: { method: "block_bootstrap", n_paths: 100, seed: 1, real_total_return: 0.8, percentile_rank: 0.4, fraction_as_good: 0.35, median: 0.7, p5: 0.1, p95: 2, note: "n" },
    warnings: [], config_hash: "abc123",
    ...over,
  } as LabRun;
}

export function overview(over: Partial<StudyOverview> = {}): StudyOverview {
  return {
    study_id: 7, symbol: "TESTX", name: "Lab TESTX", practice_years: 17, practice_bars: 4278, vault_years: 4, vault_bars: 1000,
    vault_open: false, ideas_tried: 1, trials: [{ order: 1, fast: 10, slow: 40, cost_bps: 2, total_return: 0.8, sharpe: 0.7, trades: 25 }], ...over,
  } as StudyOverview;
}

export function vault(over: Partial<VaultResult> = {}): VaultResult {
  return {
    study_id: 7, params: { fast: 10, slow: 40, cost_bps: 2 }, rule: metrics({ total_return: 0.05, cagr: 0.01, sharpe: 0.1, trades: 8 }),
    buy_hold: metrics({ total_return: 0.4, cagr: 0.09, trades: 1, sharpe: 0.6 }),
    growth: { dates: ["2022-01-20", "2023-06-01", "2025-12-31"], rule: [100, 99, 105], buy_hold: [100, 120, 140] },
    yearly: [{ year: 2022, rule: -0.01, buy_hold: 0.05 }], vault_years: 4, vault_bars: 1000,
    practice: { rule: metrics({ sharpe: 0.9 }), buy_hold: metrics({ sharpe: 0.9, trades: 1 }), years: 17 }, ideas_tried: 3, ...over,
  } as VaultResult;
}

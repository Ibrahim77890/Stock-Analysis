import { Spec } from "../common/pick";

/** Every Lab response is REBUILT from these lists. A practice window end, a vault date or a vault number that a faulty
 *  upstream might add is dropped here. Only `VAULT` (used after the vault is opened) may carry vault numbers. */

const METRICS: Spec = { total_return: true, cagr: true, max_drawdown: true, exposure: true, trades: true, sharpe: true };
const GROWTH: Spec = { dates: [true], rule: [true], buy_hold: [true] };
const YEARLY: Spec = [{ year: true, rule: true, buy_hold: true }];

export const STOCKS: Spec = { stocks: [{ symbol: true, name: true, sector: true, first_date: true, bars: true, years: true }] };

export const CREATED: Spec = {
  study_id: true, symbol: true, name: true, practice_bars: true, practice_years: true, vault_bars: true, vault_years: true, vault_open: true,
};

export const CARD: Spec = { study_id: true, symbol: true, name: true, practice_years: true, vault_years: true, vault_open: true, ideas_tried: true };
export const CARDS: Spec = { studies: [CARD] };

export const OVERVIEW: Spec = {
  study_id: true, symbol: true, name: true, practice_years: true, practice_bars: true, vault_years: true, vault_bars: true, vault_open: true,
  ideas_tried: true, trials: [{ order: true, fast: true, slow: true, cost_bps: true, total_return: true, sharpe: true, trades: true }],
};

export const RUN: Spec = {
  study_id: true, symbol: true, counted: true, trial_count: true,
  params: { fast: true, slow: true, cost_bps: true, seed: true, n_paths: true },
  practice_years: true, practice_bars: true, rule: METRICS, buy_hold: METRICS, growth: GROWTH, yearly: YEARLY,
  costs: [{ cost_bps: true, total_return: true, sharpe: true, trades: true, buy_hold_total_return: true }],
  luck: { method: true, n_paths: true, seed: true, real_total_return: true, percentile_rank: true, fraction_as_good: true, median: true, p5: true, p95: true, note: true },
  overfitting_meter: { trials: true, best_sharpe: true, expected_best_sharpe_by_luck: true, dsr: true, note: true },
  warnings: [true], config_hash: true,
};

export const VAULT: Spec = {
  study_id: true, params: { fast: true, slow: true, cost_bps: true }, rule: METRICS, buy_hold: METRICS, growth: GROWTH, yearly: YEARLY,
  vault_years: true, vault_bars: true, practice: { rule: METRICS, buy_hold: METRICS, years: true }, ideas_tried: true,
};

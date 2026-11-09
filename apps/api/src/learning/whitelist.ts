import { pick, Spec } from "../common/pick";

/** Every learner-facing response is REBUILT from these lists. An unexpected upstream field (a symbol, a date, a price level)
 *  is dropped here even if the Python service leaked it. Only `REVEAL` may carry identity. */

const COUNTS: Spec = { resolved: true, void: true, pending: true, total: true };

export const STATE: Spec = { episode_id: true, n_bars: true, initial_visible: true, day: true, status: true, kind_requested: true, kind: true };
export const BARS: Spec = { episode_id: true, bars: [{ day: true, open: true, high: true, low: true, close: true, rel_volume: true }] };
const PREDICTION: Spec = { prediction_id: true, day: true, horizon: true, p_up: true, status: true, outcome: true, created: true };
export const PREDICTION_ONE = PREDICTION;
export const PREDICTIONS: Spec = { episode_id: true, predictions: [PREDICTION], counts: COUNTS };

const LUCK: Spec = { real_brier: true, luck_probability: true, n_perm: true, seed: true, count: true, not_reported: true, shuffled_quantiles: { p5: true, p50: true, p95: true } };
export const SCORE: Spec = {
  episode_id: true, counts: COUNTS, n: true, brier: true, skill_vs_coin_flip: true, log_loss: true,
  bins: [{ bin_low: true, bin_high: true, n: true, mean_forecast: true, observed: true, wilson_low: true, wilson_high: true, sparse: true }],
  murphy: { rel: true, res: true, unc: true, brier: true, exact: true },
  baselines: { coin_flip: true, base_rate: true, base_rate_note: true },
  luck: LUCK, enough: true, min_enough: true, warnings: [true],
};

export const REVEAL: Spec = {
  episode_id: true, kind: true, seed: true, counts: COUNTS, synthetic_volatility: true, statement: true,
  identity: { symbol: true, name: true, asset_type: true, sector: true, first_date: true, last_date: true, source: true },
  data_trail: { provider: true, retrieved_at: true, feed_caveat: true, universe_caveat: true, adjustment: true, stored_adjustment: true, file_hash_matches: true, warnings: [true], licence: true },
};

const KIND: Spec = { n: true, brier: true };
export const PROGRESS: Spec = {
  overall: { n: true, brier: true, skill_vs_coin_flip: true, log_loss: true, enough: true, min_enough: true, warnings: [true],
    baselines: { coin_flip: true, base_rate: true, base_rate_note: true }, luck: LUCK },
  by_kind: { real: KIND, synthetic: KIND },
  by_horizon: { "1": KIND, "5": KIND, "10": KIND },
};

export function clean<T = any>(obj: any, spec: Spec): { value: T; dropped: string[] } {
  return pick<T>(obj, spec);
}

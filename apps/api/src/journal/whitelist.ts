import { Spec } from "../common/pick";

/** Replies are rebuilt from these lists: an unexpected upstream field (a symbol, a date, a kind) is dropped. */
export const INDICATOR: Spec = { episode_id: true, name: true, window: true, day: true, values: [{ day: true, value: true }] };
const DECISION: Spec = { decision_id: true, day: true, stance: true, reason: true, cost_bps: true, days_marked: true, status: true, result: true, created: true };
export const DECISION_ONE = DECISION;
export const JOURNAL: Spec = {
  episode_id: true, day: true, decisions: [DECISION],
  totals: { decisions: true, marked: true, pending: true, growth: true, note: true },
};

/** One place for every number the Lab shows, so signs, rounding and "nothing" are the same on every screen. */
export const dash = "-";

/** 0.8734 -> "+87.3%"; -0.12 -> "-12.0%". `null` shows a dash. */
export function pctSigned(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return dash;
  const v = (x * 100).toFixed(digits);
  return `${x > 0 ? "+" : ""}${v}%`;
}

/** 0.56 -> "56%". */
export function pctPlain(x: number | null | undefined, digits = 0): string {
  return x === null || x === undefined || !Number.isFinite(x) ? dash : `${(x * 100).toFixed(digits)}%`;
}

/** Total return as growth of 100: 0.87 -> 187. */
export const growthOf100 = (totalReturn: number): number => 100 * (1 + totalReturn);

/** 5278.4 -> "5,278"; large values keep thousands separators. */
export const whole = (x: number | null | undefined): string => (x === null || x === undefined || !Number.isFinite(x) ? dash : Math.round(x).toLocaleString("en-US"));

/** Ratios such as the Sharpe ratio: two decimals. */
export const ratio = (x: number | null | undefined): string => (x === null || x === undefined || !Number.isFinite(x) ? dash : x.toFixed(2));

export const years = (x: number): string => `${x.toFixed(1)} years`;

/** Maximum drawdown is stored as a negative fraction; people read it as "a fall of 33%". */
export const fallText = (x: number | null | undefined): string => (x === null || x === undefined || !Number.isFinite(x) ? dash : `${Math.abs(x * 100).toFixed(0)}%`);

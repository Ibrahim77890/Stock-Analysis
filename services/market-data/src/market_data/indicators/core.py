"""Simple moving average, exponential moving average and relative strength index.

All three are CAUSAL: the value at position t is computed from values at positions <= t only, so the value on day t is
the same whether the series ends at t or goes on for years (tested by truncation). Warm-up positions, where the
window is not full yet, are `None`: nothing is filled in with zeros.

Formulas
- sma(values, n):  mean of the last n values; first value at position n (1-based), so n - 1 leading Nones.
- ema(values, n):  seed = the sma of the first n values; then ema_t = alpha * x_t + (1 - alpha) * ema_{t-1}, alpha = 2 / (n + 1).
                   n - 1 leading Nones.
- rsi(values, n):  Wilder's RSI. Changes d_t = x_t - x_{t-1}; the first average gain and loss are the plain means of the first n
                   changes; afterwards avg_t = (avg_{t-1} * (n - 1) + current) / n. RSI = 100 - 100 / (1 + avg_gain / avg_loss);
                   100 when avg_loss is 0 and avg_gain > 0, 50 when both are 0. n leading Nones (positions 1..n).
"""

from __future__ import annotations

from collections.abc import Sequence


def _check(values: Sequence[float], n: int) -> None:
    if n < 2:
        raise ValueError("window must be at least 2")


def sma(values: Sequence[float], n: int) -> list[float | None]:
    _check(values, n)
    out: list[float | None] = [None] * len(values)
    running = 0.0
    for i, x in enumerate(values):
        running += x
        if i >= n:
            running -= values[i - n]
        if i >= n - 1:
            out[i] = running / n
    return out


def ema(values: Sequence[float], n: int) -> list[float | None]:
    _check(values, n)
    out: list[float | None] = [None] * len(values)
    if len(values) < n:
        return out
    alpha = 2.0 / (n + 1)
    prev = sum(values[:n]) / n
    out[n - 1] = prev
    for i in range(n, len(values)):
        prev = alpha * values[i] + (1 - alpha) * prev
        out[i] = prev
    return out


def rsi(values: Sequence[float], n: int = 14) -> list[float | None]:
    _check(values, n)
    out: list[float | None] = [None] * len(values)
    if len(values) <= n:
        return out
    gains = [max(values[i] - values[i - 1], 0.0) for i in range(1, len(values))]
    losses = [max(values[i - 1] - values[i], 0.0) for i in range(1, len(values))]
    avg_g = sum(gains[:n]) / n
    avg_l = sum(losses[:n]) / n

    def value(g: float, l: float) -> float:
        if l == 0:
            return 50.0 if g == 0 else 100.0
        return 100.0 - 100.0 / (1.0 + g / l)

    out[n] = value(avg_g, avg_l)
    for i in range(n, len(gains)):
        avg_g = (avg_g * (n - 1) + gains[i]) / n
        avg_l = (avg_l * (n - 1) + losses[i]) / n
        out[i + 1] = value(avg_g, avg_l)
    return out

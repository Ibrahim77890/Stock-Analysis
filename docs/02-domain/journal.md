# Indicators and the practice journal (Sprint 09)

## Indicators
Shown on the episode screen as toggles under the chart: **20-day average** and **20-day EMA** (lines on the price chart) and **RSI (14 days)** (a small panel with lines at 30 and 70). Each has a sentence that says what it describes and that none of them is a forecast, and a "Show the numbers" table with the last 10 values.

| Indicator | Formula | First value on day |
|---|---|---|
| SMA (n) | mean of the last n closes | n |
| EMA (n) | seed = SMA of the first n closes; then `ema = a*x + (1-a)*previous`, `a = 2/(n+1)` | n |
| RSI (n) | Wilder: first averages are the plain means of the first n changes; then `avg = (avg*(n-1) + current)/n`; `RSI = 100 - 100/(1 + avg_gain/avg_loss)`; 100 when there are no losses, 50 when nothing moved | n + 1 |

Every value uses only days up to its own day (a truncation test checks this for all three). Days before the first value have no value; nothing is filled with zeros. Values are computed on the blind (rebased) closes, so no price level is revealed.

## Practice decisions
A decision is **long** (hold the stock from today's close) or **flat** (hold nothing), with a reason of 1 to 280 characters, written before the result is known. It is stored once at the server's current day and can never be changed or removed (the database refuses UPDATE and DELETE). One decision per day.

**Marking rule.** A stance applies to the change of every later day, up to the days the episode has reached, until the next decision. Long earns `close_t / close_(t-1) - 1`; flat earns 0. When the stance differs from the one before it (flat before the first decision), the cost (default 2 basis points) is charged once at the decision. The result of a decision is `None` ("Waiting for the next day") until one later day exists.

**Journal.** `GET /episodes/{id}/decisions` returns each decision with `days_marked`, `status` (`pending` or `marked`), `result`, and totals (`decisions`, `marked`, `pending`, `growth`). Totals are the product of the per-decision factors. The web page `/journal` shows the reason, the result in words, a count line ("1 decision. That is far too few to say anything.") and, once the episode is revealed, four look-back questions. There is no score, rank, win rate or grade.

## Routes
Three routes in the Python service (and the same three in the gateway): 3 routes. Python: `GET /episodes/{id}/indicators`, `POST /episodes/{id}/decisions`, `GET /episodes/{id}/decisions`.

## Limits
30 decisions a minute per learner (durable limiter, 429 with `Retry-After`); 250 decisions per episode; cost 0 to 50 basis points; indicator window 2 to 200; names `sma`, `ema`, `rsi`.

## What this does not claim
An indicator describes the past. A practice decision is a stance, not advice. A handful of decisions proves nothing, and nobody has measured whether the journal helps people learn.

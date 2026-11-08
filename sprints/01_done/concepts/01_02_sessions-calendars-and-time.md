# Market sessions, trading calendars and time

**Sprint:** 01    **Used by tasks:** 01_02, 01_06, 01_08

## Why this matters for MarketLab
"Missing" data is only a problem if the market was open. Without a trading calendar you cannot separate real gaps (a bug) from weekends and holidays (normal). Wrong timezone handling shifts bars by hours and breaks replay and backtests.

## Plain-language explanation
US exchanges trade Monday-Friday 09:30-16:00 **America/New_York**, except market holidays and some early-close days (13:00). New York shifts between UTC-5 and UTC-4 with daylight saving time, so 09:30 local is 14:30 UTC in winter but 13:30 UTC in summer. The rule is: **store instants in UTC, reason about sessions in exchange-local time, and keep daily bars keyed by trading date**.

Example: 2024-11-29 (day after Thanksgiving) is an early close at 13:00. A daily bar exists for it, but its volume is lower. 2024-11-28 has no bar at all, and that is correct.

## Key terms
- **Trading session**: one day's open-to-close period.
- **Market holiday / early close**: days with no or shortened trading.
- **UTC / IANA timezone**: store UTC; the zone name `America/New_York` carries DST rules.
- **Trading date**: the calendar date of the session in exchange-local time.

## Common mistakes / pitfalls
- Using fixed UTC offsets instead of timezone names.
- Treating every weekday as a trading day.
- Using naive timestamps (no timezone) in the database.
- Forgetting that data providers may mark a halted or unlisted day differently from "holiday".

## What to implement in this domain
- Use the `exchange_calendars` library (calendar `XNYS`) as the source of expected sessions (task 01_08).
- Classify every missing expected session as: *provider gap*, *before first listing*, *after delisting*, or *unknown*.
- Store daily bars with `trade_date DATE` (no timezone) and any future intraday timestamp as `TIMESTAMPTZ` (task 01_06).

## How to check you understood
1. How many expected sessions does XNYS have in 2023? (Count with the library; compare to ~250 and explain the difference from 365.)
2. What UTC time is 09:30 New York on 2024-07-01? (13:30 UTC.) And on 2024-01-02? (14:30 UTC.)

## References
- [NYSE hours and calendars](https://www.nyse.com/markets/hours-calendars): authoritative holidays and early closes.
- [exchange_calendars (GitHub)](https://github.com/gerrymanoim/exchange_calendars): library, README shows `sessions_in_range`, calendars such as `XNYS`.
- [PostgreSQL: date/time types](https://www.postgresql.org/docs/current/datatype-datetime.html): `DATE` vs `TIMESTAMPTZ` semantics.
- [Python `zoneinfo`](https://docs.python.org/3/library/zoneinfo.html) (unverified): timezone database access in the standard library.

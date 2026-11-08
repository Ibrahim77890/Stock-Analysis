# MarketLab

## Product Vision, Domain Learning Plan, Technical Architecture, and Engineering Roadmap

**Document type:** Product and engineering blueprint\
**Project status:** Initial proposal / portfolio flagship\
**Initial market:** US equities and ETFs\
**Primary audience:** Beginners learning how markets and trading work\
**Primary engineering goals:** Data engineering, quantitative analytics,
and backend architecture\
**Product direction:** Educational platform with historical market
replay, paper trading, strategy experimentation, and evidence-based
analytics

------------------------------------------------------------------------

## 1. Executive Summary

MarketLab is an educational financial-market platform that helps users
understand how markets work, learn trading concepts, experiment with
strategies, and evaluate those strategies against historical data.

It is not intended to be a brokerage, a source of personalized
investment advice, or a platform promising profitable strategies. Its
purpose is to teach financial-market concepts through interactive
experiences and measurable experiments.

The core learning loop is:

1.  Learn a concept.
2.  See the concept on historical market data.
3.  Identify examples independently.
4.  Form a testable trading hypothesis.
5.  Backtest the hypothesis using historical data.
6.  Inspect performance, risk, assumptions, and limitations.
7.  Learn why a result may or may not generalize to future markets.

The main differentiator should be the combination of **education +
realistic simulation + reproducible quantitative research + large-scale
market data engineering**.

### Product positioning

> MarketLab --- Learn markets, experiment with strategies, and
> understand trading through data.

### Initial scope decisions

  -----------------------------------------------------------------------
  Decision                            Initial direction
  ----------------------------------- -----------------------------------
  Market                              US stocks and ETFs

  Audience                            Beginners learning trading

  Product                             Educational platform and
                                      engineering portfolio flagship

  Engineering emphasis                Data engineering, quantitative
                                      analytics, backend architecture

  Initial data                        Daily and intraday OHLCV bars

  Advanced data                       Trades, quotes, order-book data,
                                      fundamentals and corporate actions

  Trading mode                        Historical replay and paper
                                      simulation; no live brokerage
                                      execution in MVP
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 2. Product Goals and Non-Goals

### Goals

-   Teach market structure, trading mechanics, technical analysis, and
    risk management.
-   Make lessons interactive rather than purely text-based.
-   Let users replay historical price data without seeing future
    candles.
-   Provide a paper-trading environment for practice.
-   Allow users to define simple strategies and backtest them.
-   Explain performance using risk and statistical metrics, not only
    profit.
-   Ingest, validate, store, and query large historical datasets.
-   Demonstrate production-minded software engineering and measurable
    performance.

### Non-goals for the first release

-   Executing real trades or connecting users to a live brokerage
    account.
-   Providing personalized financial advice or buy/sell recommendations.
-   Claiming that any strategy is profitable based on a small backtest.
-   Building a high-frequency trading system.
-   Supporting every asset class from day one.
-   Building a complex microservices architecture before workload
    requirements justify it.

------------------------------------------------------------------------

## 3. Understanding the Financial-Market Domain

Build a structured knowledge base before implementing advanced trading
features. The educational content should be organized into the following
domains.

### 3.1 Financial markets and instruments

Learn:

-   Primary and secondary markets.
-   Exchanges, brokers, market makers, and other participants.
-   Common stock, preferred stock, ETFs, and indices.
-   Market sessions, pre-market and after-hours trading.
-   Corporate actions: dividends, splits, mergers, and symbol changes.
-   Long positions, short selling, leverage, and margin at a conceptual
    level.

**MarketLab module:** Market Fundamentals Academy.

### 3.2 Trading mechanics and order execution

Learn:

-   Market orders, limit orders, stop orders, and stop-limit orders.
-   Bid, ask, spread, and midpoint.
-   Liquidity, market depth, and trading volume.
-   Order matching and price-time priority.
-   Slippage, partial fills, commissions, and execution latency.
-   Trading halts, market sessions, and auction mechanisms.

**MarketLab module:** OrderBook Explorer and Order Types Simulator.

### 3.3 Technical analysis and price action

Learn:

-   Candlesticks and OHLCV data.
-   Trends, ranges, support, and resistance.
-   Moving averages, RSI, MACD, Bollinger Bands, and VWAP.
-   Breakouts, pullbacks, volatility, and volume analysis.
-   Market structure and multi-timeframe analysis.
-   ICT/Smart Money Concepts as a set of hypotheses and detection rules.

Potential ICT/SMC topics:

-   Liquidity and liquidity sweeps.
-   Fair Value Gaps (FVGs).
-   Order blocks.
-   Displacement.
-   Market Structure Shift (MSS).
-   Break of Structure (BOS).
-   Premium and discount zones.

These concepts can have subjective definitions. MarketLab should make
the exact detection rules visible and configurable rather than
presenting one interpretation as universally correct.

**MarketLab module:** Chart Lab and Concept Visualizer.

### 3.4 Fundamental analysis

Learn:

-   Income statements, balance sheets, and cash-flow statements.
-   Revenue, earnings per share (EPS), margins, and free cash flow.
-   Price-to-earnings (P/E), price-to-sales (P/S), and other valuation
    measures.
-   Earnings announcements and company guidance.
-   Sector comparisons and business fundamentals.
-   Filing dates versus the periods to which financial facts apply.

**MarketLab module:** Company Fundamentals Explorer.

### 3.5 Quantitative analysis

Learn:

-   Descriptive statistics and probability.
-   Returns and log returns.
-   Mean, variance, standard deviation, and volatility.
-   Correlation and covariance.
-   Regression and hypothesis testing.
-   Sampling, overfitting, and out-of-sample evaluation.
-   Backtesting, walk-forward validation, and Monte Carlo analysis.
-   Portfolio construction and risk-adjusted returns.

**MarketLab module:** Quantitative Strategy Lab.

### 3.6 Risk and portfolio management

Learn:

-   Position sizing.
-   Risk per trade and risk/reward.
-   Stop-loss mechanics and gaps.
-   Maximum drawdown.
-   Volatility and exposure.
-   Diversification and correlation.
-   Sharpe ratio and other risk-adjusted measures.
-   Value at Risk (VaR), with clear explanations of its assumptions and
    limitations.

**MarketLab module:** Risk Simulator and Portfolio Analytics.

------------------------------------------------------------------------

## 4. Users and Learning Journeys

### Primary persona: Beginner learner

A new learner needs plain-language explanations, examples, guided
practice, and feedback.

Example journey:

1.  Complete a lesson on candlesticks.
2.  Open a chart showing historical candles.
3.  Identify bullish and bearish candles.
4.  Complete a quiz.
5.  Replay a historical session.
6.  Record a simulated trade.
7.  Review the result and the risk taken.

### Secondary persona: Curious strategy experimenter

A learner who understands basic concepts wants to test ideas.

Example journey:

1.  Select a symbol and date range.
2.  Choose a strategy template.
3.  Configure entry and exit rules.
4.  Run a backtest.
5.  Inspect trades, equity curve, drawdown, and costs.
6.  Compare in-sample and out-of-sample results.

### Future persona: Quantitative researcher

A more advanced user wants reproducible experiments, custom rules,
larger datasets, and detailed metrics. This should be a later-stage
audience rather than the MVP's main design constraint.

------------------------------------------------------------------------

## 5. Product Modules

### 5.1 Trading Academy

Purpose: Teach financial-market concepts in a structured way.

Features:

-   Learning paths and topic prerequisites.
-   Lessons with text, charts, diagrams, and short examples.
-   Interactive quizzes.
-   Glossary of trading terminology.
-   Historical examples linked to chart replay.
-   Progress tracking and concept mastery.
-   Clear distinction between established market mechanics and debated
    trading interpretations.

Example learning path:

1.  What is a stock?
2.  How exchanges and brokers work.
3.  Understanding OHLCV candles.
4.  Market and limit orders.
5.  Bid/ask spread and liquidity.
6.  Basic technical indicators.
7.  Risk management.
8.  Introduction to backtesting.

### 5.2 Market Replay

Purpose: Let learners study historical price action without seeing
future data.

Features:

-   Select a symbol and historical date.
-   Replay candles one at a time or at adjustable speed.
-   Hide all future candles.
-   Draw trendlines and support/resistance.
-   Mark potential entries and exits.
-   Add notes and observations.
-   Pause, resume, rewind, and restart.
-   Save a replay session.
-   Reveal subsequent price action after the learner records a decision.

Important correctness requirement: the replay API must not send future
candles to the browser and merely hide them in the UI. The server should
only return data up to the replay cursor.

### 5.3 Strategy Lab

Purpose: Help users convert trading ideas into explicit, testable rules.

MVP strategy templates:

-   Moving-average crossover.
-   RSI threshold strategy.
-   Bollinger Band mean-reversion example.
-   Simple breakout strategy.

Later templates:

-   VWAP-based rules.
-   Multi-indicator strategies.
-   User-defined conditions.
-   Explicitly specified ICT/SMC pattern rules.

Features:

-   Symbol and date-range selection.
-   Candle timeframe selection.
-   Entry and exit conditions.
-   Position sizing configuration.
-   Commission and slippage assumptions.
-   Backtest execution.
-   Trade-by-trade results.
-   Equity curve and drawdown chart.
-   Strategy comparison.
-   Experiment configuration and result versioning.

### 5.4 Risk Simulator

Purpose: Teach how risk affects trading outcomes.

Features:

-   Position-size calculator.
-   Risk-per-trade controls.
-   Stop-loss and target scenarios.
-   Risk/reward visualization.
-   Consecutive-loss simulations.
-   Drawdown scenarios.
-   Volatility and exposure analysis.
-   Portfolio diversification examples.

The simulator should explain that a stop order does not guarantee
execution at the stop price, particularly in fast or gapping markets.

### 5.5 Data Explorer

Purpose: Expose the data behind the application and demonstrate data
engineering.

Features:

-   Browse symbols and trading sessions.
-   Inspect OHLCV bars.
-   View data coverage and gaps.
-   Compare timeframes.
-   Inspect corporate-action adjustments.
-   Explore fundamentals and filing dates.
-   View ingestion status and data-quality reports.
-   Run approved analytical queries.

### 5.6 OrderBook Explorer --- later module

Purpose: Teach how orders interact and how exchanges form prices.

Features:

-   Simulated limit order book.
-   Bid and ask levels.
-   Market depth visualization.
-   Order submission and cancellation.
-   Price-time-priority matching.
-   Partial fills.
-   Spread and liquidity experiments.
-   Slippage scenarios.

Start with a simulated order book. Real order-book data is more
expensive and can carry additional licensing restrictions.

### 5.7 Portfolio Analytics --- later module

Purpose: Explain portfolio-level risk and performance.

Features:

-   Virtual portfolio creation.
-   Asset allocation.
-   Historical portfolio returns.
-   Correlation matrix.
-   Volatility and drawdown.
-   Sector and concentration exposure.
-   Risk-adjusted metrics.
-   Benchmark comparisons.

------------------------------------------------------------------------

## 6. Data Strategy

A data-heavy application should be designed around the characteristics
and meaning of each dataset.

### 6.1 Main dataset categories

  -----------------------------------------------------------------------
  Dataset                 Typical fields          Initial priority
  ----------------------- ----------------------- -----------------------
  Daily OHLCV             Symbol, date, open,     Very high
                          high, low, close,       
                          volume                  

  Intraday OHLCV          Symbol, timestamp,      Very high
                          OHLCV, timeframe        

  Trades                  Timestamp, price, size, Later
                          exchange/conditions     

  Quotes                  Bid, ask, sizes,        Later
                          timestamp               

  Order book              Price levels,           Advanced
                          quantities, side,       
                          timestamp               

  Fundamentals            Revenue, earnings,      Medium
                          assets, liabilities     

  Corporate actions       Splits, dividends,      High
                          symbol changes          

  News and events         Publication time,       Later
                          source, event type      

  Options chains          Expiry, strike,         Out of initial scope
                          bid/ask, implied        
                          volatility, Greeks      
  -----------------------------------------------------------------------

### 6.2 Recommended initial scope

Start with:

-   A manageable universe of US-listed equities and ETFs.
-   Daily bars covering several years.
-   Intraday bars for a smaller set of symbols.
-   Corporate-action information needed to interpret historical prices.
-   A small set of company fundamentals from public filings.

Do not begin with billions of tick records. First build a correct
ingestion and query pipeline for a smaller dataset, then scale it with a
benchmark.

### 6.3 Data providers and research sources

**SEC EDGAR**

-   Company filings and disclosures.
-   Company submissions data.
-   XBRL company facts.
-   Useful for fundamental analysis.

Documentation: https://www.sec.gov/edgar/sec-api-documentation

**Alpaca Market Data**

-   Historical bars, trades, and quotes depending on feed and
    subscription.
-   Useful developer APIs.
-   Check feed coverage and plan limitations.

Documentation: https://docs.alpaca.markets/

**Massive (formerly Polygon.io)**

-   Historical aggregates, trades, quotes, options, and reference data
    depending on product and subscription.

Documentation: https://massive.com/docs

**Nasdaq Data Link**

-   Financial and economic datasets, subject to dataset-specific
    availability and licensing.

Website: https://data.nasdaq.com/

**Kaggle**

-   Convenient for learning with downloadable historical datasets.
-   Verify source, dates, completeness, survivorship bias, and
    redistribution rights.

Website: https://www.kaggle.com/datasets

### 6.4 Data licensing and compliance

Free API access does not automatically grant permission to redistribute
data. Before using a provider, verify:

-   Whether historical data can be stored.
-   Whether data can be displayed to multiple users.
-   Whether derived data can be redistributed.
-   Whether attribution is required.
-   Whether real-time data requires exchange agreements.
-   Rate limits and retention rules.
-   Whether the provider's terms permit commercial use.

For a public portfolio demo, use appropriately licensed datasets and
clearly document provenance.

------------------------------------------------------------------------

## 7. Proposed System Architecture

Use a modular architecture first. Introduce distributed infrastructure
when measurable workload requirements justify it.

### 7.1 High-level data flow

``` text
Market Data Providers
        |
        v
Ingestion Workers
        |
        v
Raw Data Storage (Parquet / Object Storage)
        |
        v
Validation and Normalization
        |
        +----------------------+
        |                      |
        v                      v
Analytical Storage       Application Database
(ClickHouse)             (PostgreSQL)
        |                      |
        v                      v
Analytics / Backtesting  NestJS Application API
        |                      |
        +-----------+----------+
                    |
                    v
              Next.js UI
```

### 7.2 Streaming architecture --- later stage

``` text
Provider WebSocket / Feed
          |
          v
    Ingestion Service
          |
          v
        Kafka
          |
          v
    Apache Flink
          |
          +------> Real-time aggregates
          |
          +------> Data quality checks
          |
          +------> ClickHouse / Object Storage
```

Kafka and Flink should be added when the application needs replayable
event streams, stateful stream processing, high-volume aggregation, or
multiple independent consumers. They are not prerequisites for the first
working version.

### 7.3 Suggested technology stack

  -----------------------------------------------------------------------
  Layer                   Technology              Responsibility
  ----------------------- ----------------------- -----------------------
  Frontend                Next.js + TypeScript    Education, charts,
                                                  replay, dashboards

  Application backend     NestJS                  Auth, courses, users,
                                                  portfolios, APIs

  Analytics service       Python                  Indicators, statistics,
                                                  backtesting

  Data processing         Polars + NumPy          Efficient batch
                                                  processing and
                                                  numerical work

  Transactional database  PostgreSQL              Users, lessons,
                                                  progress, strategy
                                                  definitions

  OLAP database           ClickHouse              Large-scale time-series
                                                  analytics

  File format             Parquet                 Columnar historical
                                                  data

  Object storage          MinIO locally;          Raw and curated
                          compatible object       datasets
                          storage later           

  Cache                   Redis                   Frequently accessed
                                                  results and transient
                                                  state

  Streaming               Kafka                   Event transport

  Stream processing       Apache Flink            Stateful streaming and
                                                  windowed aggregates

  Observability           Prometheus + Grafana    Metrics and operational
                                                  dashboards

  Containerization        Docker                  Reproducible local and
                                                  deployment environments

  Orchestration           Kubernetes, when        Workload orchestration
                          justified               
  -----------------------------------------------------------------------

### 7.4 Database responsibilities

**PostgreSQL**

Use for:

-   Users and authentication.
-   Lessons, modules, quizzes, and progress.
-   Strategy definitions and experiment metadata.
-   Paper portfolios and simulated orders.
-   Saved replay sessions.
-   Permissions and application configuration.

**ClickHouse**

Use for:

-   Large OHLCV histories.
-   Aggregated trade and quote analytics.
-   Time-series analytical queries.
-   Symbol and timeframe comparisons.
-   Backtest input scans and reporting datasets.

**Object storage and Parquet**

Use for:

-   Immutable raw provider files.
-   Historical bulk datasets.
-   Curated analytical data.
-   Reproducible backtest input snapshots.

**Redis**

Use for:

-   Cacheable symbol metadata.
-   Short-lived session state.
-   Rate limiting.
-   Frequently requested dashboard results.

Do not treat Redis as the source of truth for financial records.

------------------------------------------------------------------------

## 8. Data Engineering Design

### 8.1 Ingestion workflow

A robust ingestion workflow should:

1.  Fetch data from a provider.
2.  Record provider, dataset, symbol, time range, and retrieval time.
3.  Store the raw response or source file.
4.  Parse and normalize records.
5.  Validate timestamps, prices, quantities, and symbol mappings.
6.  Detect duplicates and missing intervals.
7.  Apply corporate-action handling where appropriate.
8.  Write curated data to analytical storage.
9.  Record ingestion status and data-quality results.

### 8.2 Idempotency

Repeated ingestion of the same source range must not create duplicate
records.

Define a stable logical key, for example:

-   Provider.
-   Symbol.
-   Timestamp.
-   Timeframe.
-   Dataset type.

The exact key depends on whether the record is a bar, trade, quote, or
another event.

### 8.3 Event-time and ordering

Market events can arrive late or out of order. Keep separate concepts
for:

-   Event timestamp: when the market event occurred.
-   Ingestion timestamp: when your system received it.
-   Processing timestamp: when your system processed it.

For streaming aggregation, define a late-event policy and whether
previously emitted aggregates can be corrected.

### 8.4 Timezones and market calendars

-   Store event timestamps in UTC.
-   Preserve the source timezone and exchange context where necessary.
-   Model exchange trading sessions and holidays.
-   Account for daylight-saving changes.
-   Distinguish regular hours from pre-market and after-hours.
-   Do not assume that every calendar day is a trading day.

### 8.5 Corporate actions and adjusted prices

Historical prices may be raw, split-adjusted, or adjusted for dividends.
Store the adjustment methodology and source.

Avoid silently mixing adjusted and unadjusted prices. A backtest can be
materially misleading if corporate actions are handled inconsistently.

### 8.6 Data-quality checks

Examples:

-   High must be greater than or equal to open and close.
-   Low must be less than or equal to open and close.
-   Volume must not be negative.
-   Timestamps must follow the dataset's expected granularity.
-   Duplicate logical keys must be detected.
-   Missing intervals should be classified, not automatically treated as
    errors.
-   Outliers should be flagged for investigation rather than blindly
    deleted.

------------------------------------------------------------------------

## 9. Quantitative Analytics and Backtesting

A backtest is a simulation of how a strategy would have behaved under
specified historical conditions. It is not proof of future
profitability.

### 9.1 Initial strategy: moving-average crossover

Example rules:

-   Calculate a 20-period simple moving average.
-   Calculate a 50-period simple moving average.
-   Generate a long entry signal when the shorter average crosses above
    the longer average.
-   Generate an exit signal when the shorter average crosses below the
    longer average.

The signal must only use information available at the time. Define
whether execution occurs at the next bar's open or under another
realistic execution model.

### 9.2 Additional educational strategies

-   RSI threshold example.
-   Bollinger Band mean-reversion example.
-   Price breakout example.
-   VWAP-based example.
-   Multi-indicator strategy.
-   Explicitly rule-based ICT/SMC patterns.

### 9.3 Metrics

  -----------------------------------------------------------------------
  Metric                              What it explains
  ----------------------------------- -----------------------------------
  Total return                        Overall simulated gain or loss

  Annualized return                   Return expressed on an annualized
                                      basis

  Win rate                            Percentage of closed trades that
                                      are profitable

  Profit factor                       Gross profits divided by gross
                                      losses

  Maximum drawdown                    Largest peak-to-trough decline

  Sharpe ratio                        Return relative to total
                                      volatility, under stated
                                      assumptions

  Sortino ratio                       Return relative to downside
                                      deviation

  Average trade                       Average result per trade

  Exposure                            Fraction of time or capital exposed
                                      to the market

  Turnover                            How frequently capital is traded
  -----------------------------------------------------------------------

Every metric should include its calculation convention and relevant
assumptions.

### 9.4 Backtesting pitfalls to prevent

**Look-ahead bias:** Using information that would not have been
available at the decision time.

**Survivorship bias:** Testing only companies that exist today and
ignoring delisted or failed companies.

**Overfitting:** Tuning parameters until a strategy fits historical
noise.

**Data snooping:** Repeatedly testing variations and reporting only the
best result.

**Transaction-cost omission:** Ignoring commissions, spread, slippage,
and market impact.

**Corporate-action errors:** Misinterpreting splits, dividends, or
symbol changes.

**Execution assumptions:** Assuming every order fills at a convenient
candle price.

### 9.5 Validation approach

-   Separate training/in-sample and testing/out-of-sample periods.
-   Use walk-forward validation.
-   Keep a record of every experiment and parameter set.
-   Include transaction costs and realistic fill assumptions.
-   Compare against a suitable benchmark.
-   Test across different market regimes.
-   Report uncertainty and limitations.

### 9.6 Build versus reuse

Study established frameworks before implementing everything yourself:

-   VectorBT: https://vectorbt.dev/
-   Backtrader: https://www.backtrader.com/docu/

Build a small educational backtesting engine to understand the
internals. Compare its output with a recognized framework and document
differences.

------------------------------------------------------------------------

## 10. Paper Trading and Simulation

The MVP should use simulated trading, not live brokerage execution.

Core entities:

-   Virtual account.
-   Cash balance.
-   Position.
-   Simulated order.
-   Fill.
-   Transaction cost.
-   Portfolio snapshot.
-   Trading session.

A paper-trading engine should model:

-   Order types.
-   Order validation.
-   Available cash and position constraints.
-   Partial fills where supported by the simulation.
-   Commissions and slippage assumptions.
-   Realized and unrealized P&L.
-   Market-session rules.

Clearly label simulated fills. Historical candle data does not reveal
the exact sequence of intrabar prices or guarantee that a real order
would have filled.

------------------------------------------------------------------------

## 11. Suggested Application Domain Model

A starting conceptual model:

``` text
User
 ├── LearningProgress
 ├── QuizAttempt
 ├── ReplaySession
 ├── Strategy
 │    └── StrategyVersion
 │          └── BacktestRun
 │                ├── BacktestTrade
 │                └── PerformanceMetric
 └── PaperAccount
      ├── SimulatedOrder
      ├── SimulatedFill
      └── PortfolioSnapshot

MarketData
 ├── Instrument
 ├── TradingSession
 ├── OHLCVBar
 ├── CorporateAction
 └── FundamentalFact

Ingestion
 ├── DataProvider
 ├── IngestionJob
 ├── DatasetManifest
 └── DataQualityReport
```

Keep large market facts separate from transactional application
entities. Avoid putting every historical candle into the same
transactional schema used for users and course progress.

------------------------------------------------------------------------

## 12. API Design Sketch

Example application endpoints:

### Academy

``` http
GET    /api/v1/academy/paths
GET    /api/v1/academy/lessons/:lessonId
POST   /api/v1/academy/lessons/:lessonId/progress
POST   /api/v1/academy/quizzes/:quizId/attempts
```

### Market data

``` http
GET    /api/v1/instruments
GET    /api/v1/instruments/:symbol
GET    /api/v1/market/bars
GET    /api/v1/market/sessions
GET    /api/v1/market/data-quality
```

### Replay

``` http
POST   /api/v1/replay/sessions
GET    /api/v1/replay/sessions/:sessionId
POST   /api/v1/replay/sessions/:sessionId/advance
POST   /api/v1/replay/sessions/:sessionId/decision
```

The replay service must enforce the visible historical cursor
server-side.

### Strategy and backtesting

``` http
POST   /api/v1/strategies
GET    /api/v1/strategies/:strategyId
POST   /api/v1/strategies/:strategyId/versions
POST   /api/v1/backtests
GET    /api/v1/backtests/:runId
GET    /api/v1/backtests/:runId/trades
GET    /api/v1/backtests/:runId/metrics
```

Long-running backtests should be asynchronous jobs. The API can return a
job identifier and expose status/results endpoints.

### Paper trading

``` http
POST   /api/v1/paper/accounts
GET    /api/v1/paper/accounts/:accountId
POST   /api/v1/paper/accounts/:accountId/orders
GET    /api/v1/paper/accounts/:accountId/positions
GET    /api/v1/paper/accounts/:accountId/history
```

These are design sketches, not a finalized API contract.

------------------------------------------------------------------------

## 13. Performance and Scale Engineering

The project should include measurable experiments rather than
unsupported claims.

### Suggested benchmark project

Proposed experiment:

-   Dataset: 100 million historical trade records.
-   Query: Calculate hourly VWAP for 500 symbols.
-   Compare PostgreSQL and ClickHouse.
-   Measure ingestion throughput, query latency, storage size, CPU, and
    memory.

This is a target experiment, not a guaranteed benchmark result. Actual
results depend on hardware, schema, indexes/order keys, compression,
query design, and data distribution.

### Additional experiments

1.  Compare Parquet scan performance with database scans.
2.  Compare row-oriented and column-oriented query patterns.
3.  Benchmark daily-bar aggregation from finer-grained data.
4.  Measure cold-cache versus warm-cache latency.
5.  Test concurrent analytical queries.
6.  Measure ingestion lag and recovery after a worker restart.
7.  Test duplicate and out-of-order event handling.
8.  Measure replay latency at different dataset sizes.

### Operational metrics

-   Records ingested per second.
-   Ingestion lag.
-   Failed and retried jobs.
-   Duplicate rate.
-   Data-quality failure rate.
-   Query p50, p95, and p99 latency.
-   Backtest execution duration.
-   Queue depth and consumer lag.
-   CPU, memory, and storage utilization.

------------------------------------------------------------------------

## 14. Observability and Reliability

Use Prometheus and Grafana to expose:

-   Ingestion throughput.
-   Provider/API error rate.
-   Worker health.
-   Kafka consumer lag, if Kafka is introduced.
-   Flink checkpoint and processing metrics, if Flink is introduced.
-   Database query latency.
-   Cache hit ratio.
-   Backtest job duration and failure rate.

Reliability practices:

-   Retry transient provider errors with bounded backoff.
-   Make ingestion idempotent.
-   Persist job state.
-   Support resuming failed ingestion ranges.
-   Keep raw source data for audit and reprocessing where licensing
    permits.
-   Version transformation logic.
-   Record dataset manifests for reproducibility.
-   Alert on stale or incomplete data.

------------------------------------------------------------------------

## 15. Security, Privacy, and Responsible Product Design

-   Use standard authentication and authorization practices.
-   Protect API credentials and provider secrets.
-   Apply rate limits to expensive analytics endpoints.
-   Validate uploaded strategy definitions and data inputs.
-   Isolate resource-intensive backtests.
-   Keep audit trails for important user actions.
-   Avoid exposing one user's private portfolio or notes to another.
-   Clearly label historical, delayed, simulated, and real-time data.
-   Do not imply that educational examples are investment
    recommendations.
-   Do not promise profitability or financial outcomes.
-   Review data-provider and exchange licensing before public
    deployment.

------------------------------------------------------------------------

## 16. Development Roadmap

### Phase 1 --- Domain foundations

**Objective:** Understand the market before encoding assumptions into
software.

Study:

-   Financial markets and instruments.
-   Trading mechanics and order types.
-   Candlesticks and OHLCV.
-   Technical indicators.
-   Risk management.
-   Fundamental analysis basics.
-   Statistics and probability.
-   Introductory quantitative finance.

Deliverables:

-   Domain glossary.
-   Learning-path outline.
-   Sample annotated charts.
-   Written definitions for initial strategy rules.
-   Data dictionary for the initial market datasets.

### Phase 2 --- Data engineering foundation

**Objective:** Build a reliable historical market-data pipeline.

Implement:

-   Provider integration.
-   Historical bulk ingestion.
-   Raw Parquet storage.
-   Normalization and validation.
-   PostgreSQL application database.
-   ClickHouse analytical store.
-   Dataset manifests.
-   Data-quality reports.

Deliverable: MarketStream, a reusable ingestion and analytics pipeline.

### Phase 3 --- Quantitative analytics

**Objective:** Build reproducible calculations and strategy experiments.

Implement:

-   Returns and indicator calculations.
-   Moving-average crossover strategy.
-   Basic backtesting engine.
-   Transaction costs and slippage assumptions.
-   Trade-level results.
-   Performance metrics.
-   Out-of-sample validation.
-   Experiment versioning.

Deliverable: QuantResearch, a reproducible strategy research module.

### Phase 4 --- MarketLab MVP

**Objective:** Deliver a usable educational product.

Build:

-   Trading Academy.
-   Instrument explorer.
-   Historical charting.
-   Market Replay.
-   Paper-trading simulation.
-   Strategy Lab with a few templates.
-   Basic risk analytics.
-   User progress tracking.

Deliverable: A working end-to-end educational platform.

### Phase 5 --- Advanced engineering

**Objective:** Demonstrate scale and distributed systems competence.

Potential additions:

-   Kafka event ingestion.
-   Flink streaming aggregation.
-   Real-time market dashboards.
-   Large-scale ClickHouse benchmarks.
-   More efficient historical replay.
-   Distributed backtest workers.
-   Kubernetes deployment.
-   Prometheus and Grafana monitoring.

Deliverable: A measured, observable data platform with documented
scaling experiments.

### Phase 6 --- Advanced product modules

Potential additions:

-   ICT/SMC concept visualizer.
-   Fundamental analysis explorer.
-   OrderBook Explorer.
-   Portfolio analytics.
-   More advanced strategy research.
-   News and event analysis, subject to data availability and licensing.

------------------------------------------------------------------------

## 17. Recommended Repository Structure

> **Note:** The structure below is purely illustrative. It is *not* a
> baseline and nothing in this document or in the sprint tooling should
> assume these folder names. The project owner decides the layout and
> the order in which pieces are created. See Section 24 for the
> simplified stack currently in effect.

A monorepo can keep the application coordinated while separating
responsibilities.

``` text
marketlab/
├── apps/
│   ├── web/                     # Next.js frontend
│   └── api/                     # NestJS application backend
│
├── services/
│   ├── analytics/               # Python analytics API
│   ├── ingestion/               # Historical data ingestion workers
│   ├── backtesting/             # Backtesting engine
│   └── stream-processing/       # Future Kafka/Flink integration
│
├── packages/
│   ├── contracts/               # Shared API schemas/contracts
│   ├── strategy-spec/           # Strategy definition schema
│   └── ui/                      # Shared UI components
│
├── data/
│   ├── samples/                 # Small, licensed sample datasets
│   └── manifests/               # Dataset metadata; not necessarily raw data
│
├── infrastructure/
│   ├── docker/
│   ├── postgres/
│   ├── clickhouse/
│   ├── minio/
│   ├── kafka/
│   └── monitoring/
│
├── docs/
│   ├── domain/
│   ├── architecture/
│   ├── data-dictionary/
│   ├── adr/
│   └── benchmarks/
│
├── scripts/
├── docker-compose.yml
└── README.md
```

Do not commit large licensed datasets, API keys, or secrets. Keep small
reproducible sample datasets and instructions for obtaining permitted
data.

------------------------------------------------------------------------

## 18. Portfolio Presentation

The project should be presented as a financial data engineering and
educational analytics platform, not merely a stock dashboard.

### Flagship project

**MarketLab**\
Interactive financial education and trading simulation platform.

Suggested technologies:

-   Next.js
-   NestJS
-   Python
-   PostgreSQL
-   ClickHouse
-   Parquet

### Supporting engineering deliverables

**MarketStream**\
Historical market-data ingestion, validation, normalization, and
analytical storage.

**QuantResearch**\
Reproducible strategy backtesting and quantitative performance
analytics.

**OrderBook Explorer**\
A simulated exchange order book and matching engine.

**DataBench**\
A benchmark suite comparing PostgreSQL, ClickHouse, and Parquet
analytical workloads.

### What to show in a portfolio or technical interview

-   Architecture diagram.
-   Data ingestion workflow.
-   Data model and data dictionary.
-   Example strategy with explicit rules.
-   Backtest methodology and limitations.
-   Query plans and benchmark methodology.
-   Throughput and latency measurements.
-   Monitoring dashboard.
-   Failure-recovery demonstration.
-   Short product demo.
-   Technical decisions and trade-offs documented as ADRs.

Avoid claiming that the application processes a certain number of
records or achieves a certain latency until you have measured it and
documented the test environment.

------------------------------------------------------------------------

## 19. Learning Resources

### Financial markets and investing

-   Investor.gov: https://www.investor.gov/introduction-investing
-   Investopedia: https://www.investopedia.com/
-   FINRA Investors: https://www.finra.org/investors
-   CME Group Education: https://www.cmegroup.com/education.html

### Market data

-   SEC EDGAR API: https://www.sec.gov/edgar/sec-api-documentation
-   Alpaca documentation: https://docs.alpaca.markets/
-   Massive documentation: https://massive.com/docs
-   Nasdaq Data Link: https://data.nasdaq.com/
-   Kaggle datasets: https://www.kaggle.com/datasets

### Quantitative research and backtesting

-   VectorBT: https://vectorbt.dev/
-   Backtrader: https://www.backtrader.com/docu/

### Engineering

-   ClickHouse documentation: https://clickhouse.com/docs
-   Apache Kafka documentation: https://kafka.apache.org/documentation/
-   Apache Flink documentation: https://flink.apache.org/
-   Polars documentation: https://docs.pola.rs/
-   PostgreSQL documentation: https://www.postgresql.org/docs/

------------------------------------------------------------------------

## 20. First 30 Days: Concrete Starting Plan

The first month should focus on domain correctness and a small working
data pipeline. Do not start by deploying Kafka, Flink, and Kubernetes.

### Week 1 --- Learn and define

-   Study stocks, ETFs, exchanges, brokers, and order types.
-   Understand OHLCV candles and market sessions.
-   Learn bid/ask, spread, volume, and liquidity.
-   Create the initial MarketLab glossary.
-   Select a small US-equity symbol universe.
-   Document data-provider licensing and API limits.

**Output:** Domain notes, initial product scope, and data dictionary.

### Week 2 --- Obtain and inspect data

-   Obtain a permitted historical dataset.
-   Load daily OHLCV data.
-   Inspect missing dates, duplicate records, and invalid values.
-   Learn Parquet and Polars.
-   Design instrument and bar schemas.
-   Store raw and normalized versions separately.

**Output:** A repeatable historical-data ingestion script.

### Week 3 --- Build analytical storage

-   Set up PostgreSQL.
-   Set up ClickHouse.
-   Load normalized historical bars into ClickHouse.
-   Implement symbol/date-range queries.
-   Compare selected query patterns.
-   Record dataset size and query latency.

**Output:** A working market-data explorer API and initial benchmark
report.

### Week 4 --- Build the first educational feature

-   Build a candlestick chart.
-   Add a simple moving-average overlay.
-   Explain the indicator in an educational lesson.
-   Add historical chart navigation.
-   Implement a basic candle-by-candle replay.
-   Ensure the server never reveals future candles.

**Output:** The first end-to-end MarketLab prototype.

------------------------------------------------------------------------

## 21. Initial MVP Acceptance Criteria

The MVP is ready for a portfolio demonstration when a user can:

1.  Register and access the learning area.
2.  Complete a basic market-fundamentals lesson.
3.  Search a supported US equity or ETF.
4.  View historical OHLCV candles.
5.  Inspect a basic technical indicator.
6.  Replay a historical period without future-data leakage.
7.  Record a simulated trading decision.
8.  Run at least one reproducible strategy backtest.
9.  See trade-level results and risk metrics.
10. Inspect the source, coverage, and quality status of the dataset.

The engineering demonstration should additionally show:

-   Repeatable ingestion.
-   Duplicate handling.
-   Data-quality validation.
-   Reproducible backtest configurations.
-   Basic observability.
-   A documented database benchmark.

------------------------------------------------------------------------

## 22. Final Recommendation

Build MarketLab incrementally, with domain correctness as the
foundation.

The recommended order is:

1.  **Learn the financial domain:** understand what the data represents
    before designing the schema.
2.  **Build the data foundation:** historical OHLCV, Parquet, Polars,
    PostgreSQL, and ClickHouse.
3.  **Build quantitative capabilities:** indicators, a simple
    backtesting engine, and risk metrics.
4.  **Deliver the educational experience:** lessons, charting, replay,
    and paper simulation.
5.  **Scale only when justified:** Kafka, Flink, distributed workers,
    and Kubernetes.

The strongest portfolio story is not "I built a stock trading website."
It is:

> I designed and built an educational financial-market platform backed
> by a reproducible quantitative research engine and a scalable
> historical market-data pipeline. The platform lets learners understand
> market concepts, replay historical price action, simulate trades, and
> evaluate strategy hypotheses while the underlying system handles data
> quality, time-series analytics, and performance measurement.

That story demonstrates financial-domain understanding, backend
engineering, data engineering, analytical thinking, and the ability to
build a complete product.

**Important disclaimer:** MarketLab is an educational and research tool.
Historical simulations are subject to data limitations, execution
assumptions, and statistical uncertainty. They do not guarantee future
results or constitute personalized investment advice.


------------------------------------------------------------------------

# Part II --- Extended Analysis (added after initial review)

Sections 1--22 are the original proposal. Sections 23 onward refine it:
a deeper product idea, a feasibility verdict, the simplified stack
currently in effect, and the public datasets usable now. Where Part II
conflicts with Part I, **Part II wins** for the current phase.

## 23. Refined Product Idea

### 23.1 The sharper thesis

The original blueprint describes many modules. The idea becomes
distinctive when the whole product is organized around one principle:

> **MarketLab teaches people to distrust their own results.**

Most retail trading tools help users find something that "works".
MarketLab does the opposite: every experiment is paired with the tools
to ask *"is this luck, bias, or a real edge?"* This is educational,
honest, and technically deep (statistics, point-in-time data, honest
simulation), which fits the engineering goals.

### 23.2 Features to add beyond the original modules

| Feature | What it teaches | Why it is valuable |
|---|---|---|
| **Blind replay** | Price action without hindsight | Symbol, dates and absolute price level are hidden (prices rebased to 100, dates shown as "day 1..n"), so learners cannot recognise e.g. March 2020 and cheat from memory. Reveal identity only after the decision. |
| **Prediction scoring** | Calibration | Before each reveal the learner states direction and confidence; MarketLab scores with Brier score / calibration curve. Teaches that confidence should match accuracy. |
| **Luck control ("shuffle test")** | Randomness vs edge | Run the same strategy on bootstrapped / block-shuffled / synthetic random-walk data. If random data gives similar results, the edge is likely noise. |
| **Overfitting meter** | Data snooping | Count how many parameter combinations a user tried; display a multiple-testing penalty (e.g. deflated Sharpe ratio, see concept references). |
| **Trade journal and behaviour review** | Psychology | Users tag trades with a reason; post-review shows disposition effect (selling winners early, holding losers), overtrading, risk drift. |
| **Cost sensitivity sweep** | Transaction costs | Re-run a backtest across a grid of commission/slippage values; plot return vs cost. Many "profitable" strategies die at realistic costs. |
| **Regime breakdown** | Non-stationarity | Split results by volatility regime / bull-bear / year, show where the strategy earned or lost money. |
| **Look-ahead detector (teaching mode)** | Look-ahead bias | Let users deliberately build a leaky strategy (e.g. use today's close to trade at today's close) and show the inflated result next to the correct one. |
| **Data lineage panel** | Data trust | For any chart: provider, retrieval time, adjustment method, quality flags, dataset hash. Reinforces the data-engineering story. |
| **Reproducibility hash** | Scientific method | Every backtest stores hash(strategy spec + parameters + dataset manifest + engine version). Same hash must give identical results. |

### 23.3 Domain subtleties that must be designed in from the start

These are the places where finance projects commonly go subtly wrong.

1. **Backward-adjusted prices leak the future.** A dividend-adjusted
   series is scaled using dividends that happen *after* a given date.
   Using it in a backtest or replay quietly leaks future information.
   Store **raw** prices plus a **corporate-actions table**, and compute
   adjustment factors *as-of* the cursor/decision date.
2. **Point-in-time fundamentals.** A 10-K for fiscal year 2020 is filed
   in 2021. Fundamentals must be keyed by *filing/acceptance date*, not
   period end, or fundamental strategies look-ahead. SEC data exposes
   both dates.
3. **Survivorship bias is unavoidable with most free data.** Be honest in
   the UI: show a "universe caveat" badge. Use at least one dataset that
   includes delisted names to demonstrate the effect (see Section 25).
4. **Indicator windows.** Any centered/two-sided window (e.g. `rolling(center=True)`)
   is look-ahead. Indicators must be strictly causal; test this with a
   "truncate the future and recompute" invariant (Section 26).
5. **Daily bars hide the intrabar path.** A bar where both stop and
   target were touched has an ambiguous outcome. Choose a documented,
   conservative rule (e.g. assume stop first) and surface it.
6. **Time.** UTC storage, exchange-local session logic, half-days,
   holidays. Daily bar "date" is a trading date, not an instant.
7. **Volume semantics differ by feed.** IEX-only volume is a small
   fraction of consolidated volume. Never compare volume across feeds.

### 23.4 Learning-experience design

* Every lesson ends with a **"try it on real data"** step linking to a
  pre-set chart/replay (the main differentiator from text-only sites).
* Clearly separate **mechanics** (facts: how an order type works) from
  **interpretations** (debated: ICT/SMC, pattern lore). Interpretations
  are always rendered with visible, editable detection rules.
* A **glossary** is a first-class data model (term, definition, level,
  related terms, source), not a static page, so lessons can auto-link.
* Prefer **small mastery checks** (one concept, 3--5 questions, instant
  feedback) over long quizzes.

## 24. Simplified Stack (Current Phase)

Decision: **keep it simple**. Everything below is the *current*
baseline; Part I's ClickHouse/Kafka/Flink/Redis/Kubernetes are deferred
until a *measured* need appears.

| Layer | Current choice | Notes |
|---|---|---|
| Frontend | Simple TypeScript SPA (Vite + React, or Next.js if SSR is wanted) | Lessons need no SEO, so Next.js is optional. Charts: TradingView **Lightweight Charts** (Apache-2.0). |
| App backend | **NestJS** | Auth, lessons/progress, strategies, replay sessions, paper accounts; acts as the public API gateway. |
| Analytics service | **Python (FastAPI)** + Polars + NumPy | Ingestion, indicators, backtesting, metrics. Exposes an OpenAPI spec; generate a typed TS client for NestJS. |
| Database | **PostgreSQL only** | Use separate schemas by owner (see below). |
| Raw/curated files | Parquet on **local disk** | Replaces MinIO until needed. |
| Ad-hoc analytics/benchmarks | **DuckDB** over Parquet (optional, zero-ops) | Cheap stand-in for an OLAP engine; later compare with ClickHouse. |
| Local environment | Docker Compose with Postgres only | Services run natively during development. |

**Database ownership rule (prevents two-backend chaos):** one logical
database, separate schemas. For example `app` (owned/migrated by
NestJS), `market` (owned/migrated by the Python service), `research`
(backtest runs and results, owned by Python). A service may *read*
another's schema but only the owner writes or migrates it.

**Why this is enough:**
Rough sizes (back-of-envelope, verify by measurement):
* 5,000 symbols x 10 years of daily bars ~ 12.6 M rows.
* 50 symbols x 5 years of 1-minute regular-hours bars ~ 25 M rows.
Both fit comfortably in plain PostgreSQL with a composite
`(instrument_id, ts)` primary key (optionally monthly partitioning and a
BRIN index on `ts`). The 100 M-row benchmark in Section 13 is the point
where PostgreSQL is expected to struggle, and that experiment should be
run later as a *comparison*, not a prerequisite.

**Pragmatic notes on the two-backend setup:**
* NestJS + Python is extra operational surface. Keep the contract narrow:
  NestJS never computes indicators or metrics; Python never handles
  users/auth. Python is called by NestJS only.
* Long jobs (backtests): start with a `jobs` table in Postgres polled by a
  Python worker (`SELECT ... FOR UPDATE SKIP LOCKED`). No queue broker needed.
* The replay cursor lives in Postgres; every market-data query for a
  replay session is bounded `ts <= cursor` inside the data layer, not in
  the controller, so no code path can forget it.

## 25. Public Datasets Usable in This Phase

> **Verify before use.** URLs and terms change. For every dataset record
> in the project's data dictionary: URL, retrieval date, license/terms
> text, adjustment status, and known gaps. "Public" does not mean
> "redistributable". Do not commit third-party price data to a public
> repository; commit only synthetic or clearly permitted samples plus
> download scripts. Items marked (V) had their URLs confirmed
> while writing this section; the others are from prior knowledge and
> must be confirmed.

### 25.1 Daily and intraday price data

| Dataset / API | URL | Content | Caveats | Use now |
|---|---|---|---|---|
| **Alpaca Market Data (free plan)** | https://docs.alpaca.markets/docs/about-market-data-api | Historical bars via API (free plan uses the IEX feed; SIP needs subscription), plus a corporate-actions endpoint | Account/API key required; IEX volume is not consolidated volume; terms restrict redistribution | **Primary** source of clean daily + minute bars for a small universe |
| **Stooq bulk downloads** | https://stooq.com/db/h/ | Free bulk text files of daily (and some hourly/5-min) history for US stocks/ETFs | Terms of use unclear: treat as personal/research; adjustment status must be inspected; coverage varies | **Bulk** daily data for learning and for stress-testing ingestion |
| **Kaggle: Huge Stock Market Dataset** | https://www.kaggle.com/datasets/borismarjanovic/price-volume-data-for-all-us-stocks-etfs | Daily OHLCV for thousands of US stocks and ETFs, ends 2017 | Stale; check license on page; good for ingestion and quality-check practice | Ingestion practice, data-quality exercises |
| **Kaggle: S&P 500 stock data** | https://www.kaggle.com/datasets/camnugent/sandp500 | 5 years daily OHLCV of S&P 500 members (2013--2018) | Survivors only; small | Quick prototyping |
| **Kaggle: Stock Market Data (Nasdaq, NYSE, S&P 500)** | https://www.kaggle.com/datasets/paultimothymooney/stock-market-data | Daily history by exchange | Stale; verify license | Alternative bulk set |
| **Quandl/Nasdaq "WIKI" prices archive** (community mirrors on Kaggle and elsewhere) | https://data.nasdaq.com/ (original, discontinued 2018) | ~3,000 US stocks 1962--2018 *including delisted names*, with split/dividend columns | Discontinued in 2018; mirrors vary in legality/licensing, check source | **Survivorship-bias demonstration** and corporate-action practice |
| **Massive (ex-Polygon) free tier** | https://massive.com/docs | Aggregates, reference data, splits/dividends endpoints | Free tier is rate- and history-limited; verify plan | Secondary API, corporate-action cross-check |
| **Tiingo free tier** | https://www.tiingo.com/ | EOD prices with split/dividend adjusted fields | Rate limits; personal use terms | Cross-check source |
| **Alpha Vantage free tier** | https://www.alphavantage.co/documentation/ | Daily/intraday/fundamental endpoints | Very low daily request quota | Small cross-check only |
| **yfinance (unofficial Yahoo wrapper)** | https://github.com/ranaroussi/yfinance | Convenient daily/intraday history incl. actions | Unofficial; Yahoo terms limit use to personal; may break | Personal exploration only, never as the documented source of record |

### 25.2 Universe and reference data

| Dataset | URL | Use |
|---|---|---|
| **SEC ticker-to-CIK map** | https://www.sec.gov/files/company_tickers.json | Symbol <-> CIK mapping to join prices with filings |
| **Nasdaq Trader Symbol Directory** | https://www.nasdaqtrader.com/trader.aspx?id=symboldirdefs | Current list of listed symbols incl. ETF flag, test-issue flag (`nasdaqlisted.txt`, `otherlisted.txt`) |
| **S&P 500 constituents and historical changes** | https://en.wikipedia.org/wiki/List_of_S%26P_500_companies | Universe selection; the "changes" table helps illustrate survivorship (CC BY-SA, attribute) |
| **ETF issuer holdings files** (iShares, SPDR/State Street, Vanguard) | issuer websites | ETF composition lessons; check each issuer's terms |
| **NYSE holidays and hours** | https://www.nyse.com/markets/hours-calendars | Authoritative trading calendar for validation |
| **exchange_calendars** (library, Apache-2.0) | https://github.com/gerrymanoim/exchange_calendars | Programmatic sessions, holidays, early closes |

### 25.3 Fundamentals and filings (public domain, US government)

| Dataset | URL | Notes |
|---|---|---|
| **SEC bulk `companyfacts.zip`** (V) | https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip | All XBRL facts for all filers, rebuilt nightly. Contains filing date and period; supports point-in-time modelling |
| **SEC bulk `submissions.zip`** (V) | https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip | Filing history per filer |
| **SEC EDGAR APIs overview** (V) | https://www.sec.gov/search-filings/edgar-application-programming-interfaces | `data.sec.gov` Submissions / Company Facts / Frames |
| **SEC Financial Statement Data Sets** | https://www.sec.gov/dera/data/financial-statement-data-sets | Quarterly flat files of financial-statement numbers |
| **SEC fair-access policy** | https://www.sec.gov/os/webmaster-faq#developers | Declare a descriptive User-Agent with contact info and stay within the published request-rate cap (currently 10 requests/second) |

### 25.4 Macro, risk-free rate and factor benchmarks

| Dataset | URL | Use |
|---|---|---|
| **FRED** (free API key) | https://fred.stlouisfed.org/ | Risk-free rate (e.g. DGS3MO), VIX (VIXCLS), macro context for Sharpe and regime lessons |
| **US Treasury par yield curve** | https://home.treasury.gov/resource-center/data-chart-center/interest-rates | Alternative risk-free source |
| **Kenneth French Data Library** | https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html | Daily/monthly factor returns (market, size, value, momentum): benchmarks and regression ("is it alpha or beta?") lessons |

### 25.5 Tick, trade and order-book data (later phases, plus benchmark material)

| Dataset | URL | Use |
|---|---|---|
| **Nasdaq TotalView-ITCH sample files** | https://emi.nasdaq.com/ITCH/Nasdaq%20ITCH/ | Real full-day exchange message feed samples (large, several GB): matching-engine and order-book lessons |
| **LOBSTER free samples** | https://lobsterdata.com/info/DataSamples.php | Reconstructed limit-order-book samples for a few tickers, one day each; academic-oriented terms |
| **FI-2010 limit order book dataset** | https://etsin.fairdata.fi/ (search "FI-2010") | Public LOB benchmark dataset (Nasdaq Nordic) |
| **Binance public market data** | https://data.binance.vision/ , https://github.com/binance/binance-public-data | Free bulk trades/aggTrades/klines as daily CSV zips. Crypto, not equities, but an excellent legal source of **100M+ real trade rows** for the PostgreSQL vs DuckDB/ClickHouse benchmark |
| **Synthetic generators** (own code) | n/a | Geometric Brownian motion, jump-diffusion or Heston-style series with seeded RNG: deterministic tests, shuffle-test controls, and benchmark data of any size with no licensing risk |

### 25.6 Recommended dataset plan for the current phase

1. **Universe:** ~50--100 symbols: major index ETFs (e.g. SPY, QQQ, IWM,
   DIA, sector ETFs) plus ~40 large liquid stocks across sectors, plus a
   few that split or paid special dividends (corporate-action test
   cases), plus a few known-delisted names from the WIKI archive.
2. **Daily bars:** Alpaca (primary) cross-checked with Tiingo or Massive;
   Stooq/Kaggle for bulk-ingestion practice.
3. **Minute bars:** Alpaca, only ~5--10 symbols, 1--2 years, to learn
   timezone/session logic.
4. **Reference:** SEC ticker map, Nasdaq Trader directory, exchange_calendars.
5. **Fundamentals:** SEC companyfacts for the same universe; a handful of
   concepts only (revenue, net income, EPS, assets, liabilities).
6. **Benchmarks/macro:** FRED risk-free rate and VIX; French factors.
7. **Tests and benchmarks:** synthetic data (committed as generator code);
   Binance trades for the scale benchmark (not committed).

## 26. Feasibility Assessment

### 26.1 Verdict

**Feasible and well-scoped, provided scope discipline is kept.** The
product vision is large, but the critical path (clean daily data ->
causal indicators -> honest backtester -> server-bounded replay) is
modest in compute and well-understood. The risk is breadth, not
difficulty.

| Area | Feasibility | Main risk | Mitigation |
|---|---|---|---|
| Data ingestion (daily/minute, small universe) | High | Provider limits, licensing, messy corporate actions | Idempotent loaders, raw-file retention, data dictionary with provenance |
| PostgreSQL as only store | High at stated scale | Slowdown only appears at 100M+ rows | Composite PK, partitioning/BRIN; benchmark later against DuckDB/ClickHouse |
| Server-side replay without leakage | High | A forgotten query path leaking future bars | Cursor enforced in a single data-access layer + automated leakage tests |
| Backtest engine (daily, long-only, single asset) | High | Subtle look-ahead / fill-model errors | Causality invariant tests, hand-computed golden cases, cross-check against a reference library |
| NestJS + Python split | Medium | Contract drift, duplicated logic, ops burden | Narrow contract, OpenAPI-generated client, schema ownership rule |
| Educational content | Medium | Content volume is the real bottleneck; accuracy | Start with ~8 lessons, cite sources, separate mechanics from opinion |
| ICT/SMC detection | Medium-low | Subjective definitions | Configurable, visible rules; defer until the core is stable |
| Free-data quality | Medium | Survivorship bias, vendor adjustments, gaps | Be explicit in UI; cross-check two sources; flag, don't delete |
| Order-book simulation | High (simulated) | Scope creep | Defer; a small price-time-priority matcher is a self-contained project |
| Distributed streaming (Kafka/Flink) | Not needed now | Premature complexity | Defer until a measured requirement exists |

### 26.2 Things that can silently invalidate the project

1. Leaking future data in replay, indicators or adjusted prices.
2. Mixing adjusted and unadjusted prices.
3. Reporting backtest results without costs and without caveats.
4. Using free data's survivors as if they were the market.
5. Publicly redistributing licensed data.

Each should have an automated test (see sprint task benchmarks).

### 26.3 Standing invariants (tests every sprint should respect)

* **Idempotency:** ingesting the same source twice leaves row counts and
  checksums unchanged.
* **Causality:** for any indicator or signal at time *t*, recomputing
  from data truncated at *t* gives the same value.
* **Replay boundary:** a replay API response never contains a bar with
  `ts > cursor`; fuzz this with random cursors.
* **Reproducibility:** same config hash + dataset manifest -> identical
  backtest output.
* **Reconciliation:** row counts and OHLC sanity (High >= max(Open,Close),
  Low <= min(Open,Close), Volume >= 0) pass or are reported.

### 26.4 Suggested sprint arc (non-binding)

The sprint-decision agent chooses the actual order after reading the
status of previous sprints; this is only a hint of dependencies:

1. Domain vocabulary, data dictionary, first dataset loaded and inspected.
2. Instrument/bar schema in Postgres, idempotent ingestion, manifests.
3. Data-quality checks, trading calendar, corporate actions.
4. Market-data read API with replay cursor; basic chart.
5. Returns and causal indicators.
6. Backtest engine v1 (MA crossover), costs, metrics.
7. Validation: in/out-of-sample, shuffle test, reproducibility hash.
8. Lessons, quizzes, progress; paper trading.
9. Benchmarks (Postgres vs DuckDB vs ClickHouse) and observability.

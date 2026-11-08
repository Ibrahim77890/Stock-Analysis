"""create research schema (backtest runs, trades, equity)

Revision ID: 0007
Revises: 0006
"""

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS research")
    op.execute("""
        CREATE TABLE research.backtest_run (
            run_id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            config_hash         TEXT NOT NULL UNIQUE CHECK (length(config_hash) = 64),
            result_hash         TEXT NOT NULL CHECK (length(result_hash) = 64),
            engine_version      TEXT NOT NULL,
            spec                JSONB NOT NULL,
            dataset_fingerprint TEXT NOT NULL CHECK (length(dataset_fingerprint) = 64),
            symbol              TEXT NOT NULL,
            first_date          DATE,
            last_date           DATE,
            bars_used           INTEGER,
            realisable          BOOLEAN NOT NULL,
            metrics             JSONB NOT NULL,
            benchmark_metrics   JSONB,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        CREATE TABLE research.backtest_trade (
            run_id      BIGINT NOT NULL REFERENCES research.backtest_run (run_id) ON DELETE CASCADE,
            trade_no    INTEGER NOT NULL,
            entry_date  DATE NOT NULL,
            exit_date   DATE NOT NULL,
            entry_price NUMERIC(18,6) NOT NULL,
            exit_price  NUMERIC(18,6) NOT NULL,
            shares      NUMERIC(24,8) NOT NULL,
            costs       NUMERIC(18,6) NOT NULL,
            pnl         NUMERIC(18,6) NOT NULL,
            closed      BOOLEAN NOT NULL,
            PRIMARY KEY (run_id, trade_no)
        )
    """)
    op.execute("""
        CREATE TABLE research.backtest_equity (
            run_id     BIGINT NOT NULL REFERENCES research.backtest_run (run_id) ON DELETE CASCADE,
            trade_date DATE NOT NULL,
            equity     NUMERIC(24,8) NOT NULL,
            position   SMALLINT NOT NULL CHECK (position IN (0, 1)),
            PRIMARY KEY (run_id, trade_date)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE research.backtest_equity")
    op.execute("DROP TABLE research.backtest_trade")
    op.execute("DROP TABLE research.backtest_run")
    op.execute("DROP SCHEMA research")

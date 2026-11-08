"""create bar_daily table

Raw (unadjusted) daily bars. Key: (instrument_id, trade_date, source).

Revision ID: 0003
Revises: 0002
"""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE market.bar_daily (
            instrument_id    BIGINT NOT NULL REFERENCES market.instrument (instrument_id),
            trade_date       DATE NOT NULL,
            source           TEXT NOT NULL,
            open             NUMERIC(18, 6) NOT NULL,
            high             NUMERIC(18, 6) NOT NULL,
            low              NUMERIC(18, 6) NOT NULL,
            close            NUMERIC(18, 6) NOT NULL,
            volume           BIGINT NOT NULL,
            trade_count      BIGINT,
            vwap             NUMERIC(18, 6),
            ingestion_job_id BIGINT NOT NULL REFERENCES market.ingestion_job (ingestion_job_id),
            loaded_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (instrument_id, trade_date, source),
            CONSTRAINT bar_daily_prices_positive CHECK (open > 0 AND high > 0 AND low > 0 AND close > 0),
            CONSTRAINT bar_daily_high_ok CHECK (high >= GREATEST(open, close, low)),
            CONSTRAINT bar_daily_low_ok CHECK (low <= LEAST(open, close, high)),
            CONSTRAINT bar_daily_volume_nonneg CHECK (volume >= 0)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE market.bar_daily")

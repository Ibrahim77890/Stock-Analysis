"""create corporate_action table

Revision ID: 0004
Revises: 0003
"""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE market.corporate_action (
            corporate_action_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            instrument_id       BIGINT NOT NULL REFERENCES market.instrument (instrument_id),
            action_type         TEXT NOT NULL CHECK (action_type IN ('split', 'dividend')),
            ex_date             DATE NOT NULL,
            split_from          NUMERIC(18, 6),
            split_to            NUMERIC(18, 6),
            cash_amount         NUMERIC(18, 6),
            source              TEXT NOT NULL,
            ingestion_job_id    BIGINT NOT NULL REFERENCES market.ingestion_job (ingestion_job_id),
            loaded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (instrument_id, action_type, ex_date, source),
            CONSTRAINT corporate_action_split_ok CHECK (
                action_type <> 'split' OR (split_from > 0 AND split_to > 0)),
            CONSTRAINT corporate_action_dividend_ok CHECK (
                action_type <> 'dividend' OR cash_amount >= 0)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE market.corporate_action")

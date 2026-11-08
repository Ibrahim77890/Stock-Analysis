"""create data_quality_result table

Revision ID: 0006
Revises: 0005
"""

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE market.data_quality_result (
            result_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            run_id        TEXT NOT NULL,
            rule          TEXT NOT NULL,
            severity      TEXT NOT NULL CHECK (severity IN ('error', 'warning', 'info')),
            instrument_id BIGINT NOT NULL REFERENCES market.instrument (instrument_id),
            trade_date    DATE,
            detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX data_quality_result_run_idx ON market.data_quality_result (run_id, rule)")


def downgrade() -> None:
    op.execute("DROP TABLE market.data_quality_result")

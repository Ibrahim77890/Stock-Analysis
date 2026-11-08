"""create bar_quarantine table

Rows rejected by the loader are kept here with a reason; never silently dropped.

Revision ID: 0005
Revises: 0004
"""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE market.bar_quarantine (
            quarantine_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            ingestion_job_id BIGINT NOT NULL REFERENCES market.ingestion_job (ingestion_job_id),
            symbol           TEXT,
            trade_date       DATE,
            reason           TEXT NOT NULL,
            raw_record       JSONB NOT NULL,
            quarantined_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX bar_quarantine_job_idx ON market.bar_quarantine (ingestion_job_id)")


def downgrade() -> None:
    op.execute("DROP TABLE market.bar_quarantine")

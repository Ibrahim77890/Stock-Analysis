"""create ingestion_job table

Revision ID: 0002
Revises: 0001
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE market.ingestion_job (
            ingestion_job_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            kind             TEXT NOT NULL CHECK (kind IN ('bars', 'corporate_actions')),
            source           TEXT NOT NULL,
            file_name        TEXT NOT NULL,
            file_sha256      TEXT NOT NULL,
            status           TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
            started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            finished_at      TIMESTAMPTZ,
            rows_read        BIGINT NOT NULL DEFAULT 0,
            rows_inserted    BIGINT NOT NULL DEFAULT 0,
            rows_updated     BIGINT NOT NULL DEFAULT 0,
            rows_unchanged   BIGINT NOT NULL DEFAULT 0,
            rows_rejected    BIGINT NOT NULL DEFAULT 0,
            error            TEXT
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE market.ingestion_job")

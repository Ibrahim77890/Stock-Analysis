"""create market.macro_observation (FRED series) and allow ingestion_job kind 'macro'

Revision ID: 0009
Revises: 0008
"""

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE market.ingestion_job DROP CONSTRAINT ingestion_job_kind_check")
    op.execute("ALTER TABLE market.ingestion_job ADD CONSTRAINT ingestion_job_kind_check "
               "CHECK (kind IN ('bars', 'corporate_actions', 'macro'))")
    op.execute("""
        CREATE TABLE market.macro_observation (
            series_id        TEXT NOT NULL,
            obs_date         DATE NOT NULL,
            value            NUMERIC(18, 6),
            source           TEXT NOT NULL,
            ingestion_job_id BIGINT NOT NULL REFERENCES market.ingestion_job (ingestion_job_id),
            loaded_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (series_id, obs_date, source),
            CONSTRAINT macro_value_ok CHECK (value IS NULL OR value > -1000)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE market.macro_observation")
    op.execute("DELETE FROM market.ingestion_job WHERE kind = 'macro'")
    op.execute("ALTER TABLE market.ingestion_job DROP CONSTRAINT ingestion_job_kind_check")
    op.execute("ALTER TABLE market.ingestion_job ADD CONSTRAINT ingestion_job_kind_check "
               "CHECK (kind IN ('bars', 'corporate_actions'))")

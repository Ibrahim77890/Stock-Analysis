"""create instrument table

Revision ID: 0001
Revises:
"""

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE market.instrument (
            instrument_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            symbol        TEXT NOT NULL UNIQUE,
            name          TEXT NOT NULL,
            asset_type    TEXT NOT NULL CHECK (asset_type IN ('stock', 'etf')),
            sector        TEXT,
            exchange_code TEXT NOT NULL DEFAULT 'XNYS',
            currency      CHAR(3) NOT NULL DEFAULT 'USD',
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE market.instrument")

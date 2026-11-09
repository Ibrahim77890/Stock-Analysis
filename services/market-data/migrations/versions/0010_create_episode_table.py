"""create research.episode (blind learning episodes)

Revision ID: 0010
Revises: 0009
"""

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE research.episode (
            episode_id      TEXT PRIMARY KEY,
            seed            BIGINT NOT NULL,
            kind            TEXT NOT NULL CHECK (kind IN ('real', 'synthetic')),
            kind_requested  TEXT NOT NULL CHECK (kind_requested IN ('real', 'synthetic', 'mixed')),
            symbol          TEXT,
            source          TEXT,
            start_date      DATE,
            synthetic_vol   DOUBLE PRECISION,
            n_bars          INTEGER NOT NULL CHECK (n_bars BETWEEN 60 AND 500),
            initial_visible INTEGER NOT NULL CHECK (initial_visible >= 20 AND initial_visible < n_bars),
            cursor_pos      INTEGER NOT NULL,
            status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'revealed')),
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            revealed_at     TIMESTAMPTZ,
            CONSTRAINT episode_cursor_ok CHECK (cursor_pos BETWEEN initial_visible AND n_bars),
            CONSTRAINT episode_kind_fields CHECK (
                (kind = 'real' AND symbol IS NOT NULL AND source IS NOT NULL AND start_date IS NOT NULL)
                OR (kind = 'synthetic' AND synthetic_vol IS NOT NULL))
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE research.episode")

"""create research.lab_study (Strategy Lab studies: practice window, vault, the one vault use)

Revision ID: 0012
Revises: 0011
"""

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE research.lab_study (
            study_id       BIGINT PRIMARY KEY REFERENCES research.study (study_id) ON DELETE RESTRICT,
            source         TEXT NOT NULL DEFAULT 'tiingo',
            practice_end   DATE NOT NULL,
            vault_bars     INTEGER NOT NULL CHECK (vault_bars BETWEEN 120 AND 1500),
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            vault_fast     INTEGER,
            vault_slow     INTEGER,
            vault_cost_bps DOUBLE PRECISION
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE research.lab_study")

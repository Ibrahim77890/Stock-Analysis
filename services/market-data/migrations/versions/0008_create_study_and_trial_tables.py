"""create research.study and research.trial tables (trial registry)

Revision ID: 0008
Revises: 0007
"""

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE research.study (
            study_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            name            TEXT NOT NULL,
            family          TEXT NOT NULL,
            symbol          TEXT NOT NULL,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            holdout_used_at TIMESTAMPTZ
        )
    """)
    op.execute("""
        CREATE TABLE research.trial (
            trial_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            study_id     BIGINT NOT NULL REFERENCES research.study (study_id) ON DELETE CASCADE,
            phase        TEXT NOT NULL CHECK (phase IN ('train', 'test', 'holdout')),
            params       JSONB NOT NULL,
            window_start DATE,
            window_end   DATE,
            config_hash  TEXT,
            total_return DOUBLE PRECISION,
            sharpe       DOUBLE PRECISION,
            trades       INTEGER,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX trial_study_idx ON research.trial (study_id, phase)")


def downgrade() -> None:
    op.execute("DROP TABLE research.trial")
    op.execute("DROP TABLE research.study")

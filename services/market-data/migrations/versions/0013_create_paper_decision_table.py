"""create research.paper_decision (practice decisions, append-only: UPDATE and DELETE are refused by a trigger)

Revision ID: 0013
Revises: 0012
"""

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE research.paper_decision (
            decision_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            episode_id  TEXT NOT NULL REFERENCES research.episode (episode_id) ON DELETE RESTRICT,
            day         INTEGER NOT NULL CHECK (day >= 1),
            stance      TEXT NOT NULL CHECK (stance IN ('long', 'flat')),
            reason      TEXT NOT NULL CHECK (char_length(reason) <= 280),
            client_key  TEXT NOT NULL CHECK (char_length(client_key) BETWEEN 8 AND 64),
            cost_bps    REAL NOT NULL CHECK (cost_bps >= 0 AND cost_bps <= 50),
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (episode_id, client_key),
            UNIQUE (episode_id, day)
        )
    """)
    op.execute("""
        CREATE FUNCTION research.paper_decision_guard() RETURNS trigger AS $guard$
        BEGIN
            RAISE EXCEPTION 'paper decisions are append-only: % is not allowed', TG_OP;
        END;
        $guard$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE TRIGGER paper_decision_guard BEFORE UPDATE OR DELETE ON research.paper_decision
        FOR EACH ROW EXECUTE FUNCTION research.paper_decision_guard()
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER paper_decision_guard ON research.paper_decision")
    op.execute("DROP FUNCTION research.paper_decision_guard()")
    op.execute("DROP TABLE research.paper_decision")

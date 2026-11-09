"""create research.prediction (append-only guesses) with a trigger that allows only one resolution update

Revision ID: 0011
Revises: 0010
"""

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE research.prediction (
            prediction_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            episode_id      TEXT NOT NULL REFERENCES research.episode (episode_id) ON DELETE RESTRICT,
            made_at         INTEGER NOT NULL CHECK (made_at >= 1),
            horizon         INTEGER NOT NULL CHECK (horizon IN (1, 5, 10)),
            p_up            NUMERIC(5, 4) NOT NULL CHECK (p_up BETWEEN 0.01 AND 0.99),
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            outcome         SMALLINT CHECK (outcome IN (0, 1)),
            status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'void')),
            resolved_at_pos INTEGER,
            UNIQUE (episode_id, made_at, horizon)
        )
    """)
    op.execute("""
        CREATE FUNCTION research.prediction_guard() RETURNS trigger AS $guard$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'predictions are append-only: DELETE is not allowed';
            END IF;
            IF OLD.status <> 'pending' THEN
                RAISE EXCEPTION 'a resolved or void prediction can never change';
            END IF;
            IF NEW.status NOT IN ('resolved', 'void') THEN
                RAISE EXCEPTION 'a pending prediction may only become resolved or void';
            END IF;
            IF NEW.prediction_id <> OLD.prediction_id OR NEW.episode_id <> OLD.episode_id
               OR NEW.made_at <> OLD.made_at OR NEW.horizon <> OLD.horizon
               OR NEW.p_up <> OLD.p_up OR NEW.created_at <> OLD.created_at THEN
                RAISE EXCEPTION 'predictions are append-only: only the outcome may be set';
            END IF;
            IF NEW.status = 'resolved' AND (NEW.outcome IS NULL OR NEW.resolved_at_pos IS NULL) THEN
                RAISE EXCEPTION 'a resolved prediction needs an outcome and a resolution position';
            END IF;
            IF NEW.status = 'void' AND NEW.outcome IS NOT NULL THEN
                RAISE EXCEPTION 'a void prediction has no outcome';
            END IF;
            RETURN NEW;
        END;
        $guard$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE TRIGGER prediction_guard BEFORE UPDATE OR DELETE ON research.prediction
        FOR EACH ROW EXECUTE FUNCTION research.prediction_guard()
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER prediction_guard ON research.prediction")
    op.execute("DROP FUNCTION research.prediction_guard()")
    op.execute("DROP TABLE research.prediction")

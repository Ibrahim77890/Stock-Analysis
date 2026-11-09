-- Up Migration
CREATE TABLE app.learner_study (
    learner_id uuid NOT NULL REFERENCES app.learner (learner_id) ON DELETE CASCADE,
    study_id bigint NOT NULL UNIQUE,
    symbol text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (learner_id, study_id)
);

-- Down Migration
DROP TABLE app.learner_study;

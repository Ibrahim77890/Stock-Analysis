-- Up Migration
CREATE TABLE app.learner_episode (
    learner_id uuid NOT NULL REFERENCES app.learner (learner_id) ON DELETE CASCADE,
    episode_id text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (learner_id, episode_id)
);

-- Down Migration
DROP TABLE app.learner_episode;

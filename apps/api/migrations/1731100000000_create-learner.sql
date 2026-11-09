-- Up Migration
CREATE TABLE app.learner (
    learner_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name     text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 40),
    display_name_key text NOT NULL UNIQUE,
    password_hash    text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    last_login_at    timestamptz
);

-- Down Migration
DROP TABLE app.learner;

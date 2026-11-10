-- Up Migration
-- Lessons (content is data; the answer key stays in this table and never leaves the gateway)
CREATE TABLE app.lesson (
    slug      text PRIMARY KEY,
    version   int  NOT NULL,
    title     text NOT NULL,
    summary   text NOT NULL,
    minutes   int  NOT NULL,
    position  int  NOT NULL UNIQUE,
    content   jsonb NOT NULL,
    content_hash text NOT NULL
);

CREATE TABLE app.lesson_question (
    lesson_slug text NOT NULL REFERENCES app.lesson (slug) ON DELETE CASCADE,
    position    int  NOT NULL,
    version     int  NOT NULL,
    prompt      text NOT NULL,
    options     jsonb NOT NULL,
    PRIMARY KEY (lesson_slug, position)
);

CREATE TABLE app.lesson_progress (
    learner_id  uuid NOT NULL REFERENCES app.learner (learner_id) ON DELETE CASCADE,
    lesson_slug text NOT NULL,
    step        int  NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (learner_id, lesson_slug, step)
);

-- Append-only by convention: every attempt is kept with the lesson version it was made against.
CREATE TABLE app.quiz_answer (
    answer_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    learner_id       uuid NOT NULL REFERENCES app.learner (learner_id) ON DELETE CASCADE,
    lesson_slug      text NOT NULL,
    question_position int NOT NULL,
    lesson_version   int NOT NULL,
    option_index     int NOT NULL,
    correct          boolean NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quiz_answer_learner_idx ON app.quiz_answer (learner_id, lesson_slug, question_position);

-- Durable limits and request trace
CREATE TABLE app.rate_event (
    id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    key  text NOT NULL,
    kind text NOT NULL,
    at   timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX rate_event_key_idx ON app.rate_event (key, kind, at);

CREATE TABLE app.request_log (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_id  uuid NOT NULL,
    learner_id  uuid REFERENCES app.learner (learner_id) ON DELETE CASCADE,
    at          timestamptz NOT NULL,
    method      text NOT NULL,
    route       text NOT NULL,
    status      int  NOT NULL,
    duration_ms real NOT NULL,
    upstream    jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX request_log_learner_idx ON app.request_log (learner_id, at DESC);

-- Down Migration
DROP TABLE app.request_log;
DROP TABLE app.rate_event;
DROP TABLE app.quiz_answer;
DROP TABLE app.lesson_progress;
DROP TABLE app.lesson_question;
DROP TABLE app.lesson;

-- Up Migration
-- Each lesson carries its own setting: may a learner mark it complete by hand (as on Coursera)? Default yes.
ALTER TABLE app.lesson ADD COLUMN allow_manual_complete boolean NOT NULL DEFAULT true;

-- One row per learner and lesson that the learner marked complete. It never changes answers or steps read.
CREATE TABLE app.lesson_completion (
    learner_id   uuid NOT NULL REFERENCES app.learner (learner_id) ON DELETE CASCADE,
    lesson_slug  text NOT NULL,
    completed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (learner_id, lesson_slug)
);

-- Down Migration
DROP TABLE app.lesson_completion;
ALTER TABLE app.lesson DROP COLUMN allow_manual_complete;

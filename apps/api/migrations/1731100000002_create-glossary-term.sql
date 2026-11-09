-- Up Migration
CREATE TABLE app.glossary_term (
    slug             text PRIMARY KEY,
    term             text NOT NULL,
    plain_definition text NOT NULL,
    example          text,
    level            text NOT NULL,
    category         text NOT NULL,
    related          text[] NOT NULL DEFAULT '{}',
    source           text NOT NULL
);

-- Down Migration
DROP TABLE app.glossary_term;

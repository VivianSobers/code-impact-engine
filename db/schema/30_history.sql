CREATE TABLE author (
    author_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name      text NOT NULL,
    company   text,
    CONSTRAINT author_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT author_company_not_blank CHECK (company IS NULL OR btrim(company) <> '')
);

-- Email is a multivalued attribute of AUTHOR. One address belongs to one author.
CREATE TABLE author_email (
    author_id bigint NOT NULL,
    email     text   NOT NULL,
    CONSTRAINT author_email_pkey PRIMARY KEY (author_id, email),
    CONSTRAINT author_email_email_key UNIQUE (email),
    CONSTRAINT author_email_author_fkey FOREIGN KEY (author_id)
        REFERENCES author (author_id) ON DELETE CASCADE,
    CONSTRAINT author_email_lowercase CHECK (email = lower(email)),
    CONSTRAINT author_email_format CHECK (email ~ '^[^@\s]+@[^@\s]+$')
);

-- "commit" is an unreserved keyword in Postgres, so it works as a table name unquoted.
CREATE TABLE commit (
    commit_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    repo_id        bigint      NOT NULL,
    author_id      bigint      NOT NULL,
    sha            char(40)    NOT NULL,
    message        text        NOT NULL,
    committed_at   timestamptz NOT NULL,
    message_search tsvector GENERATED ALWAYS AS (to_tsvector('english', message)) STORED,
    CONSTRAINT commit_repo_sha_key UNIQUE (repo_id, sha),
    CONSTRAINT commit_repo_fkey FOREIGN KEY (repo_id)
        REFERENCES repository (repo_id) ON DELETE CASCADE,
    CONSTRAINT commit_author_fkey FOREIGN KEY (author_id)
        REFERENCES author (author_id),
    CONSTRAINT commit_sha_format CHECK (sha ~ '^[0-9a-f]{40}$')
);

CREATE INDEX commit_repo_time_idx ON commit (repo_id, committed_at DESC);
CREATE INDEX commit_author_idx ON commit (author_id);
CREATE INDEX commit_message_search_idx ON commit USING gin (message_search);

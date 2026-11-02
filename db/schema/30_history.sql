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

-- Which symbols a commit touched, and how much. Rows cascade away with their symbol
-- because re-parsing a repository deletes and recreates its symbols.
CREATE TABLE modifies (
    commit_id   bigint  NOT NULL,
    symbol_id   bigint  NOT NULL,
    additions   integer NOT NULL,
    deletions   integer NOT NULL,
    change_type text    NOT NULL,
    CONSTRAINT modifies_pkey PRIMARY KEY (commit_id, symbol_id),
    CONSTRAINT modifies_commit_fkey FOREIGN KEY (commit_id)
        REFERENCES commit (commit_id) ON DELETE CASCADE,
    CONSTRAINT modifies_symbol_fkey FOREIGN KEY (symbol_id)
        REFERENCES symbol (symbol_id) ON DELETE CASCADE,
    CONSTRAINT modifies_additions_nonnegative CHECK (additions >= 0),
    CONSTRAINT modifies_deletions_nonnegative CHECK (deletions >= 0),
    CONSTRAINT modifies_changes_something CHECK (additions + deletions > 0),
    CONSTRAINT modifies_change_type_known CHECK (change_type IN ('added', 'modified'))
);

CREATE INDEX modifies_symbol_idx ON modifies (symbol_id);

-- Application login. Only bcrypt hashes are stored, never the password.
CREATE TABLE app_user (
    user_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username      text        NOT NULL,
    password_hash text        NOT NULL,
    role          text        NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_user_username_key UNIQUE (username),
    CONSTRAINT app_user_username_format CHECK (username ~ '^[a-z0-9_.-]{3,32}$'),
    CONSTRAINT app_user_password_bcrypt CHECK (password_hash ~ '^\$2[aby]\$1[0-4]\$[./A-Za-z0-9]{53}$'),
    CONSTRAINT app_user_role_known CHECK (role IN ('admin', 'developer'))
);

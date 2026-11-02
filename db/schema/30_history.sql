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

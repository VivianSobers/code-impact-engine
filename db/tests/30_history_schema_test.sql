BEGIN;

CREATE FUNCTION pg_temp.rejects(p_sql text, p_state text, p_constraint text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
    v_constraint text;
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME;
        IF v_state <> p_state THEN
            RAISE EXCEPTION 'expected SQLSTATE % for [%], got % (%)', p_state, p_sql, v_state, v_constraint;
        END IF;
        IF p_constraint IS NOT NULL AND v_constraint IS DISTINCT FROM p_constraint THEN
            RAISE EXCEPTION 'expected constraint % for [%], got %', p_constraint, p_sql, v_constraint;
        END IF;
        RETURN;
    END;
    RAISE EXCEPTION 'statement should have failed: %', p_sql;
END $$;

-- author and author_email

INSERT INTO author (name, company) VALUES ('Ana Ruiz', 'Acme'), ('Ben Okafor', NULL);
INSERT INTO author_email (author_id, email)
SELECT author_id, 'ana@acme.io' FROM author WHERE name = 'Ana Ruiz';
INSERT INTO author_email (author_id, email)
SELECT author_id, e FROM author CROSS JOIN (VALUES ('ben@acme.io'), ('ben.okafor@gmail.com')) AS v (e)
WHERE name = 'Ben Okafor';

SELECT pg_temp.rejects($q$INSERT INTO author (name) VALUES ('   ')$q$, '23514', 'author_name_not_blank');
SELECT pg_temp.rejects(
    $q$INSERT INTO author_email (author_id, email) SELECT author_id, 'Ana@Acme.io' FROM author WHERE name = 'Ana Ruiz'$q$,
    '23514', 'author_email_lowercase');
SELECT pg_temp.rejects(
    $q$INSERT INTO author_email (author_id, email) SELECT author_id, 'not-an-email' FROM author WHERE name = 'Ana Ruiz'$q$,
    '23514', 'author_email_format');
SELECT pg_temp.rejects(
    $q$INSERT INTO author_email (author_id, email) SELECT author_id, 'ana@acme.io' FROM author WHERE name = 'Ben Okafor'$q$,
    '23505', 'author_email_email_key');

DO $$
BEGIN
    IF (SELECT count(*) FROM author_email ae JOIN author a USING (author_id) WHERE a.name = 'Ben Okafor') <> 2 THEN
        RAISE EXCEPTION 'an author can have several emails';
    END IF;
END $$;

-- commit

INSERT INTO repository (name, url) VALUES ('history fixture', 'test://history');

CREATE FUNCTION pg_temp.repo() RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT repo_id FROM repository WHERE url = 'test://history'
$$;

CREATE FUNCTION pg_temp.author(p_name text) RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT author_id FROM author WHERE name = p_name
$$;

INSERT INTO commit (repo_id, author_id, sha, message, committed_at)
VALUES
    (pg_temp.repo(), pg_temp.author('Ana Ruiz'), repeat('a', 40), 'Apply discount codes at checkout', '2026-09-01 10:00+05:30'),
    (pg_temp.repo(), pg_temp.author('Ben Okafor'), repeat('b', 40), 'Round currency values', '2026-09-02 10:00+05:30');

SELECT pg_temp.rejects(format(
    $q$INSERT INTO commit (repo_id, author_id, sha, message, committed_at) VALUES (%s, %s, 'XYZ', 'bad sha', now())$q$,
    pg_temp.repo(), pg_temp.author('Ana Ruiz')), '23514', 'commit_sha_format');
SELECT pg_temp.rejects(format(
    $q$INSERT INTO commit (repo_id, author_id, sha, message, committed_at) VALUES (%s, %s, %L, 'again', now())$q$,
    pg_temp.repo(), pg_temp.author('Ana Ruiz'), repeat('a', 40)), '23505', 'commit_repo_sha_key');
SELECT pg_temp.rejects(format(
    $q$INSERT INTO commit (repo_id, author_id, sha, message, committed_at) VALUES (%s, NULL, %L, 'no author', now())$q$,
    pg_temp.repo(), repeat('c', 40)), '23502');

DO $$
BEGIN
    IF (SELECT array_agg(message) FROM commit WHERE message_search @@ plainto_tsquery('english', 'discount'))
        IS DISTINCT FROM ARRAY['Apply discount codes at checkout'] THEN
        RAISE EXCEPTION 'message search should find the discount commit only';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM commit WHERE message_search @@ plainto_tsquery('english', 'rounding')) THEN
        RAISE EXCEPTION 'message search should stem rounding to round';
    END IF;
END $$;

ROLLBACK;

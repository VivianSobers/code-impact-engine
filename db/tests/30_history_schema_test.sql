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
    $q$INSERT INTO author_email (author_id, email) SELECT author_id, 'ana ruiz@acme.io' FROM author WHERE name = 'Ana Ruiz'$q$,
    '23514', 'author_email_format');
SELECT pg_temp.rejects(
    $q$INSERT INTO author_email (author_id, email) SELECT author_id, 'ana@@acme.io' FROM author WHERE name = 'Ana Ruiz'$q$,
    '23514', 'author_email_format');
SELECT pg_temp.rejects(
    $q$INSERT INTO author_email (author_id, email) SELECT author_id, '' FROM author WHERE name = 'Ana Ruiz'$q$,
    '23514', 'author_email_format');

-- Git does not require an address in the email field; real histories have bare names.
INSERT INTO author_email (author_id, email) SELECT author_id, 'ana.ruiz' FROM author WHERE name = 'Ana Ruiz';
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

-- modifies

INSERT INTO file (repo_id, path, language, loc, content_hash)
VALUES (pg_temp.repo(), 'src/money.ts', 'typescript', 30, repeat('0', 64));

INSERT INTO symbol (repo_id, path, name, kind, start_line, end_line)
VALUES
    (pg_temp.repo(), 'src/money.ts', 'roundCurrency', 'function', 1, 5),
    (pg_temp.repo(), 'src/money.ts', 'formatMoney', 'function', 7, 12);

CREATE FUNCTION pg_temp.sym(p_name text) RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT symbol_id FROM symbol WHERE repo_id = pg_temp.repo() AND name = p_name
$$;

CREATE FUNCTION pg_temp.cmt(p_char text) RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT commit_id FROM commit WHERE repo_id = pg_temp.repo() AND sha = repeat(p_char, 40)
$$;

INSERT INTO modifies (commit_id, symbol_id, additions, deletions, change_type)
VALUES
    (pg_temp.cmt('a'), pg_temp.sym('roundCurrency'), 5, 0, 'added'),
    (pg_temp.cmt('b'), pg_temp.sym('roundCurrency'), 1, 1, 'modified'),
    (pg_temp.cmt('b'), pg_temp.sym('formatMoney'), 6, 0, 'added');

SELECT pg_temp.rejects(format(
    $q$INSERT INTO modifies VALUES (%s, %s, -1, 0, 'modified')$q$,
    pg_temp.cmt('a'), pg_temp.sym('formatMoney')), '23514', 'modifies_additions_nonnegative');
SELECT pg_temp.rejects(format(
    $q$INSERT INTO modifies VALUES (%s, %s, 0, 0, 'modified')$q$,
    pg_temp.cmt('a'), pg_temp.sym('formatMoney')), '23514', 'modifies_changes_something');
SELECT pg_temp.rejects(format(
    $q$INSERT INTO modifies VALUES (%s, %s, 1, 0, 'renamed')$q$,
    pg_temp.cmt('a'), pg_temp.sym('formatMoney')), '23514', 'modifies_change_type_known');
SELECT pg_temp.rejects(format(
    $q$INSERT INTO modifies VALUES (%s, %s, 1, 0, 'modified')$q$,
    pg_temp.cmt('a'), pg_temp.sym('roundCurrency')), '23505', 'modifies_pkey');

-- The parser re-ingests a repository by deleting its files, which deletes symbols.
-- History rows must go with them instead of blocking the delete.
DELETE FROM symbol WHERE symbol_id = pg_temp.sym('formatMoney');

DO $$
BEGIN
    IF (SELECT count(*) FROM modifies WHERE commit_id = pg_temp.cmt('b')) <> 1 THEN
        RAISE EXCEPTION 'deleting a symbol should delete its modifies rows';
    END IF;
END $$;

DELETE FROM commit WHERE commit_id = pg_temp.cmt('a');

DO $$
BEGIN
    IF (SELECT count(*) FROM modifies) <> 1 THEN
        RAISE EXCEPTION 'deleting a commit should delete its modifies rows';
    END IF;
END $$;

-- app_user

INSERT INTO app_user (username, password_hash, role)
VALUES
    ('admin.ana', '$2b$12$' || repeat('A', 53), 'admin'),
    ('dev.ben', '$2b$12$' || repeat('B', 53), 'developer');

SELECT pg_temp.rejects(
    $q$INSERT INTO app_user (username, password_hash, role) VALUES ('Mallory', '$2b$12$' || repeat('C', 53), 'developer')$q$,
    '23514', 'app_user_username_format');
SELECT pg_temp.rejects(
    $q$INSERT INTO app_user (username, password_hash, role) VALUES ('plain', 'hunter2hunter2', 'developer')$q$,
    '23514', 'app_user_password_bcrypt');
SELECT pg_temp.rejects(
    $q$INSERT INTO app_user (username, password_hash, role) VALUES ('boss', '$2b$12$' || repeat('D', 53), 'root')$q$,
    '23514', 'app_user_role_known');
SELECT pg_temp.rejects(
    $q$INSERT INTO app_user (username, password_hash, role) VALUES ('dev.ben', '$2b$12$' || repeat('E', 53), 'developer')$q$,
    '23505', 'app_user_username_key');

DO $$
BEGIN
    IF (SELECT created_at FROM app_user WHERE username = 'admin.ana') IS NULL THEN
        RAISE EXCEPTION 'created_at should default to now()';
    END IF;
END $$;

-- clone_cluster and waives

INSERT INTO symbol (repo_id, path, name, kind, start_line, end_line)
VALUES
    (pg_temp.repo(), 'src/money.ts', 'roundTotal', 'function', 14, 18),
    (pg_temp.repo(), 'src/money.ts', 'roundTax', 'function', 20, 24);

INSERT INTO clone_cluster (similarity_score) VALUES (0.970);

CREATE FUNCTION pg_temp.cluster() RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT max(cluster_id) FROM clone_cluster
$$;

CREATE FUNCTION pg_temp.usr(p_name text) RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT user_id FROM app_user WHERE username = p_name
$$;

UPDATE symbol SET cluster_id = pg_temp.cluster() WHERE name IN ('roundTotal', 'roundTax');

DO $$
BEGIN
    IF (SELECT status FROM clone_cluster WHERE cluster_id = pg_temp.cluster()) <> 'open' THEN
        RAISE EXCEPTION 'a new cluster should be open';
    END IF;
END $$;

SELECT pg_temp.rejects($q$INSERT INTO clone_cluster (similarity_score) VALUES (1.2)$q$, '23514', 'clone_cluster_score_range');
SELECT pg_temp.rejects($q$INSERT INTO clone_cluster (similarity_score, status, reviewed_at) VALUES (0.9, 'merged', now())$q$, '23514', 'clone_cluster_status_known');
-- A closed cluster without a reviewer is refused by clone_cluster_review_guard (30_clone_review.sql).
SELECT pg_temp.rejects(
    $q$INSERT INTO clone_cluster (similarity_score, status) VALUES (0.9, 'confirmed')$q$,
    '42501');
SELECT pg_temp.rejects(
    $q$INSERT INTO clone_cluster (similarity_score, reviewed_at) VALUES (0.9, now())$q$,
    '23514', 'clone_cluster_reviewed_when_closed');

INSERT INTO waives (user_id, symbol_id, reason)
VALUES (pg_temp.usr('admin.ana'), pg_temp.sym('roundTax'), 'Tax rounding rules differ by region');

SELECT pg_temp.rejects(format(
    $q$INSERT INTO waives (user_id, symbol_id, reason) VALUES (%s, %s, '  ok ')$q$,
    pg_temp.usr('dev.ben'), pg_temp.sym('roundTax')), '23514', 'waives_reason_length');

-- Deleting a symbol removes its waivers.
DELETE FROM symbol WHERE symbol_id = pg_temp.sym('roundTax');

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM waives) THEN
        RAISE EXCEPTION 'deleting a symbol should delete its waivers';
    END IF;
END $$;

-- Deleting a reviewer keeps the review but forgets who made it.
INSERT INTO clone_cluster (similarity_score, status, reviewed_by, reviewed_at)
VALUES (0.95, 'dismissed', pg_temp.usr('admin.ana'), now());
DELETE FROM app_user WHERE username = 'admin.ana';

DO $$
BEGIN
    IF (SELECT reviewed_by FROM clone_cluster WHERE status = 'dismissed') IS NOT NULL THEN
        RAISE EXCEPTION 'deleting a user should clear reviewed_by';
    END IF;
END $$;

-- symbol.cluster_id

INSERT INTO clone_cluster (similarity_score) VALUES (0.960);
UPDATE symbol SET cluster_id = pg_temp.cluster() WHERE symbol_id = pg_temp.sym('roundTotal');

SELECT pg_temp.rejects(
    $q$UPDATE symbol SET cluster_id = 999999999 WHERE name = 'roundTotal'$q$, '23503', 'symbol_cluster_fkey');

DELETE FROM clone_cluster WHERE cluster_id = pg_temp.cluster();

DO $$
BEGIN
    IF (SELECT cluster_id FROM symbol WHERE symbol_id = pg_temp.sym('roundTotal')) IS NOT NULL THEN
        RAISE EXCEPTION 'deleting a cluster should set its members'' cluster_id to null';
    END IF;
END $$;

ROLLBACK;

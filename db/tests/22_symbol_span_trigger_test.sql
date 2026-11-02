BEGIN;

INSERT INTO repository (name, url) VALUES ('span fixture', 'test://span');

INSERT INTO file (repo_id, path, language, loc, content_hash)
SELECT r.repo_id, f.path, 'python', f.loc, repeat('0', 64)
FROM repository r
CROSS JOIN (VALUES ('pkg/big.py', 50), ('pkg/small.py', 10), ('pkg/empty.py', 0)) AS f (path, loc)
WHERE r.url = 'test://span';

CREATE FUNCTION pg_temp.repo() RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT repo_id FROM repository WHERE url = 'test://span'
$$;

CREATE FUNCTION pg_temp.rejects(p_sql text, p_state text) RETURNS void
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
        IF p_state = '23514' AND v_constraint IS DISTINCT FROM 'symbol_within_file' THEN
            RAISE EXCEPTION 'expected symbol_within_file for [%], got %', p_sql, v_constraint;
        END IF;
        RETURN;
    END;
    RAISE EXCEPTION 'statement should have failed: %', p_sql;
END $$;

INSERT INTO symbol (repo_id, path, name, kind, start_line, end_line)
VALUES
    (pg_temp.repo(), 'pkg/big.py', 'pkg/big.py', 'module', 1, 50),
    (pg_temp.repo(), 'pkg/big.py', 'handler', 'function', 10, 20),
    (pg_temp.repo(), 'pkg/small.py', 'helper', 'function', 1, 10);

SELECT pg_temp.rejects(format(
    $q$INSERT INTO symbol (repo_id, path, name, kind, start_line, end_line) VALUES (%s, 'pkg/big.py', 'tail', 'function', 45, 51)$q$,
    pg_temp.repo()), '23514');

SELECT pg_temp.rejects(format(
    $q$INSERT INTO symbol (repo_id, path, name, kind, start_line, end_line) VALUES (%s, 'pkg/empty.py', 'ghost', 'function', 1, 1)$q$,
    pg_temp.repo()), '23514');

SELECT pg_temp.rejects(format(
    $q$INSERT INTO symbol (repo_id, path, name, kind, start_line, end_line) VALUES (%s, 'pkg/missing.py', 'lost', 'function', 1, 2)$q$,
    pg_temp.repo()), '23503');

SELECT pg_temp.rejects(
    $q$UPDATE symbol SET end_line = 60 WHERE name = 'handler'$q$, '23514');

SELECT pg_temp.rejects(
    $q$UPDATE symbol SET path = 'pkg/small.py' WHERE name = 'handler'$q$, '23514');

SELECT pg_temp.rejects(format(
    $q$UPDATE file SET loc = 40 WHERE repo_id = %s AND path = 'pkg/big.py'$q$,
    pg_temp.repo()), '23514');

UPDATE symbol SET start_line = 2, end_line = 9 WHERE name = 'helper';
UPDATE symbol SET path = 'pkg/small.py' WHERE name = 'helper';
UPDATE file SET loc = 60 WHERE repo_id = pg_temp.repo() AND path = 'pkg/big.py';
UPDATE file SET loc = 50 WHERE repo_id = pg_temp.repo() AND path = 'pkg/big.py';
UPDATE file SET loc = 9 WHERE repo_id = pg_temp.repo() AND path = 'pkg/small.py';
UPDATE file SET path = 'pkg/renamed.py' WHERE repo_id = pg_temp.repo() AND path = 'pkg/big.py';

DO $$
BEGIN
    IF (SELECT count(*) FROM symbol WHERE repo_id = pg_temp.repo() AND path = 'pkg/renamed.py') <> 2 THEN
        RAISE EXCEPTION 'renaming a file should carry its symbols along';
    END IF;
END $$;

ROLLBACK;

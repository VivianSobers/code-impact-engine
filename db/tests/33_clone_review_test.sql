BEGIN;

CREATE FUNCTION pg_temp.rejects(p_sql text, p_state text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
        IF v_state <> p_state THEN
            RAISE EXCEPTION 'expected SQLSTATE % for [%], got %', p_state, p_sql, v_state;
        END IF;
        RETURN;
    END;
    RAISE EXCEPTION 'statement should have failed: %', p_sql;
END $$;

INSERT INTO app_user (username, password_hash, role)
VALUES ('rev.admin', '$2b$12$' || repeat('A', 53), 'admin'),
       ('rev.admin2', '$2b$12$' || repeat('B', 53), 'admin'),
       ('rev.dev', '$2b$12$' || repeat('C', 53), 'developer');

CREATE FUNCTION pg_temp.usr(p_name text) RETURNS bigint
LANGUAGE sql STABLE AS $$ SELECT user_id FROM app_user WHERE username = p_name $$;

INSERT INTO repository (name, url) VALUES ('review fixture', 'test://review');
INSERT INTO file (repo_id, path, language, loc, content_hash)
SELECT repo_id, 'dup.py', 'python', 40, repeat('0', 64) FROM repository WHERE url = 'test://review';

CREATE FUNCTION pg_temp.sym(p_name text) RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT s.symbol_id FROM symbol s JOIN repository r USING (repo_id)
    WHERE r.url = 'test://review' AND s.name = p_name
$$;

INSERT INTO symbol (repo_id, path, name, kind, start_line, end_line)
SELECT repo_id, 'dup.py', n, 'function', l, l + 4
FROM repository, (VALUES ('a', 1), ('b', 10), ('c', 20), ('outsider', 30)) AS v (n, l)
WHERE url = 'test://review';

-- Three clusters: one per scenario below.
INSERT INTO clone_cluster (similarity_score) VALUES (0.97), (0.96), (0.95);

CREATE FUNCTION pg_temp.cl(p_n int) RETURNS bigint
LANGUAGE sql STABLE AS $$ SELECT cluster_id FROM clone_cluster ORDER BY cluster_id DESC OFFSET 3 - p_n LIMIT 1 $$;

UPDATE symbol SET cluster_id = pg_temp.cl(1) WHERE symbol_id IN (pg_temp.sym('a'), pg_temp.sym('b'));
UPDATE symbol SET cluster_id = pg_temp.cl(2) WHERE symbol_id = pg_temp.sym('c');

-- trigger: only an admin can close a cluster, and closing stamps reviewed_at.

SELECT pg_temp.rejects(format(
    $q$UPDATE clone_cluster SET status = 'confirmed', reviewed_by = %s WHERE cluster_id = %s$q$,
    pg_temp.usr('rev.dev'), pg_temp.cl(3)), '42501');
SELECT pg_temp.rejects(format(
    $q$UPDATE clone_cluster SET status = 'dismissed' WHERE cluster_id = %s$q$, pg_temp.cl(3)), '42501');
SELECT pg_temp.rejects(format(
    $q$INSERT INTO clone_cluster (similarity_score, status, reviewed_by, reviewed_at) VALUES (0.9, 'confirmed', %s, now())$q$,
    pg_temp.usr('rev.dev')), '42501');

UPDATE clone_cluster SET status = 'dismissed', reviewed_by = pg_temp.usr('rev.admin') WHERE cluster_id = pg_temp.cl(3);

DO $$
DECLARE
    v clone_cluster;
BEGIN
    SELECT * INTO v FROM clone_cluster WHERE cluster_id = pg_temp.cl(3);
    IF v.status <> 'dismissed' OR v.reviewed_at IS NULL OR v.reviewed_by <> pg_temp.usr('rev.admin') THEN
        RAISE EXCEPTION 'admin review should close the cluster and stamp reviewed_at: %', v;
    END IF;
END $$;

UPDATE clone_cluster SET status = 'open' WHERE cluster_id = pg_temp.cl(3);

DO $$
DECLARE
    v clone_cluster;
BEGIN
    SELECT * INTO v FROM clone_cluster WHERE cluster_id = pg_temp.cl(3);
    IF v.reviewed_at IS NOT NULL OR v.reviewed_by IS NOT NULL THEN
        RAISE EXCEPTION 'reopening should clear the reviewer: %', v;
    END IF;
END $$;

ROLLBACK;

BEGIN;

-- Runs p_sql as p_role. p_state is the SQLSTATE it must fail with, or NULL if it must
-- succeed. A failed statement rolls back its block, and with it the SET ROLE.
CREATE FUNCTION pg_temp.as_role(p_role text, p_sql text, p_state text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
    v_message text;
BEGIN
    BEGIN
        EXECUTE format('SET LOCAL ROLE %I', p_role);
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
        IF p_state IS NULL OR v_state <> p_state THEN
            RAISE EXCEPTION 'as %, expected % for [%], got %: %',
                p_role, coalesce(p_state, 'success'), p_sql, v_state, v_message;
        END IF;
        RETURN;
    END;
    RESET ROLE;
    IF p_state IS NOT NULL THEN
        RAISE EXCEPTION 'as %, statement should have failed with %: %', p_role, p_state, p_sql;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT pg_has_role('cie_admin', 'cie_developer', 'USAGE') THEN
        RAISE EXCEPTION 'cie_admin should inherit cie_developer';
    END IF;
    IF pg_has_role('cie_developer', 'cie_admin', 'MEMBER') THEN
        RAISE EXCEPTION 'cie_developer must not be a member of cie_admin';
    END IF;
END $$;

INSERT INTO app_user (username, password_hash, role)
VALUES ('roles.admin', '$2b$12$' || repeat('A', 53), 'admin'),
       ('roles.dev', '$2b$12$' || repeat('C', 53), 'developer');

INSERT INTO repository (name, url) VALUES ('roles fixture', 'test://roles');
INSERT INTO file (repo_id, path, language, loc, content_hash)
SELECT repo_id, 'app.py', 'python', 40, repeat('0', 64) FROM repository WHERE url = 'test://roles';
INSERT INTO symbol (repo_id, path, name, kind, start_line, end_line)
SELECT repo_id, 'app.py', n, 'function', l, l + 4
FROM repository, (VALUES ('handler', 1), ('helper', 10)) AS v (n, l)
WHERE url = 'test://roles';
INSERT INTO calls (caller_id, callee_id, call_line, resolution_confidence)
SELECT a.symbol_id, b.symbol_id, 2, 1
FROM symbol a, symbol b
WHERE a.name = 'handler' AND b.name = 'helper' AND a.path = 'app.py' AND b.path = 'app.py';
INSERT INTO clone_cluster (similarity_score) VALUES (0.97);
UPDATE symbol SET cluster_id = (SELECT max(cluster_id) FROM clone_cluster)
WHERE path = 'app.py' AND repo_id = (SELECT repo_id FROM repository WHERE url = 'test://roles');

CREATE TEMP TABLE ids AS
SELECT (SELECT repo_id FROM repository WHERE url = 'test://roles') AS repo,
       (SELECT max(cluster_id) FROM clone_cluster) AS cluster,
       (SELECT symbol_id FROM symbol WHERE name = 'helper' AND path = 'app.py') AS helper,
       (SELECT user_id FROM app_user WHERE username = 'roles.admin') AS admin,
       (SELECT user_id FROM app_user WHERE username = 'roles.dev') AS dev;
GRANT SELECT ON ids TO cie_developer;

-- cie_developer reads code structure, history, views and the stored functions.
SELECT pg_temp.as_role('cie_developer', 'SELECT count(*) FROM symbol', NULL);
SELECT pg_temp.as_role('cie_developer', 'SELECT count(*) FROM calls JOIN symbol ON symbol_id = caller_id', NULL);
SELECT pg_temp.as_role('cie_developer', 'SELECT count(*) FROM commit JOIN modifies USING (commit_id)', NULL);
SELECT pg_temp.as_role('cie_developer', 'SELECT * FROM v_symbol_hotspot', NULL);
SELECT pg_temp.as_role('cie_developer', 'SELECT * FROM v_author_activity', NULL);
SELECT pg_temp.as_role('cie_developer', 'SELECT * FROM clone_cluster JOIN symbol USING (cluster_id)', NULL);
SELECT pg_temp.as_role('cie_developer', format('SELECT * FROM impact_of(%s, 3)', (SELECT helper FROM ids)), NULL);
SELECT pg_temp.as_role('cie_developer', $q$SELECT * FROM search_symbols('helper')$q$, NULL);
SELECT pg_temp.as_role('cie_developer', 'SELECT user_id, username, role, created_at FROM app_user', NULL);

-- ...but never password hashes, and it writes nothing.
SELECT pg_temp.as_role('cie_developer', 'SELECT password_hash FROM app_user', '42501');
SELECT pg_temp.as_role('cie_developer', 'SELECT * FROM app_user', '42501');
SELECT pg_temp.as_role('cie_developer', $q$INSERT INTO repository (name, url) VALUES ('x', 'test://x')$q$, '42501');
SELECT pg_temp.as_role('cie_developer', format('DELETE FROM file WHERE repo_id = %s', (SELECT repo FROM ids)), '42501');
SELECT pg_temp.as_role('cie_developer', 'UPDATE symbol SET is_entry_point = true', '42501');
SELECT pg_temp.as_role('cie_developer', 'DELETE FROM calls', '42501');
SELECT pg_temp.as_role('cie_developer', format(
    $q$UPDATE clone_cluster SET status = 'confirmed', reviewed_by = %s WHERE cluster_id = %s$q$,
    (SELECT admin FROM ids), (SELECT cluster FROM ids)), '42501');
SELECT pg_temp.as_role('cie_developer', format(
    $q$INSERT INTO waives (user_id, symbol_id, reason) VALUES (%s, %s, 'looks fine to me')$q$,
    (SELECT dev FROM ids), (SELECT helper FROM ids)), '42501');
SELECT pg_temp.as_role('cie_developer', format(
    $q$CALL review_clone_cluster(%s, %s, 'dismissed')$q$, (SELECT cluster FROM ids), (SELECT admin FROM ids)), '42501');
SELECT pg_temp.as_role('cie_developer',
    $q$INSERT INTO app_user (username, password_hash, role) VALUES ('sneaky', '$2b$12$' || repeat('D', 53), 'admin')$q$, '42501');

-- cie_admin adds and removes repositories and their code structure.
SELECT pg_temp.as_role('cie_admin', $q$INSERT INTO repository (name, url) VALUES ('added by admin', 'test://roles-admin')$q$, NULL);
SELECT pg_temp.as_role('cie_admin', $q$INSERT INTO file (repo_id, path, language, loc, content_hash)
    SELECT repo_id, 'main.go', 'go', 10, repeat('1', 64) FROM repository WHERE url = 'test://roles-admin'$q$, NULL);
SELECT pg_temp.as_role('cie_admin', $q$INSERT INTO symbol (repo_id, path, name, kind, start_line, end_line)
    SELECT repo_id, 'main.go', 'main', 'function', 1, 5 FROM repository WHERE url = 'test://roles-admin'$q$, NULL);
SELECT pg_temp.as_role('cie_admin', $q$UPDATE repository SET default_branch = 'develop' WHERE url = 'test://roles-admin'$q$, NULL);
SELECT pg_temp.as_role('cie_admin', $q$DELETE FROM repository WHERE url = 'test://roles-admin'$q$, NULL);

-- cie_admin reviews clone clusters through the procedure, and can see and add users.
SELECT pg_temp.as_role('cie_admin', format(
    $q$CALL review_clone_cluster(%s, %s, 'confirmed', ARRAY[%s]::bigint[], 'Kept for the old API')$q$,
    (SELECT cluster FROM ids), (SELECT admin FROM ids), (SELECT helper FROM ids)), NULL);
SELECT pg_temp.as_role('cie_admin', 'SELECT username, password_hash FROM app_user', NULL);
SELECT pg_temp.as_role('cie_admin',
    $q$INSERT INTO app_user (username, password_hash, role) VALUES ('roles.new', '$2b$12$' || repeat('E', 53), 'developer')$q$, NULL);

DO $$
BEGIN
    IF (SELECT status FROM clone_cluster WHERE cluster_id = (SELECT cluster FROM ids)) <> 'confirmed'
       OR NOT EXISTS (SELECT 1 FROM waives WHERE symbol_id = (SELECT helper FROM ids)) THEN
        RAISE EXCEPTION 'the admin review should have closed the cluster and recorded the waiver';
    END IF;
END $$;

-- Even an admin only writes the review columns, and history and vectors stay with the
-- ingest tools that own them.
SELECT pg_temp.as_role('cie_admin', 'UPDATE clone_cluster SET reviewed_at = now()', '42501');
SELECT pg_temp.as_role('cie_admin', 'UPDATE clone_cluster SET similarity_score = 1', '42501');
SELECT pg_temp.as_role('cie_admin', 'DELETE FROM clone_cluster', '42501');
SELECT pg_temp.as_role('cie_admin', 'DELETE FROM commit', '42501');
SELECT pg_temp.as_role('cie_admin', 'DELETE FROM modifies', '42501');
SELECT pg_temp.as_role('cie_admin', 'DELETE FROM symbol_embedding', '42501');
SELECT pg_temp.as_role('cie_admin', $q$INSERT INTO author (name) VALUES ('Mallory')$q$, '42501');

ROLLBACK;

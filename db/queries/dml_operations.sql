-- DML on the code structure and history tables: INSERT, INSERT ... SELECT, UPSERT,
-- UPDATE, UPDATE ... FROM, DELETE, DELETE ... USING and cascading deletes.
--
-- Everything runs in one transaction that is rolled back at the end, so the script
-- leaves the database as it found it and can be run as often as needed:
--
--   docker compose exec -T postgres psql -U cie -d cie -f /cie-db/queries/dml_operations.sql

BEGIN;

CREATE FUNCTION pg_temp.demo_repo() RETURNS bigint
LANGUAGE sql STABLE AS $$ SELECT repo_id FROM repository WHERE url = 'test://dml-demo' $$;

-- 1. INSERT a repository and read back the generated key and defaults
INSERT INTO repository (name, url)
VALUES ('dml-demo', 'test://dml-demo')
RETURNING repo_id, name, default_branch, added_date::date;

-- 2. Multi-row INSERT into FILE, a weak entity keyed by (repo_id, path)
INSERT INTO file (repo_id, path, language, loc, content_hash)
SELECT pg_temp.demo_repo(), v.path, v.language, v.loc, encode(sha256(convert_to(v.path, 'UTF8')), 'hex')
FROM (VALUES ('src/cart.ts',    'typescript', 40),
             ('src/tax.ts',     'typescript', 20),
             ('jobs/report.py', 'python',     15)) AS v (path, language, loc)
RETURNING repo_id, path, language, loc;

-- 3. INSERT ... SELECT: symbols, joined to the files they live in
INSERT INTO symbol (repo_id, path, name, kind, signature, start_line, end_line, is_entry_point)
SELECT f.repo_id, f.path, v.name, v.kind, v.signature, v.start_line, v.end_line, v.entry
FROM file f
JOIN (VALUES ('src/cart.ts',    'checkout',  'function', 'function checkout(cart)',         1, 15, true),
             ('src/cart.ts',    'cartTotal', 'function', 'function cartTotal(cart)',       17, 30, false),
             ('src/tax.ts',     'applyTax',  'function', 'function applyTax(amount, rate)', 1, 10, false),
             ('jobs/report.py', 'main',      'function', 'def main()',                      1, 15, true))
     AS v (path, name, kind, signature, start_line, end_line, entry)
  ON v.path = f.path
WHERE f.repo_id = pg_temp.demo_repo()
RETURNING symbol_id, path, name, start_line, end_line, is_entry_point;

-- 4. INSERT call edges by looking both ends up by name
INSERT INTO calls (caller_id, callee_id, call_line, resolution_confidence)
SELECT a.symbol_id, b.symbol_id, v.line, v.confidence
FROM (VALUES ('checkout',  'cartTotal',  5, 1.00),
             ('cartTotal', 'applyTax',  22, 0.90),
             ('main',      'checkout',   8, 0.60)) AS v (caller, callee, line, confidence)
JOIN symbol a ON a.name = v.caller AND a.repo_id = pg_temp.demo_repo()
JOIN symbol b ON b.name = v.callee AND b.repo_id = pg_temp.demo_repo()
RETURNING caller_id, callee_id, call_line, resolution_confidence;

-- 5. INSERT into the history tables: an author with two addresses, a commit, and the
--    symbols it changed
WITH new_author AS (
    INSERT INTO author (name, company) VALUES ('Demo Author', 'PES University')
    RETURNING author_id
), emails AS (
    INSERT INTO author_email (author_id, email)
    SELECT author_id, e FROM new_author, unnest(ARRAY['demo@example.com', 'demo@pes.edu']) AS e
    RETURNING author_id
), new_commit AS (
    INSERT INTO commit (repo_id, author_id, sha, message, committed_at)
    SELECT pg_temp.demo_repo(), author_id, substr(encode(sha256('dml-demo-1'), 'hex'), 1, 40),
           'Apply tax inside cartTotal', '2026-10-01 10:00:00+05:30'
    FROM new_author
    RETURNING commit_id
)
INSERT INTO modifies (commit_id, symbol_id, additions, deletions, change_type)
SELECT c.commit_id, s.symbol_id, v.additions, v.deletions, v.change_type
FROM new_commit c
CROSS JOIN (VALUES ('cartTotal', 6, 2, 'modified'),
                   ('applyTax', 10, 0, 'added')) AS v (name, additions, deletions, change_type)
JOIN symbol s ON s.name = v.name AND s.repo_id = pg_temp.demo_repo()
RETURNING commit_id, symbol_id, additions, deletions, change_type;

-- 6. UPSERT: adding the same URL again updates the row instead of failing, and keeps
--    its repo_id
INSERT INTO repository (name, url, default_branch)
VALUES ('dml-demo-renamed', 'test://dml-demo', 'develop')
ON CONFLICT ON CONSTRAINT repository_url_key
DO UPDATE SET name = EXCLUDED.name, default_branch = EXCLUDED.default_branch
RETURNING repo_id, name, default_branch, (repo_id = pg_temp.demo_repo()) AS same_repo_id;

-- 7. UPDATE with an expression and a filter
UPDATE file
SET loc = loc + 5
WHERE repo_id = pg_temp.demo_repo() AND language = 'typescript'
RETURNING path, loc;

-- 8. UPDATE ... FROM: halve the confidence of every call made from Python code
UPDATE calls c
SET resolution_confidence = round(c.resolution_confidence / 2, 2)
FROM symbol s
WHERE s.symbol_id = c.caller_id
  AND s.repo_id = pg_temp.demo_repo()
  AND s.path LIKE '%.py'
RETURNING s.name AS caller, c.call_line, c.resolution_confidence;

-- 9. UPDATE with a correlated subquery: a function that other code calls is not an
--    entry point, so clear the flag where some caller exists
UPDATE symbol s
SET is_entry_point = false
WHERE s.repo_id = pg_temp.demo_repo()
  AND s.is_entry_point
  AND EXISTS (SELECT 1 FROM calls c WHERE c.callee_id = s.symbol_id)
RETURNING s.name, s.is_entry_point;

-- 10. Constraints and triggers reject bad DML. Each attempt runs in its own block, so
--     a rejection does not abort the transaction.
DO $$
DECLARE
    v_repo bigint := pg_temp.demo_repo();
BEGIN
    BEGIN
        UPDATE symbol SET end_line = start_line - 1 WHERE repo_id = v_repo AND name = 'applyTax';
        RAISE NOTICE 'span CHECK: accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'span CHECK rejected: %', SQLERRM;
    END;

    BEGIN
        UPDATE symbol SET end_line = 500 WHERE repo_id = v_repo AND name = 'applyTax';
        RAISE NOTICE 'span trigger: accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'span trigger rejected: %', SQLERRM;
    END;

    BEGIN
        INSERT INTO file (repo_id, path, language, loc, content_hash)
        VALUES (v_repo, 'src/main.rs', 'rust', 10, repeat('a', 64));
        RAISE NOTICE 'language CHECK: accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'language CHECK rejected: %', SQLERRM;
    END;

    BEGIN
        INSERT INTO symbol (repo_id, path, name, kind, start_line, end_line)
        VALUES (v_repo, 'src/missing.ts', 'ghost', 'function', 1, 2);
        RAISE NOTICE 'foreign key: accepted';
    EXCEPTION WHEN foreign_key_violation THEN
        RAISE NOTICE 'foreign key rejected: %', SQLERRM;
    END;

    BEGIN
        INSERT INTO calls (caller_id, callee_id, call_line, resolution_confidence)
        SELECT symbol_id, symbol_id, 3, 1.5 FROM symbol WHERE repo_id = v_repo AND name = 'main';
        RAISE NOTICE 'confidence CHECK: accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'confidence CHECK rejected: %', SQLERRM;
    END;

    BEGIN
        INSERT INTO repository (name, url) VALUES ('copy', 'test://dml-demo');
        RAISE NOTICE 'unique URL: accepted';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'unique URL rejected: %', SQLERRM;
    END;
END $$;

-- 11. DELETE ... USING: drop low-confidence calls made from Python files
DELETE FROM calls c
USING symbol s
WHERE s.symbol_id = c.caller_id
  AND s.repo_id = pg_temp.demo_repo()
  AND c.resolution_confidence < 0.5
RETURNING c.caller_id, c.callee_id, c.resolution_confidence;

-- 12. Cascading DELETE: removing a file removes its symbols, and through them their
--     calls and history rows
SELECT 'before' AS stage,
       (SELECT count(*) FROM symbol   WHERE repo_id = pg_temp.demo_repo()) AS symbols,
       (SELECT count(*) FROM calls    c JOIN symbol s ON s.symbol_id = c.caller_id WHERE s.repo_id = pg_temp.demo_repo()) AS calls,
       (SELECT count(*) FROM modifies m JOIN symbol s USING (symbol_id) WHERE s.repo_id = pg_temp.demo_repo()) AS modifies;

DELETE FROM file
WHERE repo_id = pg_temp.demo_repo() AND path = 'src/tax.ts'
RETURNING path;

SELECT 'after deleting src/tax.ts' AS stage,
       (SELECT count(*) FROM symbol   WHERE repo_id = pg_temp.demo_repo()) AS symbols,
       (SELECT count(*) FROM calls    c JOIN symbol s ON s.symbol_id = c.caller_id WHERE s.repo_id = pg_temp.demo_repo()) AS calls,
       (SELECT count(*) FROM modifies m JOIN symbol s USING (symbol_id) WHERE s.repo_id = pg_temp.demo_repo()) AS modifies;

-- 13. DELETE the repository: every file, symbol, call, import and commit goes with it.
--     The author is not owned by a repository and stays.
DELETE FROM repository WHERE repo_id = pg_temp.demo_repo() RETURNING repo_id, name;

SELECT (SELECT count(*) FROM file   WHERE repo_id NOT IN (SELECT repo_id FROM repository)) AS orphan_files,
       (SELECT count(*) FROM commit WHERE repo_id NOT IN (SELECT repo_id FROM repository)) AS orphan_commits,
       (SELECT count(*) FROM author WHERE name = 'Demo Author') AS author_kept;

ROLLBACK;

-- SQL queries grouped by kind: joins, nested subqueries, correlated subqueries,
-- recursive queries, set operations, and aggregation with window functions.
-- All of them run against the seed repository (`npm run seed` and `npm run history --
-- seed-repo` in ingest/) and only read data.
--
--   docker compose exec -T postgres psql -U cie -d cie -f /cie-db/queries/query_types.sql

------------------------------------------------------------------------------------------
-- A. Joins
------------------------------------------------------------------------------------------

-- A1. Inner join with a self join: every call edge with both ends named. SYMBOL is
--     joined twice, once as caller and once as callee.
SELECT caller.name AS caller, callee.name AS callee, callee.path AS callee_file,
       c.call_line, c.resolution_confidence
FROM calls c
JOIN symbol caller ON caller.symbol_id = c.caller_id
JOIN symbol callee ON callee.symbol_id = c.callee_id
JOIN repository r  ON r.repo_id = caller.repo_id
WHERE r.name = 'seed-repo' AND callee.path LIKE 'src/orders/%'
ORDER BY caller.name, c.call_line;

-- A2. Left outer join: every file with its symbol count, including files that declare
--     nothing (an empty __init__.py has no symbols at all)
SELECT f.path, f.language, f.loc, count(s.symbol_id) AS symbols
FROM file f
LEFT JOIN symbol s ON s.repo_id = f.repo_id AND s.path = f.path AND s.kind <> 'module'
WHERE f.repo_id = (SELECT repo_id FROM repository WHERE name = 'seed-repo')
GROUP BY f.path, f.language, f.loc
ORDER BY symbols, f.path
LIMIT 6;

-- A3. Full outer join: how many files each file imports and how many import it. A file
--     that only imports, or is only imported, still gets a row.
WITH outgoing AS (
    SELECT importer_repo_id AS repo_id, importer_path AS path, count(*) AS imports_out
    FROM imports GROUP BY 1, 2
), incoming AS (
    SELECT imported_repo_id AS repo_id, imported_path AS path, count(*) AS imported_by
    FROM imports GROUP BY 1, 2
)
SELECT coalesce(o.path, i.path) AS path,
       coalesce(o.imports_out, 0) AS imports_out,
       coalesce(i.imported_by, 0) AS imported_by
FROM outgoing o
FULL OUTER JOIN incoming i ON i.repo_id = o.repo_id AND i.path = o.path
ORDER BY imported_by DESC, imports_out DESC, path;

-- A4. Self join on SYMBOL: names declared in more than one file
SELECT a.name, a.kind, a.path AS first_file, b.path AS second_file
FROM symbol a
JOIN symbol b ON b.repo_id = a.repo_id AND b.name = a.name AND b.path > a.path
WHERE a.kind <> 'module'
ORDER BY a.name;

-- A5. Join with USING across the history tables: who changed which symbols, newest first
SELECT a.name AS author, substr(c.sha, 1, 8) AS sha, s.name AS symbol, m.change_type,
       m.additions, m.deletions
FROM commit c
JOIN author a   USING (author_id)
JOIN modifies m USING (commit_id)
JOIN symbol s   USING (symbol_id)
ORDER BY c.committed_at DESC, s.name
LIMIT 8;

------------------------------------------------------------------------------------------
-- B. Nested (uncorrelated) subqueries
------------------------------------------------------------------------------------------

-- B1. IN with a subquery: symbols declared in files that two or more files import
SELECT s.name, s.kind, s.path
FROM symbol s
WHERE s.kind <> 'module'
  AND (s.repo_id, s.path) IN (SELECT imported_repo_id, imported_path
                              FROM imports
                              GROUP BY imported_repo_id, imported_path
                              HAVING count(*) >= 2)
ORDER BY s.path, s.start_line;

-- B2. Scalar subqueries in WHERE and SELECT: files longer than the average file
SELECT f.path, f.loc,
       (SELECT round(avg(loc), 1) FROM file) AS avg_loc
FROM file f
WHERE f.loc > (SELECT avg(loc) FROM file)
ORDER BY f.loc DESC;

-- B3. Subquery in FROM (derived table): average fan-in per symbol kind
SELECT kind, count(*) AS symbols, round(avg(callers), 2) AS avg_callers, max(callers) AS max_callers
FROM (
    SELECT s.kind, count(c.caller_id) AS callers
    FROM symbol s
    LEFT JOIN calls c ON c.callee_id = s.symbol_id
    GROUP BY s.symbol_id, s.kind
) per_symbol
GROUP BY kind
ORDER BY avg_callers DESC;

-- B4. > ALL: functions longer than every method in the repository
SELECT s.name, s.path, s.end_line - s.start_line + 1 AS length
FROM symbol s
WHERE s.kind = 'function'
  AND s.end_line - s.start_line + 1 > ALL (SELECT end_line - start_line + 1 FROM symbol WHERE kind = 'method')
ORDER BY length DESC;

-- B5. = ANY: commits by authors who also touched Python code
SELECT substr(c.sha, 1, 8) AS sha, a.name AS author, c.message
FROM commit c
JOIN author a USING (author_id)
WHERE c.author_id = ANY (SELECT c2.author_id
                         FROM commit c2
                         JOIN modifies m USING (commit_id)
                         JOIN symbol s USING (symbol_id)
                         WHERE s.path LIKE '%.py')
ORDER BY c.committed_at;

------------------------------------------------------------------------------------------
-- C. Correlated subqueries
------------------------------------------------------------------------------------------

-- C1. NOT EXISTS: functions and methods that nothing calls and that are not entry
--     points. These are dead-code candidates.
SELECT s.name, s.kind, s.path
FROM symbol s
WHERE s.kind IN ('function', 'method')
  AND NOT s.is_entry_point
  AND NOT EXISTS (SELECT 1 FROM calls c WHERE c.callee_id = s.symbol_id)
ORDER BY s.path, s.start_line;

-- C2. Correlated scalar subquery: symbols longer than the average symbol in their own file
SELECT s.name, s.path, s.end_line - s.start_line + 1 AS length,
       (SELECT round(avg(t.end_line - t.start_line + 1), 1)
          FROM symbol t
         WHERE t.repo_id = s.repo_id AND t.path = s.path AND t.kind <> 'module') AS file_avg
FROM symbol s
WHERE s.kind <> 'module'
  AND s.end_line - s.start_line + 1 > (SELECT avg(t.end_line - t.start_line + 1)
                                         FROM symbol t
                                        WHERE t.repo_id = s.repo_id AND t.path = s.path AND t.kind <> 'module')
ORDER BY s.path, s.start_line;

-- C3. Correlated subquery in SELECT: each author's most recent commit message
SELECT a.name,
       (SELECT c.message FROM commit c WHERE c.author_id = a.author_id
         ORDER BY c.committed_at DESC LIMIT 1) AS latest_message,
       (SELECT count(*) FROM commit c WHERE c.author_id = a.author_id) AS commits
FROM author a
ORDER BY commits DESC, a.name;

-- C4. Relational division with a double NOT EXISTS: authors who changed every file
--     under src/orders/. "There is no such file that this author did not change."
SELECT a.name
FROM author a
WHERE NOT EXISTS (
    SELECT 1 FROM file f
    WHERE f.path LIKE 'src/orders/%'
      AND NOT EXISTS (
          SELECT 1
          FROM modifies m
          JOIN commit c ON c.commit_id = m.commit_id
          JOIN symbol s ON s.symbol_id = m.symbol_id
          WHERE c.author_id = a.author_id AND s.repo_id = f.repo_id AND s.path = f.path))
ORDER BY a.name;

------------------------------------------------------------------------------------------
-- D. Recursive queries
------------------------------------------------------------------------------------------

-- D1. Transitive imports: every file the orders API route depends on, directly or
--     through other files, with the shortest import chain to it
WITH RECURSIVE deps (repo_id, path, depth, chain) AS (
    SELECT f.repo_id, f.path, 0, ARRAY[f.path]
    FROM file f
    WHERE f.path = 'src/app/api/orders/route.ts'
    UNION ALL
    SELECT i.imported_repo_id, i.imported_path, d.depth + 1, d.chain || i.imported_path
    FROM deps d
    JOIN imports i ON i.importer_repo_id = d.repo_id AND i.importer_path = d.path
    WHERE NOT i.imported_path = ANY (d.chain)
)
SELECT DISTINCT ON (path) path, depth, array_to_string(chain, ' -> ') AS import_chain
FROM deps
WHERE depth > 0
ORDER BY path, depth;

-- D2. Downstream call tree from the POST route handler: everything it ends up running.
--     parseAddress and normalizeAddress call each other, so the CYCLE clause stops the
--     recursion when a symbol repeats on the current path.
WITH RECURSIVE tree (sid, depth) AS (
    SELECT s.symbol_id, 0
    FROM symbol s
    WHERE s.name = 'POST' AND s.path = 'src/app/api/orders/route.ts'
    UNION ALL
    SELECT c.callee_id, t.depth + 1
    FROM tree t
    JOIN calls c ON c.caller_id = t.sid
) CYCLE sid SET is_cycle USING visited
SELECT repeat('    ', t.depth) || s.name AS call_tree, s.path, t.is_cycle
FROM tree t
JOIN symbol s ON s.symbol_id = t.sid
ORDER BY t.visited;

-- D3. Upstream impact through the stored function impact_of, whose body is a recursive
--     CTE over CALLS: what is affected if roundCurrency changes?
SELECT i.depth, i.name, i.kind, i.path, i.is_entry_point, i.min_confidence
FROM symbol t
CROSS JOIN LATERAL impact_of(t.symbol_id, 5) AS i
WHERE t.name = 'roundCurrency'
ORDER BY i.depth, i.name;

------------------------------------------------------------------------------------------
-- E. Set operations
------------------------------------------------------------------------------------------

-- E1. INTERSECT: symbols that are both hotspots (changed in 2+ commits) and on the
--     impact path of roundCurrency
SELECT h.name, h.path FROM v_symbol_hotspot h
INTERSECT
SELECT i.name, i.path FROM symbol t CROSS JOIN LATERAL impact_of(t.symbol_id, 5) AS i WHERE t.name = 'roundCurrency'
ORDER BY name;

-- E2. EXCEPT: functions and methods that no commit has ever modified since they were added
SELECT s.name, s.path FROM symbol s WHERE s.kind IN ('function', 'method')
EXCEPT
SELECT s.name, s.path FROM symbol s JOIN modifies m USING (symbol_id) WHERE m.change_type = 'modified'
ORDER BY path, name;

-- E3. UNION: one list of every place a symbol name appears, as a caller or as a callee
SELECT s.name, 'caller' AS role FROM calls c JOIN symbol s ON s.symbol_id = c.caller_id WHERE s.path LIKE 'src/orders/%'
UNION
SELECT s.name, 'callee' FROM calls c JOIN symbol s ON s.symbol_id = c.callee_id WHERE s.path LIKE 'src/orders/%'
ORDER BY name, role;

------------------------------------------------------------------------------------------
-- F. Aggregation, HAVING and window functions
------------------------------------------------------------------------------------------

-- F1. GROUP BY with HAVING and a window rank: authors ranked by lines changed, keeping
--     only authors with more than one commit
SELECT a.name,
       count(DISTINCT c.commit_id) AS commits,
       sum(m.additions + m.deletions) AS churn,
       rank() OVER (ORDER BY sum(m.additions + m.deletions) DESC) AS churn_rank,
       round(100.0 * sum(m.additions + m.deletions) / sum(sum(m.additions + m.deletions)) OVER (), 1) AS pct
FROM author a
JOIN commit c   ON c.author_id = a.author_id
JOIN modifies m ON m.commit_id = c.commit_id
GROUP BY a.author_id, a.name
HAVING count(DISTINCT c.commit_id) > 1
ORDER BY churn_rank;

-- F2. Running total with a window frame: cumulative lines changed over time
SELECT c.committed_at::date AS day, substr(c.sha, 1, 8) AS sha,
       sum(m.additions + m.deletions) AS churn,
       sum(sum(m.additions + m.deletions)) OVER (ORDER BY c.committed_at, c.commit_id) AS running_churn
FROM commit c
JOIN modifies m USING (commit_id)
GROUP BY c.commit_id, c.committed_at, c.sha
ORDER BY c.committed_at, c.commit_id;

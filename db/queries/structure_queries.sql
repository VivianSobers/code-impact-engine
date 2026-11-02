SELECT i.depth,
       i.name,
       i.kind,
       i.path,
       i.is_entry_point,
       i.min_confidence,
       (SELECT string_agg(s.name, ' -> ' ORDER BY p.ord)
          FROM unnest(i.call_path) WITH ORDINALITY AS p (id, ord)
          JOIN symbol s ON s.symbol_id = p.id) AS call_path
FROM symbol t
CROSS JOIN LATERAL impact_of(t.symbol_id, 5) AS i
WHERE t.repo_id = (SELECT repo_id FROM repository WHERE name = 'seed-repo')
  AND t.name = 'roundCurrency'
ORDER BY i.depth, i.path, i.name;

SELECT r.name AS repo,
       t.name AS target,
       count(*) AS affected,
       count(DISTINCT i.path) AS files,
       count(*) FILTER (WHERE i.is_entry_point) AS entry_points,
       max(i.depth) AS deepest
FROM symbol t
JOIN repository r ON r.repo_id = t.repo_id
CROSS JOIN LATERAL impact_of(t.symbol_id, 5) AS i
WHERE (r.name, t.name, t.kind) IN (('seed-repo', 'roundCurrency', 'function'),
                                   ('requests', 'to_native_string', 'function'),
                                   ('express', 'setCharset', 'function'))
GROUP BY r.name, t.symbol_id, t.name
ORDER BY affected DESC;

WITH RECURSIVE target AS (
    SELECT symbol_id
    FROM symbol
    WHERE repo_id = (SELECT repo_id FROM repository WHERE name = 'seed-repo')
      AND name = 'priceOrder'
),
up (sid, lvl) AS (
    SELECT symbol_id, 0 FROM target
    UNION
    SELECT c.caller_id, u.lvl + 1 FROM up u JOIN calls c ON c.callee_id = u.sid WHERE u.lvl < 2
),
down (sid, lvl) AS (
    SELECT symbol_id, 0 FROM target
    UNION
    SELECT c.callee_id, d.lvl + 1 FROM down d JOIN calls c ON c.caller_id = d.sid WHERE d.lvl < 2
),
reach AS (
    SELECT sid, -min(lvl) AS col FROM up GROUP BY sid
    UNION ALL
    SELECT sid, min(lvl) AS col FROM down GROUP BY sid
),
placed AS (
    SELECT DISTINCT ON (sid) sid, col
    FROM reach
    ORDER BY sid, abs(col), col
)
SELECT p.col AS column_offset, s.name, s.kind, s.path
FROM placed p
JOIN symbol s ON s.symbol_id = p.sid
ORDER BY p.col, s.name;

SELECT r.name AS repo, q.name, q.kind, q.path, round(q.rank::numeric, 3) AS rank
FROM search_symbols('parse', NULL, 6) AS q
JOIN repository r ON r.repo_id = q.repo_id
ORDER BY q.rank DESC, q.name;

SELECT r.name AS repo, q.name, q.kind, q.signature, round(q.rank::numeric, 3) AS rank
FROM search_symbols('content type', NULL, 5) AS q
JOIN repository r ON r.repo_id = q.repo_id
ORDER BY q.rank DESC, q.name;

SELECT r.name AS repo, q.name, q.kind, q.signature, round(q.rank::numeric, 3) AS rank
FROM search_symbols('get adapter', (SELECT repo_id FROM repository WHERE name = 'requests'), 3) AS q
JOIN repository r ON r.repo_id = q.repo_id
ORDER BY q.rank DESC, q.name;

SELECT r.name AS repo,
       s.name,
       s.kind,
       s.path,
       count(*) AS call_sites,
       count(DISTINCT c.caller_id) AS distinct_callers,
       round(avg(c.resolution_confidence), 2) AS avg_confidence
FROM calls c
JOIN symbol s ON s.symbol_id = c.callee_id
JOIN repository r ON r.repo_id = s.repo_id
WHERE s.kind <> 'module'
GROUP BY r.name, s.symbol_id, s.name, s.kind, s.path
HAVING count(DISTINCT c.caller_id) >= 15
ORDER BY distinct_callers DESC, call_sites DESC
LIMIT 10;

SELECT repo, path, language, loc, symbols, rank_in_repo
FROM (
    SELECT r.name AS repo,
           f.path,
           f.language,
           f.loc,
           count(s.symbol_id) AS symbols,
           rank() OVER (PARTITION BY f.repo_id ORDER BY count(s.symbol_id) DESC, f.loc DESC) AS rank_in_repo
    FROM file f
    JOIN repository r ON r.repo_id = f.repo_id
    LEFT JOIN symbol s ON s.repo_id = f.repo_id AND s.path = f.path AND s.kind <> 'module'
    GROUP BY r.name, f.repo_id, f.path, f.language, f.loc
) ranked
WHERE rank_in_repo <= 3
ORDER BY repo, rank_in_repo;

SELECT r.name AS repo,
       f.language,
       count(*) AS files,
       sum(f.loc) AS loc,
       round(100.0 * sum(f.loc) / sum(sum(f.loc)) OVER (PARTITION BY r.repo_id), 1) AS pct_of_repo_loc
FROM file f
JOIN repository r ON r.repo_id = f.repo_id
GROUP BY r.repo_id, r.name, f.language
ORDER BY r.name, loc DESC;

SELECT r.name AS repo, i.imported_path, count(*) AS imported_by
FROM imports i
JOIN repository r ON r.repo_id = i.imported_repo_id
GROUP BY r.name, i.imported_repo_id, i.imported_path
HAVING count(*) >= 3
ORDER BY imported_by DESC, repo, i.imported_path
LIMIT 10;

SELECT r.name AS repo,
       count(*) AS files,
       count(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM imports i
           WHERE i.imported_repo_id = f.repo_id AND i.imported_path = f.path)) AS never_imported,
       count(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM imports i
           WHERE i.imported_repo_id = f.repo_id AND i.imported_path = f.path)
         AND NOT EXISTS (
           SELECT 1 FROM imports i
           WHERE i.importer_repo_id = f.repo_id AND i.importer_path = f.path)) AS isolated
FROM file f
JOIN repository r ON r.repo_id = f.repo_id
GROUP BY r.name
ORDER BY r.name;

SELECT f.path, f.language, f.loc
FROM file f
WHERE f.repo_id = (SELECT repo_id FROM repository WHERE name = 'seed-repo')
  AND NOT EXISTS (
      SELECT 1 FROM imports i
      WHERE i.imported_repo_id = f.repo_id AND i.imported_path = f.path)
ORDER BY f.path;

SELECT r.name AS repo,
       count(*) FILTER (WHERE s.is_entry_point) AS entry_points,
       count(*) FILTER (WHERE s.is_entry_point AND s.kind = 'module') AS entry_modules,
       count(*) FILTER (WHERE s.is_entry_point AND s.kind IN ('function', 'method')) AS entry_functions,
       count(*) FILTER (WHERE s.is_entry_point AND s.kind = 'class') AS entry_classes,
       count(*) AS symbols
FROM symbol s
JOIN repository r ON r.repo_id = s.repo_id
GROUP BY r.name
ORDER BY r.name;

SELECT s.name, s.kind, s.path, s.signature
FROM symbol s
WHERE s.repo_id = (SELECT repo_id FROM repository WHERE name = 'seed-repo')
  AND s.is_entry_point
  AND s.kind <> 'module'
ORDER BY s.path, s.start_line;

SELECT r.name AS repo,
       b.label AS confidence_band,
       count(*) AS calls,
       round(100.0 * count(*) / sum(count(*)) OVER (PARTITION BY r.name), 1) AS pct
FROM calls c
JOIN symbol s ON s.symbol_id = c.caller_id
JOIN repository r ON r.repo_id = s.repo_id
JOIN (VALUES (1, 0.95, 1.01, '0.95 to 1.00'),
             (2, 0.80, 0.95, '0.80 to 0.94'),
             (3, 0.50, 0.80, '0.50 to 0.79'),
             (4, 0.00, 0.50, 'below 0.50')) AS b (ord, lo, hi, label)
  ON c.resolution_confidence >= b.lo AND c.resolution_confidence < b.hi
GROUP BY r.name, b.ord, b.label
ORDER BY r.name, b.ord;

DO $$
DECLARE
    v_repo bigint := (SELECT repo_id FROM repository WHERE name = 'seed-repo');
BEGIN
    INSERT INTO symbol (repo_id, path, name, kind, start_line, end_line)
    VALUES (v_repo, 'src/lib/money.ts', 'pastTheEnd', 'function', 1, 10000);
    RAISE NOTICE 'insert was accepted';
EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'rejected: %', SQLERRM;
END;
$$;

DO $$
DECLARE
    v_repo bigint := (SELECT repo_id FROM repository WHERE name = 'seed-repo');
BEGIN
    UPDATE file SET loc = 1 WHERE repo_id = v_repo AND path = 'src/lib/money.ts';
    RAISE NOTICE 'update was accepted';
EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'rejected: %', SQLERRM;
END;
$$;

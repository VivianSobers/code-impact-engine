# Code structure queries

These are the main queries behind the code structure features: impact analysis, call graphs, symbol search, file and import statistics, and the stored ASTs.

The output comes from a scratch database holding four ingested repositories: the seed repo, [psf/requests](https://github.com/psf/requests), [expressjs/express](https://github.com/expressjs/express) and [sindresorhus/slugify](https://github.com/sindresorhus/slugify). Long results are cut to a few rows. Exact numbers will change as those projects change.

The SQL is in [db/queries/structure_queries.sql](../db/queries/structure_queries.sql), in the same order as this document. To run it against a database that holds the same repositories:

```sh
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < db/queries/structure_queries.sql
```

| # | Query | Database features |
|---|-------|-------------------|
| 1 | Impact of changing a symbol | Recursive CTE, LATERAL join, set-returning function |
| 2 | Impact summary across repositories | FILTER aggregate, GROUP BY, LATERAL join |
| 3 | Bidirectional call graph | Two recursive CTEs, DISTINCT ON |
| 4 | Symbol search | GIN index, full text ranking |
| 5 | Most-called symbols | GROUP BY, HAVING |
| 6 | Files ranked by symbols | Window function, composite FK join |
| 7 | Lines of code per language | Window function over an aggregate |
| 8 | Most imported files | Composite FK, GROUP BY, HAVING |
| 9 | Files nothing imports | NOT EXISTS anti-join |
| 10 | Entry points per repository | FILTER aggregate, partial index |
| 11 | Call confidence distribution | Range join on VALUES, window function |
| 12 | Trigger rejections | Triggers, exception handling |
| 13 | AST node types per language | Aggregation pipeline, $unwind, $group, $topN |
| 14 | Deepest nesting per file | Aggregation pipeline, compound index, $reduce |
| 15 | AST summary | Aggregation pipeline, $facet |

## 1. Impact of changing a symbol

If `roundCurrency` changes, what could break? `impact_of` walks the `calls` table backwards from the target and returns every symbol that reaches it, with the shortest distance, the weakest confidence along the path, and the path itself. The outer query turns the array of ids in `call_path` back into names.

Database features: recursive CTE (inside `impact_of`), LATERAL join against a set-returning function, `unnest WITH ORDINALITY` to keep the path in order.

```sql
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
```

```text
 depth |     name      |   kind   |            path             | is_entry_point | min_confidence |                   call_path
-------+---------------+----------+-----------------------------+----------------+----------------+------------------------------------------------
     1 | formatMoney   | function | src/lib/money.ts            | f              |           1.00 | formatMoney -> roundCurrency
     1 | applyDiscount | function | src/orders/pricing.ts       | f              |           0.90 | applyDiscount -> roundCurrency
     2 | priceOrder    | function | src/orders/pricing.ts       | f              |           0.90 | priceOrder -> applyDiscount -> roundCurrency
     2 | create        | method   | src/orders/service.ts       | f              |           0.90 | create -> formatMoney -> roundCurrency
     3 | POST          | function | src/app/api/orders/route.ts | t              |           0.85 | POST -> create -> formatMoney -> roundCurrency
(5 rows)
```

`POST` also reaches `roundCurrency` through `priceOrder`, but that route is four calls long. The function reports the shorter route through `formatMoney`, so `POST` appears at depth 3.

## 2. Impact summary across repositories

This is the summary the impact page shows at the top, run for one symbol in each repository: how many symbols are affected, across how many files, and how many are entry points.

Database features: LATERAL join, `count(*) FILTER`, `count(DISTINCT ...)`, multi-column `IN`.

```sql
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
```

```text
   repo    |      target      | affected | files | entry_points | deepest
-----------+------------------+----------+-------+--------------+---------
 requests  | to_native_string |      174 |    14 |           15 |       5
 express   | setCharset       |      111 |    82 |           70 |       3
 seed-repo | roundCurrency    |        5 |     4 |            1 |       3
(3 rows)
```

## 3. Bidirectional call graph

The call graph page draws callers to the left of a symbol and callees to the right. This is the query from [lib/structure/graph.ts](../lib/structure/graph.ts). One recursive CTE walks up through callers and another walks down through callees. Negative offsets are callers and positive offsets are callees.

The app passes the symbol id and depth as parameters and picks the closest column for each symbol in TypeScript. This version fixes both values and does that last step in SQL with `DISTINCT ON`, so it runs on its own.

Database features: two recursive CTEs in one statement, `UNION` for cycle safety, `DISTINCT ON`.

```sql
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
```

```text
 column_offset |     name      |   kind   |            path
---------------+---------------+----------+-----------------------------
            -2 | POST          | function | src/app/api/orders/route.ts
            -1 | create        | method   | src/orders/service.ts
             0 | priceOrder    | function | src/orders/pricing.ts
             1 | applyDiscount | function | src/orders/pricing.ts
             1 | subtotal      | function | src/orders/pricing.ts
             2 | roundCurrency | function | src/lib/money.ts
(6 rows)
```

## 4. Symbol search

`search_symbols` looks up symbols by name or signature. Names are split on camelCase, PascalCase and snake_case before indexing, so `parse` finds `parseAddress` and `parse_dict_header`, and `content type` finds `_parse_content_type_header`. Name matches carry more weight than signature matches, and an optional repository id narrows the search.

Database features: stored generated `tsvector` column, GIN index, weighted ranking.

All repositories, one word:

```sql
SELECT r.name AS repo, q.name, q.kind, q.path, round(q.rank::numeric, 3) AS rank
FROM search_symbols('parse', NULL, 6) AS q
JOIN repository r ON r.repo_id = q.repo_id
ORDER BY q.rank DESC, q.name;
```

```text
   repo    |           name           |   kind   |         path          | rank
-----------+--------------------------+----------+-----------------------+-------
 seed-repo | parseAddress             | function | src/orders/address.ts | 1.277
 express   | parseError               | function | test/express.json.js  | 1.277
 express   | parseExtendedQueryString | function | lib/utils.js          | 1.277
 requests  | parse_dict_header        | function | src/requests/utils.py | 0.787
 requests  | parse_header_links       | function | src/requests/utils.py | 0.787
 requests  | parse_list_header        | function | src/requests/utils.py | 0.787
(6 rows)
```

Two words, where the express row matches through its signature:

```sql
SELECT r.name AS repo, q.name, q.kind, q.signature, round(q.rank::numeric, 3) AS rank
FROM search_symbols('content type', NULL, 5) AS q
JOIN repository r ON r.repo_id = q.repo_id
ORDER BY q.rank DESC, q.name;
```

```text
   repo   |                  name                   |   kind   |                                 signature                                 | rank
----------+-----------------------------------------+----------+---------------------------------------------------------------------------+-------
 requests | _parse_content_type_header              | function | def _parse_content_type_header(header: str) -> tuple[str, dict[str, Any]] | 1.000
 requests | test_custom_content_type                | method   | def test_custom_content_type(self, httpbin)                               | 1.000
 requests | test__parse_content_type_header         | function | def test__parse_content_type_header(value, expected)                      | 1.000
 requests | test_json_param_post_content_type_works | method   | def test_json_param_post_content_type_works(self, httpbin)                | 1.000
 express  | type                                    | method   | res.type = function contentType(type)                                     | 0.963
(5 rows)
```

One repository:

```sql
SELECT r.name AS repo, q.name, q.kind, q.signature, round(q.rank::numeric, 3) AS rank
FROM search_symbols('get adapter', (SELECT repo_id FROM repository WHERE name = 'requests'), 3) AS q
JOIN repository r ON r.repo_id = q.repo_id
ORDER BY q.rank DESC, q.name;
```

```text
   repo   |                        name                         |  kind  |                           signature                           | rank
----------+-----------------------------------------------------+--------+---------------------------------------------------------------+-------
 requests | get_adapter                                         | method | def get_adapter(self, url: str) -> BaseAdapter                | 1.000
 requests | test_session_get_adapter_prefix_matching            | method | def test_session_get_adapter_prefix_matching(self)            | 1.000
 requests | test_session_get_adapter_prefix_matching_mixed_case | method | def test_session_get_adapter_prefix_matching_mixed_case(self) | 1.000
(3 rows)
```

## 5. Most-called symbols

Fan-in shows which symbols the most code depends on. `HAVING` keeps symbols with at least 15 distinct callers.

Database features: GROUP BY, HAVING, `count(DISTINCT ...)`, `avg`.

```sql
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
```

```text
   repo   |  name   |   kind   |           path           | call_sites | distinct_callers | avg_confidence
----------+---------+----------+--------------------------+------------+------------------+----------------
 requests | httpbin | function | tests/conftest.py        |        155 |              137 |           0.60
 express  | get     | method   | lib/response.js          |       1046 |              124 |           0.41
 express  | send    | method   | lib/response.js          |        409 |               85 |           0.64
 express  | use     | method   | lib/application.js       |        669 |               81 |           0.75
 express  | set     | method   | lib/application.js       |        627 |               77 |           0.49
 requests | get     | function | src/requests/api.py      |         84 |               69 |           0.90
(10 rows, first 6 shown)
```

Read `avg_confidence` alongside the counts. Express `get` averages 0.41 because a call like `.get('/')` on an untyped object can only be matched by method name, so many of those 1,046 call sites may not be this method at all.

## 6. Files ranked by symbols

The top three files in each repository by number of declared symbols, with lines of code as the tie-break. `module` symbols are left out because every non-empty file has one.

Database features: `rank()` window function with `PARTITION BY`, LEFT JOIN on the composite foreign key `(repo_id, path)` from `symbol` to `file`.

```sql
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
```

```text
   repo    |              path              |  language  | loc  | symbols | rank_in_repo
-----------+--------------------------------+------------+------+---------+--------------
 express   | lib/response.js                | javascript | 1050 |      29 |            1
 express   | test/app.use.js                | javascript |  542 |      27 |            2
 express   | lib/application.js             | javascript |  631 |      18 |            3
 requests  | tests/test_requests.py         | python     | 3094 |     301 |            1
 requests  | tests/test_utils.py            | python     | 1013 |      97 |            2
 requests  | src/requests/models.py         | python     | 1184 |      57 |            3
 seed-repo | analytics/stats.py             | python     |   26 |       6 |            1
(12 rows, first 7 shown)
```

## 7. Lines of code per language

Each language's share of a repository, as files, lines and a percentage.

Database features: window function over an aggregate (`sum(sum(f.loc)) OVER (...)`).

```sql
SELECT r.name AS repo,
       f.language,
       count(*) AS files,
       sum(f.loc) AS loc,
       round(100.0 * sum(f.loc) / sum(sum(f.loc)) OVER (PARTITION BY r.repo_id), 1) AS pct_of_repo_loc
FROM file f
JOIN repository r ON r.repo_id = f.repo_id
GROUP BY r.repo_id, r.name, f.language
ORDER BY r.name, loc DESC;
```

```text
   repo    |  language  | files |  loc  | pct_of_repo_loc
-----------+------------+-------+-------+-----------------
 express   | javascript |   142 | 22046 |           100.0
 requests  | python     |    37 | 12032 |           100.0
 seed-repo | typescript |     6 |    94 |            40.2
 seed-repo | python     |     4 |    52 |            22.2
 seed-repo | go         |     2 |    48 |            20.5
 seed-repo | java       |     2 |    25 |            10.7
 seed-repo | javascript |     2 |    15 |             6.4
 slugify   | javascript |     3 |   534 |           100.0
(8 rows)
```

## 8. Most imported files

Heavily imported files affect the most code when they change. The result lists the files imported by at least three others.

Database features: GROUP BY and HAVING over the imported side of `imports`, which is a composite foreign key to `file`. `imports_imported_idx` covers that side.

```sql
SELECT r.name AS repo, i.imported_path, count(*) AS imported_by
FROM imports i
JOIN repository r ON r.repo_id = i.imported_repo_id
GROUP BY r.name, i.imported_repo_id, i.imported_path
HAVING count(*) >= 3
ORDER BY imported_by DESC, repo, i.imported_path
LIMIT 10;
```

```text
   repo   |       imported_path        | imported_by
----------+----------------------------+-------------
 requests | src/requests/compat.py     |          14
 requests | src/requests/__init__.py   |          14
 requests | src/requests/models.py     |          11
 express  | test/support/utils.js      |          10
 requests | src/requests/structures.py |           9
(10 rows, first 5 shown)
```

## 9. Files nothing imports

A file nothing imports is either a starting point, such as a script or test, or possibly dead code. The first query counts these per repository. `isolated` files also import nothing themselves. The second query lists the seed repo's files.

Database features: `NOT EXISTS` anti-join, `count(*) FILTER`.

```sql
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
```

```text
   repo    | files | never_imported | isolated
-----------+-------+----------------+----------
 express   |   142 |            106 |       65
 requests  |    37 |             14 |        3
 seed-repo |    16 |              7 |        3
 slugify   |     3 |              1 |        0
(4 rows)
```

```sql
SELECT f.path, f.language, f.loc
FROM file f
WHERE f.repo_id = (SELECT repo_id FROM repository WHERE name = 'seed-repo')
  AND NOT EXISTS (
      SELECT 1 FROM imports i
      WHERE i.imported_repo_id = f.repo_id AND i.imported_path = f.path)
ORDER BY f.path;
```

```text
                   path                    |  language  | loc
-------------------------------------------+------------+-----
 analytics/__init__.py                     | python     |   0
 java/src/com/acme/billing/InvoiceApp.java | java       |   8
 java/src/com/acme/billing/Invoice.java    | java       |  17
 scripts/daily_report.py                   | python     |  15
 src/app/api/orders/route.ts               | typescript |  15
 src/legacy/csv.js                         | javascript |   7
 tools/stock/main.go                       | go         |  24
(7 rows)
```

In express, 105 of the 106 never-imported files are in `test/` or `examples/`, which run directly.

## 10. Entry points per repository

Entry points are where execution starts: `main` functions, scripts, Next.js route handlers, and exported code nothing calls. The first query counts them by kind. The second lists the seed repo's entry points, leaving out `module` symbols. `symbol_entry_point_idx` is a partial index on these rows.

Database features: `count(*) FILTER`, partial index.

```sql
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
```

```text
   repo    | entry_points | entry_modules | entry_functions | entry_classes | symbols
-----------+--------------+---------------+-----------------+---------------+---------
 express   |          121 |            98 |              23 |             0 |     376
 requests  |          120 |             9 |              70 |            41 |     843
 seed-repo |            8 |             2 |               5 |             1 |      57
 slugify   |            1 |             1 |               0 |             0 |      11
(4 rows)
```

```sql
SELECT s.name, s.kind, s.path, s.signature
FROM symbol s
WHERE s.repo_id = (SELECT repo_id FROM repository WHERE name = 'seed-repo')
  AND s.is_entry_point
  AND s.kind <> 'module'
ORDER BY s.path, s.start_line;
```

```text
    name    |   kind   |                   path                    |                        signature
------------+----------+-------------------------------------------+----------------------------------------------------------
 InvoiceApp | class    | java/src/com/acme/billing/InvoiceApp.java | public class InvoiceApp
 main       | method   | java/src/com/acme/billing/InvoiceApp.java | public static void main(String[] args)
 GET        | function | src/app/api/orders/route.ts               | async function GET(request: Request): Promise<Response>
 POST       | function | src/app/api/orders/route.ts               | async function POST(request: Request): Promise<Response>
 toCsv      | function | src/legacy/csv.js                         | function toCsv(rows)
 main       | function | tools/stock/main.go                       | func main()
(6 rows)
```

## 11. Call confidence distribution

Calls are resolved from names, so each one stores a confidence between 0 and 1. This query shows how much of each repository's call graph is reliable.

Database features: range join against an inline `VALUES` table, window function for the percentage.

```sql
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
```

```text
   repo    | confidence_band | calls | pct
-----------+-----------------+-------+------
 express   | 0.95 to 1.00    |   354 |  8.2
 express   | 0.80 to 0.94    |  1652 | 38.4
 express   | 0.50 to 0.79    |    10 |  0.2
 express   | below 0.50      |  2281 | 53.1
 requests  | 0.95 to 1.00    |   158 |  8.7
 requests  | 0.80 to 0.94    |   733 | 40.1
 requests  | 0.50 to 0.79    |   163 |  8.9
 requests  | below 0.50      |   772 | 42.3
 seed-repo | 0.95 to 1.00    |    14 | 43.8
 seed-repo | 0.80 to 0.94    |    18 | 56.3
 slugify   | 0.95 to 1.00    |     5 |  2.7
 slugify   | 0.80 to 0.94    |   179 | 95.2
 slugify   | below 0.50      |     4 |  2.1
(13 rows)
```

Over half of the express calls are below 0.50, which is why the impact page has a confidence filter. The lowest confidence in the seed repo is 0.85.

## 12. Trigger rejections

A `CHECK` constraint can only see one row, so it cannot compare a symbol's lines with the length of its file. Two triggers do that instead. `symbol_within_file` rejects a symbol whose span runs past the end of its file, and `file_keeps_symbols` rejects shrinking a file below a symbol it already holds.

Both examples below catch the error and print it, so running them changes nothing.

Database features: BEFORE triggers, `check_violation` errors, exception handling in a `DO` block.

```sql
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
```

```text
NOTICE:  rejected: symbol pastTheEnd spans lines 1 to 10000, outside src/lib/money.ts, which has 7 lines
```

```sql
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
```

```text
NOTICE:  rejected: cannot set src/lib/money.ts to 1 lines, symbol formatMoney ends at line 7
```

## 13. AST node types per language

The remaining queries run on the MongoDB `ast` collection, which holds one document per file. The pipelines are in [db/mongo/pipelines.js](../db/mongo/pipelines.js) and each one runs through `db/mongo/run-pipeline.js`:

```sh
docker compose exec -e CIE_PIPELINE=nodeTypeCountsByLanguage -e CIE_REPO_ID=1 -e CIE_LIMIT=4 -e CIE_EXPLAIN=1 \
  mongo mongosh --quiet /cie-db/mongo/run-pipeline.js
```

`nodeTypeCountsByLanguage` counts syntax node types per language and keeps the most common ones with their share of all nodes. The first `$group` keeps the file in its key so the second can count how many files use each type. The repository page shows this result as bars.

Database features: `$unwind`, three `$group` stages, `$topN`.

```js
[
  { $match: { repo_id: 1 } },
  { $project: { _id: 1, language: 1, types: '$nodes.t' } },
  { $unwind: '$types' },
  { $group: { _id: { language: '$language', type: '$types', file: '$_id' }, count: { $sum: 1 } } },
  { $group: { _id: { language: '$_id.language', type: '$_id.type' }, count: { $sum: '$count' }, files: { $sum: 1 } } },
  {
    $group: {
      _id: '$_id.language',
      total_nodes: { $sum: '$count' },
      distinct_types: { $sum: 1 },
      top_types: {
        $topN: {
          n: 4,
          sortBy: { count: -1, type: 1 },
          output: { type: '$_id.type', count: '$count', files: '$files' },
        },
      },
    },
  },
]
```

The `$project` that adds `share` and the final `$sort` are left out above. On the seed repo this uses `repo_path_unique` and examines 16 documents. First two languages, top two types:

```text
{ language: 'typescript', total_nodes: 685, distinct_types: 56, top_types: [
    { type: 'identifier', count: 124, files: 6, share: 0.181 },
    { type: 'property_identifier', count: 60, files: 6, share: 0.0876 } ] }
{ language: 'python', total_nodes: 286, distinct_types: 40, top_types: [
    { type: 'identifier', count: 97, files: 3, share: 0.3392 },
    { type: 'call', count: 16, files: 3, share: 0.0559 } ] }
```

## 14. Deepest nesting per file

`deepestNestingPerFile` finds the most deeply nested files and rebuilds the chain of node types from the root down to the deepest node. Nodes are stored as a flat array with parent indexes, so `$reduce` walks up the parents instead of descending a nested tree.

Database features: compound index `(repo_id, max_depth desc, path)`, `$filter`, `$reduce`, `$let`.

```js
[
  { $match: { repo_id: 2 } },
  { $sort: { max_depth: -1, path: 1 } },
  { $limit: 3 },
  { $set: { deepest: { $first: { $filter: { input: '$nodes', as: 'node', cond: { $eq: ['$$node.d', '$max_depth'] }, limit: 1 } } } } },
  {
    $set: {
      ancestry: {
        $reduce: {
          input: { $range: [0, '$max_depth'] },
          initialValue: { at: '$deepest.p', chain: [] },
          in: {
            $cond: [
              { $lt: ['$$value.at', 0] },
              '$$value',
              {
                $let: {
                  vars: { node: { $arrayElemAt: ['$nodes', '$$value.at'] } },
                  in: { at: '$$node.p', chain: { $concatArrays: [['$$node.t'], '$$value.chain'] } },
                },
              },
            ],
          },
        },
      },
    },
  },
]
```

The closing `$project` is left out above. On requests this uses `repo_depth` and examines 3 documents for a limit of 3, because the index already has the files in order. First file, with the ancestry shortened:

```text
{ repo_id: 2, path: 'src/requests/models.py', language: 'python', loc: 1184,
  node_count: 5037, max_depth: 23, truncated: false,
  deepest_node: { type: 'string_start', line: 174, column: 42 },
  ancestry: [ 'module', 'class_definition', 'block', 'decorated_definition',
    'function_definition', 'block', 'if_statement', 'elif_clause', 'block',
    'for_statement', 'block', 'for_statement', ... 'call', 'argument_list', 'string' ] }
```

## 15. AST summary

`astSummaryByRepo` gives totals by language and overall in one pass over the collection. With no repository filter it is a collection scan, which is expected for a query that reads every document. Here it examined all 198.

Database features: `$facet`, `$group` with `$addToSet`, `$avg` and `$max`.

```js
[
  { $project: { repo_id: 1, language: 1, loc: 1, node_count: 1, max_depth: 1, truncated: 1 } },
  {
    $facet: {
      by_language: [
        {
          $group: {
            _id: '$language',
            files: { $sum: 1 },
            loc: { $sum: '$loc' },
            nodes: { $sum: '$node_count' },
            avg_nodes_per_file: { $avg: '$node_count' },
            avg_depth: { $avg: '$max_depth' },
            max_depth: { $max: '$max_depth' },
            truncated_files: { $sum: { $cond: ['$truncated', 1, 0] } },
          },
        },
        { $sort: { files: -1, language: 1 } },
      ],
      totals: [
        {
          $group: {
            _id: null,
            repos: { $addToSet: '$repo_id' },
            files: { $sum: 1 },
            loc: { $sum: '$loc' },
            nodes: { $sum: '$node_count' },
            max_depth: { $max: '$max_depth' },
          },
        },
      ],
    },
  },
]
```

The rounding and `$project` stages are left out above. First two of five languages, then the totals:

```text
{ by_language: [
    { language: 'javascript', files: 147, loc: 22595, nodes: 112322, max_depth: 43,
      truncated_files: 0, avg_nodes_per_file: 764.1, avg_depth: 23.7 },
    { language: 'python', files: 41, loc: 12084, nodes: 59598, max_depth: 23,
      truncated_files: 0, avg_nodes_per_file: 1453.6, avg_depth: 11.8 } ],
  totals: { files: 198, loc: 34846, nodes: 172930, max_depth: 43, repos: 4 } }
```

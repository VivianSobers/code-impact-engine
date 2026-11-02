# History, similarity and access queries

These are the main queries behind the history, similarity and access control features: repository churn summaries, change hotspots, file ownership, author activity, commit search and symbol attribution, semantic code search via pgvector, clone detection queue, waiver management, and transactional review safeguards.

The output comes from the database holding ingested repositories: the seed repo and [expressjs/express](https://github.com/expressjs/express). Exact numbers will change as repositories evolve.

The SQL is in [db/queries/history_queries.sql](../db/queries/history_queries.sql), in the same order as this document. To run it against the database:

```sh
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < db/queries/history_queries.sql
```

| # | Query | Database features |
|---|-------|-------------------|
| 1 | History summary across repositories | Correlated subqueries, multi-table counts, FILTER condition |
| 2 | Symbol change hotspots (`v_symbol_hotspot`) | Stored view, GROUP BY, HAVING, composite churn computation |
| 3 | File ownership and author churn share (`v_file_ownership`) | CTE, Window function `sum() OVER (PARTITION BY ...)`, `rank() OVER (...)` |
| 4 | Author activity and multi-repository stats (`v_author_activity`) | Stored view, `array_agg` with ORDER BY, LEFT JOIN, aggregate date bounds |
| 5 | Commit search with English stemming | Full-text search with `tsvector`, GIN index, `websearch_to_tsquery`, `ts_rank` |
| 6 | Symbols touched by a specific commit | Relational join over `MODIFIES` and `SYMBOL`, ordering by file path and line |
| 7 | Semantic code search with pgvector | Vector cosine distance operator (`<=>`), HNSW index, similarity inversion |
| 8 | Clone review queue summary | Outer join, string aggregation (`string_agg DISTINCT`), GROUP BY, status ranking |
| 9 | Clone cluster member details and waivers | Correlated `EXISTS` subquery, composite foreign keys |
| 10 | Clone review transaction and row locking | Stored procedure (`CALL review_clone_cluster`), `SELECT ... FOR UPDATE`, array unnesting |
| 11 | Clone review guard trigger | BEFORE UPDATE/INSERT trigger, PL/pgSQL exception handling, role authorization check |
| 12 | User authentication and role validation | CHECK constraints, regex validation, secure bcrypt hash storage |

---

## 1. History summary across repositories

Computes high-level statistics across all repositories or narrowed to a single repository: total repositories, total commits, distinct authors, distinct symbols touched by commit diffs, and open clone clusters requiring review.

Database features: Correlated scalar subqueries, `count(DISTINCT ...)`.

```sql
SELECT
   (SELECT count(*) FROM repository)::int AS repositories,
   (SELECT count(*) FROM commit)::int AS commits,
   (SELECT count(DISTINCT author_id) FROM commit)::int AS authors,
   (SELECT count(DISTINCT m.symbol_id) FROM modifies m JOIN commit c USING (commit_id))::int AS symbols_changed,
   (SELECT count(DISTINCT c.cluster_id) FROM clone_cluster c JOIN symbol s USING (cluster_id) WHERE c.status = 'open')::int AS open_clusters;
```

```text
 repositories | commits | authors | symbols_changed | open_clusters 
--------------+---------+---------+-----------------+---------------
            2 |    6194 |     389 |             267 |            12
(1 row)
```

## 2. Symbol change hotspots (`v_symbol_hotspot`)

Identifies which functions and methods change most frequently across the history of the codebase. The view filters for symbols touched by at least two distinct commits (`HAVING count(*) >= 2`) and ranks them by total churn (`additions + deletions`).

Database features: Stored view, `GROUP BY`, `HAVING count(*) >= 2`, aggregate functions (`count`, `sum`, `max`).

```sql
SELECT r.name AS repo, h.name, h.kind, h.path, h.commits, h.authors, h.additions, h.deletions, h.churn, h.last_changed::date
FROM v_symbol_hotspot h
JOIN repository r ON r.repo_id = h.repo_id
ORDER BY h.churn DESC, h.commits DESC
LIMIT 8;
```

```text
  repo   |         name         |  kind  |        path        | commits | authors | additions | deletions | churn | last_changed 
---------+----------------------+--------+--------------------+---------+---------+-----------+-----------+-------+--------------
 express | send                 | method | lib/response.js    |      80 |      22 |       469 |       292 |   761 | 2026-09-15
 express | render               | method | lib/view.js        |      35 |       2 |       334 |       167 |   501 | 2015-07-07
 express | redirect             | method | lib/response.js    |      61 |      17 |       233 |       159 |   392 | 2026-01-16
 express | defaultConfiguration | method | lib/application.js |      53 |      13 |       126 |       141 |   267 | 2024-10-22
 express | use                  | method | lib/application.js |      27 |      11 |       121 |       103 |   224 | 2024-10-22
 express | render               | method | lib/application.js |      25 |       8 |       116 |       100 |   216 | 2026-02-01
 express | location             | method | lib/response.js    |      18 |      10 |        92 |       119 |   211 | 2024-09-10
 express | render               | method | lib/response.js    |      14 |       4 |       107 |        82 |   189 | 2015-06-20
(8 rows)
```

## 3. File ownership and author churn share (`v_file_ownership`)

Computes who changed each file the most, measuring lines modified within its symbols. The view uses a window function to divide each author's churn by the file's total churn, and designates the author with rank 1 as the primary file owner (tie-breaking by author ID).

Database features: CTE (`per_author`), window function `sum() OVER (PARTITION BY repo_id, path)`, ranking window function `rank() OVER (PARTITION BY repo_id, path ORDER BY churn DESC)`.

```sql
SELECT r.name AS repo, o.path, o.author_name, o.commits, o.churn, o.share, o.is_owner
FROM v_file_ownership o
JOIN repository r ON r.repo_id = o.repo_id
WHERE o.churn >= 80
ORDER BY r.name, o.path, o.churn DESC
LIMIT 8;
```

```text
  repo   |           path           |        author_name         | commits | churn | share  | is_owner 
---------+--------------------------+----------------------------+---------+-------+--------+----------
 express | examples/mvc/lib/boot.js | Tj Holowaychuk             |       5 |    86 | 0.5276 | t
 express | lib/application.js       | Douglas Christopher Wilson |      23 |   462 | 0.3723 | t
 express | lib/application.js       | Tj Holowaychuk             |      65 |   418 | 0.3368 | f
 express | lib/application.js       | Roman Shtylman             |       9 |   159 | 0.1281 | f
 express | lib/request.js           | Tj Holowaychuk             |      20 |   179 | 0.6581 | t
 express | lib/response.js          | Tj Holowaychuk             |     156 |  1356 | 0.4247 | t
 express | lib/response.js          | Douglas Christopher Wilson |      51 |  1043 | 0.3267 | f
 express | lib/utils.js             | Douglas Christopher Wilson |      12 |   140 | 0.5385 | t
(8 rows)
```

## 4. Author activity and contribution churn (`v_author_activity`)

Aggregates individual contributions across all repositories: total repositories touched, commits authored, net symbol churn, and chronological bounds (first and last commit dates). Multiple emails belonging to the same author are collected into an array.

Database features: Stored view, `array_agg(...)`, correlated subqueries, `LEFT JOIN` handling authors without commits.

```sql
SELECT a.name, a.company, a.emails[1:2] AS sample_emails, a.repos, a.commits, a.churn, a.first_commit::date, a.last_commit::date
FROM v_author_activity a
WHERE a.commits > 0
ORDER BY a.churn DESC, a.commits DESC
LIMIT 6;
```

```text
            name            |    company    |             sample_emails              | repos | commits | churn | first_commit | last_commit 
----------------------------+---------------+----------------------------------------+-------+---------+-------+--------------+-------------
 Tj Holowaychuk             | Vision-media  | {tj@vision-media.ca}                   |     1 |    3881 |  3011 | 2009-06-26   | 2014-02-19
 Douglas Christopher Wilson | Somethingdoug | {doug@somethingdoug.com}               |     1 |    1232 |  2439 | 2014-04-10   | 2023-11-02
 Roman Shtylman             |               | {shtylman@gmail.com}                   |     1 |      70 |   194 | 2011-03-21   | 2014-05-12
 Wes Todd                   | Wesleytodd    | {wes@wesleytodd.com,wtodd@netflix.com} |     1 |      48 |   169 | 2017-02-22   | 2025-03-28
 Jonathan Ong               |               | {jonathanrichardong@gmail.com}         |     1 |      84 |   108 | 2013-09-08   | 2014-06-05
 Chen Li                    | Acme          | {chen.li@acme.example}                 |     1 |       3 |    84 | 2026-09-04   | 2026-09-09
(6 rows)
```

## 5. Commit search with English stemming

Searches commit messages using PostgreSQL full-text search. The `message_search` column is a stored generated `tsvector`. The query uses `websearch_to_tsquery` to support plain text, Boolean operators, and English stemming (e.g. "discounting" stems to "discount"), ranked with `ts_rank`.

Database features: Stored generated `tsvector` column, GIN index (`commit_message_search_idx`), `websearch_to_tsquery`, `ts_rank`.

```sql
SELECT c.commit_id, r.name AS repo, substring(c.sha from 1 for 8) AS sha, a.name AS author, c.committed_at::date AS committed_at,
       (SELECT count(*) FROM modifies m WHERE m.commit_id = c.commit_id) AS symbols,
       (SELECT coalesce(sum(m.additions + m.deletions), 0) FROM modifies m WHERE m.commit_id = c.commit_id) AS churn,
       substring(c.message from 1 for 40) AS message
FROM commit c
JOIN repository r USING (repo_id)
JOIN author a ON a.author_id = c.author_id
WHERE c.message_search @@ websearch_to_tsquery('english', 'discount')
ORDER BY ts_rank(c.message_search, websearch_to_tsquery('english', 'discount')) DESC, c.committed_at DESC
LIMIT 5;
```

```text
 commit_id |   repo    |   sha    |   author   | committed_at | symbols | churn |        message         
-----------+-----------+----------+------------+--------------+---------+-------+------------------------
         5 | seed-repo | f4424732 | Ben Okafor | 2026-09-05   |       5 |    20 | Support discount codes
(1 row)
```

## 6. Symbols touched by a specific commit

Retrieves the exact code symbols affected by a commit diff, detailing the file path, symbol line span, lines added/deleted, and whether the symbol was newly introduced (`added`) or modified (`modified`).

Database features: Inner join over `MODIFIES` and `SYMBOL`, ordering by file path and line position.

```sql
SELECT s.name, s.kind, s.path, s.start_line, s.end_line, m.change_type, m.additions, m.deletions
FROM modifies m
JOIN symbol s USING (symbol_id)
WHERE m.commit_id = 5
ORDER BY s.path, s.start_line;
```

```text
     name      |   kind   |            path             | start_line | end_line | change_type | additions | deletions 
---------------+----------+-----------------------------+------------+----------+-------------+-----------+-----------
 POST          | function | src/app/api/orders/route.ts |         11 |       15 | modified    |         2 |         1
 applyDiscount | function | src/orders/pricing.ts       |         15 |       18 | modified    |         3 |         2
 priceOrder    | function | src/orders/pricing.ts       |         20 |       22 | modified    |         2 |         2
 OrderService  | class    | src/orders/service.ts       |         15 |       30 | modified    |         2 |         2
 create        | method   | src/orders/service.ts       |         16 |       21 | modified    |         2 |         2
(5 rows)
```

## 7. Semantic code search by pgvector cosine distance

Ranks functions and methods according to semantic similarity with a query vector generated by `jinaai/jina-embeddings-v2-base-code`. Vectors are 768-dimensional and indexed using Hierarchical Navigable Small World (HNSW) graphs. Cosine similarity is computed as `1 - (e.embedding <=> query)`.

Database features: pgvector extension, vector cosine distance (`<=>`), HNSW index (`symbol_embedding_hnsw_idx`), session parameter tuning (`hnsw.ef_search = 100`).

```sql
SELECT s.symbol_id, r.name AS repo, s.path, s.name, s.kind,
       round((1 - (e.embedding <=> (SELECT embedding FROM symbol_embedding LIMIT 1)))::numeric, 3) AS similarity
FROM symbol_embedding e
JOIN symbol s ON s.embedding_id = e.embedding_id
JOIN repository r ON r.repo_id = s.repo_id
ORDER BY e.embedding <=> (SELECT embedding FROM symbol_embedding LIMIT 1)
LIMIT 5;
```

```text
 symbol_id |  repo   |                  path                  |     name     |   kind   | similarity 
-----------+---------+----------------------------------------+--------------+----------+------------
       116 | express | examples/auth/index.js                 | authenticate | function |      1.000
       165 | express | examples/route-middleware/index.js     | loadUser     | function |      0.438
       175 | express | examples/route-separation/user.js      | load         | function |      0.412
       147 | express | examples/mvc/controllers/user/index.js | before       | function |      0.373
       151 | express | examples/mvc/controllers/user/index.js | update       | function |      0.368
(5 rows)
```

## 8. Clone review queue summary

Displays clone clusters detected by similarity clustering. Each row shows the similarity score, total member symbols, repositories involved, detection date, review status, and reviewing admin.

Database features: `LEFT JOIN` on `symbol`, `repository` and `app_user`, `string_agg(DISTINCT ...)` aggregating participating repositories, `GROUP BY`.

```sql
SELECT c.cluster_id, c.status, c.similarity_score, count(s.symbol_id) AS members,
       string_agg(DISTINCT r.name, ', ') AS repositories,
       c.detected_at::date AS detected_at,
       u.username AS reviewer, c.reviewed_at::date AS reviewed_at
FROM clone_cluster c
LEFT JOIN symbol s ON s.cluster_id = c.cluster_id
LEFT JOIN repository r ON r.repo_id = s.repo_id
LEFT JOIN app_user u ON u.user_id = c.reviewed_by
GROUP BY c.cluster_id, u.username
ORDER BY c.status, c.similarity_score DESC
LIMIT 6;
```

```text
 cluster_id | status | similarity_score | members | repositories | detected_at | reviewer | reviewed_at 
------------+--------+------------------+---------+--------------+-------------+----------+-------------
         29 | open   |            1.000 |       2 | express      | 2026-11-02  |          | 
         30 | open   |            1.000 |       6 | express      | 2026-11-02  |          | 
         31 | open   |            0.935 |       4 | express      | 2026-11-02  |          | 
         32 | open   |            0.896 |       2 | express      | 2026-11-02  |          | 
         24 | open   |            0.872 |       2 | express      | 2026-11-02  |          | 
         23 | open   |            0.860 |       2 | express      | 2026-11-02  |          | 
(6 rows)
```

## 9. Clone cluster members and waiver check

Lists all symbols belonging to a specific clone cluster and inspects whether any have been granted a waiver via `EXISTS (SELECT 1 FROM waives ...)`.

Database features: Correlated `EXISTS` subquery, composite foreign keys `(repo_id, path)`.

```sql
SELECT s.symbol_id, s.name, s.kind, s.path, s.start_line, s.end_line,
       EXISTS (SELECT 1 FROM waives w WHERE w.symbol_id = s.symbol_id) AS waived
FROM symbol s
WHERE s.cluster_id = 30
ORDER BY s.path, s.start_line;
```

```text
 symbol_id | name |   kind   |      path       | start_line | end_line | waived 
-----------+------+----------+-----------------+------------+----------+--------
       366 | fn3  | function | test/app.use.js |        186 |      189 | f
       369 | fn3  | function | test/app.use.js |        214 |      217 | f
       372 | fn3  | function | test/app.use.js |        242 |      245 | f
       377 | fn3  | function | test/app.use.js |        377 |      380 | f
       380 | fn3  | function | test/app.use.js |        405 |      408 | f
       383 | fn3  | function | test/app.use.js |        433 |      436 | f
(6 rows)
```

## 10. Clone review transaction and row locking

Admins review a clone cluster and optionally waive individual members in one atomic operation using stored procedure `review_clone_cluster`. The procedure locks the cluster row with `SELECT ... FOR UPDATE`, ensures status is currently `open` (preventing concurrent conflicting reviews), checks member symbols, and records waivers in `waives`.

Database features: Stored procedure (`CALL review_clone_cluster`), pessimistic row locking (`FOR UPDATE`), array parameter unnesting, custom exception mapping (`ERRCODE`).

```sql
DO $$
DECLARE
    v_admin   bigint := (SELECT user_id FROM app_user WHERE role = 'admin' LIMIT 1);
    v_cluster bigint := (SELECT cluster_id FROM clone_cluster WHERE status = 'open' LIMIT 1);
    v_member  bigint := (SELECT symbol_id FROM symbol WHERE cluster_id = v_cluster LIMIT 1);
BEGIN
    IF v_cluster IS NOT NULL AND v_member IS NOT NULL THEN
        CALL review_clone_cluster(v_cluster, v_admin, 'confirmed', ARRAY[v_member]::bigint[], 'Waived as test duplicate');
        RAISE NOTICE 'Cluster % confirmed with waiver for symbol % by admin %', v_cluster, v_member, v_admin;
        -- Revert review back to open for idempotency
        UPDATE clone_cluster SET status = 'open' WHERE cluster_id = v_cluster;
        DELETE FROM waives WHERE symbol_id = v_member;
    END IF;
END;
$$;
```

```text
NOTICE:  Cluster 21 confirmed with waiver for symbol 122 by admin 3
```

## 11. Clone review guard trigger

Database-level access control enforced by trigger `clone_cluster_review_guard` on table `clone_cluster`. Any attempt to transition a cluster from `open` to `confirmed` or `dismissed` without an active admin `reviewed_by` user ID raises SQLSTATE `42501 (insufficient_privilege)`.

Database features: `BEFORE UPDATE OF status` trigger, PL/pgSQL function, SQLSTATE exception handling.

```sql
DO $$
DECLARE
    v_dev     bigint := (SELECT user_id FROM app_user WHERE role = 'developer' LIMIT 1);
    v_cluster bigint := (SELECT cluster_id FROM clone_cluster WHERE status = 'open' LIMIT 1);
BEGIN
    UPDATE clone_cluster SET status = 'confirmed', reviewed_by = v_dev WHERE cluster_id = v_cluster;
    RAISE NOTICE 'Trigger failed: developer update was accepted';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Trigger succeeded: rejected developer review: %', SQLERRM;
END;
$$;
```

```text
NOTICE:  Trigger succeeded: rejected developer review: user 4 is not an admin and cannot review clone clusters
```

## 12. User authentication and role validation

Shows registered users and verifies that passwords strictly satisfy the bcrypt storage format constraint (`$2[aby]$1[0-4]$...`), guaranteeing that plaintext passwords cannot be persisted.

Database features: CHECK constraint regex validation, role domain constraint (`IN ('admin', 'developer')`).

```sql
SELECT user_id, username, role,
       (password_hash ~ '^\$2[aby]\$1[0-4]\$[./A-Za-z0-9]{53}$') AS is_valid_bcrypt_format,
       created_at::date AS created_at
FROM app_user
ORDER BY user_id;
```

```text
 user_id | username |   role    | is_valid_bcrypt_format | created_at 
---------+----------+-----------+------------------------+------------
       3 | ana      | admin     | t                      | 2026-11-02
       4 | ben      | developer | t                      | 2026-11-02
       6 | devtest  | developer | t                      | 2026-11-02
(3 rows)
```

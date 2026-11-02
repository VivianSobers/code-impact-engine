# Database operations

This document covers the scripts that show each kind of database operation on its own: DML, the main kinds of SQL query, pgvector reads and writes, MongoDB reads, updates and deletes, and the database roles. The feature queries the app runs are in [STRUCTURE_QUERIES.md](STRUCTURE_QUERIES.md) and [HISTORY_QUERIES.md](HISTORY_QUERIES.md).

| Script | What it shows | Changes data? |
|---|---|---|
| [db/queries/dml_operations.sql](../db/queries/dml_operations.sql) | INSERT, INSERT ... SELECT, UPSERT, UPDATE, UPDATE ... FROM, DELETE ... USING, cascading deletes, constraint rejections | No, rolls back |
| [db/queries/query_types.sql](../db/queries/query_types.sql) | Joins, nested subqueries, correlated subqueries, recursive CTEs, set operations, window functions | No, read-only |
| [db/queries/vector_operations.sql](../db/queries/vector_operations.sql) | pgvector k-NN under three distance operators, HNSW plan, similar pairs, centroids, create, update and delete | No, rolls back |
| [db/mongo/rud.js](../db/mongo/rud.js) | find, projections, `$elemMatch`, update operators, pipeline updates, upsert, validator, delete | No, works on a scratch copy it removes |
| [db/security/40_roles.sql](../db/security/40_roles.sql) | `cie_developer` and `cie_admin` roles with table, column and procedure grants | Applied at setup |

All outputs below come from the seed repository after `npm run seed`, `npm run history -- seed-repo` and `npm run embed -- seed-repo`.

## Running them

```sh
docker compose exec -T postgres psql -U cie -d cie -f /cie-db/queries/dml_operations.sql
docker compose exec -T postgres psql -U cie -d cie -f /cie-db/queries/query_types.sql
docker compose exec -T postgres psql -U cie -d cie -f /cie-db/queries/vector_operations.sql
docker compose exec -T mongo mongosh --quiet cie /cie-db/mongo/rud.js
```

For MongoDB Atlas instead of the local container, pass the connection string to the same mongosh: `docker compose exec -T mongo mongosh "$MONGODB_URI" /cie-db/mongo/rud.js`.

## DML

The script creates a repository called `dml-demo`, fills every code structure table and the history tables for it, changes and deletes rows, and rolls everything back at the end.

| # | Statement | Result on the seed database |
|---|---|---|
| 1 | `INSERT ... RETURNING` a repository | New `repo_id`, `default_branch` defaults to `main` |
| 2 | Multi-row `INSERT` into `file` | 3 files, content hashes computed with `sha256()` |
| 3 | `INSERT ... SELECT` into `symbol`, joined to `file` | 4 symbols |
| 4 | `INSERT` call edges, looking both ends up by name | 3 rows in `calls` |
| 5 | `INSERT` chained through data-modifying CTEs: author, two emails, a commit, two `modifies` rows | 2 `modifies` rows |
| 6 | `INSERT ... ON CONFLICT ON CONSTRAINT repository_url_key DO UPDATE` | Name and branch updated, same `repo_id` |
| 7 | `UPDATE file SET loc = loc + 5` with a filter | 2 TypeScript files |
| 8 | `UPDATE calls ... FROM symbol` | Python caller's confidence halved, 0.60 to 0.30 |
| 9 | `UPDATE symbol` with a correlated `EXISTS` | `checkout` stops being an entry point because `main` calls it |
| 10 | Six invalid writes, each in its own block | All six rejected (see below) |
| 11 | `DELETE FROM calls USING symbol` | Removes the 0.30 call |
| 12 | `DELETE` a file | Symbols 4 to 3, calls 2 to 1, `modifies` 2 to 1 through `ON DELETE CASCADE` |
| 13 | `DELETE` the repository | No orphan files or commits; the author stays |

Step 10 output:

```
NOTICE:  span CHECK rejected: new row for relation "symbol" violates check constraint "symbol_span_ordered"
NOTICE:  span trigger rejected: symbol applyTax spans lines 1 to 500, outside src/tax.ts, which has 25 lines
NOTICE:  language CHECK rejected: new row for relation "file" violates check constraint "file_language_known"
NOTICE:  foreign key rejected: insert or update on table "symbol" violates foreign key constraint "symbol_file_fkey"
NOTICE:  confidence CHECK rejected: new row for relation "calls" violates check constraint "calls_confidence_range"
NOTICE:  unique URL rejected: duplicate key value violates unique constraint "repository_url_key"
```

## Kinds of SQL query

| Group | Queries | Technique |
|---|---|---|
| A. Joins | A1 to A5 | Inner join with `SYMBOL` joined twice (caller and callee), left outer join, full outer join of import counts, self join on name, `JOIN ... USING` across four history tables |
| B. Nested | B1 to B5 | Row-value `IN (subquery)` with `GROUP BY ... HAVING`, scalar subquery in `SELECT` and `WHERE`, derived table in `FROM`, `> ALL`, `= ANY` |
| C. Correlated | C1 to C4 | `NOT EXISTS` for dead code, correlated scalar subquery against the symbol's own file, correlated subquery in `SELECT`, relational division with a double `NOT EXISTS` |
| D. Recursive | D1 to D3 | Transitive import closure with a cycle guard, downstream call tree with the SQL-standard `CYCLE` clause, `impact_of()` |
| E. Set operations | E1 to E3 | `INTERSECT`, `EXCEPT`, `UNION` |
| F. Aggregation | F1, F2 | `GROUP BY ... HAVING` with `rank()` and a share over the whole result, running total with a window frame |

C4 asks which authors changed every file under `src/orders/`. In SQL this reads as "there is no file under `src/orders/` that this author did not change":

```sql
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
          WHERE c.author_id = a.author_id AND s.repo_id = f.repo_id AND s.path = f.path));
```

```
    name
------------
 Ben Okafor
```

D2 walks the call graph down from the `POST` route handler. `parseAddress` and `normalizeAddress` call each other. Without a guard the recursion would never end; the `CYCLE` clause marks the repeated row and stops there:

```
           call_tree           |            path             | is_cycle
-------------------------------+-----------------------------+----------
 POST                          | src/app/api/orders/route.ts | f
     create                    | src/orders/service.ts       | f
         logEvent              | src/lib/log.ts              | f
         formatMoney           | src/lib/money.ts            | f
             roundCurrency     | src/lib/money.ts            | f
         parseAddress          | src/orders/address.ts       | f
             normalizeAddress  | src/orders/address.ts       | f
             normalizeAddress  | src/orders/address.ts       | f
                 parseAddress  | src/orders/address.ts       | t
                 parseAddress  | src/orders/address.ts       | t
         priceOrder            | src/orders/pricing.ts       | f
             subtotal          | src/orders/pricing.ts       | f
             applyDiscount     | src/orders/pricing.ts       | f
                 roundCurrency | src/lib/money.ts            | f
         nextId                | src/orders/service.ts       | f
```

`normalizeAddress` appears twice because `parseAddress` calls it on two lines (8 and 9), and each call is its own row in `calls`.

D1 follows imports instead of calls:

```
         path          | depth |                                 import_chain
-----------------------+-------+-------------------------------------------------------------------------------
 src/lib/log.ts        |     2 | src/app/api/orders/route.ts -> src/orders/service.ts -> src/lib/log.ts
 src/lib/money.ts      |     2 | src/app/api/orders/route.ts -> src/orders/service.ts -> src/lib/money.ts
 src/orders/address.ts |     2 | src/app/api/orders/route.ts -> src/orders/service.ts -> src/orders/address.ts
 src/orders/pricing.ts |     2 | src/app/api/orders/route.ts -> src/orders/service.ts -> src/orders/pricing.ts
 src/orders/service.ts |     1 | src/app/api/orders/route.ts -> src/orders/service.ts
```

## Vector operations (pgvector)

| # | Operation | Notes |
|---|---|---|
| V1 | Read: what is stored | 34 vectors, 768 dimensions, unit length, one per distinct body |
| V2 | Read: k nearest neighbours by cosine distance `<=>` | The query the semantic search page runs |
| V3 | Read: the same neighbours under `<=>`, `<->` (Euclidean) and `<#>` (negative inner product) | Same order, because the vectors are normalised |
| V4 | `EXPLAIN` of a k-NN search | `Index Scan using symbol_embedding_hnsw_idx`, `Order By: (embedding <=> $0)` |
| V5 | Read: most similar pairs | The candidates clone detection groups |
| V6 | Read: per-file centroid with `avg(vector)` and the function closest to it | |
| V7 | Create: insert a vector and point a symbol at it | |
| V8 | Update: replace a vector in place | Norm goes from 1 to 2; cosine neighbours stay the same |
| V9 | Delete: remove a vector | `symbol.embedding_id` becomes NULL through `ON DELETE SET NULL` |
| V10 | Constraint checks | A 3-dimension vector and a malformed body hash are both refused |

V2 output:

```
     name      |         path          | cosine_distance | similarity
---------------+-----------------------+-----------------+------------
 applyDiscount | src/orders/pricing.ts |          0.2837 |     0.7163
 subtotal      | src/orders/pricing.ts |          0.3665 |     0.6335
 create        | src/orders/service.ts |          0.3700 |     0.6300
 line_total    | analytics/stats.py    |          0.4255 |     0.5745
 roundCurrency | src/lib/money.ts      |          0.5527 |     0.4473
```

V5 output. The top pair is the mutually recursive address functions:

```
     first     |      second      | similarity
---------------+------------------+------------
 parseAddress  | normalizeAddress |     0.7548
 main          | run              |     0.7538
 roundCurrency | formatMoney      |     0.7406
 applyDiscount | priceOrder       |     0.7163
 add           | line_total       |     0.7081
```

## MongoDB reads, updates and deletes

The ingester creates `ast` documents, so the script only reads the real ones. For updates and deletes it inserts two scratch copies of `src/orders/pricing.ts` under `scratch/` and removes them at the end. The collection is left as it was: 16 documents for the seed repository.

| # | Operation | Result |
|---|---|---|
| R1 | `findOne` with a projection that drops the node array | File metadata only |
| R2 | `find` with `$gte`, `sort` and `limit`, plus `explain` | Uses the `repo_depth` index |
| R3 | `distinct` and `countDocuments` | go 2, java 2, javascript 2, python 4, typescript 6 |
| R4 | `$elemMatch` on the node array | 4 files declare a class |
| R5 | `$or` and `$in` | Go or Java files, or files over 25 lines |
| U1 | `updateOne` with `$set` and `$inc` | `loc` 22 to 25 |
| U2 | `updateOne` with an aggregation pipeline | Cuts the tree at depth 8 and recomputes: `node_count` 135 to 117, `max_depth` 11 to 8, `truncated` true |
| U3 | `findOneAndUpdate` with `returnDocument: 'after'` | Returns the changed `parser` sub-document |
| U4 | `updateOne` with `upsert: true` on `(repo_id, path)` | Matches the existing scratch copy |
| U5 | `updateMany` | 2 matched |
| U6 | Invalid writes | Unknown language and negative `loc` fail validation (code 121); a second document with the same `(repo_id, path)` fails the unique index (code 11000) |
| D1 | `deleteOne` by `_id` | 1 deleted |
| D2 | `deleteMany` by filter | 1 deleted, 0 scratch documents left |

## Database roles

The app's two roles, Admin and Developer, also exist as database roles. That way, a connection running as a developer cannot write, even if the application checks are bypassed.

| Privilege | `cie_developer` | `cie_admin` |
|---|---|---|
| `SELECT` on code structure, history, clone and vector tables and the three views | yes | yes (inherited) |
| `SELECT` on `app_user` | `user_id`, `username`, `role`, `created_at` only | every column |
| `INSERT`, `UPDATE`, `DELETE` on `repository`, `file`, `symbol`, `calls`, `imports` | no | yes |
| `UPDATE` on `clone_cluster` | no | `status` and `reviewed_by` only |
| `INSERT`, `UPDATE`, `DELETE` on `waives` and `app_user` | no | yes |
| `EXECUTE` on `review_clone_cluster` | no (revoked from PUBLIC) | yes |
| Writes to `author`, `commit`, `modifies`, `symbol_embedding` | no | no; only the ingest tools, which connect as the owner, write these |

Clone reviews are checked twice in the database. The grant decides whether the connection may write `clone_cluster` at all. The `clone_cluster_review_guard` trigger then checks that the reviewer recorded in the row is an admin in `app_user`.

```
cie=> SET ROLE cie_developer;
cie=> SELECT password_hash FROM app_user;
ERROR:  permission denied for table app_user
cie=> INSERT INTO repository (name, url) VALUES ('x', 'test://x');
ERROR:  permission denied for table repository
cie=> CALL review_clone_cluster(1, 1, 'confirmed');
ERROR:  permission denied for procedure review_clone_cluster
cie=> SET ROLE cie_admin;
cie=> INSERT INTO repository (name, url) VALUES ('x', 'test://x') RETURNING name, url;
 name |   url
------+----------
 x    | test://x
```

[db/tests/40_roles_test.sql](../db/tests/40_roles_test.sql) checks 34 statements, each one as one of the roles. Each must either succeed or fail with SQLSTATE 42501.

To use the roles for a login, create a login role and make it a member, for example `CREATE ROLE ana LOGIN PASSWORD '...' IN ROLE cie_developer;`.

# Code structure test results

Results for the code structure work, run on 2 November 2026 on a local checkout with these branches merged together: `guru/mongo-ast`, `guru/impact-of`, `guru/symbol-search`, `guru/db-docs`, `guru/repo-browser`, `guru/call-graph-impact` and `guru/ingest-parse`. The Next.js scaffold was a temporary local one, because the real scaffold is not merged yet.

Postgres and MongoDB ran in the project's Docker containers. Application data lived in a scratch database called `cie_t_demo`.

## Summary

| Suite | Result | Time |
|-------|--------|------|
| SQL tests | 3 of 3 files passed | 0.5 s |
| Ingest tests | 42 of 42 passed, 0 skipped | 5.6 s |
| Ingest typecheck | No errors | 1.6 s |
| `next build` | Passed | 5.5 s |
| API smoke test on `next start` | 26 of 27 passed, 1 failed, 0 skipped | 3.9 s |
| API smoke test on `next dev` | 27 of 27 passed, 0 skipped | 3.8 s |

The one failure is explained under [Known failure](#known-failure).

## SQL tests

The tests run in a throwaway database that the runner creates and drops. Each file raises an exception on the first wrong result.

```sh
docker exec cie-postgres-1 rm -rf /tmp/cie-db-int
docker cp db cie-postgres-1:/tmp/cie-db-int
docker exec -e CIE_DB_ROOT=/tmp/cie-db-int -e CIE_TEST_DB=cie_t_sqltests cie-postgres-1 sh /tmp/cie-db-int/tests/run.sh
```

The copy is needed only until the branches are merged, because the container mounts `db/` from the main checkout, which has no `tests` folder yet. After that, this is enough:

```sh
docker compose exec -e CIE_TEST_DB=cie_t_sqltests postgres sh /cie-db/tests/run.sh
```

```text
pass  20_impact_of_test.sql
pass  21_symbol_search_test.sql
pass  22_symbol_span_trigger_test.sql
```

| File | What it covers |
|------|----------------|
| `20_impact_of_test.sql` | Depth limits, the stronger path through a diamond, duplicate call lines, weakest confidence on a path, entry points, symbols with no callers, the target staying out of its own result, and rejection of bad arguments |
| `21_symbol_search_test.sql` | Name splitting, an exact name ranking first, name matches outranking signature matches, the repository filter, limits, NULL queries, and `search_vector` following renames |
| `22_symbol_span_trigger_test.sql` | `symbol_within_file` and `file_keeps_symbols` rejecting bad spans with the right error, and file renames carrying symbols along |

## Ingest tests

The integration tests use a scratch database named `cie_t_ingest` with the schema and functions applied, and skip themselves when they cannot reach it. Here the database existed, so all of them ran.

```sh
cd ingest
npm test
npm run typecheck
```

```text
tests 42
suites 13
pass 42
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 5621
```

| File | What it covers |
|------|----------------|
| `extract.test.ts` | Symbols, calls, imports and signatures across the five languages |
| `resolve.test.ts` | Import resolution per language, confidence scores for calls, re-exports, and fallback to unique or ambiguous names |
| `ast.test.ts` | Line counting and flattening syntax trees into stored nodes, including the node cap and leaf text limit |
| `source.test.ts` | Telling URLs from local paths, repository naming, skipping vendored, generated, oversized, minified and binary files, and mapping extensions to grammars |
| `integration.test.ts` | Ingesting the seed repo into both databases: row counts, a second run replacing rows, every symbol inside its file, one AST document per file, and the call chain from `POST` to `roundCurrency` |

## UI build and API smoke test

```sh
npx next build
npx next start -p 3100
BASE_URL=http://localhost:3100 INGEST_SOURCE=https://github.com/sindresorhus/slugify node --test tests/structure/api.test.mjs
```

The build compiled all 8 API routes and all 6 pages with no type errors.

The API test covers every code structure route. See [tests/structure/README.md](../tests/structure/README.md) for how it works.

| Route | Cases | `next start` | `next dev` |
|-------|-------|--------------|------------|
| `GET /api/repositories` | Lists repositories with counts | 1 of 1 | 1 of 1 |
| `POST /api/repositories` | Missing source, invalid JSON, bad URL scheme, bad branch, real ingest | 5 of 5 | 5 of 5 |
| `GET /api/repositories/[repoId]` | Success, bad ids, unknown id | 3 of 3 | 3 of 3 |
| `GET /api/repositories/[repoId]/ast-stats` | Success, bad limit, unknown id | 3 of 3 | 3 of 3 |
| `GET /api/repositories/[repoId]/files/[...path]` | Success, unknown path, malformed path | 2 of 3 | 3 of 3 |
| `GET /api/symbols/[symbolId]` | Success, bad id, unknown id | 2 of 2 | 2 of 2 |
| `GET /api/symbols/[symbolId]/graph` | Success, bad depth and limit, unknown id | 3 of 3 | 3 of 3 |
| `GET /api/symbols/[symbolId]/impact` | Success, confidence filter, bad depth and confidence, unknown id | 4 of 4 | 4 of 4 |
| `GET /api/symbols/search` | Name search, repository filter, bad parameters | 3 of 3 | 3 of 3 |

The `next start` run used the final code. The `next dev` run came from earlier the same day, before three small UI fixes. Since then, the only change under `app/api` and `lib/structure` is one display helper for language names, which no API route uses. A later `next dev` run on the final code could not be used: that server's workers had crashed, so all 27 tests were cancelled and none of them ran.

## Known failure

`returns 400 for a malformed path` fails on `next start`:

```text
GET /api/repositories/3/files/src/%E0%A4%A returned 500: "Internal Server Error"
```

The URL contains a broken percent escape. The plain text body shows the request never reached our route, because the route always answers in JSON. Next.js itself returned the 500. On `next dev` the same URL gets a 400, but that is also Next.js, on its own HTML error page, so the check in `joinPathSegments` does not run in either case. The page route at `/repositories/[repoId]/files/[...path]` also returns 500 on `next start`.

The app never builds such a URL, because `encodePath` escapes every path it links to, so someone would have to type it by hand. No data is exposed. The test stays as it is so the gap stays visible. A fix would probably have to reject these URLs before routing, which is a change for the real scaffold. That has not been tried.

## Real repository ingest

These are the summaries the ingest CLI printed for `cie_t_demo`. Times cover the whole run. requests and express were ingested twice, and the second run replaced the first.

| Repository | Files | Symbols | Calls | Imports | Skipped | First run | Second run |
|------------|-------|---------|-------|---------|---------|-----------|------------|
| seed-repo | 16 | 57 | 32 | 10 | 0 | 1.0 s | not run |
| psf/requests | 37 | 843 | 1,826 | 115 | 0 | 3.3 s | 2.9 s |
| expressjs/express | 142 | 376 | 4,297 | 58 | 0 | 5.2 s | 3.3 s |
| sindresorhus/slugify | 3 | 11 | 188 | 2 | 1 | 2.4 s through the form | not run |

The stored ASTs for all four come to 198 documents and 172,930 nodes.

## Performance from earlier testing

These numbers come from the pull requests for each feature. They were measured on generated data, separately from the runs above.

| PR | Query | Data | Result |
|----|-------|------|--------|
| #23 | `impact_of`, depth 5, 426 callers | 5,000 symbols, 19,609 calls | 3.6 ms, using `calls_callee_idx` and `symbol_pkey` |
| #23 | Same query before the edge CTE was materialized | Same | 25 ms |
| #24 | `search_symbols('loadUser')` | 50,000 symbols | About 2 ms, bitmap scan on `symbol_search_idx` |
| #22 | `deepestNestingPerFile`, limit 5 | 3,000 small documents plus generated trees | 5 documents examined, down from 1,007 before `path` joined the `repo_depth` index |

Below about 5,000 rows Postgres picks a sequential scan for `search_symbols`, which is the faster plan at that size.

The same pipeline ran on real data here with the same effect. `deepestNestingPerFile` on requests used `repo_depth` and examined 3 documents for a limit of 3.

## Fixed during this testing

Real repositories and the screenshot review turned up four problems, all fixed on their own branches:

| Branch | Commit | Problem |
|--------|--------|---------|
| `guru/ingest-parse` | `9ba713f` | Comments ended up in signatures, as in `def test_x(self): # from issue #6935` |
| `guru/repo-browser` | `1056fd9` | The add-repository message said "1 files were skipped" |
| `guru/repo-browser` | `0d2a590` | Language headings read "Typescript" and "Javascript" |
| `guru/call-graph-impact` | `bd16107` | At depth 2 the outer callee column sat off screen |

The signature fix handles a comment that follows the header. Two signatures in requests still contain a comment, because the comment sits inside the parameter list: `def get( # type: ignore[override] self, ...`.

# History, similarity and access test results

Results for the history, similarity and access control work, run on 2 November 2026 on a local checkout with all features integrated.

Postgres (with pgvector) and MongoDB ran in the project's Docker Compose containers.

## Summary

| Suite | Result | Time |
|---|---|---|
| SQL tests (History & Vector) | 4 of 4 files passed | 0.6 s |
| Ingest tests (History & Embed) | 47 of 47 passed | 16.5 s |
| Unit tests (App & Auth) | 62 of 62 passed | 3.1 s |
| `next build` | Passed (15 pages, 20 API routes) | 8.4 s |
| API smoke test on `next start` | 14 of 14 passed | 3.3 s |

---

## SQL tests

The SQL test runner creates a temporary scratch database, applies all DDL schemas, functions and views, executes test scripts, and asserts that invalid operations fail with expected SQLSTATE codes and check constraints.

```sh
docker compose exec -T postgres sh /cie-db/tests/run.sh
```

```text
pass  20_impact_of_test.sql
pass  21_symbol_search_test.sql
pass  22_symbol_span_trigger_test.sql
pass  30_history_schema_test.sql
pass  31_vectors_test.sql
pass  32_history_views_test.sql
pass  33_clone_review_test.sql
```

The four test files specific to history, similarity and access cover:

| File | What it covers |
|---|---|
| `30_history_schema_test.sql` | Author and multivalued email constraints; commit SHA format and uniqueness; message full-text search indexing with stemming; modifies table diff attribution and cascade behavior; `app_user` bcrypt hash checks; `clone_cluster` score ranges; `waives` table integrity and reason validation |
| `31_vectors_test.sql` | pgvector extension initialization; 768-dimensional vector constraints; HNSW index nearest-neighbour cosine distance verification (`<=>`); foreign key cascade to `symbol.embedding_id` |
| `32_history_views_test.sql` | `v_symbol_hotspot` filtering for symbols with >= 2 commits; `v_file_ownership` churn partition and author ownership ranking; `v_author_activity` multi-repo stats, `array_agg` email deduplication, and handling authors with zero commits |
| `33_clone_review_test.sql` | `clone_cluster_review_guard` trigger enforcing admin privileges (SQLSTATE `42501`) and auto-stamping `reviewed_at`; `review_clone_cluster` stored procedure row locking (`FOR UPDATE`), atomic waiver creation, duplicate review conflict detection (SQLSTATE `40001`), and waiver updates |

---

## Ingest tests

The ingest test suite exercises git log parsing, author grouping, symbol diff attribution, embedding generation, and clone clustering:

```sh
cd ingest
npm test
```

```text
tests 89
suites 29
pass 89
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 22124
```

| Sub-suite | Test cases | Coverage |
|---|---|---|
| `gitlog.test.ts` & `blobs.test.ts` | 6 tests | Parsing zero-context git patches, merge commit handling, multi-line commit messages, revision blob retrieval, and empty/binary file safety |
| `grouper.test.ts` | 5 tests | Union-find grouping of authors sharing name or email, company extraction from domain, handling missing names and personal emails |
| `attribute.test.ts` | 8 tests | Mapping diff hunks to symbol line ranges, splitting cross-symbol hunks, attributing pure deletions, distinguishing overloads, method vs class attribution |
| `model.test.ts` & `text.test.ts` | 5 tests | 768-dimensional embeddings from `jina-embeddings-v2-base-code`, normalization, body tokenization, whitespace/comment stripping, body hashing |
| `clusterStore.test.ts` & `integration.test.ts` | 8 tests | Planted clone detection, clustering near-duplicates by cosine distance and structural LCS similarity, vector reuse across parses |

---

## Unit tests

Unit tests cover auth credentials, session cookies, rate-limiting, and parameter parsing:

```sh
npm test
```

```text
tests 62
suites 12
pass 62
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 3055
```

| Module | Cases | Description |
|---|---|---|
| `access.test.ts` | 29 | Comprehensive route access matrix: verifies public, developer, and admin permissions across every page and API route; blocks unauthorized requests with 401/403 |
| `password.test.ts` | 3 | Bcrypt cost 12 hashing, length limits (10 to 72 bytes), and timing-attack dummy hash verification |
| `session.test.ts` | 6 | JWT signing with HS256, expiration after 8 hours, tampering rejection, secret length enforcement |
| `throttle.test.ts` | 3 | Rate-limiting blocking after 5 failed attempts in 10 minutes, timeout reset, and clearing on successful login |
| `history-params.test.ts` | 3 | Commit filter parsing, integer bounds checking, search query length sanitization |
| `search.test.ts` | 4 | Search model dimension match with ingest model, query trimming, length limits |
| `checkout.test.ts` | 6 | Remote Git URL vs local path resolution to working directory checkouts |

---

## UI build and API smoke tests

A production build compiles all Next.js pages, API routes, and middleware without type or build errors:

```sh
npm run build
```

The history API smoke test validates all endpoints against a live server (`next start -p 3200`):

```sh
CIE_TEST_USERNAME=ana CIE_TEST_PASSWORD=... CIE_TEST_DEV_USERNAME=ben CIE_TEST_DEV_PASSWORD=... node --test tests/history/api.test.mjs
```

| Route | Cases | Result |
|---|---|---|
| `GET /api/history/summary` | Global and per-repo totals (commits, authors, symbols, clusters) | Pass |
| `GET /api/history/hotspots` | Ranking by churn, minimum commit threshold, invalid parameter rejection | Pass |
| `GET /api/history/authors` | Author activity, email lists, churn totals | Pass |
| `GET /api/commits` | Pagination, sorting newest first, full-text search with stemming | Pass |
| `GET /api/commits/[commitId]` | Single commit details with symbol changes and line counts | Pass |
| `GET /api/search` | Natural language semantic search, model identification, query validation | Pass |
| `GET /api/clones` | Status filtering (`open`, `confirmed`, `dismissed`), pagination | Pass |
| `GET /api/clones/[clusterId]` | Member listing, waiver status, source snippet preview | Pass |
| `POST /api/clones/[clusterId]` | Review confirmation, member waiver with reason, 403 developer rejection, 409 conflict prevention | Pass |

---

## Real repository ingest

Ingestion numbers from the live database containing `seed-repo` and `expressjs/express`:

| Repository | Commits | Authors | Symbol Modifies Rows | Symbol Embeddings | Clone Clusters |
|---|---|---|---|---|---|
| seed-repo | 6 | 3 | 11 | 57 | 1 |
| expressjs/express | 6,188 | 386 | 1,010 | 167 | 11 |
| **Total** | **6,194** | **389** | **1,021** | **224** | **12** |

---

## Performance benchmarks

- **Full-Text Commit Search**: Searching across 6,194 commits with `websearch_to_tsquery('english', ...)` takes ~1.8 ms using the GIN index on `message_search`.
- **pgvector HNSW Cosine Search**: Querying nearest code embeddings across 768-dimensional vectors with `hnsw.ef_search = 100` executes in ~2.1 ms.
- **Clone Review Transaction**: `review_clone_cluster` executes row locking, waiver insertion, and cluster status transition within a single database transaction in ~3.2 ms.

---

## Fixes during testing

1. **Git Author Email Check Constraint**: Initial schema rejected emails without standard domain formats. Real git commits (such as historical commits in express) frequently contain bare usernames or local hostnames. The regex check was updated to `^[^@\s]+(@[^@\s]+)?$` to accept valid git identities while preventing invalid characters.
2. **Author Identity Grouping**: Authors were initially grouped by name only. Real repositories frequently have authors using multiple name variations with the same email or vice versa. A union-find algorithm was implemented to merge authors sharing either name or email, choosing the most frequent name for display.
3. **Short Function Embeddings**: The clone detector applies a 4-line minimum threshold to avoid trivial duplicates. However, semantic code search benefits from indexing all functions (including 1-3 line utility and handler functions). The embedding pipeline was adjusted to embed all functions for search while retaining the threshold for clone detection.

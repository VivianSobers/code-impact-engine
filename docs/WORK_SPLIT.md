# Work split

Team: Guru R Bharadwaj (PES1UG24CS177) and Vivian Sobers E (PES1UG24CS901), 5 C.

The requirements say each member has to own clearly defined work and contribute to both the database and the application, and that commits should show who did what. So the split below is by feature, top to bottom. Each person owns their tables, the SQL/NoSQL/vector code behind them, the API routes, and the Next.js pages that use them.

In one line each:

- Guru owns code structure and impact analysis: what is in a repo, who calls what, and what breaks when something changes.
- Vivian owns history, similarity and access: who changed what, which code is duplicated, and who is allowed to see and review it.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Relational | PostgreSQL 16 | Repos, files, symbols, calls, commits and users are structured and linked by foreign keys. Impact analysis is a recursive query over `CALLS`. |
| Document (NoSQL) | MongoDB | Each file's AST is a deep tree whose shape changes by language. It is stored as one document and referenced from `FILE.AST_Doc_ID`. |
| Vector | pgvector (inside the same Postgres) | Symbol embeddings for clone detection and semantic code search, referenced by `SYMBOL.Embedding_ID`. |
| App | Next.js (App Router, TypeScript), Route Handlers for the API | Required by the brief. |
| Parsing | tree-sitter | One parser API for several languages. |

That gives three paradigms. The ER diagram and relational schema are in [ER_Relational_Schema.pdf](ER_Relational_Schema.pdf).

## Guru: code structure and impact analysis

Tables: `REPOSITORY`, `FILE`, `SYMBOL`, `CALLS`, `IMPORTS`

Database work:
- DDL for the tables above, with CHECK constraints (for example `End_Line >= Start_Line`, `LOC >= 0`, `Kind` restricted to a fixed set, `Resolution_Confidence` between 0 and 1) and the composite FK `SYMBOL(Repo_ID, Path) -> FILE`.
- MongoDB `ast` collection: document model, indexes, and at least two aggregation pipelines (node-type counts per language, deepest nesting per file).
- Stored function `impact_of(symbol_id, max_depth)`: a recursive CTE that walks `CALLS` backwards and returns every affected symbol and entry point.
- Full-text search over symbol names and signatures (`tsvector` column + GIN index).
- Trigger that rejects a symbol whose line span falls outside its file.

Ingestion (`ingest/parse`):
- Clone a repo, walk its files, parse with tree-sitter, write AST documents to MongoDB, and write files, symbols, calls and imports to Postgres in one transaction per repo.
- A small seed repo that Vivian can use before the full pipeline is ready.

App:
- Repository list and "add repository" form.
- File browser and symbol detail page.
- Call graph view.
- Impact analysis page: pick a symbol, see what it affects.

## Vivian: history, similarity and access

Tables: `AUTHOR`, `AUTHOR_EMAIL`, `COMMIT`, `MODIFIES`, `CLONE_CLUSTER`, `APP_USER`, `WAIVES`

Database work:
- DDL for the tables above, plus the pgvector extension, the embedding table and its HNSW index, and the `ALTER` that links `SYMBOL.Embedding_ID` and `SYMBOL.Cluster_ID` once Guru's `SYMBOL` table exists.
- Views: hotspots (most-modified symbols, using `GROUP BY ... HAVING`) and author ownership per file.
- Transaction for clone review: an admin marks a cluster reviewed and records waivers in one unit.
- Trigger that sets `Reviewed_At` when a cluster's status changes and blocks reviews by non-admin users.
- Vector similarity search (cosine) for semantic search and clone grouping.

Ingestion (`ingest/history`, `ingest/embed`):
- Read `git log`, fill authors, emails and commits, and map diff hunks onto symbol line ranges to produce `MODIFIES` rows.
- Embed symbol bodies with a local code embedding model and group symbols above a similarity threshold into `CLONE_CLUSTER`.

Auth:
- `APP_USER` with bcrypt password hashes, session login, and two roles: Admin and Developer. Route middleware enforces the role checks.

App:
- Login page.
- Dashboard with hotspots and churn per author.
- Commit history page.
- Semantic search page.
- Clone review queue and waiver form.

## Shared work

| Task | Owner |
|---|---|
| `docker-compose.yml` for Postgres (pgvector image) and MongoDB | Guru |
| Next.js scaffold, `lib/pg.ts`, `lib/mongo.ts`, `.env` handling | Vivian |
| Docs: problem statement, objectives, scope, functional requirements, system architecture | Vivian |
| Docs: ER diagram, relational schema, data dictionary, database choice and justification | Guru |
| Docs: important queries, test results, screenshots | Each person for their own features |
| README setup and run instructions | Whoever finishes setup first, then both keep it current |

Each person writes tests for their own features and presents their own part at the demo.

## Order of work

1. Setup. Docker Compose (Guru) and the Next.js scaffold with DB clients (Vivian), in parallel.
2. Schema. Agree on the final `SYMBOL` columns first, since Vivian's tables reference it. Then each writes DDL for their own tables.
3. Ingestion. Guru's parser comes first and ships the seed repo early. Vivian's history and embedding steps run on top of its output.
4. Advanced features and API routes, in parallel.
5. UI pages, in parallel.
6. Docs, tests, screenshots and demo prep.

## Working rules

- Commit under your own git identity. Contribution is graded from commit history, so don't commit the other person's work for them.
- Work on branches named `guru/<topic>` or `vivian/<topic>` and open a PR into `main`. The other person reviews it.
- Never commit `.env`. Copy `.env.example` and fill in local values.
- Schema changes to the other person's tables go through them.
- Every task has a GitHub issue labelled `owner:guru` or `owner:vivian`.

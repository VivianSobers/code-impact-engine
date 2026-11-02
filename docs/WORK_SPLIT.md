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


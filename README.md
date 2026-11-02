# Code Intelligence and Change Impact Analysis Engine

UE23CS351A Database Management Systems, Level 3 project. Guru R Bharadwaj (PES1UG24CS177) and Vivian Sobers E (PES1UG24CS901), class 5 C.

The engine ingests a Git repository, parses its source into files, symbols, call edges and imports, and records which commits touched which symbols. With that data it answers questions like:

- If I change this function, which callers and entry points are affected?
- Which parts of the code change most often, and who usually changes them?
- Where is code duplicated across the repo?
- Which function does what I am describing, even if I don't know its name?

## Stack

- PostgreSQL 16 for the relational core (repos, files, symbols, calls, commits, users)
- pgvector for symbol embeddings, clone detection and semantic search
- MongoDB for per-file ASTs
- Next.js (App Router, TypeScript) for the web app and API

## Repository layout

```
app/          Next.js app (pages and API route handlers)
db/
  schema/     DDL: tables, constraints, indexes
  views/      views
  functions/  stored functions, procedures and triggers
  seed/       sample data
ingest/
  parse/      clone + tree-sitter parsing -> Postgres and MongoDB
  history/    git log -> authors, commits, MODIFIES
  embed/      symbol embeddings and clone clustering
docs/         ER diagram, relational schema, project documentation
```

These folders get created as the work lands.

## Setup

You need Node 20 or newer, Git, and Docker with Compose.

Database credentials and secrets come from environment variables. Copy the template and fill it in; `.env` is git-ignored:

```sh
cp .env.example .env
```

Set `SESSION_SECRET` in `.env` to a random string of at least 32 characters, for example the output of `openssl rand -base64 32`. Sessions are signed with it.

Start Postgres (with pgvector) and MongoDB:

```sh
docker compose up -d
```

On the first start the Postgres container applies every `.sql` file in `db/schema`, `db/functions`, `db/views` and `db/seed`, in that folder order and in filename order inside each folder. It only does this when the data volume is new. After adding or changing a SQL file, recreate the volume with `docker compose down -v` (this deletes the local data) or apply the file with `psql`.

Install the app and the ingest tools, then load the seed repository:

```sh
npm install
cd ingest
npm install
npm run seed
npm run history -- seed-repo
npm run embed -- seed-repo
cd ..
```

`npm run seed` parses the seed repository, `npm run history` reads its commits and `npm run embed` embeds its functions and finds duplicated code. The first `embed` downloads the embedding model (about 160 MB). For another repository, run `npm run parse -- <git-url-or-path>`, then `npm run history -- <name>` and `npm run embed -- <name>`; see [ingest/README.md](ingest/README.md).

Create the first admin account. The script asks for the password (at least 10 characters) without showing it:

```sh
npm run user:create -- --username admin --role admin
```

Admins can add more users, as admins or developers, from the Users page. Developers can browse everything; only admins can add repositories, review clone clusters and manage users.

Run the app:

```sh
npm run dev
```

It listens on http://localhost:3000. For a production build use `npm run build` and then `npm start`.

### Tests

```sh
npm test                                  # app unit tests
npm run typecheck                         # app type check
cd ingest && npm test                     # parser tests
docker compose exec -T postgres sh /cie-db/tests/run.sh   # SQL tests in a scratch database
CIE_TEST_USERNAME=admin CIE_TEST_PASSWORD=... node --test tests/structure/api.test.mjs  # Structure API smoke test
CIE_TEST_USERNAME=ana CIE_TEST_PASSWORD=... node --test tests/history/api.test.mjs      # History & clones API smoke test
```

## Documentation

- [Project overview: problem, objectives, scope, requirements, architecture](docs/PROJECT_OVERVIEW.md)
- [ER diagram and relational schema](docs/ER_Relational_Schema.pdf)
- [Database design: mapping, data dictionary and storage choices](docs/DATABASE_DESIGN.md)
- [Work split between team members](docs/WORK_SPLIT.md)
- [Code structure queries](docs/STRUCTURE_QUERIES.md)
- [Code structure test results](docs/STRUCTURE_TEST_RESULTS.md)
- [Code structure screenshots](docs/STRUCTURE_SCREENSHOTS.md)
- [History, similarity and access queries](docs/HISTORY_QUERIES.md)
- [History, similarity and access test results](docs/HISTORY_TEST_RESULTS.md)
- [History, similarity and access screenshots](docs/HISTORY_SCREENSHOTS.md)

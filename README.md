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

Setup and run instructions will go here once `docker-compose.yml` and the Next.js app exist. Database credentials come from environment variables. Copy `.env.example` to `.env` and fill it in; `.env` is git-ignored.

## Documentation

- [ER diagram and relational schema](docs/ER_Relational_Schema.pdf)
- [Database design: mapping, data dictionary and storage choices](docs/DATABASE_DESIGN.md)
- [Work split between team members](docs/WORK_SPLIT.md)

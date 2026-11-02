# Database design

This document covers the ER model, how it maps to relations, the data dictionary, and why the project uses three kinds of storage. The diagrams are in [ER_Relational_Schema.pdf](ER_Relational_Schema.pdf). The DDL for the code structure tables is in [db/schema/10_structure.sql](../db/schema/10_structure.sql).

## ER model

The model has seven entity sets. FILE is weak and depends on REPOSITORY.

| Entity set | Key | Notes |
|---|---|---|
| REPOSITORY | Repo_ID | A Git repository that has been ingested. |
| FILE | (Repo_ID, Path) | Weak entity. Path only identifies a file inside its repository. |
| SYMBOL | Symbol_ID | A function, method, class, interface, enum, or the module-level scope of a file. Span is a composite attribute (Start_Line, End_Line). Length is derived. |
| AUTHOR | Author_ID | A person who committed code. Email is multivalued, since one person often commits from several addresses. |
| COMMIT | Commit_ID | A commit in one repository by one author. |
| CLONE_CLUSTER | Cluster_ID | A group of symbols whose bodies are near duplicates. |
| APP_USER | User_ID | Someone who logs into the web app, either an Admin or a Developer. |

Relationship sets and their cardinalities:

| Relationship | Between | Cardinality | Participation | Attributes |
|---|---|---|---|---|
| CONTAINS (identifying) | REPOSITORY, FILE | 1 : N | FILE total | |
| DECLARES | FILE, SYMBOL | 1 : N | SYMBOL total | |
| IMPORTS (recursive) | FILE as Importer, FILE as Imported | M : N | partial | |
| CALLS (recursive) | SYMBOL as Caller, SYMBOL as Callee | M : N | partial | Call_Line, Resolution_Confidence |
| RECORDED_IN | REPOSITORY, COMMIT | 1 : N | COMMIT total | |
| AUTHORED_BY | AUTHOR, COMMIT | 1 : N | COMMIT total | |
| MODIFIES | COMMIT, SYMBOL | M : N | partial | Additions, Deletions, Change_Type |
| GROUPS | CLONE_CLUSTER, SYMBOL | 1 : N | partial | |
| REVIEWS | APP_USER, CLONE_CLUSTER | 1 : N | partial | Reviewed_At |
| WAIVES | APP_USER, SYMBOL | M : N | partial | Reason, Waived_At |

## Mapping to relations

Each rule below was applied once to get from the diagram to the twelve relations in the PDF.

1. Strong entity sets become relations with their simple attributes. REPOSITORY, SYMBOL, AUTHOR, COMMIT, CLONE_CLUSTER and APP_USER map this way.
2. FILE is weak, so its key is the owner's key plus its discriminator: (Repo_ID, Path). The identifying relationship CONTAINS needs no relation of its own.
3. The composite attribute Span is flattened into Start_Line and End_Line. No Span column exists.
4. The derived attribute Length is not stored. Queries compute it as `end_line - start_line + 1`.
5. The multivalued attribute Email becomes AUTHOR_EMAIL(Author_ID, Email), keyed on both columns.
6. For each 1 : N relationship, the key of the "1" side goes into the "N" side as a foreign key. SYMBOL gets (Repo_ID, Path) from DECLARES and Cluster_ID from GROUPS. COMMIT gets Repo_ID and Author_ID. CLONE_CLUSTER gets Reviewed_By and Reviewed_At from REVIEWS.
7. Each M : N relationship becomes its own relation keyed on both participants' keys, plus its descriptive attributes. That gives CALLS, IMPORTS, MODIFIES and WAIVES. CALLS adds Call_Line to the key so that one function calling another on two different lines gives two rows.
8. CALLS and IMPORTS are recursive, so their two foreign keys point at the same relation. Role names (Caller/Callee, Importer/Imported) keep the column names apart.
9. Total participation becomes NOT NULL on the foreign key: SYMBOL(repo_id, path), FILE(repo_id), COMMIT(repo_id) and COMMIT(author_id).

## Normal form

All twelve relations are in BCNF. In the code structure tables the only non-trivial functional dependencies have a key on the left.

- REPOSITORY: repo_id determines everything. url is also a candidate key, enforced with UNIQUE.
- FILE: (repo_id, path) determines language, loc, content_hash and ast_doc_id. content_hash does not determine path, because two files can have identical contents.
- SYMBOL: symbol_id determines every column. (repo_id, path, kind, name, start_line) is a second candidate key, enforced with UNIQUE, and nothing smaller determines the rest.
- CALLS: (caller_id, callee_id, call_line) determines resolution_confidence.
- IMPORTS: all four columns form the key and there are no other attributes.

Neither the repository name nor a file's language is copied into SYMBOL. They are reached through the foreign keys, so a rename or a language fix touches one row.

## Data dictionary

Types are PostgreSQL 16 types. "PK" is the primary key, "FK" a foreign key.

### repository

| Column | Type | Null | Default | Constraints | Meaning |
|---|---|---|---|---|---|
| repo_id | bigint | no | identity | PK | Surrogate key. |
| name | text | no | | not blank | Display name, usually the repo name from the URL. |
| url | text | no | | UNIQUE | Clone URL or local path the repo was ingested from. Ingesting the same URL again updates this row. |
| default_branch | text | no | 'main' | not blank | Branch that was parsed. |
| added_date | timestamptz | no | now() | | When the repo was first added. |

### file

| Column | Type | Null | Default | Constraints | Meaning |
|---|---|---|---|---|---|
| repo_id | bigint | no | | PK, FK to repository, ON DELETE CASCADE | Owning repository. |
| path | text | no | | PK, relative, no leading slash, no backslashes | Path inside the repo with forward slashes. |
| language | text | no | | one of javascript, typescript, python, java, go | Language the parser used. |
| loc | integer | no | 0 | >= 0 | Total number of lines in the file, blank lines included. |
| content_hash | char(64) | no | | lowercase hex SHA-256 | Hash of the file contents, used to skip unchanged files and spot identical copies. |
| ast_doc_id | char(24) | yes | | lowercase hex ObjectId | `_id` of the file's document in the MongoDB `ast` collection. Null when the file has no stored AST. |

### symbol

| Column | Type | Null | Default | Constraints | Meaning |
|---|---|---|---|---|---|
| symbol_id | bigint | no | identity | PK | Surrogate key. |
| repo_id | bigint | no | | FK (repo_id, path) to file, ON DELETE CASCADE, ON UPDATE CASCADE | Repository of the declaring file. |
| path | text | no | | part of the same FK | Declaring file. |
| name | text | no | | not blank | Symbol name. For a module symbol, the file path. |
| kind | text | no | | one of function, method, class, interface, enum, module | What kind of declaration it is. |
| signature | text | yes | | | Declaration header on one line, for display and search. |
| start_line | integer | no | | >= 1 | First line, 1-based. |
| end_line | integer | no | | >= start_line, <= file.loc (trigger) | Last line. |
| is_entry_point | boolean | no | false | | True when the symbol is reached from outside the repo, such as `main`, a route handler, or an exported function nothing in the repo calls. Impact analysis reports these separately. |
| embedding_id | bigint | yes | | FK added in Vivian's DDL | Row in the embedding table. |
| cluster_id | bigint | yes | | FK to clone_cluster, added in Vivian's DDL | Clone cluster the symbol belongs to. |
| search_vector | tsvector | yes | generated, stored | | Name and signature split into words for full-text search. `getUserById` is indexed as `getuserbyid`, `get`, `user`, `by` and `id`. Name words get weight A and signature words weight B. Defined in [11_symbol_search.sql](../db/schema/11_symbol_search.sql). |

Other constraints: UNIQUE (repo_id, path, kind, name, start_line). Indexes on name, a partial index on repo_id where is_entry_point, and a GIN index on search_vector.

Two triggers keep spans inside their files, since a CHECK cannot read another table. `symbol_within_file` runs before a symbol is inserted, or before its span or file changes, and rejects an end_line past the file's loc. `file_keeps_symbols` rejects lowering a file's loc below a symbol it already holds. Both raise `check_violation` with constraint name `symbol_within_file`. They are in [22_symbol_span_trigger.sql](../db/functions/22_symbol_span_trigger.sql).

### calls

| Column | Type | Null | Default | Constraints | Meaning |
|---|---|---|---|---|---|
| caller_id | bigint | no | | PK, FK to symbol, ON DELETE CASCADE | Symbol that contains the call. Top-level calls use the file's module symbol. |
| callee_id | bigint | no | | PK, FK to symbol, ON DELETE CASCADE | Symbol being called. |
| call_line | integer | no | | PK, >= 1 | Line of the call site in the caller's file. |
| resolution_confidence | numeric(3,2) | no | | between 0 and 1 | How sure the parser is that the call goes to this callee. 1.00 means a same-file definition; low values mean the name matched several candidates. |

Index on callee_id, because impact analysis walks the table from callee to caller.

### imports

| Column | Type | Null | Default | Constraints | Meaning |
|---|---|---|---|---|---|
| importer_repo_id | bigint | no | | PK, FK (importer_repo_id, importer_path) to file | Repository of the importing file. |
| importer_path | text | no | | PK, part of the same FK | File that contains the import statement. |
| imported_repo_id | bigint | no | | PK, FK (imported_repo_id, imported_path) to file | Repository of the imported file. |
| imported_path | text | no | | PK, part of the same FK | File being imported. |

A CHECK stops a file from importing itself. Imports of third-party packages are not stored because they have no FILE row. Index on (imported_repo_id, imported_path) for "who imports this file".

### Stored functions

| Function | Returns | Purpose |
|---|---|---|
| `impact_of(p_symbol_id bigint, p_max_depth integer DEFAULT 5)` | symbol_id, repo_id, path, name, kind, depth, is_entry_point, min_confidence, call_path | Every symbol that calls the target directly or through other calls, up to p_max_depth levels. Each symbol appears once, at its shallowest depth. call_path lists the symbol IDs from the affected symbol down to the target, and min_confidence is the weakest call on that path. Raises 22023 for a depth outside 1 to 50 and P0002 for an unknown symbol. |
| `search_symbols(p_query text, p_repo_id bigint DEFAULT NULL, p_limit integer DEFAULT 50)` | symbol_id, repo_id, path, name, kind, signature, start_line, end_line, rank | Ranked full-text search over search_vector. Each word of the query matches as a prefix, so `get user` finds `getUserById`. |
| `symbol_name_parts(text)` | text | Splits camelCase, PascalCase and snake_case into words. Used by search_vector. |

### History, similarity and access tables

Vivian's DDL (issue #12) defines these. The columns and keys below come from the relational schema; her DDL fixes the exact types.

| Relation | Key | Other columns | Foreign keys |
|---|---|---|---|
| AUTHOR | Author_ID | Name, Company | |
| AUTHOR_EMAIL | (Author_ID, Email) | | Author_ID to AUTHOR |
| COMMIT | Commit_ID | Repo_ID, Author_ID, Message, Committed_At | Repo_ID to REPOSITORY (not null), Author_ID to AUTHOR (not null) |
| MODIFIES | (Commit_ID, Symbol_ID) | Additions, Deletions, Change_Type | Commit_ID to COMMIT, Symbol_ID to SYMBOL |
| CLONE_CLUSTER | Cluster_ID | Similarity_Score, Status, Detected_At, Reviewed_By, Reviewed_At | Reviewed_By to APP_USER |
| APP_USER | User_ID | Username, Password_Hash, Role, Created_At | |
| WAIVES | (User_ID, Symbol_ID) | Reason, Waived_At | User_ID to APP_USER, Symbol_ID to SYMBOL |

### MongoDB `ast` collection

Each parsed file has one document, linked from `file.ast_doc_id`. The document model, validator, indexes and aggregation pipelines are described in [MONGODB_AST.md](MONGODB_AST.md).

## Why three kinds of storage

### PostgreSQL for the code structure

Repositories, files, symbols, calls and imports are fixed in shape and heavily linked. Every symbol belongs to exactly one file, and every call joins two symbols. Foreign keys with cascades let one transaction replace a repository's whole structure without leaving dangling calls behind. CHECK constraints catch parser bugs at insert time, such as an inverted span or a confidence of 1.5.

The main question the engine answers is "what breaks if I change this?". That means following CALLS backwards a few levels. A recursive CTE handles it in PostgreSQL, with the callee index keeping each step an index lookup. We considered a graph database such as Neo4j. It would make traversal syntax shorter, but the call graph would then live apart from the commits and clone data it gets joined with, and every query would cross two systems. The graphs here are per repository and a few levels deep, which SQL handles well.

PostgreSQL also gives full-text search over symbol names and signatures through a `tsvector` column and a GIN index, so search needs no separate engine.

### MongoDB for ASTs

A syntax tree has a different shape for every language and every file. A JavaScript arrow function, a Python decorator and a Go method receiver produce different node types and nesting. Storing the trees relationally would need a generic node table with tens of thousands of rows per file and a self-join for every level of nesting. Nothing ever joins an individual AST node to another table. The app reads a file's tree as a unit, or aggregates over nodes, for example to count node types per language.

That fits a document store: one document per file, fetched by key, with aggregation pipelines for the statistics. The relational side keeps only `ast_doc_id`, so a file row stays small and the ASTs can be rebuilt without touching the relational data.

### pgvector for embeddings

Clone detection and semantic search compare symbol embeddings by cosine distance. pgvector adds a vector type and an HNSW index to the same PostgreSQL instance. A nearest-neighbour query can then join straight to SYMBOL, FILE and CLONE_CLUSTER, and embeddings are dropped in the same transaction as the symbols they describe. A separate vector database would have meant a third server and keeping its IDs in sync with SYMBOL by hand.

### Summary

| Need | Store | Reason |
|---|---|---|
| Structure, history, users | PostgreSQL 16 | Fixed schema, foreign keys, transactions, recursive queries |
| Per-file syntax trees | MongoDB 7 | Schema varies by language, read as a whole, aggregated over nodes |
| Symbol embeddings | pgvector | Similarity search next to the rows it joins with |

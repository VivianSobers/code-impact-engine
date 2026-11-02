# Ingest

`ingest/` is a Node package with its own `package.json`. `parse/` clones a repository, parses its JavaScript, TypeScript, Python, Java and Go files with tree-sitter, stores one AST document per file in MongoDB, and writes files, symbols, calls and imports to Postgres. Vivian's `history/` and `embed/` steps run on top of its output.

## Setup

Node 20 or newer, plus the Postgres and Mongo containers from the root `docker-compose.yml`.

```
cd ingest
npm install
```

Parsing uses `web-tree-sitter` 0.22.6 with the prebuilt grammars in `tree-sitter-wasms` 0.1.13, so nothing is compiled during install. Both versions are pinned. Newer `web-tree-sitter` releases cannot load these wasm files.

Settings come from the environment and fall back to the repo root `.env`:

| Variable | Used for |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `MONGODB_URI` | Mongo connection string |
| `MONGODB_DB` | Mongo database name, `cie` if unset |

## Parsing a repository

```
npm run parse -- https://github.com/psf/requests.git
npm run parse -- ../some/local/checkout --name shop
npm run parse -- https://github.com/acme/shop.git --branch develop
```

| Option | Meaning |
|---|---|
| `--name` | Repository name. Defaults to the last part of the URL or path. |
| `--branch` | Branch to check out. Defaults to the remote's default branch. For a local path it must match what is checked out. |
| `--url` | Value stored in `repository.url`. Defaults to the git URL, or the absolute path for a local directory. |

Git URLs get a full clone into `ingest/workdir/<owner>-<repo>`, and later runs fetch into the same directory. History is kept, so the history step can read `git log` from there. Local paths are read in place: tracked files if the directory is a git checkout, every file otherwise.

Progress goes to stderr. The last line on stdout is a JSON summary:

```
{"repoId":9,"name":"requests","files":37,"symbols":843,"calls":1826,"imports":115,"skipped":0,"durationMs":3481}
```

On failure the exit code is 1 and the error is on stderr. From code, call `ingestRepository({ target, name, branch, url })` from `parse/src/index.ts`. It returns the same summary.

Running the same repository again replaces its rows. The repository keeps its `repo_id`, and its old files are deleted (symbols, calls and imports go with them through the cascades) before the new rows are inserted. Any table that references `symbol` without `ON DELETE CASCADE` will block a re-ingest.

## What gets stored

Everything on the Postgres side for one repository happens in a single transaction:

1. Upsert `repository` by URL.
2. Write each file's AST to the Mongo `ast` collection, upserting by `(repo_id, path)`.
3. Delete the repository's old `file` rows.
4. Insert `file`, `symbol`, `calls` and `imports` in batches of up to 5000 rows.

If anything fails, the transaction rolls back and the Mongo documents created during the run are deleted. After a successful commit, Mongo documents for paths that no longer exist are removed.

`file.loc` is the number of lines, counting a last line without a trailing newline. Every symbol satisfies `1 <= start_line <= end_line <= loc`. Each non-empty file also gets a `module` symbol named after its path and spanning the whole file. Calls made at the top level of a file use it as the caller.

AST documents store the named nodes of the tree as a flat pre-order array (`i`, `p` parent index, `t` type, `d` depth, `f` field name, `s` and `e` positions, `n` text for short leaves), capped at 50000 nodes. The document model, validator and pipelines are described in `docs/MONGODB_AST.md`.

## Symbols

| Language | Symbols |
|---|---|
| JavaScript, TypeScript | function declarations, functions and classes assigned to variables, classes, methods, function-valued class fields, interfaces, enums, `exports.x = function`, `obj.x = function` and `X.prototype.y = function` |
| Python | functions, classes, methods |
| Java | classes, records, interfaces, enums, methods, constructors |
| Go | functions, methods (owned by their receiver type), struct types, interface types |

Declarations without a body, such as TypeScript overload signatures and interface method signatures, are skipped. The signature is the declaration header up to the body, collapsed onto one line and cut at 240 characters.

## Imports

| Language | Resolution |
|---|---|
| JavaScript, TypeScript | relative paths with extension and `index` lookup, `.js` specifiers that point at `.ts` files, `@/` and `~/` aliases to the root or `src/`, `require()` and `export ... from` |
| Python | dotted modules (also under a source root such as `src/`), relative imports, `from pkg import module` |
| Java | class imports by package path, static imports, wildcard imports of a package directory |
| Go | import paths matched against repo directories by suffix, with an edge to every `.go` file in the directory |

Imports that do not resolve to a file in the repository count as third party. Calls through names bound by them are dropped.

## Call resolution

Each call site has a callee name, a line, and a receiver: none, `this`/`self`, a name such as `service` or `fmt`, or another expression. Calls are matched by name, trying these rules in order and stopping at the first that finds something:

| Match | Confidence |
|---|---|
| Function or class defined in the same file | 1.00 |
| Method of the caller's own class through `this`, `self` or the Go receiver | 0.95 |
| Name imported from a resolved file, or a member of an imported module or package | 0.90 |
| Method on a receiver whose type is known from a parameter, field or `new X()` | 0.85 |
| Function in the same Go package or class in the same Java package | 0.85 |
| Static call on a class name, or a name from a wildcard import | 0.80 |
| Function or class whose name is unique in the repo | 0.60 |
| Method with that name when the receiver's type is unknown | 0.40 |

When a rule finds several candidates, each gets the confidence divided by the number of candidates, with a floor of 0.10. The two repo-wide rules give up when more than eight symbols share the name. They also skip common built-in member names such as `push`, `map`, `append` and `Println`. A call that matches nothing is dropped. The pair `(caller, callee, line)` is stored once, with the highest confidence found.

## Entry points

A symbol gets `is_entry_point = true` when it is:

- a `main` function in Go's `main` package, or a static `main` method in Java
- the module symbol of a Python file with an `if __name__ == "__main__"` block
- the module symbol of a JavaScript, TypeScript or Python file that nothing imports and that makes calls at the top level, such as a script
- an exported `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD` or `OPTIONS` function in a Next.js `route.ts` or `route.js`
- an exported top-level function or class that nothing in the repository calls. Exported means `export` or `module.exports` in JS and TS, public in Java, capitalised in Go and not starting with `_` in Python. Go struct types are left out because Go code never calls them.

## Skipped files

Files under `node_modules`, `vendor`, `third_party`, `dist`, `build`, `out`, `.next`, `coverage`, `__pycache__` and virtualenv directories are skipped. So are minified bundles, `.d.ts`, protobuf and other generated files, files over 1 MB, files with lines over 5000 characters or an average line over 300, and files containing NUL bytes. They are counted in `skipped`.

## History

```
npm run history -- seed-repo
npm run history -- 3
```

`history/` runs after the parser. It takes a repository name, URL or `repo_id`, reads `git log` from the checkout the parser used (`ingest/workdir/<owner>-<repo>` for a git URL, the original directory for a local path) and fills `author`, `author_email`, `commit` and `modifies`. The last line on stdout is a JSON summary:

```
{"repoId":1,"commits":10,"authors":3,"modifies":53,"unmatched":0,"durationMs":283}
```

Every commit on every branch is read, oldest first, with a zero-context patch. Merge commits are stored but get no changes of their own, since their changes are already counted on the commits that made them.

For each changed file in a supported language, the step parses the file before and after the commit with the same extractor as the parser, then counts the added lines that fall inside each symbol's new span and the removed lines inside its old span. A line inside a method counts for the method and for its class. Module symbols are left out. A symbol that did not exist before the commit is `added`, otherwise `modified`. File versions are read through one `git cat-file --batch` process and parsed once per blob.

Changes are matched to the current symbols of the repository by path, kind, name and position among symbols with the same name. Changes to code that has since been deleted, renamed or moved to another file have no current symbol and are counted as `unmatched`. On express (6184 commits) that was 2356 of 3324 symbol changes, while all 71 symbols in `lib/` got history.

Commits are grouped into people when they share a name (ignoring case and spacing) or an email address, which is how one person with two addresses becomes one author with two `author_email` rows. The name is the spelling used most often. The company comes from the domain of the latest work address; personal and no-reply domains such as gmail.com or users.noreply.github.com give no company.

Running the step again replaces the repository's commits and changes in one transaction. Authors are shared between repositories, so they are only added or updated. Re-running the parser deletes the repository's symbols and with them its `modifies` rows, so run `history` again after `parse`.

## Embeddings and clones

```
npm run embed -- seed-repo
```

`embed/` runs after the parser. It embeds every function and method of four or more lines with [jina-embeddings-v2-base-code](https://huggingface.co/jinaai/jina-embeddings-v2-base-code), run locally through `@huggingface/transformers` (8-bit weights, 768 dimensions, mean pooling, unit length). The first run downloads the model, about 160 MB, into `.cache/models` at the project root. The last line on stdout is a JSON summary:

```
{"repoId":3,"symbols":162,"embedded":162,"reused":0,"clusters":12,"durationMs":27523}
```

The text embedded is the symbol's own source lines, cut at 4000 characters. Vectors go into `symbol_embedding` (pgvector, HNSW index with cosine distance), one row per model and SHA-256 of that text, and `symbol.embedding_id` points at it. Identical bodies share a vector, and running the step again, or after a re-parse, only embeds bodies that changed: the second run on express embedded nothing and took under half a second.

Clone detection then rebuilds the repository's open clusters in one transaction:

1. For each symbol, pgvector returns its five nearest neighbours by cosine distance. Neighbours with similarity of at least 0.70 are candidates.
2. A candidate is a clone when the two bodies have the same token structure: keywords and punctuation in the same order, with names, strings and numbers blanked out, scoring at least 0.85 (twice the longest common subsequence over the total length).
3. Clones connected through each other form one cluster. `clone_cluster.similarity_score` is the lowest cosine similarity between linked members.

The structure check is there because embeddings measure what code does more than how it is written. On express, copies that only rename things scored 0.78 to 0.84 cosine, the same range as unrelated functions with a similar job (`restrict` and `andRestrictToSelf` scored 0.78). Their structure scores were 0.96 to 1.0 against 0.79 for that pair. With these thresholds express gets 12 clusters covering 56 symbols, and all 10 clusters read by hand in a random sample were real copy-and-adapt duplicates. That is one reviewer's reading of one repository, not a measured precision, and clones the embedding search does not rank in the top five are missed.

Symbols in confirmed or dismissed clusters, and symbols someone has waived, are left out when clusters are rebuilt, so a review is not undone by the next run.

## Seed repository

```
npm run seed
```

builds `ingest/workdir/seed-repo` and ingests it with the URL `ingest/workdir/seed-repo`. The project is a small shop in TypeScript, JavaScript, Python, Go and Java, with ten commits by three authors between 1 and 10 September 2026. Ben Okafor commits under two emails. Dates and authors are fixed, so the history is identical on every machine (HEAD `c82d23f`). It ingests to 16 files, 57 symbols, 32 calls and 10 imports.

The graph is built for impact analysis demos:

- `roundCurrency` in `src/lib/money.ts` is reached from `POST` in `src/app/api/orders/route.ts` through `OrderService.create`, `priceOrder` and `applyDiscount`, and from `formatMoney`.
- `parseAddress` and `normalizeAddress` call each other.
- Entry points include the `GET` and `POST` route handlers, `scripts/daily_report.py`, the Go `main`, the Java `main` and `toCsv`.

`db/seed/10_structure_seed.sql` has the same structure rows with ids starting at 1. A fresh database can load it without running the parser. Regenerate it after changing the seed repo or the parser:

```
npm run seed
npm run seed:sql
```

## Tests

```
npm test
npm run typecheck
```

`npm test` runs the test files one at a time, because the parser, history and embedding integration tests all rebuild `workdir/seed-repo`. The unit tests need no database. The integration test builds the seed repo and ingests it twice into Postgres database `cie_t_ingest` and Mongo database `cie_t_ingest`, applying `db/schema` and `db/functions` first if the tables are missing. It skips with a message when either database is unreachable. Override the targets with `INGEST_TEST_DATABASE_URL`, `INGEST_TEST_MONGODB_URI` and `INGEST_TEST_MONGODB_DB`. The history and embedding integration tests use their own databases, `cie_t_history` and `cie_t_embed`, on the same server (`INGEST_TEST_SERVER_URL`, default `postgresql://cie:change-me@localhost:5432`) and create them when they are missing, so they only skip when the server itself is unreachable. The embedding tests load the real model.

## Limitations

- Resolution goes by name. There is no type checker, so calls through interfaces, callbacks, dynamic dispatch, decorators and computed property names are missed or matched at low confidence.
- Local types are tracked per file, not per scope. A name given two different types in one file is ignored for typed resolution.
- `tsconfig.json` paths, Python `sys.path` changes and Go `replace` directives are not read.
- Each run parses the whole repository again. Unchanged files are not skipped.

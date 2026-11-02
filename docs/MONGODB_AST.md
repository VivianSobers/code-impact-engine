# MongoDB: the ast collection

The ingester parses every source file with tree-sitter and stores the syntax tree in MongoDB, one document per file. Postgres keeps the structured facts drawn from the tree (files, symbols, calls, imports). MongoDB keeps the tree itself. `FILE.AST_Doc_ID` in Postgres holds the hex form of the document's `_id`, which is how the two stores link.

Syntax trees suit a document store. Their shape depends on the language: a Python `function_definition` and a Go `function_declaration` have different children and fields, and the grammars change between versions. A relational table for AST nodes would need either one generic node table with a column per possible field or a table per language. A document can hold whatever the grammar produced.

## Document model

Database `cie` (or `MONGODB_DB`), collection `ast`.

```js
{
  _id: ObjectId("6ae8237353e27ed593760389"),
  repo_id: 1,
  path: "src/util/retry.js",
  language: "javascript",
  content_hash: "3f1c...e9",
  parser: { name: "tree-sitter", grammar: "tree-sitter-javascript" },
  parsed_at: ISODate("2026-11-02T05:40:00Z"),
  loc: 35,
  node_count: 35,
  max_depth: 23,
  truncated: false,
  nodes: [
    { i: 0, p: -1, t: "program",              d: 0, f: null,   s: [0, 0], e: [34, 1], n: null },
    { i: 1, p: 0,  t: "function_declaration", d: 1, f: null,   s: [1, 2], e: [34, 3], n: null },
    { i: 2, p: 1,  t: "identifier",           d: 2, f: "name", s: [2, 4], e: [2, 5],  n: "retry" },
    ...
  ]
}
```

| Field | Meaning |
|---|---|
| `repo_id`, `path` | The Postgres `FILE` key. Unique together. |
| `language` | One of the five languages the parser supports, the same set as the `file_language_known` check in Postgres. |
| `content_hash` | SHA-256 of the file contents, equal to `FILE.Content_Hash`. The ingester uses it to skip files that have not changed. |
| `parser` | Which tree-sitter grammar produced the tree. |
| `loc` | Line count, equal to `FILE.LOC`. |
| `node_count`, `max_depth` | Size and depth of the stored tree, computed at parse time so queries can sort and filter without reading `nodes`. |
| `truncated` | True when the file had more than 50,000 named nodes and the rest were dropped. |
| `nodes[].i`, `nodes[].p` | The node's own index in the array and its parent's index (`-1` for the root). `i` always equals the array position. |
| `nodes[].t` | tree-sitter node type. |
| `nodes[].d` | Depth, root is 0. |
| `nodes[].f` | Field name the node has in its parent (`name`, `body`, `condition`), or null. |
| `nodes[].s`, `nodes[].e` | Start and end as `[row, column]`, both 0-based. |
| `nodes[].n` | Source text for identifier-like leaves, at most 64 characters, otherwise null. |

### Why the tree is stored flat

The obvious shape is a nested tree with each node holding its `children`. We store a flat pre-order array with parent pointers instead, for three reasons.

1. BSON allows at most 100 levels of nesting. In a nested layout each AST level costs two BSON levels (the node object and its `children` array), so any file deeper than about 50 syntax levels could not be stored. Long callback chains in JavaScript and generated code reach that.
2. A document is capped at 16 MB. Keeping only named nodes, with short field names, and capping the array at 50,000 entries keeps even large files well under it.
3. Aggregation is simpler. `$unwind: "$nodes"` turns every node into a row, which is all the node-type statistics need. With a nested tree the same count needs `$graphLookup` or a recursive function.

Parent pointers keep the structure. Because `i` equals the array position, `$arrayElemAt: ["$nodes", p]` jumps from a node to its parent, which the deepest-nesting pipeline uses to rebuild the chain of ancestors.

Anonymous nodes (punctuation, keywords such as `(` or `return`) are dropped. They add bulk and say nothing the named node types do not already say.

## Validator

`db/mongo/ast.schema.json` is a `$jsonSchema` validator applied with `validationLevel: "moderate"` and `validationAction: "error"`. It requires every top-level field, rejects unknown fields, restricts `language` to the five supported values, requires `content_hash` to be 64 lowercase hex characters, and requires `path` to be relative with forward slashes. Every node must have all eight keys with the right types, and `s` and `e` must be pairs of non-negative integers.

Inserting bad documents into a test database gave:

```
rejected missing nodes: 121
rejected unknown language: 121
rejected absolute path: 121
rejected bad node shape: 121
rejected duplicate repo/path: 11000
```

121 is `DocumentValidationFailure`. 11000 is the unique index on `(repo_id, path)`.

## Indexes

Defined in `db/mongo/ast.indexes.json`.

| Name | Key | Used for |
|---|---|---|
| `repo_path_unique` | `{ repo_id: 1, path: 1 }`, unique | Looking up one file's tree from the file page, upserts from the ingester, and the `$match` on `repo_id` at the start of every per-repo pipeline. Also stops two documents claiming the same file. |
| `repo_depth` | `{ repo_id: 1, max_depth: -1, path: 1 }` | `deepestNestingPerFile`. The pipeline sorts by `max_depth` descending and then `path`, so with this index the planner reads files in the right order and stops after `limit` entries. |
| `repo_language` | `{ repo_id: 1, language: 1 }` | Listing one repo's files in a given language. |
| `language` | `{ language: 1 }` | Language statistics across all repositories. |
| `content_hash` | `{ content_hash: 1 }` | Finding identical files across repos and checking whether a file's tree is already stored before reparsing it. |

The effect of `repo_depth` shows in `explain("executionStats")` on a test set of 3000 documents. When the index held only `repo_id` and `max_depth`, the tie-break on `path` still forced an in-memory sort, and the query examined 1007 documents for a limit of 5. With `path` added to the index, the winning plan is `IXSCAN repo_depth -> FETCH -> LIMIT` and examines 5 documents.

## Aggregation pipelines

All pipelines are built by functions in `db/mongo/pipelines.js`. Each takes an optional `repoId`. Without it the pipeline covers every repository.

### nodeTypeCountsByLanguage({ repoId, limit = 10 })

Counts how often each node type appears, per language, and keeps the `limit` most common types.

1. `$match` on `repo_id` (uses `repo_path_unique`).
2. `$project` keeps only `language` and the array of node types, so `$unwind` does not copy whole nodes.
3. `$unwind` the types.
4. `$group` by language, type and file to count each type within each file.
5. `$group` by language and type to get the total count and the number of files that contain the type.
6. `$group` by language with `$topN` to keep the most common types, plus the language's total node count and number of distinct types.
7. `$project` adds each type's share of the language's nodes.
8. `$sort` by total nodes.

Sample output for the test repository, `limit` 4, trimmed to one language:

```js
{
  language: 'typescript',
  total_nodes: 58,
  distinct_types: 24,
  top_types: [
    { type: 'identifier', count: 10, files: 2, share: 0.1724 },
    { type: 'statement_block', count: 8, files: 2, share: 0.1379 },
    { type: 'if_statement', count: 6, files: 1, share: 0.1034 },
    { type: 'parenthesized_expression', count: 6, files: 1, share: 0.1034 }
  ]
}
```

### deepestNestingPerFile({ repoId, limit = 20 })

Lists the files with the deepest syntax trees, which usually means the most deeply nested control flow, and shows where the deepest point is.

1. `$match` on `repo_id`, `$sort` by `max_depth` descending then `path`, `$limit`. These three run on the `repo_depth` index, so only `limit` documents are fetched.
2. `$set` finds the deepest node with `$filter` on `nodes.d == max_depth`, taking the first match.
3. `$set` rebuilds its ancestry. `$reduce` runs `max_depth` times over `$range`, each step following the parent index with `$arrayElemAt` and prepending that node's type.
4. `$project` reports the deepest node's type and 1-based line and column, plus the ancestry.

Sample output, first result:

```js
{
  repo_id: 1,
  path: 'src/util/retry.js',
  language: 'javascript',
  loc: 35,
  node_count: 35,
  max_depth: 23,
  truncated: false,
  ast_doc_id: '6ae8237353e27ed593760389',
  deepest_node: { type: 'identifier', line: 34, column: 47 },
  ancestry: [
    'program', 'function_declaration', 'statement_block',
    'for_statement', 'statement_block', 'if_statement', 'statement_block',
    'try_statement', 'statement_block', 'for_statement', 'statement_block',
    'if_statement', 'statement_block', 'try_statement', 'statement_block',
    'for_statement', 'statement_block', 'if_statement', 'statement_block',
    'try_statement', 'statement_block', 'return_statement', 'call_expression'
  ]
}
```

### astSummaryByRepo({ repoId })

One document summarising a repository's trees, for the repository page.

1. `$match` on `repo_id`, then `$project` drops `nodes` so the rest of the pipeline handles small documents.
2. `$facet` runs two sub-pipelines on the same input. `by_language` groups by language for files, lines, nodes, average nodes per file, average and maximum depth, and truncated files. `totals` groups everything into one row.
3. `$project` turns the one-element `totals` array into an object, with zeros when the repo has no documents.

Sample output:

```js
{
  by_language: [
    { language: 'javascript', files: 3, loc: 1381, nodes: 1381, avg_nodes_per_file: 460.3, avg_depth: 11, max_depth: 23, truncated_files: 0 },
    { language: 'python', files: 2, loc: 44, nodes: 44, avg_nodes_per_file: 22, avg_depth: 12.5, max_depth: 19, truncated_files: 0 },
    { language: 'typescript', files: 2, loc: 58, nodes: 58, avg_nodes_per_file: 29, avg_depth: 13.5, max_depth: 20, truncated_files: 0 }
  ],
  totals: { repos: 1, files: 7, loc: 1483, nodes: 1483, max_depth: 23 }
}
```

### fileSizeDistribution({ repoId, boundaries })

Groups files into buckets by node count with `$bucket`. The default boundaries are `[0, 100, 500, 1000, 5000, 10000, 50001]`. Each bucket reports how many files it holds, their average lines and depth, and the three largest paths, picked with `$topN`.

```js
{ min_nodes: 0, files: 6, avg_loc: 27, avg_depth: 13.5, largest: ['src/api/handlers.ts', 'src/util/retry.js', 'app/jobs.py'] }
{ min_nodes: 1000, files: 1, avg_loc: 1321, avg_depth: 4, largest: ['src/generated/helpers.js'] }
```

## Running it

The `ast` collection, validator and indexes are created when the Mongo container starts with an empty volume, by `db/mongo/init/10_ast.js`. The script is safe to run again: it updates the validator with `collMod`, drops indexes that no longer match `ast.indexes.json` and creates the missing ones. To apply it to a running container:

```sh
docker compose exec mongo mongosh --quiet /cie-db/mongo/init/10_ast.js
```

To run a pipeline from the shell:

```sh
docker compose exec -e CIE_PIPELINE=deepestNestingPerFile -e CIE_REPO_ID=1 -e CIE_LIMIT=5 \
  mongo mongosh --quiet /cie-db/mongo/run-pipeline.js
```

`CIE_PIPELINE` is one of `nodeTypeCountsByLanguage`, `deepestNestingPerFile`, `astSummaryByRepo` or `fileSizeDistribution`. `CIE_REPO_ID`, `CIE_LIMIT` and `CIE_BOUNDARIES` (a JSON array) are optional. Set `CIE_EXPLAIN=1` to print which index the winning plan used and how many documents it examined. `CIE_MONGO_DB` picks a database other than `cie`.

From Node, require the module and pass the result to the driver:

```js
const { deepestNestingPerFile } = require('../db/mongo/pipelines.js');
const rows = await db.collection('ast').aggregate(deepestNestingPerFile({ repoId: 1, limit: 10 })).toArray();
```

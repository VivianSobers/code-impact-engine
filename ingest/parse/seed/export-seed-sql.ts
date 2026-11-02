import { writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { loadSettings, repoRoot } from "../src/config";

const seedUrl = "ingest/workdir/seed-repo";
const seedAddedDate = "2026-09-10 12:00:00+05:30";
const output = path.join(repoRoot, "db/seed/10_structure_seed.sql");

type Value = string | number | boolean | null;

function literal(value: Value): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return `'${value.replace(/'/g, "''")}'`;
}

function insert(table: string, columns: string[], rows: Value[][], overriding = false): string {
  if (rows.length === 0) return "";
  const values = rows.map((row) => `    (${row.map(literal).join(", ")})`).join(",\n");
  return `INSERT INTO ${table} (${columns.join(", ")})${overriding ? " OVERRIDING SYSTEM VALUE" : ""}\nVALUES\n${values};\n`;
}

async function exportSeedSql(databaseUrl: string): Promise<string> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const repo = await client.query<{ repo_id: string; name: string; default_branch: string }>(
      "SELECT repo_id, name, default_branch FROM repository WHERE url = $1",
      [seedUrl],
    );
    if (repo.rowCount === 0) throw new Error(`No repository with url ${seedUrl}. Run npm run seed first.`);
    const repoId = repo.rows[0].repo_id;

    const files = await client.query<{ path: string; language: string; loc: number; content_hash: string }>(
      "SELECT path, language, loc, content_hash FROM file WHERE repo_id = $1 ORDER BY path",
      [repoId],
    );
    const symbols = await client.query<{
      symbol_id: string;
      path: string;
      name: string;
      kind: string;
      signature: string | null;
      start_line: number;
      end_line: number;
      is_entry_point: boolean;
    }>(
      `SELECT symbol_id, path, name, kind, signature, start_line, end_line, is_entry_point
       FROM symbol WHERE repo_id = $1 ORDER BY path, start_line, kind, name`,
      [repoId],
    );
    const newIds = new Map(symbols.rows.map((row, index) => [row.symbol_id, index + 1]));
    const calls = await client.query<{ caller_id: string; callee_id: string; call_line: number; resolution_confidence: string }>(
      `SELECT c.caller_id, c.callee_id, c.call_line, c.resolution_confidence
       FROM calls c JOIN symbol s ON s.symbol_id = c.caller_id
       WHERE s.repo_id = $1`,
      [repoId],
    );
    const imports = await client.query<{ importer_path: string; imported_path: string }>(
      "SELECT importer_path, imported_path FROM imports WHERE importer_repo_id = $1 ORDER BY importer_path, imported_path",
      [repoId],
    );

    const callRows = calls.rows
      .map((row) => [newIds.get(row.caller_id)!, newIds.get(row.callee_id)!, row.call_line, Number(row.resolution_confidence)])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);

    const sql = [
      "BEGIN;\n",
      insert("repository", ["repo_id", "name", "url", "default_branch", "added_date"], [[1, repo.rows[0].name, seedUrl, repo.rows[0].default_branch, seedAddedDate]], true),
      insert(
        "file",
        ["repo_id", "path", "language", "loc", "content_hash", "ast_doc_id"],
        files.rows.map((row) => [1, row.path, row.language, row.loc, row.content_hash, null]),
      ),
      insert(
        "symbol",
        ["symbol_id", "repo_id", "path", "name", "kind", "signature", "start_line", "end_line", "is_entry_point"],
        symbols.rows.map((row, index) => [index + 1, 1, row.path, row.name, row.kind, row.signature, row.start_line, row.end_line, row.is_entry_point]),
        true,
      ),
      insert("calls", ["caller_id", "callee_id", "call_line", "resolution_confidence"], callRows),
      insert(
        "imports",
        ["importer_repo_id", "importer_path", "imported_repo_id", "imported_path"],
        imports.rows.map((row) => [1, row.importer_path, 1, row.imported_path]),
      ),
      "SELECT setval(pg_get_serial_sequence('repository', 'repo_id'), (SELECT max(repo_id) FROM repository));\n",
      "SELECT setval(pg_get_serial_sequence('symbol', 'symbol_id'), (SELECT max(symbol_id) FROM symbol));\n",
      "COMMIT;\n",
    ]
      .filter(Boolean)
      .join("\n");

    writeFileSync(output, sql);
    return output;
  } finally {
    await client.end();
  }
}

exportSeedSql(loadSettings().databaseUrl)
  .then((file) => process.stderr.write(`Wrote ${file}\n`))
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });

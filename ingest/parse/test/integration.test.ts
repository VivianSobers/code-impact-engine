import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { MongoClient, ObjectId } from "mongodb";
import pg from "pg";
import { ingestRoot, repoRoot, type Settings } from "../src/config";
import { ingestRepository, type IngestSummary } from "../src/index";

const settings: Settings = {
  databaseUrl: process.env.INGEST_TEST_DATABASE_URL ?? "postgresql://cie:change-me@localhost:5432/cie_t_ingest",
  mongoUri: process.env.INGEST_TEST_MONGODB_URI ?? "mongodb://localhost:27017",
  mongoDb: process.env.INGEST_TEST_MONGODB_DB ?? "cie_t_ingest",
};
const seedDir = path.join(ingestRoot, "workdir/seed-repo");
const seedUrl = "ingest/workdir/seed-repo";

async function reachable(): Promise<string | null> {
  const client = new pg.Client({ connectionString: settings.databaseUrl, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
  } catch (error) {
    return `Postgres unreachable at ${settings.databaseUrl}: ${String(error)}`;
  } finally {
    await client.end().catch(() => undefined);
  }
  const mongo = new MongoClient(settings.mongoUri, { serverSelectionTimeoutMS: 3000 });
  try {
    await mongo.connect();
    await mongo.db(settings.mongoDb).command({ ping: 1 });
  } catch (error) {
    return `MongoDB unreachable at ${settings.mongoUri}: ${String(error)}`;
  } finally {
    await mongo.close().catch(() => undefined);
  }
  return null;
}

async function ensureSchema(client: pg.Client): Promise<void> {
  const exists = await client.query("SELECT to_regclass('repository') AS name");
  if (exists.rows[0].name) return;
  for (const directory of ["db/schema", "db/functions"]) {
    const full = path.join(repoRoot, directory);
    let files: string[] = [];
    try {
      files = readdirSync(full).filter((file) => file.endsWith(".sql")).sort();
    } catch {
      continue;
    }
    for (const file of files) await client.query(readFileSync(path.join(full, file), "utf8"));
  }
}

const skip = await reachable();

describe("ingesting the seed repo", { skip: skip ?? false }, () => {
  const client = new pg.Client({ connectionString: settings.databaseUrl });
  const mongo = new MongoClient(settings.mongoUri);
  let first: IngestSummary;
  let second: IngestSummary;

  before(async () => {
    execFileSync(process.execPath, [path.join(ingestRoot, "parse/seed/create-seed-repo.mjs")], { stdio: "ignore" });
    await client.connect();
    await mongo.connect();
    await ensureSchema(client);
    first = await ingestRepository({ target: seedDir, name: "seed-repo", url: seedUrl, settings });
    second = await ingestRepository({ target: seedDir, name: "seed-repo", url: seedUrl, settings });
  });

  after(async () => {
    await client.end().catch(() => undefined);
    await mongo.close().catch(() => undefined);
  });

  it("stores the expected number of rows", async () => {
    assert.equal(first.files, 16);
    assert.equal(first.symbols, 57);
    assert.equal(first.calls, 32);
    assert.equal(first.imports, 10);
    assert.equal(first.skipped, 0);

    const counts = await client.query(
      `SELECT (SELECT count(*) FROM file WHERE repo_id = $1)::int AS files,
              (SELECT count(*) FROM symbol WHERE repo_id = $1)::int AS symbols,
              (SELECT count(*) FROM calls c JOIN symbol s ON s.symbol_id = c.caller_id WHERE s.repo_id = $1)::int AS calls,
              (SELECT count(*) FROM imports WHERE importer_repo_id = $1)::int AS imports`,
      [second.repoId],
    );
    assert.deepEqual(counts.rows[0], { files: 16, symbols: 57, calls: 32, imports: 10 });
  });

  it("replaces rows instead of duplicating them on a second run", async () => {
    assert.equal(second.repoId, first.repoId);
    assert.deepEqual({ ...second, durationMs: 0 }, { ...first, durationMs: 0 });
    const repos = await client.query("SELECT count(*)::int AS count FROM repository WHERE url = $1", [seedUrl]);
    assert.equal(repos.rows[0].count, 1);
  });

  it("keeps every symbol inside its file", async () => {
    const outside = await client.query(
      `SELECT s.path, s.name FROM symbol s JOIN file f USING (repo_id, path)
       WHERE s.repo_id = $1 AND (s.start_line < 1 OR s.end_line > f.loc OR s.end_line < s.start_line)`,
      [second.repoId],
    );
    assert.deepEqual(outside.rows, []);
  });

  it("links each parsed file to exactly one AST document", async () => {
    const files = await client.query<{ path: string; ast_doc_id: string; content_hash: string; loc: number }>(
      "SELECT path, ast_doc_id, content_hash, loc FROM file WHERE repo_id = $1",
      [second.repoId],
    );
    const docs = await mongo.db(settings.mongoDb).collection("ast").find({ repo_id: second.repoId }).toArray();
    assert.equal(docs.length, files.rowCount);
    const byId = new Map(docs.map((doc) => [(doc._id as ObjectId).toHexString(), doc]));
    for (const file of files.rows) {
      const doc = byId.get(file.ast_doc_id);
      assert.ok(doc, `missing AST for ${file.path}`);
      assert.equal(doc.path, file.path);
      assert.equal(doc.content_hash, file.content_hash);
      assert.equal(doc.loc, file.loc);
      assert.equal(doc.node_count, doc.nodes.length);
    }
  });

  it("records the demo call chain from the POST handler down to roundCurrency", async () => {
    const chain = await client.query<{ caller: string; callee: string; confidence: string }>(
      `SELECT a.name AS caller, b.name AS callee, c.resolution_confidence AS confidence
       FROM calls c JOIN symbol a ON a.symbol_id = c.caller_id JOIN symbol b ON b.symbol_id = c.callee_id
       WHERE a.repo_id = $1 AND (a.name, b.name) IN (('POST', 'create'), ('create', 'priceOrder'), ('priceOrder', 'applyDiscount'), ('applyDiscount', 'roundCurrency'))
`,
      [second.repoId],
    );
    assert.deepEqual(
      chain.rows.map((row) => `${row.caller}->${row.callee}@${row.confidence}`).sort(),
      ["POST->create@0.85", "applyDiscount->roundCurrency@0.90", "create->priceOrder@0.90", "priceOrder->applyDiscount@1.00"],
    );
  });
});

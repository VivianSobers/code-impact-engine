import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { ingestRoot } from "../../parse/src/config";
import { ingestRepository } from "../../parse/src/index";
import { prepareDatabase, testSettings } from "../../history/test/db";
import { embedRepository, type EmbedSummary } from "../src/index";

const settings = testSettings("cie_t_embed");
const quiet = () => undefined;
const skip = await prepareDatabase(settings);
if (skip) console.log(`# embed integration skipped: ${skip}`);

describe("embedding the seed repo", { skip: skip ?? false }, () => {
  const client = new pg.Client({ connectionString: settings.databaseUrl });
  const seedDir = path.join(ingestRoot, "workdir/seed-repo");
  let first: EmbedSummary;
  let second: EmbedSummary;
  let afterReparse: EmbedSummary;

  before(async () => {
    execFileSync(process.execPath, [path.join(ingestRoot, "parse/seed/create-seed-repo.mjs")], { stdio: "ignore" });
    await client.connect();
    await ingestRepository({ target: seedDir, name: "seed-repo", url: "ingest/workdir/seed-repo", settings, log: quiet });
    first = await embedRepository({ repo: "seed-repo", settings, log: quiet });
    second = await embedRepository({ repo: first.repoId, settings, log: quiet });
    await ingestRepository({ target: seedDir, name: "seed-repo", url: "ingest/workdir/seed-repo", settings, log: quiet });
    afterReparse = await embedRepository({ repo: first.repoId, settings, log: quiet });
  });

  after(async () => {
    await client.end().catch(() => undefined);
  });

  it("embeds every function and method of four or more lines", async () => {
    const eligible = await client.query(
      `SELECT count(*)::int AS n FROM symbol WHERE repo_id = $1 AND kind IN ('function', 'method') AND end_line - start_line + 1 >= 4`,
      [first.repoId],
    );
    assert.equal(first.symbols, eligible.rows[0].n);
    assert.ok(first.symbols > 0);
    assert.equal(first.embedded + first.reused, first.symbols);
    const linked = await client.query(
      "SELECT count(*)::int AS n FROM symbol WHERE repo_id = $1 AND embedding_id IS NOT NULL",
      [first.repoId],
    );
    assert.equal(linked.rows[0].n, first.symbols);
  });

  it("reuses stored vectors on a second run and after a re-parse", () => {
    assert.deepEqual([second.embedded, second.reused], [0, first.symbols]);
    assert.deepEqual([afterReparse.embedded, afterReparse.reused], [0, first.symbols]);
  });

  it("only puts symbols of this repository into clusters of two or more", async () => {
    const rows = await client.query(
      `SELECT c.cluster_id, count(*)::int AS members, bool_and(s.repo_id = $1) AS same_repo
       FROM clone_cluster c JOIN symbol s USING (cluster_id)
       WHERE c.cluster_id IN (SELECT cluster_id FROM symbol WHERE repo_id = $1)
       GROUP BY c.cluster_id`,
      [first.repoId],
    );
    for (const row of rows.rows) {
      assert.ok(row.members >= 2);
      assert.ok(row.same_repo);
    }
    assert.equal(rows.rowCount, afterReparse.clusters);
  });
});

describe("finding a planted clone", { skip: skip ?? false }, () => {
  const client = new pg.Client({ connectionString: settings.databaseUrl });
  let dir: string;
  let summary: EmbedSummary;

  before(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "cie-clones-"));
    mkdirSync(path.join(dir, "src"));
    const total = (name: string, items: string) =>
      `export function ${name}(${items}) {\n  let sum = 0;\n  for (const item of ${items}) {\n    sum += item.price * item.quantity;\n  }\n  return Math.round(sum * 100) / 100;\n}\n`;
    writeFileSync(path.join(dir, "src/cart.js"), total("cartTotal", "items"));
    writeFileSync(path.join(dir, "src/invoice.js"), total("invoiceTotal", "lines"));
    writeFileSync(
      path.join(dir, "src/address.js"),
      `export function parseAddress(raw) {\n  const parts = raw.split(",").map((part) => part.trim());\n  const [street = "", city = ""] = parts;\n  return { street, city: city.toUpperCase() };\n}\n`,
    );
    await client.connect();
    const parsed = await ingestRepository({ target: dir, name: "planted-clones", settings, log: quiet });
    summary = await embedRepository({ repo: parsed.repoId, settings, log: quiet });
  });

  after(async () => {
    await client.end().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  });

  it("puts the two totals in one open cluster and leaves the parser out", async () => {
    assert.equal(summary.clusters, 1);
    const rows = await client.query(
      `SELECT c.status, c.similarity_score BETWEEN 0.7 AND 1 AS similar, array_agg(s.name ORDER BY s.name) AS names
       FROM clone_cluster c JOIN symbol s USING (cluster_id)
       WHERE s.repo_id = $1 GROUP BY c.cluster_id`,
      [summary.repoId],
    );
    assert.deepEqual(rows.rows, [{ status: "open", similar: true, names: ["cartTotal", "invoiceTotal"] }]);
  });
});

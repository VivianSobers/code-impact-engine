import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { ingestRoot } from "../../parse/src/config";
import { ingestRepository } from "../../parse/src/index";
import { ingestHistory, type HistorySummary } from "../src/index";
import { prepareDatabase, testSettings } from "./db";

const settings = testSettings("cie_t_history");
const seedDir = path.join(ingestRoot, "workdir/seed-repo");
const seedUrl = "ingest/workdir/seed-repo";
const skip = await prepareDatabase(settings);
if (skip) console.log(`# history integration skipped: ${skip}`);

describe("history of the seed repo", { skip: skip ?? false }, () => {
  const client = new pg.Client({ connectionString: settings.databaseUrl });
  let first: HistorySummary;
  let again: HistorySummary;

  before(async () => {
    execFileSync(process.execPath, [path.join(ingestRoot, "parse/seed/create-seed-repo.mjs")], { stdio: "ignore" });
    await client.connect();
    await ingestRepository({ target: seedDir, name: "seed-repo", url: seedUrl, settings, log: () => undefined });
    first = await ingestHistory({ repo: "seed-repo", settings, log: () => undefined });
    // Re-parsing deletes and recreates every symbol; history must survive a rerun.
    await ingestRepository({ target: seedDir, name: "seed-repo", url: seedUrl, settings, log: () => undefined });
    again = await ingestHistory({ repo: first.repoId, settings, log: () => undefined });
  });

  after(async () => {
    await client.end().catch(() => undefined);
  });

  it("stores every commit and groups the three authors", async () => {
    assert.equal(first.commits, 10);
    assert.equal(first.authors, 3);
    const rows = await client.query(
      `SELECT a.name, a.company, array_agg(e.email ORDER BY e.email COLLATE "C") AS emails
       FROM author a JOIN author_email e USING (author_id)
       WHERE a.author_id IN (SELECT author_id FROM commit WHERE repo_id = $1)
       GROUP BY a.author_id ORDER BY a.name`,
      [first.repoId],
    );
    assert.deepEqual(rows.rows, [
      { name: "Asha Rao", company: "Acme", emails: ["asha.rao@acme.example"] },
      { name: "Ben Okafor", company: "Acme", emails: ["ben.okafor@mail.example", "ben@acme.example"] },
      { name: "Chen Li", company: "Acme", emails: ["chen.li@acme.example"] },
    ]);
  });

  it("records roundCurrency as added in the first commit and changed in the last", async () => {
    const rows = await client.query(
      `SELECT left(c.sha, 7) AS sha, m.change_type, m.additions > 0 AS added_lines, m.deletions > 0 AS removed_lines
       FROM modifies m JOIN commit c USING (commit_id) JOIN symbol s USING (symbol_id)
       WHERE s.repo_id = $1 AND s.path = 'src/lib/money.ts' AND s.name = 'roundCurrency'
       ORDER BY c.committed_at`,
      [first.repoId],
    );
    assert.deepEqual(rows.rows, [
      { sha: "f58fae0", change_type: "added", added_lines: true, removed_lines: false },
      { sha: "c82d23f", change_type: "modified", added_lines: true, removed_lines: true },
    ]);
  });

  it("only links changes to symbols of this repository", async () => {
    assert.ok(first.modifies > 0);
    const foreign = await client.query(
      `SELECT count(*)::int AS n FROM modifies m JOIN commit c USING (commit_id) JOIN symbol s USING (symbol_id)
       WHERE c.repo_id = $1 AND s.repo_id <> c.repo_id`,
      [first.repoId],
    );
    assert.equal(foreign.rows[0].n, 0);
  });

  it("gives the same result after the repository is parsed again", () => {
    assert.deepEqual(
      { commits: again.commits, authors: again.authors, modifies: again.modifies, unmatched: again.unmatched },
      { commits: first.commits, authors: first.authors, modifies: first.modifies, unmatched: first.unmatched },
    );
  });
});

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

// Smoke test for the history, search and clone routes against a running server with at
// least one repository that has history (npm run history). Signs in with
// CIE_TEST_USERNAME / CIE_TEST_PASSWORD; set CIE_TEST_DEV_USERNAME / CIE_TEST_DEV_PASSWORD
// to a developer to also check that developers cannot review clones.

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const MISSING_ID = 999999999;

async function signIn(username, password) {
  const response = await fetch(`${BASE_URL}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200, `signing in as ${username} failed: ${await response.text()}`);
  return response.headers.get("set-cookie").split(";")[0];
}

let cookie = "";

async function call(path, init = {}, as = cookie) {
  const response = await fetch(`${BASE_URL}${path}`, { ...init, headers: { ...(init.headers ?? {}), cookie: as } });
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: response.status, body };
}

async function expectStatus(path, status, init, as) {
  const result = await call(path, init, as);
  assert.equal(result.status, status, `${init?.method ?? "GET"} ${path} returned ${result.status}: ${JSON.stringify(result.body)}`);
  return result.body;
}

before(async () => {
  assert.ok(process.env.CIE_TEST_USERNAME && process.env.CIE_TEST_PASSWORD, "set CIE_TEST_USERNAME and CIE_TEST_PASSWORD");
  cookie = await signIn(process.env.CIE_TEST_USERNAME, process.env.CIE_TEST_PASSWORD);
});

describe("history summary and hotspots", () => {
  it("counts repositories, commits and authors", async () => {
    const summary = await expectStatus("/api/history/summary", 200);
    for (const key of ["repositories", "commits", "authors", "openClusters"]) assert.equal(typeof summary[key], "number", key);
    assert.ok(summary.commits > 0, "run npm run history on a repository first");
  });

  it("lists hotspots by churn and validates its parameters", async () => {
    const { hotspots } = await expectStatus("/api/history/hotspots?limit=5", 200);
    assert.ok(hotspots.length > 0 && hotspots.length <= 5);
    for (let i = 1; i < hotspots.length; i++) assert.ok(hotspots[i - 1].churn >= hotspots[i].churn);
    assert.ok(hotspots.every((h) => h.commits >= 2));
    await expectStatus("/api/history/hotspots?limit=0", 400);
    await expectStatus("/api/history/hotspots?repo=abc", 400);
  });

  it("lists authors with their churn", async () => {
    const { authors } = await expectStatus("/api/history/authors", 200);
    assert.ok(authors.length > 0);
    assert.ok(authors.every((a) => typeof a.name === "string" && a.commits > 0));
  });
});

describe("commits", () => {
  it("pages through commits newest first", async () => {
    const first = await expectStatus("/api/commits?page=1", 200);
    assert.ok(first.total > 0);
    assert.ok(first.commits.length > 0 && first.commits.length <= 25);
    for (let i = 1; i < first.commits.length; i++) {
      assert.ok(first.commits[i - 1].committedAt >= first.commits[i].committedAt);
    }
    await expectStatus("/api/commits?page=0", 400);
    await expectStatus("/api/commits?author=x", 400);
    const beyond = await expectStatus(`/api/commits?page=${Math.ceil(first.total / 25) + 1}`, 200);
    assert.deepEqual(beyond.commits, []);
  });

  it("searches commit messages with stemming", async () => {
    const { commits } = await expectStatus("/api/commits?page=1", 200);
    const word = commits[0].message.split(/\W+/).find((w) => w.length > 4) ?? commits[0].message.split(/\W+/)[0];
    const found = await expectStatus(`/api/commits?q=${encodeURIComponent(word)}`, 200);
    assert.ok(found.total > 0, `searching for ${word} found nothing`);
    await expectStatus(`/api/commits?q=${"x".repeat(201)}`, 400);
  });

  it("shows one commit with the symbols it changed", async () => {
    const { commits } = await expectStatus("/api/commits?page=1", 200);
    const withChanges = commits.find((c) => c.symbols > 0) ?? commits[0];
    const { commit, changes } = await expectStatus(`/api/commits/${withChanges.commitId}`, 200);
    assert.equal(commit.sha, withChanges.sha);
    assert.equal(changes.length, withChanges.symbols);
    await expectStatus("/api/commits/abc", 400);
    await expectStatus(`/api/commits/${MISSING_ID}`, 404);
  });
});

describe("semantic search", () => {
  it("ranks embedded symbols by similarity to a description", async () => {
    const { results, model } = await expectStatus(`/api/search?q=${encodeURIComponent("parse the accept header")}&limit=5`, 200);
    assert.equal(typeof model, "string");
    assert.ok(results.length > 0 && results.length <= 5, "run npm run embed on a repository first");
    for (let i = 1; i < results.length; i++) assert.ok(results[i - 1].similarity >= results[i].similarity);
    assert.ok(results.every((r) => r.similarity > -1 && r.similarity <= 1 && r.symbolId > 0 && r.path));
  });

  it("returns nothing for a repository without embeddings", async () => {
    const { repositories } = await expectStatus("/api/repositories", 200);
    const { results: all } = await expectStatus(`/api/search?q=function&limit=50`, 200);
    const embedded = new Set(all.map((r) => r.repoId));
    const bare = repositories.find((r) => !embedded.has(r.repoId));
    if (!bare) return;
    const { results } = await expectStatus(`/api/search?q=function&repo=${bare.repoId}`, 200);
    assert.ok(results.every((r) => r.repoId === bare.repoId));
  });

  it("rejects empty, long and malformed queries", async () => {
    await expectStatus("/api/search?q=", 400);
    await expectStatus(`/api/search?q=${"a".repeat(501)}`, 400);
    await expectStatus("/api/search?q=x&repo=abc", 400);
    await expectStatus("/api/search?q=x&limit=0", 400);
  });
});

// Confirms one open clone cluster and cannot reopen it through the API. Each run prints
// the cluster id; put it back with
//   UPDATE clone_cluster SET status = 'open' WHERE cluster_id = <id>;
//   DELETE FROM waives WHERE symbol_id IN (SELECT symbol_id FROM symbol WHERE cluster_id = <id>);
describe("clone review", () => {
  const post = (id, body, as) =>
    call(
      `/api/clones/${id}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      as,
    );

  async function openCluster() {
    const { clusters, total } = await expectStatus("/api/clones", 200);
    assert.ok(total > 0, "run npm run embed on a repository with duplicated code first");
    return clusters[clusters.length - 1];
  }

  it("lists clusters by status and validates its parameters", async () => {
    const { clusters, total } = await expectStatus("/api/clones", 200);
    assert.ok(total > 0 && clusters.length > 0 && clusters.length <= 25);
    assert.ok(clusters.every((c) => c.status === "open" && c.members >= 2 && typeof c.repoName === "string"));
    const confirmed = await expectStatus("/api/clones?status=confirmed", 200);
    assert.ok(confirmed.clusters.every((c) => c.status === "confirmed"));
    await expectStatus("/api/clones?status=closed", 400);
    await expectStatus("/api/clones?repo=abc", 400);
    await expectStatus("/api/clones?page=0", 400);
  });

  it("shows one cluster with its members", async () => {
    const summary = await openCluster();
    const { cluster, members } = await expectStatus(`/api/clones/${summary.clusterId}`, 200);
    assert.equal(cluster.clusterId, summary.clusterId);
    assert.equal(members.length, summary.members);
    assert.ok(members.every((m) => typeof m.waived === "boolean" && m.endLine >= m.startLine));
    await expectStatus(`/api/clones/${MISSING_ID}`, 404);
    await expectStatus("/api/clones/abc", 400);
  });

  it("refuses bad reviews and leaves the cluster open", async () => {
    const { clusterId } = await openCluster();
    await expectStatus(`/api/clones/${clusterId}`, 400, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "open" }),
    });
    const outsider = await post(clusterId, { status: "confirmed", waive: [MISSING_ID], reason: "kept on purpose" });
    assert.equal(outsider.status, 400, JSON.stringify(outsider.body));
    assert.match(outsider.body.error, /not a member/);
    const { members } = await expectStatus(`/api/clones/${clusterId}`, 200);
    const noReason = await post(clusterId, { status: "confirmed", waive: [members[0].symbolId], reason: " " });
    assert.equal(noReason.status, 400, JSON.stringify(noReason.body));
    assert.match(noReason.body.error, /needs a reason/);
    const missing = await post(MISSING_ID, { status: "dismissed" });
    assert.equal(missing.status, 404, JSON.stringify(missing.body));
    const { cluster } = await expectStatus(`/api/clones/${clusterId}`, 200);
    assert.equal(cluster.status, "open");
  });

  it("does not let developers review", async (t) => {
    if (!process.env.CIE_TEST_DEV_USERNAME || !process.env.CIE_TEST_DEV_PASSWORD) {
      t.skip("set CIE_TEST_DEV_USERNAME and CIE_TEST_DEV_PASSWORD");
      return;
    }
    const developer = await signIn(process.env.CIE_TEST_DEV_USERNAME, process.env.CIE_TEST_DEV_PASSWORD);
    const { clusterId } = await openCluster();
    const result = await post(clusterId, { status: "confirmed" }, developer);
    assert.equal(result.status, 403, JSON.stringify(result.body));
    await expectStatus(`/api/clones/${clusterId}`, 200, undefined, developer);
  });

  it("confirms an open cluster once, with a waiver", async (t) => {
    const { clusterId } = await openCluster();
    t.diagnostic(`reviewed clone cluster ${clusterId}; reopen it by hand`);
    const { members } = await expectStatus(`/api/clones/${clusterId}`, 200);
    const waived = members[0].symbolId;
    const first = await post(clusterId, { status: "confirmed", waive: [waived], reason: "kept on purpose for the test" });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.cluster.status, "confirmed");
    assert.equal(first.body.cluster.reviewer, process.env.CIE_TEST_USERNAME);
    assert.ok(first.body.cluster.reviewedAt);
    assert.deepEqual(first.body.members.filter((m) => m.waived).map((m) => m.symbolId), [waived]);
    const second = await post(clusterId, { status: "dismissed" });
    assert.equal(second.status, 409, JSON.stringify(second.body));
    assert.match(second.body.error, /already reviewed/);
  });
});

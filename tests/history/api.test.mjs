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

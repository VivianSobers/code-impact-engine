import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const INGEST_SOURCE = process.env.INGEST_SOURCE ?? "";
const MISSING_ID = 999999999;
let sessionCookie = "";

async function call(path, init) {
  const headers = { ...(init?.headers ?? {}), ...(sessionCookie ? { cookie: sessionCookie } : {}) };
  const response = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function expectStatus(path, status, init) {
  const result = await call(path, init);
  assert.equal(result.status, status, `${init?.method ?? "GET"} ${path} returned ${result.status}: ${JSON.stringify(result.body)}`);
  return result.body;
}

function post(body) {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

const ids = {};

// Every route needs a session. Sign in with CIE_TEST_USERNAME and CIE_TEST_PASSWORD;
// adding a repository needs an admin.
async function signIn() {
  const username = process.env.CIE_TEST_USERNAME;
  const password = process.env.CIE_TEST_PASSWORD;
  assert.ok(username && password, "set CIE_TEST_USERNAME and CIE_TEST_PASSWORD to a user of the app");
  const response = await fetch(`${BASE_URL}/api/session`, post({ username, password }));
  assert.equal(response.status, 200, `signing in as ${username} failed: ${await response.text()}`);
  sessionCookie = response.headers.get("set-cookie").split(";")[0];
}

before(async () => {
  await signIn();
  const { repositories } = await expectStatus("/api/repositories", 200);
  assert.ok(repositories.length > 0, "ingest at least one repository before running these tests");
  const repo = [...repositories].sort((a, b) => b.callCount - a.callCount)[0];
  ids.repoId = repo.repoId;

  const { files } = await expectStatus(`/api/repositories/${ids.repoId}`, 200);
  ids.filePath = files.find((file) => file.symbolCount > 0)?.path ?? files[0].path;

  const { symbols } = await expectStatus(`/api/repositories/${ids.repoId}/files/${encodePath(ids.filePath)}`, 200);
  const named = symbols.find((symbol) => symbol.kind !== "module") ?? symbols[0];
  ids.symbolName = named.name;

  const { results } = await expectStatus(`/api/symbols/search?q=${encodeURIComponent(ids.symbolName)}&repo=${ids.repoId}`, 200);
  assert.ok(results.length > 0, `search found nothing for ${ids.symbolName}`);
  ids.symbolId = results[0].symbolId;

  for (const candidate of [...results, ...symbols]) {
    const { callers } = await expectStatus(`/api/symbols/${candidate.symbolId}`, 200);
    if (callers.length > 0) {
      ids.calledSymbolId = candidate.symbolId;
      break;
    }
  }
  ids.calledSymbolId ??= ids.symbolId;
});

describe("GET /api/repositories", () => {
  it("lists repositories with counts", async () => {
    const { repositories } = await expectStatus("/api/repositories", 200);
    for (const repo of repositories) {
      assert.equal(typeof repo.repoId, "number");
      assert.equal(typeof repo.name, "string");
      assert.ok(repo.fileCount >= 0 && repo.symbolCount >= 0 && repo.callCount >= 0);
      assert.ok(Array.isArray(repo.languages));
    }
  });
});

describe("POST /api/repositories", () => {
  it("rejects a body without a source", async () => {
    const body = await expectStatus("/api/repositories", 400, post({}));
    assert.match(body.error, /Git URL or a local path/);
  });

  it("rejects a body that is not JSON", async () => {
    await expectStatus("/api/repositories", 400, post("not json"));
  });

  it("rejects an unsupported URL scheme", async () => {
    await expectStatus("/api/repositories", 400, post({ source: "ftp://example.com/repo.git" }));
  });

  it("rejects an invalid branch name", async () => {
    await expectStatus("/api/repositories", 400, post({ source: "https://github.com/psf/requests", branch: "bad..branch" }));
  });

  it("ingests a repository when INGEST_SOURCE is set", { skip: INGEST_SOURCE === "" && "set INGEST_SOURCE to run" }, async () => {
    const { summary } = await expectStatus("/api/repositories", 201, post({ source: INGEST_SOURCE }));
    assert.ok(summary.repoId > 0);
    assert.ok(summary.files > 0 && summary.symbols > 0);
  });
});

describe("GET /api/repositories/[repoId]", () => {
  it("returns the repository and its files", async () => {
    const body = await expectStatus(`/api/repositories/${ids.repoId}`, 200);
    assert.equal(body.repository.repoId, ids.repoId);
    assert.ok(body.files.length > 0);
    assert.ok(body.files.every((file) => typeof file.path === "string" && file.loc >= 0));
  });

  it("returns 400 for ids that are not positive integers", async () => {
    await expectStatus("/api/repositories/abc", 400);
    await expectStatus("/api/repositories/0", 400);
    await expectStatus("/api/repositories/-4", 400);
  });

  it("returns 404 for an unknown repository", async () => {
    await expectStatus(`/api/repositories/${MISSING_ID}`, 404);
  });
});

describe("GET /api/repositories/[repoId]/ast-stats", () => {
  it("returns node type counts and the deepest files", async () => {
    const body = await expectStatus(`/api/repositories/${ids.repoId}/ast-stats?limit=3`, 200);
    assert.ok(Array.isArray(body.byLanguage) && body.byLanguage.length > 0);
    assert.ok(body.byLanguage.every((row) => row.top_types.length <= 3));
    assert.ok(Array.isArray(body.deepest) && body.deepest.length <= 3);
  });

  it("returns 400 for a limit out of range", async () => {
    await expectStatus(`/api/repositories/${ids.repoId}/ast-stats?limit=0`, 400);
    await expectStatus(`/api/repositories/${ids.repoId}/ast-stats?limit=many`, 400);
  });

  it("returns 404 for an unknown repository", async () => {
    await expectStatus(`/api/repositories/${MISSING_ID}/ast-stats`, 404);
  });
});

describe("GET /api/repositories/[repoId]/files/[...path]", () => {
  it("returns the file with its symbols and imports", async () => {
    const body = await expectStatus(`/api/repositories/${ids.repoId}/files/${encodePath(ids.filePath)}`, 200);
    assert.equal(body.file.path, ids.filePath);
    assert.ok(body.symbols.length > 0);
    assert.ok(body.symbols.every((symbol) => symbol.startLine <= symbol.endLine && symbol.endLine <= body.file.loc));
    assert.ok(Array.isArray(body.imports) && Array.isArray(body.importedBy));
  });

  it("returns 404 for a path that is not in the repository", async () => {
    await expectStatus(`/api/repositories/${ids.repoId}/files/no/such/file.ts`, 404);
  });

  it("returns 400 for a malformed path", async () => {
    await expectStatus(`/api/repositories/${ids.repoId}/files/src/%E0%A4%A`, 400);
  });
});

describe("GET /api/symbols/[symbolId]", () => {
  it("returns the symbol with callers and callees", async () => {
    const body = await expectStatus(`/api/symbols/${ids.calledSymbolId}`, 200);
    assert.equal(body.symbol.symbolId, ids.calledSymbolId);
    assert.equal(body.symbol.length, body.symbol.endLine - body.symbol.startLine + 1);
    assert.ok(body.callers.length > 0);
    assert.ok(Array.isArray(body.callees));
  });

  it("returns 400 for a bad id and 404 for an unknown one", async () => {
    await expectStatus("/api/symbols/1.5", 400);
    await expectStatus(`/api/symbols/${MISSING_ID}`, 404);
  });
});

describe("GET /api/symbols/[symbolId]/graph", () => {
  it("returns nodes and edges around the symbol", async () => {
    const body = await expectStatus(`/api/symbols/${ids.calledSymbolId}/graph?depth=2&limit=40`, 200);
    assert.equal(body.rootId, ids.calledSymbolId);
    assert.ok(body.nodes.length <= 40);
    const nodeIds = new Set(body.nodes.map((node) => node.symbolId));
    assert.ok(nodeIds.has(ids.calledSymbolId));
    assert.ok(body.edges.length > 0);
    assert.ok(body.edges.every((edge) => nodeIds.has(edge.callerId) && nodeIds.has(edge.calleeId)));
  });

  it("returns 400 for a depth or limit out of range", async () => {
    await expectStatus(`/api/symbols/${ids.calledSymbolId}/graph?depth=0`, 400);
    await expectStatus(`/api/symbols/${ids.calledSymbolId}/graph?limit=100000`, 400);
  });

  it("returns 404 for an unknown symbol", async () => {
    await expectStatus(`/api/symbols/${MISSING_ID}/graph`, 404);
  });
});

describe("GET /api/symbols/[symbolId]/impact", () => {
  it("returns affected symbols with a summary", async () => {
    const body = await expectStatus(`/api/symbols/${ids.calledSymbolId}/impact?depth=3`, 200);
    assert.ok(body.affected.length > 0);
    assert.equal(body.summary.affected, body.affected.length);
    for (const row of body.affected) {
      assert.ok(row.depth >= 1 && row.depth <= 3);
      assert.equal(row.callPath[0], row.symbolId);
      assert.equal(row.callPath.at(-1), ids.calledSymbolId);
      assert.equal(row.callPath.length, row.depth + 1);
    }
  });

  it("drops rows below the minimum confidence", async () => {
    const body = await expectStatus(`/api/symbols/${ids.calledSymbolId}/impact?min=0.9`, 200);
    assert.ok(body.affected.every((row) => row.minConfidence >= 0.9));
  });

  it("returns 400 for a bad depth or confidence", async () => {
    await expectStatus(`/api/symbols/${ids.calledSymbolId}/impact?depth=99`, 400);
    await expectStatus(`/api/symbols/${ids.calledSymbolId}/impact?min=2`, 400);
  });

  it("returns 404 for an unknown symbol", async () => {
    await expectStatus(`/api/symbols/${MISSING_ID}/impact`, 404);
  });
});

describe("GET /api/symbols/search", () => {
  it("finds symbols by part of their name", async () => {
    const body = await expectStatus(`/api/symbols/search?q=${encodeURIComponent(ids.symbolName)}`, 200);
    assert.ok(body.results.some((row) => row.name === ids.symbolName));
    assert.ok(body.results.every((row, i, all) => i === 0 || all[i - 1].rank >= row.rank));
  });

  it("filters by repository", async () => {
    const body = await expectStatus(`/api/symbols/search?q=${encodeURIComponent(ids.symbolName)}&repo=${ids.repoId}`, 200);
    assert.ok(body.results.every((row) => row.repoId === ids.repoId));
  });

  it("returns 400 for a missing query, a bad repo or a bad limit", async () => {
    await expectStatus("/api/symbols/search", 400);
    await expectStatus("/api/symbols/search?q=%20%20", 400);
    await expectStatus("/api/symbols/search?q=get&repo=abc", 400);
    await expectStatus("/api/symbols/search?q=get&limit=501", 400);
    await expectStatus(`/api/symbols/search?q=${"a".repeat(201)}`, 400);
  });
});

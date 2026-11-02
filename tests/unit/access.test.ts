import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accessFor, safeNext } from "../../lib/auth/access";
import type { SessionUser } from "../../lib/auth/session";

const admin: SessionUser = { userId: 1, username: "ana", role: "admin" };
const dev: SessionUser = { userId: 2, username: "ben", role: "developer" };

describe("accessFor", () => {
  const cases: [string, string, SessionUser | null, ReturnType<typeof accessFor>][] = [
    ["GET", "/login", null, "allow"],
    ["POST", "/login", null, "allow"],
    ["POST", "/logout", null, "allow"],
    ["GET", "/_next/static/chunk.js", null, "allow"],
    ["GET", "/favicon.ico", null, "allow"],
    ["GET", "/dashboard", null, "login"],
    ["GET", "/repositories/3", null, "login"],
    ["GET", "/api/repositories", null, 401],
    ["POST", "/api/commits", null, 401],
    ["GET", "/dashboard", dev, "allow"],
    ["GET", "/repositories", dev, "allow"],
    ["GET", "/api/repositories", dev, "allow"],
    ["GET", "/clones/4", dev, "allow"],
    ["GET", "/api/clones/4", dev, "allow"],
    // Adding a repository: the JSON route and the page's server action both POST.
    ["POST", "/api/repositories", dev, 403],
    ["POST", "/repositories", dev, 403],
    ["POST", "/repositories", admin, "allow"],
    ["POST", "/api/repositories", admin, "allow"],
    ["GET", "/admin/users", dev, 403],
    ["POST", "/admin/users", dev, 403],
    ["GET", "/admin/users", admin, "allow"],
    ["POST", "/clones/4", dev, 403],
    ["POST", "/api/clones/4", dev, 403],
    ["POST", "/clones/4", admin, "allow"],
    ["GET", "/administrator", dev, "allow"],
    ["GET", "/loginx", null, "login"],
  ];
  for (const [method, path, user, expected] of cases) {
    it(`${method} ${path} as ${user?.role ?? "nobody"} -> ${expected}`, () => {
      assert.equal(accessFor(method, path, user), expected);
    });
  }
});

describe("safeNext", () => {
  it("keeps local paths and refuses anything that leaves the site", () => {
    assert.equal(safeNext("/commits?page=2"), "/commits?page=2");
    assert.equal(safeNext("//evil.example"), "/dashboard");
    assert.equal(safeNext("/\\evil.example"), "/dashboard");
    assert.equal(safeNext("https://evil.example"), "/dashboard");
    assert.equal(safeNext(null), "/dashboard");
    assert.equal(safeNext("/login"), "/dashboard");
  });
});

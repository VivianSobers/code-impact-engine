import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { checkoutDir } from "../../ingest/history/src/index";
import { checkoutPath } from "../../lib/history/checkout";

describe("checkoutPath", () => {
  const urls = [
    "https://github.com/expressjs/express",
    "https://github.com/expressjs/express.git",
    "git@github.com:a/b.git",
    "ssh://git@example.com/team/tool.git",
    "ingest/workdir/seed-repo",
  ];

  for (const url of urls) {
    it(`matches the ingest checkout for ${url}`, () => {
      assert.equal(checkoutPath(url), checkoutDir(url));
    });
  }

  it("puts remote repositories under ingest/workdir and resolves local paths against the repo root", () => {
    assert.equal(checkoutPath("git@github.com:a/b.git"), path.join(process.cwd(), "ingest", "workdir", "a-b"));
    assert.equal(checkoutPath("ingest/workdir/seed-repo"), path.join(process.cwd(), "ingest", "workdir", "seed-repo"));
  });
});

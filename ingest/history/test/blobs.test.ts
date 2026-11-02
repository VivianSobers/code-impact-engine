import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { BlobReader } from "../src/blobs";

describe("BlobReader", () => {
  let dir: string;
  let first: string;
  let second: string;

  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "cie-blobs-"));
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.com", ...args], { cwd: dir, encoding: "utf8" }).trim();
    git("init", "-q");
    writeFileSync(path.join(dir, "a.py"), "def f():\n    return 'héllo'\n");
    git("add", ".");
    git("commit", "-q", "-m", "one");
    first = git("rev-parse", "HEAD");
    writeFileSync(path.join(dir, "a.py"), "def f():\n    return 2\n");
    writeFileSync(path.join(dir, "b.py"), "");
    git("add", ".");
    git("commit", "-q", "-m", "two");
    second = git("rev-parse", "HEAD");
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  it("reads a file at different revisions, including non-ASCII and empty files", async () => {
    const reader = new BlobReader(dir);
    try {
      const [old, current, empty] = await Promise.all([
        reader.read(first, "a.py"),
        reader.read(second, "a.py"),
        reader.read(second, "b.py"),
      ]);
      assert.equal(old?.text, "def f():\n    return 'héllo'\n");
      assert.equal(current?.text, "def f():\n    return 2\n");
      assert.equal(empty?.text, "");
      assert.notEqual(old?.oid, current?.oid);
    } finally {
      reader.close();
    }
  });

  it("returns null for a path that does not exist at that revision", async () => {
    const reader = new BlobReader(dir);
    try {
      assert.equal(await reader.read(first, "b.py"), null);
      assert.equal((await reader.read(second, "b.py"))?.text, "");
    } finally {
      reader.close();
    }
  });
});

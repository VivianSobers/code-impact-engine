import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCommitFilter, parseSearchText } from "../../lib/history/params";

describe("parseCommitFilter", () => {
  it("defaults to every repository and author, no search, page 1", () => {
    assert.deepEqual(parseCommitFilter(new URLSearchParams("")), { repoId: null, authorId: null, q: "", page: 1 });
  });

  it("reads ids, trims the search and reads the page", () => {
    assert.deepEqual(parseCommitFilter(new URLSearchParams("repo=3&author=12&q=%20discount%20&page=4")), {
      repoId: 3,
      authorId: 12,
      q: "discount",
      page: 4,
    });
  });

  it("rejects bad ids, pages and over-long searches", () => {
    assert.throws(() => parseCommitFilter(new URLSearchParams("repo=abc")), /repo must be a positive integer/);
    assert.throws(() => parseCommitFilter(new URLSearchParams("page=0")), /page must be between/);
    assert.throws(() => parseSearchText("x".repeat(201)), /at most 200 characters/);
  });
});

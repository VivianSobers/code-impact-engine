import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clusterPairs } from "../src/cluster";

describe("clusterPairs", () => {
  it("joins a chain of similar pairs into one cluster scored by its weakest link", () => {
    assert.deepEqual(
      clusterPairs([
        { a: 7, b: 3, similarity: 0.99 },
        { a: 3, b: 12, similarity: 0.96 },
      ]),
      [{ members: [3, 7, 12], similarity: 0.96 }],
    );
  });

  it("keeps unrelated pairs in separate clusters, ordered by their first member", () => {
    assert.deepEqual(
      clusterPairs([
        { a: 20, b: 21, similarity: 0.97 },
        { a: 2, b: 5, similarity: 0.98 },
      ]),
      [
        { members: [2, 5], similarity: 0.98 },
        { members: [20, 21], similarity: 0.97 },
      ],
    );
  });

  it("ignores repeated and reversed pairs and self pairs", () => {
    assert.deepEqual(
      clusterPairs([
        { a: 1, b: 2, similarity: 0.97 },
        { a: 2, b: 1, similarity: 0.97 },
        { a: 1, b: 2, similarity: 0.97 },
        { a: 4, b: 4, similarity: 1 },
      ]),
      [{ members: [1, 2], similarity: 0.97 }],
    );
  });

  it("returns no clusters for no pairs", () => {
    assert.deepEqual(clusterPairs([]), []);
  });
});

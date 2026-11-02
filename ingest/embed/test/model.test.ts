import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMBEDDING_DIMS, embed } from "../src/model";

const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i], 0);

describe("embed", () => {
  it("returns one normalised 768-dimension vector per text, closer for similar code", async () => {
    const [js, py, other] = await embed([
      "function roundCurrency(value) { return Math.round(value * 100) / 100; }",
      "def round_money(x):\n    return round(x * 100) / 100",
      "function parseAddress(raw) { return raw.split(',').map((s) => s.trim()); }",
    ]);
    assert.equal(EMBEDDING_DIMS, 768);
    for (const vector of [js, py, other]) {
      assert.equal(vector.length, EMBEDDING_DIMS);
      assert.ok(Math.abs(dot(vector, vector) - 1) < 1e-3);
    }
    assert.ok(dot(js, py) > dot(js, other) + 0.3, `similar ${dot(js, py)} vs unrelated ${dot(js, other)}`);
  });

  it("embeds nothing for an empty list", async () => {
    assert.deepEqual(await embed([]), []);
  });
});

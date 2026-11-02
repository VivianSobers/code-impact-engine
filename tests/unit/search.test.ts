import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { EMBEDDING_DIMS, EMBEDDING_MODEL } from "../../lib/search/model";
import { parseSearchQuery } from "../../lib/search/params";

describe("search model", () => {
  it("is the same model and size the ingest step embeds symbols with", () => {
    const ingest = readFileSync(new URL("../../ingest/embed/src/model.ts", import.meta.url), "utf8");
    assert.ok(ingest.includes(`export const EMBEDDING_MODEL = "${EMBEDDING_MODEL}";`), "model names differ");
    assert.ok(ingest.includes(`export const EMBEDDING_DIMS = ${EMBEDDING_DIMS};`), "dimensions differ");
  });
});

describe("parseSearchQuery", () => {
  it("trims the query", () => {
    assert.equal(parseSearchQuery("  round money to two decimals \n"), "round money to two decimals");
  });

  it("rejects an empty or whitespace query", () => {
    assert.throws(() => parseSearchQuery(""), /Describe what the code does/);
    assert.throws(() => parseSearchQuery("   "), /Describe what the code does/);
    assert.throws(() => parseSearchQuery(null), /Describe what the code does/);
  });

  it("rejects queries over 500 characters", () => {
    assert.equal(parseSearchQuery("a".repeat(500)).length, 500);
    assert.throws(() => parseSearchQuery("a".repeat(501)), /at most 500 characters/);
  });
});

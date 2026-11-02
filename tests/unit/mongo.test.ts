import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mongoDatabaseName } from "../../lib/mongo";

const saved = process.env.MONGODB_DB;

afterEach(() => {
  if (saved === undefined) delete process.env.MONGODB_DB;
  else process.env.MONGODB_DB = saved;
});

describe("mongoDatabaseName", () => {
  it("defaults to cie", () => {
    delete process.env.MONGODB_DB;
    assert.equal(mongoDatabaseName(), "cie");
  });

  it("uses MONGODB_DB when set", () => {
    process.env.MONGODB_DB = "cie_other";
    assert.equal(mongoDatabaseName(), "cie_other");
  });
});

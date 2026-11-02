import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createPool } from "../../lib/pg";

const saved = process.env.DATABASE_URL;

afterEach(() => {
  if (saved === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved;
});

describe("createPool", () => {
  it("refuses to start without DATABASE_URL", () => {
    delete process.env.DATABASE_URL;
    assert.throws(() => createPool(), { message: "Missing environment variable DATABASE_URL" });
  });

  it("uses DATABASE_URL and caps connections at 10", async () => {
    process.env.DATABASE_URL = "postgresql://cie:secret@db.example:5432/cie";
    const pool = createPool();
    assert.equal(pool.options.connectionString, "postgresql://cie:secret@db.example:5432/cie");
    assert.equal(pool.options.max, 10);
    await pool.end();
  });
});

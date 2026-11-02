import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DUMMY_HASH, hashPassword, verifyPassword } from "../../lib/auth/password";

describe("passwords", () => {
  it("hashes with bcrypt cost 12 and verifies only the right password", async () => {
    const hash = await hashPassword("correct horse battery");
    assert.match(hash, /^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/);
    assert.equal(await verifyPassword("correct horse battery", hash), true);
    assert.equal(await verifyPassword("correct horse batterY", hash), false);
  });

  it("refuses passwords shorter than 10 characters or longer than 72 bytes", async () => {
    await assert.rejects(hashPassword("short1234"), { message: "Use at least 10 characters." });
    await assert.rejects(hashPassword("é".repeat(37)), { message: "Use at most 72 bytes." });
  });

  it("has a real dummy hash for timing-safe checks of unknown users", async () => {
    assert.match(DUMMY_HASH, /^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/);
    assert.equal(await verifyPassword("anything at all", DUMMY_HASH), false);
  });
});

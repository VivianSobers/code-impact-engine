import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createSessionToken, readSessionToken, type SessionUser } from "../../lib/auth/session";

const ana: SessionUser = { userId: 7, username: "ana", role: "admin" };
const saved = process.env.SESSION_SECRET;

beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret-that-is-long-enough-1234567";
});

afterEach(() => {
  if (saved === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = saved;
});

describe("session tokens", () => {
  it("round-trips the user", async () => {
    assert.deepEqual(await readSessionToken(await createSessionToken(ana)), ana);
  });

  it("rejects a token whose payload was changed", async () => {
    const [header, payload, signature] = (await createSessionToken(ana)).split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), role: "admin", sub: "1" }),
    ).toString("base64url");
    assert.equal(await readSessionToken(`${header}.${forged}.${signature}`), null);
  });

  it("rejects a token older than eight hours", async () => {
    const nineHoursAgo = Date.now() - 9 * 60 * 60 * 1000;
    assert.equal(await readSessionToken(await createSessionToken(ana, nineHoursAgo)), null);
  });

  it("rejects missing and malformed tokens", async () => {
    assert.equal(await readSessionToken(undefined), null);
    assert.equal(await readSessionToken("not-a-token"), null);
  });

  it("rejects a token signed with another secret", async () => {
    const token = await createSessionToken(ana);
    process.env.SESSION_SECRET = "another-secret-that-is-long-enough-12345";
    assert.equal(await readSessionToken(token), null);
  });

  it("refuses to sign with a secret shorter than 32 characters", async () => {
    process.env.SESSION_SECRET = "too-short";
    await assert.rejects(createSessionToken(ana), { message: "SESSION_SECRET must be at least 32 characters." });
  });
});

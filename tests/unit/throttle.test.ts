import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LoginThrottle } from "../../lib/auth/throttle";

const MINUTE = 60_000;

describe("LoginThrottle", () => {
  it("blocks a username after five failures within ten minutes", () => {
    const throttle = new LoginThrottle();
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) {
      assert.equal(throttle.isBlocked("ana", t0 + i * MINUTE), false);
      throttle.fail("ana", t0 + i * MINUTE);
    }
    assert.equal(throttle.isBlocked("ana", t0 + 5 * MINUTE), true);
    assert.equal(throttle.isBlocked("ben", t0 + 5 * MINUTE), false);
  });

  it("lets the user try again once the oldest failure is ten minutes old", () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < 5; i++) throttle.fail("ana", i * MINUTE);
    assert.equal(throttle.isBlocked("ana", 9 * MINUTE), true);
    assert.equal(throttle.isBlocked("ana", 10 * MINUTE), false);
  });

  it("forgets failures after a successful login", () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < 4; i++) throttle.fail("ana", i);
    throttle.reset("ana");
    throttle.fail("ana", 5);
    assert.equal(throttle.isBlocked("ana", 6), false);
  });
});

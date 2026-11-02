import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { requireEnv } from "../../lib/env";

const NAME = "CIE_TEST_REQUIRE_ENV";

describe("requireEnv", () => {
  afterEach(() => {
    delete process.env[NAME];
  });

  it("returns the value of a set variable", () => {
    process.env[NAME] = "postgresql://example";
    assert.equal(requireEnv(NAME), "postgresql://example");
  });

  it("throws with the variable name when it is unset", () => {
    assert.throws(() => requireEnv(NAME), { message: `Missing environment variable ${NAME}` });
  });

  it("throws when the variable is empty", () => {
    process.env[NAME] = "";
    assert.throws(() => requireEnv(NAME), { message: `Missing environment variable ${NAME}` });
  });
});

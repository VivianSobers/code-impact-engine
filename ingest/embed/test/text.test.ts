import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bodyHash, MAX_BODY_CHARS, symbolBody } from "../src/text";

const source = [
  "import { x } from './x';",
  "",
  "export function roundCurrency(value: number): number {",
  "  return Math.round(value * 100) / 100;",
  "}",
  "",
].join("\n");

describe("symbolBody", () => {
  it("takes the symbol's lines, both ends included", () => {
    assert.equal(
      symbolBody(source, 3, 5),
      "export function roundCurrency(value: number): number {\n  return Math.round(value * 100) / 100;\n}",
    );
  });

  it("treats Windows line endings like Unix ones", () => {
    assert.equal(symbolBody(source.replace(/\n/g, "\r\n"), 3, 5), symbolBody(source, 3, 5));
  });

  it("cuts very long bodies", () => {
    const long = Array.from({ length: 500 }, (_, i) => `  total += values[${i}] * weights[${i}];`).join("\n");
    const body = symbolBody(`function f() {\n${long}\n}`, 1, 502);
    assert.equal(body.length, MAX_BODY_CHARS);
    assert.ok(body.startsWith("function f() {\n"));
  });
});

describe("bodyHash", () => {
  it("is the same for identical bodies in different files and differs otherwise", () => {
    const a = bodyHash(symbolBody(source, 3, 5));
    const b = bodyHash(symbolBody(`// other file\n${source}`, 4, 6));
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.equal(a, b);
    assert.notEqual(a, bodyHash(symbolBody(source, 3, 4)));
  });
});

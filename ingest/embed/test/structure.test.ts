import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { codeTokens, structuralSimilarity } from "../src/structure";

const total = (name: string, items: string) =>
  `function ${name}(${items}) {\n  let sum = 0;\n  for (const item of ${items}) {\n    sum += item.price * 2;\n  }\n  return sum;\n}`;

describe("codeTokens", () => {
  it("keeps keywords and punctuation and blanks out names, strings and numbers", () => {
    assert.deepEqual(codeTokens(`if (user.name === "ana") return 42; // check`), [
      "if", "(", "ID", ".", "ID", "===", "STR", ")", "return", "NUM", ";",
    ]);
  });

  it("drops block, line and hash comments", () => {
    assert.deepEqual(codeTokens("/* a */ x = 1 # b\n// c\ny"), ["ID", "=", "NUM", "ID"]);
  });
});

describe("structuralSimilarity", () => {
  it("is 1 for code that only differs in names and literals", () => {
    assert.equal(structuralSimilarity(total("cartTotal", "items"), total("invoiceTotal", "lines")), 1);
  });

  it("stays high for a one-token change", () => {
    const has = `function has(h) {\n  return function (res) {\n    assert.ok((h in res.headers), 'has ' + h)\n  }\n}`;
    const hasNot = `function hasNot(h) {\n  return function (res) {\n    assert.ok(!(h in res.headers), 'has not ' + h)\n  }\n}`;
    const score = structuralSimilarity(has, hasNot);
    assert.ok(score > 0.9 && score < 1, String(score));
  });

  it("is low for code with a different shape", () => {
    const parse = `function parse(raw) {\n  const [a = "", b = ""] = raw.split(",");\n  return { a, b: b.toUpperCase() };\n}`;
    assert.ok(structuralSimilarity(total("cartTotal", "items"), parse) < 0.6);
  });

  it("is 0 when either side has no code", () => {
    assert.equal(structuralSimilarity("", total("t", "x")), 0);
    assert.equal(structuralSimilarity("// only a comment", total("t", "x")), 0);
  });
});

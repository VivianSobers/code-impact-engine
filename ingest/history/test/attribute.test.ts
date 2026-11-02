import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RawSymbol, SymbolKind } from "../../parse/src/extract/types";
import { attribute, parseSymbolKey, symbolKeys } from "../src/attribute";
import type { Hunk } from "../src/gitlog";

function sym(name: string, kind: SymbolKind, startLine: number, endLine: number): RawSymbol {
  return { name, kind, signature: null, startLine, endLine, exported: false, mainLike: false, owner: null, selfName: null };
}

function hunk(oldStart: number, oldLines: number, newStart: number, newLines: number): Hunk {
  return { oldStart, oldLines, newStart, newLines };
}

function key(kind: SymbolKind, name: string, ordinal = 0): string {
  return `${kind}\u0000${name}\u0000${ordinal}`;
}

describe("symbolKeys", () => {
  it("numbers symbols that share a kind and name by their position in the file", () => {
    const keys = symbolKeys([sym("m", "method", 6, 8), sym("m", "method", 2, 4), sym("m", "function", 10, 12)]);
    assert.deepEqual([...keys.keys()], [key("method", "m", 0), key("method", "m", 1), key("function", "m", 0)]);
    assert.equal(keys.get(key("method", "m", 0))?.startLine, 2);
    assert.deepEqual(parseSymbolKey(key("method", "m", 1)), { kind: "method", name: "m", ordinal: 1 });
  });
});

describe("attribute", () => {
  it("counts an edit inside one function", () => {
    const symbols = [sym("f", "function", 1, 5), sym("g", "function", 7, 10)];
    assert.deepEqual(attribute([hunk(2, 1, 2, 1)], symbols, symbols), [
      { key: key("function", "f"), additions: 1, deletions: 1, changeType: "modified" },
    ]);
  });

  it("splits a hunk that crosses two functions", () => {
    const before = [sym("f", "function", 1, 5), sym("g", "function", 6, 10)];
    const after = [sym("f", "function", 1, 5), sym("g", "function", 6, 9)];
    assert.deepEqual(attribute([hunk(5, 2, 5, 1)], before, after), [
      { key: key("function", "f"), additions: 1, deletions: 1, changeType: "modified" },
      { key: key("function", "g"), additions: 0, deletions: 1, changeType: "modified" },
    ]);
  });

  it("counts a pure deletion against the old span", () => {
    const before = [sym("f", "function", 1, 5)];
    const after = [sym("f", "function", 1, 3)];
    assert.deepEqual(attribute([hunk(3, 2, 2, 0)], before, after), [
      { key: key("function", "f"), additions: 0, deletions: 2, changeType: "modified" },
    ]);
  });

  it("marks a function that did not exist before as added", () => {
    const before = [sym("f", "function", 1, 5)];
    const after = [sym("f", "function", 1, 5), sym("h", "function", 7, 9)];
    assert.deepEqual(attribute([hunk(5, 0, 6, 4)], before, after), [
      { key: key("function", "h"), additions: 3, deletions: 0, changeType: "added" },
    ]);
  });

  it("counts a method edit for the method and its class, but never for the module", () => {
    const symbols = [sym("app.ts", "module", 1, 12), sym("C", "class", 1, 10), sym("m", "method", 2, 4)];
    assert.deepEqual(attribute([hunk(3, 1, 3, 1)], symbols, symbols), [
      { key: key("class", "C"), additions: 1, deletions: 1, changeType: "modified" },
      { key: key("method", "m"), additions: 1, deletions: 1, changeType: "modified" },
    ]);
  });

  it("keeps overloads with the same name apart", () => {
    const symbols = [sym("m", "method", 2, 4), sym("m", "method", 6, 8)];
    assert.deepEqual(attribute([hunk(7, 1, 7, 1)], symbols, symbols), [
      { key: key("method", "m", 1), additions: 1, deletions: 1, changeType: "modified" },
    ]);
  });

  it("treats every symbol of a new file as added", () => {
    const after = [sym("f", "function", 1, 5), sym("g", "function", 7, 10)];
    assert.deepEqual(attribute([hunk(0, 0, 1, 10)], null, after), [
      { key: key("function", "f"), additions: 5, deletions: 0, changeType: "added" },
      { key: key("function", "g"), additions: 4, deletions: 0, changeType: "added" },
    ]);
  });

  it("drops symbols that only exist before the change", () => {
    const before = [sym("f", "function", 1, 5)];
    assert.deepEqual(attribute([hunk(1, 5, 0, 0)], before, null), []);
    assert.deepEqual(attribute([hunk(1, 5, 1, 0)], before, []), []);
  });
});

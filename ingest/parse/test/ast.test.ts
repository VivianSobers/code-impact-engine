import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countLines, flattenTree } from "../src/ast";
import { parse } from "../src/parser";

describe("countLines", () => {
  it("counts every line including a last line without a newline", () => {
    assert.equal(countLines(""), 0);
    assert.equal(countLines("a"), 1);
    assert.equal(countLines("a\n"), 1);
    assert.equal(countLines("a\nb"), 2);
    assert.equal(countLines("a\r\nb\r\n"), 2);
    assert.equal(countLines("\n\n\n"), 3);
  });
});

describe("flattenTree", () => {
  it("stores named nodes in pre-order with parent pointers and depths", async () => {
    const tree = await parse("javascript", "function add(a, b) {\n  return a + b;\n}\n");
    const ast = flattenTree(tree);
    tree.delete();

    assert.equal(ast.truncated, false);
    assert.equal(ast.nodeCount, ast.nodes.length);
    assert.equal(ast.nodes[0].t, "program");
    assert.equal(ast.nodes[0].p, -1);
    assert.equal(ast.nodes[0].d, 0);
    ast.nodes.forEach((node, index) => {
      assert.equal(node.i, index);
      assert.deepEqual(Object.keys(node).sort(), ["d", "e", "f", "i", "n", "p", "s", "t"]);
      if (node.p >= 0) {
        assert.ok(node.p < index);
        assert.equal(node.d, ast.nodes[node.p].d + 1);
      }
      assert.ok(node.n === null || node.n.length <= 64);
    });
    assert.equal(ast.maxDepth, Math.max(...ast.nodes.map((node) => node.d)));

    const name = ast.nodes.find((node) => node.t === "identifier" && node.f === "name");
    assert.equal(name?.n, "add");
    assert.deepEqual(name?.s, [0, 9]);
    assert.equal(ast.nodes[name!.p].t, "function_declaration");
  });

  it("stops at the cap and marks the tree as truncated", async () => {
    const tree = await parse("python", Array.from({ length: 50 }, (_, index) => `x${index} = ${index}`).join("\n"));
    const ast = flattenTree(tree, 20);
    tree.delete();
    assert.equal(ast.truncated, true);
    assert.equal(ast.nodes.length, 20);
    assert.equal(ast.nodeCount, 20);
  });

  it("leaves text off leaves longer than 64 characters", async () => {
    const tree = await parse("javascript", `const s = "${"x".repeat(80)}";\nconst t = "short";\n`);
    const ast = flattenTree(tree);
    tree.delete();
    const fragments = ast.nodes.filter((node) => node.t === "string_fragment");
    assert.deepEqual(fragments.map((node) => node.n), [null, "short"]);
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { computeWorkflowLayout, traceConnectedPaths } from "@/components/structure/workflowLayout";
import type { SymbolDetail } from "@/lib/structure/types";
import type { ImpactRow } from "@/lib/structure/impact";

const target: SymbolDetail = {
  symbolId: 89,
  repoId: 1,
  repoName: "seed-repo",
  path: "src/money.ts",
  name: "roundCurrency",
  kind: "function",
  signature: "(n: number): number",
  startLine: 10,
  endLine: 18,
  length: 9,
  isEntryPoint: false,
  embeddingId: null,
  clusterId: null,
};

const rows: ImpactRow[] = [
  {
    symbolId: 90,
    repoId: 1,
    path: "src/money.ts",
    name: "formatMoney",
    kind: "function",
    depth: 1,
    isEntryPoint: false,
    minConfidence: 1.0,
    callPath: [90, 89],
  },
  {
    symbolId: 98,
    repoId: 1,
    path: "src/pricing.ts",
    name: "applyDiscount",
    kind: "function",
    depth: 1,
    isEntryPoint: false,
    minConfidence: 0.9,
    callPath: [98, 89],
  },
  {
    symbolId: 99,
    repoId: 1,
    path: "src/pricing.ts",
    name: "priceOrder",
    kind: "function",
    depth: 2,
    isEntryPoint: false,
    minConfidence: 0.9,
    callPath: [99, 98, 89],
  },
  {
    symbolId: 103,
    repoId: 1,
    path: "src/orders.ts",
    name: "create",
    kind: "method",
    depth: 2,
    isEntryPoint: false,
    minConfidence: 0.9,
    callPath: [103, 90, 89],
  },
  {
    symbolId: 80,
    repoId: 1,
    path: "src/routes.ts",
    name: "POST",
    kind: "function",
    depth: 3,
    isEntryPoint: true,
    minConfidence: 0.85,
    callPath: [80, 103, 90, 89],
  },
];

test("computeWorkflowLayout builds stages from entry points to target", () => {
  const layout = computeWorkflowLayout(target, rows);

  assert.equal(layout.nodes.length, 6); // 5 rows + target
  assert.equal(layout.stages.length, 4); // Depth 3, 2, 1, 0 (target)

  // Target is in the rightmost stage
  const targetNode = layout.nodes.find((n) => n.symbolId === 89);
  assert(targetNode);
  assert.equal(targetNode.isTarget, true);
  assert.equal(targetNode.column, 3);

  // POST is in the leftmost stage (column 0)
  const postNode = layout.nodes.find((n) => n.symbolId === 80);
  assert(postNode);
  assert.equal(postNode.isEntryPoint, true);
  assert.equal(postNode.column, 0);

  // Edges check
  assert.equal(layout.edges.length, 5);
  // POST (80) -> create (103)
  assert(layout.edges.some((e) => e.fromId === 80 && e.toId === 103));
  // create (103) -> formatMoney (90)
  assert(layout.edges.some((e) => e.fromId === 103 && e.toId === 90));
  // formatMoney (90) -> roundCurrency (89)
  assert(layout.edges.some((e) => e.fromId === 90 && e.toId === 89));
  // priceOrder (99) -> applyDiscount (98)
  assert(layout.edges.some((e) => e.fromId === 99 && e.toId === 98));
  // applyDiscount (98) -> roundCurrency (89)
  assert(layout.edges.some((e) => e.fromId === 98 && e.toId === 89));

  // Verify curved paths start and end cleanly
  for (const edge of layout.edges) {
    assert(edge.d.startsWith("M "));
    assert(edge.d.includes(" C "));
  }
});

test("computeWorkflowLayout filters to entry points paths when requested", () => {
  const layout = computeWorkflowLayout(target, rows, { entryPointsOnly: true });

  // Only paths originating from POST (80): 80 -> 103 -> 90 -> 89
  assert.equal(layout.nodes.length, 4);
  assert(layout.nodes.some((n) => n.symbolId === 80));
  assert(layout.nodes.some((n) => n.symbolId === 103));
  assert(layout.nodes.some((n) => n.symbolId === 90));
  assert(layout.nodes.some((n) => n.symbolId === 89));
  assert(!layout.nodes.some((n) => n.symbolId === 99)); // priceOrder excluded
  assert(!layout.nodes.some((n) => n.symbolId === 98)); // applyDiscount excluded
});

test("traceConnectedPaths correctly identifies upstream and downstream nodes", () => {
  const layout = computeWorkflowLayout(target, rows);

  // Trace from create (103)
  const active = traceConnectedPaths(103, layout);
  assert(active.nodes.has(103)); // self
  assert(active.nodes.has(80)); // upstream caller (POST)
  assert(active.nodes.has(90)); // downstream callee (formatMoney)
  assert(active.nodes.has(89)); // downstream target (roundCurrency)
  assert(!active.nodes.has(99)); // unrelated branch
  assert(!active.nodes.has(98)); // unrelated branch

  // Active edges
  assert(active.edges.has("80->103"));
  assert(active.edges.has("103->90"));
  assert(active.edges.has("90->89"));
  assert(!active.edges.has("99->98"));
});

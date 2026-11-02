import type { Tree } from "./parser";

export const maxStoredNodes = 50_000;
const maxLeafText = 64;

export interface AstNode {
  i: number;
  p: number;
  t: string;
  d: number;
  f: string | null;
  s: [number, number];
  e: [number, number];
  n: string | null;
}

export interface FlatAst {
  nodes: AstNode[];
  nodeCount: number;
  maxDepth: number;
  truncated: boolean;
}

export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let lines = 0;
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) lines++;
  return text.endsWith("\n") ? lines : lines + 1;
}

export function flattenTree(tree: Tree, cap = maxStoredNodes): FlatAst {
  const cursor = tree.walk();
  const nodes: AstNode[] = [];
  const nearestNamed: number[] = [];
  const namedDepth: number[] = [];
  let depth = 0;
  let count = 0;
  let maxDepth = 0;

  try {
    for (;;) {
      const parentIndex = depth > 0 ? nearestNamed[depth - 1] : -1;
      const parentDepth = depth > 0 ? namedDepth[depth - 1] : -1;
      let stored: AstNode | null = null;

      if (cursor.nodeIsNamed) {
        if (count >= cap) return { nodes, nodeCount: count, maxDepth, truncated: true };
        const index = count++;
        const nodeDepth = parentDepth + 1;
        maxDepth = Math.max(maxDepth, nodeDepth);
        nearestNamed[depth] = index;
        namedDepth[depth] = nodeDepth;
        const start = cursor.startPosition;
        const end = cursor.endPosition;
        stored = {
          i: index,
          p: parentIndex,
          t: cursor.nodeType,
          d: nodeDepth,
          f: cursor.currentFieldName || null,
          s: [start.row, start.column],
          e: [end.row, end.column],
          n: null,
        };
        nodes.push(stored);
      } else {
        nearestNamed[depth] = parentIndex;
        namedDepth[depth] = parentDepth;
      }

      if (cursor.gotoFirstChild()) {
        depth++;
        continue;
      }
      if (stored) {
        const text = cursor.nodeText;
        stored.n = text.length <= maxLeafText ? text : null;
      }
      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) return { nodes, nodeCount: count, maxDepth, truncated: false };
        depth--;
      }
    }
  } finally {
    cursor.delete();
  }
}

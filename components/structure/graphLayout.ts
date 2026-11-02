import type { CallGraph, GraphEdge, GraphNode } from "@/lib/structure/graph";

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 46;
const COLUMN_GAP = 72;
const ROW_GAP = 14;
const PAD_X = 24;
const HEADER = 40;
const PAD_BOTTOM = 28;

export interface PlacedNode extends GraphNode {
  x: number;
  y: number;
}

export interface PlacedEdge extends GraphEdge {
  d: string;
  backward: boolean;
}

export interface ColumnLabel {
  column: number;
  x: number;
  label: string;
}

export interface GraphLayout {
  width: number;
  height: number;
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  columns: ColumnLabel[];
}

function columnLabel(column: number): string {
  if (column === 0) return "Selected symbol";
  if (column === -1) return "Direct callers";
  if (column === 1) return "Direct callees";
  return column < 0 ? `Callers, ${-column} steps away` : `Callees, ${column} steps away`;
}

function orderColumns(graph: CallGraph): Map<number, GraphNode[]> {
  const byColumn = new Map<number, GraphNode[]>();
  for (const node of graph.nodes) {
    const list = byColumn.get(node.column) ?? [];
    list.push(node);
    byColumn.set(node.column, list);
  }

  const neighbours = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    neighbours.get(a)!.add(b);
  };
  for (const e of graph.edges) {
    link(e.callerId, e.calleeId);
    link(e.calleeId, e.callerId);
  }

  const index = new Map<number, number>();
  const byName = (a: GraphNode, b: GraphNode) => a.path.localeCompare(b.path) || a.name.localeCompare(b.name);
  const center = (byColumn.get(0) ?? []).sort(byName);
  center.forEach((n, i) => index.set(n.symbolId, i));

  for (const direction of [-1, 1]) {
    for (let step = 1; byColumn.has(step * direction); step++) {
      const column = step * direction;
      const previous = column - direction;
      const scored = byColumn.get(column)!.map((node) => {
        const positions = [...(neighbours.get(node.symbolId) ?? [])]
          .filter((id) => (byColumn.get(previous) ?? []).some((n) => n.symbolId === id))
          .map((id) => index.get(id)!)
          .filter((v) => v !== undefined);
        const score = positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : Infinity;
        return { node, score };
      });
      scored.sort((a, b) => a.score - b.score || byName(a.node, b.node));
      scored.forEach(({ node }, i) => index.set(node.symbolId, i));
      byColumn.set(column, scored.map((s) => s.node));
    }
  }
  return byColumn;
}

function edgePath(from: PlacedNode, to: PlacedNode): { d: string; backward: boolean } {
  const sx = from.x + NODE_WIDTH;
  const sy = from.y + NODE_HEIGHT / 2;
  const tx = to.x;
  const ty = to.y + NODE_HEIGHT / 2;

  if (from.symbolId === to.symbolId) {
    const x = from.x + NODE_WIDTH - 36;
    return { d: `M ${x} ${from.y} C ${x} ${from.y - 26}, ${x + 30} ${from.y - 26}, ${x + 30} ${from.y}`, backward: true };
  }
  if (to.column > from.column) {
    const bend = (tx - sx) / 2;
    return { d: `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`, backward: false };
  }
  const lift = Math.max(NODE_HEIGHT, Math.abs(ty - sy) / 2 + 30);
  const top = Math.max(Math.min(sy, ty) - lift, HEADER + 6);
  return {
    d: `M ${sx} ${sy} C ${sx + 60} ${sy}, ${sx + 60} ${top}, ${(sx + tx) / 2} ${top} S ${tx - 60} ${ty}, ${tx} ${ty}`,
    backward: true,
  };
}

export function layoutGraph(graph: CallGraph): GraphLayout {
  const byColumn = orderColumns(graph);
  const keys = [...byColumn.keys()].sort((a, b) => a - b);
  const tallest = Math.max(...keys.map((k) => byColumn.get(k)!.length), 1);
  const bodyHeight = tallest * (NODE_HEIGHT + ROW_GAP) - ROW_GAP;
  const backwardRoom = graph.edges.some((e) => {
    const a = graph.nodes.find((n) => n.symbolId === e.callerId);
    const b = graph.nodes.find((n) => n.symbolId === e.calleeId);
    return a && b && b.column <= a.column;
  })
    ? 40
    : 0;

  const nodes: PlacedNode[] = [];
  const columns: ColumnLabel[] = [];
  keys.forEach((key, ci) => {
    const list = byColumn.get(key)!;
    const x = PAD_X + ci * (NODE_WIDTH + COLUMN_GAP);
    const height = list.length * (NODE_HEIGHT + ROW_GAP) - ROW_GAP;
    const top = HEADER + backwardRoom + (bodyHeight - height) / 2;
    columns.push({ column: key, x, label: columnLabel(key) });
    list.forEach((node, ri) => nodes.push({ ...node, x, y: top + ri * (NODE_HEIGHT + ROW_GAP) }));
  });

  const placed = new Map(nodes.map((n) => [n.symbolId, n]));
  const edges: PlacedEdge[] = graph.edges.flatMap((e) => {
    const from = placed.get(e.callerId);
    const to = placed.get(e.calleeId);
    return from && to ? [{ ...e, ...edgePath(from, to) }] : [];
  });

  return {
    width: PAD_X * 2 + keys.length * NODE_WIDTH + (keys.length - 1) * COLUMN_GAP,
    height: HEADER + backwardRoom + bodyHeight + PAD_BOTTOM,
    nodes,
    edges,
    columns,
  };
}

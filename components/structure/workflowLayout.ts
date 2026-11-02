import type { ImpactRow } from "@/lib/structure/impact";
import type { SymbolDetail } from "@/lib/structure/types";

export const NODE_WIDTH = 250;
export const NODE_HEIGHT = 80;
export const COLUMN_GAP = 130;
export const ROW_GAP = 46;
export const PAD_X = 60;
export const PAD_TOP = 80;
export const PAD_BOTTOM = 60;

export interface WorkflowNode {
  symbolId: number;
  repoId: number;
  path: string;
  name: string;
  kind: string;
  depth: number;
  isEntryPoint: boolean;
  isTarget: boolean;
  minConfidence: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkflowEdge {
  id: string; // `${fromId}->${toId}`
  fromId: number;
  toId: number;
  confidence: number;
  d: string;
  isBackward: boolean;
}

export interface WorkflowStage {
  column: number;
  label: string;
  subtitle: string;
  depth: number;
  x: number;
  width: number;
}

export interface WorkflowLayout {
  width: number;
  height: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  stages: WorkflowStage[];
  maxDepth: number;
  nodeMap: Map<number, WorkflowNode>;
  incomingEdges: Map<number, number[]>;
  outgoingEdges: Map<number, number[]>;
}

export interface LayoutOptions {
  entryPointsOnly?: boolean;
  maxNodes?: number;
}

function edgeD(from: WorkflowNode, to: WorkflowNode): { d: string; isBackward: boolean } {
  const sx = from.x + from.width;
  const sy = from.y + from.height / 2;
  const tx = to.x;
  const ty = to.y + to.height / 2;

  // Self loop
  if (from.symbolId === to.symbolId) {
    const loopX = from.x + from.width - 24;
    return {
      d: `M ${loopX} ${from.y} C ${loopX} ${from.y - 36}, ${loopX + 32} ${from.y - 36}, ${loopX + 32} ${from.y}`,
      isBackward: true,
    };
  }

  // Left-to-right forward curve
  if (to.column > from.column) {
    const dx = tx - sx;
    const cx1 = sx + dx * 0.48;
    const cx2 = tx - dx * 0.48;
    return {
      d: `M ${sx} ${sy} C ${cx1} ${sy}, ${cx2} ${ty}, ${tx} ${ty}`,
      isBackward: false,
    };
  }

  // Same column or backward curve
  const lift = Math.max(NODE_HEIGHT, Math.abs(ty - sy) / 2 + 35);
  const topY = Math.min(sy, ty) - lift;
  return {
    d: `M ${sx} ${sy} C ${sx + 50} ${topY}, ${tx - 50} ${topY}, ${tx} ${ty}`,
    isBackward: true,
  };
}

export function computeWorkflowLayout(
  target: SymbolDetail,
  rows: ImpactRow[],
  options: LayoutOptions = {},
): WorkflowLayout {
  const { entryPointsOnly = false, maxNodes = 60 } = options;

  // 1. Determine which rows to include
  let includedRows = rows;
  if (entryPointsOnly) {
    const entryRows = rows.filter((r) => r.isEntryPoint);
    if (entryRows.length > 0) {
      const allowedIds = new Set<number>();
      for (const er of entryRows) {
        for (const id of er.callPath) {
          allowedIds.add(id);
        }
      }
      includedRows = rows.filter((r) => allowedIds.has(r.symbolId));
    }
  }

  if (includedRows.length > maxNodes) {
    includedRows = includedRows.slice(0, maxNodes);
  }

  const maxDepth = includedRows.length > 0 ? Math.max(...includedRows.map((r) => r.depth), 1) : 1;

  // 2. Build preliminary nodes
  const rawNodeMap = new Map<number, Omit<WorkflowNode, "x" | "y" | "width" | "height">>();

  // Target node (depth 0, rightmost column: maxDepth)
  rawNodeMap.set(target.symbolId, {
    symbolId: target.symbolId,
    repoId: target.repoId,
    path: target.path,
    name: target.name,
    kind: target.kind,
    depth: 0,
    isEntryPoint: target.isEntryPoint,
    isTarget: true,
    minConfidence: 1.0,
    column: maxDepth,
  });

  for (const r of includedRows) {
    if (!rawNodeMap.has(r.symbolId)) {
      rawNodeMap.set(r.symbolId, {
        symbolId: r.symbolId,
        repoId: r.repoId,
        path: r.path,
        name: r.name,
        kind: r.kind,
        depth: r.depth,
        isEntryPoint: r.isEntryPoint,
        isTarget: false,
        minConfidence: r.minConfidence,
        // Column is maxDepth - depth:
        // Highest depth (entry/roots) -> column 0 (left)
        // Depth 1 (direct callers) -> column maxDepth - 1
        // Depth 0 (target) -> column maxDepth (right)
        column: Math.max(0, maxDepth - r.depth),
      });
    }
  }

  // 3. Extract edges from callPath
  const edgeMap = new Map<string, { fromId: number; toId: number; confidence: number }>();
  const incoming = new Map<number, number[]>();
  const outgoing = new Map<number, number[]>();

  const registerEdge = (fromId: number, toId: number, confidence: number) => {
    if (!rawNodeMap.has(fromId) || !rawNodeMap.has(toId)) return;
    const key = `${fromId}->${toId}`;
    const existing = edgeMap.get(key);
    if (!existing || confidence > existing.confidence) {
      edgeMap.set(key, { fromId, toId, confidence });
    }
  };

  for (const r of includedRows) {
    const path = r.callPath;
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      registerEdge(from, to, r.minConfidence);
    }
  }

  // Build adjacency
  for (const edge of edgeMap.values()) {
    const outList = outgoing.get(edge.fromId) ?? [];
    outList.push(edge.toId);
    outgoing.set(edge.fromId, outList);

    const inList = incoming.get(edge.toId) ?? [];
    inList.push(edge.fromId);
    incoming.set(edge.toId, inList);
  }

  // 4. Partition nodes into columns
  const columns: Omit<WorkflowNode, "x" | "y" | "width" | "height">[][] = Array.from(
    { length: maxDepth + 1 },
    () => [],
  );

  for (const node of rawNodeMap.values()) {
    const colIdx = Math.min(Math.max(node.column, 0), maxDepth);
    columns[colIdx].push(node);
  }

  // 5. Optimize vertical ordering within each column to reduce crossings
  const sortColumn0 = (a: typeof rawNodeMap extends Map<number, infer V> ? V : never, b: typeof a) => {
    if (a.isEntryPoint !== b.isEntryPoint) return a.isEntryPoint ? -1 : 1;
    return a.name.localeCompare(b.name);
  };
  columns[0].sort(sortColumn0);

  // Position indexing for barycenter calculation
  const nodeIndexMap = new Map<number, number>();
  columns[0].forEach((n, idx) => nodeIndexMap.set(n.symbolId, idx));

  for (let c = 1; c <= maxDepth; c++) {
    const colNodes = columns[c];
    if (c === maxDepth) {
      // Rightmost column is the target (keep centered)
      continue;
    }

    const scored = colNodes.map((node) => {
      // Look at incoming callers from earlier columns
      const callers = (incoming.get(node.symbolId) ?? []).filter((id) => nodeIndexMap.has(id));
      const callerPositions = callers.map((id) => nodeIndexMap.get(id)!);
      const avgPos =
        callerPositions.length > 0
          ? callerPositions.reduce((sum, p) => sum + p, 0) / callerPositions.length
          : Infinity;
      return { node, score: avgPos };
    });

    scored.sort((a, b) => a.score - b.score || a.node.name.localeCompare(b.node.name));
    scored.forEach(({ node }, idx) => {
      nodeIndexMap.set(node.symbolId, idx);
    });
    columns[c] = scored.map((s) => s.node);
  }

  // 6. Compute coordinates with generous spacing
  const maxNodesInAnyCol = Math.max(...columns.map((c) => c.length), 1);
  const contentHeight = maxNodesInAnyCol * NODE_HEIGHT + (maxNodesInAnyCol - 1) * ROW_GAP;
  const canvasHeight = Math.max(PAD_TOP + contentHeight + PAD_BOTTOM, 360);

  const placedNodes: WorkflowNode[] = [];
  const finalNodeMap = new Map<number, WorkflowNode>();

  for (let c = 0; c <= maxDepth; c++) {
    const colNodes = columns[c];
    const colX = PAD_X + c * (NODE_WIDTH + COLUMN_GAP);

    // Vertically center smaller columns within the total content height
    const colContentHeight = colNodes.length * NODE_HEIGHT + Math.max(0, colNodes.length - 1) * ROW_GAP;
    const offsetY = Math.max(0, (contentHeight - colContentHeight) / 2);

    colNodes.forEach((node, idx) => {
      const nodeY = PAD_TOP + offsetY + idx * (NODE_HEIGHT + ROW_GAP);
      const placed: WorkflowNode = {
        ...node,
        x: colX,
        y: nodeY,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      };
      placedNodes.push(placed);
      finalNodeMap.set(node.symbolId, placed);
    });
  }

  const canvasWidth = PAD_X * 2 + (maxDepth + 1) * NODE_WIDTH + maxDepth * COLUMN_GAP;

  // 7. Generate placed Bézier edges
  const placedEdges: WorkflowEdge[] = [];
  for (const edge of edgeMap.values()) {
    const fromNode = finalNodeMap.get(edge.fromId);
    const toNode = finalNodeMap.get(edge.toId);
    if (!fromNode || !toNode) continue;

    const { d, isBackward } = edgeD(fromNode, toNode);
    placedEdges.push({
      id: `${edge.fromId}->${edge.toId}`,
      fromId: edge.fromId,
      toId: edge.toId,
      confidence: edge.confidence,
      d,
      isBackward,
    });
  }

  // 8. Generate stages metadata for column headers
  const stages: WorkflowStage[] = [];
  for (let c = 0; c <= maxDepth; c++) {
    const depth = maxDepth - c;
    let label: string;
    let subtitle: string;

    if (depth === 0) {
      label = "Modified Target";
      subtitle = "Symbol under change";
    } else if (depth === 1) {
      label = "Direct Callers";
      subtitle = "1 step away";
    } else if (c === 0) {
      label = "Entry / Roots";
      subtitle = `${depth} steps away`;
    } else {
      label = `Stage ${depth} Callers`;
      subtitle = `${depth} steps away`;
    }

    stages.push({
      column: c,
      label,
      subtitle,
      depth,
      x: PAD_X + c * (NODE_WIDTH + COLUMN_GAP),
      width: NODE_WIDTH,
    });
  }

  return {
    width: canvasWidth,
    height: canvasHeight,
    nodes: placedNodes,
    edges: placedEdges,
    stages,
    maxDepth,
    nodeMap: finalNodeMap,
    incomingEdges: incoming,
    outgoingEdges: outgoing,
  };
}

export function traceConnectedPaths(
  selectedId: number,
  layout: WorkflowLayout,
): { nodes: Set<number>; edges: Set<string> } {
  const activeNodes = new Set<number>([selectedId]);
  const activeEdges = new Set<string>();

  // 1. Traverse upstream (ancestor callers)
  const upstreamQueue = [selectedId];
  const upstreamVisited = new Set<number>([selectedId]);

  while (upstreamQueue.length > 0) {
    const current = upstreamQueue.shift()!;
    const callers = layout.incomingEdges.get(current) ?? [];
    for (const callerId of callers) {
      activeEdges.add(`${callerId}->${current}`);
      if (!upstreamVisited.has(callerId)) {
        upstreamVisited.add(callerId);
        activeNodes.add(callerId);
        upstreamQueue.push(callerId);
      }
    }
  }

  // 2. Traverse downstream (callees toward target)
  const downstreamQueue = [selectedId];
  const downstreamVisited = new Set<number>([selectedId]);

  while (downstreamQueue.length > 0) {
    const current = downstreamQueue.shift()!;
    const callees = layout.outgoingEdges.get(current) ?? [];
    for (const calleeId of callees) {
      activeEdges.add(`${current}->${calleeId}`);
      if (!downstreamVisited.has(calleeId)) {
        downstreamVisited.add(calleeId);
        activeNodes.add(calleeId);
        downstreamQueue.push(calleeId);
      }
    }
  }

  return { nodes: activeNodes, edges: activeEdges };
}

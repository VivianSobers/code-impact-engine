import { pool } from "@/lib/pg";
import { SYMBOL_COLUMNS, toSymbolRow, type SymbolRecord } from "./rows";
import type { SymbolRow } from "./types";

export const GRAPH_MAX_DEPTH = 5;
export const GRAPH_MAX_NODES = 200;

export interface GraphNode extends SymbolRow {
  column: number;
}

export interface GraphEdge {
  callerId: number;
  calleeId: number;
  confidence: number;
  callLines: number[];
}

export interface CallGraph {
  rootId: number;
  depth: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  hidden: number;
}

export async function getCallGraph(rootId: number, depth: number, limit: number): Promise<CallGraph> {
  const { rows: reach } = await pool.query<{ sid: string; col: number }>(
    `WITH RECURSIVE up (sid, lvl) AS (
         SELECT $1::bigint, 0
         UNION
         SELECT c.caller_id, u.lvl + 1 FROM up u JOIN calls c ON c.callee_id = u.sid WHERE u.lvl < $2
     ),
     down (sid, lvl) AS (
         SELECT $1::bigint, 0
         UNION
         SELECT c.callee_id, d.lvl + 1 FROM down d JOIN calls c ON c.caller_id = d.sid WHERE d.lvl < $2
     )
     SELECT sid, -min(lvl) AS col FROM up GROUP BY sid
     UNION ALL
     SELECT sid, min(lvl) AS col FROM down GROUP BY sid`,
    [rootId, depth],
  );

  const columns = new Map<number, number>();
  for (const r of reach) {
    const id = Number(r.sid);
    const current = columns.get(id);
    if (current === undefined || Math.abs(r.col) < Math.abs(current)) columns.set(id, r.col);
  }
  columns.set(rootId, 0);

  const ranked = [...columns.entries()].sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]) || a[1] - b[1] || a[0] - b[0]);
  const kept = ranked.slice(0, limit);
  const ids = kept.map(([id]) => id);

  const [{ rows: symbols }, { rows: edges }] = await Promise.all([
    pool.query<SymbolRecord>(`SELECT ${SYMBOL_COLUMNS} FROM symbol s WHERE s.symbol_id = ANY($1::bigint[])`, [ids]),
    pool.query<{ caller_id: string; callee_id: string; confidence: string; call_lines: number[] }>(
      `SELECT caller_id, callee_id, max(resolution_confidence) AS confidence,
              array_agg(call_line ORDER BY call_line) AS call_lines
       FROM calls
       WHERE caller_id = ANY($1::bigint[]) AND callee_id = ANY($1::bigint[])
       GROUP BY caller_id, callee_id`,
      [ids],
    ),
  ]);

  return {
    rootId,
    depth,
    nodes: symbols.map((s) => {
      const row = toSymbolRow(s);
      return { ...row, column: columns.get(row.symbolId) ?? 0 };
    }),
    edges: edges.map((e) => ({
      callerId: Number(e.caller_id),
      calleeId: Number(e.callee_id),
      confidence: Number(e.confidence),
      callLines: e.call_lines,
    })),
    hidden: ranked.length - kept.length,
  };
}

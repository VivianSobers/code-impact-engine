import { pool } from "@/lib/pg";
import { SYMBOL_COLUMNS, toSymbolRow, type SymbolRecord } from "./rows";
import type { CallEdge, SymbolDetail } from "./types";

export async function getSymbol(symbolId: number): Promise<SymbolDetail | null> {
  const { rows } = await pool.query<
    SymbolRecord & { repo_name: string; embedding_id: string | null; cluster_id: string | null }
  >(
    `SELECT ${SYMBOL_COLUMNS}, r.name AS repo_name, s.embedding_id, s.cluster_id
     FROM symbol s JOIN repository r ON r.repo_id = s.repo_id
     WHERE s.symbol_id = $1`,
    [symbolId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    ...toSymbolRow(r),
    repoName: r.repo_name,
    embeddingId: r.embedding_id == null ? null : Number(r.embedding_id),
    clusterId: r.cluster_id == null ? null : Number(r.cluster_id),
  };
}

type EdgeRecord = SymbolRecord & { call_line: number; resolution_confidence: string };

function toEdge(r: EdgeRecord): CallEdge {
  return { symbol: toSymbolRow(r), callLine: r.call_line, confidence: Number(r.resolution_confidence) };
}

export async function listCallers(symbolId: number): Promise<CallEdge[]> {
  const { rows } = await pool.query<EdgeRecord>(
    `SELECT ${SYMBOL_COLUMNS}, c.call_line, c.resolution_confidence
     FROM calls c JOIN symbol s ON s.symbol_id = c.caller_id
     WHERE c.callee_id = $1
     ORDER BY s.path, c.call_line`,
    [symbolId],
  );
  return rows.map(toEdge);
}

export async function listCallees(symbolId: number): Promise<CallEdge[]> {
  const { rows } = await pool.query<EdgeRecord>(
    `SELECT ${SYMBOL_COLUMNS}, c.call_line, c.resolution_confidence
     FROM calls c JOIN symbol s ON s.symbol_id = c.callee_id
     WHERE c.caller_id = $1
     ORDER BY c.call_line, s.name`,
    [symbolId],
  );
  return rows.map(toEdge);
}

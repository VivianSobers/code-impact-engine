import { pool } from "@/lib/pg";
import type { SymbolKind } from "./types";

export const IMPACT_MAX_DEPTH = 10;

export interface ImpactRow {
  symbolId: number;
  repoId: number;
  path: string;
  name: string;
  kind: SymbolKind;
  depth: number;
  isEntryPoint: boolean;
  minConfidence: number;
  callPath: number[];
}

export interface ImpactSummary {
  affected: number;
  files: number;
  entryPoints: number;
  byDepth: { depth: number; count: number }[];
}

export interface SearchHit {
  symbolId: number;
  repoId: number;
  path: string;
  name: string;
  kind: SymbolKind;
  signature: string | null;
  startLine: number;
  endLine: number;
  rank: number;
}

export async function impactOf(symbolId: number, depth: number, minConfidence = 0): Promise<ImpactRow[]> {
  const { rows } = await pool.query<{
    symbol_id: string;
    repo_id: string;
    path: string;
    name: string;
    kind: SymbolKind;
    depth: number;
    is_entry_point: boolean;
    min_confidence: string;
    call_path: string[];
  }>(
    `SELECT symbol_id, repo_id, path, name, kind, depth, is_entry_point, min_confidence, call_path
     FROM impact_of($1, $2)
     WHERE min_confidence >= $3`,
    [symbolId, depth, minConfidence],
  );
  return rows.map((r) => ({
    symbolId: Number(r.symbol_id),
    repoId: Number(r.repo_id),
    path: r.path,
    name: r.name,
    kind: r.kind,
    depth: r.depth,
    isEntryPoint: r.is_entry_point,
    minConfidence: Number(r.min_confidence),
    callPath: r.call_path.map(Number),
  }));
}

export function summarizeImpact(rows: ImpactRow[]): ImpactSummary {
  const counts = new Map<number, number>();
  for (const r of rows) counts.set(r.depth, (counts.get(r.depth) ?? 0) + 1);
  return {
    affected: rows.length,
    files: new Set(rows.map((r) => `${r.repoId}:${r.path}`)).size,
    entryPoints: rows.filter((r) => r.isEntryPoint).length,
    byDepth: [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([depth, count]) => ({ depth, count })),
  };
}

export async function searchSymbols(query: string, repoId: number | null, limit: number): Promise<SearchHit[]> {
  const { rows } = await pool.query<{
    symbol_id: string;
    repo_id: string;
    path: string;
    name: string;
    kind: SymbolKind;
    signature: string | null;
    start_line: number;
    end_line: number;
    rank: number;
  }>(
    `SELECT symbol_id, repo_id, path, name, kind, signature, start_line, end_line, rank
     FROM search_symbols($1, $2, $3)`,
    [query, repoId, limit],
  );
  return rows.map((r) => ({
    symbolId: Number(r.symbol_id),
    repoId: Number(r.repo_id),
    path: r.path,
    name: r.name,
    kind: r.kind,
    signature: r.signature,
    startLine: r.start_line,
    endLine: r.end_line,
    rank: Number(r.rank),
  }));
}

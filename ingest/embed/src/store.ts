import type pg from "pg";
import { MIN_LINES } from "./cluster";

type Client = pg.Client | pg.PoolClient;

export interface EligibleSymbol {
  symbolId: number;
  path: string;
  startLine: number;
  endLine: number;
}

// Functions and methods long enough to compare. Module and class symbols span other
// symbols and would always look like their own members.
export function eligible(alias: string): string {
  return `${alias}.kind IN ('function', 'method') AND ${alias}.end_line - ${alias}.start_line + 1 >= ${MIN_LINES}`;
}

export async function eligibleSymbols(client: Client, repoId: number): Promise<EligibleSymbol[]> {
  const result = await client.query<{ symbol_id: string; path: string; start_line: number; end_line: number }>(
    `SELECT symbol_id, path, start_line, end_line FROM symbol s WHERE repo_id = $1 AND ${eligible("s")} ORDER BY symbol_id`,
    [repoId],
  );
  return result.rows.map((r) => ({ symbolId: Number(r.symbol_id), path: r.path, startLine: r.start_line, endLine: r.end_line }));
}

// embedding_id for each hash that already has a vector from this model.
export async function existingEmbeddings(client: Client, model: string, hashes: string[]): Promise<Map<string, number>> {
  const result = await client.query<{ body_hash: string; embedding_id: string }>(
    "SELECT body_hash, embedding_id FROM symbol_embedding WHERE model = $1 AND body_hash = ANY($2)",
    [model, hashes],
  );
  return new Map(result.rows.map((r) => [r.body_hash, Number(r.embedding_id)]));
}

export async function insertEmbeddings(client: Client, model: string, rows: { hash: string; vector: number[] }[]): Promise<void> {
  if (rows.length === 0) return;
  await client.query(
    `INSERT INTO symbol_embedding (model, body_hash, embedding)
     SELECT $1, h, v::vector FROM unnest($2::text[], $3::text[]) AS t (h, v)
     ON CONFLICT (model, body_hash) DO NOTHING`,
    [model, rows.map((r) => r.hash), rows.map((r) => `[${r.vector.join(",")}]`)],
  );
}

export async function linkEmbeddings(client: Client, links: { symbolId: number; embeddingId: number }[]): Promise<void> {
  await client.query(
    `UPDATE symbol s SET embedding_id = t.e FROM unnest($1::bigint[], $2::bigint[]) AS t (s, e) WHERE s.symbol_id = t.s`,
    [links.map((l) => l.symbolId), links.map((l) => l.embeddingId)],
  );
  await client.query(
    "DELETE FROM symbol_embedding e WHERE NOT EXISTS (SELECT 1 FROM symbol s WHERE s.embedding_id = e.embedding_id)",
  );
}

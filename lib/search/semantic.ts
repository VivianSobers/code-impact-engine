import { pool } from "@/lib/pg";
import type { SymbolKind } from "@/lib/structure/types";
import { embedQuery, EMBEDDING_MODEL } from "./model";

export interface SearchResult {
  symbolId: number;
  repoId: number;
  repoName: string;
  path: string;
  name: string;
  kind: SymbolKind;
  signature: string | null;
  startLine: number;
  endLine: number;
  similarity: number;
}

// Embeds the description with the model that embedded the symbols and returns the
// symbols whose bodies are closest by cosine distance.
export async function searchByMeaning(
  query: string,
  { repoId, limit }: { repoId: number | null; limit: number },
): Promise<SearchResult[]> {
  const vector = `[${(await embedQuery(query)).join(",")}]`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    // A wider HNSW candidate list than the default 40, and keep scanning when the
    // repository filter drops candidates.
    await client.query("SET LOCAL hnsw.ef_search = 100");
    await client.query("SET LOCAL hnsw.iterative_scan = relaxed_order");
    const result = await client.query<{
      symbol_id: string;
      repo_id: string;
      repo_name: string;
      path: string;
      name: string;
      kind: SymbolKind;
      signature: string | null;
      start_line: number;
      end_line: number;
      similarity: number;
    }>(
      `SELECT s.symbol_id, s.repo_id, r.name AS repo_name, s.path, s.name, s.kind, s.signature,
              s.start_line, s.end_line, (1 - (e.embedding <=> $1::vector))::float8 AS similarity
       FROM symbol_embedding e
       JOIN symbol s ON s.embedding_id = e.embedding_id
       JOIN repository r ON r.repo_id = s.repo_id
       WHERE e.model = $2 AND ($3::bigint IS NULL OR s.repo_id = $3)
       ORDER BY e.embedding <=> $1::vector, s.symbol_id
       LIMIT $4`,
      [vector, EMBEDDING_MODEL, repoId, limit],
    );
    await client.query("COMMIT");
    return result.rows.map((r) => ({
      symbolId: Number(r.symbol_id),
      repoId: Number(r.repo_id),
      repoName: r.repo_name,
      path: r.path,
      name: r.name,
      kind: r.kind,
      signature: r.signature,
      startLine: r.start_line,
      endLine: r.end_line,
      similarity: r.similarity,
    }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

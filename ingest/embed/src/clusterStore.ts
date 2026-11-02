import type pg from "pg";
import { CANDIDATE_SIMILARITY, CLONE_STRUCTURE, clusterPairs, NEIGHBOURS, type SimilarPair } from "./cluster";
import { cloneCandidate } from "./store";
import { structuralSimilarity } from "./structure";

type Client = pg.Client | pg.PoolClient;

// Rebuilds the repository's open clusters in one transaction. Members of confirmed or
// dismissed clusters and symbols someone has waived are left alone. bodies holds the
// source of every embedded symbol, by symbol_id, for the structure check.
export async function rebuildClusters(client: Client, repoId: number, bodies: Map<number, string>): Promise<number> {
  await client.query("BEGIN");
  try {
    await client.query(
      `UPDATE symbol SET cluster_id = NULL
       WHERE repo_id = $1 AND cluster_id IN (SELECT cluster_id FROM clone_cluster WHERE status = 'open')`,
      [repoId],
    );
    await client.query(
      `DELETE FROM clone_cluster c
       WHERE c.status = 'open' AND NOT EXISTS (SELECT 1 FROM symbol s WHERE s.cluster_id = c.cluster_id)`,
    );

    const candidates = `
      SELECT s.symbol_id, e.embedding FROM symbol s JOIN symbol_embedding e USING (embedding_id)
      WHERE s.repo_id = $1 AND s.cluster_id IS NULL AND ${cloneCandidate("s")}
        AND NOT EXISTS (SELECT 1 FROM waives w WHERE w.symbol_id = s.symbol_id)`;
    const pairs = await client.query<{ a: string; b: string; similarity: number }>(
      `WITH candidate AS (${candidates})
       SELECT c.symbol_id AS a, n.symbol_id AS b, n.similarity
       FROM candidate c
       CROSS JOIN LATERAL (
           SELECT o.symbol_id, 1 - (c.embedding <=> o.embedding) AS similarity
           FROM candidate o
           WHERE o.symbol_id <> c.symbol_id
           ORDER BY c.embedding <=> o.embedding
           LIMIT ${NEIGHBOURS}
       ) n
       WHERE n.similarity >= $2`,
      [repoId, CANDIDATE_SIMILARITY],
    );

    const clones = pairs.rows
      .map((r): SimilarPair => ({ a: Number(r.a), b: Number(r.b), similarity: Number(r.similarity) }))
      .filter((p) => structuralSimilarity(bodies.get(p.a) ?? "", bodies.get(p.b) ?? "") >= CLONE_STRUCTURE);
    const clusters = clusterPairs(clones);
    for (const cluster of clusters) {
      const inserted = await client.query<{ cluster_id: string }>(
        "INSERT INTO clone_cluster (similarity_score) VALUES (round($1::numeric, 3)) RETURNING cluster_id",
        [Math.min(1, cluster.similarity)],
      );
      await client.query("UPDATE symbol SET cluster_id = $1 WHERE symbol_id = ANY($2)", [
        inserted.rows[0].cluster_id,
        cluster.members,
      ]);
    }
    await client.query("COMMIT");
    return clusters.length;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

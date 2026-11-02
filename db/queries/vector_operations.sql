-- pgvector operations on symbol_embedding: create, read (nearest neighbours by cosine,
-- Euclidean and inner-product distance, similar pairs, centroids), update and delete.
-- Needs embeddings (`npm run embed -- seed-repo` in ingest/). The writes run inside a
-- transaction that is rolled back, so the stored vectors are left as they were.
--
--   docker compose exec -T postgres psql -U cie -d cie -f /cie-db/queries/vector_operations.sql

-- V1. What is stored: one 768-dimension vector per distinct function body and model
SELECT e.model,
       count(*) AS vectors,
       min(vector_dims(e.embedding)) AS dims,
       round(avg(vector_norm(e.embedding))::numeric, 3) AS avg_norm,
       (SELECT count(*) FROM symbol s WHERE s.embedding_id IS NOT NULL) AS linked_symbols
FROM symbol_embedding e
GROUP BY e.model;

-- V2. Read: the five functions closest in meaning to priceOrder, by cosine distance
--     (<=>). This is the operator the HNSW index is built for.
SELECT s.name, s.path,
       round((e.embedding <=> q.embedding)::numeric, 4) AS cosine_distance,
       round((1 - (e.embedding <=> q.embedding))::numeric, 4) AS similarity
FROM symbol_embedding e
JOIN symbol s ON s.embedding_id = e.embedding_id
CROSS JOIN (SELECT e2.embedding, e2.embedding_id
            FROM symbol t JOIN symbol_embedding e2 ON e2.embedding_id = t.embedding_id
            WHERE t.name = 'priceOrder') AS q
WHERE e.embedding_id <> q.embedding_id
ORDER BY e.embedding <=> q.embedding
LIMIT 5;

-- V3. Read: the same neighbours under the three distance operators pgvector offers.
--     <-> is Euclidean (L2) distance and <#> is the negative inner product.
SELECT s.name,
       round((e.embedding <=> q.embedding)::numeric, 4) AS cosine,
       round((e.embedding <-> q.embedding)::numeric, 4) AS euclidean,
       round((e.embedding <#> q.embedding)::numeric, 4) AS neg_inner_product
FROM symbol_embedding e
JOIN symbol s ON s.embedding_id = e.embedding_id
CROSS JOIN (SELECT e2.embedding FROM symbol t JOIN symbol_embedding e2 ON e2.embedding_id = t.embedding_id
            WHERE t.name = 'roundCurrency') AS q
ORDER BY e.embedding <=> q.embedding
LIMIT 4;

-- V4. Read: the query plan uses the HNSW index for an ORDER BY ... LIMIT search.
--     With a few dozen rows the planner would rather scan, so sequential scans are
--     switched off for this one statement to show the index path.
BEGIN;
SET LOCAL enable_seqscan = off;
EXPLAIN (COSTS OFF)
SELECT embedding_id
FROM symbol_embedding
ORDER BY embedding <=> (SELECT embedding FROM symbol_embedding ORDER BY embedding_id LIMIT 1)
LIMIT 5;
COMMIT;

-- V5. Read: the most similar pairs of different functions. Pairs above the clone
--     threshold become clone-cluster candidates.
SELECT a.name AS first, b.name AS second,
       round((1 - (ea.embedding <=> eb.embedding))::numeric, 4) AS similarity
FROM symbol a
JOIN symbol b ON b.symbol_id > a.symbol_id
JOIN symbol_embedding ea ON ea.embedding_id = a.embedding_id
JOIN symbol_embedding eb ON eb.embedding_id = b.embedding_id
ORDER BY ea.embedding <=> eb.embedding
LIMIT 5;

-- V6. Read: one centroid per file (avg over vectors), and which function in the file
--     sits closest to it, i.e. best represents the file
WITH centroid AS (
    SELECT s.repo_id, s.path, avg(e.embedding) AS center, count(*) AS functions
    FROM symbol s JOIN symbol_embedding e ON e.embedding_id = s.embedding_id
    GROUP BY s.repo_id, s.path
    HAVING count(*) >= 3
)
SELECT c.path, c.functions,
       (SELECT s.name
          FROM symbol s JOIN symbol_embedding e ON e.embedding_id = s.embedding_id
         WHERE s.repo_id = c.repo_id AND s.path = c.path
         ORDER BY e.embedding <=> c.center
         LIMIT 1) AS most_central
FROM centroid c
ORDER BY c.path;

BEGIN;

-- V7. Create: store a vector for a new body and link a symbol to it. The vector here is
--     priceOrder's embedding nudged slightly, standing in for an edited version.
INSERT INTO symbol_embedding (model, body_hash, embedding)
SELECT e.model, encode(sha256('priceOrder v2'), 'hex'),
       (SELECT array_agg(x + 0.001 ORDER BY ord) FROM unnest(e.embedding::real[]) WITH ORDINALITY AS u (x, ord))::vector
FROM symbol s JOIN symbol_embedding e ON e.embedding_id = s.embedding_id
WHERE s.name = 'priceOrder'
RETURNING embedding_id, model, vector_dims(embedding) AS dims;

UPDATE symbol s
SET embedding_id = (SELECT embedding_id FROM symbol_embedding WHERE body_hash = encode(sha256('priceOrder v2'), 'hex'))
WHERE s.name = 'priceOrder'
RETURNING s.name, s.embedding_id;

-- The nearest stored vector to the old one is the new version.
SELECT round((1 - (n.embedding <=> o.embedding))::numeric, 6) AS similarity_to_previous
FROM symbol_embedding n, symbol_embedding o
WHERE n.body_hash = encode(sha256('priceOrder v2'), 'hex')
  AND o.embedding_id = (SELECT e.embedding_id FROM symbol_embedding e
                        WHERE e.body_hash <> n.body_hash
                        ORDER BY e.embedding <=> n.embedding LIMIT 1);

-- V8. Update: replace a stored vector in place, here by scaling it. Cosine distance
--     ignores length, so the neighbours do not change; Euclidean distance does.
UPDATE symbol_embedding
SET embedding = (SELECT array_agg(x * 2 ORDER BY ord) FROM unnest(embedding::real[]) WITH ORDINALITY AS u (x, ord))::vector
WHERE body_hash = encode(sha256('priceOrder v2'), 'hex')
RETURNING embedding_id, round(vector_norm(embedding)::numeric, 3) AS new_norm;

-- V9. Delete: removing a vector unlinks its symbols through ON DELETE SET NULL; the
--     symbol itself stays.
DELETE FROM symbol_embedding
WHERE body_hash = encode(sha256('priceOrder v2'), 'hex')
RETURNING embedding_id;

SELECT name, embedding_id FROM symbol WHERE name = 'priceOrder';

-- V10. Constraints still apply to vectors: wrong dimensions and bad hashes are refused.
DO $$
BEGIN
    BEGIN
        INSERT INTO symbol_embedding (model, body_hash, embedding)
        VALUES ('test', repeat('a', 64), '[1,2,3]');
        RAISE NOTICE 'three dimensions: accepted';
    EXCEPTION WHEN data_exception THEN
        RAISE NOTICE 'three dimensions rejected: %', SQLERRM;
    END;
    BEGIN
        INSERT INTO symbol_embedding (model, body_hash, embedding)
        VALUES ('test', 'not-a-hash', array_fill(0.1, ARRAY[768])::vector);
        RAISE NOTICE 'bad hash: accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'bad hash rejected: %', SQLERRM;
    END;
END $$;

ROLLBACK;

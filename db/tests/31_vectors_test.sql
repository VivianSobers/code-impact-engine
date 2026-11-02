BEGIN;

CREATE FUNCTION pg_temp.rejects(p_sql text, p_state text, p_constraint text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
    v_constraint text;
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME;
        IF v_state <> p_state THEN
            RAISE EXCEPTION 'expected SQLSTATE % for [%], got % (%)', p_state, p_sql, v_state, v_constraint;
        END IF;
        IF p_constraint IS NOT NULL AND v_constraint IS DISTINCT FROM p_constraint THEN
            RAISE EXCEPTION 'expected constraint % for [%], got %', p_constraint, p_sql, v_constraint;
        END IF;
        RETURN;
    END;
    RAISE EXCEPTION 'statement should have failed: %', p_sql;
END $$;

-- A 768-dimension unit vector with value 1 at position p_hot (1-based) and a small
-- second component, so the three test vectors have known cosine distances.
CREATE FUNCTION pg_temp.vec(p_hot int, p_tilt real DEFAULT 0) RETURNS vector
LANGUAGE sql IMMUTABLE AS $$
    SELECT array_agg(CASE WHEN i = p_hot THEN 1::real WHEN i = 768 THEN p_tilt ELSE 0::real END ORDER BY i)::vector(768)
    FROM generate_series(1, 768) AS i
$$;

INSERT INTO symbol_embedding (model, body_hash, embedding)
VALUES
    ('test-model', repeat('1', 64), pg_temp.vec(1)),
    ('test-model', repeat('2', 64), pg_temp.vec(1, 0.2)),
    ('test-model', repeat('3', 64), pg_temp.vec(2));

SELECT pg_temp.rejects(
    $q$INSERT INTO symbol_embedding (model, body_hash, embedding) VALUES ('test-model', repeat('4', 64), '[1,0,0]')$q$,
    '22000');
SELECT pg_temp.rejects(
    $q$INSERT INTO symbol_embedding (model, body_hash, embedding) VALUES ('test-model', repeat('1', 64), pg_temp.vec(3))$q$,
    '23505', 'symbol_embedding_model_body_key');
SELECT pg_temp.rejects(
    $q$INSERT INTO symbol_embedding (model, body_hash, embedding) VALUES ('test-model', 'nothex', pg_temp.vec(3))$q$,
    '23514', 'symbol_embedding_body_hash_hex');

DO $$
DECLARE
    v_nearest text;
BEGIN
    SELECT body_hash INTO v_nearest
    FROM symbol_embedding
    WHERE body_hash <> repeat('1', 64)
    ORDER BY embedding <=> pg_temp.vec(1)
    LIMIT 1;
    IF v_nearest <> repeat('2', 64) THEN
        RAISE EXCEPTION 'nearest neighbour by cosine distance should be the tilted copy, got %', v_nearest;
    END IF;
END $$;

-- symbol.embedding_id points at an embedding and is cleared when the embedding goes.
INSERT INTO repository (name, url) VALUES ('vector fixture', 'test://vectors');
INSERT INTO file (repo_id, path, language, loc, content_hash)
SELECT repo_id, 'a.py', 'python', 10, repeat('0', 64) FROM repository WHERE url = 'test://vectors';
INSERT INTO symbol (repo_id, path, name, kind, start_line, end_line, embedding_id)
SELECT r.repo_id, 'a.py', 'f', 'function', 1, 3, e.embedding_id
FROM repository r, symbol_embedding e
WHERE r.url = 'test://vectors' AND e.body_hash = repeat('3', 64);

SELECT pg_temp.rejects(
    $q$UPDATE symbol SET embedding_id = 999999999 WHERE name = 'f' AND path = 'a.py'$q$, '23503', 'symbol_embedding_fkey');

DELETE FROM symbol_embedding WHERE body_hash = repeat('3', 64);

DO $$
BEGIN
    IF (SELECT embedding_id FROM symbol WHERE name = 'f' AND path = 'a.py') IS NOT NULL THEN
        RAISE EXCEPTION 'deleting an embedding should clear symbol.embedding_id';
    END IF;
END $$;

ROLLBACK;

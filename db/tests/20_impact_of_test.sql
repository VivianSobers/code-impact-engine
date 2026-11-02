BEGIN;

INSERT INTO repository (name, url) VALUES ('impact fixture', 'test://impact-of');

INSERT INTO file (repo_id, path, language, loc, content_hash)
SELECT r.repo_id, f.path, 'javascript', 200, repeat('0', 64)
FROM repository r
CROSS JOIN (VALUES ('src/app.js'), ('src/lib.js')) AS f (path)
WHERE r.url = 'test://impact-of';

INSERT INTO symbol (repo_id, path, name, kind, start_line, end_line, is_entry_point)
SELECT r.repo_id, s.path, s.name, 'function', s.line, s.line + 4, s.entry
FROM repository r
CROSS JOIN (VALUES
    ('src/lib.js', 't', 1, false),
    ('src/lib.js', 'u', 10, false),
    ('src/lib.js', 'a', 20, false),
    ('src/lib.js', 'b', 30, false),
    ('src/app.js', 'c', 1, false),
    ('src/app.js', 'd', 10, true),
    ('src/app.js', 'e', 20, false),
    ('src/app.js', 'f', 30, false),
    ('src/app.js', 'g', 40, true),
    ('src/lib.js', 'x', 40, false),
    ('src/app.js', 'y', 50, true)
) AS s (path, name, line, entry)
WHERE r.url = 'test://impact-of';

CREATE FUNCTION pg_temp.sid(p_name text) RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT s.symbol_id
    FROM symbol s
    JOIN repository r ON r.repo_id = s.repo_id
    WHERE r.url = 'test://impact-of' AND s.name = p_name
$$;

INSERT INTO calls (caller_id, callee_id, call_line, resolution_confidence)
SELECT pg_temp.sid(c.caller), pg_temp.sid(c.callee), c.line, c.conf
FROM (VALUES
    ('a', 't', 21, 0.90),
    ('a', 't', 23, 0.40),
    ('b', 't', 31, 0.50),
    ('c', 'a', 2, 0.80),
    ('c', 'b', 3, 1.00),
    ('d', 'c', 11, 1.00),
    ('e', 'd', 21, 0.95),
    ('f', 'e', 31, 0.60),
    ('g', 'f', 41, 1.00),
    ('t', 'u', 2, 1.00),
    ('t', 't', 3, 1.00),
    ('x', 't', 41, 0.70),
    ('t', 'x', 4, 0.70),
    ('y', 'x', 51, 1.00),
    ('x', 'y', 42, 1.00)
) AS c (caller, callee, line, conf);

CREATE FUNCTION pg_temp.impact_names(p_depth integer) RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT string_agg(i.name || '@' || i.depth, ',' ORDER BY i.depth, i.name)
    FROM impact_of(pg_temp.sid('t'), p_depth) i
$$;

DO $$
DECLARE
    got text := pg_temp.impact_names(5);
    want text := 'a@1,b@1,x@1,c@2,y@2,d@3,e@4,f@5';
BEGIN
    IF got IS DISTINCT FROM want THEN
        RAISE EXCEPTION 'default walk: expected %, got %', want, got;
    END IF;
END $$;

DO $$
DECLARE
    got text := pg_temp.impact_names(2);
    want text := 'a@1,b@1,x@1,c@2,y@2';
BEGIN
    IF got IS DISTINCT FROM want THEN
        RAISE EXCEPTION 'depth limit 2: expected %, got %', want, got;
    END IF;
END $$;

DO $$
DECLARE
    got text := pg_temp.impact_names(10);
    want text := 'a@1,b@1,x@1,c@2,y@2,d@3,e@4,f@5,g@6';
BEGIN
    IF got IS DISTINCT FROM want THEN
        RAISE EXCEPTION 'depth limit 10: expected %, got %', want, got;
    END IF;
END $$;

DO $$
DECLARE
    rec record;
BEGIN
    SELECT i.min_confidence, i.call_path INTO rec
    FROM impact_of(pg_temp.sid('t')) i
    WHERE i.name = 'c';
    IF rec.min_confidence <> 0.80 THEN
        RAISE EXCEPTION 'diamond should take the stronger path through a, got confidence %', rec.min_confidence;
    END IF;
    IF rec.call_path <> ARRAY[pg_temp.sid('c'), pg_temp.sid('a'), pg_temp.sid('t')] THEN
        RAISE EXCEPTION 'diamond path should be c -> a -> t, got %', rec.call_path;
    END IF;

    SELECT i.min_confidence, i.call_path INTO rec
    FROM impact_of(pg_temp.sid('t')) i
    WHERE i.name = 'a';
    IF rec.min_confidence <> 0.90 THEN
        RAISE EXCEPTION 'duplicate call lines should use the most confident one, got %', rec.min_confidence;
    END IF;

    SELECT i.min_confidence, i.call_path INTO rec
    FROM impact_of(pg_temp.sid('t')) i
    WHERE i.name = 'f';
    IF rec.min_confidence <> 0.60 THEN
        RAISE EXCEPTION 'f should carry the 0.60 edge, got %', rec.min_confidence;
    END IF;
    IF array_length(rec.call_path, 1) <> 6 THEN
        RAISE EXCEPTION 'f is five calls away, path was %', rec.call_path;
    END IF;
END $$;

DO $$
DECLARE
    got text;
BEGIN
    SELECT string_agg(i.name, ',' ORDER BY i.name) INTO got
    FROM impact_of(pg_temp.sid('t')) i
    WHERE i.is_entry_point;
    IF got IS DISTINCT FROM 'd,y' THEN
        RAISE EXCEPTION 'entry points within depth 5 should be d,y, got %', got;
    END IF;
END $$;

DO $$
BEGIN
    IF (SELECT string_agg(i.name, ',') FROM impact_of(pg_temp.sid('u')) i WHERE i.depth = 1) IS DISTINCT FROM 't' THEN
        RAISE EXCEPTION 'u is only called by t, so t should be the only symbol at depth 1';
    END IF;
    IF (SELECT count(*) FROM impact_of(pg_temp.sid('g'))) <> 0 THEN
        RAISE EXCEPTION 'g has no callers, impact should be empty';
    END IF;
    IF EXISTS (SELECT 1 FROM impact_of(pg_temp.sid('t')) i WHERE i.symbol_id = pg_temp.sid('t')) THEN
        RAISE EXCEPTION 'the target must not appear in its own impact set';
    END IF;
END $$;

DO $$
DECLARE
    bad integer;
BEGIN
    FOREACH bad IN ARRAY ARRAY[0, -1, 51] LOOP
        BEGIN
            PERFORM impact_of(pg_temp.sid('t'), bad);
            RAISE EXCEPTION 'max_depth % should be rejected', bad;
        EXCEPTION WHEN invalid_parameter_value THEN
            NULL;
        END;
    END LOOP;

    BEGIN
        PERFORM impact_of(pg_temp.sid('t'), NULL);
        RAISE EXCEPTION 'NULL max_depth should be rejected';
    EXCEPTION WHEN invalid_parameter_value THEN
        NULL;
    END;

    BEGIN
        PERFORM impact_of(-42);
        RAISE EXCEPTION 'unknown symbol should be rejected';
    EXCEPTION WHEN no_data_found THEN
        NULL;
    END;
END $$;

ROLLBACK;

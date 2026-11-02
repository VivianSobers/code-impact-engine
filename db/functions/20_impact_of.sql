CREATE OR REPLACE FUNCTION impact_of(p_symbol_id bigint, p_max_depth integer DEFAULT 5)
RETURNS TABLE (
    symbol_id      bigint,
    repo_id        bigint,
    path           text,
    name           text,
    kind           text,
    depth          integer,
    is_entry_point boolean,
    min_confidence numeric,
    call_path      bigint[]
)
LANGUAGE plpgsql
STABLE
AS $$
#variable_conflict use_column
BEGIN
    IF p_max_depth IS NULL OR p_max_depth < 1 OR p_max_depth > 50 THEN
        RAISE EXCEPTION 'max_depth must be between 1 and 50, got %', coalesce(p_max_depth::text, 'NULL')
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM symbol s WHERE s.symbol_id = p_symbol_id) THEN
        RAISE EXCEPTION 'symbol % does not exist', p_symbol_id
            USING ERRCODE = 'no_data_found';
    END IF;

    RETURN QUERY
    WITH RECURSIVE reach (sid, lvl) AS (
        SELECT p_symbol_id, 0
        UNION
        SELECT c.caller_id, r.lvl + 1
        FROM reach r
        JOIN calls c ON c.callee_id = r.sid
        WHERE r.lvl < p_max_depth
    ),
    shallowest AS (
        SELECT r.sid, min(r.lvl) AS lvl
        FROM reach r
        GROUP BY r.sid
    ),
    layered_edge AS MATERIALIZED (
        SELECT c.caller_id, c.callee_id, max(c.resolution_confidence) AS conf
        FROM calls c
        JOIN shallowest up ON up.sid = c.caller_id
        JOIN shallowest down ON down.sid = c.callee_id AND down.lvl = up.lvl - 1
        GROUP BY c.caller_id, c.callee_id
    ),
    best (sid, lvl, conf, trail) AS (
        SELECT p_symbol_id, 0, 1.00::numeric, ARRAY[p_symbol_id]
        UNION ALL
        SELECT pick.sid, pick.lvl, pick.conf, pick.trail
        FROM (
            SELECT e.caller_id AS sid,
                   b.lvl + 1 AS lvl,
                   least(b.conf, e.conf) AS conf,
                   e.caller_id || b.trail AS trail,
                   row_number() OVER (
                       PARTITION BY e.caller_id
                       ORDER BY least(b.conf, e.conf) DESC, b.sid
                   ) AS rn
            FROM best b
            JOIN layered_edge e ON e.callee_id = b.sid
        ) pick
        WHERE pick.rn = 1
    )
    SELECT s.symbol_id,
           s.repo_id,
           s.path,
           s.name,
           s.kind,
           b.lvl,
           s.is_entry_point,
           b.conf,
           b.trail
    FROM best b
    JOIN symbol s ON s.symbol_id = b.sid
    WHERE b.lvl > 0
    ORDER BY b.lvl, s.path, s.start_line, s.name;
END;
$$;

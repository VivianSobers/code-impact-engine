CREATE OR REPLACE FUNCTION symbol_search_query(p_query text)
RETURNS tsquery
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT to_tsquery('simple', string_agg(quote_literal(t.lexeme) || ':*', ' & ' ORDER BY t.lexeme))
    FROM unnest(to_tsvector('simple', coalesce(symbol_name_parts(p_query), ''))) AS t
$$;

CREATE OR REPLACE FUNCTION search_symbols(p_query text, p_repo_id bigint DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS TABLE (
    symbol_id  bigint,
    repo_id    bigint,
    path       text,
    name       text,
    kind       text,
    signature  text,
    start_line integer,
    end_line   integer,
    rank       real
)
LANGUAGE plpgsql
STABLE
AS $$
#variable_conflict use_column
DECLARE
    v_query tsquery := symbol_search_query(p_query);
    v_exact text := lower(btrim(p_query));
BEGIN
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
        RAISE EXCEPTION 'limit must be between 1 and 500, got %', coalesce(p_limit::text, 'NULL')
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF v_query IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT s.symbol_id,
           s.repo_id,
           s.path,
           s.name,
           s.kind,
           s.signature,
           s.start_line,
           s.end_line,
           (ts_rank(s.search_vector, v_query)
               + CASE WHEN lower(s.name) = v_exact THEN 1 ELSE 0 END)::real AS rank
    FROM symbol s
    WHERE s.search_vector @@ v_query
      AND (p_repo_id IS NULL OR s.repo_id = p_repo_id)
    ORDER BY rank DESC, length(s.name), s.name, s.symbol_id
    LIMIT p_limit;
END;
$$;

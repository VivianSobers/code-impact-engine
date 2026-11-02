CREATE FUNCTION symbol_name_parts(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURNS NULL ON NULL INPUT
AS $$
    SELECT btrim(regexp_replace(
        regexp_replace(
            regexp_replace(p_text, '([a-z0-9])([A-Z])', '\1 \2', 'g'),
            '([A-Z]+)([A-Z][a-z])', '\1 \2', 'g'),
        '[^A-Za-z0-9]+', ' ', 'g'))
$$;

ALTER TABLE symbol
    ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', name || ' ' || symbol_name_parts(name)), 'A')
        || setweight(to_tsvector('simple', coalesce(symbol_name_parts(signature), '')), 'B')
    ) STORED;

CREATE INDEX symbol_search_idx ON symbol USING gin (search_vector);

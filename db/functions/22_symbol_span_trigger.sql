CREATE OR REPLACE FUNCTION check_symbol_span()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_loc integer;
BEGIN
    SELECT f.loc INTO v_loc
    FROM file f
    WHERE f.repo_id = NEW.repo_id AND f.path = NEW.path
    FOR SHARE;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    IF NEW.start_line < 1 OR NEW.end_line > v_loc THEN
        RAISE EXCEPTION 'symbol % spans lines % to %, outside %, which has % lines',
                NEW.name, NEW.start_line, NEW.end_line, NEW.path, v_loc
            USING ERRCODE = 'check_violation',
                  TABLE = 'symbol',
                  CONSTRAINT = 'symbol_within_file';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER symbol_within_file
    BEFORE INSERT OR UPDATE OF repo_id, path, start_line, end_line ON symbol
    FOR EACH ROW
    EXECUTE FUNCTION check_symbol_span();

CREATE OR REPLACE FUNCTION check_file_shrink()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_name text;
    v_end  integer;
BEGIN
    SELECT s.name, s.end_line INTO v_name, v_end
    FROM symbol s
    WHERE s.repo_id = OLD.repo_id AND s.path = OLD.path AND s.end_line > NEW.loc
    ORDER BY s.end_line DESC
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'cannot set % to % lines, symbol % ends at line %',
                NEW.path, NEW.loc, v_name, v_end
            USING ERRCODE = 'check_violation',
                  TABLE = 'file',
                  CONSTRAINT = 'symbol_within_file';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER file_keeps_symbols
    BEFORE UPDATE OF loc ON file
    FOR EACH ROW
    WHEN (NEW.loc < OLD.loc)
    EXECUTE FUNCTION check_file_shrink();

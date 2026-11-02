BEGIN;

-- Fixture: three authors (Cleo never commits), three commits, four symbols in two files.
--   c1 Ana  2026-09-01: s1 +5/-0 added,    s2 +6/-0 added
--   c2 Ben  2026-09-02: s1 +2/-1 modified, s3 +7/-0 added,   s4 +2/-0 added
--   c3 Ana  2026-09-03: s1 +1/-1 modified, s2 +1/-0 modified, s4 +2/-0 modified
-- s1, s2, s3 are in f.py and s4 in g.py.

INSERT INTO repository (name, url) VALUES ('views fixture', 'test://views');

CREATE FUNCTION pg_temp.repo() RETURNS bigint
LANGUAGE sql STABLE AS $$ SELECT repo_id FROM repository WHERE url = 'test://views' $$;

INSERT INTO file (repo_id, path, language, loc, content_hash)
VALUES (pg_temp.repo(), 'f.py', 'python', 30, repeat('0', 64)),
       (pg_temp.repo(), 'g.py', 'python', 10, repeat('0', 64));

INSERT INTO symbol (repo_id, path, name, kind, start_line, end_line)
VALUES (pg_temp.repo(), 'f.py', 's1', 'function', 1, 5),
       (pg_temp.repo(), 'f.py', 's2', 'function', 7, 12),
       (pg_temp.repo(), 'f.py', 's3', 'function', 14, 20),
       (pg_temp.repo(), 'g.py', 's4', 'function', 1, 4);

INSERT INTO author (name, company) VALUES ('Ana', 'Acme'), ('Ben', NULL), ('Cleo', NULL);
INSERT INTO author_email (author_id, email)
SELECT author_id, lower(name) || '@example.com' FROM author WHERE name IN ('Ana', 'Ben', 'Cleo');

CREATE FUNCTION pg_temp.author(p_name text) RETURNS bigint
LANGUAGE sql STABLE AS $$ SELECT author_id FROM author WHERE name = p_name $$;

INSERT INTO commit (repo_id, author_id, sha, message, committed_at)
VALUES (pg_temp.repo(), pg_temp.author('Ana'), repeat('1', 40), 'c1', '2026-09-01 10:00+00'),
       (pg_temp.repo(), pg_temp.author('Ben'), repeat('2', 40), 'c2', '2026-09-02 10:00+00'),
       (pg_temp.repo(), pg_temp.author('Ana'), repeat('3', 40), 'c3', '2026-09-03 10:00+00');

INSERT INTO modifies (commit_id, symbol_id, additions, deletions, change_type)
SELECT c.commit_id, s.symbol_id, m.additions, m.deletions, m.change_type
FROM (VALUES
    ('c1', 's1', 5, 0, 'added'), ('c1', 's2', 6, 0, 'added'),
    ('c2', 's1', 2, 1, 'modified'), ('c2', 's3', 7, 0, 'added'), ('c2', 's4', 2, 0, 'added'),
    ('c3', 's1', 1, 1, 'modified'), ('c3', 's2', 1, 0, 'modified'), ('c3', 's4', 2, 0, 'modified')
) AS m (msg, sym, additions, deletions, change_type)
JOIN commit c ON c.message = m.msg AND c.repo_id = pg_temp.repo()
JOIN symbol s ON s.name = m.sym AND s.repo_id = pg_temp.repo();

-- v_symbol_hotspot: only symbols changed in at least two commits.
DO $$
DECLARE
    v_rows text;
BEGIN
    SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s', name, commits, authors, additions, deletions, churn, last_changed::date), ' '
                      ORDER BY churn DESC, name)
    INTO v_rows
    FROM v_symbol_hotspot WHERE repo_id = pg_temp.repo();
    IF v_rows IS DISTINCT FROM 's1:3:2:8:2:10:2026-09-03 s2:2:1:7:0:7:2026-09-03 s4:2:2:4:0:4:2026-09-03' THEN
        RAISE EXCEPTION 'unexpected hotspots: %', v_rows;
    END IF;
END $$;

-- v_file_ownership: churn per author per file, shares sum to 1, ties go to the lower author_id.
DO $$
DECLARE
    v_rows text;
BEGIN
    SELECT string_agg(format('%s:%s:%s:%s:%s:%s', path, author_name, commits, churn, share, is_owner), ' '
                      ORDER BY path, author_id)
    INTO v_rows
    FROM v_file_ownership WHERE repo_id = pg_temp.repo();
    IF v_rows IS DISTINCT FROM 'f.py:Ana:2:14:0.5833:t f.py:Ben:1:10:0.4167:f g.py:Ana:1:2:0.5000:t g.py:Ben:1:2:0.5000:f' THEN
        RAISE EXCEPTION 'unexpected ownership: %', v_rows;
    END IF;
END $$;

-- v_author_activity: every author, including one with no commits.
DO $$
DECLARE
    v_rows text;
BEGIN
    SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s', name, array_to_string(emails, ','), repos, commits, churn,
                             coalesce(first_commit::date::text, '-'), coalesce(last_commit::date::text, '-')), ' '
                      ORDER BY name)
    INTO v_rows
    FROM v_author_activity WHERE name IN ('Ana', 'Ben', 'Cleo');
    IF v_rows IS DISTINCT FROM 'Ana:ana@example.com:1:2:16:2026-09-01:2026-09-03 Ben:ben@example.com:1:1:12:2026-09-02:2026-09-02 Cleo:cleo@example.com:0:0:0:-:-' THEN
        RAISE EXCEPTION 'unexpected author activity: %', v_rows;
    END IF;
END $$;

ROLLBACK;

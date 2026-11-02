BEGIN;

INSERT INTO repository (name, url) VALUES
    ('search fixture', 'test://search'),
    ('search fixture two', 'test://search-two');

INSERT INTO file (repo_id, path, language, loc, content_hash)
SELECT r.repo_id, 'src/users.ts', 'typescript', 200, repeat('0', 64)
FROM repository r
WHERE r.url IN ('test://search', 'test://search-two');

INSERT INTO symbol (repo_id, path, name, kind, signature, start_line, end_line)
SELECT r.repo_id, 'src/users.ts', s.name, s.kind, s.signature, s.line, s.line + 5
FROM repository r
CROSS JOIN (VALUES
    ('getUserById', 'function', 'function getUserById(id: string): Promise<User>', 1),
    ('get_user_profile', 'function', 'def get_user_profile(user_id)', 10),
    ('UserService', 'class', 'class UserService', 20),
    ('HTTPServer', 'class', 'class HTTPServer extends EventEmitter', 30),
    ('parseJSON', 'function', 'function parseJSON(raw: string): unknown', 40),
    ('deleteOrder', 'function', 'function deleteOrder(orderId: number): void', 50),
    ('audit', 'function', 'function audit(user: User): void', 60),
    ('user', 'function', NULL, 70)
) AS s (name, kind, signature, line)
WHERE r.url = 'test://search';

INSERT INTO symbol (repo_id, path, name, kind, signature, start_line, end_line)
SELECT r.repo_id, 'src/users.ts', 'getUserById', 'function', 'function getUserById(id)', 1, 5
FROM repository r
WHERE r.url = 'test://search-two';

CREATE FUNCTION pg_temp.repo(p_url text) RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT repo_id FROM repository WHERE url = p_url
$$;

CREATE FUNCTION pg_temp.found(p_query text, p_url text DEFAULT 'test://search') RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT coalesce(string_agg(r.name, ',' ORDER BY r.name COLLATE "C"), '')
    FROM search_symbols(p_query, pg_temp.repo(p_url)) r
$$;

CREATE FUNCTION pg_temp.expect(p_query text, p_want text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    got text := pg_temp.found(p_query);
BEGIN
    IF got IS DISTINCT FROM p_want THEN
        RAISE EXCEPTION 'search %: expected [%], got [%]', quote_literal(p_query), p_want, got;
    END IF;
END $$;

SELECT pg_temp.expect('user', 'UserService,audit,getUserById,get_user_profile,user');
SELECT pg_temp.expect('getUser', 'getUserById,get_user_profile');
SELECT pg_temp.expect('get_user', 'getUserById,get_user_profile');
SELECT pg_temp.expect('http server', 'HTTPServer');
SELECT pg_temp.expect('json', 'parseJSON');
SELECT pg_temp.expect('serv', 'HTTPServer,UserService');
SELECT pg_temp.expect('promise', 'getUserById');
SELECT pg_temp.expect('EventEmitter', 'HTTPServer');
SELECT pg_temp.expect('order id', 'deleteOrder');
SELECT pg_temp.expect('nothing matches this', '');
SELECT pg_temp.expect('   ', '');
SELECT pg_temp.expect('!!!', '');
SELECT pg_temp.expect('zz'' & | ! (', '');
SELECT pg_temp.expect('aud'' & | !', 'audit');

DO $$
DECLARE
    first_name text;
    name_rank real;
    signature_rank real;
BEGIN
    SELECT r.name INTO first_name
    FROM search_symbols('user', pg_temp.repo('test://search')) r
    LIMIT 1;
    IF first_name IS DISTINCT FROM 'user' THEN
        RAISE EXCEPTION 'an exact name match should rank first, got %', first_name;
    END IF;

    SELECT r.rank INTO name_rank
    FROM search_symbols('user', pg_temp.repo('test://search')) r
    WHERE r.name = 'getUserById';
    SELECT r.rank INTO signature_rank
    FROM search_symbols('user', pg_temp.repo('test://search')) r
    WHERE r.name = 'audit';
    IF name_rank <= signature_rank THEN
        RAISE EXCEPTION 'a name hit (%) should outrank a signature-only hit (%)', name_rank, signature_rank;
    END IF;
END $$;

DO $$
BEGIN
    IF (SELECT count(*) FROM search_symbols('getUserById') r WHERE r.repo_id IN (pg_temp.repo('test://search'), pg_temp.repo('test://search-two'))) <> 2 THEN
        RAISE EXCEPTION 'without a repo filter both repositories should match';
    END IF;
    IF (SELECT count(*) FROM search_symbols('getUserById', pg_temp.repo('test://search-two'))) <> 1 THEN
        RAISE EXCEPTION 'the repo filter should keep one match';
    END IF;
    IF (SELECT count(*) FROM search_symbols('user', pg_temp.repo('test://search'), 2)) <> 2 THEN
        RAISE EXCEPTION 'limit 2 should return two rows';
    END IF;
    IF (SELECT count(*) FROM search_symbols(NULL)) <> 0 THEN
        RAISE EXCEPTION 'a NULL query should return nothing';
    END IF;
END $$;

DO $$
DECLARE
    bad integer;
BEGIN
    FOREACH bad IN ARRAY ARRAY[0, -5, 501] LOOP
        BEGIN
            PERFORM search_symbols('user', NULL, bad);
            RAISE EXCEPTION 'limit % should be rejected', bad;
        EXCEPTION WHEN invalid_parameter_value THEN
            NULL;
        END;
    END LOOP;
END $$;

DO $$
DECLARE
    got text;
BEGIN
    UPDATE symbol s SET name = 'loadAccount', signature = 'function loadAccount()'
    FROM repository r
    WHERE r.repo_id = s.repo_id AND r.url = 'test://search' AND s.name = 'parseJSON';

    got := pg_temp.found('account');
    IF got IS DISTINCT FROM 'loadAccount' THEN
        RAISE EXCEPTION 'search_vector should follow renames, got [%]', got;
    END IF;
    IF pg_temp.found('json') <> '' THEN
        RAISE EXCEPTION 'the old name should no longer match';
    END IF;
END $$;

ROLLBACK;

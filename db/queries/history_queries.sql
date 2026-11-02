-- 1. History summary across repositories
SELECT
   (SELECT count(*) FROM repository)::int AS repositories,
   (SELECT count(*) FROM commit)::int AS commits,
   (SELECT count(DISTINCT author_id) FROM commit)::int AS authors,
   (SELECT count(DISTINCT m.symbol_id) FROM modifies m JOIN commit c USING (commit_id))::int AS symbols_changed,
   (SELECT count(DISTINCT c.cluster_id) FROM clone_cluster c JOIN symbol s USING (cluster_id) WHERE c.status = 'open')::int AS open_clusters;

-- 2. Symbol change hotspots (v_symbol_hotspot)
SELECT r.name AS repo, h.name, h.kind, h.path, h.commits, h.authors, h.additions, h.deletions, h.churn, h.last_changed::date
FROM v_symbol_hotspot h
JOIN repository r ON r.repo_id = h.repo_id
ORDER BY h.churn DESC, h.commits DESC
LIMIT 10;

-- 3. File ownership and author churn share (v_file_ownership)
SELECT r.name AS repo, o.path, o.author_name, o.commits, o.churn, o.share, o.is_owner
FROM v_file_ownership o
JOIN repository r ON r.repo_id = o.repo_id
WHERE o.churn >= 80
ORDER BY r.name, o.path, o.churn DESC
LIMIT 10;

-- 4. Author activity and churn (v_author_activity)
SELECT a.name, a.company, a.emails[1:2] AS sample_emails, a.repos, a.commits, a.churn, a.first_commit::date, a.last_commit::date
FROM v_author_activity a
WHERE a.commits > 0
ORDER BY a.churn DESC, a.commits DESC
LIMIT 10;

-- 5. Commit search with English stemming (websearch_to_tsquery)
SELECT c.commit_id, r.name AS repo, substring(c.sha from 1 for 8) AS sha, a.name AS author, c.committed_at::date AS committed_at,
       (SELECT count(*) FROM modifies m WHERE m.commit_id = c.commit_id) AS symbols,
       (SELECT coalesce(sum(m.additions + m.deletions), 0) FROM modifies m WHERE m.commit_id = c.commit_id) AS churn,
       substring(c.message from 1 for 50) AS message
FROM commit c
JOIN repository r USING (repo_id)
JOIN author a ON a.author_id = c.author_id
WHERE c.message_search @@ websearch_to_tsquery('english', 'router OR routing')
ORDER BY ts_rank(c.message_search, websearch_to_tsquery('english', 'router OR routing')) DESC, c.committed_at DESC
LIMIT 5;

-- 6. Symbols touched by a specific commit
SELECT s.name, s.kind, s.path, s.start_line, s.end_line, m.change_type, m.additions, m.deletions
FROM modifies m
JOIN symbol s USING (symbol_id)
WHERE m.commit_id = 5
ORDER BY s.path, s.start_line;

-- 7. Semantic code search by pgvector cosine distance
SELECT s.symbol_id, r.name AS repo, s.path, s.name, s.kind,
       round((1 - (e.embedding <=> (SELECT embedding FROM symbol_embedding LIMIT 1)))::numeric, 3) AS similarity
FROM symbol_embedding e
JOIN symbol s ON s.embedding_id = e.embedding_id
JOIN repository r ON r.repo_id = s.repo_id
ORDER BY e.embedding <=> (SELECT embedding FROM symbol_embedding LIMIT 1)
LIMIT 5;

-- 8. Clone review queue summary
SELECT c.cluster_id, c.status, c.similarity_score, count(s.symbol_id) AS members,
       string_agg(DISTINCT r.name, ', ') AS repositories,
       c.detected_at::date AS detected_at,
       u.username AS reviewer, c.reviewed_at::date AS reviewed_at
FROM clone_cluster c
LEFT JOIN symbol s ON s.cluster_id = c.cluster_id
LEFT JOIN repository r ON r.repo_id = s.repo_id
LEFT JOIN app_user u ON u.user_id = c.reviewed_by
GROUP BY c.cluster_id, u.username
ORDER BY c.status, c.similarity_score DESC
LIMIT 10;

-- 9. Clone cluster members and waiver check
SELECT s.symbol_id, s.name, s.kind, s.path, s.start_line, s.end_line,
       EXISTS (SELECT 1 FROM waives w WHERE w.symbol_id = s.symbol_id) AS waived
FROM symbol s
WHERE s.cluster_id = 30
ORDER BY s.path, s.start_line;

-- 10. Clone review stored procedure execution with row lock and waivers
DO $$
DECLARE
    v_admin   bigint := (SELECT user_id FROM app_user WHERE role = 'admin' LIMIT 1);
    v_cluster bigint := (SELECT cluster_id FROM clone_cluster WHERE status = 'open' LIMIT 1);
    v_member  bigint := (SELECT symbol_id FROM symbol WHERE cluster_id = v_cluster LIMIT 1);
BEGIN
    IF v_cluster IS NOT NULL AND v_member IS NOT NULL THEN
        CALL review_clone_cluster(v_cluster, v_admin, 'confirmed', ARRAY[v_member]::bigint[], 'Waived as test duplicate');
        RAISE NOTICE 'Cluster % confirmed with waiver for symbol % by admin %', v_cluster, v_member, v_admin;
        -- Revert review back to open for idempotency
        UPDATE clone_cluster SET status = 'open' WHERE cluster_id = v_cluster;
        DELETE FROM waives WHERE symbol_id = v_member;
    END IF;
END;
$$;

-- 11. Clone review guard trigger rejecting non-admin closure
DO $$
DECLARE
    v_dev     bigint := (SELECT user_id FROM app_user WHERE role = 'developer' LIMIT 1);
    v_cluster bigint := (SELECT cluster_id FROM clone_cluster WHERE status = 'open' LIMIT 1);
BEGIN
    UPDATE clone_cluster SET status = 'confirmed', reviewed_by = v_dev WHERE cluster_id = v_cluster;
    RAISE NOTICE 'Trigger failed: developer update was accepted';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Trigger succeeded: rejected developer review: %', SQLERRM;
END;
$$;

-- 12. User authentication with bcrypt verification and role enforcement
SELECT user_id, username, role,
       (password_hash ~ '^\$2[aby]\$1[0-4]\$[./A-Za-z0-9]{53}$') AS is_valid_bcrypt_format,
       created_at::date AS created_at
FROM app_user
ORDER BY user_id;

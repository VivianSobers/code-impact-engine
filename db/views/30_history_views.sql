-- Symbols changed in at least two commits, with how much and by how many people.
CREATE VIEW v_symbol_hotspot AS
SELECT s.symbol_id,
       s.repo_id,
       s.path,
       s.name,
       s.kind,
       count(*)::int                       AS commits,
       count(DISTINCT c.author_id)::int    AS authors,
       sum(m.additions)::int               AS additions,
       sum(m.deletions)::int               AS deletions,
       sum(m.additions + m.deletions)::int AS churn,
       max(c.committed_at)                 AS last_changed
FROM modifies m
JOIN commit c ON c.commit_id = m.commit_id
JOIN symbol s ON s.symbol_id = m.symbol_id
GROUP BY s.symbol_id, s.repo_id, s.path, s.name, s.kind
HAVING count(*) >= 2;

-- Who has changed each file the most, measured in changed lines inside its symbols.
-- share is the author's part of the file's churn; the owner is the author with the
-- largest share, ties going to the lower author_id.
CREATE VIEW v_file_ownership AS
WITH per_author AS (
    SELECT s.repo_id,
           s.path,
           c.author_id,
           count(DISTINCT c.commit_id)::int     AS commits,
           sum(m.additions + m.deletions)::int  AS churn
    FROM modifies m
    JOIN commit c ON c.commit_id = m.commit_id
    JOIN symbol s ON s.symbol_id = m.symbol_id
    GROUP BY s.repo_id, s.path, c.author_id
)
SELECT p.repo_id,
       p.path,
       p.author_id,
       a.name AS author_name,
       p.commits,
       p.churn,
       round(p.churn::numeric / sum(p.churn) OVER (PARTITION BY p.repo_id, p.path), 4)::numeric(5,4) AS share,
       rank() OVER (PARTITION BY p.repo_id, p.path ORDER BY p.churn DESC, p.author_id) = 1           AS is_owner
FROM per_author p
JOIN author a ON a.author_id = p.author_id;

-- One row per author, including authors whose commits were all in deleted repositories.
CREATE VIEW v_author_activity AS
SELECT a.author_id,
       a.name,
       a.company,
       coalesce((SELECT array_agg(e.email ORDER BY e.email) FROM author_email e WHERE e.author_id = a.author_id),
                '{}')                                                    AS emails,
       count(DISTINCT c.repo_id)::int                                    AS repos,
       count(DISTINCT c.commit_id)::int                                  AS commits,
       coalesce((SELECT sum(m.additions + m.deletions)
                 FROM modifies m JOIN commit c2 ON c2.commit_id = m.commit_id
                 WHERE c2.author_id = a.author_id), 0)::int              AS churn,
       min(c.committed_at)                                               AS first_commit,
       max(c.committed_at)                                               AS last_commit
FROM author a
LEFT JOIN commit c ON c.author_id = a.author_id
GROUP BY a.author_id, a.name, a.company;

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

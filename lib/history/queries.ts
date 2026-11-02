import { pool } from "@/lib/pg";
import type { SymbolKind } from "@/lib/structure/types";
import {
  COMMITS_PER_PAGE,
  type AuthorActivity,
  type CommitChange,
  type CommitFilter,
  type CommitSummary,
  type Hotspot,
  type HistorySummary,
} from "./types";

const iso = (value: Date | null) => (value ? value.toISOString() : "");

export async function getSummary(repoId: number | null): Promise<HistorySummary> {
  const result = await pool.query<{
    repositories: number;
    commits: number;
    authors: number;
    symbols_changed: number;
    open_clusters: number;
  }>(
    `SELECT
       (SELECT count(*) FROM repository WHERE $1::bigint IS NULL OR repo_id = $1)::int AS repositories,
       (SELECT count(*) FROM commit WHERE $1::bigint IS NULL OR repo_id = $1)::int AS commits,
       (SELECT count(DISTINCT author_id) FROM commit WHERE $1::bigint IS NULL OR repo_id = $1)::int AS authors,
       (SELECT count(DISTINCT m.symbol_id) FROM modifies m JOIN commit c USING (commit_id)
        WHERE $1::bigint IS NULL OR c.repo_id = $1)::int AS symbols_changed,
       (SELECT count(DISTINCT c.cluster_id) FROM clone_cluster c JOIN symbol s USING (cluster_id)
        WHERE c.status = 'open' AND ($1::bigint IS NULL OR s.repo_id = $1))::int AS open_clusters`,
    [repoId],
  );
  const r = result.rows[0];
  return {
    repositories: r.repositories,
    commits: r.commits,
    authors: r.authors,
    symbolsChanged: r.symbols_changed,
    openClusters: r.open_clusters,
  };
}

// Reads the v_symbol_hotspot view: symbols changed in at least two commits.
export async function getHotspots(repoId: number | null, limit: number): Promise<Hotspot[]> {
  const result = await pool.query<{
    symbol_id: string;
    repo_id: string;
    path: string;
    name: string;
    kind: SymbolKind;
    commits: number;
    authors: number;
    additions: number;
    deletions: number;
    churn: number;
    last_changed: Date;
  }>(
    `SELECT * FROM v_symbol_hotspot
     WHERE $1::bigint IS NULL OR repo_id = $1
     ORDER BY churn DESC, commits DESC, symbol_id
     LIMIT $2`,
    [repoId, limit],
  );
  return result.rows.map((r) => ({
    symbolId: Number(r.symbol_id),
    repoId: Number(r.repo_id),
    path: r.path,
    name: r.name,
    kind: r.kind,
    commits: r.commits,
    authors: r.authors,
    additions: r.additions,
    deletions: r.deletions,
    churn: r.churn,
    lastChanged: iso(r.last_changed),
  }));
}

// Across all repositories this is the v_author_activity view; for one repository the
// same numbers are computed from that repository's commits only.
export async function getAuthorActivity(repoId: number | null, limit = 20): Promise<AuthorActivity[]> {
  const sql =
    repoId === null
      ? `SELECT author_id, name, company, commits, churn, first_commit, last_commit
         FROM v_author_activity WHERE commits > 0
         ORDER BY churn DESC, commits DESC, author_id LIMIT $1`
      : `SELECT a.author_id, a.name, a.company,
                count(DISTINCT c.commit_id)::int AS commits,
                coalesce(sum(m.additions + m.deletions), 0)::int AS churn,
                min(c.committed_at) AS first_commit, max(c.committed_at) AS last_commit
         FROM author a
         JOIN commit c ON c.author_id = a.author_id AND c.repo_id = $2
         LEFT JOIN modifies m ON m.commit_id = c.commit_id
         GROUP BY a.author_id
         ORDER BY churn DESC, commits DESC, a.author_id LIMIT $1`;
  const result = await pool.query<{
    author_id: string;
    name: string;
    company: string | null;
    commits: number;
    churn: number;
    first_commit: Date;
    last_commit: Date;
  }>(sql, repoId === null ? [limit] : [limit, repoId]);
  return result.rows.map((r) => ({
    authorId: Number(r.author_id),
    name: r.name,
    company: r.company,
    commits: r.commits,
    churn: r.churn,
    firstCommit: iso(r.first_commit),
    lastCommit: iso(r.last_commit),
  }));
}

interface CommitRecord {
  commit_id: string;
  repo_id: string;
  repo_name: string;
  sha: string;
  message: string;
  author_id: string;
  author_name: string;
  committed_at: Date;
  symbols: number;
  churn: number;
}

function toCommit(r: CommitRecord): CommitSummary {
  return {
    commitId: Number(r.commit_id),
    repoId: Number(r.repo_id),
    repoName: r.repo_name,
    sha: r.sha,
    message: r.message,
    authorId: Number(r.author_id),
    authorName: r.author_name,
    committedAt: iso(r.committed_at),
    symbols: r.symbols,
    churn: r.churn,
  };
}

const COMMIT_COLUMNS = `c.commit_id, c.repo_id, r.name AS repo_name, c.sha, c.message, c.author_id,
  a.name AS author_name, c.committed_at,
  (SELECT count(*) FROM modifies m WHERE m.commit_id = c.commit_id)::int AS symbols,
  (SELECT coalesce(sum(m.additions + m.deletions), 0) FROM modifies m WHERE m.commit_id = c.commit_id)::int AS churn`;

// Newest first, or by relevance when searching. q goes through websearch_to_tsquery, so
// "discount -test" and quoted phrases work, and words are stemmed ("rounding" finds "round").
export async function listCommits(filter: CommitFilter): Promise<{ commits: CommitSummary[]; total: number }> {
  const where = `($1::bigint IS NULL OR c.repo_id = $1)
    AND ($2::bigint IS NULL OR c.author_id = $2)
    AND ($3 = '' OR c.message_search @@ websearch_to_tsquery('english', $3))`;
  const params = [filter.repoId, filter.authorId, filter.q];
  const [rows, count] = await Promise.all([
    pool.query<CommitRecord>(
      `SELECT ${COMMIT_COLUMNS}
       FROM commit c JOIN repository r USING (repo_id) JOIN author a ON a.author_id = c.author_id
       WHERE ${where}
       ORDER BY CASE WHEN $3 = '' THEN 0 ELSE ts_rank(c.message_search, websearch_to_tsquery('english', $3)) END DESC,
                c.committed_at DESC, c.commit_id DESC
       LIMIT ${COMMITS_PER_PAGE} OFFSET $4`,
      [...params, (filter.page - 1) * COMMITS_PER_PAGE],
    ),
    pool.query<{ total: number }>(`SELECT count(*)::int AS total FROM commit c WHERE ${where}`, params),
  ]);
  return { commits: rows.rows.map(toCommit), total: count.rows[0].total };
}

export async function getCommit(commitId: number): Promise<{ commit: CommitSummary; changes: CommitChange[] } | null> {
  const commit = await pool.query<CommitRecord>(
    `SELECT ${COMMIT_COLUMNS}
     FROM commit c JOIN repository r USING (repo_id) JOIN author a ON a.author_id = c.author_id
     WHERE c.commit_id = $1`,
    [commitId],
  );
  if (commit.rowCount === 0) return null;
  const changes = await pool.query<{
    symbol_id: string;
    path: string;
    start_line: number;
    name: string;
    kind: SymbolKind;
    additions: number;
    deletions: number;
    change_type: "added" | "modified";
  }>(
    `SELECT s.symbol_id, s.path, s.start_line, s.name, s.kind, m.additions, m.deletions, m.change_type
     FROM modifies m JOIN symbol s USING (symbol_id)
     WHERE m.commit_id = $1
     ORDER BY s.path, s.start_line`,
    [commitId],
  );
  return {
    commit: toCommit(commit.rows[0]),
    changes: changes.rows.map((r) => ({
      symbolId: Number(r.symbol_id),
      path: r.path,
      startLine: r.start_line,
      name: r.name,
      kind: r.kind,
      additions: r.additions,
      deletions: r.deletions,
      changeType: r.change_type,
    })),
  };
}

export async function listCommitAuthors(repoId: number | null): Promise<{ authorId: number; name: string }[]> {
  const result = await pool.query<{ author_id: string; name: string }>(
    `SELECT DISTINCT a.author_id, a.name FROM author a JOIN commit c ON c.author_id = a.author_id
     WHERE $1::bigint IS NULL OR c.repo_id = $1 ORDER BY a.name`,
    [repoId],
  );
  return result.rows.map((r) => ({ authorId: Number(r.author_id), name: r.name }));
}

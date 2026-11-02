import { pool } from "@/lib/pg";
import { toLanguages } from "./rows";
import type { FileEntry, Language, RepositorySummary } from "./types";

interface RepositoryRecord {
  repo_id: string;
  name: string;
  url: string;
  default_branch: string;
  added_date: Date;
  file_count: string;
  symbol_count: string;
  call_count: string;
  loc: string;
  languages: string[] | null;
}

const REPOSITORY_QUERY = `
  SELECT r.repo_id, r.name, r.url, r.default_branch, r.added_date,
         coalesce(f.file_count, 0) AS file_count,
         coalesce(f.loc, 0) AS loc,
         f.languages,
         coalesce(s.symbol_count, 0) AS symbol_count,
         coalesce(c.call_count, 0) AS call_count
  FROM repository r
  LEFT JOIN (
      SELECT repo_id, count(*) AS file_count, sum(loc) AS loc,
             array_agg(DISTINCT language ORDER BY language) AS languages
      FROM file GROUP BY repo_id
  ) f ON f.repo_id = r.repo_id
  LEFT JOIN (
      SELECT repo_id, count(*) AS symbol_count FROM symbol GROUP BY repo_id
  ) s ON s.repo_id = r.repo_id
  LEFT JOIN (
      SELECT s.repo_id, count(*) AS call_count
      FROM calls c JOIN symbol s ON s.symbol_id = c.caller_id
      GROUP BY s.repo_id
  ) c ON c.repo_id = r.repo_id`;

function toSummary(r: RepositoryRecord): RepositorySummary {
  return {
    repoId: Number(r.repo_id),
    name: r.name,
    url: r.url,
    defaultBranch: r.default_branch,
    addedDate: r.added_date.toISOString(),
    fileCount: Number(r.file_count),
    symbolCount: Number(r.symbol_count),
    callCount: Number(r.call_count),
    loc: Number(r.loc),
    languages: toLanguages(r.languages),
  };
}

export async function listRepositories(): Promise<RepositorySummary[]> {
  const { rows } = await pool.query<RepositoryRecord>(`${REPOSITORY_QUERY} ORDER BY r.added_date DESC, r.repo_id DESC`);
  return rows.map(toSummary);
}

export async function getRepository(repoId: number): Promise<RepositorySummary | null> {
  const { rows } = await pool.query<RepositoryRecord>(`${REPOSITORY_QUERY} WHERE r.repo_id = $1`, [repoId]);
  return rows[0] ? toSummary(rows[0]) : null;
}

export async function listFiles(repoId: number): Promise<FileEntry[]> {
  const { rows } = await pool.query<{
    path: string;
    language: Language;
    loc: number;
    symbol_count: string;
    has_ast: boolean;
  }>(
    `SELECT f.path, f.language, f.loc, f.ast_doc_id IS NOT NULL AS has_ast,
            count(s.symbol_id) FILTER (WHERE s.kind <> 'module') AS symbol_count
     FROM file f
     LEFT JOIN symbol s ON s.repo_id = f.repo_id AND s.path = f.path
     WHERE f.repo_id = $1
     GROUP BY f.repo_id, f.path
     ORDER BY f.path`,
    [repoId],
  );
  return rows.map((r) => ({
    path: r.path,
    language: r.language,
    loc: r.loc,
    symbolCount: Number(r.symbol_count),
    hasAst: r.has_ast,
  }));
}

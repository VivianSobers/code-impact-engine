import { pool } from "@/lib/pg";
import { SYMBOL_COLUMNS, toSymbolRow, type SymbolRecord } from "./rows";
import type { FileDetail, ImportLink, Language, SymbolRow } from "./types";

export async function getFile(repoId: number, path: string): Promise<FileDetail | null> {
  const { rows } = await pool.query<{
    repo_id: string;
    repo_name: string;
    path: string;
    language: Language;
    loc: number;
    content_hash: string;
    ast_doc_id: string | null;
  }>(
    `SELECT f.repo_id, r.name AS repo_name, f.path, f.language, f.loc, f.content_hash, f.ast_doc_id
     FROM file f JOIN repository r ON r.repo_id = f.repo_id
     WHERE f.repo_id = $1 AND f.path = $2`,
    [repoId, path],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    repoId: Number(r.repo_id),
    repoName: r.repo_name,
    path: r.path,
    language: r.language,
    loc: r.loc,
    contentHash: r.content_hash.trim(),
    astDocId: r.ast_doc_id?.trim() ?? null,
  };
}

export async function listSymbolsInFile(repoId: number, path: string): Promise<SymbolRow[]> {
  const { rows } = await pool.query<SymbolRecord>(
    `SELECT ${SYMBOL_COLUMNS}
     FROM symbol s
     WHERE s.repo_id = $1 AND s.path = $2
     ORDER BY s.start_line, s.end_line DESC, s.name`,
    [repoId, path],
  );
  return rows.map(toSymbolRow);
}

async function linkedFiles(sql: string, repoId: number, path: string): Promise<ImportLink[]> {
  const { rows } = await pool.query<{ repo_id: string; path: string; language: Language }>(sql, [repoId, path]);
  return rows.map((r) => ({ repoId: Number(r.repo_id), path: r.path, language: r.language }));
}

export function listImports(repoId: number, path: string): Promise<ImportLink[]> {
  return linkedFiles(
    `SELECT f.repo_id, f.path, f.language
     FROM imports i
     JOIN file f ON f.repo_id = i.imported_repo_id AND f.path = i.imported_path
     WHERE i.importer_repo_id = $1 AND i.importer_path = $2
     ORDER BY f.path`,
    repoId,
    path,
  );
}

export function listImportedBy(repoId: number, path: string): Promise<ImportLink[]> {
  return linkedFiles(
    `SELECT f.repo_id, f.path, f.language
     FROM imports i
     JOIN file f ON f.repo_id = i.importer_repo_id AND f.path = i.importer_path
     WHERE i.imported_repo_id = $1 AND i.imported_path = $2
     ORDER BY f.path`,
    repoId,
    path,
  );
}

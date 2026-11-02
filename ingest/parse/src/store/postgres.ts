import pg from "pg";
import type { Language } from "../languages";
import type { SymbolKind } from "../extract/types";

export interface FileRow {
  path: string;
  language: Language;
  loc: number;
  contentHash: string;
  astDocId: string | null;
}

export interface SymbolRow {
  key: number;
  path: string;
  name: string;
  kind: SymbolKind;
  signature: string | null;
  startLine: number;
  endLine: number;
  isEntryPoint: boolean;
}

export interface CallRow {
  caller: number;
  callee: number;
  line: number;
  confidence: number;
}

export interface ImportRow {
  importer: string;
  imported: string;
}

const batchSize = 5000;

function chunks<T>(rows: T[]): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < rows.length; start += batchSize) result.push(rows.slice(start, start + batchSize));
  return result;
}

function symbolKey(path: string, kind: string, name: string, startLine: number): string {
  return `${path}\u0000${kind}\u0000${name}\u0000${startLine}`;
}

export class StructureWriter {
  constructor(private readonly client: pg.PoolClient | pg.Client) {}

  static connect(databaseUrl: string): Promise<pg.Client> {
    const client = new pg.Client({ connectionString: databaseUrl });
    return client.connect().then(() => client);
  }

  async upsertRepository(name: string, url: string, branch: string): Promise<number> {
    const result = await this.client.query<{ repo_id: string }>(
      `INSERT INTO repository (name, url, default_branch)
       VALUES ($1, $2, $3)
       ON CONFLICT (url) DO UPDATE SET name = EXCLUDED.name, default_branch = EXCLUDED.default_branch
       RETURNING repo_id`,
      [name, url, branch],
    );
    return Number(result.rows[0].repo_id);
  }

  async clearRepository(repoId: number): Promise<void> {
    await this.client.query("DELETE FROM file WHERE repo_id = $1", [repoId]);
  }

  async insertFiles(repoId: number, files: FileRow[]): Promise<void> {
    for (const batch of chunks(files)) {
      await this.client.query(
        `INSERT INTO file (repo_id, path, language, loc, content_hash, ast_doc_id)
         SELECT $1, * FROM unnest($2::text[], $3::text[], $4::int[], $5::text[], $6::text[])`,
        [
          repoId,
          batch.map((file) => file.path),
          batch.map((file) => file.language),
          batch.map((file) => file.loc),
          batch.map((file) => file.contentHash),
          batch.map((file) => file.astDocId),
        ],
      );
    }
  }

  async insertSymbols(repoId: number, symbols: SymbolRow[]): Promise<Map<number, number>> {
    const ids = new Map<number, number>();
    const keys = new Map(symbols.map((symbol) => [symbolKey(symbol.path, symbol.kind, symbol.name, symbol.startLine), symbol.key]));
    for (const batch of chunks(symbols)) {
      const result = await this.client.query<{ symbol_id: string; path: string; kind: string; name: string; start_line: number }>(
        `INSERT INTO symbol (repo_id, path, name, kind, signature, start_line, end_line, is_entry_point)
         SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::int[], $8::boolean[])
         RETURNING symbol_id, path, kind, name, start_line`,
        [
          repoId,
          batch.map((symbol) => symbol.path),
          batch.map((symbol) => symbol.name),
          batch.map((symbol) => symbol.kind),
          batch.map((symbol) => symbol.signature),
          batch.map((symbol) => symbol.startLine),
          batch.map((symbol) => symbol.endLine),
          batch.map((symbol) => symbol.isEntryPoint),
        ],
      );
      for (const row of result.rows) {
        const key = keys.get(symbolKey(row.path, row.kind, row.name, row.start_line));
        if (key !== undefined) ids.set(key, Number(row.symbol_id));
      }
    }
    if (ids.size !== symbols.length) throw new Error(`Expected ${symbols.length} symbol ids, got ${ids.size}`);
    return ids;
  }

  async insertCalls(calls: CallRow[]): Promise<void> {
    for (const batch of chunks(calls)) {
      await this.client.query(
        `INSERT INTO calls (caller_id, callee_id, call_line, resolution_confidence)
         SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::int[], $4::numeric[])`,
        [batch.map((call) => call.caller), batch.map((call) => call.callee), batch.map((call) => call.line), batch.map((call) => call.confidence)],
      );
    }
  }

  async insertImports(repoId: number, imports: ImportRow[]): Promise<void> {
    for (const batch of chunks(imports)) {
      await this.client.query(
        `INSERT INTO imports (importer_repo_id, importer_path, imported_repo_id, imported_path)
         SELECT $1, importer, $1, imported FROM unnest($2::text[], $3::text[]) AS edge(importer, imported)`,
        [repoId, batch.map((edge) => edge.importer), batch.map((edge) => edge.imported)],
      );
    }
  }
}

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadSettings, type Settings } from "./config";
import { parseSource } from "./extract";
import type { FileFacts } from "./extract/types";
import type { Language } from "./languages";
import { CallGraph } from "./resolve/calls";
import { ImportResolver, type FileLinks } from "./resolve/imports";
import { listSourceFiles, looksMinified, prepareSource } from "./source";
import { AstStore, type AstInput } from "./store/mongo";
import { StructureWriter } from "./store/postgres";

export interface IngestOptions {
  target: string;
  name?: string;
  branch?: string;
  url?: string;
  settings?: Settings;
  log?: (message: string) => void;
}

export interface IngestSummary {
  repoId: number;
  name: string;
  files: number;
  symbols: number;
  calls: number;
  imports: number;
  skipped: number;
  durationMs: number;
}

interface ParsedEntry {
  path: string;
  language: Language;
  loc: number;
  contentHash: string;
  facts: FileFacts;
}

const astBatchSize = 100;

export async function ingestRepository(options: IngestOptions): Promise<IngestSummary> {
  const started = performance.now();
  const log = options.log ?? (() => {});
  const settings = options.settings ?? loadSettings();

  const source = await prepareSource(options.target, { name: options.name, branch: options.branch, url: options.url, log });
  const { files, skipped } = await listSourceFiles(source);
  log(`Found ${files.length} source files in ${source.dir} on ${source.branch}, skipped ${skipped.length}`);

  const database = await StructureWriter.connect(settings.databaseUrl);
  let mongo: Awaited<ReturnType<typeof AstStore.connect>> | null = null;
  let astStore: AstStore | null = null;

  try {
    mongo = await AstStore.connect(settings.mongoUri);
    await database.query("BEGIN");
    const writer = new StructureWriter(database);
    const repoId = await writer.upsertRepository(source.name, source.url, source.branch);
    astStore = new AstStore(mongo.db(settings.mongoDb), repoId);

    const parsed: ParsedEntry[] = [];
    const astIds = new Map<string, string>();
    let pending: AstInput[] = [];
    let skippedCount = skipped.length;
    const flush = async () => {
      for (const [path, id] of await astStore!.write(pending)) astIds.set(path, id);
      pending = [];
    };

    for (const file of files) {
      const buffer = await readFile(file.absolutePath);
      const text = buffer.toString("utf8");
      if (looksMinified(text)) {
        skippedCount++;
        continue;
      }
      const contentHash = createHash("sha256").update(buffer).digest("hex");
      const result = await parseSource(file.path, file.grammar, text);
      parsed.push({ path: file.path, language: result.language, loc: result.loc, contentHash, facts: result.facts });
      pending.push({ path: file.path, language: result.language, grammar: file.grammar, contentHash, loc: result.loc, ast: result.ast });
      if (pending.length >= astBatchSize) await flush();
      if (parsed.length % 500 === 0) log(`Parsed ${parsed.length} of ${files.length} files`);
    }
    await flush();
    log(`Parsed ${parsed.length} files and stored their ASTs`);

    const resolver = new ImportResolver(parsed.map((entry) => ({ path: entry.path, language: entry.language, imports: entry.facts.imports })));
    const links = new Map<string, FileLinks>(
      parsed.map((entry) => [entry.path, resolver.link({ path: entry.path, language: entry.language, imports: entry.facts.imports })]),
    );
    const graphFiles = parsed.map((entry) => ({ path: entry.path, facts: entry.facts }));
    const graph = new CallGraph(graphFiles, links);
    const calls = graph.resolve(graphFiles);
    const importRows = [...links].flatMap(([importer, link]) => [...link.edges].map((imported) => ({ importer, imported })));
    const entries = graph.markEntryPoints(calls, new Set(importRows.map((row) => row.imported)));

    await writer.clearRepository(repoId);
    await writer.insertFiles(
      repoId,
      parsed.map((entry) => ({
        path: entry.path,
        language: entry.language,
        loc: entry.loc,
        contentHash: entry.contentHash,
        astDocId: astIds.get(entry.path) ?? null,
      })),
    );
    const symbolIds = await writer.insertSymbols(
      repoId,
      graph.symbols.map((symbol) => ({
        key: symbol.id,
        path: symbol.path,
        name: symbol.name,
        kind: symbol.kind,
        signature: symbol.signature,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        isEntryPoint: entries.has(symbol.id),
      })),
    );
    await writer.insertCalls(
      calls.map((call) => ({
        caller: symbolIds.get(call.caller)!,
        callee: symbolIds.get(call.callee)!,
        line: call.line,
        confidence: call.confidence,
      })),
    );
    await writer.insertImports(repoId, importRows);
    await database.query("COMMIT");

    const stale = await astStore.removeStale();
    if (stale > 0) log(`Removed ${stale} AST documents for files that no longer exist`);

    return {
      repoId,
      name: source.name,
      files: parsed.length,
      symbols: graph.symbols.length,
      calls: calls.length,
      imports: importRows.length,
      skipped: skippedCount,
      durationMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    await database.query("ROLLBACK").catch(() => undefined);
    await astStore?.rollback().catch((cleanupError: unknown) => log(`Could not remove AST documents from this run: ${String(cleanupError)}`));
    throw error;
  } finally {
    await database.end().catch(() => undefined);
    await mongo?.close().catch(() => undefined);
  }
}

export { loadSettings, type Settings } from "./config";
export { prepareSource, workdirFor, type SourceRepo } from "./source";

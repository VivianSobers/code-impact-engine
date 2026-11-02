import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { loadSettings, type Settings } from "../../parse/src/config";
import { checkoutDir, findRepository } from "../../history/src/index";
import { embed, EMBEDDING_MODEL } from "./model";
import { rebuildClusters } from "./clusterStore";
import { eligibleSymbols, existingEmbeddings, insertEmbeddings, linkEmbeddings } from "./store";
import { bodyHash, symbolBody } from "./text";

export interface EmbedOptions {
  repo: number | string;
  settings?: Settings;
  log?: (message: string) => void;
}

export interface EmbedSummary {
  repoId: number;
  symbols: number;
  embedded: number;
  reused: number;
  clusters: number;
  durationMs: number;
}

export async function embedRepository(options: EmbedOptions): Promise<EmbedSummary> {
  const started = Date.now();
  const log = options.log ?? ((message: string) => process.stderr.write(`${message}\n`));
  const settings = options.settings ?? loadSettings();
  const client = new pg.Client({ connectionString: settings.databaseUrl });
  await client.connect();
  try {
    const { repoId, url } = await findRepository(client, options.repo);
    const dir = checkoutDir(url);
    const symbols = await eligibleSymbols(client, repoId);

    // Bodies come from the files the parser read, so line numbers match.
    const sources = new Map<string, string>();
    const bodies: { symbolId: number; body: string; hash: string }[] = [];
    for (const symbol of symbols) {
      if (!sources.has(symbol.path)) sources.set(symbol.path, await readFile(path.join(dir, symbol.path), "utf8"));
      const body = symbolBody(sources.get(symbol.path)!, symbol.startLine, symbol.endLine);
      bodies.push({ symbolId: symbol.symbolId, body, hash: bodyHash(body) });
    }

    const known = await existingEmbeddings(client, EMBEDDING_MODEL, [...new Set(bodies.map((b) => b.hash))]);
    const missing = [...new Map(bodies.filter((b) => !known.has(b.hash)).map((b) => [b.hash, b.body])).entries()];
    log(`${symbols.length} symbols, ${missing.length} new bodies to embed with ${EMBEDDING_MODEL}`);
    const vectors = await embed(missing.map(([, body]) => body));
    await insertEmbeddings(
      client,
      EMBEDDING_MODEL,
      missing.map(([hash], i) => ({ hash, vector: vectors[i] })),
    );

    const ids = await existingEmbeddings(client, EMBEDDING_MODEL, [...new Set(bodies.map((b) => b.hash))]);
    await linkEmbeddings(
      client,
      bodies.map((b) => ({ symbolId: b.symbolId, embeddingId: ids.get(b.hash)! })),
    );
    const embedded = bodies.filter((b) => !known.has(b.hash)).length;

    const clusters = await rebuildClusters(client, repoId, new Map(bodies.map((b) => [b.symbolId, b.body])));
    log(`${clusters} clone clusters`);
    return { repoId, symbols: symbols.length, embedded, reused: symbols.length - embedded, clusters, durationMs: Date.now() - started };
  } finally {
    await client.end();
  }
}

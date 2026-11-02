import path from "node:path";
import pg from "pg";
import { loadSettings, repoRoot, type Settings } from "../../parse/src/config";
import { parseSource } from "../../parse/src/extract";
import type { RawSymbol } from "../../parse/src/extract/types";
import { grammarFor } from "../../parse/src/languages";
import { isRemote, run, skipReason, workdirFor } from "../../parse/src/source";
import { attribute } from "./attribute";
import { BlobReader } from "./blobs";
import { gitLogArgs, parseGitLog } from "./gitlog";
import { storeHistory, type FileAttributions } from "./store";

export interface HistoryOptions {
  repo: number | string;
  settings?: Settings;
  log?: (message: string) => void;
}

export interface HistorySummary {
  repoId: number;
  commits: number;
  authors: number;
  modifies: number;
  unmatched: number;
  durationMs: number;
}

// Where the parser left the repository's files: its clone for a git URL, otherwise
// the local path it was given (relative paths are relative to the project root).
export function checkoutDir(url: string): string {
  return isRemote(url) ? workdirFor(url) : path.resolve(repoRoot, url);
}

async function findRepository(client: pg.Client, repo: number | string): Promise<{ repoId: number; url: string }> {
  const result =
    typeof repo === "number"
      ? await client.query<{ repo_id: string; url: string }>("SELECT repo_id, url FROM repository WHERE repo_id = $1", [repo])
      : await client.query<{ repo_id: string; url: string }>("SELECT repo_id, url FROM repository WHERE name = $1 OR url = $1", [repo]);
  if (result.rowCount === 0) throw new Error(`No repository ${repo}. Parse it first with npm run parse.`);
  if (result.rowCount! > 1) throw new Error(`More than one repository is called ${repo}. Use its repo_id.`);
  return { repoId: Number(result.rows[0].repo_id), url: result.rows[0].url };
}

export async function ingestHistory(options: HistoryOptions): Promise<HistorySummary> {
  const started = Date.now();
  const log = options.log ?? ((message: string) => process.stderr.write(`${message}\n`));
  const settings = options.settings ?? loadSettings();
  const client = new pg.Client({ connectionString: settings.databaseUrl });
  await client.connect();
  try {
    const { repoId, url } = await findRepository(client, options.repo);
    const dir = checkoutDir(url);
    log(`reading history of ${url} from ${dir}`);
    const commits = parseGitLog(await run("git", gitLogArgs(), dir));
    log(`${commits.length} commits`);

    const blobs = new BlobReader(dir);
    const parsed = new Map<string, RawSymbol[] | null>();
    const symbolsAt = async (revision: string | undefined, filePath: string | null): Promise<RawSymbol[] | null> => {
      if (!revision || !filePath) return null;
      const grammar = grammarFor(filePath);
      const blob = grammar ? await blobs.read(revision, filePath) : null;
      if (!grammar || !blob) return null;
      if (skipReason(filePath, Buffer.byteLength(blob.text)) !== null) return null;
      const cached = parsed.get(blob.oid);
      if (cached !== undefined) return cached;
      const symbols = (await parseSource(filePath, grammar, blob.text)).facts.symbols;
      parsed.set(blob.oid, symbols);
      return symbols;
    };

    const changes = new Map<string, FileAttributions[]>();
    try {
      for (const commit of commits) {
        const files: FileAttributions[] = [];
        for (const file of commit.files) {
          if (file.binary || !file.newPath || file.hunks.length === 0 || !grammarFor(file.newPath)) continue;
          const before = await symbolsAt(commit.parents[0], file.oldPath);
          const after = await symbolsAt(commit.sha, file.newPath);
          const attributions = attribute(file.hunks, before, after);
          if (attributions.length > 0) files.push({ path: file.newPath, attributions });
        }
        changes.set(commit.sha, files);
      }
    } finally {
      blobs.close();
    }

    const stored = await storeHistory(client, repoId, commits, changes);
    return { repoId, ...stored, durationMs: Date.now() - started };
  } finally {
    await client.end();
  }
}

import type pg from "pg";
import { parseSymbolKey, type Attribution } from "./attribute";
import { groupAuthors } from "./authors";
import type { CommitRecord } from "./gitlog";

export interface FileAttributions {
  path: string;
  attributions: Attribution[];
}

export interface StoredHistory {
  commits: number;
  authors: number;
  modifies: number;
  unmatched: number;
}

type Client = pg.Client | pg.PoolClient;

function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// Finds or creates one author row per person and returns author_id by email, and by
// name for commits that have no email.
async function storeAuthors(client: Client, commits: CommitRecord[]): Promise<{ byEmail: Map<string, number>; byName: Map<string, number> }> {
  const byEmail = new Map<string, number>();
  const byName = new Map<string, number>();
  for (const group of groupAuthors(commits)) {
    const existing =
      group.emails.length > 0
        ? await client.query<{ author_id: string }>(
            "SELECT min(author_id) AS author_id FROM author_email WHERE email = ANY($1)",
            [group.emails],
          )
        : await client.query<{ author_id: string }>(
            `SELECT min(a.author_id) AS author_id FROM author a
             WHERE a.name = $1 AND NOT EXISTS (SELECT 1 FROM author_email e WHERE e.author_id = a.author_id)`,
            [group.name],
          );
    let authorId = existing.rows[0].author_id === null ? null : Number(existing.rows[0].author_id);
    if (authorId === null) {
      const inserted = await client.query<{ author_id: string }>(
        "INSERT INTO author (name, company) VALUES ($1, $2) RETURNING author_id",
        [group.name, group.company],
      );
      authorId = Number(inserted.rows[0].author_id);
    } else {
      await client.query("UPDATE author SET name = $2, company = coalesce($3, company) WHERE author_id = $1", [
        authorId,
        group.name,
        group.company,
      ]);
    }
    // An address already owned by another author stays with that author.
    await client.query(
      "INSERT INTO author_email (author_id, email) SELECT $1, unnest($2::text[]) ON CONFLICT (email) DO NOTHING",
      [authorId, group.emails],
    );
    const owners = await client.query<{ email: string; author_id: string }>(
      "SELECT email, author_id FROM author_email WHERE email = ANY($1)",
      [group.emails],
    );
    for (const row of owners.rows) byEmail.set(row.email, Number(row.author_id));
    byName.set(nameKey(group.name), authorId);
  }
  return { byEmail, byName };
}

// Maps (path, symbol key) to the symbol_id of the current parse of the repository,
// numbering same-named symbols by start line the same way symbolKeys does.
async function currentSymbols(client: Client, repoId: number): Promise<Map<string, number>> {
  const result = await client.query<{ symbol_id: string; path: string; kind: string; name: string }>(
    `SELECT symbol_id, path, kind, name FROM symbol
     WHERE repo_id = $1 AND kind <> 'module'
     ORDER BY path, kind, name, start_line, end_line`,
    [repoId],
  );
  const ids = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const row of result.rows) {
    const base = `${row.path}\u0001${row.kind}\u0000${row.name}`;
    const ordinal = seen.get(base) ?? 0;
    seen.set(base, ordinal + 1);
    ids.set(`${base}\u0000${ordinal}`, Number(row.symbol_id));
  }
  return ids;
}

// Replaces the repository's commits and their symbol changes in one transaction.
// Authors are shared between repositories and are only added or updated.
export async function storeHistory(
  client: Client,
  repoId: number,
  commits: CommitRecord[],
  changes: Map<string, FileAttributions[]>,
): Promise<StoredHistory> {
  await client.query("BEGIN");
  try {
    const authors = await storeAuthors(client, commits);
    const authorOf = (c: CommitRecord) =>
      authors.byEmail.get(c.authorEmail.trim().toLowerCase()) ?? authors.byName.get(nameKey(c.authorName || c.authorEmail));
    await client.query("DELETE FROM commit WHERE repo_id = $1", [repoId]);

    const inserted = await client.query<{ commit_id: string; sha: string }>(
      `INSERT INTO commit (repo_id, author_id, sha, message, committed_at)
       SELECT $1, a, s, m, t FROM unnest($2::bigint[], $3::text[], $4::text[], $5::timestamptz[]) AS v (a, s, m, t)
       RETURNING commit_id, sha`,
      [
        repoId,
        commits.map(authorOf),
        commits.map((c) => c.sha),
        commits.map((c) => c.message),
        commits.map((c) => c.committedAt),
      ],
    );
    const commitIds = new Map(inserted.rows.map((row) => [row.sha.trim(), Number(row.commit_id)]));

    const symbols = await currentSymbols(client, repoId);
    const rows = { commit: [] as number[], symbol: [] as number[], additions: [] as number[], deletions: [] as number[], type: [] as string[] };
    let unmatched = 0;
    for (const [sha, files] of changes) {
      for (const file of files) {
        for (const change of file.attributions) {
          const { kind, name, ordinal } = parseSymbolKey(change.key);
          const symbolId = symbols.get(`${file.path}\u0001${kind}\u0000${name}\u0000${ordinal}`);
          if (symbolId === undefined) {
            unmatched += 1;
            continue;
          }
          rows.commit.push(commitIds.get(sha)!);
          rows.symbol.push(symbolId);
          rows.additions.push(change.additions);
          rows.deletions.push(change.deletions);
          rows.type.push(change.changeType);
        }
      }
    }
    await client.query(
      `INSERT INTO modifies (commit_id, symbol_id, additions, deletions, change_type)
       SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::int[], $4::int[], $5::text[])`,
      [rows.commit, rows.symbol, rows.additions, rows.deletions, rows.type],
    );

    await client.query("COMMIT");
    return {
      commits: inserted.rowCount ?? 0,
      authors: new Set(commits.map(authorOf)).size,
      modifies: rows.commit.length,
      unmatched,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

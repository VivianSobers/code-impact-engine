import type { Metadata } from "next";
import Link from "next/link";
import { RepoFilter } from "@/components/history/RepoFilter";
import history from "@/components/history/history.module.css";
import { KindBadge } from "@/components/structure/badges";
import { Shell } from "@/components/structure/Shell";
import styles from "@/components/structure/structure.module.css";
import { MAX_QUERY, parseSearchQuery } from "@/lib/search/params";
import { searchByMeaning, type SearchResult } from "@/lib/search/semantic";
import { BadRequestError, encodePath, parseOptionalId } from "@/lib/structure/params";
import { listRepositories } from "@/lib/structure/repositories";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Search by meaning" };

const RESULTS = 20;

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const raw = await searchParams;
  const q = (raw.q ?? "").trim();
  let repoId: number | null = null;
  let results: SearchResult[] | null = null;
  let problem: string | null = null;
  try {
    repoId = parseOptionalId(raw.repo || null, "repo");
    if (q) results = await searchByMeaning(parseSearchQuery(q), { repoId, limit: RESULTS });
  } catch (error) {
    if (!(error instanceof BadRequestError)) throw error;
    problem = error.message;
  }
  const repositories = await listRepositories();

  return (
    <Shell section="search">
      <header className={styles.header}>
        <h1 className={styles.title}>Search by meaning</h1>
        <p className={styles.lede}>
          Describe what a piece of code does in plain words. Results are the functions and classes whose bodies are
          closest to the description, using the same code embedding model the ingest step used. Only repositories that
          have been embedded (npm run embed) are searched.
        </p>
      </header>

      <RepoFilter action="/search" repositories={repositories} repoId={repoId}>
        <label className={styles.field}>
          Description
          <input
            name="q"
            type="search"
            defaultValue={q}
            maxLength={MAX_QUERY}
            placeholder="parse the accept header"
            required
          />
        </label>
      </RepoFilter>

      {problem && <p className={styles.notice}>{problem}</p>}

      {results !== null &&
        (results.length === 0 ? (
          <p className={styles.empty}>No embedded symbols to search. Run npm run embed on a repository first.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Symbol</th>
                  <th scope="col">Where</th>
                  <th scope="col">Repository</th>
                  <th scope="col" className={history.num} title="Cosine similarity between the description and the symbol body">
                    Similarity
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.symbolId}>
                    <th scope="row">
                      <Link href={`/symbols/${r.symbolId}`} className={styles.mono}>
                        {r.name}
                      </Link>{" "}
                      <KindBadge kind={r.kind} />
                    </th>
                    <td>
                      <Link
                        href={`/repositories/${r.repoId}/files/${encodePath(r.path)}`}
                        className={styles.mono}
                      >
                        {r.path}:{r.startLine}-{r.endLine}
                      </Link>
                    </td>
                    <td>{r.repoName}</td>
                    <td className={history.num}>{r.similarity.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </Shell>
  );
}

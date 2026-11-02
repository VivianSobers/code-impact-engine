import type { Metadata } from "next";
import Link from "next/link";
import { RepoFilter } from "@/components/history/RepoFilter";
import history from "@/components/history/history.module.css";
import { Shell } from "@/components/structure/Shell";
import styles from "@/components/structure/structure.module.css";
import { parseCommitFilter } from "@/lib/history/params";
import { listCommitAuthors, listCommits } from "@/lib/history/queries";
import { COMMITS_PER_PAGE, type CommitFilter } from "@/lib/history/types";
import { formatDate, formatNumber, plural } from "@/lib/structure/format";
import { BadRequestError } from "@/lib/structure/params";
import { listRepositories } from "@/lib/structure/repositories";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Commits" };

function pageHref(filter: CommitFilter, page: number): string {
  const params = new URLSearchParams();
  if (filter.repoId) params.set("repo", String(filter.repoId));
  if (filter.authorId) params.set("author", String(filter.authorId));
  if (filter.q) params.set("q", filter.q);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/commits?${query}` : "/commits";
}

export default async function CommitsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const raw = await searchParams;
  let filter: CommitFilter;
  let problem: string | null = null;
  try {
    filter = parseCommitFilter(new URLSearchParams(Object.entries(raw).filter(([, v]) => v) as [string, string][]));
  } catch (error) {
    if (!(error instanceof BadRequestError)) throw error;
    problem = error.message;
    filter = { repoId: null, authorId: null, q: "", page: 1 };
  }

  const [repositories, authors, { commits, total }] = await Promise.all([
    listRepositories(),
    listCommitAuthors(filter.repoId),
    listCommits(filter),
  ]);
  const pages = Math.max(1, Math.ceil(total / COMMITS_PER_PAGE));

  return (
    <Shell section="commits">
      <header className={styles.header}>
        <h1 className={styles.title}>Commits</h1>
        <p className={styles.lede}>
          Every commit read from Git, with the symbols it changed. Search matches whole words in commit messages,
          including other forms of a word: rounding finds round.
        </p>
      </header>

      <RepoFilter action="/commits" repositories={repositories} repoId={filter.repoId}>
        <label className={styles.field}>
          Author
          <select name="author" defaultValue={filter.authorId ?? ""}>
            <option value="">Anyone</option>
            {authors.map((a) => (
              <option key={a.authorId} value={a.authorId}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Message contains
          <input name="q" type="search" defaultValue={filter.q} maxLength={200} placeholder="discount -test" />
        </label>
      </RepoFilter>

      {problem && <p className={styles.notice}>{problem}. Showing all commits instead.</p>}

      {commits.length === 0 ? (
        <p className={styles.empty}>
          {total === 0 ? "No commits match these filters." : `There is no page ${filter.page}; the last page is ${pages}.`}
        </p>
      ) : (
        <>
          <p className={styles.sectionHint}>{plural(total, "commit")}</p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Message</th>
                  <th scope="col">Author</th>
                  <th scope="col">Repository</th>
                  <th scope="col">Date</th>
                  <th scope="col" className={styles.num}>
                    Symbols
                  </th>
                  <th scope="col" className={styles.num}>
                    Lines
                  </th>
                </tr>
              </thead>
              <tbody>
                {commits.map((c) => (
                  <tr key={c.commitId}>
                    <th scope="row">
                      <Link href={`/commits/${c.commitId}`} className={history.message} title={c.message}>
                        {c.message.split("\n")[0]}
                      </Link>
                      <div className={`${styles.muted} ${styles.mono}`}>{c.sha.slice(0, 10)}</div>
                    </th>
                    <td>{c.authorName}</td>
                    <td>{c.repoName}</td>
                    <td>{formatDate(c.committedAt)}</td>
                    <td className={styles.num}>{formatNumber(c.symbols)}</td>
                    <td className={styles.num}>{formatNumber(c.churn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className={history.pager} aria-label="Pages">
            <span>
              Page {formatNumber(filter.page)} of {formatNumber(pages)}
            </span>
            <div>
              {filter.page > 1 && (
                <Link className={`${styles.button} ${styles.buttonQuiet}`} href={pageHref(filter, filter.page - 1)}>
                  Newer
                </Link>
              )}
              {filter.page < pages && (
                <Link className={`${styles.button} ${styles.buttonQuiet}`} href={pageHref(filter, filter.page + 1)}>
                  Older
                </Link>
              )}
            </div>
          </nav>
        </>
      )}
    </Shell>
  );
}

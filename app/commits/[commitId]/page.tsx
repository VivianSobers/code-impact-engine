import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import history from "@/components/history/history.module.css";
import { Shell, Trail } from "@/components/structure/Shell";
import styles from "@/components/structure/structure.module.css";
import { getCommit } from "@/lib/history/queries";
import { formatDate, formatNumber } from "@/lib/structure/format";
import { safeId } from "@/lib/structure/pageParams";

export const dynamic = "force-dynamic";

async function load(raw: string) {
  const commitId = safeId(raw);
  const found = commitId === null ? null : await getCommit(commitId);
  if (!found) notFound();
  return found;
}

export async function generateMetadata({ params }: { params: Promise<{ commitId: string }> }): Promise<Metadata> {
  const { commit } = await load((await params).commitId);
  return { title: commit.message.split("\n")[0].slice(0, 60) };
}

export default async function CommitPage({ params }: { params: Promise<{ commitId: string }> }) {
  const { commit, changes } = await load((await params).commitId);
  const [subject, ...rest] = commit.message.split("\n");
  const body = rest.join("\n").trim();

  return (
    <Shell section="commits">
      <Trail items={[{ href: "/commits", label: "Commits" }, { label: commit.sha.slice(0, 10) }]} />
      <header className={styles.header}>
        <h1 className={styles.title}>{subject}</h1>
        <p className={styles.lede}>
          {commit.authorName} committed to <Link href={`/repositories/${commit.repoId}`}>{commit.repoName}</Link> on{" "}
          {formatDate(commit.committedAt)}. <span className={styles.mono}>{commit.sha}</span>
        </p>
        {body && <pre className={styles.codeBlock}>{body}</pre>}
      </header>

      <section aria-labelledby="changes-heading">
        <h2 id="changes-heading" className={styles.sectionTitle}>
          Symbols changed
        </h2>
        {changes.length === 0 ? (
          <p className={styles.empty}>
            This commit changed no symbol that still exists: it touched other files, code that was later deleted or
            moved, or it is a merge.
          </p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Symbol</th>
                  <th scope="col">Change</th>
                  <th scope="col" className={styles.num}>
                    Added
                  </th>
                  <th scope="col" className={styles.num}>
                    Removed
                  </th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.symbolId}>
                    <th scope="row">
                      <Link href={`/symbols/${c.symbolId}`} className={styles.mono}>
                        {c.name}
                      </Link>{" "}
                      <span className={styles.muted}>{c.kind}</span>
                      <div className={`${styles.muted} ${styles.mono}`}>
                        {c.path}:{c.startLine}
                      </div>
                    </th>
                    <td>
                      <span className={`${history.badge} ${c.changeType === "added" ? history.badgeAdded : ""}`}>
                        {c.changeType === "added" ? "New" : "Changed"}
                      </span>
                    </td>
                    <td className={`${styles.num} ${c.additions ? history.added : styles.muted}`}>
                      {c.additions ? `+${formatNumber(c.additions)}` : "0"}
                    </td>
                    <td className={`${styles.num} ${c.deletions ? history.removed : styles.muted}`}>
                      {c.deletions ? `−${formatNumber(c.deletions)}` : "0"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Shell>
  );
}

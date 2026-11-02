import type { Metadata } from "next";
import Link from "next/link";
import clones from "@/components/clones/clones.module.css";
import { RepoFilter } from "@/components/history/RepoFilter";
import history from "@/components/history/history.module.css";
import { Shell } from "@/components/structure/Shell";
import styles from "@/components/structure/structure.module.css";
import { listClusters, parseClusterFilter } from "@/lib/clones/queries";
import { CLUSTER_STATUSES, CLUSTERS_PER_PAGE, type ClusterFilter, type ClusterStatus } from "@/lib/clones/types";
import { formatDate, formatNumber, plural } from "@/lib/structure/format";
import { BadRequestError } from "@/lib/structure/params";
import { listRepositories } from "@/lib/structure/repositories";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Clones" };

const TAB_LABELS: Record<ClusterStatus, string> = { open: "Open", confirmed: "Confirmed", dismissed: "Dismissed" };

function pageHref(filter: ClusterFilter, changes: Partial<ClusterFilter>): string {
  const next = { ...filter, ...changes };
  const params = new URLSearchParams();
  if (next.status !== "open") params.set("status", next.status);
  if (next.repoId) params.set("repo", String(next.repoId));
  if (next.page > 1) params.set("page", String(next.page));
  const query = params.toString();
  return query ? `/clones?${query}` : "/clones";
}

export default async function ClonesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const raw = await searchParams;
  let filter: ClusterFilter;
  let problem: string | null = null;
  try {
    filter = parseClusterFilter(new URLSearchParams(Object.entries(raw).filter(([, v]) => v) as [string, string][]));
  } catch (error) {
    if (!(error instanceof BadRequestError)) throw error;
    problem = error.message;
    filter = { status: "open", repoId: null, page: 1 };
  }

  const [repositories, { clusters, total }] = await Promise.all([listRepositories(), listClusters(filter)]);
  const pages = Math.max(1, Math.ceil(total / CLUSTERS_PER_PAGE));
  const reviewed = filter.status !== "open";

  return (
    <Shell section="clones">
      <header className={styles.header}>
        <h1 className={styles.title}>Clones</h1>
        <p className={styles.lede}>
          Groups of functions whose embeddings are near duplicates. An admin confirms a cluster as real duplication or
          dismisses it, and can waive members that are duplicated on purpose.
        </p>
      </header>

      <nav className={clones.tabs} aria-label="Review status">
        {CLUSTER_STATUSES.map((status) => (
          <Link
            key={status}
            href={pageHref(filter, { status, page: 1 })}
            aria-current={status === filter.status ? "page" : undefined}
          >
            {TAB_LABELS[status]}
          </Link>
        ))}
      </nav>

      <RepoFilter action="/clones" repositories={repositories} repoId={filter.repoId}>
        {reviewed && <input type="hidden" name="status" value={filter.status} />}
      </RepoFilter>

      {problem && <p className={styles.notice}>{problem}. Showing open clusters instead.</p>}

      {clusters.length === 0 ? (
        <p className={styles.empty}>
          {total === 0
            ? `No ${filter.status} clone clusters${filter.repoId ? " in this repository" : ""}.`
            : `There is no page ${filter.page}; the last page is ${pages}.`}
        </p>
      ) : (
        <>
          <p className={styles.sectionHint}>{plural(total, `${filter.status} cluster`)}</p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Cluster</th>
                  <th scope="col">Repository</th>
                  <th scope="col" className={styles.num}>
                    Members
                  </th>
                  <th scope="col" className={styles.num}>
                    Similarity
                  </th>
                  <th scope="col">Detected</th>
                  {reviewed && <th scope="col">Reviewed</th>}
                </tr>
              </thead>
              <tbody>
                {clusters.map((c) => (
                  <tr key={c.clusterId}>
                    <th scope="row">
                      <Link href={`/clones/${c.clusterId}`}>Cluster {c.clusterId}</Link>
                    </th>
                    <td>{c.repoName}</td>
                    <td className={styles.num}>{formatNumber(c.members)}</td>
                    <td className={styles.num}>{c.similarityScore.toFixed(3)}</td>
                    <td>{formatDate(c.createdAt)}</td>
                    {reviewed && (
                      <td>
                        {c.reviewedAt ? formatDate(c.reviewedAt) : ""}
                        {c.reviewer && <span className={styles.muted}> by {c.reviewer}</span>}
                      </td>
                    )}
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
                <Link
                  className={`${styles.button} ${styles.buttonQuiet}`}
                  href={pageHref(filter, { page: filter.page - 1 })}
                >
                  Previous
                </Link>
              )}
              {filter.page < pages && (
                <Link
                  className={`${styles.button} ${styles.buttonQuiet}`}
                  href={pageHref(filter, { page: filter.page + 1 })}
                >
                  Next
                </Link>
              )}
            </div>
          </nav>
        </>
      )}
    </Shell>
  );
}

import type { Metadata } from "next";
import { AuthorChurnChart } from "@/components/history/AuthorChurnChart";
import { HotspotTable } from "@/components/history/HotspotTable";
import { RepoFilter } from "@/components/history/RepoFilter";
import { StatTiles } from "@/components/history/StatTiles";
import history from "@/components/history/history.module.css";
import { Shell } from "@/components/structure/Shell";
import styles from "@/components/structure/structure.module.css";
import { getAuthorActivity, getHotspots, getSummary } from "@/lib/history/queries";
import { safeId } from "@/lib/structure/pageParams";
import { listRepositories } from "@/lib/structure/repositories";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ repo?: string }> }) {
  const repoId = safeId((await searchParams).repo ?? "");
  const [repositories, summary, hotspots, authors] = await Promise.all([
    listRepositories(),
    getSummary(repoId),
    getHotspots(repoId, 12),
    getAuthorActivity(repoId, 10),
  ]);

  return (
    <Shell section="dashboard">
      <header className={styles.header}>
        <h1 className={styles.title}>Dashboard</h1>
        <p className={styles.lede}>
          Where the code changes most, and who changes it. Counts come from commit history mapped onto the symbols of
          the current parse.
        </p>
      </header>

      <RepoFilter action="/dashboard" repositories={repositories} repoId={repoId} />
      <StatTiles summary={summary} />

      {summary.commits === 0 ? (
        <p className={`${styles.empty} ${styles.section}`}>
          No commit history yet. After parsing a repository, run <code>npm run history -- &lt;name&gt;</code> in{" "}
          <code>ingest/</code>.
        </p>
      ) : (
        <div className={`${history.split} ${styles.section}`}>
          <section aria-labelledby="hotspots-heading">
            <h2 id="hotspots-heading" className={styles.sectionTitle}>
              Most changed symbols
            </h2>
            <p className={styles.sectionHint}>Symbols changed in at least two commits, by lines added and removed.</p>
            {hotspots.length === 0 ? (
              <p className={styles.empty}>No symbol has been changed in more than one commit.</p>
            ) : (
              <HotspotTable hotspots={hotspots} />
            )}
          </section>
          <section aria-labelledby="authors-heading">
            <h2 id="authors-heading" className={styles.sectionTitle}>
              Changed lines by author
            </h2>
            <p className={styles.sectionHint}>Lines added or removed inside symbols, top {authors.length}.</p>
            <AuthorChurnChart authors={authors} />
          </section>
        </div>
      )}
    </Shell>
  );
}

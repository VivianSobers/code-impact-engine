import Link from "next/link";
import { AddRepositoryForm } from "@/components/structure/AddRepositoryForm";
import { Shell } from "@/components/structure/Shell";
import styles from "@/components/structure/structure.module.css";
import { formatDate, formatNumber } from "@/lib/structure/format";
import { listRepositories } from "@/lib/structure/repositories";

export const dynamic = "force-dynamic";
export const metadata = { title: "Repositories" };

export default async function RepositoriesPage() {
  const repositories = await listRepositories();

  return (
    <Shell section="repositories">
      <header className={styles.header}>
        <h1 className={styles.title}>Repositories</h1>
        <p className={styles.lede}>
          Each repository is cloned and parsed into files, symbols, calls and imports. Open one to browse its files, or start
          from a symbol to see what calls it.
        </p>
      </header>

      <section aria-labelledby="add-heading">
        <h2 id="add-heading" className={styles.sectionTitle}>
          Add a repository
        </h2>
        <AddRepositoryForm />
      </section>

      <section className={styles.section} aria-labelledby="list-heading">
        <h2 id="list-heading" className={styles.sectionTitle}>
          Parsed repositories
        </h2>
        {repositories.length === 0 ? (
          <p className={styles.empty}>No repositories yet. Add one above with its Git URL or a local path.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Repository</th>
                  <th scope="col">Languages</th>
                  <th scope="col" className={styles.num}>
                    Files
                  </th>
                  <th scope="col" className={styles.num}>
                    Lines
                  </th>
                  <th scope="col" className={styles.num}>
                    Symbols
                  </th>
                  <th scope="col" className={styles.num}>
                    Calls
                  </th>
                  <th scope="col">Added</th>
                </tr>
              </thead>
              <tbody>
                {repositories.map((r) => (
                  <tr key={r.repoId}>
                    <th scope="row">
                      <Link href={`/repositories/${r.repoId}`}>{r.name}</Link>
                      <span className={`${styles.sub} ${styles.mono}`}>
                        {r.url} on {r.defaultBranch}
                      </span>
                    </th>
                    <td>{r.languages.length > 0 ? r.languages.join(", ") : <span className={styles.muted}>none</span>}</td>
                    <td className={styles.num}>{formatNumber(r.fileCount)}</td>
                    <td className={styles.num}>{formatNumber(r.loc)}</td>
                    <td className={styles.num}>{formatNumber(r.symbolCount)}</td>
                    <td className={styles.num}>{formatNumber(r.callCount)}</td>
                    <td className={styles.nowrap}>{formatDate(r.addedDate)}</td>
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

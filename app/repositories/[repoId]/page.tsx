import { notFound } from "next/navigation";
import { AstStatsPanel } from "@/components/structure/AstStatsPanel";
import { FileTree } from "@/components/structure/FileTree";
import { Shell, Trail } from "@/components/structure/Shell";
import styles from "@/components/structure/structure.module.css";
import { formatDate, formatNumber } from "@/lib/structure/format";
import { idOrNotFound, safeId } from "@/lib/structure/pageParams";
import { getRepository, listFiles } from "@/lib/structure/repositories";

export async function generateMetadata({ params }: { params: Promise<{ repoId: string }> }) {
  const id = safeId((await params).repoId);
  const repo = id ? await getRepository(id) : null;
  return { title: repo ? repo.name : "Repository" };
}

export default async function RepositoryPage({ params }: { params: Promise<{ repoId: string }> }) {
  const repoId = idOrNotFound((await params).repoId, "repoId");
  const repo = await getRepository(repoId);
  if (!repo) notFound();
  const files = await listFiles(repoId);

  return (
    <Shell section="repositories">
      <header className={styles.header}>
        <Trail items={[{ href: "/repositories", label: "Repositories" }, { label: repo.name }]} />
        <h1 className={styles.title}>{repo.name}</h1>
        <p className={`${styles.lede} ${styles.mono}`}>
          {repo.url} on {repo.defaultBranch}
        </p>
        <dl className={styles.facts}>
          <div>
            <dt>Files</dt>
            <dd>{formatNumber(repo.fileCount)}</dd>
          </div>
          <div>
            <dt>Lines</dt>
            <dd>{formatNumber(repo.loc)}</dd>
          </div>
          <div>
            <dt>Symbols</dt>
            <dd>{formatNumber(repo.symbolCount)}</dd>
          </div>
          <div>
            <dt>Calls</dt>
            <dd>{formatNumber(repo.callCount)}</dd>
          </div>
          <div>
            <dt>Languages</dt>
            <dd>{repo.languages.join(", ") || "none"}</dd>
          </div>
          <div>
            <dt>Added</dt>
            <dd>{formatDate(repo.addedDate)}</dd>
          </div>
        </dl>
      </header>

      <div className={styles.withAside}>
        <section aria-labelledby="files-heading">
          <h2 id="files-heading" className={styles.sectionTitle}>
            Files
          </h2>
          {files.length === 0 ? (
            <p className={styles.empty}>The parser found no supported source files in this repository.</p>
          ) : (
            <FileTree files={files} repoId={repoId} />
          )}
        </section>

        <aside aria-labelledby="ast-heading">
          <h2 id="ast-heading" className={styles.sectionTitle}>
            Syntax trees
          </h2>
          <p className={styles.sectionHint}>Most common node types per language, from the stored ASTs.</p>
          <AstStatsPanel repoId={repoId} />
        </aside>
      </div>
    </Shell>
  );
}

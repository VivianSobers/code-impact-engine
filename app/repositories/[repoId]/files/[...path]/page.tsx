import Link from "next/link";
import { notFound } from "next/navigation";
import { EntryBadge, KindBadge } from "@/components/structure/badges";
import { Shell, Trail } from "@/components/structure/Shell";
import styles from "@/components/structure/structure.module.css";
import { getFile, listImportedBy, listImports, listSymbolsInFile } from "@/lib/structure/files";
import { formatNumber, shortHash } from "@/lib/structure/format";
import { idOrNotFound, pathOrNotFound } from "@/lib/structure/pageParams";
import { encodePath } from "@/lib/structure/params";
import type { ImportLink } from "@/lib/structure/types";

type Params = Promise<{ repoId: string; path: string[] }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { path } = await params;
  return { title: path.map(decodeURIComponent).join("/") };
}

function FileLinks({ links, empty }: { links: ImportLink[]; empty: string }) {
  if (links.length === 0) return <p className={styles.empty}>{empty}</p>;
  return (
    <ul className={styles.linkList}>
      {links.map((l) => (
        <li key={`${l.repoId}:${l.path}`}>
          <Link href={`/repositories/${l.repoId}/files/${encodePath(l.path)}`}>{l.path}</Link>
          <span className={styles.muted}>{l.language}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function FilePage({ params }: { params: Params }) {
  const raw = await params;
  const repoId = idOrNotFound(raw.repoId, "repoId");
  const path = pathOrNotFound(raw.path);
  const file = await getFile(repoId, path);
  if (!file) notFound();

  const [symbols, imports, importedBy] = await Promise.all([
    listSymbolsInFile(repoId, path),
    listImports(repoId, path),
    listImportedBy(repoId, path),
  ]);
  const declared = symbols.filter((s) => s.kind !== "module");
  const moduleSymbol = symbols.find((s) => s.kind === "module");

  return (
    <Shell section="repositories">
      <header className={styles.header}>
        <Trail
          items={[
            { href: "/repositories", label: "Repositories" },
            { href: `/repositories/${repoId}`, label: file.repoName },
            { label: path },
          ]}
        />
        <h1 className={styles.codeTitle}>{path}</h1>
        <dl className={styles.facts}>
          <div>
            <dt>Language</dt>
            <dd>{file.language}</dd>
          </div>
          <div>
            <dt>Lines</dt>
            <dd>{formatNumber(file.loc)}</dd>
          </div>
          <div>
            <dt>Symbols</dt>
            <dd>{formatNumber(declared.length)}</dd>
          </div>
          <div>
            <dt>Content hash</dt>
            <dd className={styles.mono} title={file.contentHash}>
              {shortHash(file.contentHash)}
            </dd>
          </div>
          <div>
            <dt>AST document</dt>
            <dd className={styles.mono}>{file.astDocId ?? "not stored"}</dd>
          </div>
        </dl>
        {moduleSymbol && (
          <div className={styles.actions}>
            <Link className={`${styles.button} ${styles.buttonQuiet}`} href={`/symbols/${moduleSymbol.symbolId}`}>
              Top-level code of this file
            </Link>
          </div>
        )}
      </header>

      <section aria-labelledby="symbols-heading">
        <h2 id="symbols-heading" className={styles.sectionTitle}>
          Declared symbols
        </h2>
        {declared.length === 0 ? (
          <p className={styles.empty}>This file declares no functions, classes or other symbols.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Symbol</th>
                  <th scope="col">Kind</th>
                  <th scope="col" className={styles.num}>
                    Lines
                  </th>
                  <th scope="col" className={styles.num}>
                    Length
                  </th>
                </tr>
              </thead>
              <tbody>
                {declared.map((s) => (
                  <tr key={s.symbolId}>
                    <th scope="row">
                      <Link className={styles.mono} href={`/symbols/${s.symbolId}`}>
                        {s.name}
                      </Link>{" "}
                      {s.isEntryPoint && <EntryBadge />}
                      {s.signature && <span className={styles.signature}>{s.signature}</span>}
                    </th>
                    <td>
                      <KindBadge kind={s.kind} />
                    </td>
                    <td className={styles.num}>
                      {s.startLine} to {s.endLine}
                    </td>
                    <td className={styles.num}>{formatNumber(s.length)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className={`${styles.split} ${styles.section}`}>
        <section aria-labelledby="imports-heading">
          <h2 id="imports-heading" className={styles.sectionTitle}>
            Imports
          </h2>
          <FileLinks links={imports} empty="This file imports no other files in the repository." />
        </section>
        <section aria-labelledby="imported-by-heading">
          <h2 id="imported-by-heading" className={styles.sectionTitle}>
            Imported by
          </h2>
          <FileLinks links={importedBy} empty="No other file in the repository imports this one." />
        </section>
      </div>
    </Shell>
  );
}

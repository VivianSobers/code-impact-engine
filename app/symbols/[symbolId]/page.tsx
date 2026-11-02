import Link from "next/link";
import { notFound } from "next/navigation";
import { EntryBadge, KindBadge } from "@/components/structure/badges";
import { CallTable } from "@/components/structure/CallTable";
import { Shell, Trail } from "@/components/structure/Shell";
import styles from "@/components/structure/structure.module.css";
import { formatNumber, plural } from "@/lib/structure/format";
import { idOrNotFound, safeId } from "@/lib/structure/pageParams";
import { encodePath } from "@/lib/structure/params";
import { getSymbol, listCallees, listCallers } from "@/lib/structure/symbols";

type Params = Promise<{ symbolId: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const id = safeId((await params).symbolId);
  const symbol = id ? await getSymbol(id) : null;
  return { title: symbol ? symbol.name : "Symbol" };
}

export default async function SymbolPage({ params }: { params: Params }) {
  const symbolId = idOrNotFound((await params).symbolId, "symbolId");
  const symbol = await getSymbol(symbolId);
  if (!symbol) notFound();
  const [callers, callees] = await Promise.all([listCallers(symbolId), listCallees(symbolId)]);
  const fileHref = `/repositories/${symbol.repoId}/files/${encodePath(symbol.path)}`;

  return (
    <Shell section="repositories">
      <header className={styles.header}>
        <Trail
          items={[
            { href: "/repositories", label: "Repositories" },
            { href: `/repositories/${symbol.repoId}`, label: symbol.repoName },
            { href: fileHref, label: symbol.path },
            { label: symbol.kind === "module" ? "top-level code" : symbol.name },
          ]}
        />
        <div className={styles.titleRow}>
          <h1 className={styles.codeTitle}>{symbol.name}</h1>
          <KindBadge kind={symbol.kind} />
          {symbol.isEntryPoint && <EntryBadge />}
        </div>
        {symbol.signature && <pre className={styles.codeBlock}>{symbol.signature}</pre>}
        <dl className={styles.facts}>
          <div>
            <dt>File</dt>
            <dd>
              <Link className={styles.mono} href={fileHref}>
                {symbol.path}
              </Link>
            </dd>
          </div>
          <div>
            <dt>Lines</dt>
            <dd>
              {symbol.startLine} to {symbol.endLine}
            </dd>
          </div>
          <div>
            <dt>Length</dt>
            <dd>{plural(symbol.length, "line")}</dd>
          </div>
          <div>
            <dt>Callers</dt>
            <dd>{formatNumber(callers.length)}</dd>
          </div>
          <div>
            <dt>Callees</dt>
            <dd>{formatNumber(callees.length)}</dd>
          </div>
          {symbol.clusterId != null && (
            <div>
              <dt>Clone cluster</dt>
              <dd>{symbol.clusterId}</dd>
            </div>
          )}
        </dl>
      </header>

      <div className={styles.split}>
        <section aria-labelledby="callers-heading">
          <h2 id="callers-heading" className={styles.sectionTitle}>
            Called by
          </h2>
          <CallTable edges={callers} empty="Nothing in the repository calls this symbol." />
        </section>
        <section aria-labelledby="callees-heading">
          <h2 id="callees-heading" className={styles.sectionTitle}>
            Calls
          </h2>
          <CallTable edges={callees} empty="This symbol makes no calls the parser could resolve." />
        </section>
      </div>
    </Shell>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { KindBadge } from "@/components/structure/badges";
import { CallGraphView } from "@/components/structure/CallGraphView";
import graphStyles from "@/components/structure/callGraph.module.css";
import { Shell, Trail } from "@/components/structure/Shell";
import styles from "@/components/structure/structure.module.css";
import { plural } from "@/lib/structure/format";
import { GRAPH_MAX_DEPTH, getCallGraph } from "@/lib/structure/graph";
import { idOrNotFound, safeId } from "@/lib/structure/pageParams";
import { encodePath } from "@/lib/structure/params";
import { getSymbol } from "@/lib/structure/symbols";

const NODE_LIMIT = 80;

type Params = Promise<{ symbolId: string }>;
type Search = Promise<{ depth?: string | string[] }>;

export async function generateMetadata({ params }: { params: Params }) {
  const id = safeId((await params).symbolId);
  const symbol = id ? await getSymbol(id) : null;
  return { title: symbol ? `Call graph of ${symbol.name}` : "Call graph" };
}

function depthFrom(raw: string | string[] | undefined): number {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(value) && value >= 1 && value <= GRAPH_MAX_DEPTH ? value : 2;
}

export default async function CallGraphPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const symbolId = idOrNotFound((await params).symbolId, "symbolId");
  const depth = depthFrom((await searchParams).depth);
  const symbol = await getSymbol(symbolId);
  if (!symbol) notFound();
  const data = await getCallGraph(symbolId, depth, NODE_LIMIT);
  const others = data.nodes.filter((n) => n.symbolId !== symbolId).sort((a, b) => a.column - b.column || a.name.localeCompare(b.name));

  return (
    <Shell section="repositories">
      <header className={styles.header}>
        <Trail
          items={[
            { href: "/repositories", label: "Repositories" },
            { href: `/repositories/${symbol.repoId}`, label: symbol.repoName },
            { href: `/repositories/${symbol.repoId}/files/${encodePath(symbol.path)}`, label: symbol.path },
            { href: `/symbols/${symbol.symbolId}`, label: symbol.kind === "module" ? "top-level code" : symbol.name },
            { label: "call graph" },
          ]}
        />
        <div className={styles.titleRow}>
          <h1 className={styles.codeTitle}>{symbol.name}</h1>
          <KindBadge kind={symbol.kind} />
        </div>
        <p className={styles.lede}>
          Callers are on the left and callees on the right, up to {plural(depth, "call")} away. Select a box to recentre
          the graph on that symbol.
        </p>
      </header>

      <form className={graphStyles.controls} method="get">
        <label className={styles.field}>
          Steps in each direction
          <select name="depth" defaultValue={String(depth)}>
            {Array.from({ length: GRAPH_MAX_DEPTH }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={`${styles.button} ${styles.buttonQuiet}`}>
          Redraw
        </button>
        <Link className={styles.button} href={`/impact?symbol=${symbol.symbolId}`}>
          Analyse impact
        </Link>
      </form>

      {others.length === 0 ? (
        <p className={styles.empty}>This symbol has no resolved callers or callees, so there is no graph to draw.</p>
      ) : (
        <>
          <CallGraphView data={data} title={`Call graph around ${symbol.name}`} />
          <ul className={graphStyles.legend}>
            <li>
              <span className={graphStyles.swatch} aria-hidden="true" /> resolved call, confidence 1.00
            </li>
            <li>
              <span className={`${graphStyles.swatch} ${graphStyles.swatchFaint}`} aria-hidden="true" /> lower confidence
              match
            </li>
            <li>
              <span className={`${graphStyles.swatch} ${graphStyles.swatchBack}`} aria-hidden="true" /> call back toward
              the centre, or recursion
            </li>
            <li>
              <span className={`${graphStyles.swatch} ${graphStyles.swatchEntry}`} aria-hidden="true" /> entry point
            </li>
          </ul>
          {data.hidden > 0 && (
            <p className={`${styles.notice} ${styles.section}`}>
              {plural(data.hidden, "more symbol")} at this distance are not drawn. Lower the number of steps or recentre on
              a closer symbol.
            </p>
          )}

          <details className={styles.section}>
            <summary>List the {plural(others.length, "symbol")} in this graph</summary>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Symbol</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Position</th>
                  </tr>
                </thead>
                <tbody>
                  {others.map((n) => (
                    <tr key={n.symbolId}>
                      <th scope="row">
                        <Link className={styles.mono} href={`/symbols/${n.symbolId}`}>
                          {n.name}
                        </Link>
                        <span className={`${styles.sub} ${styles.mono}`}>{n.path}</span>
                      </th>
                      <td>
                        <KindBadge kind={n.kind} />
                      </td>
                      <td>
                        {n.column < 0 ? `caller, ${plural(-n.column, "step")} away` : `callee, ${plural(n.column, "step")} away`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </Shell>
  );
}

import Link from "next/link";
import { encodePath } from "@/lib/structure/params";
import type { CallEdge } from "@/lib/structure/types";
import { Confidence, EntryBadge, KindBadge } from "./badges";
import styles from "./structure.module.css";

export function CallTable({ edges, empty }: { edges: CallEdge[]; empty: string }) {
  if (edges.length === 0) return <p className={styles.empty}>{empty}</p>;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Symbol</th>
            <th scope="col">Kind</th>
            <th scope="col" className={styles.num}>
              Call line
            </th>
            <th scope="col" className={styles.num}>
              Confidence
            </th>
          </tr>
        </thead>
        <tbody>
          {edges.map((e) => (
            <tr key={`${e.symbol.symbolId}:${e.callLine}`}>
              <th scope="row">
                <Link className={styles.mono} href={`/symbols/${e.symbol.symbolId}`}>
                  {e.symbol.name}
                </Link>{" "}
                {e.symbol.isEntryPoint && <EntryBadge />}
                <Link className={`${styles.sub} ${styles.mono}`} href={`/repositories/${e.symbol.repoId}/files/${encodePath(e.symbol.path)}`}>
                  {e.symbol.path}
                </Link>
              </th>
              <td>
                <KindBadge kind={e.symbol.kind} />
              </td>
              <td className={styles.num}>{e.callLine}</td>
              <td className={styles.num}>
                <Confidence value={e.confidence} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import Link from "next/link";
import styles from "@/components/structure/structure.module.css";
import type { Hotspot } from "@/lib/history/types";
import { formatDate, formatNumber } from "@/lib/structure/format";
import history from "./history.module.css";

export function HotspotTable({ hotspots }: { hotspots: Hotspot[] }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Symbol</th>
            <th scope="col" className={styles.num}>
              Commits
            </th>
            <th scope="col" className={styles.num}>
              Authors
            </th>
            <th scope="col" className={styles.num}>
              Lines changed
            </th>
            <th scope="col">Last changed</th>
          </tr>
        </thead>
        <tbody>
          {hotspots.map((h) => (
            <tr key={h.symbolId}>
              <th scope="row">
                <Link href={`/symbols/${h.symbolId}`} className={styles.mono}>
                  {h.name}
                </Link>
                <div className={`${styles.muted} ${styles.mono}`}>{h.path}</div>
              </th>
              <td className={styles.num}>{formatNumber(h.commits)}</td>
              <td className={styles.num}>{formatNumber(h.authors)}</td>
              <td className={styles.num}>
                {formatNumber(h.churn)}{" "}
                <span className={styles.muted}>
                  (<span className={history.added}>+{formatNumber(h.additions)}</span>{" "}
                  <span className={history.removed}>−{formatNumber(h.deletions)}</span>)
                </span>
              </td>
              <td>{formatDate(h.lastChanged)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

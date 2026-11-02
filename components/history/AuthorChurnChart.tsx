import styles from "@/components/structure/structure.module.css";
import type { AuthorActivity } from "@/lib/history/types";
import { formatDate, formatNumber, plural } from "@/lib/structure/format";
import history from "./history.module.css";

// Ranked horizontal bars of changed lines per author, largest first. Every value is
// at its bar's tip, the hover/focus tooltip adds commits and dates, and the same
// numbers are in the table below the chart.
export function AuthorChurnChart({ authors }: { authors: AuthorActivity[] }) {
  const max = Math.max(1, ...authors.map((a) => a.churn));
  return (
    <figure style={{ margin: 0 }}>
      <ol className={history.chart} aria-label="Changed lines inside symbols, per author">
        {authors.map((a) => (
          <li
            key={a.authorId}
            className={history.barRow}
            tabIndex={0}
            aria-label={`${a.name}: ${formatNumber(a.churn)} changed lines in ${plural(a.commits, "commit")}`}
          >
            <span className={history.barName} title={a.name}>
              {a.name}
            </span>
            <span className={history.barTrack} aria-hidden="true">
              <span className={history.bar} style={{ width: `${(a.churn / max) * 100}%` }} />
            </span>
            <span className={history.barValue} aria-hidden="true">
              {formatNumber(a.churn)}
            </span>
            <span className={history.tooltip} aria-hidden="true">
              <strong>{formatNumber(a.churn)} lines</strong> · {plural(a.commits, "commit")}
              <br />
              {a.name}
              {a.company ? `, ${a.company}` : ""}
              <br />
              {formatDate(a.firstCommit)} – {formatDate(a.lastCommit)}
            </span>
          </li>
        ))}
      </ol>
      <details className={history.tableToggle}>
        <summary>Show as a table</summary>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Author</th>
                <th scope="col">Company</th>
                <th scope="col" className={styles.num}>
                  Commits
                </th>
                <th scope="col" className={styles.num}>
                  Changed lines
                </th>
                <th scope="col">First commit</th>
                <th scope="col">Last commit</th>
              </tr>
            </thead>
            <tbody>
              {authors.map((a) => (
                <tr key={a.authorId}>
                  <th scope="row">{a.name}</th>
                  <td>{a.company ?? <span className={styles.muted}>none</span>}</td>
                  <td className={styles.num}>{formatNumber(a.commits)}</td>
                  <td className={styles.num}>{formatNumber(a.churn)}</td>
                  <td>{formatDate(a.firstCommit)}</td>
                  <td>{formatDate(a.lastCommit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

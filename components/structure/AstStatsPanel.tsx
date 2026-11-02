import Link from "next/link";
import { getAstStats } from "@/lib/structure/ast";
import { formatNumber, percent } from "@/lib/structure/format";
import { encodePath } from "@/lib/structure/params";
import panel from "./astStats.module.css";
import styles from "./structure.module.css";

export async function AstStatsPanel({ repoId }: { repoId: number }) {
  let stats;
  try {
    stats = await getAstStats(repoId, { typesPerLanguage: 6, deepest: 6 });
  } catch (error) {
    console.error(error);
    return <p className={styles.notice}>The syntax tree store could not be reached, so AST statistics are not shown.</p>;
  }

  if (stats.byLanguage.length === 0) {
    return <p className={styles.empty}>No syntax trees are stored for this repository.</p>;
  }

  return (
    <div className={panel.panel}>
      {stats.byLanguage.map((lang) => {
        const top = Math.max(...lang.top_types.map((t) => t.count), 1);
        return (
          <section key={lang.language} aria-labelledby={`ast-${lang.language}`} className={panel.language}>
            <h3 id={`ast-${lang.language}`} className={panel.heading}>
              <span className={panel.languageName}>{lang.language}</span>
              <span className={panel.meta}>
                {formatNumber(lang.total_nodes)} nodes, {formatNumber(lang.distinct_types)} node types
              </span>
            </h3>
            <ol className={panel.bars}>
              {lang.top_types.map((t) => (
                <li key={t.type}>
                  <span className={panel.type}>{t.type}</span>
                  <span className={panel.track} aria-hidden="true">
                    <span className={panel.fill} style={{ width: `${Math.max((t.count / top) * 100, 1.5)}%` }} />
                  </span>
                  <span className={panel.value} title={`${formatNumber(t.count)} nodes in ${formatNumber(t.files)} files`}>
                    {percent(t.share)}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        );
      })}

      <section aria-labelledby="ast-deepest" className={panel.language}>
        <h3 id="ast-deepest" className={panel.heading}>
          Deepest nesting
        </h3>
        <ol className={panel.deep}>
          {stats.deepest.map((d) => (
            <li key={d.path}>
              <Link href={`/repositories/${repoId}/files/${encodePath(d.path)}`}>{d.path}</Link>
              <span className={panel.meta}>
                depth {d.max_depth}
                {d.deepest_node.line != null && `, ${d.deepest_node.type} at line ${d.deepest_node.line}`}
                {d.truncated && ", tree truncated"}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

import type { SymbolKind } from "@/lib/structure/types";
import styles from "./structure.module.css";

export function KindBadge({ kind }: { kind: SymbolKind }) {
  return <span className={`${styles.kind} ${styles[`kind_${kind}`]}`}>{kind}</span>;
}

export function EntryBadge() {
  return (
    <span className={styles.entry} title="Called from outside the repository, for example a route handler, main or an exported API">
      entry point
    </span>
  );
}

export function Confidence({ value }: { value: number }) {
  const level = value >= 0.85 ? "high" : value >= 0.6 ? "medium" : "low";
  return (
    <span className={`${styles.confidence} ${styles[`confidence_${level}`]}`} title={`Resolution confidence ${value.toFixed(2)}`}>
      {value.toFixed(2)}
    </span>
  );
}

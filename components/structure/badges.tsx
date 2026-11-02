import type { SymbolKind } from "@/lib/structure/types";
import styles from "./structure.module.css";

const KIND_ICONS: Record<string, string> = {
  function: "◈",
  method: "⬡",
  class: "◇",
  interface: "⬨",
  enum: "⬞",
  module: "▦",
};

export function KindBadge({ kind }: { kind: SymbolKind }) {
  const icon = KIND_ICONS[kind] ?? "◈";
  return (
    <span className={`${styles.kind} ${styles[`kind_${kind}`]}`}>
      <span className={styles.kindIcon} aria-hidden="true">{icon}</span>
      <span>{kind}</span>
    </span>
  );
}

export function EntryBadge() {
  return (
    <span className={styles.entry} title="Called from outside the repository, for example a route handler, main or an exported API">
      <span aria-hidden="true">⚡</span> entry point
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

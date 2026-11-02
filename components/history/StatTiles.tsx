import Link from "next/link";
import type { HistorySummary } from "@/lib/history/types";
import { formatNumber } from "@/lib/structure/format";
import history from "./history.module.css";

export function StatTiles({ summary }: { summary: HistorySummary }) {
  const tiles: { label: string; value: number; href?: string }[] = [
    { label: "Repositories", value: summary.repositories, href: "/repositories" },
    { label: "Commits", value: summary.commits, href: "/commits" },
    { label: "Authors", value: summary.authors },
    { label: "Symbols changed", value: summary.symbolsChanged },
    { label: "Open clone clusters", value: summary.openClusters, href: "/clones" },
  ];
  return (
    <dl className={history.tiles}>
      {tiles.map((t) => (
        <div key={t.label} className={history.tile}>
          <dt>{t.label}</dt>
          <dd>{t.href ? <Link href={t.href}>{formatNumber(t.value)}</Link> : formatNumber(t.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

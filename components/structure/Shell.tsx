import Link from "next/link";
import type { ReactNode } from "react";
import { plexMono, plexSans } from "./fonts";
import styles from "./structure.module.css";

export type Section = "repositories" | "impact";

const SECTIONS: { id: Section; href: string; label: string }[] = [
  { id: "repositories", href: "/repositories", label: "Repositories" },
  { id: "impact", href: "/impact", label: "Impact analysis" },
];

export function Shell({ section, children }: { section?: Section; children: ReactNode }) {
  return (
    <div className={`${plexSans.variable} ${plexMono.variable} ${styles.shell}`}>
      <header className={styles.bar}>
        <Link href="/repositories" className={styles.brand}>
          Code impact engine
        </Link>
        <nav aria-label="Code structure" className={styles.sectionNav}>
          {SECTIONS.map((s) => (
            <Link key={s.id} href={s.href} aria-current={s.id === section ? "page" : undefined}>
              {s.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}

export function Trail({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className={styles.trail}>
      <ol>
        {items.map((item, i) => (
          <li key={`${i}-${item.label}`}>
            {item.href ? <Link href={item.href}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

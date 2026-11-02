import Link from "next/link";
import type { ReactNode } from "react";
import { UserMenu } from "@/components/app/UserMenu";
import { getCurrentUser } from "@/lib/auth/current";
import { plexMono, plexSans } from "./fonts";
import styles from "./structure.module.css";

export type Section = "dashboard" | "repositories" | "impact" | "commits" | "search" | "clones" | "users";

const SECTIONS: { id: Section; href: string; label: string; adminOnly?: boolean }[] = [
  { id: "dashboard", href: "/dashboard", label: "Dashboard" },
  { id: "repositories", href: "/repositories", label: "Repositories" },
  { id: "impact", href: "/impact", label: "Impact analysis" },
  { id: "commits", href: "/commits", label: "Commits" },
  { id: "search", href: "/search", label: "Search" },
  { id: "clones", href: "/clones", label: "Clones" },
  { id: "users", href: "/admin/users", label: "Users", adminOnly: true },
];

export async function Shell({ section, children }: { section?: Section; children: ReactNode }) {
  const user = await getCurrentUser();
  return (
    <div className={`${plexSans.variable} ${plexMono.variable} ${styles.shell}`}>
      <header className={styles.bar}>
        <Link href="/dashboard" className={styles.brand}>
          <span className={styles.brandBadge} aria-hidden="true">⚡</span>
          <span className={styles.brandName}>Code Impact Engine</span>
        </Link>
        <nav aria-label="Sections" className={styles.sectionNav}>
          {SECTIONS.filter((s) => !s.adminOnly || user?.role === "admin").map((s) => (
            <Link key={s.id} href={s.href} aria-current={s.id === section ? "page" : undefined}>
              {s.label}
            </Link>
          ))}
        </nav>
        {user && <UserMenu user={user} />}
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

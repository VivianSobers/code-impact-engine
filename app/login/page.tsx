import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/app/LoginForm";
import auth from "@/components/app/auth.module.css";
import { plexMono, plexSans } from "@/components/structure/fonts";
import styles from "@/components/structure/structure.module.css";
import { safeNext } from "@/lib/auth/access";
import { getCurrentUser } from "@/lib/auth/current";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await getCurrentUser()) redirect(next);
  return (
    <div className={`${plexSans.variable} ${plexMono.variable} ${styles.shell} ${auth.page}`}>
      <main className={auth.card}>
        <p className={auth.brand}>Code impact engine</p>
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.lede}>Accounts are created by an admin.</p>
        <LoginForm next={next} />
      </main>
    </div>
  );
}

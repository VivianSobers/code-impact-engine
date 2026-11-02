import type { ReactNode } from "react";
import styles from "@/components/structure/structure.module.css";
import history from "./history.module.css";

// A plain GET form, so the filtered page has a shareable URL and works without JavaScript.
export function RepoFilter({
  action,
  repositories,
  repoId,
  children,
}: {
  action: string;
  repositories: { repoId: number; name: string }[];
  repoId: number | null;
  children?: ReactNode;
}) {
  return (
    <form method="get" action={action} className={history.filters} aria-label="Filters">
      <label className={styles.field}>
        Repository
        <select name="repo" defaultValue={repoId ?? ""}>
          <option value="">All repositories</option>
          {repositories.map((r) => (
            <option key={r.repoId} value={r.repoId}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {children}
      <button type="submit" className={`${styles.button} ${styles.buttonQuiet}`}>
        Apply
      </button>
    </form>
  );
}

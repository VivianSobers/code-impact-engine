import type { SessionUser } from "@/lib/auth/session";
import styles from "@/components/structure/structure.module.css";
import menu from "./userMenu.module.css";

export function UserMenu({ user }: { user: SessionUser }) {
  return (
    <div className={menu.menu}>
      <span>
        {user.username} <span className={styles.muted}>({user.role})</span>
      </span>
      <form action="/logout" method="post">
        <button type="submit" className={`${styles.button} ${styles.buttonQuiet} ${menu.signOut}`}>
          Sign out
        </button>
      </form>
    </div>
  );
}

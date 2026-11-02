import type { SessionUser } from "@/lib/auth/session";
import styles from "@/components/structure/structure.module.css";
import menu from "./userMenu.module.css";

export function UserMenu({ user }: { user: SessionUser }) {
  const initial = user.username ? user.username.charAt(0).toUpperCase() : "U";
  return (
    <div className={menu.menu}>
      <div className={menu.userChip}>
        <span className={menu.avatar} aria-hidden="true">{initial}</span>
        <span className={menu.username}>{user.username}</span>
        <span className={`${menu.roleBadge} ${menu[`role_${user.role}`]}`}>
          {user.role}
        </span>
      </div>
      <form action="/logout" method="post">
        <button type="submit" className={`${styles.button} ${styles.buttonQuiet} ${menu.signOut}`}>
          Sign out
        </button>
      </form>
    </div>
  );
}

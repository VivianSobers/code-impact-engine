import type { Metadata } from "next";
import { AddUserForm } from "@/components/app/AddUserForm";
import { Shell } from "@/components/structure/Shell";
import styles from "@/components/structure/structure.module.css";
import { requireUser } from "@/lib/auth/current";
import { listUsers } from "@/lib/auth/users";

export const metadata: Metadata = { title: "Users" };

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

export default async function UsersPage() {
  await requireUser("admin");
  const users = await listUsers();
  return (
    <Shell section="users">
      <header className={styles.header}>
        <h1 className={styles.title}>Users</h1>
        <p className={styles.lede}>
          Developers can browse everything. Admins can also add repositories, review clone clusters and add users.
        </p>
      </header>
      <AddUserForm />
      <section className={styles.section} aria-labelledby="user-list">
        <h2 id="user-list" className={styles.sectionTitle}>
          {users.length} {users.length === 1 ? "user" : "users"}
        </h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Username</th>
                <th scope="col">Role</th>
                <th scope="col">Added</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.userId}>
                  <th scope="row" className={styles.mono}>
                    {u.username}
                  </th>
                  <td>{u.role === "admin" ? "Admin" : "Developer"}</td>
                  <td>{dateFormat.format(new Date(u.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Shell>
  );
}

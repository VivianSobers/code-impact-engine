"use client";

import { useActionState } from "react";
import { addUser, type CreateUserState } from "@/app/admin/users/actions";
import styles from "@/components/structure/structure.module.css";
import form from "./addUser.module.css";

export function AddUserForm() {
  const [state, action, pending] = useActionState<CreateUserState, FormData>(addUser, { status: "idle" });
  const failed = state.status === "error" ? state : null;
  return (
    <form action={action} className={form.form} aria-describedby="add-user-status">
      <div className={form.fields} key={state.status === "created" ? state.username : "form"}>
        <label className={styles.field}>
          Username
          <input name="username" required autoComplete="off" defaultValue={failed?.username ?? ""} />
        </label>
        <label className={styles.field}>
          Password
          <input name="password" type="password" required minLength={10} autoComplete="new-password" />
        </label>
        <label className={styles.field}>
          Role
          <select name="role" defaultValue={failed?.role || "developer"}>
            <option value="developer">Developer</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button type="submit" className={styles.button} disabled={pending}>
          Add user
        </button>
      </div>
      <div id="add-user-status" role="status" aria-live="polite" className={form.status}>
        {state.status === "created" && <p className={form.success}>Added {state.username}.</p>}
        {failed && <p className={styles.notice}>{failed.message}</p>}
      </div>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/app/login/actions";
import styles from "@/components/structure/structure.module.css";
import auth from "./auth.module.css";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, { error: null, username: "" });
  return (
    <form action={action} className={auth.form} aria-describedby="login-status">
      <input type="hidden" name="next" value={next} />
      <label className={styles.field}>
        Username
        <input name="username" autoComplete="username" required defaultValue={state.username} autoFocus />
      </label>
      <label className={styles.field}>
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <div id="login-status" role="status" aria-live="polite">
        {state.error && <p className={styles.notice}>{state.error}</p>}
      </div>
      <button type="submit" className={styles.button} disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

"use client";

import Link from "next/link";
import { useActionState } from "react";
import { addRepository, type AddRepositoryState } from "@/app/repositories/actions";
import { plural } from "@/lib/structure/format";
import form from "./addRepository.module.css";
import styles from "./structure.module.css";

const initial: AddRepositoryState = { status: "idle" };

export function AddRepositoryForm() {
  const [state, action, pending] = useActionState(addRepository, initial);
  const values = state.status === "error" ? state.values : undefined;
  const resetKey = state.status === "success" ? `ok-${state.summary.repoId}` : state.status;

  return (
    <form action={action} className={form.form} aria-describedby="add-repo-status">
      <div className={form.fields} key={resetKey}>
        <label className={`${styles.field} ${form.source}`}>
          Git URL or local path
          <input
            name="source"
            required
            maxLength={500}
            placeholder="https://github.com/owner/project.git"
            defaultValue={values?.source}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className={styles.field}>
          Display name
          <input name="name" maxLength={100} placeholder="Taken from the URL" defaultValue={values?.name} />
        </label>
        <label className={styles.field}>
          Branch
          <input name="branch" maxLength={200} placeholder="Default branch" defaultValue={values?.branch} spellCheck={false} />
        </label>
        <button type="submit" className={styles.button} disabled={pending}>
          {pending ? "Parsing" : "Add repository"}
        </button>
      </div>

      <div id="add-repo-status" role="status" aria-live="polite" className={form.status}>
        {pending && <p className={form.pending}>Cloning and parsing. Large repositories can take a few minutes.</p>}
        {!pending && state.status === "success" && (
          <p className={form.success}>
            Added <Link href={`/repositories/${state.summary.repoId}`}>{state.summary.name}</Link> with {state.summary.files}{" "}
            files, {state.summary.symbols} symbols, {state.summary.calls} calls and {state.summary.imports} imports in{" "}
            {(state.summary.durationMs / 1000).toFixed(1)} s.
            {state.summary.skipped > 0 &&
              ` ${plural(state.summary.skipped, "file")} ${state.summary.skipped === 1 ? "was" : "were"} skipped.`}
          </p>
        )}
        {!pending && state.status === "error" && (
          <div className={form.error}>
            <p>{state.message}</p>
            {state.log && (
              <details>
                <summary>Parser output</summary>
                <pre>{state.log}</pre>
              </details>
            )}
          </div>
        )}
      </div>
    </form>
  );
}

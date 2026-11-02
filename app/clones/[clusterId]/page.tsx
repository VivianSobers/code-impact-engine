import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import clones from "@/components/clones/clones.module.css";
import history from "@/components/history/history.module.css";
import { Shell, Trail } from "@/components/structure/Shell";
import styles from "@/components/structure/structure.module.css";
import { getCurrentUser } from "@/lib/auth/current";
import { getCluster } from "@/lib/clones/queries";
import { formatDate, formatNumber } from "@/lib/structure/format";
import { safeId } from "@/lib/structure/pageParams";
import { reviewClusterAction } from "./actions";

export const dynamic = "force-dynamic";

async function load(raw: string) {
  const clusterId = safeId(raw);
  const found = clusterId === null ? null : await getCluster(clusterId);
  if (!found) notFound();
  return found;
}

export async function generateMetadata({ params }: { params: Promise<{ clusterId: string }> }): Promise<Metadata> {
  const { cluster } = await load((await params).clusterId);
  return { title: `Clone cluster ${cluster.clusterId}` };
}

export default async function ClonePage({
  params,
  searchParams,
}: {
  params: Promise<{ clusterId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ cluster, members }, user, { error }] = await Promise.all([
    load((await params).clusterId),
    getCurrentUser(),
    searchParams,
  ]);
  const canReview = user?.role === "admin" && cluster.status === "open";
  const formId = "review-form";

  return (
    <Shell section="clones">
      <Trail
        items={[
          { href: cluster.status === "open" ? "/clones" : `/clones?status=${cluster.status}`, label: "Clones" },
          { label: `Cluster ${cluster.clusterId}` },
        ]}
      />
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>Clone cluster {cluster.clusterId}</h1>
          <span className={`${history.badge} ${cluster.status === "confirmed" ? history.badgeAdded : ""}`}>
            {cluster.status}
          </span>
        </div>
        <dl className={styles.facts}>
          <div>
            <dt>Repository</dt>
            <dd>{cluster.repoName || "None"}</dd>
          </div>
          <div>
            <dt>Members</dt>
            <dd>{formatNumber(cluster.members)}</dd>
          </div>
          <div>
            <dt>Similarity</dt>
            <dd>{cluster.similarityScore.toFixed(3)}</dd>
          </div>
          <div>
            <dt>Detected</dt>
            <dd>{formatDate(cluster.createdAt)}</dd>
          </div>
          {cluster.reviewedAt && (
            <div>
              <dt>Reviewed</dt>
              <dd>
                {formatDate(cluster.reviewedAt)}
                {cluster.reviewer && ` by ${cluster.reviewer}`}
              </dd>
            </div>
          )}
        </dl>
      </header>

      {error && (
        <p className={styles.notice} role="alert">
          {error.slice(0, 300)}
        </p>
      )}

      <section aria-labelledby="members-heading" className={styles.section}>
        <h2 id="members-heading" className={styles.sectionTitle}>
          Members
        </h2>
        {members.length === 0 ? (
          <p className={styles.empty}>This cluster has no members left; its symbols were removed by a later parse.</p>
        ) : (
          <div className={clones.members}>
            {members.map((m) => (
              <article key={m.symbolId} className={clones.member}>
                <header className={clones.memberHead}>
                  <div>
                    <Link href={`/symbols/${m.symbolId}`} className={styles.mono}>
                      {m.name}
                    </Link>{" "}
                    <span className={styles.muted}>{m.kind}</span>
                    {m.waived && <span className={history.badge}>waived</span>}
                  </div>
                  <div className={`${styles.muted} ${styles.mono}`}>
                    {m.path}:{m.startLine}-{m.endLine}
                  </div>
                  {canReview && (
                    <label className={clones.waive}>
                      <input type="checkbox" name="waive" value={m.symbolId} form={formId} defaultChecked={m.waived} />
                      Waive: duplicated on purpose
                    </label>
                  )}
                </header>
                {m.source === null ? (
                  <p className={clones.missing}>The file is not in the checkout, so its source cannot be shown.</p>
                ) : (
                  <pre className={clones.source}>{m.source}</pre>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {canReview ? (
        <section aria-labelledby="review-heading" className={styles.section}>
          <h2 id="review-heading" className={styles.sectionTitle}>
            Review
          </h2>
          <form id={formId} action={reviewClusterAction.bind(null, cluster.clusterId)} className={clones.review}>
            <label className={styles.field}>
              Reason (needed when waiving members)
              <textarea name="reason" rows={3} maxLength={500} className={clones.reason} />
            </label>
            <div className={styles.actions}>
              <button type="submit" name="status" value="confirmed" className={styles.button}>
                Confirm duplicate
              </button>
              <button type="submit" name="status" value="dismissed" className={`${styles.button} ${styles.buttonQuiet}`}>
                Dismiss
              </button>
            </div>
          </form>
        </section>
      ) : (
        cluster.status === "open" && (
          <p className={`${styles.sectionHint} ${styles.section}`}>Only admins can confirm or dismiss clone clusters.</p>
        )
      )}
    </Shell>
  );
}

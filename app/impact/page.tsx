import Link from "next/link";
import { Confidence, EntryBadge, KindBadge } from "@/components/structure/badges";
import { ImpactView } from "@/components/structure/ImpactView";
import impactStyles from "@/components/structure/impact.module.css";
import { Shell } from "@/components/structure/Shell";
import styles from "@/components/structure/structure.module.css";
import { formatNumber, plural } from "@/lib/structure/format";
import { IMPACT_MAX_DEPTH, type ImpactRow, impactOf, searchSymbols, summarizeImpact } from "@/lib/structure/impact";
import { BadRequestError, encodePath, parseBoundedInt, parseConfidence, parseOptionalId } from "@/lib/structure/params";
import { listRepositories } from "@/lib/structure/repositories";
import { getSymbol } from "@/lib/structure/symbols";
import type { SymbolDetail } from "@/lib/structure/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Impact analysis" };

const CONFIDENCE_STEPS = [
  { value: "0", label: "Any" },
  { value: "0.5", label: "0.50 or more" },
  { value: "0.75", label: "0.75 or more" },
  { value: "0.9", label: "0.90 or more" },
];

const HEAT = ["var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)"];

type Search = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function heat(depth: number): string {
  return HEAT[Math.min(depth, HEAT.length) - 1];
}

function impactHref(params: Record<string, string | number | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  }
  return `/impact?${query.toString()}`;
}

function readParams(raw: Record<string, string | string[] | undefined>) {
  const problems: string[] = [];
  const attempt = <T,>(parse: () => T, fallback: T): T => {
    try {
      return parse();
    } catch (error) {
      if (error instanceof BadRequestError) {
        problems.push(error.message);
        return fallback;
      }
      throw error;
    }
  };
  const q = (one(raw.q) ?? "").trim().slice(0, 200);
  return {
    q,
    repoId: attempt(() => parseOptionalId(one(raw.repo), "repo"), null),
    symbolId: attempt(() => parseOptionalId(one(raw.symbol), "symbol"), null),
    depth: attempt(() => parseBoundedInt(one(raw.depth), "depth", { min: 1, max: IMPACT_MAX_DEPTH, fallback: 5 }), 5),
    min: attempt(() => parseConfidence(one(raw.min)), 0),
    problems,
  };
}

function CallPath({ row, names, target }: { row: ImpactRow; names: Map<number, string>; target: SymbolDetail }) {
  return (
    <ol className={impactStyles.path} aria-label="Call path">
      {row.callPath.map((id, i) =>
        id === target.symbolId ? (
          <li key={`${i}-${id}`} className={impactStyles.pathTarget}>
            {target.name}
          </li>
        ) : (
          <li key={`${i}-${id}`}>
            <Link href={`/symbols/${id}`}>{names.get(id) ?? `#${id}`}</Link>
          </li>
        ),
      )}
    </ol>
  );
}

async function Results({
  target,
  depth,
  min,
  q,
  repoId,
}: {
  target: SymbolDetail;
  depth: number;
  min: number;
  q: string;
  repoId: number | null;
}) {
  const rows = await impactOf(target.symbolId, depth, min);
  const summary = summarizeImpact(rows);
  const names = new Map(rows.map((r) => [r.symbolId, r.name]));
  const entryPoints = rows.filter((r) => r.isEntryPoint);
  const fileHref = `/repositories/${target.repoId}/files/${encodePath(target.path)}`;

  return (
    <section className={impactStyles.target} aria-labelledby="target-heading">
      <div className={styles.titleRow}>
        <h2 id="target-heading" className={styles.codeTitle}>
          {target.name}
        </h2>
        <KindBadge kind={target.kind} />
        {target.isEntryPoint && <EntryBadge />}
      </div>
      <p className={styles.lede}>
        <Link className={styles.mono} href={fileHref}>
          {target.path}
        </Link>{" "}
        lines {target.startLine} to {target.endLine} in {target.repoName}.{" "}
        <Link href={`/symbols/${target.symbolId}/graph`}>Open the call graph</Link>
      </p>

      <form className={impactStyles.controls} method="get">
        <input type="hidden" name="symbol" value={target.symbolId} />
        {q && <input type="hidden" name="q" value={q} />}
        {repoId && <input type="hidden" name="repo" value={repoId} />}
        <label className={styles.field}>
          Follow callers up to
          <select name="depth" defaultValue={String(depth)}>
            {Array.from({ length: IMPACT_MAX_DEPTH }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {plural(d, "step")}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Weakest link on the path
          <select name="min" defaultValue={String(min)}>
            {CONFIDENCE_STEPS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={`${styles.button} ${styles.buttonQuiet}`}>
          Update
        </button>
      </form>

      {rows.length === 0 ? (
        <p className={`${styles.empty} ${styles.section}`}>
          Nothing calls {target.name} within {plural(depth, "step")}
          {min > 0 ? ` through calls resolved with confidence ${min.toFixed(2)} or more` : ""}. Changing it should not break
          other code that the parser could resolve.
        </p>
      ) : (
        <>
          <div className={impactStyles.radius}>
            <div className={impactStyles.radiusHead}>
              <p className={impactStyles.count}>
                <strong>{formatNumber(summary.affected)}</strong>
                <span>affected {summary.affected === 1 ? "symbol" : "symbols"}</span>
              </p>
              <p className={impactStyles.count}>
                <strong>{formatNumber(summary.files)}</strong>
                <span>{summary.files === 1 ? "file" : "files"}</span>
              </p>
              <p className={impactStyles.count}>
                <strong>{formatNumber(summary.entryPoints)}</strong>
                <span>{summary.entryPoints === 1 ? "entry point" : "entry points"}</span>
              </p>
            </div>
            <div className={impactStyles.strip} role="img" aria-label="Affected symbols by distance">
              {summary.byDepth.map((b) => (
                <span key={b.depth} style={{ flexGrow: b.count, background: heat(b.depth) }} />
              ))}
            </div>
            <ul className={impactStyles.stripLegend}>
              {summary.byDepth.map((b) => (
                <li key={b.depth}>
                  <span className={impactStyles.dot} style={{ background: heat(b.depth) }} aria-hidden="true" />
                  {b.depth === 1 ? "direct" : `${b.depth} steps`}: {b.count}
                </li>
              ))}
            </ul>
          </div>

          <ImpactView target={target} rows={rows}>
            {entryPoints.length > 0 && (
              <section className={impactStyles.entryPoints} aria-labelledby="entry-heading">
                <h2 id="entry-heading">Entry points that reach {target.name}</h2>
                <ul>
                  {entryPoints.map((r) => (
                    <li key={r.symbolId}>
                      <Link className={styles.mono} href={`/symbols/${r.symbolId}`}>
                        {r.name}
                      </Link>{" "}
                      <span className={styles.muted}>
                        in {r.path}, {plural(r.depth, "step")} away
                      </span>
                      <CallPath row={r} names={names} target={target} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {summary.byDepth.map((band) => (
              <section
                key={band.depth}
                className={impactStyles.band}
                style={{ "--band": heat(band.depth) } as React.CSSProperties}
                aria-labelledby={`band-${band.depth}`}
              >
                <h2 id={`band-${band.depth}`} className={impactStyles.bandTitle}>
                  {band.depth === 1 ? "Direct callers" : `Callers ${band.depth} steps away`}
                  <span>{plural(band.count, "symbol")}</span>
                </h2>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th scope="col">Symbol</th>
                        <th scope="col">Kind</th>
                        <th scope="col">Call path</th>
                        <th scope="col" className={styles.num}>
                          Confidence
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows
                        .filter((r) => r.depth === band.depth)
                        .map((r) => (
                          <tr key={r.symbolId}>
                            <th scope="row">
                              <Link className={styles.mono} href={`/symbols/${r.symbolId}`}>
                                {r.name}
                              </Link>{" "}
                              {r.isEntryPoint && <EntryBadge />}
                              <Link
                                className={`${styles.sub} ${styles.mono}`}
                                href={`/repositories/${r.repoId}/files/${encodePath(r.path)}`}
                              >
                                {r.path}
                              </Link>
                            </th>
                            <td>
                              <KindBadge kind={r.kind} />
                            </td>
                            <td>
                              <CallPath row={r} names={names} target={target} />
                            </td>
                            <td className={styles.num}>
                              <Confidence value={r.minConfidence} />
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </ImpactView>
        </>
      )}
    </section>
  );
}

export default async function ImpactPage({ searchParams }: { searchParams: Search }) {
  const { q, repoId, symbolId, depth, min, problems } = readParams(await searchParams);
  const [repositories, hits, target] = await Promise.all([
    listRepositories(),
    q ? searchSymbols(q, repoId, 25) : Promise.resolve([]),
    symbolId ? getSymbol(symbolId) : Promise.resolve(null),
  ]);

  return (
    <Shell section="impact">
      <header className={styles.header}>
        <h1 className={styles.title}>Impact analysis</h1>
        <p className={styles.lede}>
          Pick a function, method or class to see everything that calls it, directly or through other calls, and which entry
          points sit on those paths.
        </p>
      </header>

      <form className={impactStyles.searchForm} method="get" role="search">
        <label className={styles.field}>
          Symbol name or signature
          <input type="search" name="q" defaultValue={q} placeholder="getUserById, get user, PriceCalculator" maxLength={200} />
        </label>
        <label className={styles.field}>
          Repository
          <select name="repo" defaultValue={repoId ? String(repoId) : ""}>
            <option value="">All repositories</option>
            {repositories.map((r) => (
              <option key={r.repoId} value={r.repoId}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={styles.button}>
          Search
        </button>
      </form>

      {problems.length > 0 && <p className={`${styles.notice} ${styles.section}`}>{problems.join(". ")}.</p>}

      {q && (
        <section className={styles.section} aria-labelledby="hits-heading">
          <h2 id="hits-heading" className={styles.sectionTitle}>
            {hits.length === 0 ? "No matches" : `Matches for ${q}`}
          </h2>
          {hits.length === 0 ? (
            <p className={styles.empty}>
              No symbol name or signature matches {q}. Try part of the name, such as user for getUserById.
            </p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Symbol</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Repository</th>
                    <th scope="col">
                      <span className={styles.visuallyHidden}>Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {hits.map((h) => (
                    <tr key={h.symbolId} aria-current={h.symbolId === symbolId ? "true" : undefined}>
                      <th scope="row">
                        <span className={styles.mono}>{h.name}</span>
                        <span className={`${styles.sub} ${styles.mono}`}>
                          {h.path}:{h.startLine}
                        </span>
                        {h.signature && <span className={styles.signature}>{h.signature}</span>}
                      </th>
                      <td>
                        <KindBadge kind={h.kind} />
                      </td>
                      <td>{repositories.find((r) => r.repoId === h.repoId)?.name ?? h.repoId}</td>
                      <td className={styles.num}>
                        <Link href={impactHref({ symbol: h.symbolId, q, repo: repoId, depth, min: min || undefined })}>
                          {h.symbolId === symbolId ? "Showing" : "Analyse"}
                          <span className={styles.visuallyHidden}> {h.name}</span>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {symbolId && !target && <p className={`${styles.notice} ${styles.section}`}>Symbol {symbolId} does not exist.</p>}

      {target && <Results target={target} depth={depth} min={min} q={q} repoId={repoId} />}

      {!q && !symbolId && (
        <p className={`${styles.empty} ${styles.section}`}>
          Search for a symbol above, or open any symbol page and choose Analyse impact.
        </p>
      )}
    </Shell>
  );
}

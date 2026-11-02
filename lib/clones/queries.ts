import { readFile } from "node:fs/promises";
import path from "node:path";
import { checkoutPath } from "@/lib/history/checkout";
import { parseSearchText } from "@/lib/history/params";
import { pool } from "@/lib/pg";
import { BadRequestError, parseBoundedInt, parseOptionalId } from "@/lib/structure/params";
import type { SymbolKind } from "@/lib/structure/types";
import {
  CLUSTER_STATUSES,
  CLUSTERS_PER_PAGE,
  type ClusterFilter,
  type ClusterMember,
  type ClusterReview,
  type ClusterStatus,
  type ClusterSummary,
} from "./types";

// A review the database refused, with the HTTP status that fits the SQLSTATE.
export class ReviewError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message);
  }
}

const REVIEW_STATUS: Record<string, ReviewError["status"]> = {
  "40001": 409,
  "42501": 403,
  "23514": 400,
  P0002: 404,
  "22023": 400,
};

export function parseClusterFilter(params: URLSearchParams): ClusterFilter {
  const status = params.get("status") || "open";
  if (!(CLUSTER_STATUSES as readonly string[]).includes(status)) {
    throw new BadRequestError("status must be open, confirmed or dismissed");
  }
  return {
    status: status as ClusterStatus,
    repoId: parseOptionalId(params.get("repo"), "repo"),
    page: parseBoundedInt(params.get("page"), "page", { min: 1, max: 100000, fallback: 1 }),
  };
}

export function parseReviewBody(body: unknown): Pick<ClusterReview, "status" | "waive" | "reason"> {
  if (typeof body !== "object" || body === null) throw new BadRequestError("send a JSON object");
  const { status, waive = [], reason } = body as Record<string, unknown>;
  if (status !== "confirmed" && status !== "dismissed") {
    throw new BadRequestError("status must be confirmed or dismissed");
  }
  if (!Array.isArray(waive) || waive.length > 500 || !waive.every((id) => Number.isSafeInteger(id) && id > 0)) {
    throw new BadRequestError("waive must be a list of symbol ids");
  }
  if (reason != null && typeof reason !== "string") throw new BadRequestError("reason must be text");
  const text = parseSearchText(reason, "reason", 500);
  return { status, waive: [...new Set(waive as number[])], reason: text || null };
}

interface ClusterRecord {
  cluster_id: string;
  status: ClusterStatus;
  similarity_score: string;
  members: number;
  repo_name: string | null;
  detected_at: Date;
  reviewed_at: Date | null;
  reviewer: string | null;
}

function toCluster(r: ClusterRecord): ClusterSummary {
  return {
    clusterId: Number(r.cluster_id),
    status: r.status,
    similarityScore: Number(r.similarity_score),
    members: r.members,
    repoName: r.repo_name ?? "",
    createdAt: r.detected_at.toISOString(),
    reviewedAt: r.reviewed_at ? r.reviewed_at.toISOString() : null,
    reviewer: r.reviewer,
  };
}

const CLUSTER_SELECT = `
  SELECT c.cluster_id, c.status, c.similarity_score, c.detected_at, c.reviewed_at, u.username AS reviewer,
         count(s.symbol_id)::int AS members,
         string_agg(DISTINCT r.name, ', ') AS repo_name
  FROM clone_cluster c
  LEFT JOIN symbol s ON s.cluster_id = c.cluster_id
  LEFT JOIN repository r ON r.repo_id = s.repo_id
  LEFT JOIN app_user u ON u.user_id = c.reviewed_by`;

// Open clusters most similar first; reviewed ones most recently reviewed first.
export async function listClusters(filter: ClusterFilter): Promise<{ clusters: ClusterSummary[]; total: number }> {
  const params = [filter.status, filter.repoId];
  const [rows, count] = await Promise.all([
    pool.query<ClusterRecord>(
      `${CLUSTER_SELECT}
       WHERE c.status = $1
       GROUP BY c.cluster_id, u.username
       HAVING count(s.symbol_id) > 0 AND ($2::bigint IS NULL OR bool_or(s.repo_id = $2))
       ORDER BY c.reviewed_at DESC NULLS LAST, c.similarity_score DESC, c.cluster_id
       LIMIT ${CLUSTERS_PER_PAGE} OFFSET $3`,
      [...params, (filter.page - 1) * CLUSTERS_PER_PAGE],
    ),
    pool.query<{ total: number }>(
      `SELECT count(DISTINCT c.cluster_id)::int AS total
       FROM clone_cluster c JOIN symbol s ON s.cluster_id = c.cluster_id
       WHERE c.status = $1 AND ($2::bigint IS NULL OR s.repo_id = $2)`,
      params,
    ),
  ]);
  return { clusters: rows.rows.map(toCluster), total: count.rows[0].total };
}

// The member's lines from the checked-out file, or null when the file is not on disk.
async function readLines(
  files: Map<string, Promise<string[] | null>>,
  root: string,
  file: string,
  start: number,
  end: number,
): Promise<string | null> {
  const absolute = path.resolve(root, file);
  if (!absolute.startsWith(root + path.sep)) return null;
  if (!files.has(absolute)) {
    files.set(
      absolute,
      readFile(absolute, "utf8").then(
        (text) => text.split(/\r?\n/),
        () => null,
      ),
    );
  }
  const lines = await files.get(absolute)!;
  if (!lines || start > lines.length) return null;
  return lines.slice(start - 1, end).join("\n");
}

export async function getCluster(
  clusterId: number,
): Promise<{ cluster: ClusterSummary; members: ClusterMember[] } | null> {
  const cluster = await pool.query<ClusterRecord>(
    `${CLUSTER_SELECT}
     WHERE c.cluster_id = $1
     GROUP BY c.cluster_id, u.username`,
    [clusterId],
  );
  if (cluster.rowCount === 0) return null;
  const members = await pool.query<{
    symbol_id: string;
    name: string;
    kind: SymbolKind;
    path: string;
    start_line: number;
    end_line: number;
    url: string;
    waived: boolean;
  }>(
    `SELECT s.symbol_id, s.name, s.kind, s.path, s.start_line, s.end_line, r.url,
            EXISTS (SELECT 1 FROM waives w WHERE w.symbol_id = s.symbol_id) AS waived
     FROM symbol s JOIN repository r USING (repo_id)
     WHERE s.cluster_id = $1
     ORDER BY s.path, s.start_line, s.symbol_id`,
    [clusterId],
  );
  const files = new Map<string, Promise<string[] | null>>();
  return {
    cluster: toCluster(cluster.rows[0]),
    members: await Promise.all(
      members.rows.map(async (r) => ({
        symbolId: Number(r.symbol_id),
        name: r.name,
        kind: r.kind,
        path: r.path,
        startLine: r.start_line,
        endLine: r.end_line,
        waived: r.waived,
        source: await readLines(files, checkoutPath(r.url), r.path, r.start_line, r.end_line),
      })),
    ),
  };
}

// review_clone_cluster does not commit, so the review and its waivers go in one transaction.
export async function reviewCluster(review: ClusterReview): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("CALL review_clone_cluster($1, $2, $3, $4::bigint[], $5)", [
      review.clusterId,
      review.reviewerId,
      review.status,
      review.waive,
      review.reason,
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    const status = REVIEW_STATUS[code];
    if (status) throw new ReviewError((error as Error).message, status);
    throw error;
  } finally {
    client.release();
  }
}

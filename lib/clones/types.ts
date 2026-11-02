import type { SymbolKind } from "@/lib/structure/types";

export const CLUSTER_STATUSES = ["open", "confirmed", "dismissed"] as const;
export type ClusterStatus = (typeof CLUSTER_STATUSES)[number];
export type ReviewOutcome = Exclude<ClusterStatus, "open">;

export interface ClusterSummary {
  clusterId: number;
  status: ClusterStatus;
  similarityScore: number;
  members: number;
  repoName: string;
  createdAt: string;
  reviewedAt: string | null;
  reviewer: string | null;
}

export interface ClusterMember {
  symbolId: number;
  name: string;
  kind: SymbolKind;
  path: string;
  startLine: number;
  endLine: number;
  waived: boolean;
  source: string | null;
}

export interface ClusterFilter {
  status: ClusterStatus;
  repoId: number | null;
  page: number;
}

export interface ClusterReview {
  clusterId: number;
  reviewerId: number;
  status: ReviewOutcome;
  waive: number[];
  reason: string | null;
}

export const CLUSTERS_PER_PAGE = 25;

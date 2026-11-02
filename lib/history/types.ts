import type { SymbolKind } from "@/lib/structure/types";

export interface HistorySummary {
  repositories: number;
  commits: number;
  authors: number;
  symbolsChanged: number;
  openClusters: number;
}

export interface Hotspot {
  symbolId: number;
  repoId: number;
  path: string;
  name: string;
  kind: SymbolKind;
  commits: number;
  authors: number;
  additions: number;
  deletions: number;
  churn: number;
  lastChanged: string;
}

export interface AuthorActivity {
  authorId: number;
  name: string;
  company: string | null;
  commits: number;
  churn: number;
  firstCommit: string;
  lastCommit: string;
}

export interface CommitSummary {
  commitId: number;
  repoId: number;
  repoName: string;
  sha: string;
  message: string;
  authorId: number;
  authorName: string;
  committedAt: string;
  symbols: number;
  churn: number;
}

export interface CommitChange {
  symbolId: number;
  path: string;
  startLine: number;
  name: string;
  kind: SymbolKind;
  additions: number;
  deletions: number;
  changeType: "added" | "modified";
}

export interface CommitFilter {
  repoId: number | null;
  authorId: number | null;
  q: string;
  page: number;
}

export const COMMITS_PER_PAGE = 25;

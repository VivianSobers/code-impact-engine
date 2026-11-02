export const SYMBOL_KINDS = ["function", "method", "class", "interface", "enum", "module"] as const;
export type SymbolKind = (typeof SYMBOL_KINDS)[number];

export type Language = "javascript" | "typescript" | "python" | "java" | "go";

export interface RepositorySummary {
  repoId: number;
  name: string;
  url: string;
  defaultBranch: string;
  addedDate: string;
  fileCount: number;
  symbolCount: number;
  callCount: number;
  loc: number;
  languages: Language[];
}

export interface FileEntry {
  path: string;
  language: Language;
  loc: number;
  symbolCount: number;
  hasAst: boolean;
}

export interface FileDetail {
  repoId: number;
  repoName: string;
  path: string;
  language: Language;
  loc: number;
  contentHash: string;
  astDocId: string | null;
}

export interface SymbolRow {
  symbolId: number;
  repoId: number;
  path: string;
  name: string;
  kind: SymbolKind;
  signature: string | null;
  startLine: number;
  endLine: number;
  length: number;
  isEntryPoint: boolean;
}

export interface SymbolDetail extends SymbolRow {
  repoName: string;
  embeddingId: number | null;
  clusterId: number | null;
}

export interface CallEdge {
  symbol: SymbolRow;
  callLine: number;
  confidence: number;
}

export interface ImportLink {
  repoId: number;
  path: string;
  language: Language;
}

export interface NodeTypeCount {
  type: string;
  count: number;
  files: number;
  share: number;
}

export interface LanguageNodeTypes {
  language: string;
  total_nodes: number;
  distinct_types: number;
  top_types: NodeTypeCount[];
}

export interface DeepFile {
  ast_doc_id: string;
  repo_id: number;
  path: string;
  language: string;
  loc: number;
  node_count: number;
  max_depth: number;
  truncated: boolean;
  deepest_node: { type: string | null; line: number | null; column: number | null };
  ancestry: string[];
}

export interface AstStats {
  byLanguage: LanguageNodeTypes[];
  deepest: DeepFile[];
}

export interface IngestSummary {
  repoId: number;
  name: string;
  files: number;
  symbols: number;
  calls: number;
  imports: number;
  skipped: number;
  durationMs: number;
}

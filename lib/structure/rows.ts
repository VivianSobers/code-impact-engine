import type { Language, SymbolKind, SymbolRow } from "./types";

export interface SymbolRecord {
  symbol_id: string;
  repo_id: string;
  path: string;
  name: string;
  kind: SymbolKind;
  signature: string | null;
  start_line: number;
  end_line: number;
  is_entry_point: boolean;
}

export const SYMBOL_COLUMNS = `s.symbol_id, s.repo_id, s.path, s.name, s.kind, s.signature,
  s.start_line, s.end_line, s.is_entry_point`;

export function toSymbolRow(r: SymbolRecord): SymbolRow {
  return {
    symbolId: Number(r.symbol_id),
    repoId: Number(r.repo_id),
    path: r.path,
    name: r.name,
    kind: r.kind,
    signature: r.signature,
    startLine: r.start_line,
    endLine: r.end_line,
    length: r.end_line - r.start_line + 1,
    isEntryPoint: r.is_entry_point,
  };
}

export function toLanguages(value: string[] | null): Language[] {
  return (value ?? []) as Language[];
}

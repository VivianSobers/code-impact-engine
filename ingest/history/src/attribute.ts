import type { RawSymbol, SymbolKind } from "../../parse/src/extract/types";
import type { Hunk } from "./gitlog";

// Identifies a symbol across revisions of one file: kind, name, and how many symbols
// with the same kind and name come before it. Line numbers move between revisions;
// this does not, unless a same-named overload is added above it.
export type SymbolKey = string;

export interface Attribution {
  key: SymbolKey;
  additions: number;
  deletions: number;
  changeType: "added" | "modified";
}

const SEP = "\u0000";

export function parseSymbolKey(key: SymbolKey): { kind: SymbolKind; name: string; ordinal: number } {
  const [kind, name, ordinal] = key.split(SEP);
  return { kind: kind as SymbolKind, name, ordinal: Number(ordinal) };
}

export function symbolKeys(symbols: RawSymbol[]): Map<SymbolKey, RawSymbol> {
  const sorted = [...symbols].sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  const seen = new Map<string, number>();
  const keys = new Map<SymbolKey, RawSymbol>();
  for (const symbol of sorted) {
    const base = `${symbol.kind}${SEP}${symbol.name}`;
    const ordinal = seen.get(base) ?? 0;
    seen.set(base, ordinal + 1);
    keys.set(`${base}${SEP}${ordinal}`, symbol);
  }
  return keys;
}

function overlap(start: number, count: number, symbol: RawSymbol): number {
  if (count === 0) return 0;
  const from = Math.max(start, symbol.startLine);
  const to = Math.min(start + count - 1, symbol.endLine);
  return Math.max(0, to - from + 1);
}

// Counts, for each symbol that exists after the change, the added lines inside its new
// span and the removed lines inside its old span. A line inside nested symbols counts
// for each of them. Module symbols span the whole file and are left out.
export function attribute(hunks: Hunk[], before: RawSymbol[] | null, after: RawSymbol[] | null): Attribution[] {
  const oldKeys = symbolKeys((before ?? []).filter((s) => s.kind !== "module"));
  const newKeys = symbolKeys((after ?? []).filter((s) => s.kind !== "module"));
  const result: Attribution[] = [];

  for (const [key, symbol] of newKeys) {
    const previous = oldKeys.get(key);
    let additions = 0;
    let deletions = 0;
    for (const h of hunks) {
      additions += overlap(h.newStart, h.newLines, symbol);
      if (previous) deletions += overlap(h.oldStart, h.oldLines, previous);
    }
    if (additions + deletions > 0) {
      result.push({ key, additions, deletions, changeType: previous ? "modified" : "added" });
    }
  }
  return result.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

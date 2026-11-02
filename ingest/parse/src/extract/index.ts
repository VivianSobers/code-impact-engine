import { countLines, flattenTree, type FlatAst } from "../ast";
import { languageOf, type Grammar, type Language } from "../languages";
import { parse } from "../parser";
import type { Extractor } from "./base";
import { GoExtractor } from "./go";
import { JavaExtractor } from "./java";
import { JavaScriptExtractor } from "./javascript";
import { PythonExtractor } from "./python";
import type { FileFacts } from "./types";

export interface ParsedFile {
  path: string;
  grammar: Grammar;
  language: Language;
  loc: number;
  facts: FileFacts;
  ast: FlatAst;
}

const extractors: Record<Language, new (language: Language, path: string, source: string, loc: number) => Extractor> = {
  javascript: JavaScriptExtractor,
  typescript: JavaScriptExtractor,
  python: PythonExtractor,
  java: JavaExtractor,
  go: GoExtractor,
};

export async function parseSource(path: string, grammar: Grammar, source: string): Promise<ParsedFile> {
  const language = languageOf(grammar);
  const loc = countLines(source);
  const tree = await parse(grammar, source);
  try {
    const Extractor = extractors[language];
    const facts = new Extractor(language, path, source, loc).run(tree.rootNode);
    return { path, grammar, language, loc, facts, ast: flattenTree(tree) };
  } finally {
    tree.delete();
  }
}

export type { FileFacts, RawCall, RawImport, RawSymbol, Receiver, SymbolKind } from "./types";

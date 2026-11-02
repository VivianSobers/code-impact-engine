import { createRequire } from "node:module";
import Parser from "web-tree-sitter";
import type { Grammar } from "./languages";

const require = createRequire(import.meta.url);

let initialised: Promise<void> | null = null;
const parsers = new Map<Grammar, Promise<Parser>>();

export function grammarPackage(grammar: Grammar): string {
  return `tree-sitter-${grammar}`;
}

async function createParser(grammar: Grammar): Promise<Parser> {
  initialised ??= Parser.init();
  await initialised;
  const language = await Parser.Language.load(require.resolve(`tree-sitter-wasms/out/tree-sitter-${grammar}.wasm`));
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}

export function parserFor(grammar: Grammar): Promise<Parser> {
  let parser = parsers.get(grammar);
  if (!parser) {
    parser = createParser(grammar);
    parsers.set(grammar, parser);
  }
  return parser;
}

export async function parse(grammar: Grammar, source: string): Promise<Parser.Tree> {
  const parser = await parserFor(grammar);
  return parser.parse(source);
}

export type { Parser };
export type SyntaxNode = Parser.SyntaxNode;
export type Tree = Parser.Tree;

import { parseSource, type ParsedFile } from "../src/extract";
import { grammarFor } from "../src/languages";
import { CallGraph, type ResolvedCall } from "../src/resolve/calls";
import { ImportResolver, type FileLinks } from "../src/resolve/imports";

export async function parseFile(path: string, source: string): Promise<ParsedFile> {
  const grammar = grammarFor(path);
  if (!grammar) throw new Error(`No grammar for ${path}`);
  return parseSource(path, grammar, source);
}

export interface Project {
  files: ParsedFile[];
  links: Map<string, FileLinks>;
  graph: CallGraph;
  calls: ResolvedCall[];
  edge(caller: string, callee: string): ResolvedCall | undefined;
  entries: Set<number>;
  symbol(qualified: string): number;
}

export async function buildProject(sources: Record<string, string>): Promise<Project> {
  const files = await Promise.all(Object.entries(sources).map(([path, source]) => parseFile(path, source)));
  const resolver = new ImportResolver(files.map((file) => ({ path: file.path, language: file.language, imports: file.facts.imports })));
  const links = new Map(files.map((file) => [file.path, resolver.link({ path: file.path, language: file.language, imports: file.facts.imports })]));
  const graphFiles = files.map((file) => ({ path: file.path, facts: file.facts }));
  const graph = new CallGraph(graphFiles, links);
  const calls = graph.resolve(graphFiles);
  const imported = new Set([...links.values()].flatMap((link) => [...link.edges]));
  const entries = graph.markEntryPoints(calls, imported);
  const symbol = (qualified: string) => {
    const [path, name] = qualified.split("#");
    const found = graph.symbols.find((candidate) => candidate.path === path && candidate.name === name);
    if (!found) throw new Error(`No symbol ${qualified}`);
    return found.id;
  };
  const edge = (caller: string, callee: string) => {
    const from = symbol(caller);
    const to = symbol(callee);
    return calls.find((call) => call.caller === from && call.callee === to);
  };
  return { files, links, graph, calls, edge, entries, symbol };
}

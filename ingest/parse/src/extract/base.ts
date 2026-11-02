import type { Language } from "../languages";
import type { SyntaxNode } from "../parser";
import type { FileFacts, RawImport, RawSymbol, Receiver, SymbolKind } from "./types";

export interface Scope {
  symbol: number;
  owner: string | null;
  selfName: string | null;
  classBody: boolean;
}

export interface SymbolOptions {
  body?: SyntaxNode | null;
  signatureFrom?: SyntaxNode;
  exported?: boolean;
  mainLike?: boolean;
  owner?: string | null;
  selfName?: string | null;
}

const maxSignature = 240;
const maxWalkDepth = 1500;

export abstract class Extractor {
  readonly facts: FileFacts;
  private readonly keys = new Map<string, number>();
  private depth = 0;

  constructor(
    language: Language,
    protected readonly path: string,
    protected readonly source: string,
    protected readonly loc: number,
  ) {
    this.facts = {
      language,
      symbols: [],
      calls: [],
      imports: [],
      packageName: null,
      mainGuard: false,
      topLevelCalls: 0,
      defaultExport: null,
    };
    if (loc > 0) {
      this.facts.symbols.push({
        name: path,
        kind: "module",
        signature: null,
        startLine: 1,
        endLine: loc,
        exported: false,
        mainLike: false,
        owner: null,
        selfName: null,
      });
    }
  }

  run(root: SyntaxNode): FileFacts {
    if (this.loc > 0) this.visit(root, { symbol: 0, owner: null, selfName: null, classBody: false });
    this.finish();
    return this.facts;
  }

  protected abstract visit(node: SyntaxNode, scope: Scope): void;

  protected finish(): void {}

  protected visitChildren(node: SyntaxNode, scope: Scope): void {
    if (this.depth >= maxWalkDepth) return;
    this.depth++;
    for (const child of node.namedChildren) this.visit(child, scope);
    this.depth--;
  }

  protected addSymbol(node: SyntaxNode, name: string, kind: SymbolKind, options: SymbolOptions = {}): number {
    const [startLine, endLine] = this.span(node);
    const key = `${kind}\u0000${name}\u0000${startLine}`;
    const existing = this.keys.get(key);
    if (existing !== undefined) return existing;

    const symbol: RawSymbol = {
      name,
      kind,
      signature: this.signature(options.signatureFrom ?? node, options.body ?? null),
      startLine,
      endLine,
      exported: options.exported ?? false,
      mainLike: options.mainLike ?? false,
      owner: options.owner ?? null,
      selfName: options.selfName ?? null,
    };
    this.facts.symbols.push(symbol);
    const index = this.facts.symbols.length - 1;
    this.keys.set(key, index);
    return index;
  }

  protected enter(scope: Scope, symbol: number, changes: Partial<Scope> = {}): Scope {
    return { ...scope, symbol, classBody: false, ...changes };
  }

  protected addCall(scope: Scope, name: string, at: SyntaxNode, receiver: Receiver, construct = false): void {
    if (!name || scope.symbol < 0) return;
    this.facts.calls.push({ caller: scope.symbol, name, line: this.lineOf(at), receiver, construct });
    if (scope.symbol === 0) this.facts.topLevelCalls++;
  }

  protected addImport(specifier: string, bindings: RawImport["bindings"] = [], reexport = false): void {
    if (specifier) this.facts.imports.push({ specifier, bindings, reexport });
  }

  protected lineOf(node: SyntaxNode): number {
    return Math.min(Math.max(node.startPosition.row + 1, 1), this.loc);
  }

  protected span(node: SyntaxNode): [number, number] {
    const start = node.startPosition.row + 1;
    let end = node.endPosition.row + 1;
    if (node.endPosition.column === 0 && end > start) end--;
    const startLine = Math.min(Math.max(start, 1), this.loc);
    return [startLine, Math.max(Math.min(end, this.loc), startLine)];
  }

  protected signature(from: SyntaxNode, body: SyntaxNode | null): string | null {
    const end = body && body.startIndex > from.startIndex ? body.startIndex : from.endIndex;
    let text = this.source.slice(from.startIndex, end);
    if (!body) text = text.split("\n", 1)[0];
    text = text.replace(/\s+/g, " ").trim().replace(/\s*[{:]$/, "").trim();
    if (!text) return null;
    return text.length > maxSignature ? `${text.slice(0, maxSignature - 3)}...` : text;
  }

  protected stringValue(node: SyntaxNode | null): string | null {
    if (!node) return null;
    const text = node.text;
    if (text.length < 2) return null;
    const quote = text[0];
    if ((quote !== '"' && quote !== "'" && quote !== "`") || text[text.length - 1] !== quote) return null;
    return text.slice(1, -1);
  }

  protected dottedName(node: SyntaxNode | null, memberTypes: string[], propertyFields: [string, string]): string | null {
    if (!node) return null;
    if (node.type === "identifier") return node.text;
    if (!memberTypes.includes(node.type)) return null;
    const object = this.dottedName(node.childForFieldName(propertyFields[0]), memberTypes, propertyFields);
    const property = node.childForFieldName(propertyFields[1]);
    return object && property ? `${object}.${property.text}` : null;
  }
}

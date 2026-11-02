import path from "node:path";
import type { FileFacts, RawCall, RawSymbol } from "../extract/types";
import { languageFamily } from "../languages";
import type { FileLinks } from "./imports";

export interface GraphSymbol extends RawSymbol {
  id: number;
  path: string;
  family: string;
}

export interface ResolvedCall {
  caller: number;
  callee: number;
  line: number;
  confidence: number;
}

export interface GraphFile {
  path: string;
  facts: FileFacts;
}

interface Candidate {
  symbol: GraphSymbol;
  confidence: number;
}

export const confidence = {
  sameFile: 1,
  selfMethod: 0.95,
  imported: 0.9,
  samePackage: 0.85,
  importedMember: 0.85,
  typedReceiver: 0.85,
  wildcard: 0.8,
  staticMember: 0.8,
  unique: 0.6,
  ambiguous: 0.5,
  memberUnique: 0.4,
  memberAmbiguous: 0.3,
  floor: 0.1,
};

export const maxAmbiguous = 8;
const callableKinds = new Set(["function", "method", "class"]);

const builtinMembers: Record<string, Set<string>> = {
  javascript: new Set([
    "push", "pop", "shift", "unshift", "slice", "splice", "concat", "map", "filter", "reduce", "forEach", "findIndex",
    "some", "every", "includes", "indexOf", "join", "split", "replace", "trim", "toString", "valueOf", "keys", "values",
    "entries", "then", "catch", "finally", "log", "warn", "stringify", "apply", "call", "bind", "flat", "flatMap",
  ]),
  python: new Set([
    "append", "extend", "items", "keys", "values", "setdefault", "join", "split", "strip", "startswith", "endswith",
    "lower", "upper", "encode", "decode", "format",
  ]),
  java: new Set([
    "equals", "hashCode", "toString", "stream", "collect", "forEach", "println", "print", "printf", "charAt", "substring",
    "length", "size", "isEmpty",
  ]),
  go: new Set(["Println", "Printf", "Sprintf", "Errorf"]),
};
const httpMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function add<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export class CallGraph {
  readonly symbols: GraphSymbol[] = [];
  private readonly files = new Map<string, GraphFile>();
  private readonly fileSymbols = new Map<string, GraphSymbol[]>();
  private readonly byName = new Map<string, GraphSymbol[]>();
  private readonly byFileName = new Map<string, GraphSymbol[]>();
  private readonly byOwner = new Map<string, GraphSymbol[]>();
  private readonly byDirectory = new Map<string, GraphSymbol[]>();

  constructor(
    files: GraphFile[],
    private readonly links: Map<string, FileLinks>,
  ) {
    for (const file of files) {
      this.files.set(file.path, file);
      const family = languageFamily(file.facts.language);
      const list: GraphSymbol[] = [];
      for (const raw of file.facts.symbols) {
        const symbol: GraphSymbol = { ...raw, id: this.symbols.length, path: file.path, family };
        this.symbols.push(symbol);
        list.push(symbol);
        if (symbol.kind === "module") continue;
        add(this.byName, `${family}\u0000${symbol.name}`, symbol);
        add(this.byFileName, `${file.path}\u0000${symbol.name}`, symbol);
        if (symbol.owner) add(this.byOwner, `${family}\u0000${symbol.owner}\u0000${symbol.name}`, symbol);
        add(this.byDirectory, `${path.posix.dirname(file.path)}\u0000${symbol.name}`, symbol);
      }
      this.fileSymbols.set(file.path, list);
    }
  }

  symbolsOf(filePath: string): GraphSymbol[] {
    return this.fileSymbols.get(filePath) ?? [];
  }

  private spread(symbols: GraphSymbol[], base: number): Candidate[] {
    const unique = [...new Map(symbols.map((symbol) => [symbol.id, symbol])).values()];
    if (unique.length === 0) return [];
    const value = unique.length === 1 ? base : Math.max(confidence.floor, base / unique.length);
    return unique.map((symbol) => ({ symbol, confidence: round(value) }));
  }

  private global(family: string, name: string, accept: (symbol: GraphSymbol) => boolean, member = false): Candidate[] {
    if (member && builtinMembers[family]?.has(name)) return [];
    const symbols = (this.byName.get(`${family}\u0000${name}`) ?? []).filter(accept);
    if (symbols.length === 0 || symbols.length > maxAmbiguous) return [];
    if (symbols.length === 1) return this.spread(symbols, member ? confidence.memberUnique : confidence.unique);
    return this.spread(symbols, member ? confidence.memberAmbiguous : confidence.ambiguous);
  }

  exportedFrom(filePath: string, name: string, member: string | null = null, depth = 0): GraphSymbol[] {
    if (name === "default") {
      const defaultName = this.files.get(filePath)?.facts.defaultExport;
      return defaultName ? this.exportedFrom(filePath, defaultName, member, depth) : [];
    }
    const local = (this.byFileName.get(`${filePath}\u0000${name}`) ?? []).filter(
      (symbol) => symbol.owner === null || (member !== null && symbol.owner === member),
    );
    if (local.length > 0 || depth >= 3) return local;
    const links = this.links.get(filePath);
    if (!links) return [];
    const named = links.reexports.get(name);
    if (named) {
      return named.targets.flatMap((target) =>
        named.imported === "*" ? [] : this.exportedFrom(target, named.imported, member, depth + 1),
      );
    }
    return links.starReexports.flatMap((target) => this.exportedFrom(target, name, member, depth + 1));
  }

  private methodsOf(family: string, owner: string, name: string): GraphSymbol[] {
    return (this.byOwner.get(`${family}\u0000${owner}\u0000${name}`) ?? []).filter((symbol) => symbol.kind === "method");
  }

  private firstTier(tiers: Array<() => Candidate[]>): Candidate[] {
    for (const tier of tiers) {
      const found = tier();
      if (found.length > 0) return found;
    }
    return [];
  }

  candidates(file: GraphFile, call: RawCall): Candidate[] {
    const caller = this.symbolsOf(file.path)[call.caller];
    const family = languageFamily(file.facts.language);
    const links = this.links.get(file.path);
    const name = call.name;
    const directory = path.posix.dirname(file.path);
    const accept = (symbol: GraphSymbol) =>
      symbol.kind !== "module" && (call.construct ? symbol.kind === "class" : callableKinds.has(symbol.kind));
    const anyMethod = () => this.global(family, name, (symbol) => symbol.kind === "method", true);

    switch (call.receiver.kind) {
      case "self": {
        const owner = caller.owner;
        return this.firstTier([
          () => {
            if (!owner) return [];
            const methods = this.methodsOf(family, owner, name);
            const local = methods.filter((symbol) => symbol.path === file.path);
            const packaged = methods.filter((symbol) => path.posix.dirname(symbol.path) === directory);
            return this.spread(local.length > 0 ? local : packaged.length > 0 ? packaged : methods, confidence.selfMethod);
          },
          anyMethod,
        ]);
      }
      case "super":
        return anyMethod();
      case "expression":
        return anyMethod();
      case "name": {
        const receiverName = call.receiver.name;
        const member = receiverName.split(".").pop() ?? receiverName;
        if (links?.external.has(receiverName) || links?.external.has(receiverName.split(".")[0])) return [];
        return this.firstTier([
          () => {
            const link = links?.bindings.get(receiverName);
            if (!link || link.imported !== "*") return [];
            const found = link.targets.flatMap((target) => this.exportedFrom(target, name, member)).filter(accept);
            return this.spread(found, confidence.imported);
          },
          () => {
            const link = links?.bindings.get(receiverName);
            if (!link || link.imported === "*") return [];
            const classes = link.targets.flatMap((target) => this.exportedFrom(target, link.imported)).filter((symbol) => symbol.kind === "class");
            const found = classes.flatMap((owner) => this.methodsOf(family, owner.name, name).filter((symbol) => symbol.path === owner.path));
            return this.spread(found, confidence.importedMember);
          },
          () => {
            const type = file.facts.localTypes.get(receiverName);
            return type ? this.spread(this.methodsOf(family, type, name), confidence.typedReceiver) : [];
          },
          () => this.spread(this.methodsOf(family, member, name), confidence.staticMember),
          anyMethod,
        ]);
      }
      case "none": {
        if (links?.external.has(name) && !links.bindings.has(name)) return [];
        return this.firstTier([
          () => {
            const local = (this.byFileName.get(`${file.path}\u0000${name}`) ?? []).filter(
              (symbol) => accept(symbol) && (symbol.kind !== "method" || family === "java"),
            );
            const own = local.filter((symbol) => symbol.kind === "method" && symbol.owner === caller.owner);
            if (own.length > 0) return this.spread(own, confidence.selfMethod);
            return this.spread(local.filter((symbol) => symbol.kind !== "method"), confidence.sameFile);
          },
          () => {
            const link = links?.bindings.get(name);
            if (!link) return [];
            const imported = link.imported === "*" ? name : link.imported;
            const found = link.targets.flatMap((target) => this.exportedFrom(target, imported)).filter(accept);
            return this.spread(found, confidence.imported);
          },
          () => {
            const found = (links?.wildcards ?? []).flatMap((target) => this.exportedFrom(target, name)).filter(accept);
            return this.spread(found, confidence.wildcard);
          },
          () => {
            if (family !== "go" && family !== "java") return [];
            const found = (this.byDirectory.get(`${directory}\u0000${name}`) ?? []).filter(
              (symbol) => symbol.family === family && symbol.path !== file.path && accept(symbol) && (symbol.owner === null || family === "java"),
            );
            return this.spread(found, confidence.samePackage);
          },
          () => this.global(family, name, (symbol) => accept(symbol) && (symbol.kind !== "method" || family === "java")),
        ]);
      }
    }
  }

  resolve(files: GraphFile[]): ResolvedCall[] {
    const resolved = new Map<string, ResolvedCall>();
    for (const file of files) {
      const symbols = this.symbolsOf(file.path);
      for (const call of file.facts.calls) {
        const caller = symbols[call.caller];
        if (!caller) continue;
        for (const candidate of this.candidates(file, call)) {
          const key = `${caller.id}:${candidate.symbol.id}:${call.line}`;
          const existing = resolved.get(key);
          if (!existing || existing.confidence < candidate.confidence) {
            resolved.set(key, { caller: caller.id, callee: candidate.symbol.id, line: call.line, confidence: candidate.confidence });
          }
        }
      }
    }
    return [...resolved.values()];
  }

  markEntryPoints(calls: ResolvedCall[], importedFiles: Set<string>): Set<number> {
    const called = new Set(calls.filter((call) => call.caller !== call.callee).map((call) => call.callee));
    const entries = new Set<number>();
    for (const symbol of this.symbols) {
      const facts = this.files.get(symbol.path)?.facts;
      if (!facts) continue;
      if (symbol.kind === "module") {
        const script = !importedFiles.has(symbol.path) && facts.topLevelCalls > 0 && (symbol.family === "javascript" || symbol.family === "python");
        if (facts.mainGuard || script) entries.add(symbol.id);
      } else if (symbol.mainLike) {
        entries.add(symbol.id);
      } else if (symbol.owner === null && symbol.exported && httpMethods.has(symbol.name) && /(^|\/)route\.[cm]?[jt]sx?$/.test(symbol.path)) {
        entries.add(symbol.id);
      } else if (symbol.owner === null && symbol.exported && (symbol.kind === "function" || (symbol.kind === "class" && symbol.family !== "go")) && !called.has(symbol.id)) {
        entries.add(symbol.id);
      }
    }
    return entries;
  }
}

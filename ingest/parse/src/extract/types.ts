import type { Language } from "../languages";

export type SymbolKind = "function" | "method" | "class" | "interface" | "enum" | "module";

export interface RawSymbol {
  name: string;
  kind: SymbolKind;
  signature: string | null;
  startLine: number;
  endLine: number;
  exported: boolean;
  mainLike: boolean;
  owner: string | null;
  selfName: string | null;
}

export type Receiver =
  | { kind: "none" }
  | { kind: "self" }
  | { kind: "super" }
  | { kind: "name"; name: string }
  | { kind: "expression" };

export interface RawCall {
  caller: number;
  name: string;
  line: number;
  receiver: Receiver;
  construct: boolean;
}

export interface Binding {
  local: string;
  imported: string;
}

export interface RawImport {
  specifier: string;
  bindings: Binding[];
  reexport: boolean;
}

export interface FileFacts {
  language: Language;
  symbols: RawSymbol[];
  calls: RawCall[];
  imports: RawImport[];
  packageName: string | null;
  mainGuard: boolean;
  topLevelCalls: number;
  defaultExport: string | null;
  localTypes: Map<string, string | null>;
}

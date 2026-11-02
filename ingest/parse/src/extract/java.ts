import type { SyntaxNode } from "../parser";
import { Extractor, type Scope } from "./base";
import type { Receiver, SymbolKind } from "./types";

const memberTypes = ["field_access"];
const typeKinds: Record<string, SymbolKind> = {
  class_declaration: "class",
  record_declaration: "class",
  interface_declaration: "interface",
  annotation_type_declaration: "interface",
  enum_declaration: "enum",
};

export class JavaExtractor extends Extractor {
  protected visit(node: SyntaxNode, scope: Scope): void {
    const typeKind = typeKinds[node.type];
    if (typeKind) return this.typeDeclaration(node, typeKind, scope);
    switch (node.type) {
      case "package_declaration":
        this.facts.packageName = node.namedChildren.find((child) => child.type !== "annotation" && child.type !== "marker_annotation")?.text ?? null;
        return;
      case "import_declaration":
        return this.importDeclaration(node);
      case "method_declaration":
      case "constructor_declaration":
        return this.method(node, scope);
      case "method_invocation":
        return this.invocation(node, scope);
      case "object_creation_expression":
        return this.creation(node, scope);
      default:
        return this.visitChildren(node, scope);
    }
  }

  private modifiers(node: SyntaxNode): string[] {
    const modifiers = node.namedChildren.find((child) => child.type === "modifiers");
    return modifiers ? modifiers.children.filter((child) => !child.isNamed).map((child) => child.type) : [];
  }

  private typeDeclaration(node: SyntaxNode, kind: SymbolKind, scope: Scope): void {
    const name = node.childForFieldName("name")?.text;
    if (!name) return this.visitChildren(node, scope);
    const index = this.addSymbol(node, name, kind, {
      body: node.childForFieldName("body"),
      exported: this.modifiers(node).includes("public"),
    });
    this.visitChildren(node, this.enter(scope, index, { owner: name, classBody: true }));
  }

  private method(node: SyntaxNode, scope: Scope): void {
    const name = node.childForFieldName("name")?.text;
    const body = node.childForFieldName("body");
    if (!name || !body) return;
    const modifiers = this.modifiers(node);
    const index = this.addSymbol(node, name, "method", {
      body,
      exported: modifiers.includes("public"),
      mainLike: name === "main" && modifiers.includes("static") && node.type === "method_declaration",
      owner: scope.owner,
    });
    this.visitChildren(body, this.enter(scope, index));
  }

  private receiver(node: SyntaxNode | null): Receiver {
    if (!node) return { kind: "none" };
    if (node.type === "this") return { kind: "self" };
    if (node.type === "super") return { kind: "super" };
    const name = this.dottedName(node, memberTypes, ["object", "field"]);
    return name ? { kind: "name", name } : { kind: "expression" };
  }

  private invocation(node: SyntaxNode, scope: Scope): void {
    const name = node.childForFieldName("name");
    if (name) this.addCall(scope, name.text, name, this.receiver(node.childForFieldName("object")));
    this.visitChildren(node, scope);
  }

  private creation(node: SyntaxNode, scope: Scope): void {
    const type = node.childForFieldName("type");
    const name = this.typeName(type);
    if (name && type) this.addCall(scope, name, type, { kind: "none" }, true);
    this.visitChildren(node, scope);
  }

  private typeName(node: SyntaxNode | null): string | null {
    if (!node) return null;
    if (node.type === "type_identifier") return node.text;
    if (node.type === "generic_type") return this.typeName(node.namedChildren[0] ?? null);
    if (node.type === "scoped_type_identifier") return this.typeName(node.namedChildren[node.namedChildCount - 1] ?? null);
    return null;
  }

  private importDeclaration(node: SyntaxNode): void {
    const target = node.namedChildren.find((child) => child.type === "scoped_identifier" || child.type === "identifier");
    if (!target) return;
    const wildcard = node.namedChildren.some((child) => child.type === "asterisk");
    const isStatic = node.children.some((child) => child.type === "static");
    const parts = target.text.split(".");
    const last = parts[parts.length - 1];
    if (wildcard) return this.addImport(`${target.text}.*`, [{ local: "*", imported: "*" }]);
    if (isStatic) return this.addImport(parts.slice(0, -1).join("."), [{ local: last, imported: last }]);
    this.addImport(target.text, [{ local: last, imported: "*" }]);
  }
}

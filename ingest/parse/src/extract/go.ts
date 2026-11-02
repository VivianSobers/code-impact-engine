import type { SyntaxNode } from "../parser";
import { Extractor, type Scope } from "./base";
import type { Receiver } from "./types";

const memberTypes = ["selector_expression"];

export class GoExtractor extends Extractor {
  protected visit(node: SyntaxNode, scope: Scope): void {
    switch (node.type) {
      case "package_clause":
        this.facts.packageName = node.namedChildren[0]?.text ?? null;
        return;
      case "import_spec":
        return this.importSpec(node);
      case "function_declaration":
        return this.functionDeclaration(node, scope);
      case "method_declaration":
        return this.methodDeclaration(node, scope);
      case "type_spec":
        return this.typeSpec(node, scope);
      case "call_expression":
        return this.call(node, scope);
      case "parameter_declaration":
      case "var_spec": {
        const type = this.typeName(node.childForFieldName("type"));
        for (const name of node.childrenForFieldName("name")) this.recordType(name.text, type);
        return this.visitChildren(node, scope);
      }
      case "short_var_declaration": {
        const names = node.childForFieldName("left")?.namedChildren ?? [];
        const values = node.childForFieldName("right")?.namedChildren ?? [];
        names.forEach((name, index) => this.recordType(name.text, this.literalType(values[index] ?? null)));
        return this.visitChildren(node, scope);
      }
      default:
        return this.visitChildren(node, scope);
    }
  }

  private isExported(name: string): boolean {
    return /^[A-Z]/.test(name);
  }

  private functionDeclaration(node: SyntaxNode, scope: Scope): void {
    const name = node.childForFieldName("name")?.text;
    const body = node.childForFieldName("body");
    if (!name) return;
    const index = this.addSymbol(node, name, "function", {
      body,
      exported: this.isExported(name),
      mainLike: name === "main" && this.facts.packageName === "main",
    });
    const inner = this.enter(scope, index);
    this.visitParameters(node, inner);
    if (body) this.visitChildren(body, inner);
  }

  private methodDeclaration(node: SyntaxNode, scope: Scope): void {
    const name = node.childForFieldName("name")?.text;
    const body = node.childForFieldName("body");
    if (!name) return;
    const parameter = node.childForFieldName("receiver")?.namedChildren.find((child) => child.type === "parameter_declaration");
    const selfName = parameter?.childForFieldName("name")?.text ?? null;
    const owner = this.receiverType(parameter?.childForFieldName("type") ?? null);
    const index = this.addSymbol(node, name, "method", { body, exported: this.isExported(name), owner, selfName });
    const inner = this.enter(scope, index, { owner, selfName });
    this.visitParameters(node, inner);
    if (body) this.visitChildren(body, inner);
  }

  private visitParameters(node: SyntaxNode, scope: Scope): void {
    const parameters = node.childForFieldName("parameters");
    if (parameters) this.visitChildren(parameters, scope);
  }

  private receiverType(node: SyntaxNode | null): string | null {
    if (!node) return null;
    if (node.type === "type_identifier") return node.text;
    if (node.type === "pointer_type" || node.type === "generic_type") return this.receiverType(node.namedChildren[0] ?? null);
    return null;
  }

  private typeName(node: SyntaxNode | null): string | null {
    if (!node) return null;
    if (node.type === "type_identifier") return node.text;
    if (node.type === "pointer_type" || node.type === "generic_type") return this.typeName(node.namedChildren[0] ?? null);
    if (node.type === "qualified_type") return node.childForFieldName("name")?.text ?? null;
    return null;
  }

  private literalType(node: SyntaxNode | null): string | null {
    if (!node) return null;
    if (node.type === "unary_expression") return this.literalType(node.childForFieldName("operand"));
    if (node.type === "composite_literal") return this.typeName(node.childForFieldName("type"));
    return null;
  }

  private typeSpec(node: SyntaxNode, scope: Scope): void {
    const name = node.childForFieldName("name")?.text;
    const type = node.childForFieldName("type");
    if (!name || !type) return;
    const kind = type.type === "struct_type" ? "class" : type.type === "interface_type" ? "interface" : null;
    if (!kind) return;
    const index = this.addSymbol(node, name, kind, { body: type, signatureFrom: node.parent ?? node, exported: this.isExported(name) });
    this.visitChildren(type, this.enter(scope, index, { owner: name, classBody: true }));
  }

  private receiver(node: SyntaxNode | null, scope: Scope): Receiver {
    if (!node) return { kind: "expression" };
    if (node.type === "identifier" && scope.selfName && node.text === scope.selfName) return { kind: "self" };
    const name = this.dottedName(node, memberTypes, ["operand", "field"]);
    return name ? { kind: "name", name } : { kind: "expression" };
  }

  private call(node: SyntaxNode, scope: Scope): void {
    const fn = node.childForFieldName("function");
    if (fn?.type === "identifier") {
      this.addCall(scope, fn.text, fn, { kind: "none" });
    } else if (fn?.type === "selector_expression") {
      const field = fn.childForFieldName("field");
      if (field) this.addCall(scope, field.text, field, this.receiver(fn.childForFieldName("operand"), scope));
    }
    this.visitChildren(node, scope);
  }

  private importSpec(node: SyntaxNode): void {
    const path = this.stringValue(node.childForFieldName("path"));
    if (!path) return;
    const alias = node.childForFieldName("name");
    if (alias?.type === "blank_identifier") return this.addImport(path);
    if (alias?.type === "dot") return this.addImport(path, [{ local: "*", imported: "*" }]);
    const local = alias?.text ?? path.split("/").pop() ?? path;
    this.addImport(path, [{ local, imported: "*" }]);
  }
}

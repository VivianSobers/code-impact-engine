import type { SyntaxNode } from "../parser";
import { Extractor, type Scope } from "./base";
import type { Binding, Receiver } from "./types";

const memberTypes = ["attribute"];
const mainGuard = /^__name__\s*==\s*["']__main__["']$|^["']__main__["']\s*==\s*__name__$/;

export class PythonExtractor extends Extractor {
  protected visit(node: SyntaxNode, scope: Scope): void {
    switch (node.type) {
      case "function_definition":
        return this.functionDefinition(node, scope);
      case "class_definition":
        return this.classDefinition(node, scope);
      case "call":
        return this.call(node, scope);
      case "import_statement":
        return this.importStatement(node);
      case "import_from_statement":
        return this.importFrom(node);
      case "typed_parameter":
        this.recordType(node.namedChildren.find((child) => child.type === "identifier")?.text, this.typeName(node.childForFieldName("type")));
        return this.visitChildren(node, scope);
      case "typed_default_parameter":
        this.recordType(node.childForFieldName("name")?.text, this.typeName(node.childForFieldName("type")));
        return this.visitChildren(node, scope);
      case "assignment":
        this.assignment(node);
        return this.visitChildren(node, scope);
      case "if_statement":
        if (scope.symbol === 0 && mainGuard.test(node.childForFieldName("condition")?.text.trim() ?? "")) {
          this.facts.mainGuard = true;
        }
        return this.visitChildren(node, scope);
      default:
        return this.visitChildren(node, scope);
    }
  }

  private functionDefinition(node: SyntaxNode, scope: Scope): void {
    const name = node.childForFieldName("name")?.text;
    if (!name) return this.visitChildren(node, scope);
    const method = scope.classBody;
    const index = this.addSymbol(node, name, method ? "method" : "function", {
      body: node.childForFieldName("body"),
      exported: scope.symbol === 0 && !name.startsWith("_"),
      owner: method ? scope.owner : null,
    });
    this.visitChildren(node, this.enter(scope, index));
  }

  private classDefinition(node: SyntaxNode, scope: Scope): void {
    const name = node.childForFieldName("name")?.text;
    if (!name) return this.visitChildren(node, scope);
    const index = this.addSymbol(node, name, "class", {
      body: node.childForFieldName("body"),
      exported: scope.symbol === 0 && !name.startsWith("_"),
    });
    this.visitChildren(node, this.enter(scope, index, { owner: name, classBody: true }));
  }

  private typeName(node: SyntaxNode | null): string | null {
    const text = node?.text.trim().replace(/^["']|["']$/g, "");
    if (!text || !/^[A-Za-z_][\w.]*$/.test(text)) return null;
    return text.split(".").pop() ?? null;
  }

  private assignment(node: SyntaxNode): void {
    const target = this.dottedName(node.childForFieldName("left"), memberTypes, ["object", "attribute"]);
    const right = node.childForFieldName("right");
    const annotated = this.typeName(node.childForFieldName("type"));
    const callee = right?.type === "call" ? right.childForFieldName("function") : null;
    const constructed = callee ? this.dottedName(callee, memberTypes, ["object", "attribute"])?.split(".").pop() : null;
    const type = annotated ?? (constructed && /^[A-Z]/.test(constructed) ? constructed : null);
    this.recordType(target, type);
  }

  private receiver(node: SyntaxNode | null): Receiver {
    if (!node) return { kind: "expression" };
    if (node.type === "identifier" && (node.text === "self" || node.text === "cls")) return { kind: "self" };
    if (node.type === "call" && node.childForFieldName("function")?.text === "super") return { kind: "super" };
    const name = this.dottedName(node, memberTypes, ["object", "attribute"]);
    return name ? { kind: "name", name } : { kind: "expression" };
  }

  private call(node: SyntaxNode, scope: Scope): void {
    const fn = node.childForFieldName("function");
    if (fn?.type === "identifier") {
      this.addCall(scope, fn.text, fn, { kind: "none" });
    } else if (fn?.type === "attribute") {
      const attribute = fn.childForFieldName("attribute");
      if (attribute) this.addCall(scope, attribute.text, attribute, this.receiver(fn.childForFieldName("object")));
    }
    this.visitChildren(node, scope);
  }

  private importStatement(node: SyntaxNode): void {
    for (const name of node.childrenForFieldName("name")) {
      if (name.type === "dotted_name") {
        this.addImport(name.text, [{ local: name.text, imported: "*" }]);
      } else if (name.type === "aliased_import") {
        const module = name.childForFieldName("name")?.text;
        const alias = name.childForFieldName("alias")?.text;
        if (module && alias) this.addImport(module, [{ local: alias, imported: "*" }]);
      }
    }
  }

  private importFrom(node: SyntaxNode): void {
    const module = node.childForFieldName("module_name");
    if (!module) return;
    const specifier = module.text.replace(/\s+/g, "");
    const bindings: Binding[] = [];
    for (const name of node.childrenForFieldName("name")) {
      if (name.type === "dotted_name") bindings.push({ local: name.text, imported: name.text });
      if (name.type === "aliased_import") {
        const imported = name.childForFieldName("name")?.text;
        const alias = name.childForFieldName("alias")?.text;
        if (imported && alias) bindings.push({ local: alias, imported });
      }
    }
    if (node.namedChildren.some((child) => child.type === "wildcard_import")) bindings.push({ local: "*", imported: "*" });
    this.addImport(specifier, bindings);
  }
}

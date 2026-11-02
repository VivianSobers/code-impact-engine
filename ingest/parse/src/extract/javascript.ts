import type { SyntaxNode } from "../parser";
import { Extractor, type Scope } from "./base";
import type { Binding, Receiver } from "./types";

const functionValues = new Set(["arrow_function", "function", "function_expression", "generator_function"]);
const memberTypes = ["member_expression"];
const declarationTypes = new Set(["lexical_declaration", "variable_declaration"]);

export class JavaScriptExtractor extends Extractor {
  private readonly exportedNames = new Set<string>();

  protected visit(node: SyntaxNode, scope: Scope): void {
    switch (node.type) {
      case "function_declaration":
      case "generator_function_declaration":
        return this.declare(node, node.childForFieldName("name"), "function", scope, node.childForFieldName("body"));
      case "class_declaration":
      case "abstract_class_declaration":
        return this.declareClass(node, node.childForFieldName("name"), scope);
      case "method_definition":
        return this.declare(node, node.childForFieldName("name"), "method", scope, node.childForFieldName("body"));
      case "public_field_definition":
      case "field_definition":
        return this.field(node, scope);
      case "interface_declaration":
        return this.declare(node, node.childForFieldName("name"), "interface", scope, node.childForFieldName("body"), false);
      case "enum_declaration":
        return this.declare(node, node.childForFieldName("name"), "enum", scope, node.childForFieldName("body"), false);
      case "variable_declarator":
        return this.declarator(node, scope);
      case "assignment_expression":
        return this.assignment(node, scope);
      case "export_statement":
        return this.exportStatement(node, scope);
      case "import_statement":
        return this.importStatement(node);
      case "call_expression":
        return this.call(node, scope);
      case "new_expression":
        return this.construct(node, scope);
      case "function_signature":
      case "method_signature":
      case "abstract_method_signature":
        return;
      default:
        return this.visitChildren(node, scope);
    }
  }

  protected finish(): void {
    for (const symbol of this.facts.symbols) {
      if (symbol.kind !== "module" && symbol.owner === null && this.exportedNames.has(symbol.name)) symbol.exported = true;
    }
  }

  private isExported(node: SyntaxNode, scope: Scope): boolean {
    if (scope.symbol !== 0) return false;
    const parent = node.parent;
    if (parent?.type === "export_statement") return true;
    return !!parent && declarationTypes.has(parent.type) && parent.parent?.type === "export_statement";
  }

  private declare(
    node: SyntaxNode,
    nameNode: SyntaxNode | null,
    kind: "function" | "method" | "interface" | "enum",
    scope: Scope,
    body: SyntaxNode | null,
    descend = true,
    options: { signatureFrom?: SyntaxNode; exported?: boolean } = {},
  ): void {
    const name = nameNode?.text;
    if (!name) return this.visitChildren(node, scope);
    const owner = kind === "method" && scope.classBody ? scope.owner : null;
    const index = this.addSymbol(node, name, kind, {
      body,
      signatureFrom: options.signatureFrom,
      exported: options.exported ?? this.isExported(node, scope),
      owner,
    });
    if (descend) this.visitChildren(node, this.enter(scope, index));
  }

  private declareClass(node: SyntaxNode, nameNode: SyntaxNode | null, scope: Scope, signatureFrom?: SyntaxNode, exported?: boolean): void {
    const name = nameNode?.text;
    if (!name) return this.visitChildren(node, scope);
    const index = this.addSymbol(node, name, "class", {
      body: node.childForFieldName("body"),
      signatureFrom,
      exported: exported ?? this.isExported(node, scope),
    });
    this.visitChildren(node, this.enter(scope, index, { owner: name, classBody: true }));
  }

  private field(node: SyntaxNode, scope: Scope): void {
    const value = node.childForFieldName("value");
    const nameNode = node.childForFieldName("name") ?? node.childForFieldName("property");
    if (value && functionValues.has(value.type)) {
      return this.declare(node, nameNode, "method", scope, value.childForFieldName("body"));
    }
    this.visitChildren(node, scope);
  }

  private declarator(node: SyntaxNode, scope: Scope): void {
    const nameNode = node.childForFieldName("name");
    const value = node.childForFieldName("value");
    if (value && this.isRequire(value)) {
      this.addImport(this.stringValue(value.childForFieldName("arguments")?.namedChildren[0] ?? null) ?? "", this.requireBindings(nameNode));
      return;
    }
    if (nameNode?.type === "identifier" && value) {
      const parent = node.parent;
      const single = parent && declarationTypes.has(parent.type) && parent.namedChildCount === 1;
      const signatureFrom = single ? parent : node;
      const exported = parent ? this.isExported(node, scope) : false;
      if (functionValues.has(value.type)) {
        return this.declare(node, nameNode, "function", scope, value.childForFieldName("body"), true, { signatureFrom, exported });
      }
      if (value.type === "class") return this.declareClass(value, nameNode, scope, signatureFrom, exported);
    }
    this.visitChildren(node, scope);
  }

  private assignment(node: SyntaxNode, scope: Scope): void {
    const left = node.childForFieldName("left");
    const right = node.childForFieldName("right");
    const target = this.dottedName(left, memberTypes, ["object", "property"]);
    if (scope.symbol === 0 && target && right) {
      const exportTarget = /^(module\.)?exports(\.|$)/.test(target);
      const property = left?.childForFieldName("property");
      if (exportTarget && target !== "exports" && target !== "module.exports" && property && functionValues.has(right.type)) {
        return this.declare(right, property, "function", scope, right.childForFieldName("body"), true, {
          signatureFrom: node,
          exported: true,
        });
      }
      if ((target === "module.exports" || target === "exports") && right.type === "object") {
        for (const entry of right.namedChildren) {
          if (entry.type === "shorthand_property_identifier") this.exportedNames.add(entry.text);
          if (entry.type === "pair") {
            const value = entry.childForFieldName("value");
            if (value?.type === "identifier") this.exportedNames.add(value.text);
          }
        }
      }
      if ((target === "module.exports" || target === "exports") && right.type === "identifier") {
        this.exportedNames.add(right.text);
        this.facts.defaultExport = right.text;
      }
    }
    this.visitChildren(node, scope);
  }

  private exportStatement(node: SyntaxNode, scope: Scope): void {
    const source = this.stringValue(node.childForFieldName("source"));
    const isDefault = node.children.some((child) => child.type === "default");
    const declaration = node.childForFieldName("declaration");
    const value = node.childForFieldName("value");

    if (isDefault && declaration) {
      const name = declaration.childForFieldName("name")?.text;
      if (name) this.facts.defaultExport = name;
    }
    if (isDefault && value?.type === "identifier") {
      this.facts.defaultExport = value.text;
      this.exportedNames.add(value.text);
    }

    const clause = node.namedChildren.find((child) => child.type === "export_clause");
    if (source !== null) {
      const bindings: Binding[] = [];
      if (clause) {
        for (const specifier of clause.namedChildren) {
          const name = specifier.childForFieldName("name")?.text;
          const alias = specifier.childForFieldName("alias")?.text;
          if (name) bindings.push({ local: alias ?? name, imported: name });
        }
      } else {
        const namespace = node.namedChildren.find((child) => child.type === "namespace_export");
        const alias = namespace?.namedChildren[0]?.text;
        bindings.push({ local: alias ?? "*", imported: "*" });
      }
      this.addImport(source, bindings, true);
      return;
    }
    if (clause) {
      for (const specifier of clause.namedChildren) {
        const name = specifier.childForFieldName("name")?.text;
        if (name) this.exportedNames.add(name);
        if (specifier.childForFieldName("alias")?.text === "default" && name) this.facts.defaultExport = name;
      }
    }
    this.visitChildren(node, scope);
  }

  private importStatement(node: SyntaxNode): void {
    const source = this.stringValue(node.childForFieldName("source"));
    if (source === null) return;
    const bindings: Binding[] = [];
    const clause = node.namedChildren.find((child) => child.type === "import_clause");
    for (const part of clause?.namedChildren ?? []) {
      if (part.type === "identifier") bindings.push({ local: part.text, imported: "default" });
      if (part.type === "namespace_import") {
        const local = part.namedChildren[0]?.text;
        if (local) bindings.push({ local, imported: "*" });
      }
      if (part.type === "named_imports") {
        for (const specifier of part.namedChildren) {
          const name = specifier.childForFieldName("name")?.text;
          const alias = specifier.childForFieldName("alias")?.text;
          if (name) bindings.push({ local: alias ?? name, imported: name });
        }
      }
    }
    this.addImport(source, bindings);
  }

  private isRequire(node: SyntaxNode): boolean {
    if (node.type !== "call_expression") return false;
    const fn = node.childForFieldName("function");
    const first = node.childForFieldName("arguments")?.namedChildren[0];
    return fn?.type === "identifier" && fn.text === "require" && first?.type === "string";
  }

  private requireBindings(pattern: SyntaxNode | null): Binding[] {
    if (!pattern) return [];
    if (pattern.type === "identifier") return [{ local: pattern.text, imported: "*" }];
    if (pattern.type !== "object_pattern") return [];
    const bindings: Binding[] = [];
    for (const entry of pattern.namedChildren) {
      if (entry.type === "shorthand_property_identifier_pattern") bindings.push({ local: entry.text, imported: entry.text });
      if (entry.type === "pair_pattern") {
        const key = entry.childForFieldName("key")?.text;
        const value = entry.childForFieldName("value");
        if (key && value?.type === "identifier") bindings.push({ local: value.text, imported: key });
      }
    }
    return bindings;
  }

  private receiver(node: SyntaxNode | null): Receiver {
    if (!node) return { kind: "expression" };
    if (node.type === "this") return { kind: "self" };
    if (node.type === "super") return { kind: "super" };
    const name = this.dottedName(node, memberTypes, ["object", "property"]);
    return name ? { kind: "name", name } : { kind: "expression" };
  }

  private call(node: SyntaxNode, scope: Scope): void {
    const fn = node.childForFieldName("function");
    if (fn?.type === "identifier") {
      if (this.isRequire(node)) {
        this.addImport(this.stringValue(node.childForFieldName("arguments")?.namedChildren[0] ?? null) ?? "");
        return;
      }
      this.addCall(scope, fn.text, fn, { kind: "none" });
    } else if (fn?.type === "member_expression") {
      const property = fn.childForFieldName("property");
      if (property) this.addCall(scope, property.text, property, this.receiver(fn.childForFieldName("object")));
    } else if (fn?.type === "import") {
      const specifier = this.stringValue(node.childForFieldName("arguments")?.namedChildren[0] ?? null);
      if (specifier) this.addImport(specifier);
    }
    this.visitChildren(node, scope);
  }

  private construct(node: SyntaxNode, scope: Scope): void {
    const constructor = node.childForFieldName("constructor");
    if (constructor?.type === "identifier") {
      this.addCall(scope, constructor.text, constructor, { kind: "none" }, true);
    } else if (constructor?.type === "member_expression") {
      const property = constructor.childForFieldName("property");
      if (property) this.addCall(scope, property.text, property, this.receiver(constructor.childForFieldName("object")), true);
    }
    this.visitChildren(node, scope);
  }
}

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ImportResolver } from "../src/resolve/imports";
import { buildProject } from "./helpers";

describe("import resolution", () => {
  const resolver = new ImportResolver(
    [
      "src/lib/money.ts",
      "src/lib/index.ts",
      "src/app/page.tsx",
      "src/legacy/util.js",
      "pkg/__init__.py",
      "pkg/mod.py",
      "pkg/sub/helper.py",
      "lib/python/tools/report.py",
      "java/src/com/acme/util/Fmt.java",
      "java/src/com/acme/model/User.java",
      "java/src/com/acme/model/Role.java",
      "tools/stock/inventory/store.go",
      "tools/stock/inventory/count.go",
      "tools/stock/main.go",
    ].map((path) => ({ path, language: "typescript" as const, imports: [] })),
  );

  it("resolves JS and TS relative paths, index files and aliases", () => {
    assert.deepEqual(resolver.resolveJavaScript("src/app/page.tsx", "../lib/money"), ["src/lib/money.ts"]);
    assert.deepEqual(resolver.resolveJavaScript("src/app/page.tsx", "../lib/money.js"), ["src/lib/money.ts"]);
    assert.deepEqual(resolver.resolveJavaScript("src/app/page.tsx", "../lib"), ["src/lib/index.ts"]);
    assert.deepEqual(resolver.resolveJavaScript("src/app/page.tsx", "@/lib/money"), ["src/lib/money.ts"]);
    assert.deepEqual(resolver.resolveJavaScript("src/app/page.tsx", "../legacy/util"), ["src/legacy/util.js"]);
    assert.deepEqual(resolver.resolveJavaScript("src/app/page.tsx", "react"), []);
  });

  it("resolves Python absolute, relative and package imports", () => {
    assert.deepEqual(resolver.resolvePython("pkg/sub/helper.py", "..mod"), ["pkg/mod.py"]);
    assert.deepEqual(resolver.resolvePython("pkg/sub/helper.py", ".."), ["pkg/__init__.py"]);
    assert.deepEqual(resolver.resolvePython("main.py", "pkg.mod"), ["pkg/mod.py"]);
    assert.deepEqual(resolver.resolvePython("main.py", "pkg"), ["pkg/__init__.py"]);
    assert.deepEqual(resolver.resolvePython("main.py", "tools.report"), ["lib/python/tools/report.py"]);
    assert.deepEqual(resolver.resolvePython("main.py", "json"), []);
  });

  it("resolves Java class, static and wildcard imports", () => {
    assert.deepEqual(resolver.resolveJava("com.acme.util.Fmt"), ["java/src/com/acme/util/Fmt.java"]);
    assert.deepEqual(resolver.resolveJava("com.acme.util.Fmt.Inner"), ["java/src/com/acme/util/Fmt.java"]);
    assert.deepEqual(resolver.resolveJava("com.acme.model.*").sort(), ["java/src/com/acme/model/Role.java", "java/src/com/acme/model/User.java"]);
    assert.deepEqual(resolver.resolveJava("java.util.List"), []);
  });

  it("resolves Go import paths to every file in the matching directory", () => {
    assert.deepEqual(resolver.resolveGo("example.com/acme/tools/stock/inventory").sort(), [
      "tools/stock/inventory/count.go",
      "tools/stock/inventory/store.go",
    ]);
    assert.deepEqual(resolver.resolveGo("fmt"), []);
  });
});

describe("call resolution", () => {
  it("scores same-file, imported, self and typed calls", async () => {
    const project = await buildProject({
      "src/lib/money.ts": `export function round(value: number) {\n  return Math.round(value);\n}\nexport function format(value: number) {\n  return String(round(value));\n}\n`,
      "src/orders/service.ts": `import { format as fmt } from "../lib/money";\nimport * as money from "../lib/money";\n\nexport class OrderService {\n  create() {\n    this.check();\n    return fmt(money.round(1));\n  }\n  check() {}\n}\n`,
      "src/app/route.ts": `import { OrderService } from "../orders/service";\n\nconst service = new OrderService();\n\nexport async function POST() {\n  return service.create();\n}\n`,
    });
    assert.equal(project.edge("src/lib/money.ts#format", "src/lib/money.ts#round")?.confidence, 1);
    assert.equal(project.edge("src/orders/service.ts#create", "src/orders/service.ts#check")?.confidence, 0.95);
    assert.equal(project.edge("src/orders/service.ts#create", "src/lib/money.ts#format")?.confidence, 0.9);
    assert.equal(project.edge("src/orders/service.ts#create", "src/lib/money.ts#round")?.confidence, 0.9);
    assert.equal(project.edge("src/app/route.ts#src/app/route.ts", "src/orders/service.ts#OrderService")?.confidence, 0.9);
    assert.equal(project.edge("src/app/route.ts#POST", "src/orders/service.ts#create")?.confidence, 0.85);
    assert.equal(project.calls.length, 6);
  });

  it("follows re-exports through index files", async () => {
    const project = await buildProject({
      "lib/csv.ts": `export function toCsv() {}\n`,
      "lib/format.ts": `export function formatRow() {}\n`,
      "lib/index.ts": `export { toCsv as csv } from "./csv";\nexport * from "./format";\n`,
      "app.ts": `import { csv, formatRow } from "./lib";\nexport function run() {\n  csv();\n  formatRow();\n}\n`,
    });
    assert.equal(project.edge("app.ts#run", "lib/csv.ts#toCsv")?.confidence, 0.9);
    assert.equal(project.edge("app.ts#run", "lib/format.ts#formatRow")?.confidence, 0.9);
  });

  it("falls back to unique and ambiguous names across the repo", async () => {
    const project = await buildProject({
      "a.py": `def unique_helper():\n    pass\n\n\ndef shared():\n    pass\n`,
      "b.py": `def shared():\n    pass\n`,
      "c.py": `def run(thing):\n    unique_helper()\n    shared()\n    thing.missing()\n`,
    });
    assert.equal(project.edge("c.py#run", "a.py#unique_helper")?.confidence, 0.6);
    assert.equal(project.edge("c.py#run", "a.py#shared")?.confidence, 0.25);
    assert.equal(project.edge("c.py#run", "b.py#shared")?.confidence, 0.25);
    assert.equal(project.calls.length, 3);
  });

  it("drops calls into third-party imports and built-in members", async () => {
    const project = await buildProject({
      "src/a.ts": `import path from "node:path";\nexport function resolve() {}\nexport function push() {}\nexport function run(items: string[]) {\n  path.resolve("x");\n  items.push("y");\n}\n`,
      "src/b.ts": `export class Queue {\n  push() {}\n}\n`,
    });
    assert.deepEqual(project.calls, []);
  });

  it("resolves Python modules imported from a package", async () => {
    const project = await buildProject({
      "pkg/__init__.py": "",
      "pkg/loader.py": `def load():\n    pass\n`,
      "main.py": `from pkg import loader\n\n\ndef run():\n    loader.load()\n`,
    });
    assert.equal(project.edge("main.py#run", "pkg/loader.py#load")?.confidence, 0.9);
    assert.ok(project.links.get("main.py")?.edges.has("pkg/loader.py"));
  });

  it("resolves Go package calls and same-package functions", async () => {
    const project = await buildProject({
      "inventory/store.go": `package inventory\n\ntype Store struct{}\n\nfunc NewStore() *Store {\n\treturn &Store{}\n}\n\nfunc (s *Store) Add(n int) {\n\ts.clamp(n)\n}\n\nfunc (s *Store) clamp(n int) int {\n\treturn helper(n)\n}\n`,
      "inventory/helper.go": `package inventory\n\nfunc helper(n int) int {\n\treturn n\n}\n`,
      "main.go": `package main\n\nimport "example.com/shop/inventory"\n\nfunc main() {\n\tstore := inventory.NewStore()\n\tvar s inventory.Store\n\ts.Add(1)\n\t_ = store\n}\n`,
    });
    assert.equal(project.edge("main.go#main", "inventory/store.go#NewStore")?.confidence, 0.9);
    assert.equal(project.edge("main.go#main", "inventory/store.go#Add")?.confidence, 0.85);
    assert.equal(project.edge("inventory/store.go#Add", "inventory/store.go#clamp")?.confidence, 0.95);
    assert.equal(project.edge("inventory/store.go#clamp", "inventory/helper.go#helper")?.confidence, 0.85);
  });

  it("resolves Java constructors, this calls and static members", async () => {
    const project = await buildProject({
      "src/com/acme/util/Fmt.java": `package com.acme.util;\n\npublic class Fmt {\n    public static String pad(String s) {\n        return s;\n    }\n}\n`,
      "src/com/acme/Invoice.java": `package com.acme;\n\npublic class Invoice {\n    public double total() {\n        return tax();\n    }\n    private double tax() {\n        return 1;\n    }\n}\n`,
      "src/com/acme/App.java": `package com.acme;\n\nimport com.acme.util.Fmt;\n\npublic class App {\n    public static void main(String[] args) {\n        Invoice invoice = new Invoice();\n        Fmt.pad(String.valueOf(invoice.total()));\n    }\n}\n`,
    });
    assert.equal(project.edge("src/com/acme/App.java#main", "src/com/acme/Invoice.java#Invoice")?.confidence, 0.85);
    assert.equal(project.edge("src/com/acme/App.java#main", "src/com/acme/Invoice.java#total")?.confidence, 0.85);
    assert.equal(project.edge("src/com/acme/App.java#main", "src/com/acme/util/Fmt.java#pad")?.confidence, 0.9);
    assert.equal(project.edge("src/com/acme/Invoice.java#total", "src/com/acme/Invoice.java#tax")?.confidence, 0.95);
  });
});

describe("entry points", () => {
  it("flags mains, route handlers, scripts and unused exports", async () => {
    const project = await buildProject({
      "src/app/api/orders/route.ts": `import { load } from "../../../lib/load";\nexport async function GET() {\n  return load();\n}\nexport function helper() {}\n`,
      "src/lib/load.ts": `export function load() {\n  return inner();\n}\nfunction inner() {}\n`,
      "scripts/report.py": `def build():\n    pass\n\n\nif __name__ == "__main__":\n    build()\n`,
      "cmd/main.go": `package main\n\ntype Config struct{}\n\nfunc main() {}\n`,
      "tools/seed.js": `console.log("seeding");\n`,
    });
    const entries = [...project.entries].map((id) => `${project.graph.symbols[id].path}#${project.graph.symbols[id].name}`).sort();
    assert.deepEqual(entries, [
      "cmd/main.go#main",
      "scripts/report.py#scripts/report.py",
      "src/app/api/orders/route.ts#GET",
      "src/app/api/orders/route.ts#helper",
      "tools/seed.js#tools/seed.js",
    ]);
  });
});

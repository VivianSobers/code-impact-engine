import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FileFacts } from "../src/extract/types";
import { parseFile } from "./helpers";

function symbols(facts: FileFacts) {
  return facts.symbols.map((symbol) => `${symbol.kind} ${symbol.owner ? `${symbol.owner}.` : ""}${symbol.name} ${symbol.startLine}-${symbol.endLine}`);
}

function calls(facts: FileFacts) {
  return facts.calls.map((call) => {
    const receiver = call.receiver.kind === "name" ? call.receiver.name : call.receiver.kind;
    return `${facts.symbols[call.caller].name} -> ${call.construct ? "new " : ""}${call.name} @${call.line} [${receiver}]`;
  });
}

describe("TypeScript extraction", async () => {
  const file = await parseFile(
    "src/orders/service.ts",
    `import { priceOrder as price } from "./pricing";
import * as log from "../lib/log";

export interface Order {
  id: string;
}

export class OrderService {
  private store = new Map<string, Order>();

  create(id: string): Order {
    const order = { id, total: price([]) };
    this.save(order);
    log.write("created");
    return order;
  }

  private save(order: Order): void {
    this.store.set(order.id, order);
  }
}

export const handler = async (service: OrderService) => service.create("x");
export default function main() {
  return new OrderService();
}
main();
`,
  );

  it("finds the module, classes, methods, interfaces and arrow functions", () => {
    assert.deepEqual(symbols(file.facts), [
      "module src/orders/service.ts 1-27",
      "interface Order 4-6",
      "class OrderService 8-21",
      "method OrderService.create 11-16",
      "method OrderService.save 18-20",
      "function handler 23-23",
      "function main 24-26",
    ]);
    assert.equal(file.loc, 27);
  });

  it("keeps declaration headers as signatures", () => {
    const signature = (name: string) => file.facts.symbols.find((symbol) => symbol.name === name)?.signature;
    assert.equal(signature("create"), "create(id: string): Order");
    assert.equal(signature("OrderService"), "class OrderService");
    assert.equal(signature("handler"), "const handler = async (service: OrderService) =>");
    assert.equal(signature("src/orders/service.ts"), null);
  });

  it("marks exports and the default export", () => {
    const exported = file.facts.symbols.filter((symbol) => symbol.exported).map((symbol) => symbol.name);
    assert.deepEqual(exported, ["Order", "OrderService", "handler", "main"]);
    assert.equal(file.facts.defaultExport, "main");
  });

  it("attributes calls to the innermost symbol and classifies receivers", () => {
    assert.deepEqual(calls(file.facts), [
      "OrderService -> new Map @9 [none]",
      "create -> price @12 [none]",
      "create -> save @13 [self]",
      "create -> write @14 [log]",
      "save -> set @19 [this.store]",
      "handler -> create @23 [service]",
      "main -> new OrderService @25 [none]",
      "src/orders/service.ts -> main @27 [none]",
    ]);
    assert.equal(file.facts.topLevelCalls, 1);
  });

  it("records imports with their bindings", () => {
    assert.deepEqual(file.facts.imports, [
      { specifier: "./pricing", bindings: [{ local: "price", imported: "priceOrder" }], reexport: false },
      { specifier: "../lib/log", bindings: [{ local: "log", imported: "*" }], reexport: false },
    ]);
  });

  it("records types for parameters and constructed fields", () => {
    assert.equal(file.facts.localTypes.get("service"), "OrderService");
    assert.equal(file.facts.localTypes.get("this.store"), "Map");
    assert.equal(file.facts.localTypes.get("order"), "Order");
  });
});

describe("JavaScript extraction", () => {
  it("handles CommonJS exports and require bindings", async () => {
    const file = await parseFile(
      "lib/csv.js",
      `const { formatRow: fmt } = require("./format");
const util = require("./util");

exports.toCsv = function (rows) {
  return rows.map((row) => fmt(row)).join("\\n");
};

function helper() {
  util.log();
}

module.exports.helper = helper;
`,
    );
    assert.deepEqual(symbols(file.facts), ["module lib/csv.js 1-12", "function toCsv 4-6", "function helper 8-10"]);
    assert.equal(file.facts.symbols[1].exported, true);
    assert.deepEqual(file.facts.imports.map((entry) => [entry.specifier, entry.bindings]), [
      ["./format", [{ local: "fmt", imported: "formatRow" }]],
      ["./util", [{ local: "util", imported: "*" }]],
    ]);
    assert.deepEqual(calls(file.facts), ["toCsv -> join @5 [expression]", "toCsv -> map @5 [rows]", "toCsv -> fmt @5 [none]", "helper -> log @9 [util]"]);
    assert.equal(file.facts.symbols.find((symbol) => symbol.name === "helper")?.exported, true);
  });

  it("treats functions assigned to object properties as methods of that object", async () => {
    const file = await parseFile(
      "lib/response.js",
      `var res = Object.create(null);\n\nres.send = function send(body) {\n  return this.json(body);\n};\n\nApp.prototype.listen = function () {};\n`,
    );
    assert.deepEqual(symbols(file.facts), ["module lib/response.js 1-7", "method res.send 3-5", "method App.listen 7-7"]);
    assert.equal(file.facts.symbols[1].signature, "res.send = function send(body)");
    assert.deepEqual(calls(file.facts), ["lib/response.js -> create @1 [Object]", "send -> json @4 [self]"]);
  });

  it("treats export-from statements as re-exports", async () => {
    const file = await parseFile("lib/index.ts", `export { toCsv as csv } from "./csv";\nexport * from "./format";\n`);
    assert.deepEqual(file.facts.imports, [
      { specifier: "./csv", bindings: [{ local: "csv", imported: "toCsv" }], reexport: true },
      { specifier: "./format", bindings: [{ local: "*", imported: "*" }], reexport: true },
    ]);
  });
});

describe("Python extraction", async () => {
  const file = await parseFile(
    "analytics/stats.py",
    `from collections import Counter
from .loader import load_orders as load
import analytics.format as fmt


class Totals:
    def __init__(self):
        self.count = 0

    def add(self, order: dict):
        self.count += 1
        fmt.money(self.line_total(order))

    def _line_total(self, order):
        return order["qty"]


def summarize(path):
    totals = Totals()
    for order in load(path):
        totals.add(order)
    return totals


if __name__ == "__main__":
    summarize("orders.json")
`,
  );

  it("finds classes, methods and functions", () => {
    assert.deepEqual(symbols(file.facts), [
      "module analytics/stats.py 1-26",
      "class Totals 6-15",
      "method Totals.__init__ 7-8",
      "method Totals.add 10-12",
      "method Totals._line_total 14-15",
      "function summarize 18-22",
    ]);
    assert.equal(file.facts.symbols.find((symbol) => symbol.name === "add")?.signature, "def add(self, order: dict)");
  });

  it("detects the main guard and top-level calls", () => {
    assert.equal(file.facts.mainGuard, true);
    assert.equal(file.facts.topLevelCalls, 1);
  });

  it("classifies self, module and plain calls", () => {
    assert.deepEqual(calls(file.facts), [
      "add -> money @12 [fmt]",
      "add -> line_total @12 [self]",
      "summarize -> Totals @19 [none]",
      "summarize -> load @20 [none]",
      "summarize -> add @21 [totals]",
      "analytics/stats.py -> summarize @26 [none]",
    ]);
  });

  it("records relative and aliased imports", () => {
    assert.deepEqual(file.facts.imports.map((entry) => [entry.specifier, entry.bindings]), [
      ["collections", [{ local: "Counter", imported: "Counter" }]],
      [".loader", [{ local: "load", imported: "load_orders" }]],
      ["analytics.format", [{ local: "fmt", imported: "*" }]],
    ]);
    assert.equal(file.facts.localTypes.get("totals"), "Totals");
    assert.equal(file.facts.localTypes.get("order"), "dict");
  });
});

describe("Java extraction", () => {
  it("finds types, methods, constructors and main", async () => {
    const file = await parseFile(
      "src/com/acme/App.java",
      `package com.acme;

import com.acme.util.Fmt;
import static com.acme.util.Fmt.pad;
import com.acme.model.*;

public class App {
    private final Store store = new Store();

    public App() {
        init();
    }

    public static void main(String[] args) {
        App app = new App();
        app.run(Fmt.pad("x"));
    }

    void run(String value) {
        this.store.save(value);
    }

    private void init() {}
}

interface Store {
    void save(String value);
}
`,
    );
    assert.equal(file.facts.packageName, "com.acme");
    assert.deepEqual(symbols(file.facts), [
      "module src/com/acme/App.java 1-28",
      "class App 7-24",
      "method App.App 10-12",
      "method App.main 14-17",
      "method App.run 19-21",
      "method App.init 23-23",
      "interface Store 26-28",
    ]);
    const main = file.facts.symbols.find((symbol) => symbol.name === "main");
    assert.equal(main?.mainLike, true);
    assert.equal(main?.exported, true);
    assert.deepEqual(calls(file.facts), [
      "App -> new Store @8 [none]",
      "App -> init @11 [none]",
      "main -> new App @15 [none]",
      "main -> run @16 [app]",
      "main -> pad @16 [Fmt]",
      "run -> save @20 [this.store]",
    ]);
    assert.deepEqual(file.facts.imports.map((entry) => [entry.specifier, entry.bindings]), [
      ["com.acme.util.Fmt", [{ local: "Fmt", imported: "*" }]],
      ["com.acme.util.Fmt", [{ local: "pad", imported: "pad" }]],
      ["com.acme.model.*", [{ local: "*", imported: "*" }]],
    ]);
    assert.equal(file.facts.localTypes.get("app"), "App");
    assert.equal(file.facts.localTypes.get("this.store"), "Store");
  });
});

describe("Go extraction", () => {
  it("finds functions, methods with receivers, structs and interfaces", async () => {
    const file = await parseFile(
      "cmd/stock/main.go",
      `package main

import (
	"fmt"
	inv "example.com/acme/inventory"
)

type Server struct {
	store *inv.Store
}

type Runner interface {
	Run() error
}

func (s *Server) Start(name string) {
	s.stop()
	s.store.Add(name)
	fmt.Println(name)
}

func main() {
	srv := &Server{}
	srv.Start(inv.Default())
}
`,
    );
    assert.equal(file.facts.packageName, "main");
    assert.deepEqual(symbols(file.facts), [
      "module cmd/stock/main.go 1-25",
      "class Server 8-10",
      "interface Runner 12-14",
      "method Server.Start 16-20",
      "function main 22-25",
    ]);
    assert.equal(file.facts.symbols.find((symbol) => symbol.name === "main")?.mainLike, true);
    assert.equal(file.facts.symbols.find((symbol) => symbol.name === "Start")?.selfName, "s");
    assert.deepEqual(calls(file.facts), [
      "Start -> stop @17 [self]",
      "Start -> Add @18 [s.store]",
      "Start -> Println @19 [fmt]",
      "main -> Start @24 [srv]",
      "main -> Default @24 [inv]",
    ]);
    assert.deepEqual(file.facts.imports.map((entry) => [entry.specifier, entry.bindings]), [
      ["fmt", [{ local: "fmt", imported: "*" }]],
      ["example.com/acme/inventory", [{ local: "inv", imported: "*" }]],
    ]);
    assert.equal(file.facts.localTypes.get("srv"), "Server");
  });
});

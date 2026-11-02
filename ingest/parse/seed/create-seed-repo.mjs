import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../workdir/seed-repo");

const asha = { name: "Asha Rao", email: "asha.rao@acme.example" };
const ben = { name: "Ben Okafor", email: "ben@acme.example" };
const benPersonal = { name: "Ben Okafor", email: "ben.okafor@mail.example" };
const chen = { name: "Chen Li", email: "chen.li@acme.example" };

const files = {
  readme: `# acme-shop

Sample project used to seed the code impact engine. It has a small order API in TypeScript, a CSV helper in JavaScript, a reporting script in Python, a stock CLI in Go and an invoice app in Java.
`,
  money1: `export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatMoney(value: number, currency = "USD"): string {
  return \`\${currency} \${roundCurrency(value).toFixed(2)}\`;
}
`,
  money2: `export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatMoney(value: number, currency = "USD"): string {
  return \`\${currency} \${roundCurrency(value).toFixed(2)}\`;
}
`,
  log: `export function logEvent(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...data, at: new Date().toISOString() }));
}
`,
  pricing1: `import { roundCurrency } from "../lib/money";

export interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
}

export function subtotal(items: LineItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

export function applyDiscount(amount: number): number {
  return roundCurrency(amount);
}

export function priceOrder(items: LineItem[]): number {
  return applyDiscount(subtotal(items));
}
`,
  pricing2: `import { roundCurrency } from "../lib/money";

export interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
}

const discounts: Record<string, number> = { WELCOME10: 0.1, LOYAL20: 0.2 };

export function subtotal(items: LineItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

export function applyDiscount(amount: number, code?: string): number {
  const rate = code ? discounts[code] ?? 0 : 0;
  return roundCurrency(amount * (1 - rate));
}

export function priceOrder(items: LineItem[], code?: string): number {
  return applyDiscount(subtotal(items), code);
}
`,
  address1: `export interface Address {
  line1: string;
  city: string;
  postcode: string;
}

export function parseAddress(raw: string | string[]): Address {
  if (Array.isArray(raw)) return normalizeAddress(raw);
  return normalizeAddress(raw.split(","));
}

export function normalizeAddress(parts: string[]): Address {
  const cleaned = parts.map((part) => part.trim()).filter(Boolean);
  const [line1 = "", city = "", postcode = ""] = cleaned;
  return { line1, city, postcode: postcode.toUpperCase() };
}
`,
  address2: `export interface Address {
  line1: string;
  city: string;
  postcode: string;
}

export function parseAddress(raw: string | string[]): Address {
  if (Array.isArray(raw)) return normalizeAddress(raw);
  return normalizeAddress(raw.split(","));
}

export function normalizeAddress(parts: string[]): Address {
  const cleaned = parts.map((part) => part.trim()).filter(Boolean);
  if (cleaned.length === 1 && cleaned[0].includes(";")) return parseAddress(cleaned[0].split(";"));
  const [line1 = "", city = "", postcode = ""] = cleaned;
  return { line1, city, postcode: postcode.toUpperCase() };
}
`,
  service1: `import { priceOrder, type LineItem } from "./pricing";
import { parseAddress, type Address } from "./address";

export interface Order {
  id: string;
  items: LineItem[];
  total: number;
  shipTo: Address;
}

const orders = new Map<string, Order>();

export class OrderService {
  create(items: LineItem[], address: string): Order {
    const order = { id: this.nextId(), items, total: priceOrder(items), shipTo: parseAddress(address) };
    orders.set(order.id, order);
    return order;
  }

  find(id: string): Order | undefined {
    return orders.get(id);
  }

  private nextId(): string {
    return \`ord_\${orders.size + 1}\`;
  }
}
`,
  service2: `import { priceOrder, type LineItem } from "./pricing";
import { parseAddress, type Address } from "./address";

export interface Order {
  id: string;
  items: LineItem[];
  total: number;
  shipTo: Address;
}

const orders = new Map<string, Order>();

export class OrderService {
  create(items: LineItem[], address: string, code?: string): Order {
    const order = { id: this.nextId(), items, total: priceOrder(items, code), shipTo: parseAddress(address) };
    orders.set(order.id, order);
    return order;
  }

  find(id: string): Order | undefined {
    return orders.get(id);
  }

  private nextId(): string {
    return \`ord_\${orders.size + 1}\`;
  }
}
`,
  service3: `import { priceOrder, type LineItem } from "./pricing";
import { parseAddress, type Address } from "./address";
import { logEvent } from "../lib/log";
import { formatMoney } from "../lib/money";

export interface Order {
  id: string;
  items: LineItem[];
  total: number;
  shipTo: Address;
}

const orders = new Map<string, Order>();

export class OrderService {
  create(items: LineItem[], address: string, code?: string): Order {
    const order = { id: this.nextId(), items, total: priceOrder(items, code), shipTo: parseAddress(address) };
    orders.set(order.id, order);
    logEvent("order.created", { id: order.id, total: formatMoney(order.total) });
    return order;
  }

  find(id: string): Order | undefined {
    return orders.get(id);
  }

  private nextId(): string {
    return \`ord_\${orders.size + 1}\`;
  }
}
`,
  route1: `import { OrderService } from "../../../orders/service";

const service = new OrderService();

export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const order = service.find(id);
  return order ? Response.json(order) : new Response("not found", { status: 404 });
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json();
  return Response.json(service.create(body.items, body.address), { status: 201 });
}
`,
  route2: `import { OrderService } from "../../../orders/service";

const service = new OrderService();

export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const order = service.find(id);
  return order ? Response.json(order) : new Response("not found", { status: 404 });
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json();
  const order = service.create(body.items, body.address, body.code);
  return Response.json(order, { status: 201 });
}
`,
  csv: `const { formatRow } = require("./format");

function toCsv(rows) {
  return rows.map((row) => formatRow(row)).join("\\n");
}

module.exports = { toCsv };
`,
  format: `exports.formatRow = function (row) {
  return row.map(escapeCell).join(",");
};

function escapeCell(value) {
  const text = String(value);
  return /[",\\n]/.test(text) ? \`"\${text.replace(/"/g, '""')}"\` : text;
}
`,
  loader: `import json


def load_orders(path):
    with open(path) as handle:
        return [normalize(row) for row in json.load(handle)]


def normalize(row):
    row["quantity"] = int(row.get("quantity", 1))
    return row
`,
  stats1: `from collections import Counter


class Totals:
    def __init__(self):
        self.count = 0
        self.revenue = 0.0

    def add(self, order):
        self.count += 1
        self.revenue += order["quantity"] * order["unit_price"]


def summarize(orders):
    totals = Totals()
    for order in orders:
        totals.add(order)
    return {"count": totals.count, "revenue": round(totals.revenue, 2)}


def top_skus(orders, limit=5):
    counts = Counter(order["sku"] for order in orders)
    return [sku for sku, _ in counts.most_common(limit)]
`,
  stats2: `from collections import Counter


class Totals:
    def __init__(self):
        self.count = 0
        self.revenue = 0.0

    def add(self, order):
        self.count += 1
        self.revenue += self.line_total(order)

    def line_total(self, order):
        return order["quantity"] * order["unit_price"]


def summarize(orders):
    totals = Totals()
    for order in orders:
        totals.add(order)
    return {"count": totals.count, "revenue": round(totals.revenue, 2)}


def top_skus(orders, limit=5):
    counts = Counter(order["sku"] for order in orders)
    return [sku for sku, _ in counts.most_common(limit)]
`,
  report: `from analytics.loader import load_orders
from analytics.stats import summarize, top_skus


def build_report(path):
    orders = load_orders(path)
    summary = summarize(orders)
    summary["top"] = top_skus(orders, limit=3)
    return summary


if __name__ == "__main__":
    import sys

    print(build_report(sys.argv[1]))
`,
  goMod: `module example.com/acme/tools/stock

go 1.22
`,
  goMain: `package main

import (
	"fmt"
	"os"

	"example.com/acme/tools/stock/inventory"
)

func main() {
	store := inventory.NewStore()
	store.Add("sku-1", 4)
	if err := run(store, os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(store *inventory.Store, args []string) error {
	for _, sku := range args {
		fmt.Println(sku, store.Count(sku))
	}
	return nil
}
`,
  goStore: `package inventory

type Store struct {
	counts map[string]int
}

func NewStore() *Store {
	return &Store{counts: map[string]int{}}
}

func (s *Store) Add(sku string, n int) {
	s.counts[sku] = s.clamp(s.counts[sku] + n)
}

func (s *Store) Count(sku string) int {
	return s.counts[sku]
}

func (s *Store) clamp(n int) int {
	if n < 0 {
		return 0
	}
	return n
}
`,
  invoice: `package com.acme.billing;

public class Invoice {
    private final double amount;

    public Invoice(double amount) {
        this.amount = amount;
    }

    public double total() {
        return withTax(amount);
    }

    private double withTax(double value) {
        return Math.round(value * 118.0) / 100.0;
    }
}
`,
  invoiceApp: `package com.acme.billing;

public class InvoiceApp {
    public static void main(String[] args) {
        Invoice invoice = new Invoice(Double.parseDouble(args[0]));
        System.out.println(invoice.total());
    }
}
`,
};

const commits = [
  {
    author: asha,
    date: "2026-09-01T09:00:00+05:30",
    message: "Add money and pricing helpers",
    files: {
      "README.md": files.readme,
      "src/lib/money.ts": files.money1,
      "src/lib/log.ts": files.log,
      "src/orders/pricing.ts": files.pricing1,
    },
  },
  {
    author: ben,
    date: "2026-09-02T11:30:00+05:30",
    message: "Add order service and address parsing",
    files: { "src/orders/address.ts": files.address1, "src/orders/service.ts": files.service1 },
  },
  {
    author: asha,
    date: "2026-09-03T15:10:00+05:30",
    message: "Add orders API route",
    files: { "src/app/api/orders/route.ts": files.route1 },
  },
  {
    author: chen,
    date: "2026-09-04T10:05:00+05:30",
    message: "Add daily report script",
    files: {
      "analytics/__init__.py": "",
      "analytics/loader.py": files.loader,
      "analytics/stats.py": files.stats1,
      "scripts/daily_report.py": files.report,
    },
  },
  {
    author: benPersonal,
    date: "2026-09-05T21:45:00+05:30",
    message: "Support discount codes",
    files: {
      "src/orders/pricing.ts": files.pricing2,
      "src/orders/service.ts": files.service2,
      "src/app/api/orders/route.ts": files.route2,
    },
  },
  {
    author: chen,
    date: "2026-09-06T12:20:00+05:30",
    message: "Add stock CLI",
    files: {
      "tools/stock/go.mod": files.goMod,
      "tools/stock/main.go": files.goMain,
      "tools/stock/inventory/store.go": files.goStore,
    },
  },
  {
    author: asha,
    date: "2026-09-07T16:00:00+05:30",
    message: "Add invoice app",
    files: {
      "java/src/com/acme/billing/Invoice.java": files.invoice,
      "java/src/com/acme/billing/InvoiceApp.java": files.invoiceApp,
    },
  },
  {
    author: ben,
    date: "2026-09-08T10:40:00+05:30",
    message: "Log formatted totals and accept semicolon separated addresses",
    files: { "src/orders/service.ts": files.service3, "src/orders/address.ts": files.address2 },
  },
  {
    author: chen,
    date: "2026-09-09T14:15:00+05:30",
    message: "Add CSV export and split out line totals",
    files: {
      "analytics/stats.py": files.stats2,
      "src/legacy/csv.js": files.csv,
      "src/legacy/format.js": files.format,
    },
  },
  {
    author: asha,
    date: "2026-09-10T09:25:00+05:30",
    message: "Round half cents up",
    files: { "src/lib/money.ts": files.money2 },
  },
];

function git(args, env = {}) {
  return execFileSync("git", ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", ...args], {
    cwd: target,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "inherit"],
  }).toString();
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
git(["init", "--quiet", "--initial-branch=main"]);

for (const commit of commits) {
  for (const [file, content] of Object.entries(commit.files)) {
    const full = path.join(target, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  git(["add", "--all"]);
  git(["commit", "--quiet", "-m", commit.message], {
    GIT_AUTHOR_NAME: commit.author.name,
    GIT_AUTHOR_EMAIL: commit.author.email,
    GIT_AUTHOR_DATE: commit.date,
    GIT_COMMITTER_NAME: commit.author.name,
    GIT_COMMITTER_EMAIL: commit.author.email,
    GIT_COMMITTER_DATE: commit.date,
  });
}

const head = git(["rev-parse", "HEAD"]).trim();
process.stderr.write(`Created ${target} with ${commits.length} commits, HEAD ${head}\n`);

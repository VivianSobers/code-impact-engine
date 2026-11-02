BEGIN;

INSERT INTO repository (repo_id, name, url, default_branch, added_date) OVERRIDING SYSTEM VALUE
VALUES
    (1, 'seed-repo', 'ingest/workdir/seed-repo', 'main', '2026-09-10 12:00:00+05:30');

INSERT INTO file (repo_id, path, language, loc, content_hash, ast_doc_id)
VALUES
    (1, 'analytics/__init__.py', 'python', 0, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', NULL),
    (1, 'analytics/loader.py', 'python', 11, '912c451f82d1cc6f9bbd91e596532082d575a61dfae7fd54b5fd67977a6785fe', NULL),
    (1, 'analytics/stats.py', 'python', 26, '6ff0100df1c959afb0425c4a5328c6db7d68c19790db1720d159282a8a4f52ff', NULL),
    (1, 'java/src/com/acme/billing/InvoiceApp.java', 'java', 8, '3bbed4b2b56457223dec887562dca773c329c9299b3f5dedada5efca3b59708a', NULL),
    (1, 'java/src/com/acme/billing/Invoice.java', 'java', 17, '73c6b4a1cee5157b30cef684667521b098abac9dedb3398a361d3e31b1e8704c', NULL),
    (1, 'scripts/daily_report.py', 'python', 15, '4830611ff87d9a25b4c704035c6fd7c14e8ec5029c3bd3adaf92eb0792a45245', NULL),
    (1, 'src/app/api/orders/route.ts', 'typescript', 15, '93d88abcc647e3b580fbfabeebb86220aab1bc918053f20239a8ab970735f685', NULL),
    (1, 'src/legacy/csv.js', 'javascript', 7, '2e0bc461b303ef5db7245c3382498322aece7d42b59bc131a11ad7e45793e5f5', NULL),
    (1, 'src/legacy/format.js', 'javascript', 8, 'e7145f7d2603c35a9fb02771ba8569540e214c3f6577a31781f15d90769fbb04', NULL),
    (1, 'src/lib/log.ts', 'typescript', 3, '76e533c7330109ca7a3aa6953070a58f7334e924aec766aec3bfe07d2f9f10e1', NULL),
    (1, 'src/lib/money.ts', 'typescript', 7, 'f6ebe17ac0e2afda703d5ca636d11837819a55037c1d2437ce4c1149427ce7ea', NULL),
    (1, 'src/orders/address.ts', 'typescript', 17, '2e9474b29976207209f1631e127173a995a0becb89701d178fc10380146ec8ac', NULL),
    (1, 'src/orders/pricing.ts', 'typescript', 22, '682719e7b362195db951da88e78da303b7730bde80f3723e31345b639160eafb', NULL),
    (1, 'src/orders/service.ts', 'typescript', 30, '7cef8b125aab4246c0b6854984cbcbccd89eaf82a9fa724d4bd4748c4f708343', NULL),
    (1, 'tools/stock/inventory/store.go', 'go', 24, '70da336073b1e531ab24d5348995a3a99c9d3fb98c3a10590faafa4d75893a24', NULL),
    (1, 'tools/stock/main.go', 'go', 24, '2be41c62d00b41a8aa382b0cc1a56ea0363138562b255cd178cfe567bfd0e3c7', NULL);

INSERT INTO symbol (symbol_id, repo_id, path, name, kind, signature, start_line, end_line, is_entry_point) OVERRIDING SYSTEM VALUE
VALUES
    (1, 1, 'analytics/loader.py', 'analytics/loader.py', 'module', NULL, 1, 11, false),
    (2, 1, 'analytics/loader.py', 'load_orders', 'function', 'def load_orders(path)', 4, 6, false),
    (3, 1, 'analytics/loader.py', 'normalize', 'function', 'def normalize(row)', 9, 11, false),
    (4, 1, 'analytics/stats.py', 'analytics/stats.py', 'module', NULL, 1, 26, false),
    (5, 1, 'analytics/stats.py', 'Totals', 'class', 'class Totals', 4, 14, false),
    (6, 1, 'analytics/stats.py', '__init__', 'method', 'def __init__(self)', 5, 7, false),
    (7, 1, 'analytics/stats.py', 'add', 'method', 'def add(self, order)', 9, 11, false),
    (8, 1, 'analytics/stats.py', 'line_total', 'method', 'def line_total(self, order)', 13, 14, false),
    (9, 1, 'analytics/stats.py', 'summarize', 'function', 'def summarize(orders)', 17, 21, false),
    (10, 1, 'analytics/stats.py', 'top_skus', 'function', 'def top_skus(orders, limit=5)', 24, 26, false),
    (11, 1, 'java/src/com/acme/billing/InvoiceApp.java', 'java/src/com/acme/billing/InvoiceApp.java', 'module', NULL, 1, 8, false),
    (12, 1, 'java/src/com/acme/billing/InvoiceApp.java', 'InvoiceApp', 'class', 'public class InvoiceApp', 3, 8, true),
    (13, 1, 'java/src/com/acme/billing/InvoiceApp.java', 'main', 'method', 'public static void main(String[] args)', 4, 7, true),
    (14, 1, 'java/src/com/acme/billing/Invoice.java', 'java/src/com/acme/billing/Invoice.java', 'module', NULL, 1, 17, false),
    (15, 1, 'java/src/com/acme/billing/Invoice.java', 'Invoice', 'class', 'public class Invoice', 3, 17, false),
    (16, 1, 'java/src/com/acme/billing/Invoice.java', 'Invoice', 'method', 'public Invoice(double amount)', 6, 8, false),
    (17, 1, 'java/src/com/acme/billing/Invoice.java', 'total', 'method', 'public double total()', 10, 12, false),
    (18, 1, 'java/src/com/acme/billing/Invoice.java', 'withTax', 'method', 'private double withTax(double value)', 14, 16, false),
    (19, 1, 'scripts/daily_report.py', 'scripts/daily_report.py', 'module', NULL, 1, 15, true),
    (20, 1, 'scripts/daily_report.py', 'build_report', 'function', 'def build_report(path)', 5, 9, false),
    (21, 1, 'src/app/api/orders/route.ts', 'src/app/api/orders/route.ts', 'module', NULL, 1, 15, true),
    (22, 1, 'src/app/api/orders/route.ts', 'GET', 'function', 'async function GET(request: Request): Promise<Response>', 5, 9, true),
    (23, 1, 'src/app/api/orders/route.ts', 'POST', 'function', 'async function POST(request: Request): Promise<Response>', 11, 15, true),
    (24, 1, 'src/legacy/csv.js', 'src/legacy/csv.js', 'module', NULL, 1, 7, false),
    (25, 1, 'src/legacy/csv.js', 'toCsv', 'function', 'function toCsv(rows)', 3, 5, true),
    (26, 1, 'src/legacy/format.js', 'formatRow', 'function', 'exports.formatRow = function (row)', 1, 3, false),
    (27, 1, 'src/legacy/format.js', 'src/legacy/format.js', 'module', NULL, 1, 8, false),
    (28, 1, 'src/legacy/format.js', 'escapeCell', 'function', 'function escapeCell(value)', 5, 8, false),
    (29, 1, 'src/lib/log.ts', 'logEvent', 'function', 'function logEvent(event: string, data: Record<string, unknown> = {}): void', 1, 3, false),
    (30, 1, 'src/lib/log.ts', 'src/lib/log.ts', 'module', NULL, 1, 3, false),
    (31, 1, 'src/lib/money.ts', 'roundCurrency', 'function', 'function roundCurrency(value: number): number', 1, 3, false),
    (32, 1, 'src/lib/money.ts', 'src/lib/money.ts', 'module', NULL, 1, 7, false),
    (33, 1, 'src/lib/money.ts', 'formatMoney', 'function', 'function formatMoney(value: number, currency = "USD"): string', 5, 7, false),
    (34, 1, 'src/orders/address.ts', 'Address', 'interface', 'interface Address', 1, 5, false),
    (35, 1, 'src/orders/address.ts', 'src/orders/address.ts', 'module', NULL, 1, 17, false),
    (36, 1, 'src/orders/address.ts', 'parseAddress', 'function', 'function parseAddress(raw: string | string[]): Address', 7, 10, false),
    (37, 1, 'src/orders/address.ts', 'normalizeAddress', 'function', 'function normalizeAddress(parts: string[]): Address', 12, 17, false),
    (38, 1, 'src/orders/pricing.ts', 'src/orders/pricing.ts', 'module', NULL, 1, 22, false),
    (39, 1, 'src/orders/pricing.ts', 'LineItem', 'interface', 'interface LineItem', 3, 7, false),
    (40, 1, 'src/orders/pricing.ts', 'subtotal', 'function', 'function subtotal(items: LineItem[]): number', 11, 13, false),
    (41, 1, 'src/orders/pricing.ts', 'applyDiscount', 'function', 'function applyDiscount(amount: number, code?: string): number', 15, 18, false),
    (42, 1, 'src/orders/pricing.ts', 'priceOrder', 'function', 'function priceOrder(items: LineItem[], code?: string): number', 20, 22, false),
    (43, 1, 'src/orders/service.ts', 'src/orders/service.ts', 'module', NULL, 1, 30, false),
    (44, 1, 'src/orders/service.ts', 'Order', 'interface', 'interface Order', 6, 11, false),
    (45, 1, 'src/orders/service.ts', 'OrderService', 'class', 'class OrderService', 15, 30, false),
    (46, 1, 'src/orders/service.ts', 'create', 'method', 'create(items: LineItem[], address: string, code?: string): Order', 16, 21, false),
    (47, 1, 'src/orders/service.ts', 'find', 'method', 'find(id: string): Order | undefined', 23, 25, false),
    (48, 1, 'src/orders/service.ts', 'nextId', 'method', 'private nextId(): string', 27, 29, false),
    (49, 1, 'tools/stock/inventory/store.go', 'tools/stock/inventory/store.go', 'module', NULL, 1, 24, false),
    (50, 1, 'tools/stock/inventory/store.go', 'Store', 'class', 'type Store', 3, 5, false),
    (51, 1, 'tools/stock/inventory/store.go', 'NewStore', 'function', 'func NewStore() *Store', 7, 9, false),
    (52, 1, 'tools/stock/inventory/store.go', 'Add', 'method', 'func (s *Store) Add(sku string, n int)', 11, 13, false),
    (53, 1, 'tools/stock/inventory/store.go', 'Count', 'method', 'func (s *Store) Count(sku string) int', 15, 17, false),
    (54, 1, 'tools/stock/inventory/store.go', 'clamp', 'method', 'func (s *Store) clamp(n int) int', 19, 24, false),
    (55, 1, 'tools/stock/main.go', 'tools/stock/main.go', 'module', NULL, 1, 24, false),
    (56, 1, 'tools/stock/main.go', 'main', 'function', 'func main()', 10, 17, true),
    (57, 1, 'tools/stock/main.go', 'run', 'function', 'func run(store *inventory.Store, args []string) error', 19, 24, false);

INSERT INTO calls (caller_id, callee_id, call_line, resolution_confidence)
VALUES
    (2, 3, 6, 1),
    (7, 8, 11, 0.95),
    (9, 5, 18, 1),
    (9, 7, 20, 0.85),
    (13, 15, 5, 0.85),
    (13, 17, 6, 0.85),
    (17, 18, 11, 0.95),
    (19, 20, 15, 1),
    (20, 2, 6, 0.9),
    (20, 9, 7, 0.9),
    (20, 10, 8, 0.9),
    (21, 45, 3, 0.9),
    (22, 47, 7, 0.85),
    (23, 46, 13, 0.85),
    (25, 26, 4, 0.9),
    (33, 31, 6, 1),
    (36, 37, 8, 1),
    (36, 37, 9, 1),
    (37, 36, 14, 1),
    (41, 31, 17, 0.9),
    (42, 40, 21, 1),
    (42, 41, 21, 1),
    (46, 29, 19, 0.9),
    (46, 33, 19, 0.9),
    (46, 36, 17, 0.9),
    (46, 42, 17, 0.9),
    (46, 48, 17, 0.95),
    (52, 54, 12, 0.95),
    (56, 51, 11, 0.9),
    (56, 52, 12, 0.85),
    (56, 57, 13, 1),
    (57, 53, 21, 0.85);

INSERT INTO imports (importer_repo_id, importer_path, imported_repo_id, imported_path)
VALUES
    (1, 'scripts/daily_report.py', 1, 'analytics/loader.py'),
    (1, 'scripts/daily_report.py', 1, 'analytics/stats.py'),
    (1, 'src/app/api/orders/route.ts', 1, 'src/orders/service.ts'),
    (1, 'src/legacy/csv.js', 1, 'src/legacy/format.js'),
    (1, 'src/orders/pricing.ts', 1, 'src/lib/money.ts'),
    (1, 'src/orders/service.ts', 1, 'src/lib/log.ts'),
    (1, 'src/orders/service.ts', 1, 'src/lib/money.ts'),
    (1, 'src/orders/service.ts', 1, 'src/orders/address.ts'),
    (1, 'src/orders/service.ts', 1, 'src/orders/pricing.ts'),
    (1, 'tools/stock/main.go', 1, 'tools/stock/inventory/store.go');

SELECT setval(pg_get_serial_sequence('repository', 'repo_id'), (SELECT max(repo_id) FROM repository));

SELECT setval(pg_get_serial_sequence('symbol', 'symbol_id'), (SELECT max(symbol_id) FROM symbol));

COMMIT;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gitLogArgs, parseGitLog } from "../src/gitlog";

const RS = "\x1e";
const US = "\x1f";
const GS = "\x1d";

function header(sha: string, parents: string, name: string, email: string, date: string, message: string): string {
  return `${RS}${sha}${US}${parents}${US}${name}${US}${email}${US}${date}${US}${message}\n${GS}\n`;
}

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

describe("gitLogArgs", () => {
  it("asks for oldest-first patches with zero context and machine-readable headers", () => {
    const args = gitLogArgs();
    assert.equal(args[0], "-c");
    assert.equal(args[1], "core.quotePath=false");
    for (const flag of ["log", "--reverse", "-p", "--unified=0", "--no-color", "--no-ext-diff", "--find-renames", "--diff-merges=off"]) {
      assert.ok(args.includes(flag), `missing ${flag}`);
    }
    assert.ok(args.includes("--format=%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%cI%x1f%B%x1d"));
  });
});

describe("parseGitLog", () => {
  it("reads a root commit that adds a file and a later commit that edits it", () => {
    const output =
      header(A, "", "Asha Rao", "asha.rao@acme.example", "2026-09-01T09:00:00+05:30", "Add money helpers") +
      "\n" +
      "diff --git a/src/lib/money.ts b/src/lib/money.ts\n" +
      "new file mode 100644\n" +
      "index 0000000..b2856db\n" +
      "--- /dev/null\n" +
      "+++ b/src/lib/money.ts\n" +
      "@@ -0,0 +1,7 @@\n" +
      "+export function roundCurrency(value: number): number {\n" +
      "+  return Math.round(value * 100) / 100;\n" +
      "+}\n" +
      "+\n" +
      "+export function formatMoney(value: number): string {\n" +
      "+  return roundCurrency(value).toFixed(2);\n" +
      "+}\n" +
      header(B, A, "Ben Okafor", "Ben@Acme.example", "2026-09-02T11:30:00+05:30", "Round half cents up") +
      "\n" +
      "diff --git a/src/lib/money.ts b/src/lib/money.ts\n" +
      "index b2856db..c1d2e3f 100644\n" +
      "--- a/src/lib/money.ts\n" +
      "+++ b/src/lib/money.ts\n" +
      "@@ -2 +2 @@ export function roundCurrency(value: number): number {\n" +
      "-  return Math.round(value * 100) / 100;\n" +
      "+  return Math.round((value + Number.EPSILON) * 100) / 100;\n";

    assert.deepEqual(parseGitLog(output), [
      {
        sha: A,
        parents: [],
        authorName: "Asha Rao",
        authorEmail: "asha.rao@acme.example",
        committedAt: "2026-09-01T09:00:00+05:30",
        message: "Add money helpers",
        files: [{ oldPath: null, newPath: "src/lib/money.ts", binary: false, hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 7 }] }],
      },
      {
        sha: B,
        parents: [A],
        authorName: "Ben Okafor",
        authorEmail: "Ben@Acme.example",
        committedAt: "2026-09-02T11:30:00+05:30",
        message: "Round half cents up",
        files: [{ oldPath: "src/lib/money.ts", newPath: "src/lib/money.ts", binary: false, hunks: [{ oldStart: 2, oldLines: 1, newStart: 2, newLines: 1 }] }],
      },
    ]);
  });

  it("reads renames, deletions, binary files and pure deletion hunks", () => {
    const output =
      header(C, `${A} ${B}`, "Chen Li", "chen.li@acme.example", "2026-09-04T10:05:00+05:30", "Move CSV helpers") +
      "\n" +
      "diff --git a/src/csv.js b/src/legacy/csv.js\n" +
      "similarity index 90%\n" +
      "rename from src/csv.js\n" +
      "rename to src/legacy/csv.js\n" +
      "index 1111111..2222222 100644\n" +
      "--- a/src/csv.js\n" +
      "+++ b/src/legacy/csv.js\n" +
      "@@ -5,2 +4,0 @@ function toCsv(rows) {\n" +
      "-  // old comment\n" +
      "-  // another\n" +
      "diff --git a/docs/logo.png b/docs/logo.png\n" +
      "new file mode 100644\n" +
      "index 0000000..3333333\n" +
      "Binary files /dev/null and b/docs/logo.png differ\n" +
      "diff --git a/src/old.py b/src/old.py\n" +
      "deleted file mode 100644\n" +
      "index 4444444..0000000\n" +
      "--- a/src/old.py\n" +
      "+++ /dev/null\n" +
      "@@ -1,3 +0,0 @@\n" +
      "-def old():\n" +
      "-    return 1\n" +
      "-\n" +
      "diff --git a/src/same name.ts b/src/same name.ts\n" +
      "index 5555555..6666666 100644\n" +
      "--- a/src/same name.ts\n" +
      "+++ b/src/same name.ts\n" +
      "@@ -3,0 +4,2 @@\n" +
      "+// diff --git a/fake b/fake\n" +
      "+--- a/also fake\n";

    const [commit] = parseGitLog(output);
    assert.deepEqual(commit.parents, [A, B]);
    assert.deepEqual(commit.files, [
      { oldPath: "src/csv.js", newPath: "src/legacy/csv.js", binary: false, hunks: [{ oldStart: 5, oldLines: 2, newStart: 4, newLines: 0 }] },
      { oldPath: null, newPath: "docs/logo.png", binary: true, hunks: [] },
      { oldPath: "src/old.py", newPath: null, binary: false, hunks: [{ oldStart: 1, oldLines: 3, newStart: 0, newLines: 0 }] },
      { oldPath: "src/same name.ts", newPath: "src/same name.ts", binary: false, hunks: [{ oldStart: 3, oldLines: 0, newStart: 4, newLines: 2 }] },
    ]);
  });

  it("keeps multi-line messages verbatim and allows merge commits without a patch", () => {
    const message = "Merge branch 'feature'\n\ndiff --git is just text here\n--- not a header";
    const output =
      header(C, `${A} ${B}`, "Chen Li", "chen.li@acme.example", "2026-09-04T10:05:00+05:30", message) +
      header(A, B, "Asha Rao", "asha.rao@acme.example", "2026-09-05T10:05:00+05:30", "Empty commit");
    const commits = parseGitLog(output);
    assert.equal(commits.length, 2);
    assert.equal(commits[0].message, message);
    assert.deepEqual(commits[0].files, []);
    assert.deepEqual(commits[1].files, []);
  });

  it("returns an empty list for a repository without commits", () => {
    assert.deepEqual(parseGitLog(""), []);
  });
});

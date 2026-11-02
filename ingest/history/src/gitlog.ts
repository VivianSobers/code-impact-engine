export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

export interface FileChange {
  oldPath: string | null;
  newPath: string | null;
  binary: boolean;
  hunks: Hunk[];
}

export interface CommitRecord {
  sha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  committedAt: string;
  message: string;
  files: FileChange[];
}

const RECORD = "\x1e";
const FIELD = "\x1f";
const END_OF_HEADER = "\x1d";

// Oldest commit first, every commit on every branch, each with a zero-context patch.
// Merge commits get no patch: their changes are counted on the commits that made them.
export function gitLogArgs(): string[] {
  return [
    "-c",
    "core.quotePath=false",
    "log",
    "--reverse",
    "-p",
    "--unified=0",
    "--no-color",
    "--no-ext-diff",
    "--find-renames",
    "--diff-merges=off",
    `--format=%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%cI%x1f%B%x1d`,
  ];
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const DIFF_HEADER = /^diff --git a\/(.*) b\/(.*)$/;
const BINARY = /^Binary files (?:\/dev\/null|a\/(.*)) and (?:\/dev\/null|b\/(.*)) differ$/;

function parseHeader(text: string): Omit<CommitRecord, "files"> {
  const [sha, parents, authorName, authorEmail, committedAt, ...message] = text.split(FIELD);
  return {
    sha,
    parents: parents ? parents.split(" ") : [],
    authorName,
    authorEmail,
    committedAt,
    message: message.join(FIELD).replace(/\n+$/, ""),
  };
}

// Reads the patch of one commit. Inside a hunk every line starts with "+", "-" or "\",
// so header-looking text in added or removed lines is never mistaken for a header.
function parsePatch(text: string): FileChange[] {
  const files: FileChange[] = [];
  let file: FileChange | null = null;
  let remainingOld = 0;
  let remainingNew = 0;

  for (const line of text.split("\n")) {
    if (remainingOld > 0 || remainingNew > 0) {
      if (line.startsWith("-")) remainingOld -= 1;
      else if (line.startsWith("+")) remainingNew -= 1;
      continue;
    }

    const header = DIFF_HEADER.exec(line);
    if (header) {
      file = { oldPath: header[1], newPath: header[2], binary: false, hunks: [] };
      files.push(file);
      continue;
    }
    if (!file) continue;

    if (line.startsWith("new file mode")) file.oldPath = null;
    else if (line.startsWith("deleted file mode")) file.newPath = null;
    else if (line.startsWith("rename from ")) file.oldPath = line.slice("rename from ".length);
    else if (line.startsWith("rename to ")) file.newPath = line.slice("rename to ".length);
    else if (line === "--- /dev/null") file.oldPath = null;
    else if (line === "+++ /dev/null") file.newPath = null;
    else if (line.startsWith("--- a/")) file.oldPath = line.slice("--- a/".length);
    else if (line.startsWith("+++ b/")) file.newPath = line.slice("+++ b/".length);
    else if (BINARY.test(line)) file.binary = true;
    else {
      const hunk = HUNK.exec(line);
      if (hunk) {
        const parsed = {
          oldStart: Number(hunk[1]),
          oldLines: hunk[2] === undefined ? 1 : Number(hunk[2]),
          newStart: Number(hunk[3]),
          newLines: hunk[4] === undefined ? 1 : Number(hunk[4]),
        };
        file.hunks.push(parsed);
        remainingOld = parsed.oldLines;
        remainingNew = parsed.newLines;
      }
    }
  }
  return files;
}

export function parseGitLog(output: string): CommitRecord[] {
  return output
    .split(RECORD)
    .filter((record) => record.trim() !== "")
    .map((record) => {
      const end = record.indexOf(END_OF_HEADER);
      const header = end === -1 ? record : record.slice(0, end);
      const patch = end === -1 ? "" : record.slice(end + 1);
      return { ...parseHeader(header), files: parsePatch(patch) };
    });
}

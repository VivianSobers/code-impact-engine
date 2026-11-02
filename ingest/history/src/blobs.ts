import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface Blob {
  oid: string;
  text: string;
}

// Reads file contents at any revision through one long-running `git cat-file --batch`
// process, instead of starting `git show` once per file and commit.
export class BlobReader {
  private readonly git: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private readonly waiting: { resolve: (blob: Blob | null) => void; reject: (error: Error) => void }[] = [];
  private failure: Error | null = null;

  constructor(repoDir: string) {
    this.git = spawn("git", ["cat-file", "--batch"], { cwd: repoDir, stdio: ["pipe", "pipe", "pipe"] });
    this.git.stdout.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    this.git.on("error", (error) => this.fail(error));
    this.git.on("close", (code) => {
      if (this.waiting.length > 0) this.fail(new Error(`git cat-file exited with code ${code}`));
    });
  }

  private fail(error: Error): void {
    this.failure = error;
    for (const pending of this.waiting.splice(0)) pending.reject(error);
  }

  private drain(): void {
    while (this.waiting.length > 0) {
      const newline = this.buffer.indexOf(10);
      if (newline === -1) return;
      const header = this.buffer.subarray(0, newline).toString("utf8");
      if (header.endsWith(" missing") || header.endsWith(" ambiguous")) {
        this.buffer = this.buffer.subarray(newline + 1);
        this.waiting.shift()!.resolve(null);
        continue;
      }
      const [oid, type, size] = header.split(" ");
      const length = Number(size);
      if (this.buffer.length < newline + 1 + length + 1) return;
      const body = this.buffer.subarray(newline + 1, newline + 1 + length);
      this.buffer = this.buffer.subarray(newline + 1 + length + 1);
      this.waiting.shift()!.resolve(type === "blob" ? { oid, text: body.toString("utf8") } : null);
    }
  }

  // Returns null when the path does not exist at that revision.
  read(revision: string, filePath: string): Promise<Blob | null> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiting.push({ resolve, reject });
      this.git.stdin.write(`${revision}:${filePath}\n`);
    });
  }

  close(): void {
    this.git.stdin.end();
  }
}

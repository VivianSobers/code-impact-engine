import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { BadRequestError } from "./params";
import type { IngestSummary } from "./types";

export interface IngestRequest {
  source: string;
  name?: string;
  branch?: string;
}

export class IngestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly log: string = "",
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 10 * 60 * 1000;
const LOG_LIMIT = 4000;
const running = new Set<string>();

const REMOTE_SOURCE = /^(https?|ssh|git|file):\/\/[^\s]+$/i;
const SCP_SOURCE = /^[\w.-]+@[\w.-]+:[^\s]+$/;
const NAME = /^[\w .()-]{1,100}$/;
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*\/$)(?!.*\.lock$)[A-Za-z0-9._\/-]{1,200}$/;

function optional(value: FormDataEntryValue | string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function validateIngestRequest(input: {
  source?: unknown;
  name?: unknown;
  branch?: unknown;
}): IngestRequest {
  const source = optional(typeof input.source === "string" ? input.source : undefined);
  if (!source) throw new BadRequestError("Enter a Git URL or a local path.");
  if (source.length > 500) throw new BadRequestError("The source is longer than 500 characters.");
  if (source.startsWith("-") || /[\u0000-\u001f]/.test(source)) {
    throw new BadRequestError("The source contains characters that are not allowed.");
  }
  const isRemote = REMOTE_SOURCE.test(source) || SCP_SOURCE.test(source);
  if (!isRemote && !path.isAbsolute(source)) {
    throw new BadRequestError("Use an http(s), ssh or git URL, or an absolute path on the server.");
  }

  const name = optional(typeof input.name === "string" ? input.name : undefined);
  if (name !== undefined && !NAME.test(name)) {
    throw new BadRequestError("Names can use letters, digits, spaces, dots, dashes and parentheses, up to 100 characters.");
  }

  const branch = optional(typeof input.branch === "string" ? input.branch : undefined);
  if (branch !== undefined && !BRANCH.test(branch)) {
    throw new BadRequestError("That is not a valid branch name.");
  }

  return { source, name, branch };
}

function npmCli(): string {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const found = candidates.find((c) => c && /\.(c?js)$/.test(c) && existsSync(c));
  if (!found) throw new IngestError("Could not find the npm CLI to start the parser.", 500);
  return found;
}

function tail(text: string): string {
  return text.length > LOG_LIMIT ? text.slice(-LOG_LIMIT) : text;
}

function parseSummary(stdout: string): IngestSummary | null {
  const last = stdout.trim().split(/\r?\n/).pop();
  if (!last) return null;
  try {
    const value = JSON.parse(last) as Partial<IngestSummary>;
    if (typeof value.repoId !== "number") return null;
    return {
      repoId: value.repoId,
      name: String(value.name ?? ""),
      files: Number(value.files ?? 0),
      symbols: Number(value.symbols ?? 0),
      calls: Number(value.calls ?? 0),
      imports: Number(value.imports ?? 0),
      skipped: Number(value.skipped ?? 0),
      durationMs: Number(value.durationMs ?? 0),
    };
  } catch {
    return null;
  }
}

export function runIngest(request: IngestRequest): Promise<IngestSummary> {
  const ingestDir = path.join(process.cwd(), "ingest");
  if (!existsSync(path.join(ingestDir, "package.json"))) {
    return Promise.reject(new IngestError("The parser is not installed. Run npm install in ingest/ first.", 503));
  }
  if (running.has(request.source)) {
    return Promise.reject(new IngestError("This repository is already being parsed.", 409));
  }

  const args = [npmCli(), "run", "--silent", "parse", "--", request.source];
  if (request.name) args.push("--name", request.name);
  if (request.branch) args.push("--branch", request.branch);

  running.add(request.source);

  return new Promise<IngestSummary>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: ingestDir,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = tail(stdout + chunk.toString());
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = tail(stderr + chunk.toString());
    });

    const finish = (error: IngestError | null, summary?: IngestSummary) => {
      clearTimeout(timer);
      running.delete(request.source);
      if (error) reject(error);
      else resolve(summary!);
    };

    child.on("error", (err) => finish(new IngestError(`Could not start the parser: ${err.message}`, 500)));
    child.on("close", (code) => {
      if (timedOut) return finish(new IngestError("Parsing took longer than 10 minutes and was stopped.", 504, stderr));
      const summary = code === 0 ? parseSummary(stdout) : null;
      if (summary) return finish(null, summary);
      const reason = stderr.trim().split(/\r?\n/).filter(Boolean).pop();
      finish(
        new IngestError(
          code === 0 ? "The parser finished but did not report a summary." : reason ?? `The parser exited with code ${code}.`,
          code === 0 ? 500 : 422,
          stderr,
        ),
      );
    });
  });
}

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { workdir } from "./config";
import { grammarFor, type Grammar } from "./languages";

export interface SourceRepo {
  dir: string;
  url: string;
  name: string;
  branch: string;
  isGit: boolean;
}

export interface SourceOptions {
  name?: string;
  branch?: string;
  url?: string;
  log?: (message: string) => void;
}

export interface SourceFile {
  path: string;
  absolutePath: string;
  grammar: Grammar;
}

export const maxFileBytes = 1024 * 1024;

const skippedDirectories = new Set([
  "node_modules",
  "bower_components",
  "vendor",
  "third_party",
  "third-party",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  "site-packages",
  ".git",
]);

const generatedFile = /(\.min\.[cm]?js|[.-]bundle\.js|\.pb\.go|_pb2(_grpc)?\.py|\.generated\.[jt]sx?|\.gen\.go|\.d\.ts)$/i;

export function isRemote(target: string): boolean {
  return /^(https?|git|ssh|file):\/\//i.test(target) || /^[\w.-]+@[\w.-]+:/.test(target);
}

export function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

export function nameFromUrl(url: string): string {
  const trimmed = url.replace(/[\\/]+$/, "").replace(/\.git$/i, "");
  return trimmed.split(/[\\/:]/).filter(Boolean).pop() || "repository";
}

export function workdirFor(url: string): string {
  const withoutScheme = url.replace(/^[a-z]+:\/\//i, "").replace(/^[\w.-]+@/, "").replace(/\.git$/i, "");
  const parts = withoutScheme.split(/[\\/:]+/).filter(Boolean);
  const slug = parts.slice(-2).join("-").replace(/[^\w.-]+/g, "_") || "repository";
  return path.join(workdir, slug);
}

export function run(command: string, args: string[], cwd: string, passOutput = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
      if (passOutput) process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString("utf8"));
      else reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });
  });
}

const git = (args: string[], cwd: string, passOutput = false) => run("git", args, cwd, passOutput);

async function remoteDefaultBranch(dir: string): Promise<string> {
  try {
    const ref = (await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], dir)).trim();
    return ref.replace(/^origin\//, "");
  } catch {
    return (await git(["rev-parse", "--abbrev-ref", "HEAD"], dir)).trim();
  }
}

async function prepareRemote(url: string, options: SourceOptions): Promise<SourceRepo> {
  const dir = workdirFor(url);
  const log = options.log ?? (() => {});
  if (existsSync(path.join(dir, ".git"))) {
    log(`Fetching ${url} into ${dir}`);
    await git(["fetch", "--prune", "origin"], dir, true);
    await git(["remote", "set-head", "origin", "--auto"], dir).catch(() => "");
  } else {
    log(`Cloning ${url} into ${dir}`);
    mkdirSync(path.dirname(dir), { recursive: true });
    await git(["clone", "--no-checkout", url, dir], path.dirname(dir), true);
  }
  const branch = options.branch ?? (await remoteDefaultBranch(dir));
  await git(["checkout", "--force", "-B", branch, `origin/${branch}`], dir);
  return { dir, url: options.url ?? url, name: options.name ?? nameFromUrl(url), branch, isGit: true };
}

async function prepareLocal(target: string, options: SourceOptions): Promise<SourceRepo> {
  const dir = path.resolve(target);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`${target} is not a directory or a git URL`);
  const isGit = await git(["rev-parse", "--is-inside-work-tree"], dir).then(
    (output) => output.trim() === "true",
    () => false,
  );
  let branch = options.branch ?? "main";
  if (isGit) {
    const current = (await git(["rev-parse", "--abbrev-ref", "HEAD"], dir)).trim();
    if (options.branch && options.branch !== current) {
      throw new Error(`${target} has ${current} checked out. Check out ${options.branch} first or leave out --branch.`);
    }
    branch = current;
  }
  const url = options.url ?? toPosix(dir);
  return { dir, url, name: options.name ?? nameFromUrl(dir), branch, isGit };
}

export function prepareSource(target: string, options: SourceOptions = {}): Promise<SourceRepo> {
  return isRemote(target) ? prepareRemote(target, options) : prepareLocal(target, options);
}

function walk(dir: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) found.push(...walk(path.join(dir, entry.name), `${prefix}${entry.name}/`));
    } else if (entry.isFile()) {
      found.push(`${prefix}${entry.name}`);
    }
  }
  return found;
}

export function skipReason(filePath: string, size: number): string | null {
  if (filePath.includes("\\")) return "backslash in path";
  if (filePath.split("/").some((part) => skippedDirectories.has(part))) return "vendored or build output";
  if (generatedFile.test(filePath)) return "generated or minified";
  if (size > maxFileBytes) return "larger than 1 MB";
  return null;
}

export function looksMinified(text: string): boolean {
  if (text.includes("\u0000")) return true;
  const lines = text.split("\n");
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  return longest > 5000 || (lines.length > 0 && text.length / lines.length > 300);
}

export async function listSourceFiles(source: SourceRepo): Promise<{ files: SourceFile[]; skipped: string[] }> {
  const paths = source.isGit
    ? (await git(["ls-files", "-z"], source.dir)).split("\u0000").filter(Boolean)
    : walk(source.dir);
  const files: SourceFile[] = [];
  const skipped: string[] = [];
  for (const filePath of paths.map(toPosix).sort()) {
    const grammar = grammarFor(filePath);
    if (!grammar) continue;
    const absolutePath = path.join(source.dir, filePath);
    if (!existsSync(absolutePath)) continue;
    const stats = statSync(absolutePath);
    if (!stats.isFile()) continue;
    if (skipReason(filePath, stats.size)) {
      skipped.push(filePath);
      continue;
    }
    files.push({ path: filePath, absolutePath, grammar });
  }
  return { files, skipped };
}

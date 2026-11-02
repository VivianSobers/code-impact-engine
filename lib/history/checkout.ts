import path from "node:path";

// Where ingest keeps a repository's files. Mirrors checkoutDir in ingest/history/src/index.ts
// (isRemote and workdirFor in ingest/parse/src/source.ts), which the app cannot import.
function isRemote(target: string): boolean {
  return /^(https?|git|ssh|file):\/\//i.test(target) || /^[\w.-]+@[\w.-]+:/.test(target);
}

function workdirFor(url: string): string {
  const withoutScheme = url.replace(/^[a-z]+:\/\//i, "").replace(/^[\w.-]+@/, "").replace(/\.git$/i, "");
  const parts = withoutScheme.split(/[\\/:]+/).filter(Boolean);
  const slug = parts.slice(-2).join("-").replace(/[^\w.-]+/g, "_") || "repository";
  return path.join(process.cwd(), "ingest", "workdir", slug);
}

export function checkoutPath(url: string): string {
  return isRemote(url) ? workdirFor(url) : path.resolve(process.cwd(), url);
}

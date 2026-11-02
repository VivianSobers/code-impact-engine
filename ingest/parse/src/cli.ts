import { parseArgs } from "node:util";
import { ingestRepository } from "./index";

const usage = "Usage: npm run parse -- <git-url-or-local-path> [--name <name>] [--branch <branch>] [--url <url>]";

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      name: { type: "string" },
      branch: { type: "string" },
      url: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    process.stderr.write(`${usage}\n`);
    return;
  }
  if (positionals.length !== 1) throw new Error(usage);

  const summary = await ingestRepository({
    target: positionals[0],
    name: values.name,
    branch: values.branch,
    url: values.url,
    log: (message) => process.stderr.write(`${message}\n`),
  });
  process.stderr.write(
    `Ingested ${summary.name} as repo ${summary.repoId}: ${summary.files} files, ${summary.symbols} symbols, ${summary.calls} calls, ${summary.imports} imports in ${summary.durationMs} ms\n`,
  );
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`ingest failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

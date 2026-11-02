import { parseArgs } from "node:util";
import { ingestHistory } from "./index";

const usage = "Usage: npm run history -- <repo-id-or-name>";

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { help: { type: "boolean", short: "h" } },
  });

  if (values.help) {
    process.stderr.write(`${usage}\n`);
    return;
  }
  if (positionals.length !== 1) throw new Error(usage);

  const target = positionals[0];
  const summary = await ingestHistory({ repo: /^\d+$/.test(target) ? Number(target) : target });
  process.stderr.write(
    `Stored history of repo ${summary.repoId}: ${summary.commits} commits by ${summary.authors} authors, ${summary.modifies} symbol changes (${summary.unmatched} unmatched) in ${summary.durationMs} ms\n`,
  );
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`history failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

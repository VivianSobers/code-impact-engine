import { parseArgs } from "node:util";
import { embedRepository } from "./index";

const usage = "Usage: npm run embed -- <repo-id-or-name>";

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
  const summary = await embedRepository({ repo: /^\d+$/.test(target) ? Number(target) : target });
  process.stderr.write(
    `Embedded repo ${summary.repoId}: ${summary.symbols} symbols (${summary.embedded} new, ${summary.reused} reused), ${summary.clusters} clone clusters in ${summary.durationMs} ms\n`,
  );
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`embed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { repoRoot, type Settings } from "../../parse/src/config";

// A scratch database per test file, so integration tests running in parallel do not
// share rows. It is created when missing; only an unreachable server skips the tests.
export function testSettings(name: string): Settings {
  const server = process.env.INGEST_TEST_SERVER_URL ?? "postgresql://cie:change-me@localhost:5432";
  return {
    databaseUrl: `${server}/${name}`,
    mongoUri: process.env.INGEST_TEST_MONGODB_URI ?? "mongodb://localhost:27017",
    mongoDb: name,
  };
}

export async function prepareDatabase(settings: Settings): Promise<string | null> {
  const url = new URL(settings.databaseUrl);
  const name = url.pathname.slice(1);
  url.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 3000 });
  try {
    await admin.connect();
  } catch (error) {
    return `Postgres unreachable at ${url.host}: ${String(error)}`;
  }
  try {
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  const client = new pg.Client({ connectionString: settings.databaseUrl });
  await client.connect();
  try {
    const applied = await client.query("SELECT to_regclass('repository') AS structure, to_regclass('commit') AS history");
    if (applied.rows[0].structure && applied.rows[0].history) return null;
    for (const directory of ["db/schema", "db/functions", "db/views"]) {
      const full = path.join(repoRoot, directory);
      for (const file of readdirSync(full).filter((f) => f.endsWith(".sql")).sort()) {
        const isHistory = Number.parseInt(file, 10) >= 30;
        if (isHistory ? applied.rows[0].history : applied.rows[0].structure) continue;
        await client.query(readFileSync(path.join(full, file), "utf8"));
      }
    }
  } finally {
    await client.end();
  }
  return null;
}

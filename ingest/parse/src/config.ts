import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export const ingestRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const repoRoot = path.resolve(ingestRoot, "..");
export const workdir = path.join(ingestRoot, "workdir");

export interface Settings {
  databaseUrl: string;
  mongoUri: string;
  mongoDb: string;
}

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const envFile = path.join(repoRoot, ".env");
  const fromFile = existsSync(envFile) ? dotenv.parse(readFileSync(envFile)) : {};
  const pick = (key: string) => env[key] || fromFile[key] || "";

  const settings = {
    databaseUrl: pick("DATABASE_URL"),
    mongoUri: pick("MONGODB_URI"),
    mongoDb: pick("MONGODB_DB") || "cie",
  };
  const missing = Object.entries({ DATABASE_URL: settings.databaseUrl, MONGODB_URI: settings.mongoUri })
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`Missing ${missing.join(" and ")}. Set them in the environment or in ${envFile}.`);
  }
  return settings;
}

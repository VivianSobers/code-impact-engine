import { MongoClient, type Db } from "mongodb";
import { requireEnv } from "./env";

const cache = globalThis as typeof globalThis & { cieMongoClient?: Promise<MongoClient> };

export function mongoDatabaseName(): string {
  return process.env.MONGODB_DB || "cie";
}

export async function getDb(): Promise<Db> {
  cache.cieMongoClient ??= new MongoClient(requireEnv("MONGODB_URI")).connect().catch((error) => {
    cache.cieMongoClient = undefined;
    throw error;
  });
  const client = await cache.cieMongoClient;
  return client.db(mongoDatabaseName());
}

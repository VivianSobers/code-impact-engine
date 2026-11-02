import { Pool } from "pg";
import { requireEnv } from "./env";

const cache = globalThis as typeof globalThis & { ciePgPool?: Pool };

export function createPool(): Pool {
  return new Pool({ connectionString: requireEnv("DATABASE_URL"), max: 10 });
}

function sharedPool(): Pool {
  cache.ciePgPool ??= createPool();
  return cache.ciePgPool;
}

// Created on first use, so importing this module (for example during `next build`)
// does not need DATABASE_URL. The pool is kept on globalThis so dev reloads reuse it.
export const pool = new Proxy({} as Pool, {
  get(_target, property) {
    const target = sharedPool();
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

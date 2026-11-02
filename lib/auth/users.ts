import { pool } from "@/lib/pg";
import { hashPassword } from "./password";
import type { Role } from "./session";

export interface UserRecord {
  userId: number;
  username: string;
  role: Role;
  passwordHash: string;
  createdAt: string;
}

export type UserSummary = Omit<UserRecord, "passwordHash">;

// Same rule as the app_user_username_format constraint.
export const USERNAME = /^[a-z0-9_.-]{3,32}$/;

export class UserError extends Error {}

export async function findUserByUsername(username: string): Promise<UserRecord | null> {
  const result = await pool.query<{ user_id: string; username: string; role: Role; password_hash: string; created_at: Date }>(
    "SELECT user_id, username, role, password_hash, created_at FROM app_user WHERE username = $1",
    [username],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    userId: Number(row.user_id),
    username: row.username,
    role: row.role,
    passwordHash: row.password_hash,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listUsers(): Promise<UserSummary[]> {
  const result = await pool.query<{ user_id: string; username: string; role: Role; created_at: Date }>(
    "SELECT user_id, username, role, created_at FROM app_user ORDER BY role, username",
  );
  return result.rows.map((row) => ({
    userId: Number(row.user_id),
    username: row.username,
    role: row.role,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function createUser(input: { username: string; password: string; role: string }): Promise<UserSummary> {
  const username = input.username.trim().toLowerCase();
  if (!USERNAME.test(username)) {
    throw new UserError("Usernames are 3 to 32 characters: lowercase letters, digits, dots, dashes and underscores.");
  }
  if (input.role !== "admin" && input.role !== "developer") throw new UserError("Pick a role.");
  let passwordHash: string;
  try {
    passwordHash = await hashPassword(input.password);
  } catch (error) {
    throw new UserError(error instanceof Error ? error.message : String(error));
  }
  try {
    const result = await pool.query<{ user_id: string; created_at: Date }>(
      "INSERT INTO app_user (username, password_hash, role) VALUES ($1, $2, $3) RETURNING user_id, created_at",
      [username, passwordHash, input.role],
    );
    return {
      userId: Number(result.rows[0].user_id),
      username,
      role: input.role,
      createdAt: result.rows[0].created_at.toISOString(),
    };
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new UserError(`The username ${username} is taken.`);
    throw error;
  }
}

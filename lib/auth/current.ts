import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE, type Role, type SessionUser } from "./session";

export class AuthError extends Error {
  constructor(readonly status: 401 | 403) {
    super(status === 401 ? "Sign in first." : "Only admins can do that.");
  }
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return readSessionToken(store.get(SESSION_COOKIE)?.value);
}

// For server actions and route handlers. Middleware already checks routes, but a
// server action can be called from any page, so actions check again.
export async function requireUser(role?: Role): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError(401);
  if (role === "admin" && user.role !== "admin") throw new AuthError(403);
  return user;
}

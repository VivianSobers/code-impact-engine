import { jwtVerify, SignJWT } from "jose";

// Kept free of Node-only imports: middleware.ts runs it on the edge runtime.

export const SESSION_COOKIE = "cie_session";
export const SESSION_HOURS = 8;

export type Role = "admin" | "developer";

export interface SessionUser {
  userId: number;
  username: string;
  role: Role;
}

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET ?? "";
  if (value.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
  return new TextEncoder().encode(value);
}

export async function createSessionToken(user: SessionUser, now: number = Date.now()): Promise<string> {
  const issuedAt = Math.floor(now / 1000);
  return new SignJWT({ username: user.username, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.userId))
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + SESSION_HOURS * 60 * 60)
    .sign(secret());
}

// The user in a valid, unexpired token, or null for anything else.
export async function readSessionToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const userId = Number(payload.sub);
    if (!Number.isSafeInteger(userId) || userId <= 0) return null;
    if (typeof payload.username !== "string") return null;
    if (payload.role !== "admin" && payload.role !== "developer") return null;
    return { userId, username: payload.username, role: payload.role };
  } catch {
    return null;
  }
}

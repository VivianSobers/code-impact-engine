import { cookies, headers } from "next/headers";
import { DUMMY_HASH, verifyPassword } from "./password";
import { createSessionToken, SESSION_COOKIE, SESSION_HOURS, type SessionUser } from "./session";
import { loginThrottle } from "./throttle";
import { findUserByUsername } from "./users";

export type LoginResult = { ok: true; user: SessionUser } | { ok: false; error: string };

// Shared by the login form and POST /api/session, so both get the same throttle and
// the same message for an unknown user and a wrong password.
export async function authenticate(rawUsername: string, password: string): Promise<LoginResult> {
  const username = rawUsername.trim().toLowerCase();
  if (!username || !password) return { ok: false, error: "Enter your username and password." };
  if (loginThrottle.isBlocked(username)) {
    return { ok: false, error: "Too many failed attempts. Wait a few minutes and try again." };
  }
  const user = await findUserByUsername(username);
  // Unknown users are checked against a dummy hash so they take as long as real ones.
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    loginThrottle.fail(username);
    return { ok: false, error: "Wrong username or password." };
  }
  loginThrottle.reset(username);
  return { ok: true, user: { userId: user.userId, username: user.username, role: user.role } };
}

export async function startSession(user: SessionUser): Promise<void> {
  // Secure cookies are only sent over https, so mark the cookie Secure exactly when the
  // app is served over https. Over plain http (a demo on a LAN address) it would be dropped.
  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin") ?? `${requestHeaders.get("x-forwarded-proto") ?? "http"}://`;
  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(user), {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 60 * 60,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

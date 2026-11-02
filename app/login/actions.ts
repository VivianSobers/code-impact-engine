"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth/access";
import { DUMMY_HASH, verifyPassword } from "@/lib/auth/password";
import { createSessionToken, SESSION_COOKIE, SESSION_HOURS } from "@/lib/auth/session";
import { loginThrottle } from "@/lib/auth/throttle";
import { findUserByUsername } from "@/lib/auth/users";

export type LoginState = { error: string | null; username: string };

const WRONG = "Wrong username or password.";

export async function login(_previous: LoginState, form: FormData): Promise<LoginState> {
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!username || !password) return { error: "Enter your username and password.", username };
  if (loginThrottle.isBlocked(username)) {
    return { error: "Too many failed attempts. Wait a few minutes and try again.", username };
  }

  const user = await findUserByUsername(username);
  // Unknown users are checked against a dummy hash so they take as long as real ones.
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    loginThrottle.fail(username);
    return { error: WRONG, username };
  }

  loginThrottle.reset(username);
  // Secure cookies are only sent over https, so mark the cookie Secure exactly when the
  // app is served over https. Over plain http (a demo on a LAN address) it would be dropped.
  const secure = (await headers()).get("origin")?.startsWith("https://") ?? false;
  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(user), {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 60 * 60,
  });
  redirect(safeNext(String(form.get("next") ?? "")));
}

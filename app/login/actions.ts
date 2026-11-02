"use server";

import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth/access";
import { authenticate, startSession } from "@/lib/auth/login";

export type LoginState = { error: string | null; username: string };

export async function login(_previous: LoginState, form: FormData): Promise<LoginState> {
  const username = String(form.get("username") ?? "");
  const result = await authenticate(username, String(form.get("password") ?? ""));
  if (!result.ok) return { error: result.error, username: username.trim().toLowerCase() };
  await startSession(result.user);
  redirect(safeNext(String(form.get("next") ?? "")));
}

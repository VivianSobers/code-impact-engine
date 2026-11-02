"use server";

import { revalidatePath } from "next/cache";
import { AuthError, requireUser } from "@/lib/auth/current";
import { createUser, UserError } from "@/lib/auth/users";

export type CreateUserState =
  | { status: "idle" }
  | { status: "created"; username: string }
  | { status: "error"; message: string; username: string; role: string };

export async function addUser(_previous: CreateUserState, form: FormData): Promise<CreateUserState> {
  const username = String(form.get("username") ?? "");
  const role = String(form.get("role") ?? "");
  try {
    await requireUser("admin");
    const user = await createUser({ username, password: String(form.get("password") ?? ""), role });
    revalidatePath("/admin/users");
    return { status: "created", username: user.username };
  } catch (error) {
    if (error instanceof UserError || error instanceof AuthError) {
      return { status: "error", message: error.message, username, role };
    }
    console.error(error);
    return { status: "error", message: "The user could not be created because of a server error.", username, role };
  }
}

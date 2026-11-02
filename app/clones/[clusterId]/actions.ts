"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AuthError, requireUser } from "@/lib/auth/current";
import { parseReviewBody, reviewCluster, ReviewError } from "@/lib/clones/queries";
import { BadRequestError } from "@/lib/structure/params";

// Bound to the cluster id by the page. The pressed button sends status. On failure the
// page is shown again with the database's message.
export async function reviewClusterAction(clusterId: number, form: FormData): Promise<void> {
  let problem: string | null = null;
  try {
    const user = await requireUser("admin");
    const body = parseReviewBody({
      status: form.get("status"),
      waive: form.getAll("waive").map(Number),
      reason: form.get("reason") ?? undefined,
    });
    await reviewCluster({ clusterId, reviewerId: user.userId, ...body });
  } catch (error) {
    if (error instanceof ReviewError || error instanceof AuthError || error instanceof BadRequestError) {
      problem = error.message;
    } else {
      console.error(error);
      problem = "The review could not be saved because of a server error.";
    }
  }
  revalidatePath("/clones");
  redirect(problem ? `/clones/${clusterId}?error=${encodeURIComponent(problem)}` : `/clones/${clusterId}`);
}

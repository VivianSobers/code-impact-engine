"use server";

import { revalidatePath } from "next/cache";
import { IngestError, runIngest, validateIngestRequest } from "@/lib/structure/ingest";
import { BadRequestError } from "@/lib/structure/params";
import type { IngestSummary } from "@/lib/structure/types";

export type AddRepositoryState =
  | { status: "idle" }
  | { status: "success"; summary: IngestSummary }
  | { status: "error"; message: string; log?: string; values: { source: string; name: string; branch: string } };

export async function addRepository(_previous: AddRepositoryState, form: FormData): Promise<AddRepositoryState> {
  const values = {
    source: String(form.get("source") ?? ""),
    name: String(form.get("name") ?? ""),
    branch: String(form.get("branch") ?? ""),
  };
  try {
    const summary = await runIngest(validateIngestRequest(values));
    revalidatePath("/repositories");
    return { status: "success", summary };
  } catch (error) {
    if (error instanceof BadRequestError) return { status: "error", message: error.message, values };
    if (error instanceof IngestError) {
      return { status: "error", message: error.message, log: error.log || undefined, values };
    }
    console.error(error);
    return { status: "error", message: "The repository could not be added because of a server error.", values };
  }
}

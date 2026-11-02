import type { NextRequest } from "next/server";
import { handle } from "@/lib/structure/http";
import { runIngest, validateIngestRequest } from "@/lib/structure/ingest";
import { BadRequestError } from "@/lib/structure/params";
import { listRepositories } from "@/lib/structure/repositories";

export const dynamic = "force-dynamic";

export function GET() {
  return handle(async () => ({ repositories: await listRepositories() }));
}

export function POST(request: NextRequest) {
  return handle(async () => {
    const body: unknown = await request.json().catch(() => {
      throw new BadRequestError("Send a JSON body with a source field.");
    });
    if (typeof body !== "object" || body === null) throw new BadRequestError("Send a JSON body with a source field.");
    return { summary: await runIngest(validateIngestRequest(body)) };
  }, 201);
}

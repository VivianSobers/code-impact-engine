import type { NextRequest } from "next/server";
import { getAstStats } from "@/lib/structure/ast";
import { handle, orNotFound } from "@/lib/structure/http";
import { parseBoundedInt, parseId } from "@/lib/structure/params";
import { getRepository } from "@/lib/structure/repositories";

export function GET(request: NextRequest, { params }: { params: Promise<{ repoId: string }> }) {
  return handle(async () => {
    const repoId = parseId((await params).repoId, "repoId");
    const limit = parseBoundedInt(request.nextUrl.searchParams.get("limit"), "limit", { min: 1, max: 100, fallback: 8 });
    orNotFound(await getRepository(repoId), "Repository");
    return getAstStats(repoId, { typesPerLanguage: limit, deepest: limit });
  });
}

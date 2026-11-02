import type { NextRequest } from "next/server";
import { handle } from "@/lib/structure/http";
import { parseBoundedInt, parseOptionalId } from "@/lib/structure/params";
import { EMBEDDING_MODEL } from "@/lib/search/model";
import { parseSearchQuery } from "@/lib/search/params";
import { searchByMeaning } from "@/lib/search/semantic";

export function GET(request: NextRequest) {
  return handle(async () => {
    const params = request.nextUrl.searchParams;
    const q = parseSearchQuery(params.get("q"));
    const repoId = parseOptionalId(params.get("repo"), "repo");
    const limit = parseBoundedInt(params.get("limit"), "limit", { min: 1, max: 50, fallback: 20 });
    return { query: q, repoId, model: EMBEDDING_MODEL, results: await searchByMeaning(q, { repoId, limit }) };
  });
}

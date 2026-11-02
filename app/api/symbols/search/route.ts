import type { NextRequest } from "next/server";
import { handle } from "@/lib/structure/http";
import { searchSymbols } from "@/lib/structure/impact";
import { BadRequestError, parseBoundedInt, parseOptionalId } from "@/lib/structure/params";

export function GET(request: NextRequest) {
  return handle(async () => {
    const query = request.nextUrl.searchParams;
    const q = (query.get("q") ?? "").trim();
    if (q === "") throw new BadRequestError("q is required");
    if (q.length > 200) throw new BadRequestError("q is longer than 200 characters");
    const repoId = parseOptionalId(query.get("repo"), "repo");
    const limit = parseBoundedInt(query.get("limit"), "limit", { min: 1, max: 500, fallback: 50 });
    return { query: q, repoId, results: await searchSymbols(q, repoId, limit) };
  });
}

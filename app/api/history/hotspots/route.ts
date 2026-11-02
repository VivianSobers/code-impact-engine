import type { NextRequest } from "next/server";
import { getHotspots } from "@/lib/history/queries";
import { handle } from "@/lib/structure/http";
import { parseBoundedInt, parseOptionalId } from "@/lib/structure/params";

export function GET(request: NextRequest) {
  return handle(async () => {
    const params = request.nextUrl.searchParams;
    const repoId = parseOptionalId(params.get("repo"), "repo");
    const limit = parseBoundedInt(params.get("limit"), "limit", { min: 1, max: 100, fallback: 15 });
    return { hotspots: await getHotspots(repoId, limit) };
  });
}

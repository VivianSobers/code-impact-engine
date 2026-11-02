import type { NextRequest } from "next/server";
import { handle } from "@/lib/structure/http";
import { IMPACT_MAX_DEPTH, impactOf, summarizeImpact } from "@/lib/structure/impact";
import { parseBoundedInt, parseConfidence, parseId } from "@/lib/structure/params";

export function GET(request: NextRequest, { params }: { params: Promise<{ symbolId: string }> }) {
  return handle(async () => {
    const symbolId = parseId((await params).symbolId, "symbolId");
    const query = request.nextUrl.searchParams;
    const depth = parseBoundedInt(query.get("depth"), "depth", { min: 1, max: IMPACT_MAX_DEPTH, fallback: 5 });
    const minConfidence = parseConfidence(query.get("min"));
    const affected = await impactOf(symbolId, depth, minConfidence);
    return { symbolId, depth, minConfidence, summary: summarizeImpact(affected), affected };
  });
}

import type { NextRequest } from "next/server";
import { GRAPH_MAX_DEPTH, GRAPH_MAX_NODES, getCallGraph } from "@/lib/structure/graph";
import { handle, orNotFound } from "@/lib/structure/http";
import { parseBoundedInt, parseId } from "@/lib/structure/params";
import { getSymbol } from "@/lib/structure/symbols";

export function GET(request: NextRequest, { params }: { params: Promise<{ symbolId: string }> }) {
  return handle(async () => {
    const symbolId = parseId((await params).symbolId, "symbolId");
    const query = request.nextUrl.searchParams;
    const depth = parseBoundedInt(query.get("depth"), "depth", { min: 1, max: GRAPH_MAX_DEPTH, fallback: 2 });
    const limit = parseBoundedInt(query.get("limit"), "limit", { min: 1, max: GRAPH_MAX_NODES, fallback: 60 });
    orNotFound(await getSymbol(symbolId), "Symbol");
    return getCallGraph(symbolId, depth, limit);
  });
}

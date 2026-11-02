import type { NextRequest } from "next/server";
import { listClusters, parseClusterFilter } from "@/lib/clones/queries";
import { handle } from "@/lib/structure/http";

export function GET(request: NextRequest) {
  return handle(() => listClusters(parseClusterFilter(request.nextUrl.searchParams)));
}

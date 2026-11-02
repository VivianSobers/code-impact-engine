import type { NextRequest } from "next/server";
import { parseCommitFilter } from "@/lib/history/params";
import { listCommits } from "@/lib/history/queries";
import { handle } from "@/lib/structure/http";

export function GET(request: NextRequest) {
  return handle(() => listCommits(parseCommitFilter(request.nextUrl.searchParams)));
}

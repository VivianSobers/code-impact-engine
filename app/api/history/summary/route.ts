import type { NextRequest } from "next/server";
import { getSummary } from "@/lib/history/queries";
import { handle } from "@/lib/structure/http";
import { parseOptionalId } from "@/lib/structure/params";

export function GET(request: NextRequest) {
  return handle(() => getSummary(parseOptionalId(request.nextUrl.searchParams.get("repo"), "repo")));
}

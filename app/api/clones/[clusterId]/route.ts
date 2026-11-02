import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth/current";
import { getCluster, parseReviewBody, reviewCluster, ReviewError } from "@/lib/clones/queries";
import { errorResponse, handle, orNotFound } from "@/lib/structure/http";
import { BadRequestError, parseId } from "@/lib/structure/params";

type Context = { params: Promise<{ clusterId: string }> };

export function GET(_request: Request, { params }: Context) {
  return handle(async () => {
    const clusterId = parseId((await params).clusterId, "clusterId");
    return orNotFound(await getCluster(clusterId), `clone cluster ${clusterId}`);
  });
}

// Confirm or dismiss the cluster as the signed-in admin.
export async function POST(request: Request, { params }: Context) {
  try {
    const user = await requireUser("admin");
    const clusterId = parseId((await params).clusterId, "clusterId");
    const body = parseReviewBody(await request.json().catch(() => {
      throw new BadRequestError("send a JSON object");
    }));
    await reviewCluster({ clusterId, reviewerId: user.userId, ...body });
    return NextResponse.json(await getCluster(clusterId));
  } catch (error) {
    if (error instanceof ReviewError || error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return errorResponse(error);
  }
}

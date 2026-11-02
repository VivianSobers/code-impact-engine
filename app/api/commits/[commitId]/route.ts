import { getCommit } from "@/lib/history/queries";
import { handle, orNotFound } from "@/lib/structure/http";
import { parseId } from "@/lib/structure/params";

export function GET(_request: Request, { params }: { params: Promise<{ commitId: string }> }) {
  return handle(async () => {
    const commitId = parseId((await params).commitId, "commitId");
    return orNotFound(await getCommit(commitId), `commit ${commitId}`);
  });
}

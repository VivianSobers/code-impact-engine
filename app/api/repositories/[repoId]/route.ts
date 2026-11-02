import { handle, orNotFound } from "@/lib/structure/http";
import { parseId } from "@/lib/structure/params";
import { getRepository, listFiles } from "@/lib/structure/repositories";

export function GET(_request: Request, { params }: { params: Promise<{ repoId: string }> }) {
  return handle(async () => {
    const repoId = parseId((await params).repoId, "repoId");
    const repository = orNotFound(await getRepository(repoId), "Repository");
    return { repository, files: await listFiles(repoId) };
  });
}

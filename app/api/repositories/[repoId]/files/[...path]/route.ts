import type { NextRequest } from "next/server";
import { getFile, listImportedBy, listImports, listSymbolsInFile } from "@/lib/structure/files";
import { handle, orNotFound } from "@/lib/structure/http";
import { joinPathSegments, parseId } from "@/lib/structure/params";

export function GET(request: NextRequest, { params }: { params: Promise<{ repoId: string }> }) {
  return handle(async () => {
    const repoId = parseId((await params).repoId, "repoId");
    const rawSegments = request.nextUrl.pathname.split("/").slice(5);
    const path = joinPathSegments(rawSegments);
    const file = orNotFound(await getFile(repoId, path), "File");
    const [symbols, imports, importedBy] = await Promise.all([
      listSymbolsInFile(repoId, path),
      listImports(repoId, path),
      listImportedBy(repoId, path),
    ]);
    return { file, symbols, imports, importedBy };
  });
}

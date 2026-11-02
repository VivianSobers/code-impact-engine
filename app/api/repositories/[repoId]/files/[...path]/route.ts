import { listImportedBy, listImports, getFile, listSymbolsInFile } from "@/lib/structure/files";
import { handle, orNotFound } from "@/lib/structure/http";
import { joinPathSegments, parseId } from "@/lib/structure/params";

export function GET(_request: Request, { params }: { params: Promise<{ repoId: string; path: string[] }> }) {
  return handle(async () => {
    const raw = await params;
    const repoId = parseId(raw.repoId, "repoId");
    const path = joinPathSegments(raw.path);
    const file = orNotFound(await getFile(repoId, path), "File");
    const [symbols, imports, importedBy] = await Promise.all([
      listSymbolsInFile(repoId, path),
      listImports(repoId, path),
      listImportedBy(repoId, path),
    ]);
    return { file, symbols, imports, importedBy };
  });
}

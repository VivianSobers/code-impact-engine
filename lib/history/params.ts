import { BadRequestError, parseBoundedInt, parseOptionalId } from "@/lib/structure/params";
import type { CommitFilter } from "./types";

export function parseSearchText(raw: string | null | undefined, label = "q", max = 200): string {
  const text = (raw ?? "").trim();
  if (text.length > max) throw new BadRequestError(`${label} must be at most ${max} characters`);
  return text;
}

export function parseCommitFilter(params: URLSearchParams): CommitFilter {
  return {
    repoId: parseOptionalId(params.get("repo"), "repo"),
    authorId: parseOptionalId(params.get("author"), "author"),
    q: parseSearchText(params.get("q")),
    page: parseBoundedInt(params.get("page"), "page", { min: 1, max: 100000, fallback: 1 }),
  };
}

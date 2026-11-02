import { BadRequestError } from "@/lib/structure/params";

export const MAX_QUERY = 500;

export function parseSearchQuery(raw: string | null | undefined): string {
  const query = (raw ?? "").trim();
  if (!query) throw new BadRequestError("Describe what the code does, for example: round a price to two decimals.");
  if (query.length > MAX_QUERY) throw new BadRequestError(`Keep the search to at most ${MAX_QUERY} characters.`);
  return query;
}

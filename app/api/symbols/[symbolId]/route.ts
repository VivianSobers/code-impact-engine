import { handle, orNotFound } from "@/lib/structure/http";
import { parseId } from "@/lib/structure/params";
import { getSymbol, listCallees, listCallers } from "@/lib/structure/symbols";

export function GET(_request: Request, { params }: { params: Promise<{ symbolId: string }> }) {
  return handle(async () => {
    const symbolId = parseId((await params).symbolId, "symbolId");
    const symbol = orNotFound(await getSymbol(symbolId), "Symbol");
    const [callers, callees] = await Promise.all([listCallers(symbolId), listCallees(symbolId)]);
    return { symbol, callers, callees };
  });
}

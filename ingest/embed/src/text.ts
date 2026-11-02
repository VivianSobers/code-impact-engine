import { createHash } from "node:crypto";

// The model reads at most this much of a symbol. Long bodies are cut, not skipped.
export const MAX_BODY_CHARS = 4000;

// The text that gets embedded: the symbol's own source lines. Its hash identifies the
// embedding, so identical bodies anywhere share one vector and unchanged symbols keep
// theirs across re-parses.
export function symbolBody(source: string, startLine: number, endLine: number): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n").slice(startLine - 1, endLine);
  return lines.join("\n").slice(0, MAX_BODY_CHARS);
}

export function bodyHash(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

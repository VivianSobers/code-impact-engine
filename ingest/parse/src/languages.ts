import path from "node:path";

export type Language = "javascript" | "typescript" | "python" | "java" | "go";
export type Grammar = "javascript" | "typescript" | "tsx" | "python" | "java" | "go";

const grammarsByExtension: Record<string, Grammar> = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".py": "python",
  ".java": "java",
  ".go": "go",
};

export const jsExtensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

export function grammarFor(filePath: string): Grammar | null {
  return grammarsByExtension[path.posix.extname(filePath).toLowerCase()] ?? null;
}

export function languageOf(grammar: Grammar): Language {
  return grammar === "tsx" ? "typescript" : grammar;
}

export function languageFamily(language: Language): string {
  return language === "typescript" ? "javascript" : language;
}

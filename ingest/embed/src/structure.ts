// Compares the shape of two code snippets: same keywords and punctuation in the same
// order, with names, strings and numbers blanked out. Renamed copies score 1.
// It works on the text, so it is language-agnostic and only roughly right about
// comments (a "#" after whitespace is treated as a comment, as in Python).

const KEYWORDS = new Set(
  (
    "function return if else for while do switch case break continue var let const new this class extends super " +
    "try catch finally throw typeof instanceof in of async await yield import export from default null undefined " +
    "true false def self None True False elif lambda pass with as raise except func package struct interface type " +
    "go defer range map chan public private protected static final void int long double float boolean string"
  ).split(" "),
);

const TOKEN =
  /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\d[\w.]*)|([A-Za-z_$][\w$]*)|(===|!==|==|!=|<=|>=|=>|&&|\|\||\+\+|--|\+=|-=|\*=|\/=|::|->|\S)/g;

export function codeTokens(source: string): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/(^|\s)#[^\n]*/g, " ");
  const tokens: string[] = [];
  for (const m of code.matchAll(TOKEN)) {
    if (m[1]) tokens.push("STR");
    else if (m[2]) tokens.push("NUM");
    else if (m[3]) tokens.push(KEYWORDS.has(m[3]) ? m[3] : "ID");
    else tokens.push(m[4]);
  }
  return tokens;
}

// 2 * (longest common subsequence) / (total length), from 0 to 1.
export function structuralSimilarity(a: string, b: string): number {
  const x = codeTokens(a);
  const y = codeTokens(b);
  if (x.length === 0 || y.length === 0) return 0;
  let previous = new Uint32Array(y.length + 1);
  let current = new Uint32Array(y.length + 1);
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      current[j] = x[i - 1] === y[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    }
    [previous, current] = [current, previous];
  }
  return (2 * previous[y.length]) / (x.length + y.length);
}

export interface AuthorGroup {
  name: string;
  company: string | null;
  emails: string[];
}

interface CommitAuthor {
  authorName: string;
  authorEmail: string;
  committedAt: string;
}

const PERSONAL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
]);

// Second-level labels that sit under a country code, as in co.uk or ac.in.
const SECOND_LEVEL = new Set(["co", "com", "ac", "org", "net", "gov", "edu"]);

export function companyFromEmail(email: string): string | null {
  const domain = email.toLowerCase().split("@")[1] ?? "";
  if (!domain || PERSONAL_DOMAINS.has(domain) || domain.split(".").includes("noreply")) return null;
  const labels = domain.split(".");
  if (labels.length < 2) return null;
  let index = labels.length - 2;
  if (labels.length >= 3 && labels[labels.length - 1].length === 2 && SECOND_LEVEL.has(labels[index])) index -= 1;
  const label = labels[index];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function normaliseName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// Commits belong to the same person when they share a name (ignoring case and spacing)
// or an email address. Each person gets the spelling of their name they used most
// often (ties go to the latest), and the company of their latest company email.
export function groupAuthors(commits: CommitAuthor[]): AuthorGroup[] {
  const parent: number[] = commits.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const firstByKey = new Map<string, number>();
  commits.forEach((commit, i) => {
    const email = commit.authorEmail.trim().toLowerCase();
    const name = normaliseName(commit.authorName) || email;
    const keys = [name && `n:${name}`, email && `e:${email}`].filter(Boolean) as string[];
    for (const key of keys) {
      const first = firstByKey.get(key);
      if (first === undefined) firstByKey.set(key, i);
      else parent[find(i)] = find(first);
    }
  });

  const groups = new Map<number, number[]>();
  commits.forEach((_, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  });

  return [...groups.values()]
    .sort((a, b) => a[0] - b[0])
    .map((members) => {
      const byTime = [...members].sort(
        (a, b) => Date.parse(commits[a].committedAt) - Date.parse(commits[b].committedAt) || a - b,
      );
      const uses = new Map<string, number>();
      for (const i of byTime) {
        const spelling = commits[i].authorName.trim().replace(/\s+/g, " ");
        if (spelling) uses.set(spelling, (uses.get(spelling) ?? 0) + 1);
      }
      let name = "";
      for (const i of byTime) {
        const spelling = commits[i].authorName.trim().replace(/\s+/g, " ");
        if (spelling && (uses.get(spelling) ?? 0) >= (uses.get(name) ?? 0)) name = spelling;
      }
      const emails = [...new Set(members.map((i) => commits[i].authorEmail.trim().toLowerCase()))].filter(Boolean).sort();
      const company =
        byTime
          .map((i) => companyFromEmail(commits[i].authorEmail))
          .filter((c): c is string => c !== null)
          .pop() ?? null;
      return { name: name || emails[0], company, emails };
    });
}
